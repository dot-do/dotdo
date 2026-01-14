/**
 * DO Clone and Fork Operations Tests
 *
 * These tests verify clone() and fork() operations using REAL miniflare DOs
 * with SQLite storage. NO MOCKS are used - this tests actual DO behavior.
 *
 * IMPORTANT: These tests require DOFull (not DOBase)
 * The TestDO in workers/do-integration-test-worker.ts must extend DOFull
 * to have clone() and fork() methods available.
 *
 * Reference implementations:
 * - clone(): objects/DOFull.ts:751
 * - fork(): objects/DOFull.ts:493
 *
 * The pattern follows do-rpc.test.ts using cloudflare:test environment.
 *
 * Clone operations:
 * - clone(target) - Copy state to another DO (default: atomic mode)
 * - clone(target, { mode: 'atomic' }) - All-or-nothing clone
 * - clone(target, { mode: 'staged' }) - Two-phase commit with token
 * - clone(target, { mode: 'eventual' }) - Async reconciliation
 * - clone(target, { mode: 'resumable' }) - Checkpoint-based transfer
 *
 * Fork operations:
 * - fork({ to }) - Create independent copy with new identity
 * - fork({ to, branch }) - Fork specific branch
 *
 * Run with: npx vitest run objects/tests/do-clone-fork.test.ts --project=do-rpc
 *
 * @module objects/tests/do-clone-fork.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 * Uses https:// prefix as required by clone/fork validation
 */
function uniqueNs(prefix: string = 'clone-test'): string {
  return `https://${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}.test.do`
}

/**
 * Type definitions for RPC responses
 */
interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
}

interface RelationshipEntity {
  $id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

/**
 * Clone result type
 */
interface CloneResult {
  targetNs: string
  clonedThings: number
  clonedRelationships: number
}

/**
 * Staged clone prepare result
 */
interface StagedPrepareResult {
  phase: 'prepared'
  token: string
  expiresAt: Date
  stagingNs: string
  metadata: {
    thingsCount: number
    sizeBytes: number
    branch: string
    version: number
  }
}

/**
 * Eventual clone handle
 */
interface EventualCloneHandle {
  id: string
  status: 'pending' | 'syncing' | 'paused' | 'completed' | 'cancelled'
  getProgress(): Promise<number>
  getSyncStatus(): Promise<{
    phase: string
    itemsSynced: number
    totalItems: number
    lastSyncAt: Date | null
    divergence: number
    maxDivergence: number
    syncInterval: number
    errorCount: number
    lastError: Error | null
  }>
  pause(): Promise<void>
  resume(): Promise<void>
  sync(): Promise<{ itemsSynced: number; conflicts: unknown[] }>
  cancel(): Promise<void>
}

/**
 * Resumable clone handle
 */
interface ResumableCloneHandle {
  id: string
  status: string
  checkpoints: Array<{ id: string; itemsCopied: number; timestamp: Date }>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  getProgress(): Promise<number>
}

/**
 * Fork result type
 */
interface ForkResult {
  ns: string
  doId: string
}

/**
 * Clone options
 */
interface CloneOptions {
  mode?: 'atomic' | 'staged' | 'eventual' | 'resumable'
  branch?: string
  excludeRelationships?: boolean
  tokenTimeout?: number
  syncInterval?: number
  maxDivergence?: number
  conflictResolution?: 'last-write-wins' | 'first-write-wins' | 'custom'
}

/**
 * Extended stub type with clone/fork RPC methods
 */
interface CloneForkStub extends DurableObjectStub {
  // Things store RPC methods
  thingsCreate(data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>

  // Rels RPC methods
  relsCreate(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  relsQuery(options: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>

  // Clone/Fork operations
  clone(target: string, options?: CloneOptions): Promise<CloneResult | StagedPrepareResult | EventualCloneHandle | ResumableCloneHandle>
  fork(options: { to: string; branch?: string }): Promise<ForkResult>

  // Staged clone operations
  commitClone(token: string): Promise<{ targetNs: string; thingsCloned: number }>
  abortClone(token: string, reason?: string): Promise<void>

  // Identity
  getNs(): Promise<string>
}

// ============================================================================
// DO Clone and Fork Tests
// ============================================================================

describe('DO Clone and Fork Operations', () => {
  let stub: CloneForkStub
  let sourceNs: string

  beforeEach(() => {
    sourceNs = uniqueNs('source')
    // Get DO stub - uses TEST_DO binding from wrangler.do-test.jsonc
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(sourceNs)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as CloneForkStub
  })

  // ==========================================================================
  // Clone - Basic Operations
  // ==========================================================================

  describe('clone() - Basic Operations', () => {
    it('clones DO state to target namespace', async () => {
      const targetNs = uniqueNs('target')

      // Create source data
      await stub.thingsCreate({ $type: 'Customer', name: 'Alice' })
      await stub.thingsCreate({ $type: 'Customer', name: 'Bob' })

      // Clone to target
      const result = await stub.clone(targetNs) as CloneResult

      expect(result.targetNs).toBe(targetNs)
      expect(result.clonedThings).toBe(2)

      // Verify target has the data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const customers = await targetStub.thingsList({ type: 'Customer' })
      expect(customers.length).toBe(2)
    })

    it('clones both things and relationships', async () => {
      const targetNs = uniqueNs('target-rels')

      // Create source data with relationships
      const alice = await stub.thingsCreate({ $type: 'Person', name: 'Alice' })
      const bob = await stub.thingsCreate({ $type: 'Person', name: 'Bob' })
      await stub.relsCreate({ verb: 'knows', from: alice.$id, to: bob.$id })

      // Clone to target
      const result = await stub.clone(targetNs) as CloneResult

      expect(result.clonedThings).toBe(2)
      expect(result.clonedRelationships).toBe(1)

      // Verify target has relationships
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const rels = await targetStub.relsQuery({})
      expect(rels.length).toBe(1)
      expect(rels[0].verb).toBe('knows')
    })

    it('supports excludeRelationships option', async () => {
      const targetNs = uniqueNs('target-no-rels')

      // Create source data with relationships
      const alice = await stub.thingsCreate({ $type: 'Person', name: 'Alice' })
      const bob = await stub.thingsCreate({ $type: 'Person', name: 'Bob' })
      await stub.relsCreate({ verb: 'knows', from: alice.$id, to: bob.$id })

      // Clone without relationships
      const result = await stub.clone(targetNs, { excludeRelationships: true }) as CloneResult

      expect(result.clonedThings).toBe(2)
      expect(result.clonedRelationships).toBe(0)

      // Verify target has no relationships
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const rels = await targetStub.relsQuery({})
      expect(rels.length).toBe(0)
    })
  })

  // ==========================================================================
  // Clone - Error Handling
  // ==========================================================================

  describe('clone() - Error Handling', () => {
    it('throws on invalid target namespace URL', async () => {
      // Create some data first
      await stub.thingsCreate({ $type: 'Test', name: 'Test' })

      await expect(
        stub.clone('not-a-valid-url')
      ).rejects.toThrow(/invalid.*url|namespace/i)
    })

    it('throws when source is empty', async () => {
      const targetNs = uniqueNs('empty-target')

      // Source has no data
      await expect(
        stub.clone(targetNs)
      ).rejects.toThrow(/no.*state|empty/i)
    })
  })

  // ==========================================================================
  // Clone - Atomic Mode
  // ==========================================================================

  describe('clone() - Atomic Mode', () => {
    it('performs atomic clone with mode: atomic', async () => {
      const targetNs = uniqueNs('atomic-target')

      // Create source data
      await stub.thingsCreate({ $type: 'Order', name: 'Order-001' })
      await stub.thingsCreate({ $type: 'Order', name: 'Order-002' })

      // Clone atomically (default mode)
      const result = await stub.clone(targetNs, { mode: 'atomic' }) as CloneResult

      expect(result.targetNs).toBe(targetNs)
      expect(result.clonedThings).toBe(2)
    })

    it('atomic clone is all-or-nothing', async () => {
      const targetNs = uniqueNs('atomic-all-or-nothing')

      // Create source data
      await stub.thingsCreate({ $type: 'Item', name: 'Item-1' })
      await stub.thingsCreate({ $type: 'Item', name: 'Item-2' })
      await stub.thingsCreate({ $type: 'Item', name: 'Item-3' })

      // Clone should succeed completely
      const result = await stub.clone(targetNs, { mode: 'atomic' }) as CloneResult

      expect(result.clonedThings).toBe(3)

      // Verify all items are in target
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Item' })
      expect(items.length).toBe(3)
    })
  })

  // ==========================================================================
  // Clone - Staged Mode (Two-Phase Commit)
  // ==========================================================================

  describe('clone() - Staged Mode', () => {
    it('prepares staged clone with token', async () => {
      const targetNs = uniqueNs('staged-target')

      // Create source data
      await stub.thingsCreate({ $type: 'Document', name: 'Doc-1' })

      // Prepare staged clone
      const result = await stub.clone(targetNs, { mode: 'staged' }) as StagedPrepareResult

      expect(result.phase).toBe('prepared')
      expect(result.token).toBeDefined()
      expect(typeof result.token).toBe('string')
      expect(result.expiresAt).toBeDefined()
      expect(result.stagingNs).toBeDefined()
      expect(result.metadata.thingsCount).toBe(1)
    })

    it('commits staged clone with token', async () => {
      const targetNs = uniqueNs('staged-commit')

      // Create source data
      await stub.thingsCreate({ $type: 'Record', name: 'Record-1' })
      await stub.thingsCreate({ $type: 'Record', name: 'Record-2' })

      // Prepare staged clone
      const prepareResult = await stub.clone(targetNs, { mode: 'staged' }) as StagedPrepareResult
      expect(prepareResult.phase).toBe('prepared')

      // Commit the clone
      const commitResult = await stub.commitClone(prepareResult.token)

      expect(commitResult.targetNs).toBe(targetNs)
      expect(commitResult.thingsCloned).toBe(2)

      // Verify target has the data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const records = await targetStub.thingsList({ type: 'Record' })
      expect(records.length).toBe(2)
    })

    it('aborts staged clone with token', async () => {
      const targetNs = uniqueNs('staged-abort')

      // Create source data
      await stub.thingsCreate({ $type: 'Draft', name: 'Draft-1' })

      // Prepare staged clone
      const prepareResult = await stub.clone(targetNs, { mode: 'staged' }) as StagedPrepareResult

      // Abort the clone
      await stub.abortClone(prepareResult.token, 'User cancelled')

      // Trying to commit after abort should fail
      await expect(
        stub.commitClone(prepareResult.token)
      ).rejects.toThrow(/aborted/i)
    })

    it('staged token expires after timeout', async () => {
      const targetNs = uniqueNs('staged-expire')

      // Create source data
      await stub.thingsCreate({ $type: 'Temp', name: 'Temp-1' })

      // Prepare staged clone with very short timeout
      const prepareResult = await stub.clone(targetNs, {
        mode: 'staged',
        tokenTimeout: 1, // 1ms timeout
      }) as StagedPrepareResult

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10))

      // Commit should fail due to expired token
      await expect(
        stub.commitClone(prepareResult.token)
      ).rejects.toThrow(/expired/i)
    })

    it('throws on commit with invalid token', async () => {
      await stub.thingsCreate({ $type: 'Test', name: 'Test' })

      await expect(
        stub.commitClone('invalid-token-123')
      ).rejects.toThrow(/not found/i)
    })

    it('prevents double commit', async () => {
      const targetNs = uniqueNs('staged-double-commit')

      // Create source data
      await stub.thingsCreate({ $type: 'Single', name: 'Single-1' })

      // Prepare and commit
      const prepareResult = await stub.clone(targetNs, { mode: 'staged' }) as StagedPrepareResult
      await stub.commitClone(prepareResult.token)

      // Second commit should fail
      await expect(
        stub.commitClone(prepareResult.token)
      ).rejects.toThrow(/already committed/i)
    })
  })

  // ==========================================================================
  // Clone - Eventual Mode
  // ==========================================================================

  describe('clone() - Eventual Mode', () => {
    it('initiates eventual clone with handle', async () => {
      const targetNs = uniqueNs('eventual-target')

      // Create source data
      await stub.thingsCreate({ $type: 'Event', name: 'Event-1' })

      // Initiate eventual clone
      const handle = await stub.clone(targetNs, { mode: 'eventual' }) as EventualCloneHandle

      expect(handle.id).toBeDefined()
      expect(handle.status).toBe('pending')
      expect(typeof handle.getProgress).toBe('function')
      expect(typeof handle.getSyncStatus).toBe('function')
    })

    it('eventual clone provides sync status', async () => {
      const targetNs = uniqueNs('eventual-status')

      // Create source data
      await stub.thingsCreate({ $type: 'Status', name: 'Status-1' })
      await stub.thingsCreate({ $type: 'Status', name: 'Status-2' })

      // Initiate eventual clone
      const handle = await stub.clone(targetNs, { mode: 'eventual' }) as EventualCloneHandle

      // Get sync status
      const status = await handle.getSyncStatus()

      expect(status.phase).toBeDefined()
      expect(status.totalItems).toBe(2)
      expect(typeof status.divergence).toBe('number')
      expect(typeof status.syncInterval).toBe('number')
    })

    it('eventual clone can be paused and resumed', async () => {
      const targetNs = uniqueNs('eventual-pause')

      // Create source data
      await stub.thingsCreate({ $type: 'Pausable', name: 'Pausable-1' })

      // Initiate eventual clone
      const handle = await stub.clone(targetNs, { mode: 'eventual' }) as EventualCloneHandle

      // Pause
      await handle.pause()
      // Note: status is a getter, not async - need to check via getSyncStatus or internal state

      // Resume
      await handle.resume()
    })

    it('eventual clone can be cancelled', async () => {
      const targetNs = uniqueNs('eventual-cancel')

      // Create source data
      await stub.thingsCreate({ $type: 'Cancellable', name: 'Cancellable-1' })

      // Initiate eventual clone
      const handle = await stub.clone(targetNs, { mode: 'eventual' }) as EventualCloneHandle

      // Cancel
      await handle.cancel()
    })

    it('eventual clone supports custom sync interval', async () => {
      const targetNs = uniqueNs('eventual-interval')

      // Create source data
      await stub.thingsCreate({ $type: 'Interval', name: 'Interval-1' })

      // Initiate eventual clone with custom interval
      const handle = await stub.clone(targetNs, {
        mode: 'eventual',
        syncInterval: 10000, // 10 seconds
      }) as EventualCloneHandle

      const status = await handle.getSyncStatus()
      expect(status.syncInterval).toBe(10000)
    })
  })

  // ==========================================================================
  // Clone - Resumable Mode
  // ==========================================================================

  describe('clone() - Resumable Mode', () => {
    it('initiates resumable clone with checkpoints', async () => {
      const targetNs = uniqueNs('resumable-target')

      // Create source data
      await stub.thingsCreate({ $type: 'Large', name: 'Large-1' })
      await stub.thingsCreate({ $type: 'Large', name: 'Large-2' })

      // Initiate resumable clone
      const handle = await stub.clone(targetNs, { mode: 'resumable' }) as ResumableCloneHandle

      expect(handle.id).toBeDefined()
      expect(handle.status).toBeDefined()
      expect(Array.isArray(handle.checkpoints)).toBe(true)
      expect(typeof handle.pause).toBe('function')
      expect(typeof handle.resume).toBe('function')
    })

    it('resumable clone tracks progress', async () => {
      const targetNs = uniqueNs('resumable-progress')

      // Create source data
      await stub.thingsCreate({ $type: 'Progress', name: 'Progress-1' })

      // Initiate resumable clone
      const handle = await stub.clone(targetNs, { mode: 'resumable' }) as ResumableCloneHandle

      // Get progress
      const progress = await handle.getProgress()
      expect(typeof progress).toBe('number')
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(100)
    })

    it('resumable clone can be paused and resumed', async () => {
      const targetNs = uniqueNs('resumable-pause')

      // Create source data
      await stub.thingsCreate({ $type: 'Pausable', name: 'Pausable-1' })

      // Initiate resumable clone
      const handle = await stub.clone(targetNs, { mode: 'resumable' }) as ResumableCloneHandle

      // Pause
      await handle.pause()

      // Resume
      await handle.resume()
    })

    it('resumable clone can be cancelled', async () => {
      const targetNs = uniqueNs('resumable-cancel')

      // Create source data
      await stub.thingsCreate({ $type: 'Cancellable', name: 'Cancellable-1' })

      // Initiate resumable clone
      const handle = await stub.clone(targetNs, { mode: 'resumable' }) as ResumableCloneHandle

      // Cancel
      await handle.cancel()
    })
  })

  // ==========================================================================
  // Fork - Basic Operations
  // ==========================================================================

  describe('fork() - Basic Operations', () => {
    it('forks DO to new namespace', async () => {
      const targetNs = uniqueNs('fork-target')

      // Create source data
      await stub.thingsCreate({ $type: 'Original', name: 'Original-1' })
      await stub.thingsCreate({ $type: 'Original', name: 'Original-2' })

      // Fork to new namespace
      const result = await stub.fork({ to: targetNs })

      expect(result.ns).toBe(targetNs)
      expect(result.doId).toBeDefined()
      expect(typeof result.doId).toBe('string')

      // Verify target has the data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Original' })
      expect(items.length).toBe(2)
    })

    it('fork creates independent copy', async () => {
      const targetNs = uniqueNs('fork-independent')

      // Create source data
      await stub.thingsCreate({ $type: 'Shared', name: 'Shared-1' })

      // Fork to new namespace
      await stub.fork({ to: targetNs })

      // Add more data to source
      await stub.thingsCreate({ $type: 'Shared', name: 'Shared-2' })

      // Verify source has 2 items
      const sourceItems = await stub.thingsList({ type: 'Shared' })
      expect(sourceItems.length).toBe(2)

      // Verify target only has 1 item (independent copy)
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const targetItems = await targetStub.thingsList({ type: 'Shared' })
      expect(targetItems.length).toBe(1)
    })

    it('fork with specific branch', async () => {
      const targetNs = uniqueNs('fork-branch')

      // Create source data on main branch
      await stub.thingsCreate({ $type: 'Main', name: 'Main-1' })

      // Fork with branch option
      const result = await stub.fork({ to: targetNs, branch: 'main' })

      expect(result.ns).toBe(targetNs)

      // Verify target has the data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Main' })
      expect(items.length).toBe(1)
    })
  })

  // ==========================================================================
  // Fork - Error Handling
  // ==========================================================================

  describe('fork() - Error Handling', () => {
    it('throws on invalid target namespace URL', async () => {
      // Create some data first
      await stub.thingsCreate({ $type: 'Test', name: 'Test' })

      await expect(
        stub.fork({ to: 'not-a-valid-url' })
      ).rejects.toThrow(/invalid.*url|namespace/i)
    })

    it('throws when source is empty', async () => {
      const targetNs = uniqueNs('fork-empty')

      // Source has no data
      await expect(
        stub.fork({ to: targetNs })
      ).rejects.toThrow(/no.*state/i)
    })
  })

  // ==========================================================================
  // Clone and Fork - Data Integrity
  // ==========================================================================

  describe('Clone and Fork - Data Integrity', () => {
    it('preserves thing data during clone', async () => {
      const targetNs = uniqueNs('integrity-clone')

      // Create source data with complex data field
      await stub.thingsCreate({
        $type: 'Complex',
        name: 'Complex-1',
        data: {
          nested: { value: 42 },
          array: [1, 2, 3],
          boolean: true,
          string: 'test',
        },
      })

      // Clone to target
      await stub.clone(targetNs)

      // Verify target has preserved data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Complex' })

      expect(items.length).toBe(1)
      expect(items[0].name).toBe('Complex-1')
      expect(items[0].data).toEqual({
        nested: { value: 42 },
        array: [1, 2, 3],
        boolean: true,
        string: 'test',
      })
    })

    it('preserves relationship data during clone', async () => {
      const targetNs = uniqueNs('integrity-rels')

      // Create source data with relationship data
      const a = await stub.thingsCreate({ $type: 'Node', name: 'A' })
      const b = await stub.thingsCreate({ $type: 'Node', name: 'B' })
      await stub.relsCreate({
        verb: 'connected_to',
        from: a.$id,
        to: b.$id,
        data: { weight: 1.5, type: 'bidirectional' },
      })

      // Clone to target
      await stub.clone(targetNs)

      // Verify target has preserved relationship data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const rels = await targetStub.relsQuery({ verb: 'connected_to' })

      expect(rels.length).toBe(1)
      expect(rels[0].data).toEqual({ weight: 1.5, type: 'bidirectional' })
    })

    it('preserves thing data during fork', async () => {
      const targetNs = uniqueNs('integrity-fork')

      // Create source data with complex data field
      await stub.thingsCreate({
        $type: 'Complex',
        name: 'Complex-1',
        data: {
          metadata: { version: 1 },
          tags: ['a', 'b', 'c'],
        },
      })

      // Fork to target
      await stub.fork({ to: targetNs })

      // Verify target has preserved data
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Complex' })

      expect(items.length).toBe(1)
      expect(items[0].data).toEqual({
        metadata: { version: 1 },
        tags: ['a', 'b', 'c'],
      })
    })
  })

  // ==========================================================================
  // Clone - Multiple Items
  // ==========================================================================

  describe('Clone - Multiple Items', () => {
    it('clones many things efficiently', async () => {
      const targetNs = uniqueNs('many-things')

      // Create many items
      const count = 50
      for (let i = 0; i < count; i++) {
        await stub.thingsCreate({ $type: 'Batch', name: `Batch-${i}` })
      }

      // Clone to target
      const result = await stub.clone(targetNs) as CloneResult

      expect(result.clonedThings).toBe(count)

      // Verify target has all items
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub
      const items = await targetStub.thingsList({ type: 'Batch' })
      expect(items.length).toBe(count)
    })

    it('clones things with mixed types', async () => {
      const targetNs = uniqueNs('mixed-types')

      // Create items of different types
      await stub.thingsCreate({ $type: 'TypeA', name: 'A-1' })
      await stub.thingsCreate({ $type: 'TypeA', name: 'A-2' })
      await stub.thingsCreate({ $type: 'TypeB', name: 'B-1' })
      await stub.thingsCreate({ $type: 'TypeC', name: 'C-1' })

      // Clone to target
      const result = await stub.clone(targetNs) as CloneResult

      expect(result.clonedThings).toBe(4)

      // Verify target has all types
      const targetId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(targetNs)
      const targetStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(targetId) as CloneForkStub

      const typeA = await targetStub.thingsList({ type: 'TypeA' })
      const typeB = await targetStub.thingsList({ type: 'TypeB' })
      const typeC = await targetStub.thingsList({ type: 'TypeC' })

      expect(typeA.length).toBe(2)
      expect(typeB.length).toBe(1)
      expect(typeC.length).toBe(1)
    })
  })
})
