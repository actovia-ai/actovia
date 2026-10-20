// The chart is TradingView's own embed URL in a frame: its settings travel in
// the hash, exactly as the widget's loader script would put them (verified
// 2026-10-07 to render alone). actovia-ios's StockChartTests holds the same
// vectors — keep them in step.
import {
  STOCK_CHART_HEIGHT,
  tradingViewEmbedUrl,
  tradingViewLocale,
  tradingViewSymbolPageUrl
} from '@actovia/shared/utils/stock-chart'
import { describe, expect, it } from 'vitest'

describe('tradingViewEmbedUrl', () => {
  it('is the mini-symbol-overview embed with the symbol and locale in the query and the settings in the hash', () => {
    const url = new URL(
      tradingViewEmbedUrl({
        symbol: 'NASDAQ:AAPL',
        range: '1D',
        theme: 'dark',
        locale: 'en'
      })
    )
    expect(url.origin).toBe('https://www.tradingview-widget.com')
    expect(url.pathname).toBe('/embed-widget/mini-symbol-overview/')
    expect(url.searchParams.get('locale')).toBe('en')
    expect(url.searchParams.get('symbol')).toBe('NASDAQ:AAPL')
    expect(JSON.parse(decodeURIComponent(url.hash.slice(1)))).toEqual({
      symbol: 'NASDAQ:AAPL',
      dateRange: '1D',
      colorTheme: 'dark',
      isTransparent: true,
      width: '100%',
      height: STOCK_CHART_HEIGHT,
      autosize: false,
      largeChartUrl: ''
    })
  })

  it('is byte-identical to the phone for the same input', () => {
    expect(
      tradingViewEmbedUrl({
        symbol: 'TSE:7203',
        range: '12M',
        theme: 'light',
        locale: 'ja'
      })
    ).toBe(
      'https://www.tradingview-widget.com/embed-widget/mini-symbol-overview/?locale=ja&symbol=TSE%3A7203#%7B%22symbol%22%3A%22TSE%3A7203%22%2C%22dateRange%22%3A%2212M%22%2C%22colorTheme%22%3A%22light%22%2C%22isTransparent%22%3Atrue%2C%22width%22%3A%22100%25%22%2C%22height%22%3A220%2C%22autosize%22%3Afalse%2C%22largeChartUrl%22%3A%22%22%7D'
    )
  })
})

describe('tradingViewLocale', () => {
  it.each([
    ['en', 'en'],
    ['de', 'de'],
    ['es', 'es'],
    ['fr', 'fr'],
    ['it', 'it'],
    ['ja', 'ja'],
    ['ko', 'kr'],
    ['pt-BR', 'br'],
    ['zh-Hant-TW', 'zh_TW'],
    ['zh-Hant-HK', 'zh_TW'],
    ['zh', 'zh_CN'],
    ['nl', 'en'],
    ['', 'en']
  ])('%s → %s', (locale, tv) => {
    expect(tradingViewLocale(locale)).toBe(tv)
  })
})

describe('tradingViewSymbolPageUrl', () => {
  it('is the symbol page, the colon a dash', () => {
    expect(tradingViewSymbolPageUrl('NASDAQ:AAPL')).toBe(
      'https://www.tradingview.com/symbols/NASDAQ-AAPL/'
    )
    expect(tradingViewSymbolPageUrl('TSE:7203.T-A')).toBe(
      'https://www.tradingview.com/symbols/TSE-7203.T-A/'
    )
  })
})
