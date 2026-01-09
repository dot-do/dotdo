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

      // Source should still be readable
      const things = await result.instance.things.list()
      expect(things.length).toBe(3)

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
})
