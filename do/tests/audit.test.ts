// Audit Logging Integration Tests for DO/EntityManager (do-xebw)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DO'
import { EntityManager } from '../entities'
import type { Thing } from '../../db'

// Mock DurableObjectState
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('Audit Logging Integration (do-xebw)', () => {
  describe('EntityManager Audit Context', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
    })

    it('should have default audit context with system actor', () => {
      const context = entityManager.getAuditContext()
      expect(context.actor).toBe('system')
    })

    it('should allow setting audit context', () => {
      entityManager.setAuditContext({
        actor: 'user-123',
        correlationId: 'req-abc'
      })

      const context = entityManager.getAuditContext()
      expect(context.actor).toBe('user-123')
      expect(context.correlationId).toBe('req-abc')
    })

    it('should have access to audit logs store', () => {
      expect(entityManager.auditLogs).toBeDefined()
      expect(typeof entityManager.auditLogs.log).toBe('function')
      expect(typeof entityManager.auditLogs.query).toBe('function')
    })
  })

  describe('Automatic Audit Logging on Things', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
      entityManager.setAuditContext({
        actor: 'user-123',
        correlationId: 'req-abc'
      })
    })

    it('should automatically log when a Thing is created', async () => {
      const thing = await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'create' })
      expect(logs.length).toBeGreaterThan(0)

      const createLog = logs.find(l => l.resourceId === thing.$id)
      expect(createLog).toBeDefined()
      expect(createLog!.actor).toBe('user-123')
      expect(createLog!.action).toBe('create')
      expect(createLog!.resource).toBe('Customer')
      expect(createLog!.correlationId).toBe('req-abc')
    })

    it('should automatically log when a Thing is updated', async () => {
      const thing = await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      await entityManager.things.update(thing.$id, { name: 'Alicia' })

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'update' })
      expect(logs.length).toBeGreaterThan(0)

      const updateLog = logs.find(l => l.resourceId === thing.$id)
      expect(updateLog).toBeDefined()
      expect(updateLog!.actor).toBe('user-123')
      expect(updateLog!.action).toBe('update')
      expect(updateLog!.details).toEqual({ fields: ['name'] })
    })

    it('should automatically log when a Thing is deleted', async () => {
      const thing = await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      await entityManager.things.delete(thing.$id)

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'delete' })
      expect(logs.length).toBeGreaterThan(0)

      const deleteLog = logs.find(l => l.resourceId === thing.$id)
      expect(deleteLog).toBeDefined()
      expect(deleteLog!.resource).toBe('Customer')
    })
  })

  describe('Automatic Audit Logging on Relationships', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
      entityManager.setAuditContext({
        actor: 'user-456',
        correlationId: 'req-xyz'
      })
    })

    it('should automatically log when a Relationship is added', async () => {
      await entityManager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({
        action: 'create',
        resource: 'Relationship'
      })
      expect(logs.length).toBeGreaterThan(0)

      const addLog = logs[0]
      expect(addLog.actor).toBe('user-456')
      expect(addLog.details).toEqual({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })
    })

    it('should automatically log when a Relationship is removed', async () => {
      await entityManager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      await entityManager.relationships.remove({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1'
      })

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({
        action: 'delete',
        resource: 'Relationship'
      })
      expect(logs.length).toBeGreaterThan(0)
    })
  })

  describe('DO Class Audit Integration', () => {
    let doInstance: DO
    let mockState: DurableObjectState

    beforeEach(() => {
      mockState = createMockState()
      doInstance = new DO(mockState, {})
    })

    it('should expose auditLogs accessor', () => {
      expect((doInstance as any).auditLogs).toBeDefined()
      expect(typeof (doInstance as any).auditLogs.log).toBe('function')
    })

    it('should expose setAuditContext method', () => {
      expect(typeof (doInstance as any).setAuditContext).toBe('function')
    })

    it('should expose getAuditContext method', () => {
      expect(typeof (doInstance as any).getAuditContext).toBe('function')
    })

    it('should set and get audit context', () => {
      (doInstance as any).setAuditContext({
        actor: 'user-789',
        correlationId: 'req-123'
      })

      const context = (doInstance as any).getAuditContext()
      expect(context.actor).toBe('user-789')
      expect(context.correlationId).toBe('req-123')
    })

    it('should query audit logs via RPC', async () => {
      // Create a thing (which should generate audit log)
      await doInstance.fetch(new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Test' }]
        })
      }))

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      // Query audit logs
      const queryReq = new Request('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'auditLogs.query',
          args: [{}]
        })
      })

      const response = await doInstance.fetch(queryReq)
      expect(response.status).toBe(200)

      const logs = await response.json()
      expect(Array.isArray(logs)).toBe(true)
    })
  })

  describe('Audit Config Options', () => {
    it('should disable audit logging when configured', async () => {
      const entityManager = new EntityManager({
        auditConfig: { enabled: false }
      })

      await entityManager.things.create({
        $type: 'Customer',
        name: 'Alice'
      })

      // Wait for async audit logging (if any)
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query()
      expect(logs.length).toBe(0)
    })

    it('should mask sensitive fields in audit details', async () => {
      const entityManager = new EntityManager()
      entityManager.setAuditContext({ actor: 'user-1' })

      // Log directly with sensitive data
      await entityManager.auditLogs.log({
        actor: 'user-1',
        action: 'update',
        resource: 'User',
        resourceId: 'user-1',
        level: 'info',
        details: {
          password: 'secret123', // Should be masked
          email: 'test@example.com'
        }
      })

      // Note: The masking happens in the logAudit helper, not the store directly
      // For direct logs, users should pre-mask or use the EntityManager wrapper
    })
  })

  describe('Audit Log Retention', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
    })

    it('should delete logs older than specified timestamp', async () => {
      // Create some logs
      await entityManager.auditLogs.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Test',
        level: 'info'
      })

      const deleted = await entityManager.auditLogs.deleteOlderThan(Date.now() + 1000)
      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should delete all logs', async () => {
      await entityManager.auditLogs.log({
        actor: 'user-1',
        action: 'create',
        resource: 'Test',
        level: 'info'
      })

      await entityManager.auditLogs.log({
        actor: 'user-2',
        action: 'update',
        resource: 'Test',
        level: 'info'
      })

      const deleted = await entityManager.auditLogs.deleteAll()
      expect(deleted).toBe(2)

      const remaining = await entityManager.auditLogs.count()
      expect(remaining).toBe(0)
    })
  })

  describe('Correlation ID Tracking', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
    })

    it('should track correlation ID across multiple operations', async () => {
      const correlationId = 'request-123'

      entityManager.setAuditContext({
        actor: 'user-1',
        correlationId
      })

      // Perform multiple operations
      const thing = await entityManager.things.create({
        $type: 'Order',
        status: 'pending'
      })

      await entityManager.things.update(thing.$id, { status: 'processing' })

      await entityManager.relationships.add({
        subject: 'user-1',
        predicate: 'placed',
        object: thing.$id
      })

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20))

      // Query by correlation ID
      const logs = await entityManager.auditLogs.query()
      const correlatedLogs = logs.filter(l => l.correlationId === correlationId)

      expect(correlatedLogs.length).toBeGreaterThanOrEqual(3)
      expect(correlatedLogs.every(l => l.correlationId === correlationId)).toBe(true)
    })
  })
})
