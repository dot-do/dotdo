/**
 * Classification Cache Module
 *
 * Provides caching infrastructure for tier classification and language detection
 * results. Extracted from TieredExecutor for better modularity and testability.
 *
 * Features:
 * - LRU (Least Recently Used) eviction policy
 * - Configurable cache sizes via BashxConfig
 * - Unified metrics tracking for cache performance analysis
 * - Thread-safe operations using Map-based implementation
 *
 * @module bashx/do/cache/classification-cache
 */

import { DEFAULT_CONFIG, type BashxConfig } from '../../config/index.js'
import type { ExecutionTier, TierClassification } from '../tiered-executor.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Cache statistics for debugging and monitoring.
 */
export interface CacheStats {
  /** Number of entries in the classification cache */
  classificationCacheSize: number
  /** Number of entries in the language detection cache */
  languageDetectionCacheSize: number
}

/**
 * Metrics for cache and tier usage tracking.
 *
 * Tracks classification counts, cache hits, and tier usage to help with
 * performance analysis and optimization decisions.
 */
export interface CacheMetrics {
  /** Total classifications performed */
  totalClassifications: number
  /** Classifications served from cache */
  cacheHits: number
  /** Classifications computed fresh */
  cacheMisses: number
  /** Execution counts per tier */
  tierCounts: Record<ExecutionTier, number>
  /** Execution counts per handler type */
  handlerCounts: Record<string, number>
  /** Cache hit ratio (0-1) */
  cacheHitRatio: number
}

// ============================================================================
// CLASSIFICATION CACHE
// ============================================================================

/**
 * LRU cache for tier classification results.
 * Caches command-name-based classifications to avoid repeated lookups.
 *
 * @example
 * ```typescript
 * const cache = new ClassificationCache(1000)
 *
 * // Store a classification
 * cache.set('echo', { tier: 1, handler: 'native', reason: 'builtin' })
 *
 * // Retrieve with LRU refresh
 * const result = cache.get('echo')
 * ```
 */
export class ClassificationCache {
  private readonly cache = new Map<string, TierClassification>()
  private readonly _maxSize: number

  /**
   * Create a new ClassificationCache.
   *
   * @param maxSize - Maximum number of entries before LRU eviction.
   *                  Defaults to BashxConfig.cache.classificationCacheSize (1000).
   */
  constructor(maxSize?: number) {
    this._maxSize = maxSize ?? DEFAULT_CONFIG.cache.classificationCacheSize
  }

  /**
   * Get the maximum cache size.
   */
  get maxSize(): number {
    return this._maxSize
  }

  /**
   * Get a cached classification by key.
   * Accessing an entry moves it to the end (most recently used).
   *
   * @param key - The cache key (typically command name or full command)
   * @returns The cached classification, or undefined if not found
   */
  get(key: string): TierClassification | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end for LRU behavior (delete and re-add)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  /**
   * Store a classification in the cache.
   * If at capacity, evicts the oldest (least recently used) entry.
   *
   * @param key - The cache key
   * @param value - The tier classification to cache
   */
  set(key: string, value: TierClassification): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this._maxSize) {
      // Evict oldest entry if at capacity
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size
  }
}

// ============================================================================
// LANGUAGE DETECTION CACHE
// ============================================================================

/**
 * LRU cache for language detection results.
 * Caches language detection results for code snippets to avoid repeated analysis.
 *
 * @example
 * ```typescript
 * const cache = new LanguageDetectionCache(500)
 *
 * // Store a detection result
 * cache.set('import os', { language: 'python', confidence: 0.9, method: 'shebang' })
 *
 * // Retrieve with LRU refresh
 * const result = cache.get('import os')
 * ```
 */
export class LanguageDetectionCache<T = unknown> {
  private readonly cache = new Map<string, T>()
  private readonly _maxSize: number

  /**
   * Create a new LanguageDetectionCache.
   *
   * @param maxSize - Maximum number of entries before LRU eviction.
   *                  Defaults to BashxConfig.cache.languageDetectionCacheSize (500).
   */
  constructor(maxSize?: number) {
    this._maxSize = maxSize ?? DEFAULT_CONFIG.cache.languageDetectionCacheSize
  }

  /**
   * Get the maximum cache size.
   */
  get maxSize(): number {
    return this._maxSize
  }

  /**
   * Get a cached language detection result by key.
   * Accessing an entry moves it to the end (most recently used).
   *
   * @param key - The cache key (typically the input code snippet)
   * @returns The cached result, or undefined if not found
   */
  get(key: string): T | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end for LRU behavior (delete and re-add)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  /**
   * Store a language detection result in the cache.
   * If at capacity, evicts the oldest (least recently used) entry.
   *
   * @param key - The cache key
   * @param value - The detection result to cache
   */
  set(key: string, value: T): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this._maxSize) {
      // Evict oldest entry if at capacity
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size
  }
}

// ============================================================================
// CACHE MANAGER
// ============================================================================

/**
 * Unified cache manager with metrics tracking.
 *
 * Provides a single interface for managing classification and language detection
 * caches, along with metrics collection for performance analysis.
 *
 * @example
 * ```typescript
 * import { getConfig } from 'bashx/config'
 *
 * const config = getConfig({ execution: { enableMetrics: true } })
 * const manager = new CacheManager(config)
 *
 * // Use the caches
 * manager.classificationCache.set('echo', classification)
 * manager.trackClassification('echo', true, classification)
 *
 * // Get statistics
 * const stats = manager.getCacheStats()
 * const metrics = manager.getMetrics()
 * ```
 */
export class CacheManager {
  /** Cache for tier classifications */
  public readonly classificationCache: ClassificationCache
  /** Cache for language detection results */
  public readonly languageDetectionCache: LanguageDetectionCache

  // Metrics tracking
  private metricsEnabled: boolean
  private totalClassifications = 0
  private cacheHits = 0
  private cacheMisses = 0
  private readonly tierCounts: Record<ExecutionTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  private readonly handlerCounts: Record<string, number> = {}

  /**
   * Create a new CacheManager.
   *
   * @param config - Optional BashxConfig for cache sizes and metrics settings.
   *                 If not provided, uses DEFAULT_CONFIG.
   */
  constructor(config?: BashxConfig) {
    const cfg = config ?? DEFAULT_CONFIG
    this.classificationCache = new ClassificationCache(cfg.cache.classificationCacheSize)
    this.languageDetectionCache = new LanguageDetectionCache(cfg.cache.languageDetectionCacheSize)
    this.metricsEnabled = cfg.execution.enableMetrics
  }

  // ============================================================================
  // METRICS METHODS
  // ============================================================================

  /**
   * Enable metrics collection for tier usage analysis.
   * When enabled, tracks classification counts, cache hits, and tier usage.
   */
  enableMetrics(): void {
    this.metricsEnabled = true
  }

  /**
   * Disable metrics collection.
   */
  disableMetrics(): void {
    this.metricsEnabled = false
  }

  /**
   * Track a classification event.
   * Call this when a classification is performed to update metrics.
   *
   * @param key - The cache key used for the classification
   * @param isHit - Whether the classification was served from cache
   * @param classification - The classification result (undefined for misses before computation)
   */
  trackClassification(
    _key: string,
    isHit: boolean,
    classification: TierClassification | undefined
  ): void {
    if (!this.metricsEnabled) return

    this.totalClassifications++
    if (isHit) {
      this.cacheHits++
    } else {
      this.cacheMisses++
    }

    // Track tier and handler counts if classification is provided
    if (classification) {
      this.tierCounts[classification.tier]++
      this.handlerCounts[classification.handler] =
        (this.handlerCounts[classification.handler] || 0) + 1
    }
  }

  /**
   * Get current tier usage metrics.
   *
   * @returns CacheMetrics with counts and cache statistics
   *
   * @example
   * ```typescript
   * manager.enableMetrics()
   * // ... perform classifications ...
   * const metrics = manager.getMetrics()
   * console.log(metrics.cacheHitRatio) // 0.75
   * ```
   */
  getMetrics(): CacheMetrics {
    const total = this.cacheHits + this.cacheMisses
    return {
      totalClassifications: this.totalClassifications,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      tierCounts: { ...this.tierCounts },
      handlerCounts: { ...this.handlerCounts },
      cacheHitRatio: total > 0 ? this.cacheHits / total : 0,
    }
  }

  /**
   * Reset all metrics to zero.
   */
  resetMetrics(): void {
    this.totalClassifications = 0
    this.cacheHits = 0
    this.cacheMisses = 0
    this.tierCounts[1] = 0
    this.tierCounts[2] = 0
    this.tierCounts[3] = 0
    this.tierCounts[4] = 0
    for (const key of Object.keys(this.handlerCounts)) {
      delete this.handlerCounts[key]
    }
  }

  // ============================================================================
  // CACHE MANAGEMENT METHODS
  // ============================================================================

  /**
   * Clear all caches (classification and language detection).
   * Does not reset metrics.
   */
  clearCaches(): void {
    this.classificationCache.clear()
    this.languageDetectionCache.clear()
  }

  /**
   * Get cache statistics for debugging.
   *
   * @returns CacheStats with current cache sizes
   */
  getCacheStats(): CacheStats {
    return {
      classificationCacheSize: this.classificationCache.size,
      languageDetectionCacheSize: this.languageDetectionCache.size,
    }
  }
}
