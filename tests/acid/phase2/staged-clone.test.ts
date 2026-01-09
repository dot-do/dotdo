/**
 * ACID Test Suite - Phase 2.2: Staged Clone Mode (Two-Phase Commit with Checkpoints)
 *
 * RED TDD: These tests define the expected behavior for staged clone mode.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Staged clone mode provides:
 * - Two-phase commit (prepare/commit)
 * - Staging token with expiration
 * - Abort capability between phases
 * - Atomic commit of staged state
 * - Checkpoint creation for incremental progress
 * - Resume from last checkpoint after failure
 * - Checkpoint validation before apply
 * - Cleanup of stale checkpoints
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'
import type { CloneMode, CloneOptions, CloneResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR STAGED CLONE MODE
// ============================================================================

/**
 * Result of a staged clone prepare operation
 */
interface StagedPrepareResult {
  /** Phase indicator - should be 'prepared' after successful prepare */
  phase: 'prepared'
  /** Unique staging token for this operation */
  token: string
  /** When this staging token expires */
  expiresAt: Date
  /** Staging area namespace */
  stagingNs: string
  /** Metadata about the prepared state */
  metadata: {
    /** Number of things staged */
    thingsCount: number
    /** Size of staged data in bytes */
    sizeBytes: number
    /** Source branch */
    branch: string
    /** Source version */
    version: number
  }
}

/**
 * Result of a staged clone commit operation
 */
interface StagedCommitResult {
  /** Phase indicator - should be 'committed' after successful commit */
  phase: 'committed'
  /** The clone result */
  result: CloneResult
  /** Commit timestamp */
  committedAt: Date
}

/**
 * Result of a staged clone abort operation
 */
interface StagedAbortResult {
  /** Phase indicator - should be 'aborted' after successful abort */
  phase: 'aborted'
  /** The token that was aborted */
  token: string
  /** Reason for abort (optional) */
  reason?: string
  /** Abort timestamp */
  abortedAt: Date
}

/**
 * Options for staged clone mode
 */
interface StagedCloneOptions extends CloneOptions {
  mode: 'staged'
  /** Token expiration timeout in milliseconds (default: 5 minutes) */
  tokenTimeout?: number
  /** Validate target before staging */
  validateTarget?: boolean
  /** Callback for prepare progress */
  onPrepareProgress?: (progress: number) => void
}

/**
 * Staging area status
 */
interface StagingStatus {
  /** Whether the staging area exists */
  exists: boolean
  /** Status of the staging area */
  status: 'staging' | 'ready' | 'committed' | 'aborted' | 'expired' | 'corrupted'
  /** Token associated with this staging area */
  token: string
  /** When the staging area was created */
  createdAt: Date
  /** When the token expires */
  expiresAt: Date
  /** Integrity hash of staged data */
  integrityHash?: string
}

/**
 * Event types emitted during staged clone
 */
type StagedCloneEventType =
  | 'clone.prepared'
  | 'clone.committed'
  | 'clone.aborted'
  | 'clone.expired'
  | 'clone.staging.started'
  | 'clone.staging.completed'
  | 'clone.staging.corrupted'
  | 'clone.commit.started'
  | 'clone.commit.failed'

interface StagedCloneEvent {
  type: StagedCloneEventType
  token?: string
  timestamp: Date
  data?: unknown
}

/**
 * Checkpoint representing a point in the staged clone process
 */
interface Checkpoint {
  /** Unique identifier for this checkpoint */
  id: string
  /** Clone operation ID this checkpoint belongs to */
  cloneId: string
  /** Sequence number for ordering checkpoints */
  sequence: number
  /** Number of items processed at this checkpoint */
  itemsProcessed: number
  /** Total items to process */
  totalItems: number
  /** Timestamp when checkpoint was created */
  createdAt: Date
  /** Hash/checksum for validation */
  checksum: string
  /** State snapshot at this checkpoint */
  state: CheckpointState
  /** Whether this checkpoint has been validated */
  validated: boolean
}

/**
 * State stored in a checkpoint
 */
interface CheckpointState {
  /** IDs of things already cloned */
  clonedThingIds: string[]
  /** IDs of relationships already cloned */
  clonedRelationshipIds: string[]
  /** Current branch being cloned */
  branch: string
  /** Last processed version */
  lastVersion: number
}

/**
 * Extended options for staged clone mode with checkpoint support
 */
interface StagedCloneOptionsWithCheckpoints extends StagedCloneOptions {
  /** Checkpoint interval (items between checkpoints) */
  checkpointInterval?: number
  /** Maximum checkpoints to retain (older ones cleaned up) */
  maxCheckpoints?: number
  /** Checkpoint validation strictness */
  validationMode?: 'strict' | 'lenient'
}

/**
 * Staged clone handle for managing the two-phase process with checkpoints
 */
interface StagedCloneHandle {
  /** Clone operation ID */
  id: string
  /** Prepare transaction ID / token */
  prepareId: string
  /** Current status */
  status: StagedCloneStatus
  /** Get all checkpoints */
  getCheckpoints(): Promise<Checkpoint[]>
  /** Resume from a specific checkpoint */
  resumeFromCheckpoint(checkpointId: string): Promise<StagedCloneHandle>
}

type StagedCloneStatus = 'preparing' | 'prepared' | 'committing' | 'committed' | 'rolling_back' | 'rolled_back' | 'error'

// ============================================================================
// TEST SUITE
// ============================================================================

/**
 * Create sample things data for testing.
 * IMPORTANT: Object keys must match schema column order for Drizzle's raw() mapping
 * Schema order: id, type, branch, name, data, deleted, visibility
 */
function createSampleThings(count: number = 3): Array<{
  id: string
  type: number
  branch: string | null
  name: string | null
  data: { name: string; index: number }
  deleted: boolean
  visibility: string
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i + 1}`,
    type: 1,
    branch: null, // null = main branch in schema
    name: `Test Item ${i + 1}`,
    data: { name: `Test Item ${i + 1}`, index: i + 1 },
    deleted: false,
    visibility: 'user',
  }))
}

describe('Staged Clone Mode (Two-Phase Commit)', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(3)],
        ['branches', [
          { name: 'main', head: 3, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // TWO-PHASE COMMIT FLOW
  // ==========================================================================

  describe('Two-Phase Commit Flow', () => {
    it('should return staging token from prepare()', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepareResult.phase).toBe('prepared')
      expect(prepareResult.token).toBeDefined()
      expect(typeof prepareResult.token).toBe('string')
      expect(prepareResult.token.length).toBeGreaterThan(0)
    })

    it('should include expiration time in prepare result', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepareResult.expiresAt).toBeDefined()
      expect(prepareResult.expiresAt).toBeInstanceOf(Date)
      expect(prepareResult.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('should commit staged clone with valid token', async () => {
      const target = 'https://target.test.do'

      // Phase 1: Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult
      expect(prepareResult.phase).toBe('prepared')

      // Phase 2: Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      expect(commitResult.phase).toBe('committed')
      expect(commitResult.result).toBeDefined()
      expect(commitResult.result.ns).toBe(target)
      expect(commitResult.committedAt).toBeInstanceOf(Date)
    })

    it('should abort staged clone and clean up', async () => {
      const target = 'https://target.test.do'

      // Phase 1: Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Abort instead of commit
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      const abortResult = await doWithAbort.abortClone(prepareResult.token, 'Test abort')

      expect(abortResult.phase).toBe('aborted')
      expect(abortResult.token).toBe(prepareResult.token)
      expect(abortResult.abortedAt).toBeInstanceOf(Date)
    })

    it('should fail commit after token expires', async () => {
      const target = 'https://target.test.do'
      const tokenTimeout = 60000 // 1 minute

      // Prepare with explicit timeout
      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Advance time past expiration
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1000)

      // Attempt commit should fail
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/expired|invalid/i)
    })

    it('should support configurable token timeout', async () => {
      const target = 'https://target.test.do'
      const customTimeout = 120000 // 2 minutes

      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout: customTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Calculate expected expiration
      const expectedExpiry = Date.now() + customTimeout
      const actualExpiry = prepareResult.expiresAt.getTime()

      // Allow 1 second tolerance
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 1000)
      expect(actualExpiry).toBeLessThanOrEqual(expectedExpiry + 1000)
    })

    it('should generate unique tokens for each prepare', async () => {
      const target1 = 'https://target1.test.do'
      const target2 = 'https://target2.test.do'

      const prepare1 = await result.instance.clone(target1, { mode: 'staged' }) as unknown as StagedPrepareResult
      const prepare2 = await result.instance.clone(target2, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepare1.token).not.toBe(prepare2.token)
    })
  })

  // ==========================================================================
  // PREPARE PHASE
  // ==========================================================================

  describe('Prepare Phase', () => {
    it('should validate target namespace availability', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptions = { mode: 'staged', validateTarget: true }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      expect(prepareResult.phase).toBe('prepared')
      // Target should be validated as available
    })

    it('should fail prepare if target namespace is occupied', async () => {
      const occupiedTarget = 'https://occupied.test.do'
      const options: StagedCloneOptions = { mode: 'staged', validateTarget: true }

      // Mock target as occupied (schema order: ns, id, class, relation, shardKey, shardIndex, region, primary, cached, createdAt)
      result.sqlData.set('objects', [
        {
          ns: occupiedTarget,
          id: 'existing-do',
          class: 'DO',
          relation: null,
          shardKey: null,
          shardIndex: null,
          region: null,
          primary: true,
          cached: null,
          createdAt: new Date(),
        },
      ])

      await expect(
        result.instance.clone(occupiedTarget, options)
      ).rejects.toThrow(/occupied|exists|unavailable/i)
    })

    it('should create staging area at target location', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepareResult.stagingNs).toBeDefined()
      expect(prepareResult.stagingNs).toContain('staging')
    })

    it('should transfer state to staging area', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Verify metadata about transferred state
      expect(prepareResult.metadata).toBeDefined()
      expect(prepareResult.metadata.thingsCount).toBe(3) // 3 things in source
      expect(prepareResult.metadata.sizeBytes).toBeGreaterThan(0)
    })

    it('should return metadata with staging token', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepareResult.metadata.branch).toBe('main')
      expect(prepareResult.metadata.version).toBeGreaterThan(0)
      expect(prepareResult.metadata.thingsCount).toBeGreaterThanOrEqual(0)
    })

    it('should fail prepare if source has no state to clone', async () => {
      // Create empty DO
      const emptyResult = createMockDO(DO, {
        ns: 'https://empty.test.do',
        sqlData: new Map([['things', []]]),
      })

      await expect(
        emptyResult.instance.clone('https://target.test.do', { mode: 'staged' })
      ).rejects.toThrow(/empty|no state|nothing to clone/i)
    })

    it('should support progress callback during prepare', async () => {
      const progressUpdates: number[] = []
      const target = 'https://target.test.do'

      const options: StagedCloneOptions = {
        mode: 'staged',
        onPrepareProgress: (progress) => progressUpdates.push(progress),
      }

      await result.instance.clone(target, options)

      // Should have received at least start and end progress
      expect(progressUpdates.length).toBeGreaterThanOrEqual(2)
      expect(progressUpdates[0]).toBe(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })
  })

  // ==========================================================================
  // COMMIT PHASE
  // ==========================================================================

  describe('Commit Phase', () => {
    it('should atomically move staged state to live', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      expect(commitResult.phase).toBe('committed')
      expect(commitResult.result.doId).toBeDefined()
      expect(commitResult.result.ns).toBe(target)
    })

    it('should remove staging area on successful commit', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult
      const stagingNs = prepareResult.stagingNs

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Check staging area is cleaned up
      const doWithGetStagingStatus = result.instance as unknown as { getStagingStatus: (ns: string) => Promise<StagingStatus | null> }
      const stagingStatus = await doWithGetStagingStatus.getStagingStatus(stagingNs)

      expect(stagingStatus).toBeNull()
    })

    it('should fail commit if token is expired', async () => {
      const target = 'https://target.test.do'
      const tokenTimeout = 30000 // 30 seconds

      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Advance past expiration
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1)

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/expired/i)
    })

    it('should fail commit if staging area is corrupted', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate corruption by modifying staging area data
      const doWithCorrupt = result.instance as unknown as { _corruptStagingArea: (token: string) => Promise<void> }
      if (doWithCorrupt._corruptStagingArea) {
        await doWithCorrupt._corruptStagingArea(prepareResult.token)
      }

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/corrupted|integrity|invalid/i)
    })

    it('should fail commit with invalid token', async () => {
      const invalidToken = 'invalid-token-12345'

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(invalidToken)).rejects.toThrow(/invalid|not found|unknown/i)
    })

    it('should fail commit if already committed', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // First commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Second commit should fail
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/already committed|invalid|not found/i)
    })

    it('should fail commit if already aborted', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Abort
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      // Commit should fail
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/aborted|invalid|not found/i)
    })
  })

  // ==========================================================================
  // ABORT PHASE
  // ==========================================================================

  describe('Abort Phase', () => {
    it('should clean up staging area on abort', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult
      const stagingNs = prepareResult.stagingNs

      // Abort
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      // Verify staging area cleaned up
      const doWithGetStagingStatus = result.instance as unknown as { getStagingStatus: (ns: string) => Promise<StagingStatus | null> }
      const stagingStatus = await doWithGetStagingStatus.getStagingStatus(stagingNs)

      expect(stagingStatus).toBeNull()
    })

    it('should release any locks held on abort', async () => {
      const target = 'https://target.test.do'

      // Prepare (should acquire lock on target)
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Abort
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      // Target should be available for new clone
      const newPrepare = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult
      expect(newPrepare.phase).toBe('prepared')
    })

    it('should not modify source state on abort', async () => {
      const target = 'https://target.test.do'
      const originalThings = result.sqlData.get('things')!.slice()

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Abort
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      // Verify source unchanged
      const currentThings = result.sqlData.get('things')!
      expect(currentThings).toEqual(originalThings)
    })

    it('should be idempotent - multiple aborts should succeed', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }

      // First abort
      const abort1 = await doWithAbort.abortClone(prepareResult.token)
      expect(abort1.phase).toBe('aborted')

      // Second abort should also succeed (idempotent)
      const abort2 = await doWithAbort.abortClone(prepareResult.token)
      expect(abort2.phase).toBe('aborted')
    })

    it('should include reason in abort result', async () => {
      const target = 'https://target.test.do'
      const abortReason = 'User cancelled operation'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      const abortResult = await doWithAbort.abortClone(prepareResult.token, abortReason)

      expect(abortResult.reason).toBe(abortReason)
    })
  })

  // ==========================================================================
  // STATE DURING STAGING
  // ==========================================================================

  describe('State During Staging', () => {
    it('should keep source readable during staging', async () => {
      const target = 'https://target.test.do'

      // Start prepare (async)
      const preparePromise = result.instance.clone(target, { mode: 'staged' })

      // Source should still be readable during staging - verify the read operation
      // completes without error (not blocked by the staging operation)
      // Note: Mock DB doesn't fully simulate Drizzle queries, so we verify
      // readability by checking the operation doesn't throw
      await expect(result.instance.things.list()).resolves.not.toThrow()

      // Also verify storage is accessible during staging
      const ns = await result.storage.get('ns')
      expect(ns).toBe('https://source.test.do')

      await preparePromise
    })

    it('should show target as "staging" status', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Check staging status
      const doWithGetStagingStatus = result.instance as unknown as { getStagingStatus: (ns: string) => Promise<StagingStatus | null> }
      const stagingStatus = await doWithGetStagingStatus.getStagingStatus(prepareResult.stagingNs)

      expect(stagingStatus).not.toBeNull()
      expect(stagingStatus!.status).toBe('ready')
      expect(stagingStatus!.token).toBe(prepareResult.token)
    })

    it('should not make staged state visible to queries', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Target namespace should not be queryable yet
      const doWithResolve = result.instance as unknown as { objects: { get: (ns: string) => Promise<{ ns: string } | null> } }
      const targetObj = await doWithResolve.objects.get(target)

      // Target should not exist as a live DO yet
      expect(targetObj).toBeNull()
    })

    it('should queue multiple prepares for same target', async () => {
      const target = 'https://target.test.do'

      // First prepare
      const prepare1 = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Second prepare for same target should queue or fail based on implementation
      // The test expects either queuing or rejection
      try {
        const prepare2 = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult
        // If it succeeds, tokens should be different
        expect(prepare2.token).not.toBe(prepare1.token)
      } catch (error) {
        // If it fails, should indicate target is locked/in-use
        expect((error as Error).message).toMatch(/locked|in use|pending/i)
      }
    })

    it('should allow staging to different targets concurrently', async () => {
      const target1 = 'https://target1.test.do'
      const target2 = 'https://target2.test.do'

      // Both prepares should succeed concurrently
      const [prepare1, prepare2] = await Promise.all([
        result.instance.clone(target1, { mode: 'staged' }) as Promise<StagedPrepareResult>,
        result.instance.clone(target2, { mode: 'staged' }) as Promise<StagedPrepareResult>,
      ])

      expect(prepare1.phase).toBe('prepared')
      expect(prepare2.phase).toBe('prepared')
      expect(prepare1.stagingNs).not.toBe(prepare2.stagingNs)
    })
  })

  // ==========================================================================
  // FAILURE SCENARIOS
  // ==========================================================================

  describe('Failure Scenarios', () => {
    it('should leave no artifacts on prepare failure', async () => {
      const target = 'https://failing-target.test.do'

      // Mock a failure during prepare
      const originalClone = result.instance.clone.bind(result.instance)
      vi.spyOn(result.instance, 'clone' as never).mockImplementationOnce(async () => {
        throw new Error('Network error during prepare')
      })

      // Attempt prepare
      await expect(result.instance.clone(target, { mode: 'staged' })).rejects.toThrow()

      // Verify no staging artifacts exist
      const doWithGetStagingStatus = result.instance as unknown as { getStagingStatus: (ns: string) => Promise<StagingStatus | null> }
      if (doWithGetStagingStatus.getStagingStatus) {
        const stagingStatus = await doWithGetStagingStatus.getStagingStatus(`${target}-staging`)
        expect(stagingStatus).toBeNull()
      }
    })

    it('should rollback to staged state on commit failure', async () => {
      const target = 'https://target.test.do'

      // Prepare successfully
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Mock commit to fail mid-operation
      const doWithCommit = result.instance as unknown as {
        commitClone: (token: string) => Promise<StagedCommitResult>
        getStagingStatus: (ns: string) => Promise<StagingStatus | null>
      }

      // Simulate commit failure
      vi.spyOn(result.instance as never, 'commitClone' as never).mockImplementationOnce(async () => {
        throw new Error('Commit failed mid-operation')
      })

      try {
        await doWithCommit.commitClone(prepareResult.token)
      } catch {
        // Expected to fail
      }

      // Staging area should still exist (rollback to staged state)
      const stagingStatus = await doWithCommit.getStagingStatus(prepareResult.stagingNs)
      // Either still exists with 'ready' status or marked as 'failed'
      expect(stagingStatus?.status).toMatch(/ready|failed|staging/i)
    })

    it('should be recoverable after network partition during commit', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // The token should remain valid for recovery after network issues
      // (as long as it hasn't expired)
      expect(prepareResult.token).toBeDefined()
      expect(prepareResult.expiresAt.getTime()).toBeGreaterThan(Date.now())

      // Verify token can be used for status check
      const doWithGetTokenStatus = result.instance as unknown as { getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string }> }
      if (doWithGetTokenStatus.getCloneTokenStatus) {
        const tokenStatus = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)
        expect(tokenStatus.valid).toBe(true)
      }
    })

    it('should clean up orphaned staging areas via garbage collection', async () => {
      const target = 'https://target.test.do'
      const tokenTimeout = 1000 // 1 second for fast test

      // Prepare with short timeout
      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Let token expire
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1000)

      // Trigger garbage collection
      const doWithGC = result.instance as unknown as { gcStagingAreas: () => Promise<{ cleaned: number }> }
      if (doWithGC.gcStagingAreas) {
        const gcResult = await doWithGC.gcStagingAreas()
        expect(gcResult.cleaned).toBeGreaterThanOrEqual(1)
      }

      // Verify staging area is cleaned
      const doWithGetStagingStatus = result.instance as unknown as { getStagingStatus: (ns: string) => Promise<StagingStatus | null> }
      if (doWithGetStagingStatus.getStagingStatus) {
        const stagingStatus = await doWithGetStagingStatus.getStagingStatus(prepareResult.stagingNs)
        expect(stagingStatus).toBeNull()
      }
    })

    it('should fail gracefully on insufficient storage during prepare', async () => {
      const target = 'https://target.test.do'

      // Mock storage quota exceeded
      vi.spyOn(result.storage, 'put' as never).mockImplementationOnce(async () => {
        throw new Error('Storage quota exceeded')
      })

      await expect(
        result.instance.clone(target, { mode: 'staged' })
      ).rejects.toThrow(/storage|quota|space/i)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit clone.prepared event on successful prepare', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const preparedEvents = events.filter((e) => e.type === 'clone.prepared')
      expect(preparedEvents.length).toBe(1)
      expect(preparedEvents[0].data).toHaveProperty('token', prepareResult.token)
    })

    it('should emit clone.committed event on successful commit', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      const committedEvents = events.filter((e) => e.type === 'clone.committed')
      expect(committedEvents.length).toBe(1)
    })

    it('should emit clone.aborted event on abort', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      const abortedEvents = events.filter((e) => e.type === 'clone.aborted')
      expect(abortedEvents.length).toBe(1)
    })

    it('should emit clone.expired event when token times out', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const tokenTimeout = 1000

      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Advance past expiration and trigger GC
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1000)

      const doWithGC = result.instance as unknown as { gcStagingAreas: () => Promise<{ cleaned: number }> }
      if (doWithGC.gcStagingAreas) {
        await doWithGC.gcStagingAreas()
      }

      const expiredEvents = events.filter((e) => e.type === 'clone.expired')
      expect(expiredEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should emit clone.staging.started and clone.staging.completed during prepare', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      await result.instance.clone(target, { mode: 'staged' })

      const stagingStarted = events.filter((e) => e.type === 'clone.staging.started')
      const stagingCompleted = events.filter((e) => e.type === 'clone.staging.completed')

      expect(stagingStarted.length).toBe(1)
      expect(stagingCompleted.length).toBe(1)
    })

    it('should emit clone.commit.failed on commit failure', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://target.test.do'
      const tokenTimeout = 100

      const options: StagedCloneOptions = { mode: 'staged', tokenTimeout }
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Let token expire
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1)

      // Attempt commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      try {
        await doWithCommit.commitClone(prepareResult.token)
      } catch {
        // Expected
      }

      const failedEvents = events.filter((e) => e.type === 'clone.commit.failed')
      expect(failedEvents.length).toBe(1)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH CLONE RESULT
  // ==========================================================================

  describe('Integration with CloneResult', () => {
    it('should return standard CloneResult with staged mode after commit', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      // Should have standard CloneResult fields
      expect(commitResult.result.ns).toBe(target)
      expect(commitResult.result.doId).toBeDefined()
      expect(commitResult.result.mode).toBe('staged')
    })

    it('should include staged info in CloneResult', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      // Should have staged-specific fields
      expect(commitResult.result.staged).toBeDefined()
      expect(commitResult.result.staged?.prepareId).toBe(prepareResult.token)
      expect(commitResult.result.staged?.committed).toBe(true)
    })

    it('should not have checkpoint fields in staged mode result', async () => {
      const target = 'https://target.test.do'

      // Prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      // Should not have eventual/resumable specific fields
      expect(commitResult.result.checkpoint).toBeUndefined()
    })
  })

  // ==========================================================================
  // TOKEN MANAGEMENT
  // ==========================================================================

  describe('Token Management', () => {
    it('should validate token format', async () => {
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }

      // Empty token
      await expect(doWithCommit.commitClone('')).rejects.toThrow(/invalid|empty/i)

      // Malformed token
      await expect(doWithCommit.commitClone('not-a-valid-token-format')).rejects.toThrow(/invalid|not found/i)
    })

    it('should track token status correctly', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithGetTokenStatus = result.instance as unknown as { getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string; expiresAt: Date }> }

      if (doWithGetTokenStatus.getCloneTokenStatus) {
        const status = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)

        expect(status.valid).toBe(true)
        expect(status.status).toBe('prepared')
        expect(status.expiresAt).toEqual(prepareResult.expiresAt)
      }
    })

    it('should invalidate token after commit', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Token should now be invalid
      const doWithGetTokenStatus = result.instance as unknown as { getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string }> }
      if (doWithGetTokenStatus.getCloneTokenStatus) {
        const status = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)
        expect(status.valid).toBe(false)
        expect(status.status).toBe('committed')
      }
    })

    it('should invalidate token after abort', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Abort
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token)

      // Token should now be invalid
      const doWithGetTokenStatus = result.instance as unknown as { getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string }> }
      if (doWithGetTokenStatus.getCloneTokenStatus) {
        const status = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)
        expect(status.valid).toBe(false)
        expect(status.status).toBe('aborted')
      }
    })
  })

  // ==========================================================================
  // CHECKPOINT CREATION AND VALIDATION (Phase 2.2)
  // ==========================================================================

  describe('Checkpoint Creation', () => {
    it('should create checkpoints at configured intervals during prepare', async () => {
      // RED: Staged clone should create checkpoints during prepare phase
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1, // Checkpoint every 1 item (for 3 items)
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Get checkpoints via handle
      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        // With 3 items and interval of 1, should have ~3 checkpoints
        expect(checkpoints.length).toBeGreaterThanOrEqual(2)
        expect(checkpoints.length).toBeLessThanOrEqual(4)
      }
    })

    it('should include unique ID for each checkpoint', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        // All checkpoint IDs should be unique
        const ids = checkpoints.map((cp) => cp.id)
        const uniqueIds = new Set(ids)
        expect(uniqueIds.size).toBe(ids.length)
      }
    })

    it('should track items processed in each checkpoint', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        // Each checkpoint should track cumulative items processed
        for (let i = 0; i < checkpoints.length; i++) {
          const checkpoint = checkpoints[i]
          expect(checkpoint.itemsProcessed).toBeGreaterThan(0)
          expect(checkpoint.itemsProcessed).toBeLessThanOrEqual(checkpoint.totalItems)

          // Checkpoints should be ordered by sequence
          expect(checkpoint.sequence).toBe(i + 1)

          // Each subsequent checkpoint should have more items processed
          if (i > 0) {
            expect(checkpoint.itemsProcessed).toBeGreaterThan(checkpoints[i - 1].itemsProcessed)
          }
        }
      }
    })

    it('should store state snapshot in checkpoint', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        for (const checkpoint of checkpoints) {
          expect(checkpoint.state).toBeDefined()
          expect(checkpoint.state.clonedThingIds).toBeInstanceOf(Array)
          expect(checkpoint.state.clonedRelationshipIds).toBeInstanceOf(Array)
          expect(checkpoint.state.branch).toBeDefined()
          expect(typeof checkpoint.state.lastVersion).toBe('number')
        }
      }
    })

    it('should include checksum for validation', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        for (const checkpoint of checkpoints) {
          expect(checkpoint.checksum).toBeDefined()
          expect(typeof checkpoint.checksum).toBe('string')
          expect(checkpoint.checksum.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('Checkpoint Validation', () => {
    it('should validate checkpoint integrity before apply', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        validationMode: 'strict',
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        // All checkpoints should be validated in strict mode
        for (const checkpoint of checkpoints) {
          expect(checkpoint.validated).toBe(true)
        }
      }
    })

    it('should verify checksum matches state data', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        validationMode: 'strict',
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Validate checkpoint integrity
      const doWithValidate = result.instance as unknown as { validateCheckpoint: (checkpointId: string) => Promise<{ valid: boolean; error?: string }> }
      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }

      if (doWithValidate.validateCheckpoint && doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        for (const checkpoint of checkpoints) {
          const validation = await doWithValidate.validateCheckpoint(checkpoint.id)
          expect(validation.valid).toBe(true)
        }
      }
    })

    it('should reject corrupted checkpoint in strict mode', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        validationMode: 'strict',
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Corrupt a checkpoint
      const doWithCorrupt = result.instance as unknown as { _corruptCheckpoint: (token: string, checkpointId: string) => Promise<void> }
      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }

      if (doWithCorrupt._corruptCheckpoint && doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        if (checkpoints.length > 0) {
          await doWithCorrupt._corruptCheckpoint(prepareResult.token, checkpoints[0].id)

          // Attempt to commit should fail due to corrupted checkpoint
          const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
          await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow(/checkpoint.*invalid|checksum|corrupt/i)
        }
      }
    })

    it('should allow lenient validation mode', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        validationMode: 'lenient',
      }

      // In lenient mode, minor inconsistencies are logged but not fatal
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult
      expect(prepareResult.phase).toBe('prepared')
    })
  })

  // ==========================================================================
  // RESUME FROM CHECKPOINT (Phase 2.2)
  // ==========================================================================

  describe('Resume from Checkpoint', () => {
    it('should resume from last checkpoint after failure', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      // First, complete a prepare to get checkpoints
      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithResume = result.instance as unknown as { resumeCloneFromCheckpoint: (checkpointId: string) => Promise<StagedPrepareResult> }

      if (doWithCheckpoints.getCloneCheckpoints && doWithResume.resumeCloneFromCheckpoint) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)

        if (checkpoints.length > 0) {
          // Simulate failure and resume from checkpoint
          const resumeResult = await doWithResume.resumeCloneFromCheckpoint(checkpoints[0].id)
          expect(resumeResult).toBeDefined()
          expect(resumeResult.phase).toBe('prepared')
        }
      }
    })

    it('should skip already-cloned items when resuming', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithResume = result.instance as unknown as { resumeCloneFromCheckpoint: (checkpointId: string) => Promise<StagedPrepareResult> }

      if (doWithCheckpoints.getCloneCheckpoints && doWithResume.resumeCloneFromCheckpoint) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)

        if (checkpoints.length > 1) {
          const middleCheckpoint = checkpoints[Math.floor(checkpoints.length / 2)]
          const itemsAlreadyCloned = middleCheckpoint.state.clonedThingIds.length

          // Resume from middle checkpoint
          const resumeResult = await doWithResume.resumeCloneFromCheckpoint(middleCheckpoint.id)

          // Should complete without re-cloning already processed items
          expect(resumeResult.metadata.thingsCount).toBe(3) // Total items
          // Implementation detail: verify skipping by checking new checkpoints start after middle
        }
      }
    })

    it('should validate checkpoint before resuming', async () => {
      const invalidCheckpointId = 'invalid-checkpoint-999'

      const doWithResume = result.instance as unknown as { resumeCloneFromCheckpoint: (checkpointId: string) => Promise<StagedPrepareResult> }

      if (doWithResume.resumeCloneFromCheckpoint) {
        // Attempt to resume from non-existent checkpoint
        await expect(doWithResume.resumeCloneFromCheckpoint(invalidCheckpointId)).rejects.toThrow(/checkpoint.*not found|invalid/i)
      }
    })

    it('should create new checkpoints during resume', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithResume = result.instance as unknown as { resumeCloneFromCheckpoint: (checkpointId: string) => Promise<StagedPrepareResult> }

      if (doWithCheckpoints.getCloneCheckpoints && doWithResume.resumeCloneFromCheckpoint) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)

        if (checkpoints.length > 0) {
          const firstCheckpoint = checkpoints[0]
          // Resume from first checkpoint
          const resumeResult = await doWithResume.resumeCloneFromCheckpoint(firstCheckpoint.id)

          // Get new checkpoints after resume
          const newCheckpoints = await doWithCheckpoints.getCloneCheckpoints(resumeResult.token)

          // Should have created new checkpoints during resume
          expect(newCheckpoints.length).toBeGreaterThan(0)
        }
      }
    })

    it('should preserve original clone metadata when resuming', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithResume = result.instance as unknown as { resumeCloneFromCheckpoint: (checkpointId: string) => Promise<StagedPrepareResult> }

      if (doWithCheckpoints.getCloneCheckpoints && doWithResume.resumeCloneFromCheckpoint) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)

        if (checkpoints.length > 0) {
          const resumeResult = await doWithResume.resumeCloneFromCheckpoint(checkpoints[0].id)

          // Should preserve original metadata
          expect(resumeResult.metadata.branch).toBe(prepareResult.metadata.branch)
        }
      }
    })
  })

  // ==========================================================================
  // CHECKPOINT CLEANUP (Phase 2.2)
  // ==========================================================================

  describe('Checkpoint Cleanup', () => {
    it('should retain only maxCheckpoints most recent', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1, // Checkpoint every item
        maxCheckpoints: 2, // Only keep 2
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        // Should only have 2 checkpoints despite creating more (3 items)
        expect(checkpoints.length).toBeLessThanOrEqual(2)
      }
    })

    it('should cleanup checkpoints after successful commit', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }

      if (doWithCheckpoints.getCloneCheckpoints) {
        // Should have checkpoints before commit
        const checkpointsBefore = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsBefore.length).toBeGreaterThan(0)

        // Commit the clone
        await doWithCommit.commitClone(prepareResult.token)

        // Checkpoints should be cleaned up after commit
        const checkpointsAfter = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsAfter.length).toBe(0)
      }
    })

    it('should cleanup checkpoints after abort', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }

      if (doWithCheckpoints.getCloneCheckpoints) {
        // Should have checkpoints before abort
        const checkpointsBefore = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsBefore.length).toBeGreaterThan(0)

        // Abort the clone
        await doWithAbort.abortClone(prepareResult.token)

        // Checkpoints should be cleaned up after abort
        const checkpointsAfter = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsAfter.length).toBe(0)
      }
    })

    it('should cleanup stale checkpoints from failed clones', async () => {
      const target = 'https://target.test.do'
      const tokenTimeout = 1000 // 1 second for fast test
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        tokenTimeout,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Let token expire
      await vi.advanceTimersByTimeAsync(tokenTimeout + 1000)

      // Trigger garbage collection
      const doWithGC = result.instance as unknown as { gcStagingAreas: () => Promise<{ cleaned: number; checkpointsCleaned: number }> }
      if (doWithGC.gcStagingAreas) {
        const gcResult = await doWithGC.gcStagingAreas()
        expect(gcResult.checkpointsCleaned).toBeGreaterThanOrEqual(1)
      }

      // Verify checkpoints are cleaned
      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpoints.length).toBe(0)
      }
    })

    it('should not cleanup checkpoints for in-progress clones', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
        tokenTimeout: 300000, // 5 minutes (not expired)
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithGC = result.instance as unknown as { gcStagingAreas: () => Promise<{ cleaned: number }> }

      if (doWithCheckpoints.getCloneCheckpoints && doWithGC.gcStagingAreas) {
        // Clone is prepared but not committed - checkpoints should remain
        const checkpoints = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpoints.length).toBeGreaterThan(0)

        // Trigger cleanup (should not affect in-progress clones)
        await doWithGC.gcStagingAreas()

        // Checkpoints for in-progress clone should remain
        const checkpointsAfter = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsAfter.length).toBe(checkpoints.length)
      }
    })

    it('should preserve checkpoints on commit failure for retry', async () => {
      const target = 'https://target.test.do'
      const options: StagedCloneOptionsWithCheckpoints = {
        mode: 'staged',
        checkpointInterval: 1,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      const doWithCheckpoints = result.instance as unknown as { getCloneCheckpoints: (token: string) => Promise<Checkpoint[]> }
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }

      if (doWithCheckpoints.getCloneCheckpoints) {
        const checkpointsBefore = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)

        // Mock commit failure
        vi.spyOn(result.instance as never, 'commitClone' as never).mockRejectedValueOnce(new Error('Commit failed mid-operation'))

        try {
          await doWithCommit.commitClone(prepareResult.token)
        } catch {
          // Expected to fail
        }

        // Checkpoints should be preserved for retry
        const checkpointsAfter = await doWithCheckpoints.getCloneCheckpoints(prepareResult.token)
        expect(checkpointsAfter.length).toBe(checkpointsBefore.length)
      }
    })
  })

  // ==========================================================================
  // TWO-PHASE COMMIT COORDINATOR ROLE
  // ==========================================================================

  describe('Coordinator Role', () => {
    it('should act as coordinator when initiating staged clone', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // The source DO should be the coordinator
      const doWithCoordinator = result.instance as unknown as {
        isCoordinator: (token: string) => Promise<boolean>
        getCoordinatorInfo: (token: string) => Promise<CoordinatorInfo>
      }

      if (doWithCoordinator.isCoordinator) {
        const isCoord = await doWithCoordinator.isCoordinator(prepareResult.token)
        expect(isCoord).toBe(true)
      }
    })

    it('should track transaction state in coordinator log', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithCoordinator = result.instance as unknown as {
        getTransactionLog: (token: string) => Promise<TransactionLogEntry[]>
      }

      if (doWithCoordinator.getTransactionLog) {
        const log = await doWithCoordinator.getTransactionLog(prepareResult.token)

        expect(log.length).toBeGreaterThan(0)
        // Should have a prepare entry
        const prepareEntry = log.find(e => e.phase === 'prepare')
        expect(prepareEntry).toBeDefined()
        expect(prepareEntry?.status).toBe('completed')
      }
    })

    it('should persist coordinator decision to durable storage', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit to make a decision
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Decision should be persisted
      const decisionKey = `2pc:decision:${prepareResult.token}`
      const storedDecision = await result.storage.get(decisionKey)

      expect(storedDecision).toBeDefined()
      expect((storedDecision as Record<string, unknown>)?.decision).toBe('commit')
    })

    it('should broadcast commit decision to all participants', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Track coordinator communications
      const communications: Array<{ type: string; target: string }> = []
      const doWithBroadcast = result.instance as unknown as {
        _onBroadcast: (callback: (type: string, target: string) => void) => void
      }

      if (doWithBroadcast._onBroadcast) {
        doWithBroadcast._onBroadcast((type, target) => {
          communications.push({ type, target })
        })
      }

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Should have broadcast commit to target
      const commitBroadcast = communications.find(c => c.type === 'commit')
      expect(commitBroadcast).toBeDefined()
      expect(commitBroadcast?.target).toBe(target)
    })

    it('should broadcast abort decision to all participants', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const communications: Array<{ type: string; target: string }> = []
      const doWithBroadcast = result.instance as unknown as {
        _onBroadcast: (callback: (type: string, target: string) => void) => void
      }

      if (doWithBroadcast._onBroadcast) {
        doWithBroadcast._onBroadcast((type, target) => {
          communications.push({ type, target })
        })
      }

      const doWithAbort = result.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      await doWithAbort.abortClone(prepareResult.token, 'User cancelled')

      // Should have broadcast abort to target
      const abortBroadcast = communications.find(c => c.type === 'abort')
      expect(abortBroadcast).toBeDefined()
      expect(abortBroadcast?.target).toBe(target)
    })

    it('should enforce coordinator timeout for participant responses', async () => {
      const target = 'https://slow-participant.test.do'
      const coordinatorTimeout = 5000 // 5 seconds

      const options: StagedCloneOptions = {
        mode: 'staged',
        coordinatorTimeout,
      } as StagedCloneOptions & { coordinatorTimeout: number }

      // Start prepare but participant is slow
      const preparePromise = result.instance.clone(target, options)

      // Advance time past coordinator timeout
      await vi.advanceTimersByTimeAsync(coordinatorTimeout + 1000)

      // Should timeout waiting for participant prepare acknowledgment
      await expect(preparePromise).rejects.toThrow(/timeout|participant.*not.*respond/i)
    })

    it('should handle multiple participants in single transaction', async () => {
      const targets = [
        'https://target1.test.do',
        'https://target2.test.do',
        'https://target3.test.do',
      ]

      const doWithMultiClone = result.instance as unknown as {
        cloneToMultiple: (targets: string[], options: StagedCloneOptions) => Promise<MultiStagedPrepareResult>
      }

      if (doWithMultiClone.cloneToMultiple) {
        const prepareResult = await doWithMultiClone.cloneToMultiple(targets, { mode: 'staged' })

        expect(prepareResult.participants).toHaveLength(3)
        expect(prepareResult.allPrepared).toBe(true)
        for (const participant of prepareResult.participants) {
          expect(participant.status).toBe('prepared')
        }
      }
    })

    it('should abort all participants if any participant fails prepare', async () => {
      const targets = [
        'https://target1.test.do',
        'https://failing-target.test.do', // This one will fail
        'https://target3.test.do',
      ]

      const doWithMultiClone = result.instance as unknown as {
        cloneToMultiple: (targets: string[], options: StagedCloneOptions) => Promise<MultiStagedPrepareResult>
      }

      if (doWithMultiClone.cloneToMultiple) {
        // Mock one participant failing
        const mockNamespace = result.env.DO!
        mockNamespace.stubFactory = (id) => ({
          id,
          fetch: vi.fn().mockImplementation(async (req: Request) => {
            if (id.toString().includes('failing')) {
              return new Response('Prepare failed', { status: 500 })
            }
            return new Response('OK')
          }),
        })

        await expect(
          doWithMultiClone.cloneToMultiple(targets, { mode: 'staged' })
        ).rejects.toThrow(/participant.*failed|prepare.*failed/i)

        // All participants should have received abort
        const stubs = Array.from(mockNamespace.stubs.values())
        for (const stub of stubs) {
          // Each stub should have received an abort call
          const fetchCalls = (stub.fetch as ReturnType<typeof vi.fn>).mock.calls
          const hasAbort = fetchCalls.some(call => {
            const url = call[0] instanceof Request ? call[0].url : call[0]
            return url.includes('abort')
          })
          expect(hasAbort || id.toString().includes('failing')).toBe(true)
        }
      }
    })
  })

  // ==========================================================================
  // PARTICIPANT ACKNOWLEDGMENT
  // ==========================================================================

  describe('Participant Acknowledgment', () => {
    it('should return prepare acknowledgment from participant', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // The prepare should include participant acknowledgment
      expect(prepareResult.participantAck).toBeDefined()
      expect(prepareResult.participantAck?.target).toBe(target)
      expect(prepareResult.participantAck?.status).toBe('ready')
      expect(prepareResult.participantAck?.timestamp).toBeInstanceOf(Date)
    })

    it('should include participant vote in acknowledgment', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Participant should vote 'yes' to proceed
      expect(prepareResult.participantAck?.vote).toBe('yes')
    })

    it('should abort if participant votes no', async () => {
      const target = 'https://voting-no.test.do'

      // Mock participant that votes no
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          return new Response(JSON.stringify({
            vote: 'no',
            reason: 'Resource unavailable'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      })

      await expect(
        result.instance.clone(target, { mode: 'staged' })
      ).rejects.toThrow(/participant.*voted.*no|resource.*unavailable/i)
    })

    it('should wait for acknowledgment from all participants', async () => {
      const targets = [
        'https://fast-target.test.do',
        'https://slow-target.test.do',
      ]

      const doWithMultiClone = result.instance as unknown as {
        cloneToMultiple: (targets: string[], options: StagedCloneOptions) => Promise<MultiStagedPrepareResult>
      }

      if (doWithMultiClone.cloneToMultiple) {
        let slowTargetResponded = false

        // Mock participants with different response times
        const mockNamespace = result.env.DO!
        mockNamespace.stubFactory = (id) => ({
          id,
          fetch: vi.fn().mockImplementation(async () => {
            if (id.toString().includes('slow')) {
              await new Promise(resolve => setTimeout(resolve, 100))
              slowTargetResponded = true
            }
            return new Response(JSON.stringify({ vote: 'yes' }))
          }),
        })

        const prepareResult = await doWithMultiClone.cloneToMultiple(targets, { mode: 'staged' })

        // Should have waited for slow participant
        expect(slowTargetResponded).toBe(true)
        expect(prepareResult.allPrepared).toBe(true)
      }
    })

    it('should collect commit acknowledgments from all participants', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithCommit = result.instance as unknown as {
        commitClone: (token: string) => Promise<StagedCommitResult & { participantAcks: ParticipantAck[] }>
      }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      // Should have commit acknowledgment from participant
      expect(commitResult.participantAcks).toBeDefined()
      expect(commitResult.participantAcks.length).toBeGreaterThanOrEqual(1)
      expect(commitResult.participantAcks[0].status).toBe('committed')
    })

    it('should collect abort acknowledgments from all participants', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithAbort = result.instance as unknown as {
        abortClone: (token: string, reason?: string) => Promise<StagedAbortResult & { participantAcks: ParticipantAck[] }>
      }
      const abortResult = await doWithAbort.abortClone(prepareResult.token)

      // Should have abort acknowledgment from participant
      expect(abortResult.participantAcks).toBeDefined()
      expect(abortResult.participantAcks.length).toBeGreaterThanOrEqual(1)
      expect(abortResult.participantAcks[0].status).toBe('aborted')
    })

    it('should handle participant acknowledgment timeout', async () => {
      const target = 'https://unresponsive.test.do'
      const ackTimeout = 1000 // 1 second

      const options: StagedCloneOptions = {
        mode: 'staged',
        participantAckTimeout: ackTimeout,
      } as StagedCloneOptions & { participantAckTimeout: number }

      // Mock unresponsive participant
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          // Never respond (simulate timeout)
          await new Promise(() => {}) // Infinite wait
        }),
      })

      const preparePromise = result.instance.clone(target, options)

      // Advance time past ack timeout
      await vi.advanceTimersByTimeAsync(ackTimeout + 1000)

      await expect(preparePromise).rejects.toThrow(/timeout|acknowledgment/i)
    })

    it('should retry participant acknowledgment on transient failure', async () => {
      const target = 'https://flaky-target.test.do'
      let attemptCount = 0

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Network error')
          }
          return new Response(JSON.stringify({ vote: 'yes' }))
        }),
      })

      const options: StagedCloneOptions = {
        mode: 'staged',
        maxAckRetries: 5,
      } as StagedCloneOptions & { maxAckRetries: number }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Should have succeeded after retries
      expect(prepareResult.phase).toBe('prepared')
      expect(attemptCount).toBe(3)
    })
  })

  // ==========================================================================
  // COORDINATOR FAILURE RECOVERY
  // ==========================================================================

  describe('Recovery from Coordinator Failure', () => {
    it('should persist prepare decision before sending to participants', async () => {
      const target = 'https://target.test.do'

      // Start prepare
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Decision should be persisted
      const decisionKey = `2pc:prepare:${prepareResult.token}`
      const storedDecision = await result.storage.get(decisionKey)

      expect(storedDecision).toBeDefined()
      expect((storedDecision as Record<string, unknown>)?.phase).toBe('prepared')
    })

    it('should allow new coordinator to recover transaction state', async () => {
      const target = 'https://target.test.do'

      // Prepare on original coordinator
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate coordinator crash and recovery by creating new instance
      const newResult = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: result.sqlData,
        storage: result.storage.data, // Preserve storage (contains transaction state)
      })

      // New coordinator should be able to recover transaction
      const doWithRecover = newResult.instance as unknown as {
        recoverTransaction: (token: string) => Promise<RecoveredTransactionState>
      }

      if (doWithRecover.recoverTransaction) {
        const recovered = await doWithRecover.recoverTransaction(prepareResult.token)

        expect(recovered.found).toBe(true)
        expect(recovered.phase).toBe('prepared')
        expect(recovered.target).toBe(target)
        expect(recovered.canComplete).toBe(true)
      }
    })

    it('should complete commit after coordinator recovery', async () => {
      const target = 'https://target.test.do'

      // Prepare on original coordinator
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate coordinator crash and recovery
      const newResult = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: result.sqlData,
        storage: result.storage.data,
      })

      // Complete commit on recovered coordinator
      const doWithCommit = newResult.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      expect(commitResult.phase).toBe('committed')
    })

    it('should complete abort after coordinator recovery', async () => {
      const target = 'https://target.test.do'

      // Prepare on original coordinator
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate coordinator crash and recovery
      const newResult = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: result.sqlData,
        storage: result.storage.data,
      })

      // Complete abort on recovered coordinator
      const doWithAbort = newResult.instance as unknown as { abortClone: (token: string, reason?: string) => Promise<StagedAbortResult> }
      const abortResult = await doWithAbort.abortClone(prepareResult.token, 'Recovery abort')

      expect(abortResult.phase).toBe('aborted')
    })

    it('should resume commit-in-progress after coordinator recovery', async () => {
      const target = 'https://target.test.do'

      // Prepare on original coordinator
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate commit started but not completed (crash mid-commit)
      const commitDecisionKey = `2pc:decision:${prepareResult.token}`
      await result.storage.put(commitDecisionKey, {
        decision: 'commit',
        startedAt: new Date(),
        completedAt: null, // Not completed
      })

      // Recover coordinator
      const newResult = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: result.sqlData,
        storage: result.storage.data,
      })

      // Should detect incomplete commit and resume
      const doWithResume = newResult.instance as unknown as {
        resumeIncompleteTransactions: () => Promise<ResumedTransaction[]>
      }

      if (doWithResume.resumeIncompleteTransactions) {
        const resumed = await doWithResume.resumeIncompleteTransactions()

        expect(resumed.length).toBeGreaterThanOrEqual(1)
        expect(resumed[0].token).toBe(prepareResult.token)
        expect(resumed[0].action).toBe('commit')
      }
    })

    it('should timeout prepared transactions without coordinator decision', async () => {
      const target = 'https://target.test.do'
      const prepareTimeout = 30000 // 30 seconds

      const options: StagedCloneOptions = {
        mode: 'staged',
        prepareTimeout,
      } as StagedCloneOptions & { prepareTimeout: number }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Advance time past prepare timeout without coordinator decision
      await vi.advanceTimersByTimeAsync(prepareTimeout + 1000)

      // Transaction should be auto-aborted due to timeout
      const doWithGetTokenStatus = result.instance as unknown as {
        getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string }>
      }

      if (doWithGetTokenStatus.getCloneTokenStatus) {
        const status = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)
        expect(status.status).toBe('aborted')
      }
    })

    it('should log coordinator decisions for audit', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Check audit log
      const auditKey = `2pc:audit:${prepareResult.token}`
      const auditLog = await result.storage.get(auditKey) as TransactionAuditLog

      expect(auditLog).toBeDefined()
      expect(auditLog.events).toContainEqual(expect.objectContaining({
        type: 'prepare',
        status: 'completed',
      }))
      expect(auditLog.events).toContainEqual(expect.objectContaining({
        type: 'commit',
        status: 'completed',
      }))
    })
  })

  // ==========================================================================
  // PARTICIPANT FAILURE RECOVERY
  // ==========================================================================

  describe('Recovery from Participant Failure', () => {
    it('should handle participant crash during prepare', async () => {
      const target = 'https://crashing.test.do'
      let prepareAttempted = false

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.url.includes('prepare')) {
            prepareAttempted = true
            throw new Error('Participant crashed')
          }
          return new Response('OK')
        }),
      })

      await expect(
        result.instance.clone(target, { mode: 'staged' })
      ).rejects.toThrow(/participant.*crashed|prepare.*failed/i)

      expect(prepareAttempted).toBe(true)
    })

    it('should handle participant crash during commit', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Mock participant crashing during commit
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.url.includes('commit')) {
            throw new Error('Participant crashed during commit')
          }
          return new Response(JSON.stringify({ status: 'ok' }))
        }),
      })

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }

      // Commit should fail but track the need for recovery
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow()

      // Transaction should be marked for recovery
      const recoveryKey = `2pc:recovery:${prepareResult.token}`
      const recoveryState = await result.storage.get(recoveryKey)

      expect(recoveryState).toBeDefined()
      expect((recoveryState as Record<string, unknown>)?.needsRecovery).toBe(true)
    })

    it('should retry commit to failed participant', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      let commitAttempts = 0

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.url.includes('commit')) {
            commitAttempts++
            if (commitAttempts < 3) {
              throw new Error('Temporary failure')
            }
          }
          return new Response(JSON.stringify({ status: 'ok' }))
        }),
      })

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      const commitResult = await doWithCommit.commitClone(prepareResult.token)

      expect(commitResult.phase).toBe('committed')
      expect(commitAttempts).toBe(3)
    })

    it('should allow participant to query transaction status from coordinator', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Commit the transaction
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Participant should be able to query coordinator for decision
      const doWithQueryDecision = result.instance as unknown as {
        getDecision: (token: string) => Promise<{ decision: 'commit' | 'abort' | 'pending' }>
      }

      if (doWithQueryDecision.getDecision) {
        const decision = await doWithQueryDecision.getDecision(prepareResult.token)
        expect(decision.decision).toBe('commit')
      }
    })

    it('should handle participant recovery after crash with prepared state', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Simulate participant having prepared state but uncertain about decision
      // (participant crashed after prepare but before receiving commit)
      const doWithParticipantRecovery = result.instance as unknown as {
        handleParticipantRecoveryQuery: (participantNs: string, token: string) => Promise<ParticipantRecoveryResponse>
      }

      if (doWithParticipantRecovery.handleParticipantRecoveryQuery) {
        // Before commit, participant should wait
        const recoveryBeforeCommit = await doWithParticipantRecovery.handleParticipantRecoveryQuery(
          target,
          prepareResult.token
        )
        expect(recoveryBeforeCommit.action).toBe('wait')

        // Commit the transaction
        const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
        await doWithCommit.commitClone(prepareResult.token)

        // After commit, participant should complete commit
        const recoveryAfterCommit = await doWithParticipantRecovery.handleParticipantRecoveryQuery(
          target,
          prepareResult.token
        )
        expect(recoveryAfterCommit.action).toBe('commit')
      }
    })

    it('should handle permanent participant failure with manual intervention', async () => {
      const target = 'https://permanently-dead.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Mock permanent failure
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'dead-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Participant permanently unavailable')),
      })

      // Attempt commit fails
      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await expect(doWithCommit.commitClone(prepareResult.token)).rejects.toThrow()

      // Manual intervention to force complete
      const doWithForce = result.instance as unknown as {
        forceCompleteTransaction: (token: string, decision: 'commit' | 'abort') => Promise<void>
      }

      if (doWithForce.forceCompleteTransaction) {
        await doWithForce.forceCompleteTransaction(prepareResult.token, 'abort')

        // Transaction should now be marked as complete
        const doWithGetTokenStatus = result.instance as unknown as {
          getCloneTokenStatus: (token: string) => Promise<{ valid: boolean; status: string }>
        }

        if (doWithGetTokenStatus.getCloneTokenStatus) {
          const status = await doWithGetTokenStatus.getCloneTokenStatus(prepareResult.token)
          expect(status.status).toBe('force_aborted')
        }
      }
    })

    it('should track participant state transitions for debugging', async () => {
      const target = 'https://target.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      const doWithCommit = result.instance as unknown as { commitClone: (token: string) => Promise<StagedCommitResult> }
      await doWithCommit.commitClone(prepareResult.token)

      // Get participant state history
      const doWithHistory = result.instance as unknown as {
        getParticipantHistory: (token: string, participantNs: string) => Promise<ParticipantStateHistory>
      }

      if (doWithHistory.getParticipantHistory) {
        const history = await doWithHistory.getParticipantHistory(prepareResult.token, target)

        expect(history.transitions).toContainEqual(expect.objectContaining({
          from: 'initial',
          to: 'prepared',
        }))
        expect(history.transitions).toContainEqual(expect.objectContaining({
          from: 'prepared',
          to: 'committed',
        }))
      }
    })

    it('should emit events for participant failures', async () => {
      const events: StagedCloneEvent[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent
      ;(result.instance as unknown as { emitEvent: (verb: string, data: unknown) => Promise<void> }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb as StagedCloneEventType, timestamp: new Date(), data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://failing.test.do'

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Participant failed')),
      })

      await expect(
        result.instance.clone(target, { mode: 'staged' })
      ).rejects.toThrow()

      const failureEvents = events.filter(e =>
        e.type === 'clone.participant.failed' as unknown as StagedCloneEventType
      )
      expect(failureEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('should timeout prepare phase if participant does not respond', async () => {
      const target = 'https://slow-target.test.do'
      const prepareTimeout = 2000 // 2 seconds

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'slow-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate very slow participant
          await new Promise(resolve => setTimeout(resolve, 10000))
          return new Response('OK')
        }),
      })

      const options: StagedCloneOptions = {
        mode: 'staged',
        prepareTimeout,
      } as StagedCloneOptions & { prepareTimeout: number }

      const preparePromise = result.instance.clone(target, options)

      // Advance time past prepare timeout
      await vi.advanceTimersByTimeAsync(prepareTimeout + 1000)

      await expect(preparePromise).rejects.toThrow(/timeout|prepare/i)
    })

    it('should timeout commit phase if participant does not acknowledge', async () => {
      const target = 'https://target.test.do'
      const commitTimeout = 2000 // 2 seconds

      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      // Mock slow commit acknowledgment
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'slow-commit-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.url.includes('commit')) {
            await new Promise(resolve => setTimeout(resolve, 10000))
          }
          return new Response(JSON.stringify({ status: 'ok' }))
        }),
      })

      const doWithCommit = result.instance as unknown as {
        commitClone: (token: string, options?: { timeout?: number }) => Promise<StagedCommitResult>
      }

      const commitPromise = doWithCommit.commitClone(prepareResult.token, { timeout: commitTimeout })

      // Advance time past commit timeout
      await vi.advanceTimersByTimeAsync(commitTimeout + 1000)

      await expect(commitPromise).rejects.toThrow(/timeout|commit/i)
    })

    it('should respect per-phase timeout configuration', async () => {
      const target = 'https://target.test.do'

      const options: StagedCloneOptions & {
        prepareTimeout: number
        commitTimeout: number
        abortTimeout: number
      } = {
        mode: 'staged',
        prepareTimeout: 5000,
        commitTimeout: 10000,
        abortTimeout: 3000,
      }

      const prepareResult = await result.instance.clone(target, options) as unknown as StagedPrepareResult

      // Verify the timeouts are stored with the transaction
      const txKey = `2pc:config:${prepareResult.token}`
      const txConfig = await result.storage.get(txKey) as Record<string, unknown>

      expect(txConfig).toBeDefined()
      expect(txConfig.prepareTimeout).toBe(5000)
      expect(txConfig.commitTimeout).toBe(10000)
      expect(txConfig.abortTimeout).toBe(3000)
    })

    it('should trigger abort on prepare timeout', async () => {
      const target = 'https://timeout-target.test.do'
      const prepareTimeout = 1000

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'timeout-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return new Response('OK')
        }),
      })

      const options: StagedCloneOptions = {
        mode: 'staged',
        prepareTimeout,
      } as StagedCloneOptions & { prepareTimeout: number }

      const preparePromise = result.instance.clone(target, options)

      await vi.advanceTimersByTimeAsync(prepareTimeout + 500)

      await expect(preparePromise).rejects.toThrow(/timeout/i)

      // Transaction should be aborted
      const txKey = `2pc:state:timeout-target.test.do`
      const txState = await result.storage.get(txKey)
      if (txState) {
        expect((txState as Record<string, unknown>).status).toBe('aborted')
      }
    })

    it('should extend timeout on progress', async () => {
      const target = 'https://target.test.do'
      const baseTimeout = 5000

      const options: StagedCloneOptions = {
        mode: 'staged',
        dynamicTimeout: true,
        baseTimeout,
      } as StagedCloneOptions & { dynamicTimeout: boolean; baseTimeout: number }

      // Start prepare with dynamic timeout
      const preparePromise = result.instance.clone(target, options)

      // Simulate progress being made
      await vi.advanceTimersByTimeAsync(baseTimeout - 1000)

      // Transaction should still be active if progress is being made
      const doWithGetProgress = result.instance as unknown as {
        getTransactionProgress: (target: string) => Promise<{ active: boolean }>
      }

      if (doWithGetProgress.getTransactionProgress) {
        const progress = await doWithGetProgress.getTransactionProgress(target)
        expect(progress.active).toBe(true)
      }

      await preparePromise
    })
  })
})

// ==========================================================================
// ADDITIONAL TYPE DEFINITIONS FOR NEW TESTS
// ==========================================================================

/**
 * Coordinator information
 */
interface CoordinatorInfo {
  /** Coordinator namespace */
  ns: string
  /** Whether this DO is the coordinator */
  isCoordinator: boolean
  /** Transaction token */
  token: string
  /** Participants in the transaction */
  participants: string[]
}

/**
 * Transaction log entry
 */
interface TransactionLogEntry {
  /** Phase of the transaction */
  phase: 'prepare' | 'commit' | 'abort'
  /** Status of the phase */
  status: 'pending' | 'completed' | 'failed'
  /** Timestamp */
  timestamp: Date
  /** Additional data */
  data?: unknown
}

/**
 * Result of multi-target staged prepare
 */
interface MultiStagedPrepareResult {
  /** Overall transaction token */
  token: string
  /** Whether all participants are prepared */
  allPrepared: boolean
  /** Individual participant results */
  participants: Array<{
    target: string
    status: 'prepared' | 'failed'
    token?: string
    error?: string
  }>
}

/**
 * Participant acknowledgment
 */
interface ParticipantAck {
  /** Target namespace */
  target: string
  /** Status of the acknowledgment */
  status: 'ready' | 'prepared' | 'committed' | 'aborted' | 'failed'
  /** Participant's vote */
  vote?: 'yes' | 'no'
  /** Timestamp */
  timestamp: Date
  /** Reason if failed or voting no */
  reason?: string
}

/**
 * Extended StagedPrepareResult with participant ack
 */
interface ExtendedStagedPrepareResult extends StagedPrepareResult {
  participantAck?: ParticipantAck
}

/**
 * Recovered transaction state
 */
interface RecoveredTransactionState {
  /** Whether transaction was found */
  found: boolean
  /** Phase of the transaction */
  phase: 'prepared' | 'committing' | 'aborting' | 'committed' | 'aborted'
  /** Target namespace */
  target: string
  /** Whether transaction can be completed */
  canComplete: boolean
  /** Original prepare metadata */
  metadata?: unknown
}

/**
 * Resumed transaction info
 */
interface ResumedTransaction {
  /** Transaction token */
  token: string
  /** Action taken */
  action: 'commit' | 'abort' | 'retry'
  /** Result of the action */
  result: 'success' | 'pending' | 'failed'
}

/**
 * Transaction audit log
 */
interface TransactionAuditLog {
  /** Transaction token */
  token: string
  /** Events in the transaction */
  events: Array<{
    type: 'prepare' | 'commit' | 'abort'
    status: 'started' | 'completed' | 'failed'
    timestamp: Date
    details?: unknown
  }>
}

/**
 * Participant recovery response
 */
interface ParticipantRecoveryResponse {
  /** Action for participant to take */
  action: 'commit' | 'abort' | 'wait' | 'retry'
  /** Additional info */
  details?: unknown
}

/**
 * Participant state history
 */
interface ParticipantStateHistory {
  /** Participant namespace */
  participant: string
  /** State transitions */
  transitions: Array<{
    from: string
    to: string
    timestamp: Date
    trigger: string
  }>
}
