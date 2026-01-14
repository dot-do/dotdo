/**
 * Tests for Query Routing - Real-time vs cached query routing
 *
 * @see dotdo-qy64m
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getStalenessConfig,
  isWithinBudget,
  isStale,
  getQueryPatternKey,
  extractCubeName,
  RoutingPatternAnalyzer,
  RoutingMetricsCollector,
  DEFAULT_STALENESS_CONFIGS,
  DEFAULT_ROUTING_CONFIG,
  type SemanticQueryWithRouting,
  type StalenessConfig,
  type FreshnessLevel,
} from './query-routing'
import type { SemanticQuery } from './index'

// =============================================================================
// STALENESS CONFIG TESTS
// =============================================================================

describe('Staleness Configuration', () => {
  describe('DEFAULT_STALENESS_CONFIGS', () => {
    it('should have correct values for real-time', () => {
      const config = DEFAULT_STALENESS_CONFIGS['real-time']
      expect(config.maxStalenessMs).toBe(0)
      expect(config.staleWhileRevalidate).toBe(false)
      expect(config.forceRealTime).toBe(true)
    })

    it('should have correct values for near-real-time', () => {
      const config = DEFAULT_STALENESS_CONFIGS['near-real-time']
      expect(config.maxStalenessMs).toBe(30_000) // 30 seconds
      expect(config.staleWhileRevalidate).toBe(true)
      expect(config.forceRealTime).toBe(false)
    })

    it('should have correct values for dashboard', () => {
      const config = DEFAULT_STALENESS_CONFIGS['dashboard']
      expect(config.maxStalenessMs).toBe(300_000) // 5 minutes
      expect(config.staleWhileRevalidate).toBe(true)
      expect(config.forceRealTime).toBe(false)
    })

    it('should have correct values for analytical', () => {
      const config = DEFAULT_STALENESS_CONFIGS['analytical']
      expect(config.maxStalenessMs).toBe(86_400_000) // 24 hours
      expect(config.staleWhileRevalidate).toBe(true)
    })

    it('should have correct values for archival', () => {
      const config = DEFAULT_STALENESS_CONFIGS['archival']
      expect(config.maxStalenessMs).toBe(604_800_000) // 7 days
      expect(config.staleWhileRevalidate).toBe(true)
    })
  })

  describe('getStalenessConfig', () => {
    it('should return default dashboard config for query without routing hints', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count'],
      }

      const config = getStalenessConfig(query)

      expect(config.freshnessLevel).toBe('dashboard')
      expect(config.maxStalenessMs).toBe(300_000)
    })

    it('should use explicit freshness level from query', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count'],
        routing: {
          staleness: {
            freshnessLevel: 'real-time',
          },
        },
      }

      const config = getStalenessConfig(query)

      expect(config.freshnessLevel).toBe('real-time')
      expect(config.forceRealTime).toBe(true)
    })

    it('should allow overriding maxStalenessMs', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count'],
        routing: {
          staleness: {
            freshnessLevel: 'dashboard',
            maxStalenessMs: 60_000, // 1 minute override
          },
        },
      }

      const config = getStalenessConfig(query)

      expect(config.freshnessLevel).toBe('dashboard')
      expect(config.maxStalenessMs).toBe(60_000)
    })

    it('should use routing config defaults', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count'],
      }

      const routingConfig = {
        ...DEFAULT_ROUTING_CONFIG,
        defaultFreshnessLevel: 'analytical' as FreshnessLevel,
      }

      const config = getStalenessConfig(query, routingConfig)

      expect(config.freshnessLevel).toBe('analytical')
      expect(config.maxStalenessMs).toBe(86_400_000)
    })
  })

  describe('isWithinBudget', () => {
    it('should return true for age within budget', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'dashboard',
        maxStalenessMs: 300_000, // 5 minutes
        staleWhileRevalidate: true,
        forceRealTime: false,
      }

      expect(isWithinBudget(60_000, staleness)).toBe(true)
      expect(isWithinBudget(300_000, staleness)).toBe(true)
    })

    it('should return false for age exceeding budget', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'dashboard',
        maxStalenessMs: 300_000,
        staleWhileRevalidate: true,
        forceRealTime: false,
      }

      expect(isWithinBudget(300_001, staleness)).toBe(false)
      expect(isWithinBudget(600_000, staleness)).toBe(false)
    })

    it('should return false for any age when forceRealTime is true', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'real-time',
        maxStalenessMs: 0,
        staleWhileRevalidate: false,
        forceRealTime: true,
      }

      expect(isWithinBudget(0, staleness)).toBe(false)
      expect(isWithinBudget(1, staleness)).toBe(false)
    })
  })

  describe('isStale', () => {
    it('should return true for age beyond 50% of budget', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'dashboard',
        maxStalenessMs: 300_000, // 5 minutes
        staleWhileRevalidate: true,
        forceRealTime: false,
      }

      expect(isStale(150_001, staleness)).toBe(true)
      expect(isStale(200_000, staleness)).toBe(true)
    })

    it('should return false for age within 50% of budget', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'dashboard',
        maxStalenessMs: 300_000,
        staleWhileRevalidate: true,
        forceRealTime: false,
      }

      expect(isStale(150_000, staleness)).toBe(false)
      expect(isStale(60_000, staleness)).toBe(false)
    })

    it('should always return true when forceRealTime is true', () => {
      const staleness: StalenessConfig = {
        freshnessLevel: 'real-time',
        maxStalenessMs: 0,
        staleWhileRevalidate: false,
        forceRealTime: true,
      }

      expect(isStale(0, staleness)).toBe(true)
    })
  })
})

// =============================================================================
// QUERY PATTERN TESTS
// =============================================================================

describe('Query Pattern Utilities', () => {
  describe('getQueryPatternKey', () => {
    it('should generate consistent key for same query', () => {
      const query: SemanticQuery = {
        measures: ['orders.count', 'orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const key1 = getQueryPatternKey(query)
      const key2 = getQueryPatternKey(query)

      expect(key1).toBe(key2)
    })

    it('should generate same key regardless of measure order', () => {
      const query1: SemanticQuery = {
        measures: ['orders.count', 'orders.totalRevenue'],
      }
      const query2: SemanticQuery = {
        measures: ['orders.totalRevenue', 'orders.count'],
      }

      expect(getQueryPatternKey(query1)).toBe(getQueryPatternKey(query2))
    })

    it('should include time dimension in key', () => {
      const queryWithTime: SemanticQuery = {
        measures: ['orders.count'],
        timeDimensions: [{
          dimension: 'orders.createdAt',
          granularity: 'day',
        }],
      }
      const queryWithoutTime: SemanticQuery = {
        measures: ['orders.count'],
      }

      expect(getQueryPatternKey(queryWithTime))
        .not.toBe(getQueryPatternKey(queryWithoutTime))
    })
  })

  describe('extractCubeName', () => {
    it('should extract cube name from measures', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      expect(extractCubeName(query)).toBe('orders')
    })

    it('should extract cube name from dimensions', () => {
      const query: SemanticQuery = {
        dimensions: ['customers.country'],
      }

      expect(extractCubeName(query)).toBe('customers')
    })

    it('should extract cube name from time dimensions', () => {
      const query: SemanticQuery = {
        timeDimensions: [{
          dimension: 'events.timestamp',
          granularity: 'hour',
        }],
      }

      expect(extractCubeName(query)).toBe('events')
    })

    it('should return null for empty query', () => {
      const query: SemanticQuery = {}

      expect(extractCubeName(query)).toBeNull()
    })
  })
})

// =============================================================================
// ROUTING PATTERN ANALYZER TESTS
// =============================================================================

describe('RoutingPatternAnalyzer', () => {
  let analyzer: RoutingPatternAnalyzer

  beforeEach(() => {
    analyzer = new RoutingPatternAnalyzer()
  })

  describe('recordExecution', () => {
    it('should record a cache hit', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      analyzer.recordExecution(query, 'cache', 10)

      const patterns = analyzer.getPatterns()
      expect(patterns).toHaveLength(1)
      expect(patterns[0].count).toBe(1)
      expect(patterns[0].cacheHitRate).toBe(1)
      expect(patterns[0].avgCacheLatencyMs).toBe(10)
    })

    it('should record a source query', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      analyzer.recordExecution(query, 'source', 500)

      const patterns = analyzer.getPatterns()
      expect(patterns).toHaveLength(1)
      expect(patterns[0].cacheHitRate).toBe(0)
      expect(patterns[0].avgSourceLatencyMs).toBe(500)
    })

    it('should update rolling averages', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      analyzer.recordExecution(query, 'cache', 10)
      analyzer.recordExecution(query, 'cache', 20)
      analyzer.recordExecution(query, 'source', 500)

      const patterns = analyzer.getPatterns()
      expect(patterns[0].count).toBe(3)
      expect(patterns[0].cacheHitRate).toBeCloseTo(2 / 3)
      expect(patterns[0].avgCacheLatencyMs).toBe(15) // (10 + 20) / 2
    })

    it('should track separate patterns for different queries', () => {
      const query1: SemanticQuery = { measures: ['orders.count'] }
      const query2: SemanticQuery = { measures: ['orders.totalRevenue'] }

      analyzer.recordExecution(query1, 'cache', 10)
      analyzer.recordExecution(query2, 'source', 500)

      const patterns = analyzer.getPatterns()
      expect(patterns).toHaveLength(2)
    })
  })

  describe('recommendFreshnessLevel', () => {
    it('should return default for unknown patterns', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      expect(analyzer.recommendFreshnessLevel(query)).toBe('dashboard')
    })

    it('should recommend archival for high cache hit patterns', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      // Record 100+ cache hits to qualify for auto-routing
      for (let i = 0; i < 100; i++) {
        analyzer.recordExecution(query, 'cache', 10)
      }

      expect(analyzer.recommendFreshnessLevel(query)).toBe('archival')
    })

    it('should recommend near-real-time for fast source queries with low cache hit', () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      // Record many source queries with low latency
      for (let i = 0; i < 100; i++) {
        analyzer.recordExecution(query, 'source', 20)
      }

      expect(analyzer.recommendFreshnessLevel(query)).toBe('near-real-time')
    })
  })

  describe('getPreAggregationCandidates', () => {
    it('should return patterns with low cache hit and high source latency', () => {
      const query1: SemanticQuery = { measures: ['orders.count'] }
      const query2: SemanticQuery = { measures: ['orders.totalRevenue'] }

      // Query 1: Low cache hit, high latency - good candidate
      for (let i = 0; i < 15; i++) {
        analyzer.recordExecution(query1, 'source', 1000)
      }

      // Query 2: High cache hit - not a candidate
      for (let i = 0; i < 15; i++) {
        analyzer.recordExecution(query2, 'cache', 10)
      }

      const candidates = analyzer.getPreAggregationCandidates()
      expect(candidates).toHaveLength(1)
      expect(candidates[0].measures).toContain('count')
    })
  })

  describe('clear', () => {
    it('should clear all patterns', () => {
      const query: SemanticQuery = { measures: ['orders.count'] }
      analyzer.recordExecution(query, 'cache', 10)

      expect(analyzer.getPatterns()).toHaveLength(1)

      analyzer.clear()

      expect(analyzer.getPatterns()).toHaveLength(0)
    })
  })
})

// =============================================================================
// ROUTING METRICS COLLECTOR TESTS
// =============================================================================

describe('RoutingMetricsCollector', () => {
  let collector: RoutingMetricsCollector

  beforeEach(() => {
    collector = new RoutingMetricsCollector()
  })

  describe('recordCacheHit', () => {
    it('should increment cache hit count', () => {
      collector.recordCacheHit(10)
      collector.recordCacheHit(20)

      const metrics = collector.getMetrics()
      expect(metrics.cacheHits).toBe(2)
      expect(metrics.totalQueries).toBe(2)
    })

    it('should track average latency', () => {
      collector.recordCacheHit(10)
      collector.recordCacheHit(30)

      const metrics = collector.getMetrics()
      expect(metrics.avgLatencyBySource.cache).toBe(20)
    })
  })

  describe('recordPreAggHit', () => {
    it('should increment pre-agg hit count', () => {
      collector.recordPreAggHit(50)

      const metrics = collector.getMetrics()
      expect(metrics.preAggHits).toBe(1)
      expect(metrics.totalQueries).toBe(1)
    })
  })

  describe('recordSourceQuery', () => {
    it('should increment source query count', () => {
      collector.recordSourceQuery(500)

      const metrics = collector.getMetrics()
      expect(metrics.sourceQueries).toBe(1)
      expect(metrics.totalQueries).toBe(1)
    })
  })

  describe('getCacheHitRate', () => {
    it('should calculate correct cache hit rate', () => {
      collector.recordCacheHit(10)
      collector.recordCacheHit(10)
      collector.recordSourceQuery(500)

      expect(collector.getCacheHitRate()).toBeCloseTo(2 / 3)
    })

    it('should return 0 for no queries', () => {
      expect(collector.getCacheHitRate()).toBe(0)
    })
  })

  describe('reset', () => {
    it('should reset all metrics', () => {
      collector.recordCacheHit(10)
      collector.recordSourceQuery(500)
      collector.recordBudgetViolation()

      collector.reset()

      const metrics = collector.getMetrics()
      expect(metrics.totalQueries).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.budgetViolations).toBe(0)
    })
  })
})

// =============================================================================
// INTEGRATION SCENARIO TESTS
// =============================================================================

describe('Query Routing Integration Scenarios', () => {
  describe('Dashboard Query Scenario', () => {
    it('should allow 5-minute staleness for dashboard queries', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count', 'orders.totalRevenue'],
        dimensions: ['orders.status'],
        routing: {
          staleness: {
            freshnessLevel: 'dashboard',
          },
        },
      }

      const config = getStalenessConfig(query)

      // 4 minutes old - within budget
      expect(isWithinBudget(240_000, config)).toBe(true)

      // 6 minutes old - exceeds budget
      expect(isWithinBudget(360_000, config)).toBe(false)

      // 3 minutes old - within budget but approaching stale threshold
      expect(isStale(180_000, config)).toBe(true)
    })
  })

  describe('Real-time Query Scenario', () => {
    it('should force real-time queries to bypass cache', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['users.activeCount'],
        routing: {
          staleness: {
            freshnessLevel: 'real-time',
          },
        },
      }

      const config = getStalenessConfig(query)

      // Even 0ms age should not be within budget for real-time
      expect(isWithinBudget(0, config)).toBe(false)
      expect(config.forceRealTime).toBe(true)
    })
  })

  describe('Analytical Query Scenario', () => {
    it('should allow day-old data for analytical queries', () => {
      const query: SemanticQueryWithRouting = {
        measures: ['orders.count'],
        timeDimensions: [{
          dimension: 'orders.createdAt',
          granularity: 'month',
          dateRange: ['2025-01-01', '2025-12-31'],
        }],
        routing: {
          staleness: {
            freshnessLevel: 'analytical',
          },
        },
      }

      const config = getStalenessConfig(query)

      // 12 hours old - within budget
      expect(isWithinBudget(12 * 60 * 60 * 1000, config)).toBe(true)

      // 20 hours old - within budget
      expect(isWithinBudget(20 * 60 * 60 * 1000, config)).toBe(true)

      // 25 hours old - exceeds budget
      expect(isWithinBudget(25 * 60 * 60 * 1000, config)).toBe(false)
    })
  })
})
