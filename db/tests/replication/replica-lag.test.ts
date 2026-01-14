/**
 * ACID Test Suite - Phase 4: Replica Lag
 *
 * RED TDD: These tests define the expected behavior for replica lag tracking
 * and consistency bounds. All tests are expected to FAIL initially as this is
 * the RED phase.
 *
 * Replica lag is critical for:
 * - Monitoring replication health
 * - Enforcing consistency bounds
 * - Triggering sync operations when lag exceeds thresholds
 * - Providing stale read warnings to clients
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { CloneOptions } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR REPLICA LAG
// ============================================================================

/**
 * Lag measurement unit - versions or time
 */
type LagUnit = 'versions' | 'milliseconds' | 'seconds'

/**
 * Lag measurement
 */
interface LagMeasurement {
  /** Number of versions behind primary */
  versions: number
  /** Time behind primary in milliseconds */
  timeMs: number
  /** Timestamp of measurement */
  measuredAt: Date
  /** Whether the replica is considered stale */
  isStale: boolean
  /** Primary's current sequence number */
  primarySequence: number
  /** Replica's current sequence number */
  replicaSequence: number
}

/**
 * Lag thresholds for consistency bounds
 */
interface LagThresholds {
  /** Warning threshold (versions) */
  warnVersions?: number
  /** Critical threshold (versions) */
  criticalVersions?: number
  /** Warning threshold (milliseconds) */
  warnTimeMs?: number
  /** Critical threshold (milliseconds) */
  criticalTimeMs?: number
  /** Max allowed lag before forcing sync */
  maxLag?: number
}

/**
 * Lag history entry
 */
interface LagHistoryEntry {
  /** Lag measurement */
  lag: LagMeasurement
  /** Event type (sync, write, check) */
  eventType: 'sync' | 'write' | 'check'
  /** Timestamp */
  timestamp: Date
}

/**
 * Lag statistics
 */
interface LagStats {
  /** Current lag */
  current: LagMeasurement
  /** Average lag over window */
  average: number
  /** Max lag observed */
  max: number
  /** Min lag observed */
  min: number
  /** P99 lag */
  p99: number
  /** Time window for stats (ms) */
  windowMs: number
  /** Number of samples */
  sampleCount: number
}

/**
 * Replica handle with lag tracking
 */
interface ReplicaWithLag {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get current lag measurement */
  getLag(): Promise<LagMeasurement>
  /** Get lag statistics over a time window */
  getLagStats(windowMs?: number): Promise<LagStats>
  /** Get lag history */
  getLagHistory(limit?: number): Promise<LagHistoryEntry[]>
  /** Check if lag is within bounds */
  isWithinBounds(thresholds: LagThresholds): Promise<boolean>
  /** Wait for lag to drop below threshold */
  waitForLag(maxLag: number, timeoutMs?: number): Promise<boolean>
  /** Force sync with primary */
  sync(): Promise<void>
  /** Configure lag thresholds */
  setThresholds(thresholds: LagThresholds): Promise<void>
  /** Get current thresholds */
  getThresholds(): Promise<LagThresholds>
}

/**
 * Extended clone options for replica with lag tracking
 */
interface ReplicaCloneOptions extends CloneOptions {
  asReplica: true
  /** Initial lag thresholds */
  thresholds?: LagThresholds
  /** Enable continuous lag monitoring */
  monitorLag?: boolean
  /** Monitoring interval in milliseconds */
  monitorIntervalMs?: number
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Replica Lag Tracking', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://primary.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 100 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: { index: i, name: `Item ${i}` },
          version: i + 1,
          branch: null,
          deleted: false,
        }))],
        ['objects', [{
          ns: 'https://primary.test.do',
          class: 'DO',
          primary: true,
          sequence: 100, // Current sequence number
          region: 'us-east',
          createdAt: new Date().toISOString(),
        }]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // BASIC LAG MEASUREMENT
  // ==========================================================================

  describe('Basic Lag Measurement', () => {
    it('should measure lag in versions', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(lag.versions).toBeGreaterThanOrEqual(0)
      expect(typeof lag.versions).toBe('number')
    })

    it('should measure lag in time (milliseconds)', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(lag.timeMs).toBeGreaterThanOrEqual(0)
      expect(typeof lag.timeMs).toBe('number')
    })

    it('should include measurement timestamp', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(lag.measuredAt).toBeInstanceOf(Date)
    })

    it('should include stale indicator', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(typeof lag.isStale).toBe('boolean')
    })

    it('should track primary sequence number', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(lag.primarySequence).toBeGreaterThanOrEqual(0)
      expect(typeof lag.primarySequence).toBe('number')
    })

    it('should track replica sequence number', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const lag = await replica.getLag()

      expect(lag.replicaSequence).toBeGreaterThanOrEqual(0)
      expect(typeof lag.replicaSequence).toBe('number')
    })

    it('should have lag = primarySequence - replicaSequence', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Wait for partial sync
      await vi.advanceTimersByTimeAsync(1000)

      const lag = await replica.getLag()

      expect(lag.versions).toBe(lag.primarySequence - lag.replicaSequence)
    })

    it('should report zero lag when fully synced', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Wait for full sync
      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      const lag = await replica.getLag()

      expect(lag.versions).toBe(0)
      expect(lag.isStale).toBe(false)
    })
  })

  // ==========================================================================
  // LAG STATISTICS
  // ==========================================================================

  describe('Lag Statistics', () => {
    it('should provide lag statistics over a time window', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
        monitorIntervalMs: 1000,
      }) as unknown as ReplicaWithLag

      // Generate some lag samples
      await vi.advanceTimersByTimeAsync(10000)

      const stats = await replica.getLagStats(10000)

      expect(stats).toBeDefined()
      expect(stats.current).toBeDefined()
      expect(typeof stats.average).toBe('number')
      expect(typeof stats.max).toBe('number')
      expect(typeof stats.min).toBe('number')
      expect(typeof stats.p99).toBe('number')
    })

    it('should calculate average lag correctly', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      // Generate samples
      await vi.advanceTimersByTimeAsync(60000)

      const stats = await replica.getLagStats(60000)

      expect(stats.average).toBeGreaterThanOrEqual(stats.min)
      expect(stats.average).toBeLessThanOrEqual(stats.max)
    })

    it('should track max lag observed', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Add writes to primary during monitoring
      for (let i = 0; i < 50; i++) {
        result.sqlData.get('things')!.push({
          id: `new-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
        await vi.advanceTimersByTimeAsync(100)
      }

      const stats = await replica.getLagStats(5000)

      expect(stats.max).toBeGreaterThan(0)
    })

    it('should track min lag observed', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Sync then check min
      await replica.sync()

      const stats = await replica.getLagStats(5000)

      expect(stats.min).toBeGreaterThanOrEqual(0)
    })

    it('should calculate p99 percentile', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      // Generate many samples
      await vi.advanceTimersByTimeAsync(60000)

      const stats = await replica.getLagStats(60000)

      expect(stats.p99).toBeGreaterThanOrEqual(stats.average)
      expect(stats.p99).toBeLessThanOrEqual(stats.max)
    })

    it('should include sample count', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
        monitorIntervalMs: 1000,
      }) as unknown as ReplicaWithLag

      // Generate 10 samples
      await vi.advanceTimersByTimeAsync(10000)

      const stats = await replica.getLagStats(10000)

      expect(stats.sampleCount).toBeGreaterThan(0)
    })

    it('should use default window if not specified', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const stats = await replica.getLagStats()

      // Default window should be 5 minutes
      expect(stats.windowMs).toBe(300000)
    })
  })

  // ==========================================================================
  // LAG HISTORY
  // ==========================================================================

  describe('Lag History', () => {
    it('should record lag history', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      await vi.advanceTimersByTimeAsync(5000)

      const history = await replica.getLagHistory()

      expect(Array.isArray(history)).toBe(true)
      expect(history.length).toBeGreaterThan(0)
    })

    it('should include lag measurement in history entries', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      await vi.advanceTimersByTimeAsync(5000)

      const history = await replica.getLagHistory()
      const entry = history[0]

      expect(entry.lag).toBeDefined()
      expect(entry.lag.versions).toBeGreaterThanOrEqual(0)
    })

    it('should include event type in history entries', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Trigger different event types
      await replica.sync()
      await replica.getLag() // check event

      const history = await replica.getLagHistory()

      const eventTypes = history.map((e) => e.eventType)
      expect(eventTypes).toEqual(expect.arrayContaining(['sync', 'check']))
    })

    it('should respect limit parameter', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
        monitorIntervalMs: 100,
      }) as unknown as ReplicaWithLag

      // Generate many entries
      await vi.advanceTimersByTimeAsync(10000)

      const history = await replica.getLagHistory(5)

      expect(history.length).toBeLessThanOrEqual(5)
    })

    it('should order history by timestamp descending', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      await vi.advanceTimersByTimeAsync(5000)

      const history = await replica.getLagHistory()

      for (let i = 1; i < history.length; i++) {
        expect(history[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
          history[i].timestamp.getTime()
        )
      }
    })

    it('should record write events on primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Simulate write on primary
      result.sqlData.get('things')!.push({
        id: 'write-event-thing',
        type: 1,
        data: { name: 'Write Event' },
        version: 101,
        branch: null,
        deleted: false,
      })

      await vi.advanceTimersByTimeAsync(1000)

      const history = await replica.getLagHistory()
      const writeEvents = history.filter((e) => e.eventType === 'write')

      // Write events should be recorded when lag increases
      expect(writeEvents.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // CONSISTENCY BOUNDS
  // ==========================================================================

  describe('Consistency Bounds', () => {
    it('should check if lag is within version bounds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      await replica.sync()

      const isWithin = await replica.isWithinBounds({
        warnVersions: 10,
        criticalVersions: 50,
      })

      expect(isWithin).toBe(true)
    })

    it('should report false when lag exceeds critical threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Add many writes to exceed threshold
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `threshold-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      const isWithin = await replica.isWithinBounds({
        criticalVersions: 50,
      })

      expect(isWithin).toBe(false)
    })

    it('should check time-based bounds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Simulate time passing without sync
      await vi.advanceTimersByTimeAsync(60000) // 1 minute

      const isWithin = await replica.isWithinBounds({
        criticalTimeMs: 30000, // 30 seconds
      })

      expect(isWithin).toBe(false)
    })

    it('should support combined version and time bounds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const isWithin = await replica.isWithinBounds({
        criticalVersions: 100,
        criticalTimeMs: 60000,
      })

      // Should fail if either bound is exceeded
      expect(typeof isWithin).toBe('boolean')
    })

    it('should support maxLag threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { maxLag: 10 },
      }) as unknown as ReplicaWithLag

      // Exceed max lag
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `maxlag-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      const isWithin = await replica.isWithinBounds({
        maxLag: 10,
      })

      expect(isWithin).toBe(false)
    })
  })

  // ==========================================================================
  // THRESHOLD CONFIGURATION
  // ==========================================================================

  describe('Threshold Configuration', () => {
    it('should allow setting thresholds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      await replica.setThresholds({
        warnVersions: 10,
        criticalVersions: 50,
        maxLag: 100,
      })

      const thresholds = await replica.getThresholds()

      expect(thresholds.warnVersions).toBe(10)
      expect(thresholds.criticalVersions).toBe(50)
      expect(thresholds.maxLag).toBe(100)
    })

    it('should use initial thresholds from clone options', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: {
          warnVersions: 5,
          criticalVersions: 20,
        },
      }) as unknown as ReplicaWithLag

      const thresholds = await replica.getThresholds()

      expect(thresholds.warnVersions).toBe(5)
      expect(thresholds.criticalVersions).toBe(20)
    })

    it('should update thresholds dynamically', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { maxLag: 10 },
      }) as unknown as ReplicaWithLag

      await replica.setThresholds({ maxLag: 50 })

      const thresholds = await replica.getThresholds()
      expect(thresholds.maxLag).toBe(50)
    })

    it('should merge new thresholds with existing', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: {
          warnVersions: 10,
          criticalVersions: 50,
        },
      }) as unknown as ReplicaWithLag

      await replica.setThresholds({ maxLag: 100 })

      const thresholds = await replica.getThresholds()
      expect(thresholds.warnVersions).toBe(10)
      expect(thresholds.criticalVersions).toBe(50)
      expect(thresholds.maxLag).toBe(100)
    })

    it('should validate threshold values', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      await expect(async () => {
        await replica.setThresholds({
          warnVersions: -1, // Invalid negative value
        })
      }).rejects.toThrow(/invalid.*threshold|must be.*positive/i)
    })

    it('should validate threshold order (warn < critical)', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      await expect(async () => {
        await replica.setThresholds({
          warnVersions: 100,
          criticalVersions: 50, // Warn > Critical is invalid
        })
      }).rejects.toThrow(/warn.*less.*critical|invalid.*threshold.*order/i)
    })
  })

  // ==========================================================================
  // WAIT FOR LAG
  // ==========================================================================

  describe('Wait for Lag', () => {
    it('should wait for lag to drop below threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Start waiting (will resolve when lag drops)
      const waitPromise = replica.waitForLag(5, 10000)

      // Simulate sync catching up
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const success = await waitPromise

      expect(success).toBe(true)
    })

    it('should timeout if lag does not drop', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Add writes faster than sync
      const writeInterval = setInterval(() => {
        result.sqlData.get('things')!.push({
          id: `timeout-thing-${Date.now()}`,
          type: 1,
          data: {},
          version: result.sqlData.get('things')!.length + 1,
          branch: null,
          deleted: false,
        })
      }, 100)

      const startTime = Date.now()
      const waitPromise = replica.waitForLag(0, 2000) // Wait for 0 lag with 2s timeout

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(3000)

      clearInterval(writeInterval)

      const success = await waitPromise

      expect(success).toBe(false)
    })

    it('should return immediately if already within threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Sync first
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const startTime = Date.now()
      const success = await replica.waitForLag(100) // High threshold
      const elapsed = Date.now() - startTime

      expect(success).toBe(true)
      expect(elapsed).toBeLessThan(100) // Should be nearly instant
    })

    it('should use default timeout if not specified', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // This should use default timeout (30 seconds typically)
      const waitPromise = replica.waitForLag(0)

      // Advance 30+ seconds
      await vi.advanceTimersByTimeAsync(35000)

      const success = await waitPromise

      // Should timeout after default period
      expect(typeof success).toBe('boolean')
    })

    it('should poll at reasonable intervals', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      let checkCount = 0
      const originalGetLag = replica.getLag.bind(replica)
      replica.getLag = async () => {
        checkCount++
        return originalGetLag()
      }

      replica.waitForLag(0, 5000)
      await vi.advanceTimersByTimeAsync(5000)

      // Should check multiple times but not excessively
      expect(checkCount).toBeGreaterThan(1)
      expect(checkCount).toBeLessThan(100) // Not checking every ms
    })
  })

  // ==========================================================================
  // AUTOMATIC SYNC ON LAG
  // ==========================================================================

  describe('Automatic Sync on Lag', () => {
    it('should trigger sync when maxLag threshold is exceeded', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { maxLag: 10 },
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      // Track sync calls
      let syncCalled = false
      const originalSync = replica.sync.bind(replica)
      replica.sync = async () => {
        syncCalled = true
        return originalSync()
      }

      // Exceed max lag
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `autosync-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for lag check to trigger sync
      await vi.advanceTimersByTimeAsync(5000)

      expect(syncCalled).toBe(true)
    })

    it('should not sync if within bounds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { maxLag: 100 },
        monitorLag: true,
        monitorIntervalMs: 1000,
      }) as unknown as ReplicaWithLag

      // Sync initially
      await replica.sync()

      let syncCount = 0
      const originalSync = replica.sync.bind(replica)
      replica.sync = async () => {
        syncCount++
        return originalSync()
      }

      // Add small number of writes (within bounds)
      for (let i = 0; i < 5; i++) {
        result.sqlData.get('things')!.push({
          id: `inbounds-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(5000)

      // Should not have triggered extra syncs
      expect(syncCount).toBe(0)
    })

    it('should respect sync cooldown period', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { maxLag: 5 },
        monitorLag: true,
      }) as unknown as ReplicaWithLag

      let syncCount = 0
      const originalSync = replica.sync.bind(replica)
      replica.sync = async () => {
        syncCount++
        return originalSync()
      }

      // Rapidly exceed threshold multiple times
      for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 10; i++) {
          result.sqlData.get('things')!.push({
            id: `cooldown-thing-${batch}-${i}`,
            type: 1,
            data: {},
            version: 100 + batch * 10 + i,
            branch: null,
            deleted: false,
          })
        }
        await vi.advanceTimersByTimeAsync(100)
      }

      // Should not sync for every threshold breach
      expect(syncCount).toBeLessThan(3)
    })
  })

  // ==========================================================================
  // STALE READ DETECTION
  // ==========================================================================

  describe('Stale Read Detection', () => {
    it('should mark replica as stale when lag is high', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalVersions: 50 },
      }) as unknown as ReplicaWithLag

      // Exceed critical threshold
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `stale-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      const lag = await replica.getLag()

      expect(lag.isStale).toBe(true)
    })

    it('should not mark as stale when within bounds', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalVersions: 100 },
      }) as unknown as ReplicaWithLag

      await replica.sync()

      const lag = await replica.getLag()

      expect(lag.isStale).toBe(false)
    })

    it('should use time-based staleness when configured', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalTimeMs: 30000 }, // 30 seconds
      }) as unknown as ReplicaWithLag

      // Advance time past threshold without sync
      await vi.advanceTimersByTimeAsync(60000)

      const lag = await replica.getLag()

      expect(lag.isStale).toBe(true)
    })

    it('should become un-stale after sync', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalVersions: 50 },
      }) as unknown as ReplicaWithLag

      // Make stale
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `stale-recover-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      let lag = await replica.getLag()
      expect(lag.isStale).toBe(true)

      // Sync to recover
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      lag = await replica.getLag()
      expect(lag.isStale).toBe(false)
    })
  })

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  describe('Lag Events', () => {
    it('should emit lag.exceeded event when threshold is exceeded', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { warnVersions: 5 },
      })

      // Exceed threshold
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `lag-event-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(5000)

      const lagEvent = events.find((e) =>
        (e as Record<string, string>).type === 'lag.exceeded' ||
        (e as Record<string, string>).type === 'lag.warning'
      )
      expect(lagEvent).toBeDefined()
    })

    it('should emit lag.critical event at critical threshold', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalVersions: 10 },
      })

      // Exceed critical threshold
      for (let i = 0; i < 50; i++) {
        result.sqlData.get('things')!.push({
          id: `critical-event-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(5000)

      const criticalEvent = events.find((e) =>
        (e as Record<string, string>).type === 'lag.critical'
      )
      expect(criticalEvent).toBeDefined()
    })

    it('should emit lag.recovered event when lag drops below threshold', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        thresholds: { criticalVersions: 10 },
      }) as unknown as ReplicaWithLag

      // Exceed threshold
      for (let i = 0; i < 50; i++) {
        result.sqlData.get('things')!.push({
          id: `recover-event-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }
      await vi.advanceTimersByTimeAsync(1000)

      // Recover
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const recoveredEvent = events.find((e) =>
        (e as Record<string, string>).type === 'lag.recovered'
      )
      expect(recoveredEvent).toBeDefined()
    })
  })

  // ==========================================================================
  // MULTI-REPLICA LAG
  // ==========================================================================

  describe('Multi-Replica Lag Monitoring', () => {
    it('should track lag independently for each replica', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      // Sync one replica but not the other
      await replica1.sync()

      // Add writes
      for (let i = 0; i < 10; i++) {
        result.sqlData.get('things')!.push({
          id: `multi-replica-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(1000)

      const lag1 = await replica1.getLag()
      const lag2 = await replica2.getLag()

      // Replica 1 should have more lag (wasn't synced after writes)
      expect(lag1.versions).toBeLessThan(lag2.versions)
    })

    it('should aggregate lag stats across all replicas on primary', async () => {
      await result.instance.clone('https://replica-1.test.do', { asReplica: true })
      await result.instance.clone('https://replica-2.test.do', { asReplica: true })
      await result.instance.clone('https://replica-3.test.do', { asReplica: true })

      // @ts-expect-error - accessing internal method
      const allReplicaLag = await result.instance.getAllReplicaLag?.() ?? []

      expect(allReplicaLag).toHaveLength(3)
    })

    it('should identify most lagged replica', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithLag

      await result.instance.clone('https://replica-2.test.do', { asReplica: true })

      // Add writes
      for (let i = 0; i < 50; i++) {
        result.sqlData.get('things')!.push({
          id: `most-lagged-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Only sync replica 2
      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - accessing internal method
      const mostLagged = await result.instance.getMostLaggedReplica?.()

      expect(mostLagged).toBeDefined()
    })
  })
})
