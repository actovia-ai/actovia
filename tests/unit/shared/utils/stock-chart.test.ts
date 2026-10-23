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
  it('is the symbol-overview embed: the locale in the query, the settings in the hash, the picked range its first tab', () => {
    const url = new URL(
      tradingViewEmbedUrl({
        symbol: 'NASDAQ:AAPL',
        range: '1D',
        theme: 'dark',
        locale: 'en'
      })
    )
    expect(url.origin).toBe('https://www.tradingview-widget.com')
    expect(url.pathname).toBe('/embed-widget/symbol-overview/')
    expect([...url.searchParams.keys()]).toEqual(['locale'])
    expect(url.searchParams.get('locale')).toBe('en')
    const settings = JSON.parse(decodeURIComponent(url.hash.slice(1)))
    expect(settings).toMatchObject({
      symbols: [['AAPL', 'NASDAQ:AAPL|1D']],
      chartOnly: false,
      height: STOCK_CHART_HEIGHT,
      colorTheme: 'dark',
      isTransparent: true,
      chartType: 'area',
      dateRanges: ['1d|1', '1m|30', '3m|60', '12m|1D', '60m|1W', 'all|1M']
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
      'https://www.tradingview-widget.com/embed-widget/symbol-overview/?locale=ja#%7B%22symbols%22%3A%5B%5B%227203%22%2C%22TSE%3A7203%7C12M%22%5D%5D%2C%22chartOnly%22%3Afalse%2C%22width%22%3A%22100%25%22%2C%22height%22%3A380%2C%22colorTheme%22%3A%22light%22%2C%22isTransparent%22%3Atrue%2C%22autosize%22%3Afalse%2C%22showVolume%22%3Afalse%2C%22showMA%22%3Afalse%2C%22hideDateRanges%22%3Afalse%2C%22hideMarketStatus%22%3Afalse%2C%22hideSymbolLogo%22%3Afalse%2C%22scalePosition%22%3A%22right%22%2C%22scaleMode%22%3A%22Normal%22%2C%22fontSize%22%3A%2210%22%2C%22noTimeScale%22%3Afalse%2C%22valuesTracking%22%3A%221%22%2C%22changeMode%22%3A%22price-and-percent%22%2C%22chartType%22%3A%22area%22%2C%22lineWidth%22%3A2%2C%22lineType%22%3A0%2C%22dateRanges%22%3A%5B%221d%7C1%22%2C%221m%7C30%22%2C%223m%7C60%22%2C%2212m%7C1D%22%2C%2260m%7C1W%22%2C%22all%7C1M%22%5D%7D'
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
    ['ru', 'ru'],
    ['zh-Hans', 'zh_CN'],
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
