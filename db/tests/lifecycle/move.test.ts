/**
 * DO.move() Operation Tests
 *
 * RED phase TDD tests for the DO.move() lifecycle operation.
 * These tests should FAIL until the move() operation is properly implemented.
 *
 * The move() operation relocates a Durable Object to a different Cloudflare colo
 * while preserving all data (Things, Actions, Events) and maintaining identity.
 *
 * Key design principles:
 * - IDENTITY PRESERVATION: Same namespace after move
 * - DATA INTEGRITY: All Things, Actions, Events preserved
 * - VERSION HISTORY: Complete version history maintained
 * - LOCATION FLEXIBILITY: Accept colo codes, city names, or regions
 * - ERROR HANDLING: Clear errors for invalid locations
 *
 * @see types/Location.ts - Location types (Region, ColoCode, ColoCity)
 * @see types/Lifecycle.ts - MoveResult interface
 * @see objects/DO.ts - Base DO class with moveTo() method
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDO, createMockDONamespace, type MockDurableObjectStorage } from '../../../testing'
import { DO, type Env } from '../../../objects/DO'
import type { MoveResult } from '../../../types/Lifecycle'
import type { ColoCode, ColoCity, Region, NormalizedLocation } from '../../../types/Location'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Test DO class for move operation tests
 */
class TestDO extends DO {
  static readonly $type = 'TestDO'

  /**
   * Move this DO to a new location.
   *
   * This method should be implemented in DO.ts with the following signature:
   *   move(options: { to: ColoCode | ColoCity | Region }): Promise<MoveResult>
   *
   * The move() method differs from moveTo(colo: string) by:
   * 1. Accepting an options object with a 'to' property
   * 2. Accepting ColoCode, ColoCity, or Region (not just colo string)
   * 3. Returning MoveResult with proper location.code and location.region
   */
  async move(options: { to: ColoCode | ColoCity | Region }): Promise<MoveResult> {
    // @ts-expect-error - move() not yet implemented in DO base class
    if (typeof super.move === 'function') {
      return super.move(options)
    }
    throw new Error('DO.move() is not implemented yet')
  }
}

/**
 * Create a test DO with initial data
 */
function createTestDO(options?: {
  ns?: string
  initialThings?: Array<{ id: string; type: number; name: string; data?: unknown }>
  initialActions?: Array<{ id: string; verb: string; target: string; actor: string }>
  initialEvents?: Array<{ id: string; verb: string; source: string; data?: unknown }>
}) {
  const sqlData = new Map<string, unknown[]>()

  // Set up initial things
  if (options?.initialThings) {
    sqlData.set('things', options.initialThings.map((t, i) => ({
      ...t,
      branch: null,
      deleted: false,
      rowid: i + 1,
    })))
  } else {
    sqlData.set('things', [])
  }

  // Set up initial actions
  if (options?.initialActions) {
    sqlData.set('actions', options.initialActions.map((a, i) => ({
      ...a,
      input: null,
      output: null,
      options: null,
      durability: 'try',
      status: 'completed',
      error: null,
      requestId: null,
      sessionId: null,
      workflowId: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      duration: 0,
      createdAt: Date.now(),
      rowid: i + 1,
    })))
  } else {
    sqlData.set('actions', [])
  }

  // Set up initial events
  if (options?.initialEvents) {
    sqlData.set('events', options.initialEvents.map((e, i) => ({
      ...e,
      sequence: i + 1,
      streamed: false,
      createdAt: new Date(),
      rowid: i + 1,
    })))
  } else {
    sqlData.set('events', [])
  }

  return createMockDO(TestDO, {
    ns: options?.ns ?? 'https://test.do',
    sqlData,
  })
}

// ============================================================================
// BASIC MOVE TESTS
// ============================================================================

describe('DO.move()', () => {
  describe('Basic Move Operations', () => {
    it('move({ to: "lax" }) - moves to specific colo code', async () => {
      const { instance } = createTestDO({
        initialThings: [
          { id: 'thing-1', type: 1, name: 'Test Thing' },
        ],
      })

      const result = await instance.move({ to: 'lax' })

      expect(result).toBeDefined()
      expect(result.newDoId).toBeDefined()
      expect(result.location.code).toBe('lax')
      expect(result.location.region).toBe('us-west')
    })

    it('move({ to: "LosAngeles" }) - moves using city name', async () => {
      const { instance } = createTestDO({
        initialThings: [
          { id: 'thing-1', type: 1, name: 'Test Thing' },
        ],
      })

      const result = await instance.move({ to: 'LosAngeles' })

      expect(result).toBeDefined()
      expect(result.newDoId).toBeDefined()
      // City name should be normalized to colo code
      expect(result.location.code).toBe('lax')
      expect(result.location.region).toBe('us-west')
    })

    it('move({ to: "us-west" }) - moves to region (CF picks colo)', async () => {
      const { instance } = createTestDO({
        initialThings: [
          { id: 'thing-1', type: 1, name: 'Test Thing' },
        ],
      })

      const result = await instance.move({ to: 'us-west' })

      expect(result).toBeDefined()
      expect(result.newDoId).toBeDefined()
      // Region move: code may be undefined (CF picks), but region should match
      expect(result.location.region).toBe('us-west')
    })

    it('move returns proper MoveResult structure', async () => {
      const { instance } = createTestDO({
        initialThings: [
          { id: 'thing-1', type: 1, name: 'Test Thing' },
        ],
      })

      const result = await instance.move({ to: 'ewr' })

      // Verify MoveResult interface compliance
      expect(result).toHaveProperty('newDoId')
      expect(result).toHaveProperty('location')
      expect(result.location).toHaveProperty('code')
      expect(result.location).toHaveProperty('region')
      expect(typeof result.newDoId).toBe('string')
      expect(typeof result.location.code).toBe('string')
      expect(typeof result.location.region).toBe('string')
    })

    it('move to different colo codes from various regions', async () => {
      const testCases: Array<{ to: ColoCode; expectedRegion: string }> = [
        { to: 'iad', expectedRegion: 'us-east' },
        { to: 'sjc', expectedRegion: 'us-west' },
        { to: 'lhr', expectedRegion: 'eu-west' },
        { to: 'fra', expectedRegion: 'eu-west' },
        { to: 'sin', expectedRegion: 'asia-pacific' },
        { to: 'nrt', expectedRegion: 'asia-pacific' },
      ]

      for (const testCase of testCases) {
        const { instance } = createTestDO({
          initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
        })

        const result = await instance.move({ to: testCase.to })

        expect(result.location.code).toBe(testCase.to)
        expect(result.location.region).toBe(testCase.expectedRegion)
      }
    })

    it('move to different city names from various regions', async () => {
      const testCases: Array<{ to: ColoCity; expectedCode: string; expectedRegion: string }> = [
        { to: 'Virginia', expectedCode: 'iad', expectedRegion: 'us-east' },
        { to: 'Seattle', expectedCode: 'sea', expectedRegion: 'us-west' },
        { to: 'London', expectedCode: 'lhr', expectedRegion: 'eu-west' },
        { to: 'Frankfurt', expectedCode: 'fra', expectedRegion: 'eu-west' },
        { to: 'Singapore', expectedCode: 'sin', expectedRegion: 'asia-pacific' },
        { to: 'Tokyo', expectedCode: 'nrt', expectedRegion: 'asia-pacific' },
      ]

      for (const testCase of testCases) {
        const { instance } = createTestDO({
          initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
        })

        const result = await instance.move({ to: testCase.to })

        expect(result.location.code).toBe(testCase.expectedCode)
        expect(result.location.region).toBe(testCase.expectedRegion)
      }
    })
  })

  // ============================================================================
  // DATA PRESERVATION TESTS
  // ============================================================================

  describe('Data Preservation', () => {
    it('all Things are preserved after move', async () => {
      const initialThings = [
        { id: 'customer-1', type: 1, name: 'Acme Corp', data: { status: 'active' } },
        { id: 'customer-2', type: 1, name: 'Widgets Inc', data: { status: 'pending' } },
        { id: 'order-1', type: 2, name: 'Order #1001', data: { total: 99.99 } },
      ]

      const { instance, env } = createTestDO({ initialThings })

      const result = await instance.move({ to: 'lax' })

      // Verify things were transferred to new DO
      // The new DO should have received all things via the transfer request
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      expect(stub).toBeDefined()
      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      // Should have made a transfer request with all things
      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })
      expect(transferCall).toBeDefined()

      // Parse the transfer body to verify things
      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        expect(body.things).toHaveLength(3)
        expect(body.things.map((t: { id: string }) => t.id)).toContain('customer-1')
        expect(body.things.map((t: { id: string }) => t.id)).toContain('customer-2')
        expect(body.things.map((t: { id: string }) => t.id)).toContain('order-1')
      }
    })

    it('all Actions are preserved after move', async () => {
      const initialActions = [
        { id: 'action-1', verb: 'create', target: 'Customer/cust-1', actor: 'Human/admin' },
        { id: 'action-2', verb: 'update', target: 'Customer/cust-1', actor: 'Human/admin' },
        { id: 'action-3', verb: 'notify', target: 'Customer/cust-1', actor: 'Agent/support' },
      ]

      const { instance, env } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
        initialActions,
      })

      const result = await instance.move({ to: 'ewr' })

      // Verify actions were transferred
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      expect(stub).toBeDefined()
      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })

      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        expect(body.actions).toBeDefined()
        expect(body.actions).toHaveLength(3)
      }
    })

    it('all Events are preserved after move', async () => {
      const initialEvents = [
        { id: 'event-1', verb: 'Customer.created', source: 'https://test.do/Customer/cust-1' },
        { id: 'event-2', verb: 'Customer.updated', source: 'https://test.do/Customer/cust-1' },
        { id: 'event-3', verb: 'Order.created', source: 'https://test.do/Order/ord-1' },
      ]

      const { instance, env } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
        initialEvents,
      })

      const result = await instance.move({ to: 'cdg' })

      // Verify events were transferred
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      expect(stub).toBeDefined()
      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })

      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        expect(body.events).toBeDefined()
        expect(body.events).toHaveLength(3)
      }
    })

    it('version history is preserved after move', async () => {
      // Multiple versions of the same thing
      const initialThings = [
        { id: 'doc-1', type: 1, name: 'Draft', data: { version: 1 } },
        { id: 'doc-1', type: 1, name: 'Review', data: { version: 2 } },
        { id: 'doc-1', type: 1, name: 'Final', data: { version: 3 } },
      ]

      const { instance, env } = createTestDO({ initialThings })

      const result = await instance.move({ to: 'ams' })

      // Verify all versions were transferred, not just current
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      expect(stub).toBeDefined()
      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })

      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        // All versions should be preserved
        expect(body.things).toHaveLength(3)
        // Version order should be preserved
        const versions = body.things.filter((t: { id: string }) => t.id === 'doc-1')
        expect(versions).toHaveLength(3)
      }
    })

    it('soft-deleted things are preserved after move', async () => {
      const initialThings = [
        { id: 'active-1', type: 1, name: 'Active Thing', data: null },
        { id: 'deleted-1', type: 1, name: 'Deleted Thing', data: null },
      ]

      // Mark one as deleted in sqlData
      const sqlData = new Map<string, unknown[]>()
      sqlData.set('things', [
        { ...initialThings[0], branch: null, deleted: false, rowid: 1 },
        { ...initialThings[1], branch: null, deleted: true, rowid: 2 },
      ])

      const { instance, env } = createMockDO(TestDO, {
        ns: 'https://test.do',
        sqlData,
      })

      const result = await instance.move({ to: 'sin' })

      // Verify deleted things are included in transfer
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })

      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        // Both active and deleted should be transferred
        expect(body.things).toHaveLength(2)
      }
    })

    it('branch data is preserved after move', async () => {
      const sqlData = new Map<string, unknown[]>()
      sqlData.set('things', [
        { id: 'config-1', type: 1, name: 'Main Config', branch: null, deleted: false, rowid: 1 },
        { id: 'config-1', type: 1, name: 'Dev Config', branch: 'development', deleted: false, rowid: 2 },
        { id: 'config-1', type: 1, name: 'Staging Config', branch: 'staging', deleted: false, rowid: 3 },
      ])
      sqlData.set('branches', [
        { name: 'development', thingId: 'config-1', head: 2, base: 1, forkedFrom: 'main' },
        { name: 'staging', thingId: 'config-1', head: 3, base: 1, forkedFrom: 'main' },
      ])

      const { instance, env } = createMockDO(TestDO, {
        ns: 'https://test.do',
        sqlData,
      })

      const result = await instance.move({ to: 'hkg' })

      // Verify branches are transferred
      const doNamespace = env.DO!
      const stub = doNamespace.stubs.get(result.newDoId)

      // @ts-expect-error - accessing mock fetch calls
      const fetchCalls = stub?.fetch.mock?.calls ?? []

      const transferCall = fetchCalls.find((call: unknown[]) => {
        const request = call[0] as Request
        return request.url.includes('/transfer')
      })

      if (transferCall) {
        const request = transferCall[0] as Request
        const body = await request.clone().json()
        expect(body.branches).toBeDefined()
        expect(body.branches).toHaveLength(2)
      }
    })
  })

  // ============================================================================
  // METADATA TESTS
  // ============================================================================

  describe('MoveResult Metadata', () => {
    it('MoveResult contains newDoId', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'lax' })

      expect(result.newDoId).toBeDefined()
      expect(typeof result.newDoId).toBe('string')
      expect(result.newDoId.length).toBeGreaterThan(0)
    })

    it('MoveResult contains location.code for colo moves', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'lax' })

      expect(result.location).toBeDefined()
      expect(result.location.code).toBe('lax')
    })

    it('MoveResult contains location.region', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'lax' })

      expect(result.location).toBeDefined()
      expect(result.location.region).toBe('us-west')
    })

    it('DO metadata updated with new location after move', async () => {
      const { instance, storage } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await instance.move({ to: 'fra' })

      // Check that objects table was updated with new location
      const sqlOps = storage.sql.operations
      const insertOp = sqlOps.find(op =>
        op.query.toLowerCase().includes('insert') &&
        op.query.toLowerCase().includes('objects')
      )

      expect(insertOp).toBeDefined()
    })

    it('location.code is undefined for region-only moves', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'eu-west' })

      // For region moves, specific colo is picked by CF
      // The result should still contain the region
      expect(result.location.region).toBe('eu-west')
      // Code may be defined (if CF reports it) or undefined
      // The key assertion is that region is correct
    })

    it('move emits move.started and move.completed events', async () => {
      const { instance, env } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await instance.move({ to: 'nrt' })

      // Check pipeline events
      const pipeline = env.PIPELINE!
      const events = pipeline.events as Array<{ verb: string }>

      const startedEvent = events.find(e => e.verb === 'move.started')
      const completedEvent = events.find(e => e.verb === 'move.completed')

      expect(startedEvent).toBeDefined()
      expect(completedEvent).toBeDefined()
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('invalid colo code throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await expect(
        // @ts-expect-error - intentionally passing invalid colo
        instance.move({ to: 'invalid-colo' })
      ).rejects.toThrow(/invalid.*colo|location/i)
    })

    it('invalid region throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await expect(
        // @ts-expect-error - intentionally passing invalid region
        instance.move({ to: 'invalid-region' })
      ).rejects.toThrow(/invalid.*region|location/i)
    })

    it('invalid city name throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await expect(
        // @ts-expect-error - intentionally passing invalid city
        instance.move({ to: 'InvalidCity' })
      ).rejects.toThrow(/invalid.*city|location/i)
    })

    it('empty string throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await expect(
        // @ts-expect-error - intentionally passing empty string
        instance.move({ to: '' })
      ).rejects.toThrow(/invalid|empty|required/i)
    })

    it('null/undefined throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      await expect(
        // @ts-expect-error - intentionally passing null
        instance.move({ to: null })
      ).rejects.toThrow()

      await expect(
        // @ts-expect-error - intentionally passing undefined
        instance.move({ to: undefined })
      ).rejects.toThrow()
    })

    it('move with no state throws error', async () => {
      const { instance } = createTestDO({
        initialThings: [], // No things
      })

      await expect(
        instance.move({ to: 'lax' })
      ).rejects.toThrow(/no state|nothing to move/i)
    })

    it('move to same colo throws error or returns early', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // First move to lax
      await instance.move({ to: 'lax' })

      // Second move to same colo should error or be a no-op
      await expect(
        instance.move({ to: 'lax' })
      ).rejects.toThrow(/already.*colo|same location/i)
    })

    it('DO namespace not configured throws error', async () => {
      const { instance, env } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // Remove DO namespace
      delete env.DO

      await expect(
        instance.move({ to: 'lax' })
      ).rejects.toThrow(/DO.*namespace|not configured/i)
    })
  })

  // ============================================================================
  // LOCATION NORMALIZATION TESTS
  // ============================================================================

  describe('Location Normalization', () => {
    it('normalizes lowercase colo codes', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'lax' })

      expect(result.location.code).toBe('lax')
    })

    it('normalizes uppercase colo codes to lowercase', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // @ts-expect-error - testing case normalization
      const result = await instance.move({ to: 'LAX' })

      expect(result.location.code).toBe('lax')
    })

    it('normalizes mixed case colo codes', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // @ts-expect-error - testing case normalization
      const result = await instance.move({ to: 'LaX' })

      expect(result.location.code).toBe('lax')
    })

    it('handles PascalCase city names correctly', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'LosAngeles' })

      expect(result.location.code).toBe('lax')
      expect(result.location.region).toBe('us-west')
    })

    it('handles kebab-case region names correctly', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      const result = await instance.move({ to: 'asia-pacific' })

      expect(result.location.region).toBe('asia-pacific')
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration', () => {
    it('move followed by resolution works', async () => {
      const { instance } = createTestDO({
        ns: 'https://example.do',
        initialThings: [
          { id: 'customer-1', type: 1, name: 'Acme Corp' },
        ],
      })

      // Move to new location
      await instance.move({ to: 'fra' })

      // Resolution should still work (identity preserved)
      // @ts-expect-error - resolve may not be public
      const resolved = await instance.resolve('https://example.do/Customer/customer-1')

      expect(resolved).toBeDefined()
      expect(resolved.$id).toContain('customer-1')
    })

    it('move preserves workflow context ($)', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // Register an event handler before move
      let handlerCalled = false
      instance.$.on.Customer.created(() => {
        handlerCalled = true
      })

      // Move
      await instance.move({ to: 'sin' })

      // Workflow context should still be functional
      expect(instance.$).toBeDefined()
      expect(typeof instance.$.send).toBe('function')
      expect(typeof instance.$.do).toBe('function')
      expect(typeof instance.$.try).toBe('function')
    })

    it('concurrent moves are handled safely', async () => {
      const { instance } = createTestDO({
        initialThings: [{ id: 'thing-1', type: 1, name: 'Test' }],
      })

      // Attempt concurrent moves
      const move1 = instance.move({ to: 'lax' })
      const move2 = instance.move({ to: 'ewr' })

      // One should succeed, one should fail (or be queued)
      const results = await Promise.allSettled([move1, move2])

      // At least one should succeed
      const succeeded = results.filter(r => r.status === 'fulfilled')
      expect(succeeded.length).toBeGreaterThanOrEqual(1)

      // If both succeed, they should be to different locations
      // (indicating proper sequencing)
      if (succeeded.length === 2) {
        const result1 = (succeeded[0] as PromiseFulfilledResult<MoveResult>).value
        const result2 = (succeeded[1] as PromiseFulfilledResult<MoveResult>).value
        expect(result1.newDoId).not.toBe(result2.newDoId)
      }
    })
  })
})

// ============================================================================
// TYPE TESTS
// ============================================================================

describe('Type System', () => {
  it('MoveResult interface is properly typed', () => {
    // Type-level test: ensure MoveResult has required properties
    const result: MoveResult = {
      newDoId: 'test-id',
      location: {
        code: 'lax',
        region: 'wnam',
      },
    }

    expect(result.newDoId).toBe('test-id')
    expect(result.location.code).toBe('lax')
    expect(result.location.region).toBe('wnam')
  })

  it('ColoCode accepts valid IATA codes', () => {
    // Type-level test: these should compile
    const codes: ColoCode[] = [
      'lax', 'ewr', 'iad', 'sjc', 'ord', 'dfw',
      'lhr', 'cdg', 'ams', 'fra',
      'sin', 'hkg', 'nrt', 'kix',
    ]

    expect(codes).toHaveLength(14)
  })

  it('ColoCity accepts valid city names', () => {
    // Type-level test: these should compile
    const cities: ColoCity[] = [
      'LosAngeles', 'Newark', 'Virginia', 'SanJose',
      'London', 'Paris', 'Amsterdam', 'Frankfurt',
      'Singapore', 'HongKong', 'Tokyo', 'Osaka',
    ]

    expect(cities).toHaveLength(12)
  })

  it('Region accepts valid region names', () => {
    // Type-level test: these should compile
    const regions: Region[] = [
      'us-west', 'us-east',
      'eu-west', 'eu-east',
      'asia-pacific', 'oceania',
      'south-america', 'africa', 'middle-east',
    ]

    expect(regions).toHaveLength(9)
  })
})
