/**
 * Tests for ClassificationCache module
 *
 * Verifies:
 * - LRU cache behavior
 * - Cache hit/miss tracking
 * - Cache size from BashxConfig
 * - Language detection cache
 * - Metrics collection (enableMetrics, getMetrics, resetMetrics)
 * - Cache clearing and statistics (getCacheStats, clearCaches)
 *
 * @module tests/do/cache/classification-cache.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ClassificationCache,
  LanguageDetectionCache,
  CacheManager,
  type CacheStats,
  type CacheMetrics,
} from '../../../src/do/cache/classification-cache.js'
import { DEFAULT_CONFIG, getConfig, type BashxConfig } from '../../../src/config/index.js'
import type { ExecutionTier, TierClassification } from '../../../src/do/tiered-executor.js'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock TierClassification for testing
 */
function createMockClassification(tier: ExecutionTier = 1, handler = 'native'): TierClassification {
  return {
    tier,
    handler: handler as TierClassification['handler'],
    reason: `Test classification for tier ${tier}`,
  }
}

/**
 * Create a mock LanguageDetectionResult for testing
 */
interface MockLanguageDetectionResult {
  language: string
  confidence: number
  method: string
}

function createMockLanguageResult(language = 'bash'): MockLanguageDetectionResult {
  return {
    language,
    confidence: 0.9,
    method: 'test',
  }
}

// ============================================================================
// CLASSIFICATION CACHE TESTS
// ============================================================================

describe('ClassificationCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new ClassificationCache(100)
      const classification = createMockClassification(1)

      cache.set('echo', classification)
      const result = cache.get('echo')

      expect(result).toEqual(classification)
    })

    it('should return undefined for missing keys', () => {
      const cache = new ClassificationCache(100)

      const result = cache.get('nonexistent')

      expect(result).toBeUndefined()
    })

    it('should report correct size', () => {
      const cache = new ClassificationCache(100)

      expect(cache.size).toBe(0)

      cache.set('echo', createMockClassification(1))
      expect(cache.size).toBe(1)

      cache.set('jq', createMockClassification(2))
      expect(cache.size).toBe(2)
    })

    it('should clear all entries', () => {
      const cache = new ClassificationCache(100)
      cache.set('echo', createMockClassification(1))
      cache.set('jq', createMockClassification(2))

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.get('echo')).toBeUndefined()
      expect(cache.get('jq')).toBeUndefined()
    })
  })

  describe('LRU behavior', () => {
    it('should evict oldest entry when at capacity', () => {
      const cache = new ClassificationCache(3)

      cache.set('cmd1', createMockClassification(1))
      cache.set('cmd2', createMockClassification(1))
      cache.set('cmd3', createMockClassification(1))

      // Cache is full, adding cmd4 should evict cmd1 (oldest)
      cache.set('cmd4', createMockClassification(1))

      expect(cache.size).toBe(3)
      expect(cache.get('cmd1')).toBeUndefined()
      expect(cache.get('cmd2')).toBeDefined()
      expect(cache.get('cmd3')).toBeDefined()
      expect(cache.get('cmd4')).toBeDefined()
    })

    it('should refresh entry on get (move to end)', () => {
      const cache = new ClassificationCache(3)

      cache.set('cmd1', createMockClassification(1))
      cache.set('cmd2', createMockClassification(1))
      cache.set('cmd3', createMockClassification(1))

      // Access cmd1, making it most recently used
      cache.get('cmd1')

      // Add new entry, should evict cmd2 (now oldest)
      cache.set('cmd4', createMockClassification(1))

      expect(cache.get('cmd1')).toBeDefined()
      expect(cache.get('cmd2')).toBeUndefined()
      expect(cache.get('cmd3')).toBeDefined()
      expect(cache.get('cmd4')).toBeDefined()
    })

    it('should update existing entry without increasing size', () => {
      const cache = new ClassificationCache(3)

      cache.set('cmd1', createMockClassification(1))
      cache.set('cmd1', createMockClassification(2))

      expect(cache.size).toBe(1)
      expect(cache.get('cmd1')?.tier).toBe(2)
    })
  })

  describe('configuration integration', () => {
    it('should use default cache size from BashxConfig', () => {
      const cache = new ClassificationCache()

      // Default size should be from DEFAULT_CONFIG.cache.classificationCacheSize
      expect(cache.maxSize).toBe(DEFAULT_CONFIG.cache.classificationCacheSize)
    })

    it('should accept custom cache size', () => {
      const cache = new ClassificationCache(500)

      expect(cache.maxSize).toBe(500)
    })

    it('should use config from getConfig()', () => {
      const config = getConfig({ cache: { classificationCacheSize: 2000 } })
      const cache = new ClassificationCache(config.cache.classificationCacheSize)

      expect(cache.maxSize).toBe(2000)
    })
  })
})

// ============================================================================
// LANGUAGE DETECTION CACHE TESTS
// ============================================================================

describe('LanguageDetectionCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve language detection results', () => {
      const cache = new LanguageDetectionCache(100)
      const result = createMockLanguageResult('python')

      cache.set('import os', result)
      const cached = cache.get('import os')

      expect(cached).toEqual(result)
    })

    it('should return undefined for missing keys', () => {
      const cache = new LanguageDetectionCache(100)

      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should report correct size', () => {
      const cache = new LanguageDetectionCache(100)

      expect(cache.size).toBe(0)

      cache.set('echo hello', createMockLanguageResult('bash'))
      expect(cache.size).toBe(1)
    })

    it('should clear all entries', () => {
      const cache = new LanguageDetectionCache(100)
      cache.set('echo hello', createMockLanguageResult('bash'))
      cache.set('import os', createMockLanguageResult('python'))

      cache.clear()

      expect(cache.size).toBe(0)
    })
  })

  describe('LRU behavior', () => {
    it('should evict oldest entry when at capacity', () => {
      const cache = new LanguageDetectionCache(2)

      cache.set('code1', createMockLanguageResult('bash'))
      cache.set('code2', createMockLanguageResult('python'))

      // Cache is full, adding code3 should evict code1
      cache.set('code3', createMockLanguageResult('javascript'))

      expect(cache.size).toBe(2)
      expect(cache.get('code1')).toBeUndefined()
      expect(cache.get('code2')).toBeDefined()
      expect(cache.get('code3')).toBeDefined()
    })
  })

  describe('configuration integration', () => {
    it('should use default cache size from BashxConfig', () => {
      const cache = new LanguageDetectionCache()

      expect(cache.maxSize).toBe(DEFAULT_CONFIG.cache.languageDetectionCacheSize)
    })

    it('should accept custom cache size', () => {
      const cache = new LanguageDetectionCache(250)

      expect(cache.maxSize).toBe(250)
    })
  })
})

// ============================================================================
// CACHE MANAGER TESTS (unified metrics and management)
// ============================================================================

describe('CacheManager', () => {
  let manager: CacheManager

  beforeEach(() => {
    manager = new CacheManager()
  })

  describe('cache access', () => {
    it('should provide access to classification cache', () => {
      const classification = createMockClassification(1)

      manager.classificationCache.set('echo', classification)

      expect(manager.classificationCache.get('echo')).toEqual(classification)
    })

    it('should provide access to language detection cache', () => {
      const result = createMockLanguageResult('python')

      manager.languageDetectionCache.set('import os', result)

      expect(manager.languageDetectionCache.get('import os')).toEqual(result)
    })
  })

  describe('metrics', () => {
    it('should not track metrics when disabled', () => {
      const classification = createMockClassification(1)
      manager.classificationCache.set('echo', classification)

      // Access multiple times
      manager.classificationCache.get('echo')
      manager.classificationCache.get('nonexistent')

      const metrics = manager.getMetrics()

      // Metrics should be zero when not enabled
      expect(metrics.totalClassifications).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(0)
    })

    it('should track metrics when enabled', () => {
      manager.enableMetrics()

      const classification = createMockClassification(1)
      manager.classificationCache.set('echo', classification)

      // First access is a hit
      manager.trackClassification('echo', true, classification)
      // Second access is also a hit
      manager.trackClassification('echo', true, classification)
      // Miss
      manager.trackClassification('nonexistent', false, undefined)

      const metrics = manager.getMetrics()

      expect(metrics.totalClassifications).toBe(3)
      expect(metrics.cacheHits).toBe(2)
      expect(metrics.cacheMisses).toBe(1)
      expect(metrics.cacheHitRatio).toBeCloseTo(2 / 3)
    })

    it('should track tier counts', () => {
      manager.enableMetrics()

      manager.trackClassification('echo', true, createMockClassification(1))
      manager.trackClassification('jq', true, createMockClassification(2))
      manager.trackClassification('npm', true, createMockClassification(3))
      manager.trackClassification('docker', true, createMockClassification(4))
      manager.trackClassification('echo2', true, createMockClassification(1))

      const metrics = manager.getMetrics()

      expect(metrics.tierCounts[1]).toBe(2)
      expect(metrics.tierCounts[2]).toBe(1)
      expect(metrics.tierCounts[3]).toBe(1)
      expect(metrics.tierCounts[4]).toBe(1)
    })

    it('should track handler counts', () => {
      manager.enableMetrics()

      manager.trackClassification('echo', true, createMockClassification(1, 'native'))
      manager.trackClassification('jq', true, createMockClassification(2, 'rpc'))
      manager.trackClassification('echo2', true, createMockClassification(1, 'native'))

      const metrics = manager.getMetrics()

      expect(metrics.handlerCounts['native']).toBe(2)
      expect(metrics.handlerCounts['rpc']).toBe(1)
    })

    it('should reset metrics', () => {
      manager.enableMetrics()

      manager.trackClassification('echo', true, createMockClassification(1))
      manager.trackClassification('jq', true, createMockClassification(2))

      manager.resetMetrics()

      const metrics = manager.getMetrics()

      expect(metrics.totalClassifications).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(0)
      expect(metrics.tierCounts[1]).toBe(0)
      expect(metrics.tierCounts[2]).toBe(0)
      expect(Object.keys(metrics.handlerCounts)).toHaveLength(0)
    })

    it('should disable metrics', () => {
      manager.enableMetrics()
      manager.trackClassification('echo', true, createMockClassification(1))

      manager.disableMetrics()
      manager.trackClassification('jq', true, createMockClassification(2))

      const metrics = manager.getMetrics()

      // Only the first classification should be tracked
      expect(metrics.totalClassifications).toBe(1)
    })

    it('should calculate cache hit ratio as 0 when no classifications', () => {
      manager.enableMetrics()

      const metrics = manager.getMetrics()

      expect(metrics.cacheHitRatio).toBe(0)
    })
  })

  describe('cache statistics', () => {
    it('should return cache statistics', () => {
      manager.classificationCache.set('echo', createMockClassification(1))
      manager.classificationCache.set('jq', createMockClassification(2))
      manager.languageDetectionCache.set('import os', createMockLanguageResult('python'))

      const stats = manager.getCacheStats()

      expect(stats.classificationCacheSize).toBe(2)
      expect(stats.languageDetectionCacheSize).toBe(1)
    })
  })

  describe('cache clearing', () => {
    it('should clear all caches', () => {
      manager.classificationCache.set('echo', createMockClassification(1))
      manager.languageDetectionCache.set('import os', createMockLanguageResult('python'))

      manager.clearCaches()

      expect(manager.classificationCache.size).toBe(0)
      expect(manager.languageDetectionCache.size).toBe(0)
    })

    it('should not reset metrics when clearing caches', () => {
      manager.enableMetrics()
      manager.trackClassification('echo', true, createMockClassification(1))

      manager.clearCaches()

      const metrics = manager.getMetrics()
      expect(metrics.totalClassifications).toBe(1)
    })
  })

  describe('configuration', () => {
    it('should use default config when not provided', () => {
      const manager = new CacheManager()

      expect(manager.classificationCache.maxSize).toBe(DEFAULT_CONFIG.cache.classificationCacheSize)
      expect(manager.languageDetectionCache.maxSize).toBe(DEFAULT_CONFIG.cache.languageDetectionCacheSize)
    })

    it('should use provided config', () => {
      const config = getConfig({
        cache: {
          classificationCacheSize: 2000,
          languageDetectionCacheSize: 1000,
        },
      })
      const manager = new CacheManager(config)

      expect(manager.classificationCache.maxSize).toBe(2000)
      expect(manager.languageDetectionCache.maxSize).toBe(1000)
    })

    it('should use enableMetrics from config', () => {
      const config = getConfig({
        execution: { enableMetrics: true },
      })
      const manager = new CacheManager(config)

      manager.trackClassification('echo', true, createMockClassification(1))

      const metrics = manager.getMetrics()
      expect(metrics.totalClassifications).toBe(1)
    })
  })
})

// ============================================================================
// TYPES TESTS
// ============================================================================

describe('Cache Types', () => {
  it('CacheStats should have expected shape', () => {
    const manager = new CacheManager()
    const stats: CacheStats = manager.getCacheStats()

    expect(typeof stats.classificationCacheSize).toBe('number')
    expect(typeof stats.languageDetectionCacheSize).toBe('number')
  })

  it('CacheMetrics should have expected shape', () => {
    const manager = new CacheManager()
    manager.enableMetrics()
    const metrics: CacheMetrics = manager.getMetrics()

    expect(typeof metrics.totalClassifications).toBe('number')
    expect(typeof metrics.cacheHits).toBe('number')
    expect(typeof metrics.cacheMisses).toBe('number')
    expect(typeof metrics.cacheHitRatio).toBe('number')
    expect(typeof metrics.tierCounts).toBe('object')
    expect(typeof metrics.handlerCounts).toBe('object')
  })
})
