/**
 * EntityManager SQLite Storage Integration Tests (do-8m4e)
 *
 * TDD RED phase: These tests verify that EntityManager can wire to SQLite storage
 * when provided with a DurableObjectState.
 *
 * The goal is to ensure entity data (things, events, relationships, audit logs)
 * persists via SQLite rather than being lost in in-memory Maps/Arrays.
 *
 * @module do/tests/entities-sqlite.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { DO } from '../DO'
import type { Thing, Event, Relationship } from '@dotdo/db'

// ============================================================================
// TEST HELPER: Get DO stub with real SQLite storage
// ============================================================================

function getTestDO(name: string = 'test-' + Date.now()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: EntityManager SQLite Storage Integration
// ============================================================================

describe('EntityManager SQLite Storage Integration (do-8m4e)', () => {
  /**
   * These tests verify that:
   * 1. EntityManager accepts DurableObjectState in its constructor
   * 2. When state is provided, stores use SQLite via state.storage.sql
   * 3. Data persists across different stub accesses to the same DO ID
   * 4. Backward compatibility: without state, in-memory stores are used
   */

  describe('Things Store with SQLite', () => {
    it('should persist things via SQLite storage', async () => {
      const doName = `sqlite-things-${Date.now()}`

      // First access - create a thing
      const stub1 = getTestDO(doName)
      const createRes = await stub1.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice', email: 'alice@test.com' }]
        })
      })
      expect(createRes.status).toBe(200)
      const created = await createRes.json() as Thing

      expect(created.$id).toBeDefined()
      expect(created.$type).toBe('Customer')
      expect(created.name).toBe('Alice')

      // Second access - verify thing persists via SQLite
      // Getting a new stub to the same DO simulates accessing after potential evacuation
      const stub2 = getTestDO(doName)
      const getRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })

      expect(getRes.status).toBe(200)
      const retrieved = await getRes.json() as Thing

      // This assertion will FAIL if storage is in-memory
      // Things stored in-memory would be lost between stub accesses
      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.$type).toBe('Customer')
      expect(retrieved.name).toBe('Alice')
      expect(retrieved.email).toBe('alice@test.com')
      expect(retrieved.$createdAt).toBe(created.$createdAt)
    })

    it('should persist things list via SQLite', async () => {
      const doName = `sqlite-things-list-${Date.now()}`
      const stub = getTestDO(doName)

      // Create multiple things
      const names = ['Alice', 'Bob', 'Charlie']
      for (const name of names) {
        await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'things.create',
            args: [{ $type: 'Customer', name }]
          })
        })
      }

      // Get fresh stub and verify list persists
      const stub2 = getTestDO(doName)
      const listRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.list',
          args: [{ type: 'Customer' }]
        })
      })

      expect(listRes.status).toBe(200)
      const things = await listRes.json() as Thing[]

      // Should have all 3 customers persisted
      expect(things).toHaveLength(3)
      const retrievedNames = things.map((t) => (t as { name?: string }).name).sort()
      expect(retrievedNames).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should persist thing updates via SQLite', async () => {
      const doName = `sqlite-things-update-${Date.now()}`
      const stub = getTestDO(doName)

      // Create thing
      const createRes = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice', status: 'active' }]
        })
      })
      const created = await createRes.json() as Thing

      // Update thing
      await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.update',
          args: [created.$id, { status: 'inactive' }]
        })
      })

      // Get fresh stub and verify update persisted
      const stub2 = getTestDO(doName)
      const getRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })

      const retrieved = await getRes.json() as Thing & { status: string }
      expect(retrieved.status).toBe('inactive')
      expect(retrieved.$updatedAt).toBeGreaterThan(created.$createdAt)
    })

    it('should persist thing deletions via SQLite', async () => {
      const doName = `sqlite-things-delete-${Date.now()}`
      const stub = getTestDO(doName)

      // Create thing
      const createRes = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'ToBeDeleted' }]
        })
      })
      const created = await createRes.json() as Thing

      // Delete thing
      await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.delete',
          args: [created.$id]
        })
      })

      // Get fresh stub and verify deletion persisted
      const stub2 = getTestDO(doName)
      const getRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })

      const retrieved = await getRes.json()
      expect(retrieved).toBeNull()
    })
  })

  describe('Events Store with SQLite', () => {
    it('should persist events via SQLite storage', async () => {
      const doName = `sqlite-events-${Date.now()}`
      const stub = getTestDO(doName)

      // Emit event
      const emitRes = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.emit',
          args: [{ type: 'Customer.created', payload: { name: 'Alice' }, source: 'test' }]
        })
      })
      expect(emitRes.status).toBe(200)
      const emitted = await emitRes.json() as Event

      // Get fresh stub and verify event persists
      const stub2 = getTestDO(doName)
      const getRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.get',
          args: [emitted.$id]
        })
      })

      expect(getRes.status).toBe(200)
      const retrieved = await getRes.json() as Event

      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(emitted.$id)
      expect(retrieved.type).toBe('Customer.created')
      expect(retrieved.payload).toEqual({ name: 'Alice' })
      expect(retrieved.$timestamp).toBe(emitted.$timestamp)
    })

    it('should persist event queries via SQLite', async () => {
      const doName = `sqlite-events-query-${Date.now()}`
      const stub = getTestDO(doName)

      // Emit multiple events
      const eventTypes = ['User.signup', 'User.login', 'Order.placed']
      for (const type of eventTypes) {
        await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'events.emit',
            args: [{ type, payload: { test: true } }]
          })
        })
      }

      // Get fresh stub and query events
      const stub2 = getTestDO(doName)
      const queryRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'events.query',
          args: [{ type: 'User.signup' }]
        })
      })

      expect(queryRes.status).toBe(200)
      const events = await queryRes.json() as Event[]

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('User.signup')
    })
  })

  describe('Relationships Store with SQLite', () => {
    it('should persist relationships via SQLite storage', async () => {
      const doName = `sqlite-rels-${Date.now()}`
      const stub = getTestDO(doName)

      // Add relationship
      const addRes = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      })
      expect(addRes.status).toBe(200)
      const added = await addRes.json() as Relationship

      // Get fresh stub and verify relationship persists
      const stub2 = getTestDO(doName)
      const findRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.find',
          args: [{ subject: 'user-1', predicate: 'owns' }]
        })
      })

      expect(findRes.status).toBe(200)
      const rels = await findRes.json() as Relationship[]

      expect(rels).toHaveLength(1)
      expect(rels[0].subject).toBe('user-1')
      expect(rels[0].predicate).toBe('owns')
      expect(rels[0].object).toBe('order-1')
      expect(rels[0].$createdAt).toBe(added.$createdAt)
    })

    it('should persist relationship removals via SQLite', async () => {
      const doName = `sqlite-rels-remove-${Date.now()}`
      const stub = getTestDO(doName)

      // Add relationship
      await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.add',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      })

      // Remove relationship
      await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.remove',
          args: [{ subject: 'user-1', predicate: 'owns', object: 'order-1' }]
        })
      })

      // Get fresh stub and verify removal persisted
      const stub2 = getTestDO(doName)
      const findRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'relationships.find',
          args: [{ subject: 'user-1' }]
        })
      })

      const rels = await findRes.json() as Relationship[]
      expect(rels).toHaveLength(0)
    })
  })

  describe('Audit Logs Store with SQLite', () => {
    it('should persist audit logs via SQLite storage', async () => {
      const doName = `sqlite-audit-${Date.now()}`
      const stub = getTestDO(doName)

      // Log an audit entry via creating a thing (which triggers audit log)
      await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice' }]
        })
      })

      // Get fresh stub and query audit logs
      const stub2 = getTestDO(doName)
      const queryRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'auditLogs.query',
          args: [{ resource: 'Customer' }]
        })
      })

      expect(queryRes.status).toBe(200)
      interface AuditLog { action: string; resource: string }
      const logs = await queryRes.json() as AuditLog[]

      // Should have at least the create audit log
      expect(logs.length).toBeGreaterThan(0)
      const createLog = logs.find((l) => l.action === 'create')
      expect(createLog).toBeDefined()
      expect(createLog.resource).toBe('Customer')
    })
  })

  describe('EntityManager Constructor Options', () => {
    it('should accept DurableObjectState via options', async () => {
      // This test verifies the API change: EntityManager should accept
      // an optional state parameter to enable SQLite storage
      const doName = `sqlite-options-${Date.now()}`
      const stub = getTestDO(doName)

      // If EntityManager doesn't accept state, things won't persist
      // Create and verify in one request, then verify in another
      const createRes = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'TestEntity', test: true }]
        })
      })
      const created = await createRes.json() as Thing

      // Fresh stub should still see the data if SQLite is wired correctly
      const stub2 = getTestDO(doName)
      const getRes = await stub2.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.get',
          args: [created.$id]
        })
      })

      const retrieved = await getRes.json()
      expect(retrieved).not.toBeNull()
    })
  })
})
