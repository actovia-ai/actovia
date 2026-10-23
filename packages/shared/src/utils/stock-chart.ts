// TradingView's Symbol Overview (`symbol-overview`: the price, its change and
// market status over an area chart, with range tabs from a day to all of it)
// as the URL its loader script would put in an iframe, built here so no
// script of theirs runs in our documents (actovia-ios spec 2026-10-07 §2.3).
// Until 2026-10-21 it was the Mini Chart, a bare line. actovia-ios's
// `StockChart` builds the same bytes, held to the same vectors.
import type { StockRange } from '../types/interactive'

export const STOCK_CHART_HEIGHT = 380
export const TRADINGVIEW_EMBED_ORIGIN = 'https://www.tradingview-widget.com'
const EMBED_PATH = '/embed-widget/symbol-overview/'

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
  ru: 'ru',
  'zh-Hans': 'zh_CN',
  'zh-Hant-TW': 'zh_TW',
  'zh-Hant-HK': 'zh_TW',
  zh: 'zh_CN'
}

export function tradingViewLocale(locale: string): string {
  return TV_LOCALES[locale] ?? TV_LOCALES[locale.split('-')[0] ?? ''] ?? 'en'
}

/** The range tabs under the chart, each `label|interval`, as TradingView's own Symbol Overview offers them. */
export const STOCK_DATE_RANGES = [
  '1d|1',
  '1m|30',
  '3m|60',
  '12m|1D',
  '60m|1W',
  'all|1M'
] as const

/**
 * The embed URL: `locale` in the query, the settings JSON percent-encoded in
 * the hash — the loader's own wire. The range the model picked is the tab the
 * chart opens on (`symbol|range`). Key order is the settings' order here, so
 * the phone writes the same string.
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
    symbols: [[symbol.split(':').pop() ?? symbol, `${symbol}|${range}`]],
    chartOnly: false,
    width: '100%',
    height: STOCK_CHART_HEIGHT,
    colorTheme: theme,
    isTransparent: true,
    autosize: false,
    showVolume: false,
    showMA: false,
    hideDateRanges: false,
    hideMarketStatus: false,
    hideSymbolLogo: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    fontSize: '10',
    noTimeScale: false,
    valuesTracking: '1',
    changeMode: 'price-and-percent',
    chartType: 'area',
    lineWidth: 2,
    lineType: 0,
    dateRanges: STOCK_DATE_RANGES
  }
  const query = new URLSearchParams({ locale: tradingViewLocale(locale) })
  return `${TRADINGVIEW_EMBED_ORIGIN}${EMBED_PATH}?${query.toString()}#${encodeURIComponent(JSON.stringify(settings))}`
}

/** The symbol's own page on TradingView: "Open on TradingView", and where a tap on the chart goes. */
export function tradingViewSymbolPageUrl(symbol: string): string {
  return `https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`
}
