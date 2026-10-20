// TradingView's Mini Chart (`mini-symbol-overview`) as the URL its loader
// script would put in an iframe, built here so no script of theirs runs in
// our documents (actovia-ios spec 2026-10-07 §2.3). actovia-ios's `StockChart`
// builds the same bytes, held to the same vectors.
import type { StockRange } from '../types/interactive'

export const STOCK_CHART_HEIGHT = 220
export const TRADINGVIEW_EMBED_ORIGIN = 'https://www.tradingview-widget.com'
const EMBED_PATH = '/embed-widget/mini-symbol-overview/'

/** The widget's locale codes for the app's: TradingView spells Korean `kr`, Brazilian Portuguese `br`, Chinese by script. */
const TV_LOCALES: Record<string, string> = {
  en: 'en',
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'kr',
  'pt-BR': 'br',
  'zh-Hant-TW': 'zh_TW',
  'zh-Hant-HK': 'zh_TW',
  zh: 'zh_CN'
}

export function tradingViewLocale(locale: string): string {
  return TV_LOCALES[locale] ?? TV_LOCALES[locale.split('-')[0] ?? ''] ?? 'en'
}

/**
 * The embed URL: `locale` and `symbol` in the query, the settings JSON
 * percent-encoded in the hash — the loader's own wire. Key order is the
 * settings' order here, so the phone writes the same string.
 */
export function tradingViewEmbedUrl({
  symbol,
  range,
  theme,
  locale
}: {
  symbol: string
  range: StockRange
  theme: 'light' | 'dark'
  locale: string
}): string {
  const settings = {
    symbol,
    dateRange: range,
    colorTheme: theme,
    isTransparent: true,
    width: '100%',
    height: STOCK_CHART_HEIGHT,
    autosize: false,
    largeChartUrl: ''
  }
  const query = new URLSearchParams({
    locale: tradingViewLocale(locale),
    symbol
  })
  return `${TRADINGVIEW_EMBED_ORIGIN}${EMBED_PATH}?${query.toString()}#${encodeURIComponent(JSON.stringify(settings))}`
}

/** The symbol's own page on TradingView: "Open on TradingView", and where a tap on the chart goes. */
export function tradingViewSymbolPageUrl(symbol: string): string {
  return `https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`
}
