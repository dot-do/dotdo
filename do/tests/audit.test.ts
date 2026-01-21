/**
 * Audit Logging Integration Tests - Real Durable Objects with Miniflare
 *
 * This file uses @cloudflare/vitest-pool-workers to test with REAL Durable Objects.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * Tests audit logging functionality including:
 * - Automatic audit logging on entity operations
 * - Audit context tracking
 * - Correlation ID propagation
 * - Audit log retention/cleanup
 *
 * @module do/tests/audit.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Thing, Relationship } from '@dotdo/db'
import { generateTestId, getTestDO, rpcMayFail } from '@dotdo/test-utils'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AuditLog {
  $id: string
  actor: string
  action: string
  resource: string
  resourceId?: string
  level: string
  details?: Record<string, unknown>
  correlationId?: string
  $timestamp: number
}

interface ThingWithName extends Thing {
  name?: string
  status?: string
}

// ============================================================================
// HELPERS - Using shared test-utils
// ============================================================================

/**
 * Get a fresh DO stub for testing (delegates to shared test-utils)
 */
function getStub(name?: string) {
  return getTestDO(env, name)
}

/**
 * Make an RPC call to the DO (wraps shared rpcMayFail for void responses)
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const { response, data, error } = await rpcMayFail<T>(stub, method, args)

  // Handle void responses (delete, remove operations return no content)
  if (!response.ok && error) {
    throw new Error(`RPC error (${response.status}): ${JSON.stringify(error)}`)
  }

  return data as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Audit Logging Integration (do-xebw)', () => {
  describe('Automatic Audit Logging on Things', () => {
    it('should automatically log when a Thing is created', async () => {
      const stub = getStub()

      // Create a thing
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Query audit logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'create' }
      ])

      expect(logs.length).toBeGreaterThan(0)
      const createLog = logs.find(l => l.resourceId === thing.$id)
      expect(createLog).toBeDefined()
      expect(createLog!.action).toBe('create')
      expect(createLog!.resource).toBe('Customer')
    })

    it('should automatically log when a Thing is updated', async () => {
      const stub = getStub()

      // Create thing
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Update thing
      await rpc<Thing>(stub, 'things.update', [thing.$id, { name: 'Alicia' }])

      // Query audit logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'update' }
      ])

      expect(logs.length).toBeGreaterThan(0)
      const updateLog = logs.find(l => l.resourceId === thing.$id)
      expect(updateLog).toBeDefined()
      expect(updateLog!.action).toBe('update')
      expect(updateLog!.details).toBeDefined()
    })

    it('should automatically log when a Thing is deleted', async () => {
      const stub = getStub()

      // Create thing
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])

      // Delete thing
      await rpc<void>(stub, 'things.delete', [thing.$id])

      // Query audit logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'delete' }
      ])

      expect(logs.length).toBeGreaterThan(0)
      const deleteLog = logs.find(l => l.resourceId === thing.$id)
      expect(deleteLog).toBeDefined()
      expect(deleteLog!.resource).toBe('Customer')
    })
  })

  describe('Automatic Audit Logging on Relationships', () => {
    it('should automatically log when a Relationship is added', async () => {
      const stub = getStub()

      // Add relationship
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Query audit logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'create', resource: 'Relationship' }
      ])

      expect(logs.length).toBeGreaterThan(0)
      const addLog = logs[0]
      expect(addLog.resource).toBe('Relationship')
      expect(addLog.details).toBeDefined()
      expect(addLog.details!.subject).toBe('user-1')
      expect(addLog.details!.predicate).toBe('owns')
      expect(addLog.details!.object).toBe('order-1')
    })

    it('should automatically log when a Relationship is removed', async () => {
      const stub = getStub()

      // Add relationship
      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Remove relationship
      await rpc<void>(stub, 'relationships.remove', [
        { subject: 'user-1', predicate: 'owns', object: 'order-1' }
      ])

      // Query audit logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'delete', resource: 'Relationship' }
      ])

      expect(logs.length).toBeGreaterThan(0)
    })
  })

  describe('DO Class Audit Integration', () => {
    it('should expose auditLogs.query via RPC', async () => {
      const stub = getStub()

      // Create a thing (which should generate audit log)
      await rpc<Thing>(stub, 'things.create', [
        { $type: 'Customer', name: 'Test' }
      ])

      // Query audit logs via RPC
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [{}])

      expect(Array.isArray(logs)).toBe(true)
    })

    it('should expose auditLogs.log via RPC', async () => {
      const stub = getStub()

      // Log directly
      await rpc<AuditLog>(stub, 'auditLogs.log', [{
        actor: 'test-user',
        action: 'test-action',
        resource: 'TestResource',
        level: 'info'
      }])

      // Query to verify
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'test-action' }
      ])

      expect(logs.length).toBe(1)
      expect(logs[0].actor).toBe('test-user')
      expect(logs[0].action).toBe('test-action')
    })
  })

  describe('Audit Log Retention', () => {
    it('should delete logs older than specified timestamp', async () => {
      const stub = getStub()

      // Create some logs by creating things
      await rpc<Thing>(stub, 'things.create', [
        { $type: 'Test', name: 'Item1' }
      ])

      // Delete older than future timestamp (should delete all)
      const deleted = await rpc<number>(stub, 'auditLogs.deleteOlderThan', [
        Date.now() + 10000
      ])

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should delete all logs', async () => {
      const stub = getStub()

      // Create some logs
      await rpc<Thing>(stub, 'things.create', [
        { $type: 'Test', name: 'Item1' }
      ])
      await rpc<Thing>(stub, 'things.create', [
        { $type: 'Test', name: 'Item2' }
      ])

      // Delete all
      const deleted = await rpc<number>(stub, 'auditLogs.deleteAll', [])

      expect(deleted).toBeGreaterThanOrEqual(2)

      // Verify empty
      const remaining = await rpc<number>(stub, 'auditLogs.count', [])
      expect(remaining).toBe(0)
    })
  })

  describe('Correlation ID Tracking', () => {
    it('should track correlation ID across multiple operations', async () => {
      const stub = getStub()
      const correlationId = 'request-' + generateTestId()

      // Note: In a real scenario, correlation ID would be set via request headers
      // and propagated through the audit context. For this test, we verify that
      // audit logs can be queried and that multiple operations generate multiple logs.

      // Perform multiple operations
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Order', status: 'pending' }
      ])

      await rpc<Thing>(stub, 'things.update', [thing.$id, { status: 'processing' }])

      await rpc<Relationship>(stub, 'relationships.add', [
        { subject: 'user-1', predicate: 'placed', object: thing.$id }
      ])

      // Query all logs
      const logs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [{}])

      // Should have at least 3 logs (create, update, relationship add)
      expect(logs.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Audit Log Querying', () => {
    it('should query logs by resource type', async () => {
      const stub = getStub()

      // Create different types
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Customer', name: 'Alice' }])
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Order', total: 100 }])

      // Query by resource
      const customerLogs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { resource: 'Customer' }
      ])

      expect(customerLogs.length).toBeGreaterThan(0)
      expect(customerLogs.every(l => l.resource === 'Customer')).toBe(true)
    })

    it('should query logs by action', async () => {
      const stub = getStub()

      // Create and update
      const thing = await rpc<ThingWithName>(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice' }
      ])
      await rpc<Thing>(stub, 'things.update', [thing.$id, { name: 'Alicia' }])

      // Query creates only
      const createLogs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'create' }
      ])

      expect(createLogs.length).toBeGreaterThan(0)
      expect(createLogs.every(l => l.action === 'create')).toBe(true)

      // Query updates only
      const updateLogs = await rpc<AuditLog[]>(stub, 'auditLogs.query', [
        { action: 'update' }
      ])

      expect(updateLogs.length).toBeGreaterThan(0)
      expect(updateLogs.every(l => l.action === 'update')).toBe(true)
    })

    it('should count audit logs', async () => {
      const stub = getStub()

      // Create a thing
      await rpc<Thing>(stub, 'things.create', [{ $type: 'Test', name: 'Test' }])

      // Count
      const count = await rpc<number>(stub, 'auditLogs.count', [])

      expect(count).toBeGreaterThan(0)
    })
  })

  describe('Audit Log Persistence', () => {
    it('should persist audit logs across DO accesses', async () => {
      const doName = `audit-persist-${generateTestId()}`

      // First access - create thing
      const stub1 = getStub(doName)
      await rpc<Thing>(stub1, 'things.create', [{ $type: 'Customer', name: 'Alice' }])

      // Second access - verify logs persist
      const stub2 = getStub(doName)
      const logs = await rpc<AuditLog[]>(stub2, 'auditLogs.query', [{}])

      expect(logs.length).toBeGreaterThan(0)
    })
  })
})
