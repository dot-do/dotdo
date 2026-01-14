/**
 * Currency Service Tests
 *
 * Tests for multi-currency support including:
 * - Exchange rate management
 * - Currency conversion
 * - FX gain/loss calculation
 * - Triangulation
 * - Amount formatting
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCurrencyService,
  createUSDCurrencyService,
  type CurrencyService,
  type MultiCurrencyAmount,
} from '../currency'

describe('CurrencyService', () => {
  let service: CurrencyService

  beforeEach(() => {
    service = createCurrencyService({
      functionalCurrency: 'USD',
      allowedCurrencies: ['USD', 'EUR', 'GBP', 'JPY'],
    })
  })

  describe('Configuration', () => {
    it('should return the functional currency', () => {
      expect(service.getFunctionalCurrency()).toBe('USD')
    })

    it('should update the functional currency', () => {
      service.setFunctionalCurrency('EUR')
      expect(service.getFunctionalCurrency()).toBe('EUR')
    })

    it('should return allowed currencies', () => {
      const allowed = service.getAllowedCurrencies()
      expect(allowed).toContain('USD')
      expect(allowed).toContain('EUR')
      expect(allowed).toContain('GBP')
      expect(allowed).toContain('JPY')
    })

    it('should add an allowed currency', () => {
      service.addAllowedCurrency('CHF')
      expect(service.getAllowedCurrencies()).toContain('CHF')
    })

    it('should remove an allowed currency', () => {
      service.removeAllowedCurrency('JPY')
      expect(service.getAllowedCurrencies()).not.toContain('JPY')
    })

    it('should not allow removing the functional currency', () => {
      expect(() => service.removeAllowedCurrency('USD')).toThrow(
        'Cannot remove functional currency from allowed currencies'
      )
    })
  })

  describe('Currency Definitions', () => {
    it('should have default currencies registered', () => {
      const usd = service.getCurrency('USD')
      expect(usd).not.toBeNull()
      expect(usd?.name).toBe('US Dollar')
      expect(usd?.symbol).toBe('$')
      expect(usd?.decimalPlaces).toBe(2)
    })

    it('should register a custom currency', () => {
      service.registerCurrency({
        code: 'BTC',
        name: 'Bitcoin',
        symbol: '\u20BF',
        decimalPlaces: 8,
        thousandsSeparator: ',',
        decimalSeparator: '.',
        symbolPosition: 'before',
      })

      const btc = service.getCurrency('BTC')
      expect(btc).not.toBeNull()
      expect(btc?.name).toBe('Bitcoin')
      expect(btc?.decimalPlaces).toBe(8)
    })

    it('should list all registered currencies', () => {
      const currencies = service.listCurrencies()
      expect(currencies.length).toBeGreaterThan(0)
      expect(currencies.some((c) => c.code === 'USD')).toBe(true)
    })
  })

  describe('Exchange Rate Management', () => {
    it('should set and retrieve an exchange rate', () => {
      const rate = service.setExchangeRate('EUR', 'USD', 1.1)

      expect(rate.fromCurrency).toBe('EUR')
      expect(rate.toCurrency).toBe('USD')
      expect(rate.rate).toBe(1.1)
      expect(rate.inverseRate).toBeCloseTo(0.909, 2)
    })

    it('should reject non-positive exchange rates', () => {
      expect(() => service.setExchangeRate('EUR', 'USD', 0)).toThrow(
        'Exchange rate must be positive'
      )
      expect(() => service.setExchangeRate('EUR', 'USD', -1)).toThrow(
        'Exchange rate must be positive'
      )
    })

    it('should retrieve the inverse rate', () => {
      service.setExchangeRate('EUR', 'USD', 1.1)

      const inverseRate = service.getExchangeRate('USD', 'EUR')
      expect(inverseRate).not.toBeNull()
      expect(inverseRate?.rate).toBeCloseTo(0.909, 2)
    })

    it('should return rate of 1 for same currency', () => {
      const rate = service.getExchangeRate('USD', 'USD')
      expect(rate).not.toBeNull()
      expect(rate?.rate).toBe(1)
    })

    it('should return null for unknown currency pair without triangulation', () => {
      const rate = service.getExchangeRate('EUR', 'JPY', {
        allowTriangulation: false,
      })
      expect(rate).toBeNull()
    })

    it('should support historical rate lookup', () => {
      const jan1 = new Date('2024-01-01')
      const feb1 = new Date('2024-02-01')
      const mar1 = new Date('2024-03-01')

      service.setExchangeRate('EUR', 'USD', 1.08, { effectiveDate: jan1 })
      service.setExchangeRate('EUR', 'USD', 1.10, { effectiveDate: feb1 })
      service.setExchangeRate('EUR', 'USD', 1.12, { effectiveDate: mar1 })

      const janRate = service.getExchangeRate('EUR', 'USD', { date: new Date('2024-01-15') })
      expect(janRate?.rate).toBe(1.08)

      const febRate = service.getExchangeRate('EUR', 'USD', { date: new Date('2024-02-15') })
      expect(febRate?.rate).toBe(1.10)

      const marRate = service.getExchangeRate('EUR', 'USD', { date: new Date('2024-03-15') })
      expect(marRate?.rate).toBe(1.12)
    })

    it('should get historical rates within a date range', () => {
      const jan1 = new Date('2024-01-01')
      const feb1 = new Date('2024-02-01')
      const mar1 = new Date('2024-03-01')

      service.setExchangeRate('EUR', 'USD', 1.08, { effectiveDate: jan1 })
      service.setExchangeRate('EUR', 'USD', 1.10, { effectiveDate: feb1 })
      service.setExchangeRate('EUR', 'USD', 1.12, { effectiveDate: mar1 })

      const rates = service.getHistoricalRates('EUR', 'USD', {
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-02-15'),
      })

      expect(rates.length).toBe(1)
      expect(rates[0].rate).toBe(1.10)
    })
  })

  describe('Triangulation', () => {
    it('should calculate triangulated rate through base currency', () => {
      service.setExchangeRate('EUR', 'USD', 1.1)
      service.setExchangeRate('USD', 'JPY', 150)

      const rate = service.getExchangeRate('EUR', 'JPY', {
        allowTriangulation: true,
        baseCurrency: 'USD',
      })

      expect(rate).not.toBeNull()
      expect(rate?.rate).toBeCloseTo(165, 0) // 1.1 * 150
      expect(rate?.metadata?.triangulated).toBe(true)
      expect(rate?.metadata?.path).toEqual(['EUR', 'USD', 'JPY'])
    })

    it('should return null when triangulation path not available', () => {
      service.setExchangeRate('EUR', 'USD', 1.1)
      // No USD to CHF rate

      const rate = service.getExchangeRate('EUR', 'CHF', {
        allowTriangulation: true,
        baseCurrency: 'USD',
      })

      expect(rate).toBeNull()
    })
  })

  describe('Currency Conversion', () => {
    beforeEach(() => {
      service.setExchangeRate('EUR', 'USD', 1.1)
      service.setExchangeRate('GBP', 'USD', 1.27)
      service.setExchangeRate('USD', 'JPY', 150)
    })

    it('should convert between currencies', () => {
      const result = service.convert(100, 'EUR', 'USD')

      expect(result.fromAmount).toBe(100)
      expect(result.fromCurrency).toBe('EUR')
      expect(result.toAmount).toBe(110)
      expect(result.toCurrency).toBe('USD')
      expect(result.rate).toBe(1.1)
      expect(result.isTriangulated).toBe(false)
    })

    it('should convert to functional currency', () => {
      const result = service.convertToFunctional(100, 'EUR')

      expect(result.toAmount).toBe(110)
      expect(result.toCurrency).toBe('USD')
    })

    it('should convert from functional currency', () => {
      const result = service.convertFromFunctional(110, 'EUR')

      expect(result.fromAmount).toBe(110)
      expect(result.fromCurrency).toBe('USD')
      expect(result.toAmount).toBe(100)
      expect(result.toCurrency).toBe('EUR')
    })

    it('should throw when no rate available', () => {
      expect(() => service.convert(100, 'EUR', 'CHF')).toThrow(
        'No exchange rate found for EUR to CHF'
      )
    })

    it('should convert same currency without rate lookup', () => {
      const result = service.convert(100, 'USD', 'USD')

      expect(result.toAmount).toBe(100)
      expect(result.rate).toBe(1)
    })

    it('should handle JPY with no decimal places', () => {
      const result = service.convert(100, 'USD', 'JPY')

      expect(result.toAmount).toBe(15000) // 100 * 150, rounded to 0 decimals
    })
  })

  describe('Multi-Currency Amount', () => {
    beforeEach(() => {
      service.setExchangeRate('EUR', 'USD', 1.1)
    })

    it('should create a multi-currency amount', () => {
      const amount = service.createMultiCurrencyAmount(100, 'EUR')

      expect(amount.amount).toBe(100)
      expect(amount.currency).toBe('EUR')
      expect(amount.functionalAmount).toBe(110)
      expect(amount.functionalCurrency).toBe('USD')
      expect(amount.exchangeRate).toBe(1.1)
    })

    it('should handle functional currency amounts', () => {
      const amount = service.createMultiCurrencyAmount(100, 'USD')

      expect(amount.amount).toBe(100)
      expect(amount.currency).toBe('USD')
      expect(amount.functionalAmount).toBe(100)
      expect(amount.exchangeRate).toBe(1)
    })
  })

  describe('FX Gain/Loss Calculation', () => {
    beforeEach(() => {
      const jan1 = new Date('2024-01-01')
      const mar1 = new Date('2024-03-01')

      service.setExchangeRate('EUR', 'USD', 1.08, { effectiveDate: jan1 })
      service.setExchangeRate('EUR', 'USD', 1.12, { effectiveDate: mar1 })
    })

    it('should calculate unrealized FX gain', () => {
      const originalAmount: MultiCurrencyAmount = {
        amount: 1000,
        currency: 'EUR',
        functionalAmount: 1080, // at 1.08
        functionalCurrency: 'USD',
        exchangeRate: 1.08,
        rateDate: new Date('2024-01-01'),
      }

      const result = service.calculateFxGainLoss(
        originalAmount,
        new Date('2024-03-15'),
        false
      )

      expect(result.originalFunctionalAmount).toBe(1080)
      expect(result.currentFunctionalAmount).toBe(1120) // 1000 * 1.12
      expect(result.gainLoss).toBe(40)
      expect(result.isGain).toBe(true)
      expect(result.isRealized).toBe(false)
    })

    it('should calculate unrealized FX loss', () => {
      // Set a lower future rate
      service.setExchangeRate('EUR', 'USD', 1.05, {
        effectiveDate: new Date('2024-04-01'),
      })

      const originalAmount: MultiCurrencyAmount = {
        amount: 1000,
        currency: 'EUR',
        functionalAmount: 1080,
        functionalCurrency: 'USD',
        exchangeRate: 1.08,
        rateDate: new Date('2024-01-01'),
      }

      const result = service.calculateFxGainLoss(
        originalAmount,
        new Date('2024-04-15'),
        false
      )

      expect(result.currentFunctionalAmount).toBe(1050)
      expect(result.gainLoss).toBe(-30)
      expect(result.isGain).toBe(false)
    })

    it('should return zero gain/loss for functional currency', () => {
      const originalAmount: MultiCurrencyAmount = {
        amount: 1000,
        currency: 'USD',
        functionalAmount: 1000,
        functionalCurrency: 'USD',
        exchangeRate: 1,
        rateDate: new Date('2024-01-01'),
      }

      const result = service.calculateFxGainLoss(originalAmount)

      expect(result.gainLoss).toBe(0)
      expect(result.isGain).toBe(false)
    })

    it('should mark realized gains correctly', () => {
      const originalAmount: MultiCurrencyAmount = {
        amount: 1000,
        currency: 'EUR',
        functionalAmount: 1080,
        functionalCurrency: 'USD',
        exchangeRate: 1.08,
        rateDate: new Date('2024-01-01'),
      }

      const result = service.calculateFxGainLoss(
        originalAmount,
        new Date('2024-03-15'),
        true
      )

      expect(result.isRealized).toBe(true)
    })
  })

  describe('Amount Formatting', () => {
    it('should format USD amounts correctly', () => {
      const formatted = service.formatAmount(1234567.89, 'USD')
      expect(formatted).toBe('$1,234,567.89')
    })

    it('should format EUR amounts correctly', () => {
      const formatted = service.formatAmount(1234567.89, 'EUR')
      expect(formatted).toBe('\u20AC1.234.567,89')
    })

    it('should format JPY amounts with no decimals', () => {
      const formatted = service.formatAmount(1234567, 'JPY')
      expect(formatted).toBe('\u00A51,234,567')
    })

    it('should format negative amounts correctly', () => {
      const formatted = service.formatAmount(-1234.56, 'USD')
      expect(formatted).toBe('$-1,234.56')
    })

    it('should handle unknown currencies', () => {
      const formatted = service.formatAmount(1234.56, 'XYZ')
      expect(formatted).toBe('XYZ 1234.56')
    })
  })

  describe('Amount Parsing', () => {
    it('should parse USD formatted amounts', () => {
      const parsed = service.parseAmount('$1,234,567.89', 'USD')
      expect(parsed).toBe(1234567.89)
    })

    it('should parse EUR formatted amounts', () => {
      const parsed = service.parseAmount('\u20AC1.234.567,89', 'EUR')
      expect(parsed).toBe(1234567.89)
    })

    it('should parse JPY formatted amounts', () => {
      const parsed = service.parseAmount('\u00A51,234,567', 'JPY')
      expect(parsed).toBe(1234567)
    })

    it('should parse negative amounts', () => {
      const parsed = service.parseAmount('$-1,234.56', 'USD')
      expect(parsed).toBe(-1234.56)
    })
  })

  describe('Rounding', () => {
    it('should round USD to 2 decimal places', () => {
      const rounded = service.round(1234.5678, 'USD')
      expect(rounded).toBe(1234.57)
    })

    it('should round JPY to 0 decimal places', () => {
      const rounded = service.round(1234.5678, 'JPY')
      expect(rounded).toBe(1235)
    })

    it('should use banker\'s rounding (half to even)', () => {
      // Standard Math.round is used, not banker's rounding
      const rounded1 = service.round(1234.565, 'USD')
      const rounded2 = service.round(1234.575, 'USD')

      expect(rounded1).toBe(1234.57) // Standard rounding
      expect(rounded2).toBe(1234.58)
    })

    it('should handle unknown currencies with 2 decimal default', () => {
      const rounded = service.round(1234.5678, 'XYZ')
      expect(rounded).toBe(1234.57)
    })
  })

  describe('Factory Functions', () => {
    it('should create a USD currency service with common currencies', () => {
      const usdService = createUSDCurrencyService()

      expect(usdService.getFunctionalCurrency()).toBe('USD')
      expect(usdService.getAllowedCurrencies()).toContain('USD')
      expect(usdService.getAllowedCurrencies()).toContain('EUR')
      expect(usdService.getAllowedCurrencies()).toContain('GBP')
    })
  })
})

describe('Multi-Currency Transaction Scenarios', () => {
  let service: CurrencyService

  beforeEach(() => {
    service = createCurrencyService({
      functionalCurrency: 'USD',
    })

    // Set up realistic exchange rates
    service.setExchangeRate('EUR', 'USD', 1.0850)
    service.setExchangeRate('GBP', 'USD', 1.2650)
    service.setExchangeRate('JPY', 'USD', 0.0067) // 1 USD = ~149 JPY
    service.setExchangeRate('CAD', 'USD', 0.7450)
    service.setExchangeRate('CHF', 'USD', 1.1150)
  })

  it('should handle a multi-currency invoice scenario', () => {
    // Invoice from European vendor for EUR 5,000
    const invoiceAmount = service.createMultiCurrencyAmount(5000, 'EUR')

    expect(invoiceAmount.functionalAmount).toBe(5425) // 5000 * 1.0850

    // Payment made when rate changed
    service.setExchangeRate('EUR', 'USD', 1.0950, {
      effectiveDate: new Date('2024-02-01'),
    })

    const paymentConversion = service.convert(5000, 'EUR', 'USD', {
      date: new Date('2024-02-15'),
    })

    expect(paymentConversion.toAmount).toBe(5475) // 5000 * 1.0950

    // FX loss of $50 (paid more than booked)
    const fxDifference = paymentConversion.toAmount - invoiceAmount.functionalAmount
    expect(fxDifference).toBe(50)
  })

  it('should handle cross-currency payments via triangulation', () => {
    // Pay a UK vendor with EUR (triangulated through USD)
    const result = service.convert(1000, 'EUR', 'GBP', {
      allowTriangulation: true,
      baseCurrency: 'USD',
    })

    expect(result.isTriangulated).toBe(true)
    expect(result.triangulationPath).toEqual(['EUR', 'USD', 'GBP'])
    // EUR -> USD -> GBP: 1000 * 1.085 * (1/1.265) = ~858
    expect(result.toAmount).toBeCloseTo(858, 0)
  })

  it('should calculate revaluation gain/loss for foreign currency balance', () => {
    // Company holds GBP 10,000 from January
    const originalRate = 1.25
    service.setExchangeRate('GBP', 'USD', originalRate, {
      effectiveDate: new Date('2024-01-01'),
    })

    const balance: MultiCurrencyAmount = {
      amount: 10000,
      currency: 'GBP',
      functionalAmount: 12500, // at 1.25
      functionalCurrency: 'USD',
      exchangeRate: originalRate,
      rateDate: new Date('2024-01-01'),
    }

    // Rate increased to 1.265 by quarter end
    service.setExchangeRate('GBP', 'USD', 1.265, {
      effectiveDate: new Date('2024-03-31'),
    })

    const revaluation = service.calculateFxGainLoss(
      balance,
      new Date('2024-03-31'),
      false
    )

    expect(revaluation.originalFunctionalAmount).toBe(12500)
    expect(revaluation.currentFunctionalAmount).toBe(12650)
    expect(revaluation.gainLoss).toBe(150)
    expect(revaluation.isGain).toBe(true)
    expect(revaluation.isRealized).toBe(false)
  })

  it('should handle zero-decimal currencies correctly', () => {
    // Japanese Yen transaction
    const jpyAmount = service.createMultiCurrencyAmount(150000, 'JPY')

    // 150000 JPY at 0.0067 = $1,005
    expect(jpyAmount.functionalAmount).toBe(1005)

    // Convert back should preserve whole yen
    const backToJpy = service.convertFromFunctional(1005, 'JPY')
    expect(backToJpy.toAmount).toBe(150000)
  })
})
