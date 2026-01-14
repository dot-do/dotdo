/**
 * Entitlements - Cached feature checks following Polar patterns
 *
 * Features:
 * - Boolean feature checks
 * - Value-based entitlements (limits, tiers)
 * - Cached entitlement lookup with configurable TTL
 * - Subscription tier mapping
 * - Graceful degradation when source unavailable
 *
 * @example
 * ```typescript
 * import { EntitlementChecker } from 'dotdo/lib/governance/entitlements'
 *
 * const checker = new EntitlementChecker(paymentsSource, {
 *   cacheTtlMs: 60000,
 *   fallbackOnError: true,
 * })
 *
 * // Check if customer has feature
 * const result = await checker.check('cust_123', 'premium_support')
 * if (result.entitled) {
 *   // Feature enabled
 * }
 *
 * // Check with limit
 * const apiCheck = await checker.check('cust_123', 'api_calls')
 * if (apiCheck.entitled && apiCheck.limit) {
 *   console.log(`Allowed ${apiCheck.limit} API calls`)
 * }
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Source interface for fetching entitlements (e.g., payments.do)
 */
export interface EntitlementSource {
  getEntitlements(customerId: string): Promise<Entitlement[]>
}

/**
 * Entitlement definition
 */
export interface Entitlement {
  /** Feature name */
  feature: string
  /** Whether the feature is enabled */
  enabled: boolean
  /** Numeric limit (e.g., API calls, seats) */
  limit?: number
  /** String value (e.g., tier name) */
  value?: string
  /** Whether the entitlement is unlimited */
  unlimited?: boolean
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of an entitlement check
 */
export interface CheckResult {
  /** Whether the customer is entitled to the feature */
  entitled: boolean
  /** Reason for denial (if not entitled) */
  reason?: 'NOT_FOUND' | 'DISABLED' | 'NO_SUBSCRIPTION' | 'INVALID_FEATURE' | 'INVALID_CUSTOMER' | 'SOURCE_ERROR'
  /** Numeric limit (if applicable) */
  limit?: number
  /** String value (if applicable) */
  value?: string
  /** Whether unlimited */
  unlimited?: boolean
  /** Whether result came from fallback defaults */
  fromFallback?: boolean
  /** Whether result came from stale cache */
  fromStaleCache?: boolean
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of checking all features
 */
export interface AllFeaturesResult {
  /** Features the customer is entitled to */
  entitled: string[]
  /** Features the customer is not entitled to */
  notEntitled: string[]
}

/**
 * Configuration for EntitlementChecker
 */
export interface EntitlementConfig {
  /** Cache TTL in milliseconds (0 = no caching) */
  cacheTtlMs?: number
  /** Whether to use fallback on source error */
  fallbackOnError?: boolean
  /** Default entitlements when source unavailable */
  defaultEntitlements?: Entitlement[]
  /** Whether to use stale cache when source fails */
  staleCacheOnError?: boolean
}

/**
 * Cached entitlement entry
 */
interface CacheEntry {
  entitlements: Map<string, Entitlement>
  timestamp: number
}

// =============================================================================
// EntitlementChecker Implementation
// =============================================================================

/**
 * Entitlement Checker
 *
 * Provides cached, fault-tolerant entitlement checks.
 */
export class EntitlementChecker {
  private readonly source: EntitlementSource
  private readonly config: Required<EntitlementConfig>
  private readonly cache = new Map<string, CacheEntry>()
  private readonly defaultEntitlementMap: Map<string, Entitlement>
  private readonly pendingFetches = new Map<string, Promise<Entitlement[]>>()

  constructor(source: EntitlementSource, config: EntitlementConfig = {}) {
    this.source = source
    this.config = {
      cacheTtlMs: config.cacheTtlMs ?? 0,
      fallbackOnError: config.fallbackOnError ?? false,
      defaultEntitlements: config.defaultEntitlements ?? [],
      staleCacheOnError: config.staleCacheOnError ?? false,
    }

    // Build default entitlement map
    this.defaultEntitlementMap = new Map()
    for (const e of this.config.defaultEntitlements) {
      this.defaultEntitlementMap.set(e.feature, e)
    }
  }

  /**
   * Check if a customer is entitled to a feature
   */
  async check(customerId: string, feature: string): Promise<CheckResult> {
    // Validate inputs
    if (!feature) {
      return { entitled: false, reason: 'INVALID_FEATURE' }
    }
    if (!customerId) {
      return { entitled: false, reason: 'INVALID_CUSTOMER' }
    }

    try {
      const entitlements = await this.getEntitlements(customerId)
      const entitlement = entitlements.get(feature)

      if (!entitlement) {
        return { entitled: false, reason: 'NOT_FOUND' }
      }

      if (!entitlement.enabled) {
        return { entitled: false, reason: 'DISABLED' }
      }

      return {
        entitled: true,
        limit: entitlement.limit,
        value: entitlement.value,
        unlimited: entitlement.unlimited,
        metadata: entitlement.metadata,
      }
    } catch (error) {
      return this.handleError(customerId, feature)
    }
  }

  /**
   * Check multiple features at once
   */
  async checkMany(
    customerId: string,
    features: string[]
  ): Promise<Record<string, CheckResult>> {
    const results: Record<string, CheckResult> = {}

    try {
      const entitlements = await this.getEntitlements(customerId)

      for (const feature of features) {
        if (!feature) {
          results[feature] = { entitled: false, reason: 'INVALID_FEATURE' }
          continue
        }

        const entitlement = entitlements.get(feature)

        if (!entitlement) {
          results[feature] = { entitled: false, reason: 'NOT_FOUND' }
        } else if (!entitlement.enabled) {
          results[feature] = { entitled: false, reason: 'DISABLED' }
        } else {
          results[feature] = {
            entitled: true,
            limit: entitlement.limit,
            value: entitlement.value,
            unlimited: entitlement.unlimited,
            metadata: entitlement.metadata,
          }
        }
      }
    } catch (error) {
      // Fall back for all features on error
      for (const feature of features) {
        results[feature] = await this.handleError(customerId, feature)
      }
    }

    return results
  }

  /**
   * Check all features for a customer
   */
  async checkAll(customerId: string): Promise<AllFeaturesResult> {
    const entitled: string[] = []
    const notEntitled: string[] = []

    try {
      const entitlements = await this.getEntitlements(customerId)

      entitlements.forEach((entitlement, feature) => {
        if (entitlement.enabled) {
          entitled.push(feature)
        } else {
          notEntitled.push(feature)
        }
      })
    } catch (error) {
      // Return empty on error
    }

    return { entitled, notEntitled }
  }

  /**
   * Invalidate cache for a customer
   */
  invalidate(customerId: string): void {
    this.cache.delete(customerId)
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get entitlements for a customer (with caching)
   */
  private async getEntitlements(customerId: string): Promise<Map<string, Entitlement>> {
    // Check cache
    const cached = this.cache.get(customerId)
    const now = Date.now()

    if (cached && this.config.cacheTtlMs > 0) {
      if (now - cached.timestamp < this.config.cacheTtlMs) {
        return cached.entitlements
      }
    }

    // Check for pending fetch (request coalescing)
    const pending = this.pendingFetches.get(customerId)
    if (pending) {
      const entitlements = await pending
      return this.arrayToMap(entitlements)
    }

    // Fetch from source
    const fetchPromise = this.source.getEntitlements(customerId)
    this.pendingFetches.set(customerId, fetchPromise)

    try {
      const entitlements = await fetchPromise
      const entitlementMap = this.arrayToMap(entitlements)

      // Update cache
      if (this.config.cacheTtlMs > 0) {
        this.cache.set(customerId, {
          entitlements: entitlementMap,
          timestamp: now,
        })
      }

      return entitlementMap
    } finally {
      this.pendingFetches.delete(customerId)
    }
  }

  /**
   * Handle error with fallback logic
   */
  private handleError(customerId: string, feature: string): CheckResult {
    // Try stale cache first
    if (this.config.staleCacheOnError) {
      const staleCache = this.cache.get(customerId)
      if (staleCache) {
        const entitlement = staleCache.entitlements.get(feature)
        if (entitlement && entitlement.enabled) {
          return {
            entitled: true,
            limit: entitlement.limit,
            value: entitlement.value,
            unlimited: entitlement.unlimited,
            metadata: entitlement.metadata,
            fromStaleCache: true,
          }
        }
      }
    }

    // Try default entitlements
    if (this.config.fallbackOnError) {
      const defaultEntitlement = this.defaultEntitlementMap.get(feature)
      if (defaultEntitlement && defaultEntitlement.enabled) {
        return {
          entitled: true,
          limit: defaultEntitlement.limit,
          value: defaultEntitlement.value,
          unlimited: defaultEntitlement.unlimited,
          metadata: defaultEntitlement.metadata,
          fromFallback: true,
        }
      }
    }

    return { entitled: false, reason: 'SOURCE_ERROR' }
  }

  /**
   * Convert entitlement array to map
   */
  private arrayToMap(entitlements: Entitlement[]): Map<string, Entitlement> {
    const map = new Map<string, Entitlement>()
    for (const e of entitlements) {
      map.set(e.feature, e)
    }
    return map
  }
}
