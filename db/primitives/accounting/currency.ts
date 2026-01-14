/**
 * Multi-Currency Support - Exchange Rates and Currency Conversion
 *
 * Implements:
 * - Exchange rate management with historical rates
 * - Currency conversion with proper rounding
 * - Functional currency (base currency) handling
 * - Rate sources (manual, API, bank)
 * - Cross-rate calculation
 * - Triangulation through base currency
 * - Rate caching with TTL
 * - Gain/loss calculation for realized/unrealized FX
 *
 * @module db/primitives/accounting/currency
 */

// =============================================================================
// Types
// =============================================================================

/**
 * ISO 4217 currency code
 */
export type CurrencyCode = string

/**
 * Source of exchange rate
 */
export type RateSource = 'manual' | 'api' | 'bank' | 'ecb' | 'fed'

/**
 * Exchange rate with metadata
 */
export interface ExchangeRate {
  id: string
  fromCurrency: CurrencyCode
  toCurrency: CurrencyCode
  rate: number
  inverseRate: number
  effectiveDate: Date
  expiresAt?: Date
  source: RateSource
  metadata?: Record<string, unknown>
  createdAt: Date
}

/**
 * Currency definition with display properties
 */
export interface Currency {
  code: CurrencyCode
  name: string
  symbol: string
  decimalPlaces: number
  thousandsSeparator: string
  decimalSeparator: string
  symbolPosition: 'before' | 'after'
}

/**
 * Currency conversion result
 */
export interface ConversionResult {
  fromAmount: number
  fromCurrency: CurrencyCode
  toAmount: number
  toCurrency: CurrencyCode
  rate: number
  rateDate: Date
  rateSource: RateSource
  isTriangulated: boolean
  triangulationPath?: CurrencyCode[]
}

/**
 * Foreign exchange gain/loss calculation
 */
export interface FxGainLoss {
  originalAmount: number
  originalCurrency: CurrencyCode
  originalRate: number
  originalFunctionalAmount: number
  currentRate: number
  currentFunctionalAmount: number
  gainLoss: number
  isGain: boolean
  isRealized: boolean
  calculatedAt: Date
}

/**
 * Multi-currency amount representation
 */
export interface MultiCurrencyAmount {
  amount: number
  currency: CurrencyCode
  functionalAmount: number
  functionalCurrency: CurrencyCode
  exchangeRate: number
  rateDate: Date
}

/**
 * Rate lookup options
 */
export interface RateLookupOptions {
  date?: Date
  source?: RateSource
  allowTriangulation?: boolean
  baseCurrency?: CurrencyCode
}

/**
 * Currency service configuration
 */
export interface CurrencyServiceConfig {
  functionalCurrency: CurrencyCode
  allowedCurrencies?: CurrencyCode[]
  rateCacheTTLMs?: number
  defaultRateSource?: RateSource
  triangulationCurrency?: CurrencyCode
}

/**
 * Currency service interface
 */
export interface CurrencyService {
  // Configuration
  getFunctionalCurrency(): CurrencyCode
  setFunctionalCurrency(currency: CurrencyCode): void
  getAllowedCurrencies(): CurrencyCode[]
  addAllowedCurrency(currency: CurrencyCode): void
  removeAllowedCurrency(currency: CurrencyCode): void

  // Currency Definitions
  registerCurrency(currency: Currency): void
  getCurrency(code: CurrencyCode): Currency | null
  listCurrencies(): Currency[]

  // Exchange Rate Management
  setExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: {
      effectiveDate?: Date
      expiresAt?: Date
      source?: RateSource
      metadata?: Record<string, unknown>
    }
  ): ExchangeRate

  getExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ExchangeRate | null

  getHistoricalRates(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options: {
      startDate: Date
      endDate: Date
    }
  ): ExchangeRate[]

  // Conversion
  convert(
    amount: number,
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult

  convertToFunctional(
    amount: number,
    currency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult

  convertFromFunctional(
    functionalAmount: number,
    targetCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult

  // Multi-Currency Amount
  createMultiCurrencyAmount(
    amount: number,
    currency: CurrencyCode,
    options?: RateLookupOptions
  ): MultiCurrencyAmount

  // FX Gain/Loss
  calculateFxGainLoss(
    originalAmount: MultiCurrencyAmount,
    currentDate?: Date,
    isRealized?: boolean
  ): FxGainLoss

  // Formatting
  formatAmount(amount: number, currency: CurrencyCode): string
  parseAmount(formattedAmount: string, currency: CurrencyCode): number

  // Rounding
  round(amount: number, currency: CurrencyCode): number
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

/**
 * Default currencies with standard properties
 */
const DEFAULT_CURRENCIES: Currency[] = [
  {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'EUR',
    name: 'Euro',
    symbol: '\u20AC',
    decimalPlaces: 2,
    thousandsSeparator: '.',
    decimalSeparator: ',',
    symbolPosition: 'before',
  },
  {
    code: 'GBP',
    name: 'British Pound',
    symbol: '\u00A3',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'JPY',
    name: 'Japanese Yen',
    symbol: '\u00A5',
    decimalPlaces: 0,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'CHF',
    name: 'Swiss Franc',
    symbol: 'CHF',
    decimalPlaces: 2,
    thousandsSeparator: "'",
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'C$',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: 'A$',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'CNY',
    name: 'Chinese Yuan',
    symbol: '\u00A5',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'INR',
    name: 'Indian Rupee',
    symbol: '\u20B9',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'MXN',
    name: 'Mexican Peso',
    symbol: '$',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
  {
    code: 'BRL',
    name: 'Brazilian Real',
    symbol: 'R$',
    decimalPlaces: 2,
    thousandsSeparator: '.',
    decimalSeparator: ',',
    symbolPosition: 'before',
  },
  {
    code: 'KRW',
    name: 'South Korean Won',
    symbol: '\u20A9',
    decimalPlaces: 0,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    symbolPosition: 'before',
  },
]

// =============================================================================
// Implementation
// =============================================================================

class CurrencyServiceImpl implements CurrencyService {
  private functionalCurrency: CurrencyCode
  private allowedCurrencies: Set<CurrencyCode>
  private currencies: Map<CurrencyCode, Currency> = new Map()
  private exchangeRates: Map<string, ExchangeRate[]> = new Map()
  private rateCacheTTLMs: number
  private defaultRateSource: RateSource
  private triangulationCurrency: CurrencyCode

  constructor(config: CurrencyServiceConfig) {
    this.functionalCurrency = config.functionalCurrency
    this.allowedCurrencies = new Set(config.allowedCurrencies ?? [config.functionalCurrency])
    this.rateCacheTTLMs = config.rateCacheTTLMs ?? 3600000 // 1 hour default
    this.defaultRateSource = config.defaultRateSource ?? 'manual'
    this.triangulationCurrency = config.triangulationCurrency ?? 'USD'

    // Register default currencies
    for (const currency of DEFAULT_CURRENCIES) {
      this.currencies.set(currency.code, currency)
    }
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  getFunctionalCurrency(): CurrencyCode {
    return this.functionalCurrency
  }

  setFunctionalCurrency(currency: CurrencyCode): void {
    this.functionalCurrency = currency
    this.allowedCurrencies.add(currency)
  }

  getAllowedCurrencies(): CurrencyCode[] {
    return Array.from(this.allowedCurrencies)
  }

  addAllowedCurrency(currency: CurrencyCode): void {
    this.allowedCurrencies.add(currency)
  }

  removeAllowedCurrency(currency: CurrencyCode): void {
    if (currency === this.functionalCurrency) {
      throw new Error('Cannot remove functional currency from allowed currencies')
    }
    this.allowedCurrencies.delete(currency)
  }

  // =============================================================================
  // Currency Definitions
  // =============================================================================

  registerCurrency(currency: Currency): void {
    this.currencies.set(currency.code, currency)
  }

  getCurrency(code: CurrencyCode): Currency | null {
    return this.currencies.get(code) ?? null
  }

  listCurrencies(): Currency[] {
    return Array.from(this.currencies.values())
  }

  // =============================================================================
  // Exchange Rate Management
  // =============================================================================

  private getRateKey(fromCurrency: CurrencyCode, toCurrency: CurrencyCode): string {
    return `${fromCurrency}:${toCurrency}`
  }

  setExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: {
      effectiveDate?: Date
      expiresAt?: Date
      source?: RateSource
      metadata?: Record<string, unknown>
    }
  ): ExchangeRate {
    if (rate <= 0) {
      throw new Error('Exchange rate must be positive')
    }

    const now = new Date()
    const effectiveDate = options?.effectiveDate ?? now

    const exchangeRate: ExchangeRate = {
      id: generateId('rate'),
      fromCurrency,
      toCurrency,
      rate,
      inverseRate: 1 / rate,
      effectiveDate,
      expiresAt: options?.expiresAt,
      source: options?.source ?? this.defaultRateSource,
      metadata: options?.metadata,
      createdAt: now,
    }

    // Store the rate
    const key = this.getRateKey(fromCurrency, toCurrency)
    const rates = this.exchangeRates.get(key) ?? []
    rates.push(exchangeRate)
    // Sort by effective date descending (most recent first)
    rates.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())
    this.exchangeRates.set(key, rates)

    // Also store the inverse rate for reverse lookups
    const inverseKey = this.getRateKey(toCurrency, fromCurrency)
    const inverseRates = this.exchangeRates.get(inverseKey) ?? []
    const inverseExchangeRate: ExchangeRate = {
      ...exchangeRate,
      id: generateId('rate'),
      fromCurrency: toCurrency,
      toCurrency: fromCurrency,
      rate: exchangeRate.inverseRate,
      inverseRate: rate,
    }
    inverseRates.push(inverseExchangeRate)
    inverseRates.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())
    this.exchangeRates.set(inverseKey, inverseRates)

    return exchangeRate
  }

  getExchangeRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ExchangeRate | null {
    // Same currency - rate is 1
    if (fromCurrency === toCurrency) {
      return {
        id: 'identity',
        fromCurrency,
        toCurrency,
        rate: 1,
        inverseRate: 1,
        effectiveDate: options?.date ?? new Date(),
        source: 'manual',
        createdAt: new Date(),
      }
    }

    const key = this.getRateKey(fromCurrency, toCurrency)
    const rates = this.exchangeRates.get(key)

    if (!rates || rates.length === 0) {
      // Try triangulation if allowed
      if (options?.allowTriangulation !== false) {
        return this.getTriangulatedRate(fromCurrency, toCurrency, options)
      }
      return null
    }

    const lookupDate = options?.date ?? new Date()
    const lookupTime = lookupDate.getTime()

    // Find the rate effective on the lookup date
    for (const rate of rates) {
      const effectiveTime = rate.effectiveDate.getTime()
      const expiresTime = rate.expiresAt?.getTime() ?? Infinity

      if (effectiveTime <= lookupTime && lookupTime < expiresTime) {
        // Filter by source if specified
        if (options?.source && rate.source !== options.source) {
          continue
        }
        return rate
      }
    }

    // If no rate found for the specific date, try triangulation
    if (options?.allowTriangulation !== false) {
      return this.getTriangulatedRate(fromCurrency, toCurrency, options)
    }

    return null
  }

  private getTriangulatedRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ExchangeRate | null {
    const baseCurrency = options?.baseCurrency ?? this.triangulationCurrency

    // Try to find rates through the base currency
    const fromToBase = this.getExchangeRate(fromCurrency, baseCurrency, {
      ...options,
      allowTriangulation: false,
    })
    const baseToTarget = this.getExchangeRate(baseCurrency, toCurrency, {
      ...options,
      allowTriangulation: false,
    })

    if (!fromToBase || !baseToTarget) {
      return null
    }

    // Calculate the triangulated rate
    const triangulatedRate = fromToBase.rate * baseToTarget.rate
    const now = new Date()

    return {
      id: generateId('tri_rate'),
      fromCurrency,
      toCurrency,
      rate: triangulatedRate,
      inverseRate: 1 / triangulatedRate,
      effectiveDate: options?.date ?? now,
      source: 'manual',
      metadata: {
        triangulated: true,
        path: [fromCurrency, baseCurrency, toCurrency],
        fromRate: fromToBase.rate,
        toRate: baseToTarget.rate,
      },
      createdAt: now,
    }
  }

  getHistoricalRates(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options: {
      startDate: Date
      endDate: Date
    }
  ): ExchangeRate[] {
    const key = this.getRateKey(fromCurrency, toCurrency)
    const rates = this.exchangeRates.get(key) ?? []

    const startTime = options.startDate.getTime()
    const endTime = options.endDate.getTime()

    return rates.filter((rate) => {
      const effectiveTime = rate.effectiveDate.getTime()
      return effectiveTime >= startTime && effectiveTime <= endTime
    })
  }

  // =============================================================================
  // Conversion
  // =============================================================================

  convert(
    amount: number,
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult {
    const rate = this.getExchangeRate(fromCurrency, toCurrency, options)

    if (!rate) {
      throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency}`)
    }

    const convertedAmount = this.round(amount * rate.rate, toCurrency)
    const isTriangulated = !!(rate.metadata?.triangulated)

    return {
      fromAmount: amount,
      fromCurrency,
      toAmount: convertedAmount,
      toCurrency,
      rate: rate.rate,
      rateDate: rate.effectiveDate,
      rateSource: rate.source,
      isTriangulated,
      triangulationPath: isTriangulated
        ? (rate.metadata?.path as CurrencyCode[])
        : undefined,
    }
  }

  convertToFunctional(
    amount: number,
    currency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult {
    return this.convert(amount, currency, this.functionalCurrency, options)
  }

  convertFromFunctional(
    functionalAmount: number,
    targetCurrency: CurrencyCode,
    options?: RateLookupOptions
  ): ConversionResult {
    return this.convert(functionalAmount, this.functionalCurrency, targetCurrency, options)
  }

  // =============================================================================
  // Multi-Currency Amount
  // =============================================================================

  createMultiCurrencyAmount(
    amount: number,
    currency: CurrencyCode,
    options?: RateLookupOptions
  ): MultiCurrencyAmount {
    if (currency === this.functionalCurrency) {
      return {
        amount,
        currency,
        functionalAmount: amount,
        functionalCurrency: this.functionalCurrency,
        exchangeRate: 1,
        rateDate: options?.date ?? new Date(),
      }
    }

    const conversion = this.convertToFunctional(amount, currency, options)

    return {
      amount,
      currency,
      functionalAmount: conversion.toAmount,
      functionalCurrency: this.functionalCurrency,
      exchangeRate: conversion.rate,
      rateDate: conversion.rateDate,
    }
  }

  // =============================================================================
  // FX Gain/Loss
  // =============================================================================

  calculateFxGainLoss(
    originalAmount: MultiCurrencyAmount,
    currentDate?: Date,
    isRealized: boolean = false
  ): FxGainLoss {
    // If already in functional currency, no FX gain/loss
    if (originalAmount.currency === this.functionalCurrency) {
      return {
        originalAmount: originalAmount.amount,
        originalCurrency: originalAmount.currency,
        originalRate: 1,
        originalFunctionalAmount: originalAmount.amount,
        currentRate: 1,
        currentFunctionalAmount: originalAmount.amount,
        gainLoss: 0,
        isGain: false,
        isRealized,
        calculatedAt: new Date(),
      }
    }

    const currentRate = this.getExchangeRate(
      originalAmount.currency,
      this.functionalCurrency,
      { date: currentDate }
    )

    if (!currentRate) {
      throw new Error(
        `No current exchange rate found for ${originalAmount.currency} to ${this.functionalCurrency}`
      )
    }

    const currentFunctionalAmount = this.round(
      originalAmount.amount * currentRate.rate,
      this.functionalCurrency
    )
    const gainLoss = currentFunctionalAmount - originalAmount.functionalAmount

    return {
      originalAmount: originalAmount.amount,
      originalCurrency: originalAmount.currency,
      originalRate: originalAmount.exchangeRate,
      originalFunctionalAmount: originalAmount.functionalAmount,
      currentRate: currentRate.rate,
      currentFunctionalAmount,
      gainLoss,
      isGain: gainLoss > 0,
      isRealized,
      calculatedAt: new Date(),
    }
  }

  // =============================================================================
  // Formatting
  // =============================================================================

  formatAmount(amount: number, currencyCode: CurrencyCode): string {
    const currency = this.getCurrency(currencyCode)

    if (!currency) {
      // Default formatting if currency not found
      return `${currencyCode} ${amount.toFixed(2)}`
    }

    const roundedAmount = this.round(amount, currencyCode)
    const absoluteAmount = Math.abs(roundedAmount)

    // Format the number with proper separators
    const parts = absoluteAmount.toFixed(currency.decimalPlaces).split('.')
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, currency.thousandsSeparator)
    const decimalPart = parts[1] ?? ''

    let formatted = currency.decimalPlaces > 0
      ? `${integerPart}${currency.decimalSeparator}${decimalPart}`
      : integerPart

    // Add sign for negative amounts
    if (roundedAmount < 0) {
      formatted = `-${formatted}`
    }

    // Add symbol
    if (currency.symbolPosition === 'before') {
      return `${currency.symbol}${formatted}`
    } else {
      return `${formatted} ${currency.symbol}`
    }
  }

  parseAmount(formattedAmount: string, currencyCode: CurrencyCode): number {
    const currency = this.getCurrency(currencyCode)

    if (!currency) {
      // Default parsing if currency not found
      const cleaned = formattedAmount.replace(/[^0-9.-]/g, '')
      return parseFloat(cleaned)
    }

    // Remove currency symbol
    let cleaned = formattedAmount.replace(currency.symbol, '').trim()

    // Remove thousands separators
    cleaned = cleaned.split(currency.thousandsSeparator).join('')

    // Replace decimal separator with standard '.'
    cleaned = cleaned.replace(currency.decimalSeparator, '.')

    // Remove any remaining non-numeric characters except - and .
    cleaned = cleaned.replace(/[^0-9.-]/g, '')

    return parseFloat(cleaned)
  }

  // =============================================================================
  // Rounding
  // =============================================================================

  round(amount: number, currencyCode: CurrencyCode): number {
    const currency = this.getCurrency(currencyCode)
    const decimalPlaces = currency?.decimalPlaces ?? 2

    const multiplier = Math.pow(10, decimalPlaces)
    return Math.round(amount * multiplier) / multiplier
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new CurrencyService instance
 */
export function createCurrencyService(config: CurrencyServiceConfig): CurrencyService {
  return new CurrencyServiceImpl(config)
}

/**
 * Create a CurrencyService with USD as functional currency (common default)
 */
export function createUSDCurrencyService(): CurrencyService {
  return createCurrencyService({
    functionalCurrency: 'USD',
    allowedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'],
  })
}
