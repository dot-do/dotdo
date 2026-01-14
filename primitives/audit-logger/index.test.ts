import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  AuditLogger,
  AuditStore,
  EventSigner,
  ChainVerifier,
  RetentionManager,
  ComplianceExporter,
  AuditQueryBuilder,
  computeDiff,
} from './index'
import type {
  AuditEvent,
  AuditEventInput,
  AuditActor,
  AuditResource,
  AuditConfig,
  SignedAuditEvent,
} from './types'

describe('AuditLogger', () => {
  let logger: AuditLogger
  let store: AuditStore

  beforeEach(() => {
    store = new AuditStore()
    logger = new AuditLogger({ store })
  })

  describe('Basic Event Logging', () => {
    it('should log a simple audit event', async () => {
      const input: AuditEventInput = {
        action: 'create',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'document', id: 'doc-456' },
      }

      const event = await logger.log(input)

      expect(event).toBeDefined()
      expect(event.id).toBeDefined()
      expect(event.action).toBe('create')
      expect(event.actor.id).toBe('user-123')
      expect(event.resource.id).toBe('doc-456')
      expect(event.timestamp).toBeInstanceOf(Date)
    })

    it('should generate unique event IDs', async () => {
      const input: AuditEventInput = {
        action: 'read',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'document', id: 'doc-456' },
      }

      const event1 = await logger.log(input)
      const event2 = await logger.log(input)

      expect(event1.id).not.toBe(event2.id)
    })

    it('should store events in the audit store', async () => {
      const input: AuditEventInput = {
        action: 'update',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'document', id: 'doc-456' },
      }

      await logger.log(input)

      const events = await store.getAll()
      expect(events).toHaveLength(1)
    })

    it('should include metadata in audit events', async () => {
      const input: AuditEventInput = {
        action: 'delete',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'document', id: 'doc-456' },
        metadata: { reason: 'cleanup', approvedBy: 'admin' },
      }

      const event = await logger.log(input)

      expect(event.metadata).toEqual({ reason: 'cleanup', approvedBy: 'admin' })
    })

    it('should track actor details', async () => {
      const input: AuditEventInput = {
        action: 'login',
        actor: {
          type: 'user',
          id: 'user-123',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          session: 'sess-789',
        },
        resource: { type: 'session', id: 'sess-789' },
      }

      const event = await logger.log(input)

      expect(event.actor.ip).toBe('192.168.1.1')
      expect(event.actor.userAgent).toBe('Mozilla/5.0')
      expect(event.actor.session).toBe('sess-789')
    })

    it('should track outcome and errors', async () => {
      const input: AuditEventInput = {
        action: 'update',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'document', id: 'doc-456' },
        outcome: 'failure',
        error: 'Permission denied',
      }

      const event = await logger.log(input)

      expect(event.outcome).toBe('failure')
      expect(event.error).toBe('Permission denied')
    })

    it('should support custom actions', async () => {
      const input: AuditEventInput = {
        action: 'custom',
        customAction: 'approve_workflow',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'workflow', id: 'wf-789' },
      }

      const event = await logger.log(input)

      expect(event.action).toBe('custom')
      expect(event.customAction).toBe('approve_workflow')
    })
  })

  describe('Query by Action Type', () => {
    beforeEach(async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'read', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'delete', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
    })

    it('should query events by single action type', async () => {
      const result = await logger.query({
        filters: { actions: ['create'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].action).toBe('create')
    })

    it('should query events by multiple action types', async () => {
      const result = await logger.query({
        filters: { actions: ['create', 'delete'] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.events.map(e => e.action)).toContain('create')
      expect(result.events.map(e => e.action)).toContain('delete')
    })
  })

  describe('Query by Actor', () => {
    beforeEach(async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'user-1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'create', actor: { type: 'user', id: 'user-2' }, resource: { type: 'doc', id: 'd2' } })
      await logger.log({ action: 'read', actor: { type: 'agent', id: 'agent-1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'update', actor: { type: 'user', id: 'user-1' }, resource: { type: 'doc', id: 'd1' } })
    })

    it('should query events by actor ID', async () => {
      const result = await logger.query({
        filters: { actorIds: ['user-1'] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.events.every(e => e.actor.id === 'user-1')).toBe(true)
    })

    it('should query events by actor type', async () => {
      const result = await logger.query({
        filters: { actorTypes: ['agent'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].actor.type).toBe('agent')
    })

    it('should get all activity by actor using getByActor', async () => {
      const events = await logger.getByActor('user-1')

      expect(events).toHaveLength(2)
    })
  })

  describe('Query by Resource', () => {
    beforeEach(async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'document', id: 'doc-1' } })
      await logger.log({ action: 'read', actor: { type: 'user', id: 'u1' }, resource: { type: 'document', id: 'doc-1' } })
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'folder', id: 'folder-1' } })
      await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'document', id: 'doc-2' } })
    })

    it('should query events by resource ID', async () => {
      const result = await logger.query({
        filters: { resourceIds: ['doc-1'] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.events.every(e => e.resource.id === 'doc-1')).toBe(true)
    })

    it('should query events by resource type', async () => {
      const result = await logger.query({
        filters: { resourceTypes: ['folder'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].resource.type).toBe('folder')
    })

    it('should get resource history using getByResource', async () => {
      const events = await logger.getByResource('doc-1')

      expect(events).toHaveLength(2)
      expect(events.map(e => e.action)).toEqual(['create', 'read'])
    })
  })

  describe('Date Range Filtering', () => {
    beforeEach(async () => {
      vi.useFakeTimers()

      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      await logger.log({ action: 'read', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      vi.setSystemTime(new Date('2024-02-01T10:00:00Z'))
      await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should filter events by date range', async () => {
      const result = await logger.query({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(result.events).toHaveLength(2)
    })

    it('should filter events with only from date', async () => {
      const result = await logger.query({
        dateRange: {
          from: new Date('2024-01-15T00:00:00Z'),
        },
      })

      expect(result.events).toHaveLength(2)
    })

    it('should filter events with only to date', async () => {
      const result = await logger.query({
        dateRange: {
          to: new Date('2024-01-14T23:59:59Z'),
        },
      })

      expect(result.events).toHaveLength(1)
    })
  })

  describe('Pagination', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) {
        await logger.log({
          action: 'read',
          actor: { type: 'user', id: 'u1' },
          resource: { type: 'doc', id: `doc-${i}` },
        })
      }
    })

    it('should limit results', async () => {
      const result = await logger.query({
        pagination: { limit: 10 },
      })

      expect(result.events).toHaveLength(10)
      expect(result.total).toBe(25)
      expect(result.hasMore).toBe(true)
    })

    it('should offset results', async () => {
      const result = await logger.query({
        pagination: { offset: 20, limit: 10 },
      })

      expect(result.events).toHaveLength(5)
      expect(result.hasMore).toBe(false)
    })

    it('should provide next offset', async () => {
      const result = await logger.query({
        pagination: { limit: 10 },
      })

      expect(result.nextOffset).toBe(10)
    })

    it('should sort results by timestamp ascending', async () => {
      const result = await logger.query({
        pagination: { sortBy: 'timestamp', sortOrder: 'asc', limit: 5 },
      })

      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          result.events[i - 1].timestamp.getTime()
        )
      }
    })

    it('should sort results by timestamp descending', async () => {
      const result = await logger.query({
        pagination: { sortBy: 'timestamp', sortOrder: 'desc', limit: 5 },
      })

      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].timestamp.getTime()).toBeLessThanOrEqual(
          result.events[i - 1].timestamp.getTime()
        )
      }
    })
  })

  describe('Event Signing and Verification', () => {
    let signingLogger: AuditLogger
    let signer: EventSigner

    beforeEach(() => {
      const signingStore = new AuditStore()
      signer = new EventSigner({ key: 'test-secret-key' })
      signingLogger = new AuditLogger({
        store: signingStore,
        config: { signing: true, signingKey: 'test-secret-key' },
      })
    })

    it('should sign events when signing is enabled', async () => {
      const event = await signingLogger.log({
        action: 'create',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      expect(event.signature).toBeDefined()
      expect(event.hash).toBeDefined()
      expect(event.algorithm).toBe('sha256')
    })

    it('should verify valid signatures', async () => {
      const event = await signingLogger.log({
        action: 'create',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      const isValid = signer.verify(event)
      expect(isValid).toBe(true)
    })

    it('should detect tampered events', async () => {
      const event = await signingLogger.log({
        action: 'create',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      // Tamper with the event
      const tamperedEvent = { ...event, action: 'delete' as const }

      const isValid = signer.verify(tamperedEvent)
      expect(isValid).toBe(false)
    })

    it('should include previous hash for chain verification', async () => {
      const event1 = await signingLogger.log({
        action: 'create',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      const event2 = await signingLogger.log({
        action: 'update',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      expect(event2.previousHash).toBe(event1.hash)
    })
  })

  describe('Chain Integrity Check', () => {
    let signingLogger: AuditLogger
    let verifier: ChainVerifier

    beforeEach(() => {
      const signingStore = new AuditStore()
      signingLogger = new AuditLogger({
        store: signingStore,
        config: { signing: true, signingKey: 'test-secret-key', chainVerification: true },
      })
      verifier = new ChainVerifier({ key: 'test-secret-key' })
    })

    it('should verify a valid chain', async () => {
      await signingLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await signingLogger.log({ action: 'read', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await signingLogger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      const events = await signingLogger.query({})
      const result = verifier.verifyChain(events.events as SignedAuditEvent[])

      expect(result.valid).toBe(true)
      expect(result.eventsVerified).toBe(3)
    })

    it('should detect a broken chain', async () => {
      await signingLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await signingLogger.log({ action: 'read', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      const queryResult = await signingLogger.query({})
      const events = queryResult.events as SignedAuditEvent[]

      // Break the chain by modifying the hash
      events[0] = { ...events[0], hash: 'tampered-hash' }

      const result = verifier.verifyChain(events)

      expect(result.valid).toBe(false)
      expect(result.brokenAtIndex).toBe(1)
    })
  })

  describe('Tamper Detection', () => {
    let signingLogger: AuditLogger
    let signer: EventSigner

    beforeEach(() => {
      const signingStore = new AuditStore()
      signer = new EventSigner({ key: 'test-secret-key' })
      signingLogger = new AuditLogger({
        store: signingStore,
        config: { signing: true, signingKey: 'test-secret-key' },
      })
    })

    it('should detect modification of actor', async () => {
      const event = await signingLogger.log({
        action: 'delete',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      const tampered = { ...event, actor: { ...event.actor, id: 'user-456' } }

      expect(signer.verify(tampered)).toBe(false)
    })

    it('should detect modification of timestamp', async () => {
      const event = await signingLogger.log({
        action: 'delete',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'doc', id: 'd1' },
      }) as SignedAuditEvent

      const tampered = { ...event, timestamp: new Date('2020-01-01') }

      expect(signer.verify(tampered)).toBe(false)
    })

    it('should detect modification of metadata', async () => {
      const event = await signingLogger.log({
        action: 'delete',
        actor: { type: 'user', id: 'user-123' },
        resource: { type: 'doc', id: 'd1' },
        metadata: { approved: true },
      }) as SignedAuditEvent

      const tampered = { ...event, metadata: { approved: false } }

      expect(signer.verify(tampered)).toBe(false)
    })
  })

  describe('Retention Policy Enforcement', () => {
    let retentionStore: AuditStore
    let retentionLogger: AuditLogger
    let retentionManager: RetentionManager

    beforeEach(() => {
      vi.useFakeTimers()
      retentionStore = new AuditStore()
      retentionLogger = new AuditLogger({
        store: retentionStore,
        config: { retention: { retentionDays: 30 } },
      })
      retentionManager = new RetentionManager({
        store: retentionStore,
        policy: { retentionDays: 30 },
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should retain events within retention period', async () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      await retentionLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      vi.setSystemTime(new Date('2024-02-01T10:00:00Z'))
      await retentionManager.enforce()

      const events = await retentionStore.getAll()
      expect(events).toHaveLength(1)
    })

    it('should delete events outside retention period', async () => {
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
      await retentionLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      vi.setSystemTime(new Date('2024-03-01T10:00:00Z'))
      await retentionManager.enforce()

      const events = await retentionStore.getAll()
      expect(events).toHaveLength(0)
    })

    it('should archive events before deletion when configured', async () => {
      const archiveStore = new AuditStore()
      const archivingManager = new RetentionManager({
        store: retentionStore,
        policy: { retentionDays: 30, archiveBeforeDelete: true },
        archiveStore,
      })

      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
      await retentionLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      vi.setSystemTime(new Date('2024-03-01T10:00:00Z'))
      await archivingManager.enforce()

      const currentEvents = await retentionStore.getAll()
      const archivedEvents = await archiveStore.getAll()

      expect(currentEvents).toHaveLength(0)
      expect(archivedEvents).toHaveLength(1)
    })
  })

  describe('Compliance Report Generation', () => {
    let complianceLogger: AuditLogger
    let exporter: ComplianceExporter

    beforeEach(async () => {
      vi.useFakeTimers()
      const complianceStore = new AuditStore()
      complianceLogger = new AuditLogger({
        store: complianceStore,
        config: { signing: true, signingKey: 'test-key', chainVerification: true },
      })
      exporter = new ComplianceExporter({ logger: complianceLogger, signingKey: 'test-key' })

      vi.setSystemTime(new Date('2024-01-05T10:00:00Z'))
      await complianceLogger.log({ action: 'login', actor: { type: 'user', id: 'u1' }, resource: { type: 'session', id: 's1' }, outcome: 'success' })
      await complianceLogger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' }, outcome: 'success' })
      await complianceLogger.log({ action: 'read', actor: { type: 'agent', id: 'a1' }, resource: { type: 'doc', id: 'd1' }, outcome: 'success' })
      await complianceLogger.log({ action: 'update', actor: { type: 'user', id: 'u2' }, resource: { type: 'doc', id: 'd1' }, outcome: 'failure', error: 'Permission denied' })
      await complianceLogger.log({ action: 'delete', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd2' }, outcome: 'success' })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should generate a compliance report', async () => {
      const report = await exporter.export({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.id).toBeDefined()
      expect(report.generatedAt).toBeDefined()
      expect(report.summary.totalEvents).toBe(5)
    })

    it('should include events by action breakdown', async () => {
      const report = await exporter.export({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.summary.eventsByAction.login).toBe(1)
      expect(report.summary.eventsByAction.create).toBe(1)
      expect(report.summary.eventsByAction.read).toBe(1)
      expect(report.summary.eventsByAction.update).toBe(1)
      expect(report.summary.eventsByAction.delete).toBe(1)
    })

    it('should include events by actor type breakdown', async () => {
      const report = await exporter.export({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.summary.eventsByActorType.user).toBe(4)
      expect(report.summary.eventsByActorType.agent).toBe(1)
    })

    it('should count unique actors', async () => {
      const report = await exporter.export({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.summary.uniqueActors).toBe(3) // u1, u2, a1
    })

    it('should count failed events', async () => {
      const report = await exporter.export({
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.summary.failedEvents).toBe(1)
    })

    it('should include chain integrity status when requested', async () => {
      const report = await exporter.export({
        verifyChain: true,
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.chainIntegrity).toBeDefined()
      expect(report.chainIntegrity?.verified).toBe(true)
    })

    it('should include detailed events when requested', async () => {
      const report = await exporter.export({
        includeEvents: true,
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
      })

      expect(report.events).toBeDefined()
      expect(report.events).toHaveLength(5)
    })
  })

  describe('Diff Tracking (Before/After)', () => {
    it('should track before and after states', async () => {
      const input: AuditEventInput = {
        action: 'update',
        actor: { type: 'user', id: 'u1' },
        resource: {
          type: 'document',
          id: 'd1',
          before: { title: 'Old Title', content: 'Old content' },
          after: { title: 'New Title', content: 'Old content' },
        },
      }

      const event = await logger.log(input)

      expect(event.resource.before).toEqual({ title: 'Old Title', content: 'Old content' })
      expect(event.resource.after).toEqual({ title: 'New Title', content: 'Old content' })
    })

    it('should compute diff between before and after states', () => {
      const before = { title: 'Old Title', content: 'Same', removed: 'value' }
      const after = { title: 'New Title', content: 'Same', added: 'value' }

      const diff = computeDiff(before, after)

      expect(diff.changed.title).toEqual({ old: 'Old Title', new: 'New Title' })
      expect(diff.added.added).toBe('value')
      expect(diff.removed.removed).toBe('value')
    })

    it('should detect nested changes in diff', () => {
      const before = { user: { name: 'Old', email: 'same@example.com' } }
      const after = { user: { name: 'New', email: 'same@example.com' } }

      const diff = computeDiff(before, after)

      expect(diff.changed.user).toEqual({
        old: { name: 'Old', email: 'same@example.com' },
        new: { name: 'New', email: 'same@example.com' },
      })
    })
  })

  describe('AuditQueryBuilder', () => {
    beforeEach(async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' }, outcome: 'success' })
      await logger.log({ action: 'read', actor: { type: 'agent', id: 'a1' }, resource: { type: 'doc', id: 'd1' }, outcome: 'success' })
      await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'folder', id: 'f1' }, outcome: 'failure' })
    })

    it('should build queries fluently', async () => {
      const result = await new AuditQueryBuilder(logger)
        .withAction('create')
        .byActor('u1')
        .execute()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].action).toBe('create')
    })

    it('should chain multiple filters', async () => {
      const result = await new AuditQueryBuilder(logger)
        .byActorType('user')
        .withOutcome('failure')
        .execute()

      expect(result.events).toHaveLength(1)
      expect(result.events[0].outcome).toBe('failure')
    })

    it('should support pagination in builder', async () => {
      const result = await new AuditQueryBuilder(logger)
        .limit(2)
        .offset(0)
        .sortBy('timestamp', 'desc')
        .execute()

      expect(result.events).toHaveLength(2)
    })
  })

  describe('AuditStore', () => {
    it('should append events immutably', async () => {
      const event1 = await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      const event2 = await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      const events = await store.getAll()

      expect(events).toHaveLength(2)
      expect(events[0].id).toBe(event1.id)
      expect(events[1].id).toBe(event2.id)
    })

    it('should not allow modification of stored events', async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      const events = await store.getAll()
      const originalAction = events[0].action

      // Attempt to modify
      events[0].action = 'delete'

      // Re-fetch and verify unchanged
      const freshEvents = await store.getAll()
      expect(freshEvents[0].action).toBe(originalAction)
    })

    it('should get the last event', async () => {
      await logger.log({ action: 'create', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      await logger.log({ action: 'update', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })
      const lastEvent = await logger.log({ action: 'delete', actor: { type: 'user', id: 'u1' }, resource: { type: 'doc', id: 'd1' } })

      const retrieved = await store.getLast()

      expect(retrieved?.id).toBe(lastEvent.id)
      expect(retrieved?.action).toBe('delete')
    })
  })
})
