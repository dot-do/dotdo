/**
 * Audit tests - Audit logging with TemporalStore integration
 *
 * TDD: These tests define the expected behavior of audit logging.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { AuditLogger, createAuditLogger, type AuditConfig } from '../audit'
import { createSecureVault } from '../vault'

afterEach(() => {
  vi.useRealTimers()
})

function createTestAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  const vault = createSecureVault({
    encryptionKey: 'test-encryption-key-32-bytes-ok!',
  })
  return createAuditLogger({ vault, ...config })
}

describe('AuditLogger - Audit Logging', () => {
  describe('Basic Logging', () => {
    it('should log credential creation', async () => {
      const logger = createTestAuditLogger()

      await logger.logCreate('new-credential', {
        type: 'api_key',
        actor: 'admin@example.com',
      })

      const logs = await logger.getAuditLog('new-credential')

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('create')
      expect(logs[0].credentialName).toBe('new-credential')
      expect(logs[0].actor).toBe('admin@example.com')
    })

    it('should log credential reads', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('read-cred', {
        actor: 'service:api-gateway',
      })
      await logger.logRead('read-cred', {
        actor: 'service:api-gateway',
      })

      const logs = await logger.getAuditLog('read-cred')

      expect(logs).toHaveLength(2)
      expect(logs.every((l) => l.action === 'read')).toBe(true)
    })

    it('should log credential rotation', async () => {
      const logger = createTestAuditLogger()

      await logger.logRotate('rotated-cred', {
        actor: 'system:rotation-service',
        reason: 'Automated 30-day rotation',
        previousVersion: 1,
        newVersion: 2,
      })

      const logs = await logger.getAuditLog('rotated-cred')

      expect(logs[0].action).toBe('rotate')
      expect(logs[0].actor).toBe('system:rotation-service')
      expect(logs[0].reason).toBe('Automated 30-day rotation')
      expect(logs[0].metadata?.previousVersion).toBe(1)
      expect(logs[0].metadata?.newVersion).toBe(2)
    })

    it('should log credential deletion', async () => {
      const logger = createTestAuditLogger()

      await logger.logDelete('deleted-cred', {
        actor: 'admin@example.com',
        reason: 'No longer needed',
        hard: false,
      })

      const logs = await logger.getAuditLog('deleted-cred')

      expect(logs[0].action).toBe('delete')
      expect(logs[0].metadata?.hard).toBe(false)
    })

    it('should log access denials', async () => {
      const logger = createTestAuditLogger()

      await logger.logAccessDenied('restricted-cred', {
        actor: 'unauthorized-user',
        reason: 'Insufficient permissions',
        tokenId: 'token-123',
      })

      const logs = await logger.getAuditLog('restricted-cred')

      expect(logs[0].action).toBe('access_denied')
      expect(logs[0].metadata?.tokenId).toBe('token-123')
    })

    it('should log OAuth refresh events', async () => {
      const logger = createTestAuditLogger()

      await logger.logRefresh('oauth-cred', {
        previousExpiry: new Date('2024-01-01'),
        newExpiry: new Date('2024-01-02'),
      })

      const logs = await logger.getAuditLog('oauth-cred')

      expect(logs[0].action).toBe('refresh')
    })
  })

  describe('Audit Context', () => {
    it('should include IP address in audit log', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('ip-logged', {
        context: {
          ipAddress: '192.168.1.1',
        },
      })

      const logs = await logger.getAuditLog('ip-logged')

      expect(logs[0].context?.ipAddress).toBe('192.168.1.1')
    })

    it('should include user agent in audit log', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('ua-logged', {
        context: {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        },
      })

      const logs = await logger.getAuditLog('ua-logged')

      expect(logs[0].context?.userAgent).toBe('Mozilla/5.0 (X11; Linux x86_64)')
    })

    it('should include request ID for tracing', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('traced', {
        context: {
          requestId: 'req-12345-abcde',
        },
      })

      const logs = await logger.getAuditLog('traced')

      expect(logs[0].context?.requestId).toBe('req-12345-abcde')
    })

    it('should include all context fields', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('full-context', {
        actor: 'user@example.com',
        context: {
          ipAddress: '10.0.0.1',
          userAgent: 'CustomAgent/1.0',
          requestId: 'req-xyz',
          sessionId: 'sess-abc',
        },
      })

      const logs = await logger.getAuditLog('full-context')

      expect(logs[0].context).toEqual({
        ipAddress: '10.0.0.1',
        userAgent: 'CustomAgent/1.0',
        requestId: 'req-xyz',
        sessionId: 'sess-abc',
      })
    })
  })

  describe('Timestamps', () => {
    it('should record accurate timestamps', async () => {
      const logger = createTestAuditLogger()
      const before = new Date()

      await logger.logRead('timestamped', {})

      const after = new Date()
      const logs = await logger.getAuditLog('timestamped')

      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should generate unique IDs for each entry', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('unique-ids', {})
      await logger.logRead('unique-ids', {})
      await logger.logRead('unique-ids', {})

      const logs = await logger.getAuditLog('unique-ids')
      const ids = logs.map((l) => l.id)

      expect(new Set(ids).size).toBe(3)
    })
  })

  describe('Filtering', () => {
    it('should filter by action type', async () => {
      const logger = createTestAuditLogger()

      await logger.logCreate('filter-test', { type: 'api_key' })
      await logger.logRead('filter-test', {})
      await logger.logRead('filter-test', {})
      await logger.logRotate('filter-test', { previousVersion: 1, newVersion: 2 })

      const reads = await logger.getAuditLog('filter-test', { action: 'read' })
      expect(reads).toHaveLength(2)
      expect(reads.every((l) => l.action === 'read')).toBe(true)
    })

    it('should filter by time range', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('time-range', { actor: 'first' })
      await new Promise((r) => setTimeout(r, 20))

      const rangeStart = new Date()
      await new Promise((r) => setTimeout(r, 10))

      await logger.logRead('time-range', { actor: 'middle' })
      await new Promise((r) => setTimeout(r, 10))

      const rangeEnd = new Date()
      await new Promise((r) => setTimeout(r, 20))

      await logger.logRead('time-range', { actor: 'last' })

      const filtered = await logger.getAuditLog('time-range', {
        since: rangeStart,
        until: rangeEnd,
      })

      // Should only get the middle entry
      expect(filtered).toHaveLength(1)
      expect(filtered[0].actor).toBe('middle')
    })

    it('should filter by actor', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('actor-filter', { actor: 'user-1' })
      await logger.logRead('actor-filter', { actor: 'user-2' })
      await logger.logRead('actor-filter', { actor: 'user-1' })

      const user1Logs = await logger.getAuditLog('actor-filter', { actor: 'user-1' })

      expect(user1Logs).toHaveLength(2)
    })
  })

  describe('Pagination', () => {
    it('should support limit and offset', async () => {
      const logger = createTestAuditLogger()

      // Generate multiple log entries
      for (let i = 0; i < 15; i++) {
        await logger.logRead('paginated', { actor: `user-${i}` })
      }

      const page1 = await logger.getAuditLog('paginated', { limit: 5, offset: 0 })
      const page2 = await logger.getAuditLog('paginated', { limit: 5, offset: 5 })
      const page3 = await logger.getAuditLog('paginated', { limit: 5, offset: 10 })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
      expect(page3).toHaveLength(5)

      // Pages should not overlap
      expect(page1[0].id).not.toBe(page2[0].id)
      expect(page2[0].id).not.toBe(page3[0].id)
    })

    it('should return correct total count', async () => {
      const logger = createTestAuditLogger()

      for (let i = 0; i < 25; i++) {
        await logger.logRead('count-test', {})
      }

      const result = await logger.getAuditLogWithCount('count-test', { limit: 10 })

      expect(result.logs).toHaveLength(10)
      expect(result.total).toBe(25)
    })

    it('should sort by timestamp descending by default', async () => {
      const logger = createTestAuditLogger()

      await logger.logRead('sorted', { actor: 'first' })
      await new Promise((r) => setTimeout(r, 5))
      await logger.logRead('sorted', { actor: 'second' })
      await new Promise((r) => setTimeout(r, 5))
      await logger.logRead('sorted', { actor: 'third' })

      const logs = await logger.getAuditLog('sorted')

      // Most recent first
      expect(logs[0].actor).toBe('third')
      expect(logs[1].actor).toBe('second')
      expect(logs[2].actor).toBe('first')
    })
  })

  describe('TemporalStore Integration', () => {
    it('should enable time-travel queries', async () => {
      const logger = createTestAuditLogger({ enableTemporalStore: true })

      await logger.logRead('temporal', { actor: 'v1-reader' })
      const checkpoint1 = Date.now()

      await new Promise((r) => setTimeout(r, 10))

      await logger.logRead('temporal', { actor: 'v2-reader' })
      await logger.logRotate('temporal', { previousVersion: 1, newVersion: 2 })

      // Query at checkpoint1 should only show v1-reader
      const logsAtCheckpoint = await logger.getAuditLogAsOf('temporal', checkpoint1)

      expect(logsAtCheckpoint).toHaveLength(1)
      expect(logsAtCheckpoint[0].actor).toBe('v1-reader')
    })

    it('should support snapshots for audit compliance', async () => {
      const logger = createTestAuditLogger({ enableTemporalStore: true })

      await logger.logCreate('snapshot-test', { type: 'api_key' })
      await logger.logRead('snapshot-test', {})

      const snapshotId = await logger.createSnapshot()

      await logger.logRotate('snapshot-test', { previousVersion: 1, newVersion: 2 })

      // Current state has 3 entries
      const current = await logger.getAuditLog('snapshot-test')
      expect(current).toHaveLength(3)

      // Snapshot state has 2 entries
      const snapshotLogs = await logger.getAuditLogFromSnapshot('snapshot-test', snapshotId)
      expect(snapshotLogs).toHaveLength(2)
    })

    it('should retain audit logs for compliance period', async () => {
      const logger = createTestAuditLogger({
        enableTemporalStore: true,
        retentionPeriod: '90d',
      })

      await logger.logRead('retained', {})

      const retentionInfo = await logger.getRetentionInfo()

      expect(retentionInfo.retentionPeriod).toBe('90d')
    })
  })

  describe('Export and Reporting', () => {
    it('should export audit logs as JSON', async () => {
      const logger = createTestAuditLogger()

      await logger.logCreate('export-test', { type: 'api_key' })
      await logger.logRead('export-test', {})

      const exported = await logger.exportAuditLog('export-test', { format: 'json' })
      const parsed = JSON.parse(exported)

      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(2)
    })

    it('should export audit logs as CSV', async () => {
      const logger = createTestAuditLogger()

      await logger.logCreate('csv-test', { type: 'api_key', actor: 'admin' })
      await logger.logRead('csv-test', { actor: 'user' })

      const exported = await logger.exportAuditLog('csv-test', { format: 'csv' })

      expect(exported).toContain('action')
      expect(exported).toContain('create')
      expect(exported).toContain('read')
      expect(exported).toContain('admin')
      expect(exported).toContain('user')
    })

    it('should generate audit summary report', async () => {
      const logger = createTestAuditLogger()

      await logger.logCreate('summary-test', { type: 'api_key' })
      await logger.logRead('summary-test', {})
      await logger.logRead('summary-test', {})
      await logger.logRotate('summary-test', { previousVersion: 1, newVersion: 2 })
      await logger.logAccessDenied('summary-test', { reason: 'test' })

      const summary = await logger.getAuditSummary('summary-test')

      expect(summary.totalActions).toBe(5)
      expect(summary.actionCounts.create).toBe(1)
      expect(summary.actionCounts.read).toBe(2)
      expect(summary.actionCounts.rotate).toBe(1)
      expect(summary.actionCounts.access_denied).toBe(1)
    })
  })

  describe('Integrity', () => {
    it('should generate checksums for audit entries', async () => {
      const logger = createTestAuditLogger({ enableIntegrityChecks: true })

      await logger.logRead('checksum-test', { actor: 'user' })

      const logs = await logger.getAuditLog('checksum-test')

      expect(logs[0].checksum).toBeDefined()
      expect(logs[0].checksum?.length).toBeGreaterThan(0)
    })

    it('should verify audit log integrity', async () => {
      const logger = createTestAuditLogger({ enableIntegrityChecks: true })

      await logger.logCreate('integrity-test', { type: 'api_key' })
      await logger.logRead('integrity-test', {})
      await logger.logRotate('integrity-test', { previousVersion: 1, newVersion: 2 })

      const { valid, errors } = await logger.verifyIntegrity('integrity-test')

      expect(valid).toBe(true)
      expect(errors).toHaveLength(0)
    })

    it('should chain audit entries for tamper detection', async () => {
      const logger = createTestAuditLogger({
        enableIntegrityChecks: true,
        enableChaining: true,
      })

      await logger.logRead('chained', { actor: 'first' })
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5))
      await logger.logRead('chained', { actor: 'second' })

      const logs = await logger.getAuditLog('chained')

      // Logs are sorted descending (most recent first)
      // logs[0] is 'second' (most recent), logs[1] is 'first'
      expect(logs).toHaveLength(2)
      expect(logs[0].actor).toBe('second')
      expect(logs[1].actor).toBe('first')

      // 'second' entry should reference 'first' entry's hash
      expect(logs[0].previousHash).toBeDefined() // second has previous hash
      expect(logs[1].previousHash).toBeUndefined() // first entry has no previous
    })
  })

  describe('Real-time Events', () => {
    it('should emit events for new audit entries', async () => {
      const logger = createTestAuditLogger()

      const events: string[] = []
      logger.on('audit:entry', (entry) => events.push(entry.action))

      await logger.logCreate('event-test', { type: 'api_key' })
      await logger.logRead('event-test', {})

      expect(events).toEqual(['create', 'read'])
    })

    it('should support filtering events by credential', async () => {
      const logger = createTestAuditLogger()

      const cred1Events: string[] = []

      logger.on('audit:entry', (entry) => {
        if (entry.credentialName === 'cred-1') {
          cred1Events.push(entry.action)
        }
      })

      await logger.logRead('cred-1', {})
      await logger.logRead('cred-2', {})
      await logger.logRead('cred-1', {})

      expect(cred1Events).toHaveLength(2)
    })
  })
})
