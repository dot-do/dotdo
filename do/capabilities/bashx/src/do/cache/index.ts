/**
 * Cache Module
 *
 * Provides caching infrastructure for the tiered executor system.
 *
 * This module exports:
 * - ClassificationCache: LRU cache for tier classification results
 * - LanguageDetectionCache: LRU cache for language detection results
 * - CacheManager: Unified cache manager with metrics tracking
 * - Type definitions for cache statistics and metrics
 *
 * @example
 * ```typescript
 * import {
 *   CacheManager,
 *   ClassificationCache,
 *   LanguageDetectionCache,
 *   type CacheStats,
 *   type CacheMetrics,
 * } from 'bashx/do/cache'
 *
 * // Use standalone cache
 * const cache = new ClassificationCache(1000)
 *
 * // Or use unified manager
 * const manager = new CacheManager(config)
 * manager.enableMetrics()
 * ```
 *
 * @module bashx/do/cache
 */

export {
  // Classes
  ClassificationCache,
  LanguageDetectionCache,
  CacheManager,
  // Types
  type CacheStats,
  type CacheMetrics,
} from './classification-cache.js'
