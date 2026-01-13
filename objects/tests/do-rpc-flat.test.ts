/**
 * DO RPC Flat Methods Test
 *
 * Tests Workers RPC using FLAT methods on the DO (stub.thingsCreate())
 * instead of nested objects (stub.things.create()).
 *
 * This is a verification test to confirm Workers RPC works at all,
 * before attempting the nested object pattern.
 *
 * @module objects/tests/do-rpc-flat.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Test Types
// ============================================================================

interface ThingEntity {
  $id: string
  $type: string
  name: string | null
  data: Record<string, unknown> | null
  branch?: string | null
  version?: number
  deleted?: boolean
}

interface RelationshipEntity {
  $id: string
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}

/**
 * Extended stub type with flat RPC methods
 */
interface FlatRPCStub extends DurableObjectStub {
  // Identity method (ns is instance property, not accessible via RPC)
  getNs(): Promise<string>
  $id: Promise<string>

  // Flat things methods
  thingsCreate(data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>
  thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsDelete(id: string): Promise<ThingEntity | null>
  thingsQuery(options: { type: string }): Promise<ThingEntity[]>
  thingsCreateMany(items: Partial<ThingEntity>[]): Promise<ThingEntity[]>

  // Flat rels methods
  relsCreate(data: { verb: string; from: string; to: string }): Promise<RelationshipEntity>
  relsQuery(options: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>
  relsDelete(id: string): Promise<void>

  // Flat SQL method
  sqlExecute(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

// ============================================================================
// Test Utilities
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `test-flat-${Date.now()}-${++testCounter}`
}

// ============================================================================
// DO RPC Flat Method Tests
// ============================================================================

describe('DO RPC Flat Methods', () => {
  let stub: FlatRPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as FlatRPCStub
  })

  describe('thingsCreate', () => {
    it('creates a thing via flat RPC method', async () => {
      const result = await stub.thingsCreate({
        $type: 'Customer',
        name: 'Alice',
        data: { email: 'alice@example.com' },
      })

      expect(result.$id).toBeDefined()
      expect(result.name).toBe('Alice')
      expect(result.$type).toBe('Customer')
    })
  })

  describe('thingsGet', () => {
    it('retrieves a thing via flat RPC method', async () => {
      const created = await stub.thingsCreate({
        $type: 'Product',
        name: 'Widget',
      })

      const retrieved = await stub.thingsGet(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('Widget')
    })
  })

  describe('thingsList', () => {
    it('lists things via flat RPC method', async () => {
      await stub.thingsCreate({ $type: 'Order', name: 'Order 1' })
      await stub.thingsCreate({ $type: 'Order', name: 'Order 2' })

      const list = await stub.thingsList({ type: 'Order' })

      expect(list.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('relsCreate', () => {
    it('creates a relationship via flat RPC method', async () => {
      const result = await stub.relsCreate({
        verb: 'knows',
        from: 'person:alice',
        to: 'person:bob',
      })

      expect(result.$id).toBeDefined()
      expect(result.verb).toBe('knows')
    })
  })

  describe('sqlExecute', () => {
    it('executes SQL via flat RPC method', async () => {
      const result = await stub.sqlExecute('SELECT 1 as num')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0]!.num).toBe(1)
    })
  })

  describe('identity', () => {
    it('accesses ns via getNs() method', async () => {
      // Note: `ns` is an instance property in DOTiny, which Workers RPC doesn't expose.
      // Use getNs() method instead.
      const doNs = await stub.getNs()

      expect(doNs).toBeDefined()
      expect(typeof doNs).toBe('string')
    })
  })
})
