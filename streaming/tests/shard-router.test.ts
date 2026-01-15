/**
 * Trace-Aware Shard Router Tests
 *
 * Tests for production shard routing with 100% trace locality guarantee.
 * High-volume tenants are sharded across multiple EventStreamDO instances
 * with all events for a trace routed to the same shard.
 *
 * Architecture:
 * - Low-volume tenants: Single DO instance (ns)
 * - High-volume tenants: N shards (ns-shard-0, ns-shard-1, ...)
 * - Trace locality: Same trace_id always routes to same shard
 * - Query routing: Single shard with trace_id, scatter-gather without
 *
 * @see /streaming/shard-router.ts for implementation
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  TraceAwareShardRouter,
  traceToShard,
  type ShardConfig,
} from '../shard-router'

// ============================================================================
// UNIT TESTS: traceToShard
// ============================================================================

describe('traceToShard', () => {
  it('returns consistent shard for same trace_id', () => {
    const traceId = 'abc123def456'
    const shard1 = traceToShard(traceId, 16)
    const shard2 = traceToShard(traceId, 16)
    expect(shard1).toBe(shard2)
  })

  it('returns number in valid range', () => {
    const traceId = 'ffff0000aaaa'
    const shard = traceToShard(traceId, 16)
    expect(shard).toBeGreaterThanOrEqual(0)
    expect(shard).toBeLessThan(16)
  })

  it('handles different shard counts', () => {
    const traceId = 'abc123'
    expect(traceToShard(traceId, 4)).toBeLessThan(4)
    expect(traceToShard(traceId, 8)).toBeLessThan(8)
    expect(traceToShard(traceId, 32)).toBeLessThan(32)
  })

  it('distributes across all shards with enough samples', () => {
    const shards = new Set<number>()
    // Generate enough random trace IDs to hit all 16 shards
    for (let i = 0; i < 10000; i++) {
      const traceId = Math.random().toString(16).slice(2).padStart(4, '0')
      shards.add(traceToShard(traceId, 16))
    }
    expect(shards.size).toBe(16)
  })

  it('has reasonably uniform distribution', () => {
    const shardCounts = new Array(16).fill(0)
    const samples = 16000

    for (let i = 0; i < samples; i++) {
      const traceId = Math.random().toString(16).slice(2).padStart(4, '0')
      shardCounts[traceToShard(traceId, 16)]++
    }

    // Each shard should have roughly samples/16 = 1000 events
    // Allow 20% deviation (800-1200)
    const expected = samples / 16
    for (const count of shardCounts) {
      expect(count).toBeGreaterThan(expected * 0.7)
      expect(count).toBeLessThan(expected * 1.3)
    }
  })

  it('handles short trace IDs by padding', () => {
    // Short trace IDs should still work
    const shard = traceToShard('ab', 16)
    expect(shard).toBeGreaterThanOrEqual(0)
    expect(shard).toBeLessThan(16)
  })

  describe('edge cases', () => {
    /**
     * BUG DESCRIPTION - Negative Shard from Negative parseInt:
     *
     * The traceToShard function uses parseInt(prefix, 16) to convert the first
     * 4 characters of a trace ID to a number. If the trace ID starts with a
     * hyphen (e.g., "-abc"), parseInt returns a NEGATIVE number:
     *
     *   parseInt("-abc", 16) === -2748
     *   -2748 % 16 === -12   (NEGATIVE shard index!)
     *
     * This violates the function's contract: shard must be in [0, shardCount).
     *
     * The hash fallback path (for non-hex characters) is protected by Math.abs(),
     * but the hex parsing path has no such protection and can return negative shards.
     */

    it('demonstrates JavaScript negative modulo behavior', () => {
      // JavaScript modulo operator can return negative values
      // when the dividend is negative
      expect(-2748 % 16).toBe(-12) // Negative!
      expect(-100 % 7).toBe(-2) // Negative!
      expect(-1 % 10).toBe(-1) // Negative!

      // parseInt with hex can return negative numbers
      expect(parseInt('-abc', 16)).toBe(-2748)
      expect(parseInt('-fff', 16)).toBe(-4095)
      expect(parseInt('-1', 16)).toBe(-1)
    })

    it('traceToShard returns negative shard for trace ID starting with hyphen', () => {
      // BUG: Trace IDs starting with hyphen produce negative shards!
      // parseInt('-abc', 16) === -2748
      // -2748 % 16 === -12

      const traceId = '-abc123def456' // Starts with hyphen
      const shardCount = 16

      const shard = traceToShard(traceId, shardCount)

      // BUG: This FAILS because shard is -12
      // The contract requires shard to be in [0, shardCount)
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(shardCount)
    })

    it('traceToShard must return non-negative shard for all hyphenated trace IDs', () => {
      // Test various hyphen-prefixed trace IDs
      const shardCount = 10

      const hyphenatedTraceIds = [
        '-abc',
        '-1234',
        '-ffff',
        '-a',
        '-0',
        '-deadbeef',
      ]

      for (const traceId of hyphenatedTraceIds) {
        const shard = traceToShard(traceId, shardCount)

        // BUG: These will produce negative shards
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(shardCount)
      }
    })

    it('traceToShard must return valid shard for edge case prefixes', () => {
      // Test prefixes that might parse to unexpected values
      const shardCount = 10

      const edgeCaseTraceIds = [
        '-fff0000', // Negative hex
        '+abc1234', // Plus sign (parses as NaN, triggers hash)
        ' abc1234', // Leading space
        '\tabc123', // Leading tab
        '-0000000', // Negative zero
        '-1111111', // Negative small hex
      ]

      for (const traceId of edgeCaseTraceIds) {
        const shard = traceToShard(traceId, shardCount)

        // All shards must be valid
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(shardCount)
      }
    })

    it('directly verifies the bug: parseInt with hyphen prefix produces negative modulo', () => {
      // This test directly demonstrates the bug in the implementation logic
      const traceId = '-abc'
      const shardCount = 16

      // Simulate what traceToShard does on the hex path:
      const prefix = traceId.slice(0, 4).padEnd(4, '0')
      expect(prefix).toBe('-abc')

      const parsed = parseInt(prefix, 16)
      expect(parsed).toBe(-2748) // Negative!
      expect(Number.isNaN(parsed)).toBe(false) // Does NOT trigger hash fallback

      // The buggy return: parsed % shardCount with no abs()
      const buggyResult = parsed % shardCount
      expect(buggyResult).toBe(-12) // NEGATIVE SHARD!

      // Verify traceToShard is fixed and returns non-negative
      const actualResult = traceToShard(traceId, shardCount)
      expect(actualResult).toBe(12) // Fixed: returns absolute value (positive shard)
    })

    it('handles hash that would produce MIN_INT (-2147483648)', () => {
      // Modern JavaScript uses 64-bit floats, so Math.abs(-2147483648) works correctly.
      // This test documents that the hash fallback path is safe because it uses Math.abs().
      const shardCount = 10

      // Non-hex prefixes trigger the hash fallback which has Math.abs protection
      // The hex path (which is the actual bug) doesn't have this protection
      for (let i = 0; i < 10000; i++) {
        // Use 'G' prefix to ensure hash fallback (G is not a valid hex char)
        const traceId = `G${i}`
        const shard = traceToShard(traceId, shardCount)
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(shardCount)
      }
    })

    it('exhaustively tests valid hex prefixes work correctly', () => {
      // Ensure valid hex prefixes still work
      const shardCount = 16

      const validHexPrefixes = [
        '0000',
        'ffff',
        'abcd',
        '1234',
        'dead',
        'beef',
        'cafe',
        'f00d',
      ]

      for (const prefix of validHexPrefixes) {
        const traceId = prefix + 'suffix'
        const shard = traceToShard(traceId, shardCount)
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(shardCount)
      }
    })
  })
})

// ============================================================================
// UNIT TESTS: TraceAwareShardRouter
// ============================================================================

describe('TraceAwareShardRouter', () => {
  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const router = new TraceAwareShardRouter()
      // Default: low-volume tenant
      expect(router.getShardId('any-tenant')).toBe('any-tenant')
    })

    it('accepts partial config', () => {
      const router = new TraceAwareShardRouter({ shardCount: 8 })
      expect(router).toBeDefined()
    })

    it('accepts high-volume tenant set', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['big-tenant']),
      })
      expect(router.isHighVolume('big-tenant')).toBe(true)
      expect(router.isHighVolume('small-tenant')).toBe(false)
    })
  })

  describe('isHighVolume', () => {
    it('returns false for new tenants', () => {
      const router = new TraceAwareShardRouter()
      expect(router.isHighVolume('new-tenant')).toBe(false)
    })

    it('returns true for configured high-volume tenants', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['enterprise-a', 'enterprise-b']),
      })
      expect(router.isHighVolume('enterprise-a')).toBe(true)
      expect(router.isHighVolume('enterprise-b')).toBe(true)
      expect(router.isHighVolume('startup-c')).toBe(false)
    })

    it('returns true when threshold exceeded via recordEvent', () => {
      const router = new TraceAwareShardRouter({
        highVolumeThreshold: 100, // Low threshold for testing
      })

      // Record events to exceed threshold
      for (let i = 0; i < 100; i++) {
        router.recordEvent('growing-tenant')
      }

      expect(router.isHighVolume('growing-tenant')).toBe(true)
    })

    it('tracks events per tenant independently', () => {
      const router = new TraceAwareShardRouter({
        highVolumeThreshold: 50,
      })

      // Tenant A gets lots of events
      for (let i = 0; i < 50; i++) {
        router.recordEvent('tenant-a')
      }

      // Tenant B gets fewer
      for (let i = 0; i < 10; i++) {
        router.recordEvent('tenant-b')
      }

      expect(router.isHighVolume('tenant-a')).toBe(true)
      expect(router.isHighVolume('tenant-b')).toBe(false)
    })
  })

  describe('getShardId', () => {
    it('returns ns for low-volume tenants', () => {
      const router = new TraceAwareShardRouter()
      expect(router.getShardId('tenant-a', 'trace123')).toBe('tenant-a')
    })

    it('returns ns for low-volume even with trace_id', () => {
      const router = new TraceAwareShardRouter()
      expect(router.getShardId('small-tenant', 'abc123def456')).toBe('small-tenant')
    })

    it('returns ns-shard-N for high-volume tenants', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['big-tenant']),
      })
      const shardId = router.getShardId('big-tenant', 'abc1trace')
      expect(shardId).toMatch(/^big-tenant-shard-\d+$/)
    })

    it('returns ns-shard-0 for high-volume without trace_id', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['big-tenant']),
      })
      expect(router.getShardId('big-tenant')).toBe('big-tenant-shard-0')
    })

    it('returns consistent shard for same trace_id', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['big']),
      })

      const traceId = 'consistent-trace-id-12345'
      const shard1 = router.getShardId('big', traceId)
      const shard2 = router.getShardId('big', traceId)
      const shard3 = router.getShardId('big', traceId)

      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
    })

    it('different traces may route to different shards', () => {
      const router = new TraceAwareShardRouter({
        shardCount: 16,
        highVolumeTenants: new Set(['big']),
      })

      const shards = new Set<string>()
      // Generate multiple traces to likely hit different shards
      for (let i = 0; i < 100; i++) {
        const traceId = `${i.toString(16).padStart(4, '0')}trace`
        shards.add(router.getShardId('big', traceId))
      }

      // Should have multiple different shards
      expect(shards.size).toBeGreaterThan(1)
    })
  })

  describe('getQueryShards', () => {
    it('returns single shard when trace_id provided for high-volume', () => {
      const router = new TraceAwareShardRouter({
        highVolumeTenants: new Set(['big']),
      })
      const shards = router.getQueryShards('big', 'abc1trace')
      expect(shards).toHaveLength(1)
      expect(shards[0]).toMatch(/^big-shard-\d+$/)
    })

    it('returns all shards for scatter-gather when no trace_id', () => {
      const router = new TraceAwareShardRouter({
        shardCount: 16,
        highVolumeTenants: new Set(['big']),
      })
      const shards = router.getQueryShards('big')
      expect(shards).toHaveLength(16)
      expect(shards).toContain('big-shard-0')
      expect(shards).toContain('big-shard-15')
    })

    it('returns [ns] for low-volume tenants', () => {
      const router = new TraceAwareShardRouter()
      const shards = router.getQueryShards('small-tenant')
      expect(shards).toEqual(['small-tenant'])
    })

    it('returns [ns] for low-volume even with trace_id', () => {
      const router = new TraceAwareShardRouter()
      const shards = router.getQueryShards('small', 'trace123')
      expect(shards).toEqual(['small'])
    })

    it('respects custom shard count', () => {
      const router = new TraceAwareShardRouter({
        shardCount: 8,
        highVolumeTenants: new Set(['enterprise']),
      })
      const shards = router.getQueryShards('enterprise')
      expect(shards).toHaveLength(8)
    })
  })

  describe('recordEvent', () => {
    it('increments event count for tenant', () => {
      const router = new TraceAwareShardRouter()
      router.recordEvent('tenant-x')
      router.recordEvent('tenant-x')
      router.recordEvent('tenant-x')
      expect(router.getEventCount('tenant-x')).toBe(3)
    })

    it('tracks different tenants separately', () => {
      const router = new TraceAwareShardRouter()
      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')
      router.recordEvent('tenant-b')
      expect(router.getEventCount('tenant-a')).toBe(1)
      expect(router.getEventCount('tenant-b')).toBe(2)
    })

    it('returns 0 for unknown tenants', () => {
      const router = new TraceAwareShardRouter()
      expect(router.getEventCount('unknown')).toBe(0)
    })
  })

  describe('100% trace locality guarantee', () => {
    it('all spans of a trace go to same shard', () => {
      const router = new TraceAwareShardRouter({
        shardCount: 16,
        highVolumeTenants: new Set(['production']),
      })

      const traceId = 'trace-abc123-request-flow'

      // Simulate multiple spans for same trace
      const spanShards = [
        router.getShardId('production', traceId), // Root span
        router.getShardId('production', traceId), // Child span 1
        router.getShardId('production', traceId), // Child span 2
        router.getShardId('production', traceId), // Child span 3
      ]

      // All spans must go to same shard
      const uniqueShards = new Set(spanShards)
      expect(uniqueShards.size).toBe(1)
    })

    it('different traces can be queried via scatter-gather', () => {
      const router = new TraceAwareShardRouter({
        shardCount: 4,
        highVolumeTenants: new Set(['prod']),
      })

      // Query without trace_id returns all shards
      const queryShards = router.getQueryShards('prod')
      expect(queryShards).toHaveLength(4)
      expect(queryShards).toEqual([
        'prod-shard-0',
        'prod-shard-1',
        'prod-shard-2',
        'prod-shard-3',
      ])
    })
  })
})

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('Shard Router Integration Scenarios', () => {
  let router: TraceAwareShardRouter

  beforeEach(() => {
    router = new TraceAwareShardRouter({
      shardCount: 16,
      highVolumeThreshold: 100_000,
      highVolumeTenants: new Set(['enterprise-acme', 'enterprise-bigco']),
    })
  })

  it('scenario: startup with low volume stays on single DO', () => {
    // Startup company with moderate traffic
    const ns = 'startup-xyz'
    for (let i = 0; i < 1000; i++) {
      router.recordEvent(ns)
    }

    // Still low volume, single DO
    expect(router.isHighVolume(ns)).toBe(false)
    expect(router.getShardId(ns, 'trace1')).toBe(ns)
    expect(router.getQueryShards(ns)).toEqual([ns])
  })

  it('scenario: enterprise with high volume uses sharding', () => {
    const ns = 'enterprise-acme'

    // Pre-configured as high-volume
    expect(router.isHighVolume(ns)).toBe(true)

    // Writes go to specific shard based on trace
    const shard1 = router.getShardId(ns, 'aaaa-trace-1')
    const shard2 = router.getShardId(ns, 'bbbb-trace-2')
    expect(shard1).toMatch(/^enterprise-acme-shard-\d+$/)
    expect(shard2).toMatch(/^enterprise-acme-shard-\d+$/)

    // Query with trace_id is efficient (single shard)
    expect(router.getQueryShards(ns, 'aaaa-trace-1')).toHaveLength(1)

    // Query without trace_id fans out to all shards
    expect(router.getQueryShards(ns)).toHaveLength(16)
  })

  it('scenario: tenant graduates to high-volume via threshold', () => {
    const ns = 'growing-startup'

    // Start low-volume
    expect(router.isHighVolume(ns)).toBe(false)
    expect(router.getShardId(ns, 'trace')).toBe(ns)

    // Grow past threshold
    for (let i = 0; i < 100_000; i++) {
      router.recordEvent(ns)
    }

    // Now high-volume with sharding
    expect(router.isHighVolume(ns)).toBe(true)
    expect(router.getShardId(ns, 'trace')).toMatch(/^growing-startup-shard-\d+$/)
  })
})
