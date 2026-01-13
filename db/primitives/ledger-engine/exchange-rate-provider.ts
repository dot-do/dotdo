/**
 * Exchange Rate Provider - Multi-source rate management with caching
 *
 * Implements:
 * - Multiple rate sources (manual, API, bank feeds)
 * - Rate caching with configurable TTL
 * - Historical rate storage and retrieval
 * - Rate update subscriptions
 * - Fallback chains for rate lookups
 * - Audit trail for rate changes
 *
 * @module db/primitives/ledger-engine/exchange-rate-provider
 */

import type { CurrencyCode, ExchangeRate, RateSource } from '../accounting/currency'

// =============================================================================
// Types
// =============================================================================

/**
 * Result of fetching a rate from an external source
 */
export interface RateFetchResult {
  success: boolean
  rate?: number
  source: RateSource
  timestamp: Date
  error?: string
}

/**
 * Rate update event
 */
export interface RateUpdate {
  fromCurrency: CurrencyCode
  toCurrency: CurrencyCode
  oldRate?: number
  newRate: number
  source: RateSource
  timestamp: Date
  metadata?: Record<string, unknown>
}

/**
 * Rate fetch function signature
 */
export type RateFetcher = (
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode
) => Promise<RateFetchResult>

/**
 * Rate update callback
 */
export type RateUpdateCallback = (update: RateUpdate) => void

/**
 * Configuration for the exchange rate provider
 */
export interface ExchangeRateProviderConfig {
  /** Default rate source to use */
  defaultSource?: RateSource
  /** Cache TTL in milliseconds (default: 1 hour) */
  cacheTTLMs?: number
  /** Whether to automatically fetch rates on cache miss */
  autoFetch?: boolean
  /** Fetchers by source */
  fetchers?: Map<RateSource, RateFetcher>
  /** Fallback source chain */
  fallbackChain?: RateSource[]
  /** Base currency for triangulation */
  triangulationCurrency?: CurrencyCode
}

/**
 * Historical rate query options
 */
export interface HistoricalRateQuery {
  fromCurrency: CurrencyCode
  toCurrency: CurrencyCode
  startDate: Date
  endDate: Date
  source?: RateSource
  granularity?: 'daily' | 'weekly' | 'monthly'
}

/**
 * Historical rate entry
 */
export interface HistoricalRateEntry {
  date: Date
  rate: number
  source: RateSource
  high?: number
  low?: number
  open?: number
  close?: number
}

/**
 * Exchange rate provider interface
 */
export interface ExchangeRateProvider {
  // Rate Management
  setRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: {
      source?: RateSource
      effectiveDate?: Date
      expiresAt?: Date
      metadata?: Record<string, unknown>
    }
  ): ExchangeRate

  getRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: {
      date?: Date
      source?: RateSource
      allowTriangulation?: boolean
    }
  ): ExchangeRate | null

  // Batch Rate Operations
  setRates(
    rates: Array<{
      fromCurrency: CurrencyCode
      toCurrency: CurrencyCode
      rate: number
      source?: RateSource
      effectiveDate?: Date
    }>
  ): ExchangeRate[]

  getRates(
    pairs: Array<{ from: CurrencyCode; to: CurrencyCode }>,
    options?: { date?: Date }
  ): Map<string, ExchangeRate | null>

  // Historical Rates
  getHistoricalRates(query: HistoricalRateQuery): HistoricalRateEntry[]

  storeHistoricalRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    date: Date,
    rate: number,
    source: RateSource
  ): void

  // Rate Fetching (for external sources)
  fetchRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    source?: RateSource
  ): Promise<RateFetchResult>

  registerFetcher(source: RateSource, fetcher: RateFetcher): void

  // Subscriptions
  subscribe(callback: RateUpdateCallback): () => void

  // Cache Management
  clearCache(): void
  getCacheStats(): {
    size: number
    hits: number
    misses: number
    hitRate: number
  }

  // Audit
  getAuditLog(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: {
      startDate?: Date
      endDate?: Date
      limit?: number
    }
  ): RateUpdate[]
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function getRateKey(fromCurrency: CurrencyCode, toCurrency: CurrencyCode): string {
  return `${fromCurrency}:${toCurrency}`
}

function normalizeDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// =============================================================================
// Implementation
// =============================================================================

interface CachedRate {
  rate: ExchangeRate
  fetchedAt: Date
  expiresAt: Date
}

class ExchangeRateProviderImpl implements ExchangeRateProvider {
  private config: Required<ExchangeRateProviderConfig>
  private currentRates: Map<string, ExchangeRate[]> = new Map()
  private historicalRates: Map<string, Map<string, HistoricalRateEntry>> = new Map()
  private cache: Map<string, CachedRate> = new Map()
  private fetchers: Map<RateSource, RateFetcher>
  private subscribers: Set<RateUpdateCallback> = new Set()
  private auditLog: Map<string, RateUpdate[]> = new Map()
  private cacheHits: number = 0
  private cacheMisses: number = 0

  constructor(config: ExchangeRateProviderConfig = {}) {
    this.config = {
      defaultSource: config.defaultSource ?? 'manual',
      cacheTTLMs: config.cacheTTLMs ?? 3600000, // 1 hour
      autoFetch: config.autoFetch ?? false,
      fetchers: config.fetchers ?? new Map(),
      fallbackChain: config.fallbackChain ?? ['manual', 'api', 'bank'],
      triangulationCurrency: config.triangulationCurrency ?? 'USD',
    }
    this.fetchers = new Map(this.config.fetchers)
  }

  // ===========================================================================
  // Rate Management
  // ===========================================================================

  setRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: number,
    options?: {
      source?: RateSource
      effectiveDate?: Date
      expiresAt?: Date
      metadata?: Record<string, unknown>
    }
  ): ExchangeRate {
    if (rate <= 0) {
      throw new Error('Exchange rate must be positive')
    }

    const now = new Date()
    const effectiveDate = options?.effectiveDate ?? now
    const source = options?.source ?? this.config.defaultSource

    const exchangeRate: ExchangeRate = {
      id: generateId('rate'),
      fromCurrency,
      toCurrency,
      rate,
      inverseRate: 1 / rate,
      effectiveDate,
      expiresAt: options?.expiresAt,
      source,
      metadata: options?.metadata,
      createdAt: now,
    }

    // Store the rate
    const key = getRateKey(fromCurrency, toCurrency)
    const rates = this.currentRates.get(key) ?? []

    // Get old rate for audit
    const oldRate = rates.length > 0 ? rates[0].rate : undefined

    rates.unshift(exchangeRate)
    // Keep only last 100 rates per pair
    if (rates.length > 100) {
      rates.pop()
    }
    this.currentRates.set(key, rates)

    // Also store inverse rate
    const inverseKey = getRateKey(toCurrency, fromCurrency)
    const inverseRates = this.currentRates.get(inverseKey) ?? []
    const inverseExchangeRate: ExchangeRate = {
      ...exchangeRate,
      id: generateId('rate'),
      fromCurrency: toCurrency,
      toCurrency: fromCurrency,
      rate: exchangeRate.inverseRate,
      inverseRate: rate,
    }
    inverseRates.unshift(inverseExchangeRate)
    if (inverseRates.length > 100) {
      inverseRates.pop()
    }
    this.currentRates.set(inverseKey, inverseRates)

    // Invalidate cache
    this.cache.delete(key)
    this.cache.delete(inverseKey)

    // Create audit entry
    const update: RateUpdate = {
      fromCurrency,
      toCurrency,
      oldRate,
      newRate: rate,
      source,
      timestamp: now,
      metadata: options?.metadata,
    }
    this.addAuditEntry(key, update)

    // Notify subscribers
    this.notifySubscribers(update)

    return exchangeRate
  }

  getRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: {
      date?: Date
      source?: RateSource
      allowTriangulation?: boolean
    }
  ): ExchangeRate | null {
    // Same currency
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

    const key = getRateKey(fromCurrency, toCurrency)
    const lookupDate = options?.date ?? new Date()

    // Check cache first (only for current date lookups)
    if (!options?.date) {
      const cached = this.cache.get(key)
      if (cached && cached.expiresAt > new Date()) {
        this.cacheHits++
        return cached.rate
      }
      this.cacheMisses++
    }

    // Look up rate
    const rates = this.currentRates.get(key)
    if (rates && rates.length > 0) {
      const lookupTime = lookupDate.getTime()

      for (const rate of rates) {
        const effectiveTime = rate.effectiveDate.getTime()
        const expiresTime = rate.expiresAt?.getTime() ?? Infinity

        if (effectiveTime <= lookupTime && lookupTime < expiresTime) {
          if (options?.source && rate.source !== options.source) {
            continue
          }

          // Cache the rate
          if (!options?.date) {
            this.cacheRate(key, rate)
          }

          return rate
        }
      }
    }

    // Try triangulation
    if (options?.allowTriangulation !== false) {
      const triangulated = this.getTriangulatedRate(fromCurrency, toCurrency, options)
      if (triangulated) {
        if (!options?.date) {
          this.cacheRate(key, triangulated)
        }
        return triangulated
      }
    }

    return null
  }

  private getTriangulatedRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: { date?: Date; source?: RateSource }
  ): ExchangeRate | null {
    const baseCurrency = this.config.triangulationCurrency

    if (fromCurrency === baseCurrency || toCurrency === baseCurrency) {
      return null
    }

    const fromToBase = this.getRate(fromCurrency, baseCurrency, {
      ...options,
      allowTriangulation: false,
    })
    const baseToTarget = this.getRate(baseCurrency, toCurrency, {
      ...options,
      allowTriangulation: false,
    })

    if (!fromToBase || !baseToTarget) {
      return null
    }

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

  private cacheRate(key: string, rate: ExchangeRate): void {
    this.cache.set(key, {
      rate,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTTLMs),
    })
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  setRates(
    rates: Array<{
      fromCurrency: CurrencyCode
      toCurrency: CurrencyCode
      rate: number
      source?: RateSource
      effectiveDate?: Date
    }>
  ): ExchangeRate[] {
    return rates.map((r) =>
      this.setRate(r.fromCurrency, r.toCurrency, r.rate, {
        source: r.source,
        effectiveDate: r.effectiveDate,
      })
    )
  }

  getRates(
    pairs: Array<{ from: CurrencyCode; to: CurrencyCode }>,
    options?: { date?: Date }
  ): Map<string, ExchangeRate | null> {
    const result = new Map<string, ExchangeRate | null>()

    for (const pair of pairs) {
      const key = getRateKey(pair.from, pair.to)
      const rate = this.getRate(pair.from, pair.to, options)
      result.set(key, rate)
    }

    return result
  }

  // ===========================================================================
  // Historical Rates
  // ===========================================================================

  getHistoricalRates(query: HistoricalRateQuery): HistoricalRateEntry[] {
    const key = getRateKey(query.fromCurrency, query.toCurrency)
    const rateMap = this.historicalRates.get(key)

    if (!rateMap) {
      return []
    }

    const startTime = query.startDate.getTime()
    const endTime = query.endDate.getTime()
    const results: HistoricalRateEntry[] = []

    for (const [dateStr, entry] of rateMap) {
      const entryDate = new Date(dateStr)
      const entryTime = entryDate.getTime()

      if (entryTime >= startTime && entryTime <= endTime) {
        if (!query.source || entry.source === query.source) {
          results.push(entry)
        }
      }
    }

    // Sort by date
    results.sort((a, b) => a.date.getTime() - b.date.getTime())

    // Apply granularity if specified
    if (query.granularity && query.granularity !== 'daily') {
      return this.aggregateByGranularity(results, query.granularity)
    }

    return results
  }

  private aggregateByGranularity(
    entries: HistoricalRateEntry[],
    granularity: 'weekly' | 'monthly'
  ): HistoricalRateEntry[] {
    if (entries.length === 0) return []

    const buckets = new Map<string, HistoricalRateEntry[]>()

    for (const entry of entries) {
      let bucketKey: string
      const date = entry.date

      if (granularity === 'weekly') {
        // Get week start (Sunday)
        const weekStart = new Date(date)
        weekStart.setDate(date.getDate() - date.getDay())
        bucketKey = normalizeDate(weekStart)
      } else {
        // Monthly - use first of month
        bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
      }

      const bucket = buckets.get(bucketKey) ?? []
      bucket.push(entry)
      buckets.set(bucketKey, bucket)
    }

    const aggregated: HistoricalRateEntry[] = []

    for (const [dateStr, bucket] of buckets) {
      const rates = bucket.map((e) => e.rate)
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length

      aggregated.push({
        date: new Date(dateStr),
        rate: avgRate,
        source: bucket[0].source,
        high: Math.max(...rates),
        low: Math.min(...rates),
        open: bucket[0].rate,
        close: bucket[bucket.length - 1].rate,
      })
    }

    return aggregated.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  storeHistoricalRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    date: Date,
    rate: number,
    source: RateSource
  ): void {
    const key = getRateKey(fromCurrency, toCurrency)
    let rateMap = this.historicalRates.get(key)

    if (!rateMap) {
      rateMap = new Map()
      this.historicalRates.set(key, rateMap)
    }

    const dateStr = normalizeDate(date)
    rateMap.set(dateStr, {
      date: new Date(dateStr),
      rate,
      source,
    })

    // Also store inverse
    const inverseKey = getRateKey(toCurrency, fromCurrency)
    let inverseRateMap = this.historicalRates.get(inverseKey)

    if (!inverseRateMap) {
      inverseRateMap = new Map()
      this.historicalRates.set(inverseKey, inverseRateMap)
    }

    inverseRateMap.set(dateStr, {
      date: new Date(dateStr),
      rate: 1 / rate,
      source,
    })
  }

  // ===========================================================================
  // Rate Fetching
  // ===========================================================================

  async fetchRate(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    source?: RateSource
  ): Promise<RateFetchResult> {
    const sources = source ? [source] : this.config.fallbackChain

    for (const src of sources) {
      const fetcher = this.fetchers.get(src)
      if (!fetcher) continue

      try {
        const result = await fetcher(fromCurrency, toCurrency)
        if (result.success && result.rate) {
          // Store the fetched rate
          this.setRate(fromCurrency, toCurrency, result.rate, { source: src })
          return result
        }
      } catch (error) {
        // Continue to next source
      }
    }

    return {
      success: false,
      source: sources[0] ?? 'manual',
      timestamp: new Date(),
      error: 'No rate source available',
    }
  }

  registerFetcher(source: RateSource, fetcher: RateFetcher): void {
    this.fetchers.set(source, fetcher)
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  subscribe(callback: RateUpdateCallback): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  private notifySubscribers(update: RateUpdate): void {
    for (const callback of this.subscribers) {
      try {
        callback(update)
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  clearCache(): void {
    this.cache.clear()
    this.cacheHits = 0
    this.cacheMisses = 0
  }

  getCacheStats(): {
    size: number
    hits: number
    misses: number
    hitRate: number
  } {
    const total = this.cacheHits + this.cacheMisses
    return {
      size: this.cache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    }
  }

  // ===========================================================================
  // Audit
  // ===========================================================================

  private addAuditEntry(key: string, update: RateUpdate): void {
    const log = this.auditLog.get(key) ?? []
    log.unshift(update)
    // Keep last 1000 entries per pair
    if (log.length > 1000) {
      log.pop()
    }
    this.auditLog.set(key, log)
  }

  getAuditLog(
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    options?: {
      startDate?: Date
      endDate?: Date
      limit?: number
    }
  ): RateUpdate[] {
    const key = getRateKey(fromCurrency, toCurrency)
    let log = this.auditLog.get(key) ?? []

    if (options?.startDate || options?.endDate) {
      const startTime = options.startDate?.getTime() ?? 0
      const endTime = options.endDate?.getTime() ?? Infinity

      log = log.filter((entry) => {
        const entryTime = entry.timestamp.getTime()
        return entryTime >= startTime && entryTime <= endTime
      })
    }

    if (options?.limit) {
      log = log.slice(0, options.limit)
    }

    return log
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new ExchangeRateProvider instance
 */
export function createExchangeRateProvider(
  config?: ExchangeRateProviderConfig
): ExchangeRateProvider {
  return new ExchangeRateProviderImpl(config)
}

/**
 * Create a simple manual rate provider with no external fetching
 */
export function createManualRateProvider(): ExchangeRateProvider {
  return createExchangeRateProvider({
    defaultSource: 'manual',
    autoFetch: false,
  })
}
