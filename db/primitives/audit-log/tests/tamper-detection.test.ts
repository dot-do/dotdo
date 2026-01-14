/**
 * Tamper Detection Tests
 *
 * Tests for hash chain verification, anomaly detection, alert generation,
 * and integrity reporting in the audit log system.
 *
 * @see dotdo-p2ulg - [REFACTOR] Tamper detection alerts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createTamperDetector,
  createContinuousMonitor,
  TamperDetector,
  ContinuousMonitor,
  type TamperAlert,
  type AlertSeverity,
  type VerifiableEntry,
  type VerifiableAuditLog,
  type TamperDetectorOptions,
  TamperDetectionMetrics,
} from '../tamper-detection'
import { TestMetricsCollector } from '../../observability'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a simple hash for testing (same algorithm as in tamper-detection.ts)
 */
function computeTestHash(data: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0')
  let hash2 = 0xcbf29ce484222325n
  for (let i = 0; i < data.length; i++) {
    hash2 ^= BigInt(data.charCodeAt(i))
    hash2 = BigInt.asUintN(64, hash2 * 0x100000001b3n)
  }
  const hex2 = hash2.toString(16).padStart(16, '0')
  return (hex1 + hex2 + hex1 + hex2).slice(0, 64)
}

function computeEntryHash(prevHash: string, data: object, timestamp: number): string {
  const payload = `${prevHash}${JSON.stringify(data)}${timestamp}`
  return computeTestHash(payload)
}

interface MockEntry extends VerifiableEntry {
  actor: { userId: string }
  action: { type: string }
  resource: { type: string; id: string }
}

/**
 * Create a valid mock audit log with proper hash chain
 */
function createMockAuditLog(entryCount: number = 5): {
  log: VerifiableAuditLog
  entries: MockEntry[]
} {
  const entries: MockEntry[] = []
  const baseTime = Date.now() - entryCount * 1000 // Each entry 1 second apart

  for (let i = 0; i < entryCount; i++) {
    const timestamp = baseTime + i * 1000
    const prevHash = i > 0 ? entries[i - 1]!.hash : ''

    const entryData = {
      actor: { userId: `user-${i}` },
      action: { type: 'test-action' },
      resource: { type: 'TestResource', id: `res-${i}` },
      timestamp: { epochMs: timestamp },
    }

    const hash = computeEntryHash(prevHash, entryData, timestamp)

    entries.push({
      id: `entry-${i}`,
      index: i,
      hash,
      prevHash,
      ...entryData,
    })
  }

  const log: VerifiableAuditLog = {
    count: () => entries.length,
    getByIndex: (index: number) => entries[index] ?? null,
    get: (id: string) => entries.find((e) => e.id === id) ?? null,
    list: (options?: { limit?: number; offset?: number }) => {
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? entries.length
      return entries.slice(offset, offset + limit)
    },
  }

  return { log, entries }
}

/**
 * Create a mock log with tampered entries
 */
function createTamperedLog(tamperIndex: number, tamperType: 'hash' | 'prevHash' | 'data'): {
  log: VerifiableAuditLog
  entries: MockEntry[]
} {
  const { log, entries } = createMockAuditLog(5)

  // Create a shallow copy of entries array
  const tamperedEntries = entries.map((e, i) => {
    if (i === tamperIndex) {
      const copy = { ...e }
      switch (tamperType) {
        case 'hash':
          copy.hash = 'tampered-hash-value'
          break
        case 'prevHash':
          copy.prevHash = 'tampered-prev-hash'
          break
        case 'data':
          copy.actor = { userId: 'tampered-user' }
          // Hash becomes invalid because data changed
          break
      }
      return copy
    }
    return e
  })

  return {
    entries: tamperedEntries,
    log: {
      count: () => tamperedEntries.length,
      getByIndex: (index: number) => tamperedEntries[index] ?? null,
      get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
      list: (options?: { limit?: number; offset?: number }) => {
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? tamperedEntries.length
        return tamperedEntries.slice(offset, offset + limit)
      },
    },
  }
}

/**
 * Create a log with timestamp anomalies
 */
function createAnomalousTimestampLog(): { log: VerifiableAuditLog; entries: MockEntry[] } {
  const entries: MockEntry[] = []
  const baseTime = Date.now() - 10000

  // Normal entries first
  for (let i = 0; i < 3; i++) {
    const timestamp = baseTime + i * 1000
    const prevHash = i > 0 ? entries[i - 1]!.hash : ''

    const entryData = {
      actor: { userId: `user-${i}` },
      action: { type: 'test-action' },
      resource: { type: 'TestResource', id: `res-${i}` },
      timestamp: { epochMs: timestamp },
    }

    const hash = computeEntryHash(prevHash, entryData, timestamp)
    entries.push({ id: `entry-${i}`, index: i, hash, prevHash, ...entryData })
  }

  // Entry with timestamp going backwards
  const backwardsTimestamp = baseTime + 500 // Before entry 1
  const prevHash = entries[2]!.hash
  const backwardsData = {
    actor: { userId: 'user-3' },
    action: { type: 'test-action' },
    resource: { type: 'TestResource', id: 'res-3' },
    timestamp: { epochMs: backwardsTimestamp },
  }
  const backwardsHash = computeEntryHash(prevHash, backwardsData, backwardsTimestamp)
  entries.push({ id: 'entry-3', index: 3, hash: backwardsHash, prevHash, ...backwardsData })

  return {
    entries,
    log: {
      count: () => entries.length,
      getByIndex: (index: number) => entries[index] ?? null,
      get: (id: string) => entries.find((e) => e.id === id) ?? null,
      list: (options?: { limit?: number; offset?: number }) => {
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? entries.length
        return entries.slice(offset, offset + limit)
      },
    },
  }
}

// =============================================================================
// HASH CHAIN VERIFICATION TESTS
// =============================================================================

describe('TamperDetector - Hash Chain Verification', () => {
  let detector: TamperDetector

  beforeEach(() => {
    detector = createTamperDetector()
  })

  describe('valid hash chains', () => {
    it('should verify an empty log as valid', async () => {
      const { log } = createMockAuditLog(0)

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(true)
      expect(result.entriesVerified).toBe(0)
      expect(result.alerts).toHaveLength(0)
    })

    it('should verify a single entry log as valid', async () => {
      const { log } = createMockAuditLog(1)

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(true)
      expect(result.entriesVerified).toBe(1)
      expect(result.alerts).toHaveLength(0)
    })

    it('should verify a multi-entry log as valid', async () => {
      const { log } = createMockAuditLog(10)

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(true)
      expect(result.entriesVerified).toBe(10)
      expect(result.alerts).toHaveLength(0)
      expect(result.headHash).toBeDefined()
    })

    it('should return verification time', async () => {
      const { log } = createMockAuditLog(5)

      const result = await detector.verifyHashChain(log)

      expect(result.verificationTimeMs).toBeGreaterThan(0)
    })
  })

  describe('broken hash chains', () => {
    it('should detect tampered entry hash', async () => {
      const { log } = createTamperedLog(2, 'hash')

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(false)
      expect(result.firstInvalidIndex).toBe(2)
      expect(result.alerts.some((a) => a.type === 'hash_mismatch')).toBe(true)
    })

    it('should detect broken prevHash link', async () => {
      const { log } = createTamperedLog(2, 'prevHash')

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(false)
      expect(result.alerts.some((a) => a.type === 'hash_chain_broken')).toBe(true)
    })

    it('should detect modified entry data', async () => {
      const { log } = createTamperedLog(2, 'data')

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(false)
      expect(result.alerts.some((a) => a.type === 'hash_mismatch')).toBe(true)
    })

    it('should detect missing entries', async () => {
      const entries: MockEntry[] = []
      const baseTime = Date.now()

      // Create entry 0
      const entry0Data = {
        actor: { userId: 'user-0' },
        action: { type: 'test' },
        resource: { type: 'Test', id: 'r-0' },
        timestamp: { epochMs: baseTime },
      }
      const entry0Hash = computeEntryHash('', entry0Data, baseTime)
      entries.push({ id: 'e-0', index: 0, hash: entry0Hash, prevHash: '', ...entry0Data })

      // Skip entry 1 (missing)

      // Create entry 2 with correct prevHash to entry 0
      const entry2Data = {
        actor: { userId: 'user-2' },
        action: { type: 'test' },
        resource: { type: 'Test', id: 'r-2' },
        timestamp: { epochMs: baseTime + 2000 },
      }
      const entry2Hash = computeEntryHash(entry0Hash, entry2Data, baseTime + 2000)
      entries.push({ id: 'e-2', index: 2, hash: entry2Hash, prevHash: entry0Hash, ...entry2Data })

      const log: VerifiableAuditLog = {
        count: () => 3, // Reports 3 entries
        getByIndex: (index: number) => {
          if (index === 0) return entries[0] ?? null
          if (index === 1) return null // Missing!
          if (index === 2) return entries[1] ?? null
          return null
        },
        get: (id: string) => entries.find((e) => e.id === id) ?? null,
        list: () => entries,
      }

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(false)
      expect(result.alerts.some((a) => a.type === 'deletion_detected')).toBe(true)
    })

    it('should detect index gaps', async () => {
      const { log, entries } = createMockAuditLog(3)

      // Modify entry to have wrong index
      const tamperedEntries = entries.map((e, i) => {
        if (i === 1) {
          return { ...e, index: 5 } // Wrong index
        }
        return e
      })

      const tamperedLog: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.verifyHashChain(tamperedLog)

      expect(result.valid).toBe(false)
      expect(result.alerts.some((a) => a.type === 'index_gap')).toBe(true)
    })

    it('should report all tampering issues found', async () => {
      // Create a log with multiple issues
      const { entries } = createMockAuditLog(5)

      const tamperedEntries = entries.map((e, i) => {
        if (i === 1) return { ...e, hash: 'tampered-1' }
        if (i === 3) return { ...e, prevHash: 'tampered-prev' }
        return e
      })

      const log: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.verifyHashChain(log)

      expect(result.valid).toBe(false)
      expect(result.alerts.length).toBeGreaterThan(1)
      expect(result.firstInvalidIndex).toBe(1) // First issue at index 1
    })
  })
})

// =============================================================================
// ANOMALY DETECTION TESTS
// =============================================================================

describe('TamperDetector - Anomaly Detection', () => {
  let detector: TamperDetector

  beforeEach(() => {
    detector = createTamperDetector()
  })

  describe('timestamp anomalies', () => {
    it('should detect backwards timestamps', async () => {
      const { log } = createAnomalousTimestampLog()

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'timestamp_anomaly')).toBe(true)
    })

    it('should detect future timestamps', async () => {
      const { log, entries } = createMockAuditLog(3)

      // Modify last entry to have future timestamp
      const futureTime = Date.now() + 60000 // 1 minute in future
      const tamperedEntries = entries.map((e, i) => {
        if (i === 2) {
          const newData = { ...e, timestamp: { epochMs: futureTime } }
          const hash = computeEntryHash(entries[1]!.hash, newData, futureTime)
          return { ...newData, hash }
        }
        return e
      })

      const tamperedLog: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.detectAnomalies(tamperedLog)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'timestamp_future')).toBe(true)
    })

    it('should detect large timestamp gaps', async () => {
      const detector = createTamperDetector({
        anomalyConfig: {
          maxTimestampGapMs: 1000, // 1 second max gap
        },
      })

      const entries: MockEntry[] = []
      const baseTime = Date.now() - 10000

      // Entry 0
      const entry0Data = {
        actor: { userId: 'user-0' },
        action: { type: 'test' },
        resource: { type: 'Test', id: 'r-0' },
        timestamp: { epochMs: baseTime },
      }
      const entry0Hash = computeEntryHash('', entry0Data, baseTime)
      entries.push({ id: 'e-0', index: 0, hash: entry0Hash, prevHash: '', ...entry0Data })

      // Entry 1 - 5 seconds later (large gap)
      const entry1Time = baseTime + 5000
      const entry1Data = {
        actor: { userId: 'user-1' },
        action: { type: 'test' },
        resource: { type: 'Test', id: 'r-1' },
        timestamp: { epochMs: entry1Time },
      }
      const entry1Hash = computeEntryHash(entry0Hash, entry1Data, entry1Time)
      entries.push({ id: 'e-1', index: 1, hash: entry1Hash, prevHash: entry0Hash, ...entry1Data })

      const log: VerifiableAuditLog = {
        count: () => entries.length,
        getByIndex: (index: number) => entries[index] ?? null,
        get: (id: string) => entries.find((e) => e.id === id) ?? null,
        list: () => entries,
      }

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'timestamp_anomaly')).toBe(true)
    })
  })

  describe('index anomalies', () => {
    it('should detect duplicate indices', async () => {
      const { entries } = createMockAuditLog(3)

      // Create duplicate index
      const tamperedEntries = entries.map((e, i) => {
        if (i === 2) return { ...e, index: 1 } // Duplicate of entry 1
        return e
      })

      const log: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'index_duplicate')).toBe(true)
    })
  })

  describe('actor anomalies', () => {
    it('should detect suspicious actor patterns', async () => {
      const detector = createTamperDetector({
        anomalyConfig: {
          suspiciousActorPatterns: [/^admin/, /root/],
        },
      })

      const { entries } = createMockAuditLog(3)

      // Add suspicious actor
      const tamperedEntries = entries.map((e, i) => {
        if (i === 1) return { ...e, actor: { userId: 'admin-backdoor' } }
        return e
      })

      const log: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'actor_anomaly')).toBe(true)
    })
  })

  describe('rate anomalies', () => {
    it('should detect high entry rate', async () => {
      const detector = createTamperDetector({
        anomalyConfig: {
          maxEntriesPerMinute: 10,
        },
      })

      // Create many entries in short time span
      const entries: MockEntry[] = []
      const baseTime = Date.now() - 1000 // 1 second ago

      for (let i = 0; i < 20; i++) {
        const timestamp = baseTime + i * 10 // 10ms apart = 6000/min
        const prevHash = i > 0 ? entries[i - 1]!.hash : ''

        const entryData = {
          actor: { userId: `user-${i}` },
          action: { type: 'test' },
          resource: { type: 'Test', id: `r-${i}` },
          timestamp: { epochMs: timestamp },
        }

        const hash = computeEntryHash(prevHash, entryData, timestamp)
        entries.push({ id: `e-${i}`, index: i, hash, prevHash, ...entryData })
      }

      const log: VerifiableAuditLog = {
        count: () => entries.length,
        getByIndex: (index: number) => entries[index] ?? null,
        get: (id: string) => entries.find((e) => e.id === id) ?? null,
        list: () => entries,
      }

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(true)
      expect(result.alerts.some((a) => a.type === 'rate_anomaly')).toBe(true)
    })
  })

  describe('statistics', () => {
    it('should calculate entry statistics', async () => {
      const { log } = createMockAuditLog(10)

      const result = await detector.detectAnomalies(log)

      expect(result.stats.entriesAnalyzed).toBe(10)
      expect(result.stats.avgEntryIntervalMs).toBeGreaterThan(0)
      expect(result.stats.uniqueActors).toBe(10) // Each entry has different actor
    })

    it('should handle empty log', async () => {
      const { log } = createMockAuditLog(0)

      const result = await detector.detectAnomalies(log)

      expect(result.hasAnomalies).toBe(false)
      expect(result.stats.entriesAnalyzed).toBe(0)
    })

    it('should identify most active actor', async () => {
      const { entries } = createMockAuditLog(5)

      // Make one actor more active
      const tamperedEntries = entries.map((e, i) => {
        if (i >= 2) return { ...e, actor: { userId: 'frequent-user' } }
        return e
      })

      const log: VerifiableAuditLog = {
        count: () => tamperedEntries.length,
        getByIndex: (index: number) => tamperedEntries[index] ?? null,
        get: (id: string) => tamperedEntries.find((e) => e.id === id) ?? null,
        list: () => tamperedEntries,
      }

      const result = await detector.detectAnomalies(log)

      expect(result.stats.mostActiveActor).toBe('frequent-user')
    })
  })
})

// =============================================================================
// ALERT GENERATION TESTS
// =============================================================================

describe('TamperDetector - Alert Generation', () => {
  describe('alert dispatch', () => {
    it('should dispatch alerts to severity-specific handlers', async () => {
      const criticalAlerts: TamperAlert[] = []
      const highAlerts: TamperAlert[] = []

      const detector = createTamperDetector({
        alertHandlers: {
          critical: [(alert) => criticalAlerts.push(alert)],
          high: [(alert) => highAlerts.push(alert)],
        },
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      expect(criticalAlerts.length).toBeGreaterThan(0)
    })

    it('should dispatch alerts to default handler', async () => {
      const allAlerts: TamperAlert[] = []

      const detector = createTamperDetector({
        defaultHandler: (alert) => allAlerts.push(alert),
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      expect(allAlerts.length).toBeGreaterThan(0)
    })

    it('should call multiple handlers for same severity', async () => {
      let handler1Called = false
      let handler2Called = false

      const detector = createTamperDetector({
        alertHandlers: {
          critical: [
            () => { handler1Called = true },
            () => { handler2Called = true },
          ],
        },
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      expect(handler1Called).toBe(true)
      expect(handler2Called).toBe(true)
    })

    it('should allow registering handlers dynamically', async () => {
      const alerts: TamperAlert[] = []
      const detector = createTamperDetector()

      detector.onAlert('critical', (alert) => alerts.push(alert))

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      expect(alerts.length).toBeGreaterThan(0)
    })

    it('should handle async alert handlers', async () => {
      const alerts: TamperAlert[] = []

      const detector = createTamperDetector({
        defaultHandler: async (alert) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          alerts.push(alert)
        },
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      expect(alerts.length).toBeGreaterThan(0)
    })

    it('should continue on handler errors', async () => {
      const alerts: TamperAlert[] = []

      const detector = createTamperDetector({
        alertHandlers: {
          critical: [
            () => { throw new Error('Handler error') },
            (alert) => alerts.push(alert),
          ],
        },
      })

      const { log } = createTamperedLog(2, 'hash')

      // Should not throw
      await detector.verifyHashChain(log)

      // Second handler should still be called
      expect(alerts.length).toBeGreaterThan(0)
    })
  })

  describe('alert structure', () => {
    it('should include all required fields in alerts', async () => {
      const alerts: TamperAlert[] = []

      const detector = createTamperDetector({
        defaultHandler: (alert) => alerts.push(alert),
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      const alert = alerts[0]!
      expect(alert.id).toBeDefined()
      expect(alert.type).toBeDefined()
      expect(alert.severity).toBeDefined()
      expect(alert.message).toBeDefined()
      expect(alert.detectedAt).toBeGreaterThan(0)
    })

    it('should include expected/actual for mismatches', async () => {
      const alerts: TamperAlert[] = []

      const detector = createTamperDetector({
        defaultHandler: (alert) => alerts.push(alert),
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      const hashAlert = alerts.find((a) => a.type === 'hash_mismatch')
      expect(hashAlert?.expected).toBeDefined()
      expect(hashAlert?.actual).toBeDefined()
    })

    it('should include entry context in alerts', async () => {
      const alerts: TamperAlert[] = []

      const detector = createTamperDetector({
        defaultHandler: (alert) => alerts.push(alert),
      })

      const { log } = createTamperedLog(2, 'hash')

      await detector.verifyHashChain(log)

      const alert = alerts[0]!
      expect(alert.index).toBeDefined()
      expect(alert.entryId).toBeDefined()
    })
  })
})

// =============================================================================
// INTEGRITY REPORTING TESTS
// =============================================================================

describe('TamperDetector - Integrity Reporting', () => {
  let detector: TamperDetector

  beforeEach(() => {
    detector = createTamperDetector()
  })

  it('should generate healthy report for valid log', async () => {
    const { log } = createMockAuditLog(10)

    const report = await detector.generateIntegrityReport(log)

    expect(report.status).toBe('healthy')
    expect(report.allAlerts).toHaveLength(0)
    expect(report.summary.criticalAlerts).toBe(0)
    expect(report.summary.totalEntries).toBe(10)
  })

  it('should generate compromised report for tampered log', async () => {
    const { log } = createTamperedLog(2, 'hash')

    const report = await detector.generateIntegrityReport(log)

    expect(report.status).toBe('compromised')
    expect(report.summary.criticalAlerts).toBeGreaterThan(0)
  })

  it('should generate degraded report for anomalous log', async () => {
    const detector = createTamperDetector({
      anomalyConfig: {
        suspiciousActorPatterns: [/^admin/],
      },
    })

    // Create a valid hash chain with a suspicious actor
    const entries: MockEntry[] = []
    const baseTime = Date.now() - 5 * 1000

    for (let i = 0; i < 5; i++) {
      const timestamp = baseTime + i * 1000
      const prevHash = i > 0 ? entries[i - 1]!.hash : ''
      // Use admin-test for index 2 to trigger suspicious actor pattern
      const actor = { userId: i === 2 ? 'admin-test' : `user-${i}` }

      const entryData = {
        actor,
        action: { type: 'test-action' },
        resource: { type: 'TestResource', id: `res-${i}` },
        timestamp: { epochMs: timestamp },
      }

      const hash = computeEntryHash(prevHash, entryData, timestamp)

      entries.push({
        id: `entry-${i}`,
        index: i,
        hash,
        prevHash,
        ...entryData,
      })
    }

    const log: VerifiableAuditLog = {
      count: () => entries.length,
      getByIndex: (index: number) => entries[index] ?? null,
      get: (id: string) => entries.find((e) => e.id === id) ?? null,
      list: () => entries,
    }

    const report = await detector.generateIntegrityReport(log)

    expect(report.status).toBe('degraded')
  })

  it('should include both verification and anomaly results', async () => {
    const { log } = createMockAuditLog(5)

    const report = await detector.generateIntegrityReport(log)

    expect(report.hashChainVerification).toBeDefined()
    expect(report.hashChainVerification.valid).toBe(true)
    expect(report.anomalyDetection).toBeDefined()
    expect(report.anomalyDetection.hasAnomalies).toBe(false)
  })

  it('should combine alerts from all checks', async () => {
    const { log } = createTamperedLog(2, 'hash')

    const report = await detector.generateIntegrityReport(log)

    // allAlerts should include alerts from hash verification
    expect(report.allAlerts.length).toBeGreaterThan(0)
    expect(report.allAlerts).toEqual(
      expect.arrayContaining(report.hashChainVerification.alerts)
    )
  })

  it('should track total verification time', async () => {
    const { log } = createMockAuditLog(10)

    const report = await detector.generateIntegrityReport(log)

    expect(report.summary.totalTimeMs).toBeGreaterThan(0)
    expect(report.generatedAt).toBeGreaterThan(0)
  })

  it('should count alerts by severity', async () => {
    const detector = createTamperDetector({
      anomalyConfig: {
        maxTimestampGapMs: 100, // Very small to trigger alerts
      },
    })

    const { log } = createTamperedLog(2, 'hash')

    const report = await detector.generateIntegrityReport(log)

    expect(report.summary.criticalAlerts + report.summary.highAlerts +
           report.summary.mediumAlerts + report.summary.lowAlerts)
      .toBe(report.allAlerts.length)
  })
})

// =============================================================================
// METRICS TESTS
// =============================================================================

describe('TamperDetector - Metrics', () => {
  let metrics: TestMetricsCollector
  let detector: TamperDetector

  beforeEach(() => {
    metrics = new TestMetricsCollector()
    detector = createTamperDetector({ metrics })
  })

  it('should record hash chain verification latency', async () => {
    const { log } = createMockAuditLog(5)

    await detector.verifyHashChain(log)

    const latencies = metrics.getLatencies(TamperDetectionMetrics.VERIFY_CHAIN_LATENCY)
    expect(latencies.length).toBe(1)
    expect(latencies[0]).toBeGreaterThan(0)
  })

  it('should record anomaly detection latency', async () => {
    const { log } = createMockAuditLog(5)

    await detector.detectAnomalies(log)

    const latencies = metrics.getLatencies(TamperDetectionMetrics.DETECT_ANOMALIES_LATENCY)
    expect(latencies.length).toBe(1)
  })

  it('should record integrity report latency', async () => {
    const { log } = createMockAuditLog(5)

    await detector.generateIntegrityReport(log)

    const latencies = metrics.getLatencies(TamperDetectionMetrics.INTEGRITY_REPORT_LATENCY)
    expect(latencies.length).toBe(1)
  })

  it('should count generated alerts', async () => {
    const { log } = createTamperedLog(2, 'hash')

    await detector.verifyHashChain(log)

    const alertCount = metrics.getCounterTotal(TamperDetectionMetrics.ALERTS_GENERATED)
    expect(alertCount).toBeGreaterThan(0)
  })

  it('should count chain breaks', async () => {
    const { log } = createTamperedLog(2, 'prevHash')

    await detector.verifyHashChain(log)

    const breakCount = metrics.getCounterTotal(TamperDetectionMetrics.CHAIN_BREAKS_DETECTED)
    expect(breakCount).toBeGreaterThan(0)
  })

  it('should count anomalies detected', async () => {
    const detector = createTamperDetector({
      metrics,
      anomalyConfig: {
        suspiciousActorPatterns: [/^admin/],
      },
    })

    const { entries } = createMockAuditLog(3)
    const anomalousEntries = entries.map((e, i) => {
      if (i === 1) return { ...e, actor: { userId: 'admin-test' } }
      return e
    })

    const log: VerifiableAuditLog = {
      count: () => anomalousEntries.length,
      getByIndex: (index: number) => anomalousEntries[index] ?? null,
      get: (id: string) => anomalousEntries.find((e) => e.id === id) ?? null,
      list: () => anomalousEntries,
    }

    await detector.detectAnomalies(log)

    const anomalyCount = metrics.getCounterTotal(TamperDetectionMetrics.ANOMALIES_DETECTED)
    expect(anomalyCount).toBeGreaterThan(0)
  })
})

// =============================================================================
// CONTINUOUS MONITORING TESTS
// =============================================================================

describe('ContinuousMonitor', () => {
  let detector: TamperDetector
  let monitor: ContinuousMonitor

  beforeEach(() => {
    detector = createTamperDetector()
  })

  afterEach(() => {
    if (monitor) {
      monitor.stop()
    }
  })

  describe('lifecycle', () => {
    it('should start monitoring', () => {
      monitor = createContinuousMonitor(detector)
      const { log } = createMockAuditLog(5)

      monitor.start(log)

      expect(monitor.getState().isActive).toBe(true)
    })

    it('should stop monitoring', () => {
      monitor = createContinuousMonitor(detector)
      const { log } = createMockAuditLog(5)

      monitor.start(log)
      monitor.stop()

      expect(monitor.getState().isActive).toBe(false)
    })

    it('should handle multiple start calls', () => {
      monitor = createContinuousMonitor(detector)
      const { log } = createMockAuditLog(5)

      monitor.start(log)
      monitor.start(log) // Should be idempotent

      expect(monitor.getState().isActive).toBe(true)
    })
  })

  describe('state tracking', () => {
    it('should track last verified index', async () => {
      monitor = createContinuousMonitor(detector, {
        fullCheckIntervalMs: 1000000, // Don't run automatic checks
      })
      const { log } = createMockAuditLog(5)

      await monitor.verifyNewEntry(log, 0)
      await monitor.verifyNewEntry(log, 1)
      await monitor.verifyNewEntry(log, 2)

      const state = monitor.getState()
      expect(state.lastVerifiedIndex).toBe(2)
    })

    it('should track entries verified since full check', async () => {
      monitor = createContinuousMonitor(detector, {
        fullCheckIntervalMs: 1000000,
      })
      const { log } = createMockAuditLog(5)

      await monitor.verifyNewEntry(log, 0)
      await monitor.verifyNewEntry(log, 1)

      const state = monitor.getState()
      expect(state.entriesVerifiedSinceFullCheck).toBe(2)
    })
  })

  describe('incremental verification', () => {
    it('should verify new entries', async () => {
      monitor = createContinuousMonitor(detector)
      const { log } = createMockAuditLog(5)

      const alerts = await monitor.verifyNewEntry(log, 2)

      expect(alerts).toHaveLength(0) // Valid entry
    })

    it('should detect issues in new entries', async () => {
      monitor = createContinuousMonitor(detector)
      const { log } = createTamperedLog(2, 'prevHash')

      const alerts = await monitor.verifyNewEntry(log, 2)

      expect(alerts.length).toBeGreaterThan(0)
    })

    it('should run incremental checks', async () => {
      monitor = createContinuousMonitor(detector, {
        incrementalBatchSize: 3,
      })
      const { log } = createMockAuditLog(10)

      const alerts = await monitor.runIncrementalCheck(log)

      expect(alerts).toHaveLength(0)
      expect(monitor.getState().lastVerifiedIndex).toBe(2)
    })
  })

  describe('configuration', () => {
    it('should respect incrementalBatchSize', async () => {
      monitor = createContinuousMonitor(detector, {
        incrementalBatchSize: 2,
      })
      const { log } = createMockAuditLog(10)

      await monitor.runIncrementalCheck(log)

      expect(monitor.getState().lastVerifiedIndex).toBe(1) // Only 2 entries (0 and 1)
    })

    it('should respect verifyOnAppend setting', async () => {
      monitor = createContinuousMonitor(detector, {
        verifyOnAppend: false,
      })
      const { log } = createMockAuditLog(5)

      const alerts = await monitor.verifyNewEntry(log, 2)

      expect(alerts).toHaveLength(0)
      expect(monitor.getState().lastVerifiedIndex).toBe(-1) // Not updated
    })
  })
})

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe('Factory Functions', () => {
  describe('createTamperDetector', () => {
    it('should create detector with default options', () => {
      const detector = createTamperDetector()
      expect(detector).toBeInstanceOf(TamperDetector)
    })

    it('should create detector with custom options', () => {
      const detector = createTamperDetector({
        anomalyConfig: {
          maxTimestampGapMs: 30000,
        },
      })
      expect(detector).toBeInstanceOf(TamperDetector)
    })
  })

  describe('createContinuousMonitor', () => {
    it('should create monitor with detector', () => {
      const detector = createTamperDetector()
      const monitor = createContinuousMonitor(detector)
      expect(monitor).toBeInstanceOf(ContinuousMonitor)
    })

    it('should create monitor with custom config', () => {
      const detector = createTamperDetector()
      const monitor = createContinuousMonitor(detector, {
        fullCheckIntervalMs: 60000,
        incrementalBatchSize: 50,
      })
      expect(monitor).toBeInstanceOf(ContinuousMonitor)
    })
  })
})
