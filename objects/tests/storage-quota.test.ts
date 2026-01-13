/**
 * Storage Quota Monitor Tests
 *
 * RED TDD: Tests for StorageQuotaMonitor - monitors DO storage usage
 * and emits warnings at 80% threshold before hitting Cloudflare limits.
 *
 * Cloudflare DO Storage Limits:
 * - 128KB max per value
 * - 128 keys max per batch operation
 * - Total DO storage varies by plan (~256KB-1GB)
 *
 * The StorageQuotaMonitor provides:
 * - Real-time tracking of storage usage by key
 * - Warnings at 80% of per-value limit (128KB)
 * - Warnings at 80% of batch limit (128 keys)
 * - Total usage statistics (used/total/percentage)
 * - Event emission for observability
 * - Pre-write validation to prevent limit violations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the implementation (will fail until implemented)
import {
  StorageQuotaMonitor,
  type QuotaWarning,
  type QuotaWarningType,
  type UsageStats,
  STORAGE_LIMITS,
} from '../StorageQuotaMonitor'

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024
const MAX_VALUE_SIZE = 128 * KB // 128KB per value
const MAX_BATCH_KEYS = 128 // 128 keys per batch
const WARNING_THRESHOLD = 0.8 // 80%

// ============================================================================
// TEST SUITE
// ============================================================================

describe('StorageQuotaMonitor', () => {
  let monitor: StorageQuotaMonitor

  beforeEach(() => {
    monitor = new StorageQuotaMonitor()
  })

  // ==========================================================================
  // 1. STORAGE LIMITS CONSTANTS
  // ==========================================================================

  describe('Storage Limits Constants', () => {
    it('exports correct per-value limit (128KB)', () => {
      expect(STORAGE_LIMITS.MAX_VALUE_SIZE).toBe(128 * KB)
    })

    it('exports correct batch key limit (128 keys)', () => {
      expect(STORAGE_LIMITS.MAX_BATCH_KEYS).toBe(128)
    })

    it('exports correct warning threshold (80%)', () => {
      expect(STORAGE_LIMITS.WARNING_THRESHOLD).toBe(0.8)
    })

    it('exports value warning threshold (102.4KB = 80% of 128KB)', () => {
      expect(STORAGE_LIMITS.VALUE_WARNING_THRESHOLD).toBe(Math.floor(128 * KB * 0.8))
    })

    it('exports batch warning threshold (102 keys = 80% of 128)', () => {
      expect(STORAGE_LIMITS.BATCH_WARNING_THRESHOLD).toBe(Math.floor(128 * 0.8))
    })
  })

  // ==========================================================================
  // 2. CURRENT STORAGE USAGE TRACKING
  // ==========================================================================

  describe('Storage Usage Tracking', () => {
    it('tracks bytes used for a single key', () => {
      const value = { name: 'test', data: 'x'.repeat(1000) }

      monitor.trackPut('key1', value)

      const usage = monitor.getKeyUsage('key1')
      expect(usage).toBeGreaterThan(1000) // At least the data size
    })

    it('updates usage when key is overwritten', () => {
      monitor.trackPut('key1', { small: 'data' })
      const usage1 = monitor.getKeyUsage('key1')

      monitor.trackPut('key1', { larger: 'x'.repeat(5000) })
      const usage2 = monitor.getKeyUsage('key1')

      expect(usage2).toBeGreaterThan(usage1!)
    })

    it('removes usage when key is deleted', () => {
      monitor.trackPut('key1', { data: 'test' })
      expect(monitor.getKeyUsage('key1')).toBeGreaterThan(0)

      monitor.trackDelete('key1')

      expect(monitor.getKeyUsage('key1')).toBeUndefined()
    })

    it('tracks total bytes across all keys', () => {
      monitor.trackPut('key1', { data: 'a'.repeat(100) })
      monitor.trackPut('key2', { data: 'b'.repeat(200) })
      monitor.trackPut('key3', { data: 'c'.repeat(300) })

      const stats = monitor.getUsageStats()

      expect(stats.totalBytes).toBeGreaterThan(600)
      expect(stats.keyCount).toBe(3)
    })

    it('tracks key count accurately', () => {
      monitor.trackPut('a', 1)
      monitor.trackPut('b', 2)
      monitor.trackPut('c', 3)
      monitor.trackDelete('b')

      const stats = monitor.getUsageStats()

      expect(stats.keyCount).toBe(2)
    })

    it('resets tracking on clear', () => {
      monitor.trackPut('key1', { data: 'test' })
      monitor.trackPut('key2', { data: 'test' })

      monitor.clear()

      const stats = monitor.getUsageStats()
      expect(stats.totalBytes).toBe(0)
      expect(stats.keyCount).toBe(0)
    })
  })

  // ==========================================================================
  // 3. PER-VALUE SIZE WARNINGS (128KB limit)
  // ==========================================================================

  describe('Per-Value Size Warnings', () => {
    it('returns null when value is under warning threshold', () => {
      const smallValue = { data: 'x'.repeat(50 * KB) } // 50KB

      const warning = monitor.checkBeforeWrite('key', smallValue)

      expect(warning).toBeNull()
    })

    it('warns when value approaches 80% of limit', () => {
      // 80% of 128KB = ~102KB
      const largeValue = { data: 'x'.repeat(105 * KB) }

      const warning = monitor.checkBeforeWrite('key', largeValue)

      expect(warning).not.toBeNull()
      expect(warning!.type).toBe('value_size')
      expect(warning!.key).toBe('key')
      expect(warning!.percentage).toBeGreaterThanOrEqual(80)
    })

    it('warns when value exceeds limit', () => {
      const oversizedValue = { data: 'x'.repeat(130 * KB) }

      const warning = monitor.checkBeforeWrite('key', oversizedValue)

      expect(warning).not.toBeNull()
      expect(warning!.type).toBe('value_size')
      expect(warning!.percentage).toBeGreaterThan(100)
      expect(warning!.wouldExceedLimit).toBe(true)
    })

    it('includes current usage and limit in warning', () => {
      const largeValue = { data: 'x'.repeat(110 * KB) }

      const warning = monitor.checkBeforeWrite('key', largeValue)

      expect(warning!.currentUsage).toBeGreaterThan(110 * KB)
      expect(warning!.limit).toBe(128 * KB)
    })

    it('calculates size correctly for complex nested objects', () => {
      const complexValue = {
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          settings: { theme: 'dark', notifications: true },
        })),
        metadata: {
          created: new Date().toISOString(),
          version: 1,
        },
      }

      const size = monitor.calculateSize(complexValue)

      expect(size).toBeGreaterThan(0)
      expect(typeof size).toBe('number')
    })

    it('handles ArrayBuffer and typed arrays', () => {
      const buffer = new ArrayBuffer(10000)
      const typedArray = new Uint8Array(5000)

      const bufferSize = monitor.calculateSize(buffer)
      const typedSize = monitor.calculateSize(typedArray)

      expect(bufferSize).toBeGreaterThanOrEqual(10000)
      expect(typedSize).toBeGreaterThanOrEqual(5000)
    })
  })

  // ==========================================================================
  // 4. BATCH SIZE WARNINGS (128 keys limit)
  // ==========================================================================

  describe('Batch Size Warnings', () => {
    it('returns null when batch is under warning threshold', () => {
      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 50; i++) {
        batch[`key${i}`] = { value: i }
      }

      const warning = monitor.checkBatchBeforeWrite(batch)

      expect(warning).toBeNull()
    })

    it('warns when batch approaches 80% of key limit', () => {
      const batch: Record<string, unknown> = {}
      // 80% of 128 = 102.4, so 103+ keys should warn
      for (let i = 0; i < 105; i++) {
        batch[`key${i}`] = { value: i }
      }

      const warning = monitor.checkBatchBeforeWrite(batch)

      expect(warning).not.toBeNull()
      expect(warning!.type).toBe('batch_size')
      expect(warning!.percentage).toBeGreaterThanOrEqual(80)
    })

    it('warns when batch exceeds limit', () => {
      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 150; i++) {
        batch[`key${i}`] = { value: i }
      }

      const warning = monitor.checkBatchBeforeWrite(batch)

      expect(warning).not.toBeNull()
      expect(warning!.type).toBe('batch_size')
      expect(warning!.wouldExceedLimit).toBe(true)
      expect(warning!.percentage).toBeGreaterThan(100)
    })

    it('includes key count in batch warning', () => {
      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 110; i++) {
        batch[`key${i}`] = { value: i }
      }

      const warning = monitor.checkBatchBeforeWrite(batch)

      expect(warning!.currentUsage).toBe(110)
      expect(warning!.limit).toBe(128)
    })

    it('also checks individual value sizes in batch', () => {
      const batch: Record<string, unknown> = {
        small: { data: 'small' },
        large: { data: 'x'.repeat(130 * KB) }, // Over 128KB
      }

      const warnings = monitor.checkBatchBeforeWriteAll(batch)

      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.type === 'value_size' && w.key === 'large')).toBe(true)
    })
  })

  // ==========================================================================
  // 5. TOTAL USAGE WARNINGS
  // ==========================================================================

  describe('Total Usage Warnings', () => {
    it('provides usage statistics', () => {
      monitor.trackPut('key1', { data: 'test1' })
      monitor.trackPut('key2', { data: 'test2' })

      const stats = monitor.getUsageStats()

      expect(stats).toHaveProperty('totalBytes')
      expect(stats).toHaveProperty('keyCount')
      expect(stats).toHaveProperty('percentage')
      expect(stats).toHaveProperty('limit')
    })

    it('calculates percentage correctly', () => {
      // Set a custom total limit for testing
      const customMonitor = new StorageQuotaMonitor({ totalLimit: 1000 })

      customMonitor.trackPut('key1', { data: 'x'.repeat(400) }) // ~400 bytes + overhead

      const stats = customMonitor.getUsageStats()

      expect(stats.percentage).toBeGreaterThan(0)
      expect(stats.percentage).toBeLessThan(100)
    })

    it('warns at 80% of total storage limit', () => {
      const customMonitor = new StorageQuotaMonitor({ totalLimit: 1000 })

      // Fill to ~85%
      customMonitor.trackPut('large', { data: 'x'.repeat(800) })

      const stats = customMonitor.getUsageStats()

      expect(stats.isWarning).toBe(true)
      expect(stats.percentage).toBeGreaterThanOrEqual(80)
    })

    it('returns largest keys for debugging', () => {
      monitor.trackPut('small', { data: 'x'.repeat(100) })
      monitor.trackPut('medium', { data: 'x'.repeat(1000) })
      monitor.trackPut('large', { data: 'x'.repeat(10000) })

      const largest = monitor.getLargestKeys(2)

      expect(largest.length).toBe(2)
      expect(largest[0].key).toBe('large')
      expect(largest[1].key).toBe('medium')
    })
  })

  // ==========================================================================
  // 6. QUOTA EVENT EMISSION
  // ==========================================================================

  describe('Quota Event Emission', () => {
    it('emits warning event when threshold crossed', () => {
      const callback = vi.fn()
      monitor.onWarning(callback)

      const largeValue = { data: 'x'.repeat(110 * KB) }
      monitor.checkBeforeWrite('key', largeValue)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'value_size',
          key: 'key',
        }),
      )
    })

    it('emits event for batch warnings', () => {
      const callback = vi.fn()
      monitor.onWarning(callback)

      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 110; i++) {
        batch[`key${i}`] = { value: i }
      }
      monitor.checkBatchBeforeWrite(batch)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'batch_size',
        }),
      )
    })

    it('supports multiple warning callbacks', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      monitor.onWarning(callback1)
      monitor.onWarning(callback2)

      const largeValue = { data: 'x'.repeat(110 * KB) }
      monitor.checkBeforeWrite('key', largeValue)

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()
    })

    it('allows removing warning callbacks', () => {
      const callback = vi.fn()
      const unsubscribe = monitor.onWarning(callback)

      unsubscribe()

      const largeValue = { data: 'x'.repeat(110 * KB) }
      monitor.checkBeforeWrite('key', largeValue)

      expect(callback).not.toHaveBeenCalled()
    })

    it('includes timestamp in warning events', () => {
      const callback = vi.fn()
      monitor.onWarning(callback)

      const largeValue = { data: 'x'.repeat(110 * KB) }
      monitor.checkBeforeWrite('key', largeValue)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
        }),
      )
    })

    it('emits total_usage warning when approaching limit', () => {
      const callback = vi.fn()
      const customMonitor = new StorageQuotaMonitor({ totalLimit: 1000 })
      customMonitor.onWarning(callback)

      // Add enough to cross 80% threshold
      customMonitor.trackPut('large', { data: 'x'.repeat(850) })

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'total_usage',
        }),
      )
    })
  })

  // ==========================================================================
  // 7. USAGE STATS API
  // ==========================================================================

  describe('Usage Stats API', () => {
    it('returns complete usage statistics', () => {
      monitor.trackPut('key1', { data: 'test1' })
      monitor.trackPut('key2', { data: 'test2' })

      const stats: UsageStats = monitor.getUsageStats()

      expect(stats.totalBytes).toBeGreaterThan(0)
      expect(stats.keyCount).toBe(2)
      expect(stats.percentage).toBeGreaterThanOrEqual(0)
      expect(stats.limit).toBeGreaterThan(0)
      expect(typeof stats.isWarning).toBe('boolean')
    })

    it('provides per-key breakdown', () => {
      monitor.trackPut('key1', { data: 'a'.repeat(100) })
      monitor.trackPut('key2', { data: 'b'.repeat(200) })

      const breakdown = monitor.getKeyBreakdown()

      expect(breakdown).toHaveProperty('key1')
      expect(breakdown).toHaveProperty('key2')
      expect(breakdown['key2']).toBeGreaterThan(breakdown['key1'])
    })

    it('provides stats snapshot for observability', () => {
      monitor.trackPut('key1', { data: 'test' })

      const snapshot = monitor.getSnapshot()

      expect(snapshot).toHaveProperty('timestamp')
      expect(snapshot).toHaveProperty('stats')
      expect(snapshot).toHaveProperty('largestKeys')
      expect(snapshot.stats.keyCount).toBe(1)
    })
  })

  // ==========================================================================
  // 8. INTEGRATION WITH STORAGE OPERATIONS
  // ==========================================================================

  describe('Storage Operation Integration', () => {
    it('provides wrapper for put operations', async () => {
      const mockStorage = {
        put: vi.fn(),
      }

      const wrappedPut = monitor.wrapPut(mockStorage.put.bind(mockStorage))

      await wrappedPut('key', { data: 'test' })

      expect(mockStorage.put).toHaveBeenCalledWith('key', { data: 'test' })
      expect(monitor.getKeyUsage('key')).toBeGreaterThan(0)
    })

    it('wrapper throws when value would exceed limit', async () => {
      const mockStorage = {
        put: vi.fn(),
      }

      const wrappedPut = monitor.wrapPut(mockStorage.put.bind(mockStorage), {
        throwOnExceed: true,
      })

      const oversizedValue = { data: 'x'.repeat(130 * KB) }

      await expect(wrappedPut('key', oversizedValue)).rejects.toThrow(/quota/i)
      expect(mockStorage.put).not.toHaveBeenCalled()
    })

    it('provides wrapper for delete operations', async () => {
      const mockStorage = {
        delete: vi.fn().mockResolvedValue(true),
      }

      monitor.trackPut('key', { data: 'test' })
      const wrappedDelete = monitor.wrapDelete(mockStorage.delete.bind(mockStorage))

      await wrappedDelete('key')

      expect(mockStorage.delete).toHaveBeenCalledWith('key')
      expect(monitor.getKeyUsage('key')).toBeUndefined()
    })

    it('provides wrapper for batch put operations', async () => {
      const mockStorage = {
        put: vi.fn(),
      }

      const wrappedBatchPut = monitor.wrapBatchPut(mockStorage.put.bind(mockStorage))

      const batch = {
        key1: { data: 'test1' },
        key2: { data: 'test2' },
      }

      await wrappedBatchPut(batch)

      expect(mockStorage.put).toHaveBeenCalledWith(batch)
      expect(monitor.getKeyUsage('key1')).toBeGreaterThan(0)
      expect(monitor.getKeyUsage('key2')).toBeGreaterThan(0)
    })

    it('batch wrapper validates before write', async () => {
      const mockStorage = {
        put: vi.fn(),
      }

      const wrappedBatchPut = monitor.wrapBatchPut(mockStorage.put.bind(mockStorage), {
        throwOnExceed: true,
      })

      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 150; i++) {
        batch[`key${i}`] = { value: i }
      }

      await expect(wrappedBatchPut(batch)).rejects.toThrow(/quota|batch/i)
      expect(mockStorage.put).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 9. CONFIGURATION OPTIONS
  // ==========================================================================

  describe('Configuration Options', () => {
    it('accepts custom total storage limit', () => {
      const customMonitor = new StorageQuotaMonitor({ totalLimit: 500 * KB })

      expect(customMonitor.getUsageStats().limit).toBe(500 * KB)
    })

    it('accepts custom warning threshold', () => {
      const customMonitor = new StorageQuotaMonitor({ warningThreshold: 0.9 })

      customMonitor.trackPut('key', { data: 'x'.repeat(85 * KB) }) // 85% of value limit

      // At 90% threshold, 85% should not warn
      const stats = customMonitor.getUsageStats()
      expect(stats.isWarning).toBe(false)
    })

    it('accepts custom value size limit', () => {
      const customMonitor = new StorageQuotaMonitor({ maxValueSize: 64 * KB })

      const warning = customMonitor.checkBeforeWrite('key', { data: 'x'.repeat(60 * KB) })

      expect(warning).not.toBeNull() // 60KB > 80% of 64KB
    })

    it('accepts custom batch size limit', () => {
      const customMonitor = new StorageQuotaMonitor({ maxBatchKeys: 64 })

      const batch: Record<string, unknown> = {}
      for (let i = 0; i < 55; i++) {
        batch[`key${i}`] = i
      }

      const warning = customMonitor.checkBatchBeforeWrite(batch)

      expect(warning).not.toBeNull() // 55 > 80% of 64
    })

    it('allows disabling warnings', () => {
      const callback = vi.fn()
      const silentMonitor = new StorageQuotaMonitor({ emitWarnings: false })
      silentMonitor.onWarning(callback)

      silentMonitor.checkBeforeWrite('key', { data: 'x'.repeat(130 * KB) })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 10. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty values', () => {
      const warning = monitor.checkBeforeWrite('key', null)

      expect(warning).toBeNull()
    })

    it('handles undefined values', () => {
      const warning = monitor.checkBeforeWrite('key', undefined)

      expect(warning).toBeNull()
    })

    it('handles circular references gracefully', () => {
      const circular: Record<string, unknown> = { data: 'test' }
      circular.self = circular

      // Should not throw, should handle gracefully
      expect(() => monitor.calculateSize(circular)).not.toThrow()
    })

    it('handles very large number of keys', () => {
      for (let i = 0; i < 1000; i++) {
        monitor.trackPut(`key${i}`, { value: i })
      }

      const stats = monitor.getUsageStats()

      expect(stats.keyCount).toBe(1000)
    })

    it('handles keys with special characters', () => {
      monitor.trackPut('key:with:colons', { data: 'test' })
      monitor.trackPut('key/with/slashes', { data: 'test' })
      monitor.trackPut('key.with.dots', { data: 'test' })

      expect(monitor.getKeyUsage('key:with:colons')).toBeGreaterThan(0)
      expect(monitor.getKeyUsage('key/with/slashes')).toBeGreaterThan(0)
      expect(monitor.getKeyUsage('key.with.dots')).toBeGreaterThan(0)
    })

    it('handles empty batch', () => {
      const warning = monitor.checkBatchBeforeWrite({})

      expect(warning).toBeNull()
    })

    it('handles batch with single oversized value among many small ones', () => {
      const batch: Record<string, unknown> = {
        small1: { data: 'small' },
        small2: { data: 'small' },
        oversized: { data: 'x'.repeat(130 * KB) },
        small3: { data: 'small' },
      }

      const warnings = monitor.checkBatchBeforeWriteAll(batch)

      expect(warnings.length).toBe(1)
      expect(warnings[0].key).toBe('oversized')
    })
  })
})
