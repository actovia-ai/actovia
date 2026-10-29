import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  DEFAULT_STOCK_RANGE,
  type StockBlock as StockBlockData
} from '@actovia/shared/types/interactive'
import {
  STOCK_CHART_HEIGHT,
  tradingViewEmbedUrl,
  tradingViewSymbolPageUrl
} from '@actovia/shared/utils/stock-chart'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** How long the frame may say nothing before the card gives up on it (offline, blocked). */
export const STOCK_FRAME_TIMEOUT_MS = 10_000

type Phase = 'loading' | 'loaded' | 'failed'

/** Where a chart URL starts: an app that knows it is offline gives up at once. */
const firstPhase = (): Phase =>
  typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'failed'
    : 'loading'

/**
 * A reply's stock chart (`actovia-stock`): TradingView's Symbol Overview as its
 * own embed URL in a sandboxed frame — no script of theirs in our document;
 * the frame cannot navigate us or open windows — the model's note under it,
 * and "Chart by TradingView" with the symbol's page. The frame is not lazy:
 * a frame that never starts could not be told from one that failed, and the
 * card falls back to the symbol and the note when it fails or stays silent.
 *
 * Each chart URL (a theme or language change makes a new one) starts over:
 * the frame is mounted afresh with the watchdog re-armed, or, when the app
 * is offline, the card falls back at once without a frame. A navigation that
 * fails does not fire the frame's `error` — Chromium commits its own error
 * page into the frame and fires `load` — so a network that is up but blocks
 * TradingView shows that error page inside the card; only a main-process
 * `did-fail-load` relay could catch it, and that is not done here.
 */
export function StockBlock({ block }: { block: StockBlockData }) {
  const { t, i18n } = useTranslation('chat')
  const { resolvedTheme } = useTheme()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const src = useMemo(
    () =>
      tradingViewEmbedUrl({
        symbol: block.symbol,
        range: block.range ?? DEFAULT_STOCK_RANGE,
        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
        locale
      }),
    [block.symbol, block.range, resolvedTheme, locale]
  )
  // The phase belongs to one chart URL; a new URL starts from its first phase.
  const [state, setState] = useState(() => ({ src, phase: firstPhase() }))
  if (state.src !== src) setState({ src, phase: firstPhase() })
  const phase = state.src === src ? state.phase : 'loading'
  const setPhase = useCallback(
    (next: Phase) =>
      setState((current) =>
        current.src === src ? { src, phase: next } : current
      ),
    [src]
  )

  useEffect(() => {
    if (phase !== 'loading') return
    const timer = setTimeout(() => setPhase('failed'), STOCK_FRAME_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [phase, setPhase])

  // React wires no `error` listener on an <iframe> (only `load`), so
  // `onError` would never fire; the frame's own listener does.
  const frameRef = useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return
      const fail = () => setPhase('failed')
      frame.addEventListener('error', fail)
      return () => frame.removeEventListener('error', fail)
    },
    [setPhase]
  )

  const note = block.note?.trim()
  return (
    <section
      data-interactive="stock"
      data-state={phase}
      data-testid={TEST_IDS.chat.richBlocks.stock}
      className="bg-card text-card-foreground overflow-hidden rounded-2xl border"
    >
      {phase === 'failed' ? (
        <div
          data-testid={TEST_IDS.chat.richBlocks.stockFallback}
          className="flex flex-col gap-1 px-4 pt-4"
        >
          <p className="text-sm font-semibold">{block.symbol}</p>
          <p className="text-muted-foreground text-sm">
            {t('richBlocks.chartUnavailable')}
          </p>
        </div>
      ) : (
        <iframe
          data-testid={TEST_IDS.chat.richBlocks.stockFrame}
          key={src}
          ref={frameRef}
          src={src}
          title={block.symbol}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          height={STOCK_CHART_HEIGHT}
          // The widget's page declares no color-scheme. A frame whose own
          // (dark, inherited) differs from its page's gets an opaque white
          // canvas, so the dark chart, drawn transparent, lands on white.
          className="block w-full border-0 [color-scheme:light]"
          onLoad={() => setPhase('loaded')}
        />
      )}
      {note && <p className="px-4 pt-3 text-sm leading-6">{note}</p>}
      <footer className="text-muted-foreground flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
        <span>{t('richBlocks.chartBy')}</span>
        <a
          href={tradingViewSymbolPageUrl(block.symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {t('richBlocks.openOnTradingView')}
        </a>
      </footer>
    </section>
  )
}
