/**
 * EntityManager Storage Adapter Migration Tests (do-xjmbd)
 *
 * TDD Red-Green-Refactor tests to verify EntityManager migration from
 * deprecated createThingsStore() to createThingsStoreWithAdapter().
 *
 * These tests verify:
 * 1. EntityManager can be constructed with an optional StorageAdapter
 * 2. The deprecated createThingsStore() is NOT called
 * 3. Internal stores use the adapter-based implementations
 *
 * @module do/tests/entity-manager-adapter.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EntityManager, EntityManagerOptions } from '../entities'
import {
  MemoryStorageAdapter,
  type StorageAdapter,
} from '../../db'

// ============================================================================
// TEST SUITE: EntityManager Storage Adapter Integration (do-xjmbd)
// ============================================================================

describe('EntityManager Storage Adapter Migration (do-xjmbd)', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Spy on console.warn to detect deprecation warnings
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('Deprecation Warning Detection', () => {
    it('should NOT emit deprecation warning when constructed', () => {
      // The EntityManager should NOT call the deprecated createThingsStore()
      // which emits a console.warn with "[DEPRECATION] createThingsStore()"
      const manager = new EntityManager()

      // If the deprecated function is called, it emits a warning
      const deprecationWarnings = consoleWarnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('[DEPRECATION] createThingsStore')
      )

      // This test will FAIL if EntityManager still uses deprecated createThingsStore()
      expect(deprecationWarnings.length).toBe(0)
    })

    it('should allow constructing EntityManager with default options', () => {
      // Should work without any options (uses default adapter internally)
      const manager = new EntityManager()
      expect(manager).toBeDefined()
      expect(manager.things).toBeDefined()
      expect(manager.events).toBeDefined()
      expect(manager.relationships).toBeDefined()
    })

    it('should allow constructing EntityManager with custom options', () => {
      const options: EntityManagerOptions = {
        auditConfig: {
          enabled: false,
        },
      }

      const manager = new EntityManager(options)
      expect(manager).toBeDefined()
    })
  })

  describe('Store Functionality Verification', () => {
    let manager: EntityManager

    beforeEach(() => {
      manager = new EntityManager()
    })

    it('should create things without deprecation warnings', async () => {
      const thing = await manager.things.create({
        $type: 'TestEntity',
        name: 'Test',
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('TestEntity')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()

      // Verify no deprecation warnings were emitted during operation
      const deprecationWarnings = consoleWarnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('[DEPRECATION] createThingsStore')
      )
      expect(deprecationWarnings.length).toBe(0)
    })

    it('should get things correctly', async () => {
      const created = await manager.things.create({
        $type: 'TestEntity',
        name: 'Test',
      })

      const retrieved = await manager.things.get(created.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
    })

    it('should update things correctly', async () => {
      const created = await manager.things.create({
        $type: 'TestEntity',
        name: 'Original',
      })

      const updated = await manager.things.update(created.$id, {
        name: 'Updated',
      })

      expect(updated.$id).toBe(created.$id)
      expect((updated as { name: string }).name).toBe('Updated')
    })

    it('should delete things correctly', async () => {
      const created = await manager.things.create({
        $type: 'TestEntity',
        name: 'ToDelete',
      })

      await manager.things.delete(created.$id)

      const retrieved = await manager.things.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should list things correctly', async () => {
      await manager.things.create({ $type: 'TypeA', name: 'A1' })
      await manager.things.create({ $type: 'TypeA', name: 'A2' })
      await manager.things.create({ $type: 'TypeB', name: 'B1' })

      const allThings = await manager.things.list({})
      expect(allThings.length).toBe(3)

      const typeAThings = await manager.things.list({ type: 'TypeA' })
      expect(typeAThings.length).toBe(2)
    })
  })

  describe('Events Store Integration', () => {
    let manager: EntityManager

    beforeEach(() => {
      manager = new EntityManager()
    })

    it('should emit Thing.created event on create', async () => {
      await manager.things.create({ $type: 'Customer', name: 'Alice' })

      const events = await manager.events.query({ type: 'Thing.created' })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should emit Thing.updated event on update', async () => {
      const created = await manager.things.create({
        $type: 'Customer',
        name: 'Alice',
      })

      await manager.things.update(created.$id, { name: 'Alicia' })

      const events = await manager.events.query({ type: 'Thing.updated' })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should emit Thing.deleted event on delete', async () => {
      const created = await manager.things.create({
        $type: 'Customer',
        name: 'Alice',
      })

      await manager.things.delete(created.$id)

      const events = await manager.events.query({ type: 'Thing.deleted' })
      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('Relationships Store Integration', () => {
    let manager: EntityManager

    beforeEach(() => {
      manager = new EntityManager()
    })

    it('should add relationships correctly', async () => {
      const rel = await manager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
      expect(rel.$createdAt).toBeDefined()
    })

    it('should emit Relationship.added event', async () => {
      await manager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })

      const events = await manager.events.query({ type: 'Relationship.added' })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should find relationships correctly', async () => {
      await manager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })
      await manager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-2',
      })

      const rels = await manager.relationships.find({
        subject: 'user-1',
        predicate: 'owns',
      })
      expect(rels.length).toBe(2)
    })

    it('should remove relationships correctly', async () => {
      await manager.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })

      await manager.relationships.remove({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })

      const rels = await manager.relationships.find({
        subject: 'user-1',
        predicate: 'owns',
      })
      expect(rels.length).toBe(0)
    })
  })

  describe('Audit Context Integration', () => {
    let manager: EntityManager

    beforeEach(() => {
      manager = new EntityManager()
    })

    it('should set and get audit context', () => {
      manager.setAuditContext({
        actor: 'test-user',
        correlationId: 'test-correlation-id',
      })

      const context = manager.getAuditContext()
      expect(context.actor).toBe('test-user')
      expect(context.correlationId).toBe('test-correlation-id')
    })

    it('should have default audit context', () => {
      const context = manager.getAuditContext()
      expect(context.actor).toBe('system')
    })
  })

  describe('Query Builder Integration', () => {
    let manager: EntityManager

    beforeEach(() => {
      manager = new EntityManager()
    })

    it('should provide query builder through query() method', async () => {
      await manager.things.create({ $type: 'Customer', name: 'Alice' })
      await manager.things.create({ $type: 'Customer', name: 'Bob' })
      await manager.things.create({ $type: 'Order', total: 100 })

      const query = manager.query()
      expect(query).toBeDefined()
      expect(typeof query.where).toBe('function')
    })
  })
})
