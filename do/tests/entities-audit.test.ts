// EntityManager Audit Logging Tests (do-grp5.8)
// Tests for audit logging on all CRUD operations including bulk operations
// Runs in Node environment (no Workers pool needed)

import { describe, it, expect, beforeEach } from 'vitest'
import { EntityManager } from '../entities'

describe('EntityManager Audit Logging (do-grp5.8)', () => {
  describe('Audit Context Management', () => {
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

  // Skip until bulkCreate/bulkUpdate/bulkDelete are implemented
  describe.skip('Automatic Audit Logging on Bulk Operations', () => {
    let entityManager: EntityManager

    beforeEach(() => {
      entityManager = new EntityManager()
      entityManager.setAuditContext({
        actor: 'user-bulk',
        correlationId: 'req-bulk'
      })
    })

    it('should automatically log when Things are bulk created', async () => {
      const things = await entityManager.things.bulkCreate([
        { $type: 'Product', name: 'Product A' },
        { $type: 'Product', name: 'Product B' },
        { $type: 'Order', name: 'Order 1' }
      ])

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'bulk_create' })
      expect(logs.length).toBeGreaterThan(0)

      const bulkLog = logs[0]
      expect(bulkLog.actor).toBe('user-bulk')
      expect(bulkLog.action).toBe('bulk_create')
      expect(bulkLog.resource).toBe('Thing')
      expect(bulkLog.details).toMatchObject({
        count: 3,
        types: expect.arrayContaining(['Product', 'Order']),
        ids: expect.arrayContaining(things.map(t => t.$id))
      })
      expect(bulkLog.correlationId).toBe('req-bulk')
    })

    it('should automatically log when Things are bulk updated', async () => {
      const things = await entityManager.things.bulkCreate([
        { $type: 'Product', name: 'Product A', price: 10 },
        { $type: 'Product', name: 'Product B', price: 20 }
      ])

      await entityManager.things.bulkUpdate([
        { id: things[0].$id, data: { name: 'Product A Updated', price: 15 } },
        { id: things[1].$id, data: { name: 'Product B Updated' } }
      ])

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'bulk_update' })
      expect(logs.length).toBeGreaterThan(0)

      const bulkLog = logs[0]
      expect(bulkLog.actor).toBe('user-bulk')
      expect(bulkLog.action).toBe('bulk_update')
      expect(bulkLog.resource).toBe('Thing')
      expect(bulkLog.details).toMatchObject({
        count: 2,
        ids: expect.arrayContaining([things[0].$id, things[1].$id]),
        fields: expect.arrayContaining(['name', 'price'])
      })
    })

    it('should automatically log when Things are bulk deleted', async () => {
      const things = await entityManager.things.bulkCreate([
        { $type: 'Temp', name: 'Temp 1' },
        { $type: 'Temp', name: 'Temp 2' },
        { $type: 'Temp', name: 'Temp 3' }
      ])

      const ids = things.map(t => t.$id)
      await entityManager.things.bulkDelete(ids)

      // Wait for async audit logging
      await new Promise(resolve => setTimeout(resolve, 10))

      const logs = await entityManager.auditLogs.query({ action: 'bulk_delete' })
      expect(logs.length).toBeGreaterThan(0)

      const bulkLog = logs[0]
      expect(bulkLog.actor).toBe('user-bulk')
      expect(bulkLog.action).toBe('bulk_delete')
      expect(bulkLog.resource).toBe('Thing')
      expect(bulkLog.details).toMatchObject({
        count: 3,
        ids: expect.arrayContaining(ids),
        types: ['Temp']
      })
    })

    it('should emit individual events for each item in bulk operations', async () => {
      const things = await entityManager.things.bulkCreate([
        { $type: 'Item', name: 'Item 1' },
        { $type: 'Item', name: 'Item 2' }
      ])

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10))

      const events = await entityManager.events.query({ type: 'Thing.created' })
      expect(events.length).toBeGreaterThanOrEqual(2)

      // Verify each created thing has a corresponding event
      for (const thing of things) {
        const event = events.find(e => e.source === thing.$id)
        expect(event).toBeDefined()
      }
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
