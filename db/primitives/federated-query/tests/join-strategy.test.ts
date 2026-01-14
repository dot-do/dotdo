/**
 * Join Strategy Selection Tests
 *
 * TDD tests for join strategy selection based on:
 * - Table sizes (broadcast small tables, shuffle large ones)
 * - Source capabilities (nested loop fallback for non-equi joins)
 * - Network transfer optimization
 * - Cost estimation
 *
 * @see dotdo-fv8v0
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  JoinStrategySelector,
  type JoinStrategy,
  type JoinCost,
  type JoinStrategyInput,
  type BroadcastJoinStrategy,
  type ShuffleJoinStrategy,
  type NestedLoopJoinStrategy,
  type SortMergeJoinStrategy,
  type TableIndexInfo,
  BROADCAST_THRESHOLD_ROWS,
  BROADCAST_THRESHOLD_BYTES,
} from '../join-strategy'

import {
  Catalog,
  type SourceStatistics,
  type PushdownCapabilities,
  type SourceAdapter,
  createMemoryAdapter,
} from '../index'

// =============================================================================
// Join Strategy Selection Tests
// =============================================================================

describe('JoinStrategySelector', () => {
  let catalog: Catalog
  let selector: JoinStrategySelector

  beforeEach(() => {
    catalog = new Catalog()
    selector = new JoinStrategySelector(catalog)
  })

  describe('broadcast join selection', () => {
    it('should select broadcast join when one table is small by row count', () => {
      // Small table (100 rows) joining large table (1M rows)
      catalog.registerSource({ name: 'small_db', type: 'memory', config: {} })
      catalog.registerSource({ name: 'large_db', type: 'memory', config: {} })

      catalog.registerStatistics('small_db', {
        tables: {
          users: { rowCount: 100, sizeBytes: 10_000 },
        },
      })
      catalog.registerStatistics('large_db', {
        tables: {
          orders: { rowCount: 1_000_000, sizeBytes: 500_000_000 },
        },
      })

      const input: JoinStrategyInput = {
        left: { source: 'small_db', table: 'users' },
        right: { source: 'large_db', table: 'orders' },
        joinType: 'INNER',
        on: { left: 'users.id', right: 'orders.user_id' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('broadcast')
      expect((strategy as BroadcastJoinStrategy).broadcastSide).toBe('left')
    })

    it('should select broadcast join when one table is small by byte size', () => {
      catalog.registerSource({ name: 'tiny', type: 'memory', config: {} })
      catalog.registerSource({ name: 'huge', type: 'memory', config: {} })

      // Small byte size (1MB) even with many rows
      catalog.registerStatistics('tiny', {
        tables: {
          lookups: { rowCount: 50_000, sizeBytes: 1_000_000 },
        },
      })
      catalog.registerStatistics('huge', {
        tables: {
          events: { rowCount: 10_000_000, sizeBytes: 5_000_000_000 },
        },
      })

      const input: JoinStrategyInput = {
        left: { source: 'huge', table: 'events' },
        right: { source: 'tiny', table: 'lookups' },
        joinType: 'INNER',
        on: { left: 'events.lookup_id', right: 'lookups.id' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('broadcast')
      expect((strategy as BroadcastJoinStrategy).broadcastSide).toBe('right')
    })

    it('should broadcast the smaller side in inner joins', () => {
      catalog.registerSource({ name: 'a', type: 'memory', config: {} })
      catalog.registerSource({ name: 'b', type: 'memory', config: {} })

      catalog.registerStatistics('a', {
        tables: { t1: { rowCount: 500, sizeBytes: 50_000 } },
      })
      catalog.registerStatistics('b', {
        tables: { t2: { rowCount: 10_000, sizeBytes: 1_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'a', table: 't1' },
        right: { source: 'b', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.id', right: 't2.fk' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('broadcast')
      // Left side is smaller, broadcast left
      expect((strategy as BroadcastJoinStrategy).broadcastSide).toBe('left')
    })

    it('should respect join type when selecting broadcast side for LEFT JOIN', () => {
      catalog.registerSource({ name: 'a', type: 'memory', config: {} })
      catalog.registerSource({ name: 'b', type: 'memory', config: {} })

      // Right is smaller, but this is a LEFT JOIN
      catalog.registerStatistics('a', {
        tables: { t1: { rowCount: 1_000, sizeBytes: 100_000 } },
      })
      catalog.registerStatistics('b', {
        tables: { t2: { rowCount: 100, sizeBytes: 10_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'a', table: 't1' },
        right: { source: 'b', table: 't2' },
        joinType: 'LEFT',
        on: { left: 't1.id', right: 't2.fk' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('broadcast')
      // For LEFT JOIN, must broadcast right side even though it's smaller
      expect((strategy as BroadcastJoinStrategy).broadcastSide).toBe('right')
    })
  })

  describe('shuffle join selection', () => {
    it('should select shuffle join when both tables are large', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: {
          orders: { rowCount: 10_000_000, sizeBytes: 2_000_000_000 },
        },
      })
      catalog.registerStatistics('db2', {
        tables: {
          line_items: { rowCount: 50_000_000, sizeBytes: 10_000_000_000 },
        },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'orders' },
        right: { source: 'db2', table: 'line_items' },
        joinType: 'INNER',
        on: { left: 'orders.id', right: 'line_items.order_id' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('shuffle')
    })

    it('should use partition count based on data size', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: {
          sales: { rowCount: 100_000_000, sizeBytes: 20_000_000_000 },
        },
      })
      catalog.registerStatistics('db2', {
        tables: {
          customers: { rowCount: 5_000_000, sizeBytes: 1_000_000_000 },
        },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'sales' },
        right: { source: 'db2', table: 'customers' },
        joinType: 'INNER',
        on: { left: 'sales.customer_id', right: 'customers.id' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('shuffle')
      // Partition count should scale with data size
      expect((strategy as ShuffleJoinStrategy).partitionCount).toBeGreaterThan(0)
    })

    it('should consider distinct counts for partition estimation', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: {
          events: {
            rowCount: 10_000_000,
            sizeBytes: 2_000_000_000,
            distinctCounts: { user_id: 100_000 },
          },
        },
      })
      catalog.registerStatistics('db2', {
        tables: {
          users: {
            rowCount: 100_000,
            sizeBytes: 50_000_000,
            distinctCounts: { id: 100_000 },
          },
        },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'events' },
        right: { source: 'db2', table: 'users' },
        joinType: 'INNER',
        on: { left: 'events.user_id', right: 'users.id' },
      }

      const strategy = selector.select(input)

      // Should use distinct counts to optimize partition selection
      if (strategy.type === 'shuffle') {
        expect((strategy as ShuffleJoinStrategy).partitionKey).toBeDefined()
      }
    })
  })

  describe('nested loop join selection', () => {
    it('should select nested loop for non-equi joins (less than)', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { ranges: { rowCount: 100, sizeBytes: 10_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { values: { rowCount: 1000, sizeBytes: 100_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'ranges' },
        right: { source: 'db2', table: 'values' },
        joinType: 'INNER',
        on: { left: 'ranges.max_value', right: 'values.amount', operator: '<' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('nested_loop')
    })

    it('should select nested loop for range joins', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { intervals: { rowCount: 500, sizeBytes: 50_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { points: { rowCount: 10_000, sizeBytes: 1_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'intervals' },
        right: { source: 'db2', table: 'points' },
        joinType: 'INNER',
        on: { left: 'intervals.start', right: 'points.ts', operator: '<=' },
        secondaryCondition: {
          left: 'intervals.end',
          right: 'points.ts',
          operator: '>=',
        },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('nested_loop')
    })

    it('should select nested loop as fallback for very small tables', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      // Both tables are tiny
      catalog.registerStatistics('db1', {
        tables: { config: { rowCount: 5, sizeBytes: 500 } },
      })
      catalog.registerStatistics('db2', {
        tables: { settings: { rowCount: 10, sizeBytes: 1_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'config' },
        right: { source: 'db2', table: 'settings' },
        joinType: 'INNER',
        on: { left: 'config.key', right: 'settings.config_key' },
      }

      const strategy = selector.select(input)

      // For very small tables, nested loop is efficient and avoids overhead
      expect(strategy.type).toBe('nested_loop')
      expect((strategy as NestedLoopJoinStrategy).outerSide).toBeDefined()
    })

    it('should place smaller table as outer in nested loop', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { small: { rowCount: 10, sizeBytes: 1_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { larger: { rowCount: 50, sizeBytes: 5_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'small' },
        right: { source: 'db2', table: 'larger' },
        joinType: 'INNER',
        on: { left: 'small.id', right: 'larger.small_id', operator: '<' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('nested_loop')
      expect((strategy as NestedLoopJoinStrategy).outerSide).toBe('left')
    })
  })

  describe('cost estimation', () => {
    it('should estimate broadcast join cost based on network transfer', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { small: { rowCount: 1_000, sizeBytes: 100_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { large: { rowCount: 1_000_000, sizeBytes: 100_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'small' },
        right: { source: 'db2', table: 'large' },
        joinType: 'INNER',
        on: { left: 'small.id', right: 'large.small_id' },
      }

      const cost = selector.estimateCost(input, { type: 'broadcast', broadcastSide: 'left' })

      expect(cost.networkBytes).toBeDefined()
      // Network bytes should be approximately the size of small table
      expect(cost.networkBytes).toBeLessThanOrEqual(100_000 + 100_000_000)
    })

    it('should estimate shuffle join cost with both-side transfer', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { t1: { rowCount: 5_000_000, sizeBytes: 500_000_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { t2: { rowCount: 10_000_000, sizeBytes: 1_000_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 't1' },
        right: { source: 'db2', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.key', right: 't2.key' },
      }

      const cost = selector.estimateCost(input, {
        type: 'shuffle',
        partitionCount: 16,
        partitionKey: 'key',
      })

      // Shuffle moves data from both sides
      expect(cost.networkBytes).toBeGreaterThan(500_000_000)
    })

    it('should estimate nested loop cost based on comparisons', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { outer: { rowCount: 100, sizeBytes: 10_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { inner: { rowCount: 1_000, sizeBytes: 100_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'outer' },
        right: { source: 'db2', table: 'inner' },
        joinType: 'INNER',
        on: { left: 'outer.val', right: 'inner.val', operator: '<' },
      }

      const cost = selector.estimateCost(input, {
        type: 'nested_loop',
        outerSide: 'left',
      })

      // Nested loop comparisons = outer rows * inner rows
      expect(cost.comparisons).toBe(100 * 1_000)
    })

    it('should compare costs across strategies and pick optimal', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { small: { rowCount: 500, sizeBytes: 50_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { medium: { rowCount: 100_000, sizeBytes: 10_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'small' },
        right: { source: 'db2', table: 'medium' },
        joinType: 'INNER',
        on: { left: 'small.id', right: 'medium.small_id' },
      }

      const strategy = selector.select(input)
      const selectedCost = selector.estimateCost(input, strategy)

      // Compare with alternative strategies
      const allStrategies = selector.allStrategies(input)
      for (const alt of allStrategies) {
        const altCost = selector.estimateCost(input, alt)
        expect(selectedCost.totalCost).toBeLessThanOrEqual(altCost.totalCost)
      }
    })
  })

  describe('network transfer optimization', () => {
    it('should minimize network bytes for co-located sources', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: { region: 'us-east-1' } })
      catalog.registerSource({ name: 'db2', type: 'memory', config: { region: 'us-east-1' } })

      catalog.registerStatistics('db1', {
        tables: { t1: { rowCount: 10_000, sizeBytes: 1_000_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { t2: { rowCount: 50_000, sizeBytes: 5_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 't1' },
        right: { source: 'db2', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.id', right: 't2.t1_id' },
      }

      const strategy = selector.select(input)
      const cost = selector.estimateCost(input, strategy)

      // Co-located sources should have lower network cost
      expect(cost.networkLatencyFactor).toBeLessThanOrEqual(1.0)
    })

    it('should account for cross-region latency', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: { region: 'us-east-1' } })
      catalog.registerSource({ name: 'db2', type: 'memory', config: { region: 'eu-west-1' } })

      catalog.registerStatistics('db1', {
        tables: { t1: { rowCount: 10_000, sizeBytes: 1_000_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { t2: { rowCount: 50_000, sizeBytes: 5_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 't1' },
        right: { source: 'db2', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.id', right: 't2.t1_id' },
      }

      const strategy = selector.select(input)
      const cost = selector.estimateCost(input, strategy)

      // Cross-region should have higher latency factor
      expect(cost.networkLatencyFactor).toBeGreaterThan(1.0)
    })

    it('should prefer moving smaller data across regions', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: { region: 'us-east-1' } })
      catalog.registerSource({ name: 'db2', type: 'memory', config: { region: 'eu-west-1' } })

      // Small table in remote region
      catalog.registerStatistics('db1', {
        tables: { large: { rowCount: 10_000_000, sizeBytes: 1_000_000_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { small: { rowCount: 1_000, sizeBytes: 100_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'large' },
        right: { source: 'db2', table: 'small' },
        joinType: 'INNER',
        on: { left: 'large.small_id', right: 'small.id' },
      }

      const strategy = selector.select(input)

      expect(strategy.type).toBe('broadcast')
      // Should broadcast the small remote table, not the large local one
      expect((strategy as BroadcastJoinStrategy).broadcastSide).toBe('right')
    })
  })

  describe('source capability consideration', () => {
    it('should fall back to nested loop when source cannot hash', () => {
      const limitedAdapter: SourceAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: false,
          aggregationPushdown: false,
          joinPushdown: false,
          // No hash capability
        }),
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      catalog.registerSource({ name: 'limited', type: 'rest', config: {} })
      catalog.registerSource({ name: 'normal', type: 'memory', config: {} })
      catalog.attachAdapter('limited', limitedAdapter)
      catalog.attachAdapter('normal', createMemoryAdapter({}))

      catalog.registerStatistics('limited', {
        tables: { t1: { rowCount: 50_000, sizeBytes: 5_000_000 } },
      })
      catalog.registerStatistics('normal', {
        tables: { t2: { rowCount: 100_000, sizeBytes: 10_000_000 } },
      })

      // Both tables too large for broadcast, but limited can't do shuffle
      const input: JoinStrategyInput = {
        left: { source: 'limited', table: 't1' },
        right: { source: 'normal', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.id', right: 't2.t1_id' },
        sourceCapabilities: {
          limited: { canHash: false, canStream: true },
          normal: { canHash: true, canStream: true },
        },
      }

      const strategy = selector.select(input)

      // Should use broadcast or nested loop, not shuffle
      expect(strategy.type).not.toBe('shuffle')
    })

    it('should use streaming for large nested loop when supported', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })

      catalog.registerStatistics('db1', {
        tables: { ranges: { rowCount: 1_000, sizeBytes: 100_000 } },
      })
      catalog.registerStatistics('db2', {
        tables: { points: { rowCount: 100_000, sizeBytes: 10_000_000 } },
      })

      const input: JoinStrategyInput = {
        left: { source: 'db1', table: 'ranges' },
        right: { source: 'db2', table: 'points' },
        joinType: 'INNER',
        on: { left: 'ranges.end', right: 'points.ts', operator: '>=' },
        sourceCapabilities: {
          db1: { canHash: true, canStream: true },
          db2: { canHash: true, canStream: true },
        },
      }

      const strategy = selector.select(input)

      if (strategy.type === 'nested_loop') {
        expect((strategy as NestedLoopJoinStrategy).streamInner).toBe(true)
      }
    })
  })

  describe('default statistics handling', () => {
    it('should use default estimates when statistics unavailable', () => {
      catalog.registerSource({ name: 'unknown1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'unknown2', type: 'memory', config: {} })
      // No statistics registered

      const input: JoinStrategyInput = {
        left: { source: 'unknown1', table: 'mystery' },
        right: { source: 'unknown2', table: 'enigma' },
        joinType: 'INNER',
        on: { left: 'mystery.id', right: 'enigma.mystery_id' },
      }

      // Should not throw, use conservative defaults
      const strategy = selector.select(input)

      expect(strategy).toBeDefined()
      expect(['broadcast', 'shuffle', 'nested_loop']).toContain(strategy.type)
    })

    it('should prefer shuffle when statistics are missing (conservative)', () => {
      catalog.registerSource({ name: 'unknown1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'unknown2', type: 'memory', config: {} })

      const input: JoinStrategyInput = {
        left: { source: 'unknown1', table: 't1' },
        right: { source: 'unknown2', table: 't2' },
        joinType: 'INNER',
        on: { left: 't1.id', right: 't2.fk' },
      }

      const strategy = selector.select(input)

      // Conservative choice: shuffle handles unknown sizes safely
      expect(strategy.type).toBe('shuffle')
    })
  })
})

// =============================================================================
// Threshold Constants Tests
// =============================================================================

describe('Join Strategy Thresholds', () => {
  it('should export broadcast threshold constants', () => {
    // Broadcast threshold for row count (e.g., 10,000 rows)
    expect(BROADCAST_THRESHOLD_ROWS).toBeDefined()
    expect(typeof BROADCAST_THRESHOLD_ROWS).toBe('number')
    expect(BROADCAST_THRESHOLD_ROWS).toBeGreaterThan(0)

    // Broadcast threshold for byte size (e.g., 10MB)
    expect(BROADCAST_THRESHOLD_BYTES).toBeDefined()
    expect(typeof BROADCAST_THRESHOLD_BYTES).toBe('number')
    expect(BROADCAST_THRESHOLD_BYTES).toBeGreaterThan(0)
  })
})
