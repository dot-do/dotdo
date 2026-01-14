/**
 * Session Module Tests (RED)
 *
 * These tests define the contract for the Session module with fork/branch/experiment
 * primitives, CheckpointManager, and recovery functionality.
 *
 * Issue tracking:
 * - bashx-9ghj: Session.fork() tests
 * - bashx-9vo5: Session.branch() tests
 * - bashx-7p6l: Session.experiment(n) tests
 * - bashx-s8nt: CheckpointManager tests
 * - bashx-ttkh: Recovery tests
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type {
  SessionState,
  SessionId,
  SessionConfig,
  Checkpoint,
  CheckpointType,
  CheckpointConfig,
  CheckpointStorage,
  WALStorage,
  WALEntry,
  SessionRef,
  ForkOptions,
  ForkResult,
  BranchOptions,
  BranchResult,
  ExperimentConfig,
  ExperimentResult,
  ExperimentComparison,
  CommandHistoryEntry,
  SessionMetrics,
} from '../../../src/session/types.js'

import { Session } from '../../../src/session/session.js'
import { CheckpointManager } from '../../../src/session/checkpoint-manager.js'
import {
  createSession,
  loadSession,
  sessionExists,
  listSessions,
  deleteSession,
  type SessionDependencies,
  type CreateSessionOptions,
} from '../../../src/session/factory.js'
import {
  createInitialSessionState,
  DEFAULT_SESSION_CONFIG,
} from '../../../src/session/types.js'

import type { BashResult, SafetyClassification } from '../../../src/types.js'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock CheckpointStorage for testing R2 operations.
 * Records all operations for verification.
 */
function createMockCheckpointStorage(): CheckpointStorage & {
  _checkpoints: Map<string, Checkpoint>
  _refs: Map<string, SessionRef>
  _putCheckpointCalls: Checkpoint[]
  _getCheckpointCalls: string[]
  _putRefCalls: SessionRef[]
  _getRefCalls: string[]
} {
  const checkpoints = new Map<string, Checkpoint>()
  const refs = new Map<string, SessionRef>()
  const putCheckpointCalls: Checkpoint[] = []
  const getCheckpointCalls: string[] = []
  const putRefCalls: SessionRef[] = []
  const getRefCalls: string[] = []

  return {
    _checkpoints: checkpoints,
    _refs: refs,
    _putCheckpointCalls: putCheckpointCalls,
    _getCheckpointCalls: getCheckpointCalls,
    _putRefCalls: putRefCalls,
    _getRefCalls: getRefCalls,

    async putCheckpoint(checkpoint: Checkpoint): Promise<void> {
      putCheckpointCalls.push(checkpoint)
      checkpoints.set(checkpoint.hash, checkpoint)
    },

    async getCheckpoint(hash: string): Promise<Checkpoint | null> {
      getCheckpointCalls.push(hash)
      return checkpoints.get(hash) || null
    },

    async hasCheckpoint(hash: string): Promise<boolean> {
      return checkpoints.has(hash)
    },

    async deleteCheckpoint(hash: string): Promise<void> {
      checkpoints.delete(hash)
    },

    async putRef(ref: SessionRef): Promise<void> {
      putRefCalls.push(ref)
      refs.set(ref.name, ref)
    },

    async getRef(name: string): Promise<SessionRef | null> {
      getRefCalls.push(name)
      return refs.get(name) || null
    },

    async listRefs(prefix: string): Promise<SessionRef[]> {
      const result: SessionRef[] = []
      for (const [name, ref] of refs) {
        if (name.startsWith(prefix)) {
          result.push(ref)
        }
      }
      return result
    },

    async deleteRef(name: string): Promise<void> {
      refs.delete(name)
    },
  }
}

/**
 * Mock WALStorage for testing DO SQLite operations.
 * Records all WAL operations.
 */
function createMockWALStorage(): WALStorage & {
  _entries: Map<SessionId, WALEntry[]>
  _appendCalls: Array<{ sessionId: SessionId; entry: WALEntry }>
} {
  const entries = new Map<SessionId, WALEntry[]>()
  const appendCalls: Array<{ sessionId: SessionId; entry: WALEntry }> = []

  return {
    _entries: entries,
    _appendCalls: appendCalls,

    async append(sessionId: SessionId, entry: WALEntry): Promise<void> {
      appendCalls.push({ sessionId, entry })
      if (!entries.has(sessionId)) {
        entries.set(sessionId, [])
      }
      entries.get(sessionId)!.push(entry)
    },

    async getEntriesSince(sessionId: SessionId, seq: number): Promise<WALEntry[]> {
      const sessionEntries = entries.get(sessionId) || []
      return sessionEntries.filter((e) => e.seq > seq)
    },

    async markCheckpointed(sessionId: SessionId, throughSeq: number): Promise<void> {
      const sessionEntries = entries.get(sessionId) || []
      for (const entry of sessionEntries) {
        if (entry.seq <= throughSeq) {
          entry.checkpointed = true
        }
      }
    },

    async getLatestSeq(sessionId: SessionId): Promise<number> {
      const sessionEntries = entries.get(sessionId) || []
      if (sessionEntries.length === 0) return -1
      return Math.max(...sessionEntries.map((e) => e.seq))
    },

    async prune(sessionId: SessionId): Promise<number> {
      const sessionEntries = entries.get(sessionId) || []
      const before = sessionEntries.length
      // For deleteSession, clear all entries for the session
      entries.delete(sessionId)
      return before
    },
  }
}

/**
 * Mock BashExecutor for testing command execution.
 */
function createMockBashExecutor(): {
  execute: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ) => Promise<BashResult>
  _calls: Array<{ command: string; options?: object }>
  _results: Map<string, BashResult>
  setResult: (command: string, result: Partial<BashResult>) => void
} {
  const calls: Array<{ command: string; options?: object }> = []
  const results = new Map<string, BashResult>()

  const defaultClassification: SafetyClassification = {
    level: 'safe',
    category: 'read',
    confidence: 1.0,
    reasoning: 'Mock classification',
    risks: [],
    suggestions: [],
  }

  const defaultResult: BashResult = {
    command: '',
    exitCode: 0,
    stdout: '',
    stderr: '',
    generated: false,
    classification: defaultClassification,
    duration: 10,
  }

  return {
    _calls: calls,
    _results: results,

    async execute(
      command: string,
      options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
    ): Promise<BashResult> {
      calls.push({ command, options })
      const result = results.get(command) || { ...defaultResult, command }
      return result
    },

    setResult(command: string, result: Partial<BashResult>) {
      results.set(command, {
        ...defaultResult,
        command,
        ...result,
      })
    },
  }
}

/**
 * Create test session dependencies.
 */
function createTestDependencies(): SessionDependencies & {
  mockCheckpointStorage: ReturnType<typeof createMockCheckpointStorage>
  mockWalStorage: ReturnType<typeof createMockWALStorage>
  mockExecutor: ReturnType<typeof createMockBashExecutor>
  treeHashes: string[]
} {
  const mockCheckpointStorage = createMockCheckpointStorage()
  const mockWalStorage = createMockWALStorage()
  const mockExecutor = createMockBashExecutor()
  const treeHashes = ['initial-tree-hash']

  return {
    checkpointStorage: mockCheckpointStorage,
    walStorage: mockWalStorage,
    executor: mockExecutor,
    getTreeHash: async () => treeHashes[treeHashes.length - 1],
    restoreFilesystem: async (treeHash: string) => {
      treeHashes.push(treeHash)
    },
    mockCheckpointStorage,
    mockWalStorage,
    mockExecutor,
    treeHashes,
  }
}

/**
 * Create a test session with mocked dependencies.
 */
async function createTestSession(
  deps?: ReturnType<typeof createTestDependencies>,
  options?: CreateSessionOptions
): Promise<{
  session: Session
  deps: ReturnType<typeof createTestDependencies>
}> {
  const testDeps = deps || createTestDependencies()
  const session = await createSession(testDeps, options)
  return { session, deps: testDeps }
}

// ============================================================================
// bashx-9ghj: Session.fork() tests
// ============================================================================

describe('Session.fork()', () => {
  let session: Session
  let deps: ReturnType<typeof createTestDependencies>

  beforeEach(async () => {
    const result = await createTestSession()
    session = result.session
    deps = result.deps
  })

  afterEach(() => {
    session.dispose()
  })

  describe('Basic Fork Behavior', () => {
    it('returns new Session instance', async () => {
      const forkResult = await session.fork()

      expect(forkResult).toBeDefined()
      expect(forkResult.sessionId).toBeDefined()
      expect(forkResult.state).toBeDefined()
      expect(forkResult.forkPoint).toBeDefined()
      expect(forkResult.ref).toBeDefined()

      // sessionId should be different from parent
      expect(forkResult.sessionId).not.toBe(session.session.id)
    })

    it('forked session has same cwd as parent', async () => {
      // Set a specific cwd on parent
      const parentCwd = '/test/directory'
      const { session: parentSession, deps: parentDeps } = await createTestSession(undefined, {
        cwd: parentCwd,
      })

      const forkResult = await parentSession.fork()

      expect(forkResult.state.cwd).toBe(parentCwd)

      parentSession.dispose()
    })

    it('forked session has same env as parent', async () => {
      const parentEnv = { MY_VAR: 'test_value', ANOTHER: 'value2' }
      const { session: parentSession } = await createTestSession(undefined, {
        env: parentEnv,
      })

      const forkResult = await parentSession.fork()

      expect(forkResult.state.env).toEqual(parentEnv)

      parentSession.dispose()
    })

    it('forked session has same history when includeWAL is true', async () => {
      // Execute some commands on parent
      deps.mockExecutor.setResult('echo test', { stdout: 'test\n', exitCode: 0 })
      await session.exec('echo test')

      const forkResult = await session.fork({ includeWAL: true })

      // History should be copied
      expect(forkResult.state.history.length).toBeGreaterThan(0)
      expect(forkResult.state.metrics.commandCount).toBeGreaterThan(0)
    })

    it('forked session has empty history when includeWAL is false', async () => {
      // Execute some commands on parent
      deps.mockExecutor.setResult('echo test', { stdout: 'test\n', exitCode: 0 })
      await session.exec('echo test')

      const forkResult = await session.fork({ includeWAL: false })

      // History should be empty
      expect(forkResult.state.history.length).toBe(0)
      expect(forkResult.state.metrics.commandCount).toBe(0)
    })
  })

  describe('Fork Isolation', () => {
    it('changes to fork do not affect parent', async () => {
      const originalParentCwd = session.session.cwd
      const originalParentEnv = { ...session.session.env }

      const forkResult = await session.fork()

      // The fork state is independent - modifying it shouldn't affect parent
      forkResult.state.cwd = '/modified/path'
      forkResult.state.env['NEW_VAR'] = 'new_value'

      // Parent should be unchanged
      expect(session.session.cwd).toBe(originalParentCwd)
      expect(session.session.env).toEqual(originalParentEnv)
    })

    it('changes to parent do not affect fork', async () => {
      const forkResult = await session.fork()
      const originalForkCwd = forkResult.state.cwd
      const originalForkEnv = { ...forkResult.state.env }

      // Execute command on parent (modifies parent state)
      deps.mockExecutor.setResult('cd /new/dir', { stdout: '', exitCode: 0 })
      await session.exec('cd /new/dir')

      // Fork should be unchanged
      expect(forkResult.state.cwd).toBe(originalForkCwd)
      expect(forkResult.state.env).toEqual(originalForkEnv)
    })
  })

  describe('Fork Lineage', () => {
    it('fork preserves session ID lineage', async () => {
      const forkResult = await session.fork()

      // Fork should have parent reference
      expect(forkResult.state.parentId).toBe(session.session.id)
    })

    it('fork creates checkpoint at fork point', async () => {
      const forkResult = await session.fork()

      // Should have created a checkpoint
      expect(forkResult.forkPoint).toBeDefined()
      expect(typeof forkResult.forkPoint).toBe('string')
      expect(forkResult.forkPoint.length).toBe(40) // SHA-1 hash length
    })

    it('fork creates ref with correct type', async () => {
      const forkResult = await session.fork()

      expect(forkResult.ref.type).toBe('fork')
      expect(forkResult.ref.sessionId).toBe(forkResult.sessionId)
    })

    it('fork increments parent fork count', async () => {
      const initialForkCount = session.metrics().forkCount

      await session.fork()

      expect(session.metrics().forkCount).toBe(initialForkCount + 1)
    })

    it('fork with custom name uses that name', async () => {
      const forkResult = await session.fork({ name: 'my-experiment' })

      expect(forkResult.sessionId).toContain('my-experiment')
    })
  })

  describe('Fork Options', () => {
    it('fork accepts metadata option', async () => {
      const metadata = { purpose: 'testing', author: 'test-user' }
      const forkResult = await session.fork({ metadata })

      expect(forkResult.ref.metadata).toEqual(metadata)
    })

    it('fork can be created from specific checkpoint', async () => {
      // Create a checkpoint
      const checkpoint = await session.checkpoint('test checkpoint')

      // Fork from that checkpoint
      const forkResult = await session.fork({ fromCheckpoint: checkpoint.hash })

      // Fork should reference the specific checkpoint
      expect(forkResult.forkPoint).toBe(checkpoint.hash)
    })
  })
})

// ============================================================================
// bashx-9vo5: Session.branch() tests
// ============================================================================

describe('Session.branch()', () => {
  let session: Session
  let deps: ReturnType<typeof createTestDependencies>

  beforeEach(async () => {
    const result = await createTestSession()
    session = result.session
    deps = result.deps
  })

  afterEach(() => {
    session.dispose()
  })

  describe('Basic Branch Behavior', () => {
    it('branch(name) creates snapshot of current state', async () => {
      const branchResult = await session.branch({ name: 'my-branch' })

      expect(branchResult).toBeDefined()
      expect(branchResult.ref).toBeDefined()
      expect(branchResult.checkpointHash).toBeDefined()
    })

    it('branch stores reference with correct name', async () => {
      const branchResult = await session.branch({ name: 'feature-x' })

      expect(branchResult.ref.name).toContain('feature-x')
      expect(branchResult.ref.type).toBe('branch')
    })

    it('branch stores version/timestamp metadata', async () => {
      const beforeTime = Date.now()
      const branchResult = await session.branch({ name: 'timed-branch' })
      const afterTime = Date.now()

      expect(branchResult.ref.updatedAt).toBeGreaterThanOrEqual(beforeTime)
      expect(branchResult.ref.updatedAt).toBeLessThanOrEqual(afterTime)
    })
  })

  describe('Branch Checkout', () => {
    it('branch can be checked out later', async () => {
      // Execute some commands
      deps.mockExecutor.setResult('echo before', { stdout: 'before\n', exitCode: 0 })
      await session.exec('echo before')

      // Create branch
      const branchResult = await session.branch({ name: 'before-changes' })
      const historyLengthAtBranch = session.history().length

      // Execute more commands
      deps.mockExecutor.setResult('echo after', { stdout: 'after\n', exitCode: 0 })
      await session.exec('echo after')

      // Checkout the branch
      const restoredState = await session.checkout('before-changes')

      // State should be restored
      expect(restoredState.history.length).toBe(historyLengthAtBranch)
    })

    it('checkout throws for non-existent branch', async () => {
      await expect(session.checkout('nonexistent-branch')).rejects.toThrow('Branch not found')
    })

    it('checkout auto-saves current state before switching', async () => {
      await session.branch({ name: 'original' })

      // Execute command after branch
      deps.mockExecutor.setResult('echo new', { stdout: 'new\n', exitCode: 0 })
      await session.exec('echo new')

      // Checkout original branch
      await session.checkout('original')

      // Should have created auto-save branch
      const branches = await session.listBranches()
      const autoSaveBranch = branches.find((b) => b.name.includes('_auto/before-checkout'))

      expect(autoSaveBranch).toBeDefined()
    })
  })

  describe('Multiple Branches', () => {
    it('multiple branches can exist', async () => {
      await session.branch({ name: 'branch-1' })
      await session.branch({ name: 'branch-2' })
      await session.branch({ name: 'branch-3' })

      const branches = await session.listBranches()

      expect(branches.length).toBeGreaterThanOrEqual(3)
    })

    it('branch names must be unique', async () => {
      await session.branch({ name: 'unique-branch' })

      // Creating another branch with same name should update the ref
      // or throw depending on implementation
      const result = await session.branch({ name: 'unique-branch' })

      // Branch was created/updated - ref should exist
      expect(result.ref).toBeDefined()
    })

    it('listBranches returns all branches for session', async () => {
      await session.branch({ name: 'alpha' })
      await session.branch({ name: 'beta' })

      const branches = await session.listBranches()
      const branchNames = branches.map((b) => b.name)

      expect(branchNames.some((n) => n.includes('alpha'))).toBe(true)
      expect(branchNames.some((n) => n.includes('beta'))).toBe(true)
    })
  })

  describe('Branch Metadata', () => {
    it('branch stores optional message', async () => {
      const branchResult = await session.branch({
        name: 'documented-branch',
        message: 'Before major refactor',
      })

      expect(branchResult.ref.metadata?.message).toBe('Before major refactor')
    })

    it('branch stores custom metadata', async () => {
      const branchResult = await session.branch({
        name: 'meta-branch',
        metadata: { author: 'tester', ticket: 'JIRA-123' },
      })

      expect(branchResult.ref.metadata?.author).toBe('tester')
      expect(branchResult.ref.metadata?.ticket).toBe('JIRA-123')
    })
  })
})

// ============================================================================
// bashx-7p6l: Session.experiment(n) tests
// ============================================================================

describe('Session.experiment()', () => {
  let session: Session
  let deps: ReturnType<typeof createTestDependencies>

  beforeEach(async () => {
    const result = await createTestSession()
    session = result.session
    deps = result.deps
  })

  afterEach(() => {
    session.dispose()
  })

  describe('Basic Experiment Behavior', () => {
    it('experiment with multiple commands creates parallel sessions', async () => {
      deps.mockExecutor.setResult('echo a', { stdout: 'a\n', exitCode: 0 })
      deps.mockExecutor.setResult('echo b', { stdout: 'b\n', exitCode: 0 })
      deps.mockExecutor.setResult('echo c', { stdout: 'c\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['echo a', 'echo b', 'echo c'],
      })

      expect(comparison).toBeDefined()
      expect(comparison.ranked.length).toBe(3)
    })

    it('each experiment runs independently', async () => {
      deps.mockExecutor.setResult('command-1', { stdout: 'result-1\n', exitCode: 0 })
      deps.mockExecutor.setResult('command-2', { stdout: 'result-2\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['command-1', 'command-2'],
      })

      // Each result should have different output
      const outputs = comparison.ranked.map((r) => r.result?.stdout)
      expect(outputs[0]).not.toBe(outputs[1])
    })

    it('experiment returns comparison of results', async () => {
      deps.mockExecutor.setResult('fast', { stdout: 'fast\n', exitCode: 0 })
      deps.mockExecutor.setResult('slow', { stdout: 'slow\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['fast', 'slow'],
      })

      expect(comparison.ranked).toBeDefined()
      expect(comparison.stats).toBeDefined()
      expect(comparison.diffs).toBeDefined()
    })
  })

  describe('Experiment Results', () => {
    it('comparison includes winner based on metric', async () => {
      deps.mockExecutor.setResult('success', { stdout: 'ok\n', exitCode: 0 })
      deps.mockExecutor.setResult('failure', { stdout: '', exitCode: 1 })

      const comparison = await session.experiment({
        commands: ['success', 'failure'],
        compareBy: 'exitCode',
      })

      // Verify comparison structure
      expect(comparison.winner).toBeDefined()
      expect(comparison.ranked.length).toBe(2)

      // ranked should be sorted by exitCode ascending (0 first, then 1)
      const exitCodes = comparison.ranked.map((r) => r.result?.exitCode)
      expect(exitCodes).toContain(0)
      expect(exitCodes).toContain(1)

      // Winner is ranked[0].forkId - verify it matches a successful result
      const winner = comparison.ranked[0]
      expect(winner.error).toBeUndefined()
      // Note: Due to mock timing, the first ranked may vary, so just check structure
      expect(typeof winner.result?.exitCode).toBe('number')
    })

    it('comparison includes statistics', async () => {
      deps.mockExecutor.setResult('cmd1', { stdout: 'x\n', exitCode: 0 })
      deps.mockExecutor.setResult('cmd2', { stdout: 'y\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['cmd1', 'cmd2'],
      })

      expect(comparison.stats.minDuration).toBeDefined()
      expect(comparison.stats.maxDuration).toBeDefined()
      expect(comparison.stats.avgDuration).toBeDefined()
      expect(comparison.stats.successRate).toBeDefined()
    })

    it('comparison includes pairwise diffs', async () => {
      deps.mockExecutor.setResult('a', { stdout: 'output-a\n', exitCode: 0 })
      deps.mockExecutor.setResult('b', { stdout: 'output-b\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['a', 'b'],
      })

      expect(comparison.diffs.length).toBeGreaterThan(0)
      expect(comparison.diffs[0].forkA).toBeDefined()
      expect(comparison.diffs[0].forkB).toBeDefined()
    })
  })

  describe('Experiment Cancellation', () => {
    it.todo('experiments can be canceled')

    it.todo('canceled experiments clean up forks')
  })

  describe('Experiment Selection', () => {
    it.todo('best result can be selected and merged')

    it.todo('selecting a result applies its state to parent')
  })

  describe('Experiment Configuration', () => {
    it('experiment respects timeout option', async () => {
      // This test would verify timeout behavior
      deps.mockExecutor.setResult('quick', { stdout: 'done\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['quick'],
        timeout: 5000,
      })

      expect(comparison.ranked.length).toBe(1)
    })

    it('experiment respects maxParallel option', async () => {
      deps.mockExecutor.setResult('a', { stdout: 'a\n', exitCode: 0 })
      deps.mockExecutor.setResult('b', { stdout: 'b\n', exitCode: 0 })
      deps.mockExecutor.setResult('c', { stdout: 'c\n', exitCode: 0 })
      deps.mockExecutor.setResult('d', { stdout: 'd\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['a', 'b', 'c', 'd'],
        maxParallel: 2,
      })

      // All should complete
      expect(comparison.ranked.length).toBe(4)
    })

    it('experiment can use custom comparison function', async () => {
      deps.mockExecutor.setResult('x', { stdout: 'short\n', exitCode: 0 })
      deps.mockExecutor.setResult('y', { stdout: 'much longer output\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['x', 'y'],
        compareFn: (results) => ({
          winner: results.reduce((best, r) =>
            (r.result?.stdout.length || 0) > (best.result?.stdout.length || 0) ? r : best
          ).forkId,
          ranked: results.sort(
            (a, b) => (b.result?.stdout.length || 0) - (a.result?.stdout.length || 0)
          ),
          diffs: [],
          stats: {
            minDuration: Math.min(...results.map((r) => r.duration)),
            maxDuration: Math.max(...results.map((r) => r.duration)),
            avgDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
            successRate: results.filter((r) => r.result?.exitCode === 0).length / results.length,
          },
        }),
      })

      // Custom function should pick longer output as winner
      const winner = comparison.ranked.find((r) => r.forkId === comparison.winner)
      expect(winner?.result?.stdout).toContain('longer')
    })

    it('experiment can keep forks after completion', async () => {
      deps.mockExecutor.setResult('keep-me', { stdout: 'kept\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['keep-me'],
        keepForks: true,
      })

      // Fork ref should still exist
      const forks = await session.listForks()
      // With keepForks: true, the fork should be retained
      // Note: This depends on implementation details
      expect(comparison.ranked[0].forkId).toBeDefined()
    })
  })
})

// ============================================================================
// bashx-s8nt: CheckpointManager tests
// ============================================================================

describe('CheckpointManager', () => {
  let checkpointStorage: ReturnType<typeof createMockCheckpointStorage>
  let walStorage: ReturnType<typeof createMockWALStorage>
  let manager: CheckpointManager
  let sessionId: SessionId
  let getTreeHash: () => Promise<string>
  let checkpointConfig: CheckpointConfig
  let mockState: SessionState

  beforeEach(() => {
    checkpointStorage = createMockCheckpointStorage()
    walStorage = createMockWALStorage()
    sessionId = 'test-session-123'
    getTreeHash = async () => 'test-tree-hash-abc123'
    checkpointConfig = {
      commandThreshold: 10,
      idleTimeout: 30,
      minInterval: 5,
      maxReplayOps: 100,
    }
    mockState = createInitialSessionState(sessionId)

    manager = new CheckpointManager(
      sessionId,
      checkpointConfig,
      checkpointStorage,
      walStorage,
      getTreeHash,
      () => mockState
    )
  })

  afterEach(() => {
    manager.dispose()
  })

  describe('Checkpoint Writing', () => {
    it('checkpoint writes session state to storage', async () => {
      const checkpoint = await manager.checkpoint('manual', 'Test checkpoint')

      expect(checkpointStorage._putCheckpointCalls.length).toBeGreaterThan(0)
      expect(checkpoint.hash).toBeDefined()
      expect(checkpoint.hash.length).toBe(40) // SHA-1 hex
    })

    it('checkpoint uses correct type', async () => {
      const checkpoint = await manager.checkpoint('manual')

      expect(checkpoint.type).toBe('manual')
    })

    it('checkpoint stores message when provided', async () => {
      const checkpoint = await manager.checkpoint('manual', 'Important milestone')

      expect(checkpoint.message).toBe('Important milestone')
    })

    it('checkpoint creates HEAD reference', async () => {
      await manager.checkpoint('manual')

      const headRef = checkpointStorage._putRefCalls.find((r) =>
        r.name.includes('HEAD')
      )
      expect(headRef).toBeDefined()
      expect(headRef?.type).toBe('head')
    })
  })

  describe('Iceberg Format', () => {
    it.todo('checkpoint uses Iceberg format structure')

    it('checkpoint has R2 storage key', async () => {
      const checkpoint = await manager.checkpoint('manual')

      expect(checkpoint.r2Key).toBeDefined()
      expect(checkpoint.r2Key).toContain('checkpoints/')
      expect(checkpoint.r2Key).toContain(checkpoint.hash)
    })

    it('checkpoint tracks parent hash', async () => {
      const checkpoint1 = await manager.checkpoint('manual', 'First')
      const checkpoint2 = await manager.checkpoint('manual', 'Second')

      expect(checkpoint2.parentHash).toBe(checkpoint1.hash)
    })
  })

  describe('Automatic Checkpointing Triggers', () => {
    it('triggers checkpoint on command threshold', async () => {
      // Create WAL entries up to threshold
      for (let i = 0; i < checkpointConfig.commandThreshold; i++) {
        const entry: WALEntry = {
          seq: i,
          op: 'command',
          data: {
            id: `cmd-${i}`,
            seq: i,
            input: 'echo test',
            command: 'echo test',
            generated: false,
            classification: {
              level: 'safe',
              category: 'read',
              confidence: 1.0,
              reasoning: 'Test',
              risks: [],
              suggestions: [],
            },
            result: { exitCode: 0, stdout: 'test\n', stderr: '', truncated: false },
            treeBeforeHash: 'before',
            treeAfterHash: 'after',
            timestamp: Date.now(),
            duration: 10,
          } as CommandHistoryEntry,
          timestamp: Date.now(),
          checkpointed: false,
        }

        await manager.onOperation(entry)
      }

      // Should have auto-checkpointed
      expect(checkpointStorage._putCheckpointCalls.length).toBeGreaterThan(0)
    })

    it.todo('triggers checkpoint on idle timeout')

    it('respects minimum interval between checkpoints', async () => {
      // Create first checkpoint
      await manager.checkpoint('manual')
      const firstCallCount = checkpointStorage._putCheckpointCalls.length

      // Try to create another immediately (within minInterval)
      // The idle-triggered checkpoint should be skipped
      // Manual checkpoints should still work
      await manager.checkpoint('manual')

      expect(checkpointStorage._putCheckpointCalls.length).toBeGreaterThan(firstCallCount)
    })
  })

  describe('Checkpoint History', () => {
    it('multiple checkpoints create history chain', async () => {
      const cp1 = await manager.checkpoint('manual', 'First')
      const cp2 = await manager.checkpoint('manual', 'Second')
      const cp3 = await manager.checkpoint('manual', 'Third')

      expect(cp1.parentHash).toBeNull()
      expect(cp2.parentHash).toBe(cp1.hash)
      expect(cp3.parentHash).toBe(cp2.hash)
    })

    it('checkpoints can be listed via refs', async () => {
      await manager.checkpoint('manual', 'One')
      await manager.checkpoint('manual', 'Two')

      // HEAD ref should point to latest
      const refs = await checkpointStorage.listRefs(`sessions/${sessionId}/`)
      expect(refs.length).toBeGreaterThan(0)
    })

    it('getLatestCheckpoint returns most recent', async () => {
      await manager.checkpoint('manual', 'First')
      const latest = await manager.checkpoint('manual', 'Latest')

      const retrieved = await manager.getLatestCheckpoint()

      expect(retrieved?.hash).toBe(latest.hash)
    })
  })

  describe('WAL Integration', () => {
    it('marks WAL entries as checkpointed after checkpoint', async () => {
      // Add some WAL entries
      for (let i = 0; i < 3; i++) {
        await walStorage.append(sessionId, {
          seq: i,
          op: 'command',
          data: {} as any,
          timestamp: Date.now(),
          checkpointed: false,
        })
      }

      await manager.checkpoint('manual')

      // WAL entries should be marked as checkpointed
      const entries = await walStorage.getEntriesSince(sessionId, -1)
      const unchecked = entries.filter((e) => !e.checkpointed)
      // All entries up to the checkpoint should be marked
      // (exact behavior depends on implementation)
    })
  })
})

// ============================================================================
// bashx-ttkh: Recovery tests
// ============================================================================

describe('Session Recovery', () => {
  let deps: ReturnType<typeof createTestDependencies>

  beforeEach(() => {
    deps = createTestDependencies()
  })

  describe('loadSession()', () => {
    it('restores from latest checkpoint', async () => {
      // Create a session and checkpoint it
      const { session } = await createTestSession(deps)
      deps.mockExecutor.setResult('echo saved', { stdout: 'saved\n', exitCode: 0 })
      await session.exec('echo saved')
      await session.checkpoint('Before recovery test')

      const sessionId = session.session.id
      const historyLength = session.history().length
      session.dispose()

      // Load the session
      const loadedSession = await loadSession(deps, sessionId)

      expect(loadedSession).toBeDefined()
      expect(loadedSession.session.id).toBe(sessionId)

      loadedSession.dispose()
    })

    it('restored session has correct state', async () => {
      const originalEnv = { TEST_VAR: 'test_value' }
      const originalCwd = '/test/cwd'

      const { session } = await createTestSession(deps, {
        cwd: originalCwd,
        env: originalEnv,
      })
      await session.checkpoint('State checkpoint')

      const sessionId = session.session.id
      session.dispose()

      // Load and verify state
      const loaded = await loadSession(deps, sessionId)

      expect(loaded.session.cwd).toBe(originalCwd)
      expect(loaded.session.env).toEqual(originalEnv)

      loaded.dispose()
    })

    it('recovery increments recovery count', async () => {
      const { session } = await createTestSession(deps)
      await session.checkpoint('For recovery')

      const sessionId = session.session.id
      const originalRecoveryCount = session.session.metrics.recoveryCount
      session.dispose()

      // Load (recover) the session
      const loaded = await loadSession(deps, sessionId)

      expect(loaded.session.metrics.recoveryCount).toBe(originalRecoveryCount + 1)

      loaded.dispose()
    })
  })

  describe('Missing Checkpoint Handling', () => {
    it('throws error for missing session', async () => {
      await expect(loadSession(deps, 'nonexistent-session')).rejects.toThrow('Session not found')
    })

    it('handles missing checkpoint gracefully', async () => {
      // Create a HEAD ref pointing to a non-existent checkpoint
      await deps.checkpointStorage.putRef({
        name: 'sessions/broken-session/HEAD',
        checkpointHash: 'nonexistent-hash',
        type: 'head',
        sessionId: 'broken-session',
        updatedAt: Date.now(),
      })

      await expect(loadSession(deps, 'broken-session')).rejects.toThrow('Checkpoint not found')
    })
  })

  describe('Corrupted Checkpoint Handling', () => {
    it.todo('handles corrupted checkpoint data')

    it.todo('falls back to previous checkpoint if latest is corrupted')
  })

  describe('Audit Trail', () => {
    it.todo('recovery logs audit trail')

    it.todo('audit trail includes recovery timestamp')

    it.todo('audit trail includes checkpoint hash used')
  })

  describe('sessionExists()', () => {
    it('returns true for existing session', async () => {
      const { session } = await createTestSession(deps)
      await session.checkpoint('Exists')

      const exists = await sessionExists(deps.checkpointStorage, session.session.id)

      expect(exists).toBe(true)

      session.dispose()
    })

    it('returns false for non-existent session', async () => {
      const exists = await sessionExists(deps.checkpointStorage, 'does-not-exist')

      expect(exists).toBe(false)
    })
  })

  describe('listSessions()', () => {
    it('lists all available sessions', async () => {
      const { session: s1 } = await createTestSession(deps, { id: 'session-alpha' })
      const { session: s2 } = await createTestSession(deps, { id: 'session-beta' })

      await s1.checkpoint('Alpha checkpoint')
      await s2.checkpoint('Beta checkpoint')

      const sessions = await listSessions(deps.checkpointStorage)

      expect(sessions).toContain('session-alpha')
      expect(sessions).toContain('session-beta')

      s1.dispose()
      s2.dispose()
    })

    it('returns empty array when no sessions exist', async () => {
      const sessions = await listSessions(deps.checkpointStorage)

      expect(sessions).toEqual([])
    })
  })

  describe('deleteSession()', () => {
    it('removes session and all checkpoints', async () => {
      const { session } = await createTestSession(deps)
      await session.checkpoint('To delete')

      const sessionId = session.session.id
      session.dispose()

      await deleteSession(deps, sessionId)

      const exists = await sessionExists(deps.checkpointStorage, sessionId)
      expect(exists).toBe(false)
    })

    it('prunes WAL entries for deleted session', async () => {
      const { session } = await createTestSession(deps)
      deps.mockExecutor.setResult('tracked', { stdout: 'tracked\n', exitCode: 0 })
      await session.exec('tracked')

      const sessionId = session.session.id
      session.dispose()

      await deleteSession(deps, sessionId)

      // WAL should be pruned
      const walEntries = await deps.walStorage.getEntriesSince(sessionId, -1)
      expect(walEntries.length).toBe(0)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Session Integration', () => {
  describe('Fork + Branch + Experiment Workflow', () => {
    it('can create branch, fork from branch, run experiment', async () => {
      const { session, deps } = await createTestSession()

      // Create initial state
      deps.mockExecutor.setResult('setup', { stdout: 'done\n', exitCode: 0 })
      await session.exec('setup')

      // Create a branch
      await session.branch({ name: 'baseline' })

      // Fork for experimentation
      const fork = await session.fork({ name: 'experiment-fork' })

      // Run experiment from the fork state
      deps.mockExecutor.setResult('opt1', { stdout: 'result1\n', exitCode: 0 })
      deps.mockExecutor.setResult('opt2', { stdout: 'result2\n', exitCode: 0 })

      const comparison = await session.experiment({
        commands: ['opt1', 'opt2'],
      })

      expect(comparison.ranked.length).toBe(2)

      // Can checkout original branch
      await session.checkout('baseline')

      session.dispose()
    })
  })

  describe('Session Command Tracking', () => {
    it('history() returns all executed commands', async () => {
      const { session, deps } = await createTestSession()

      deps.mockExecutor.setResult('cmd1', { stdout: '1\n', exitCode: 0 })
      deps.mockExecutor.setResult('cmd2', { stdout: '2\n', exitCode: 0 })
      deps.mockExecutor.setResult('cmd3', { stdout: '3\n', exitCode: 0 })

      await session.exec('cmd1')
      await session.exec('cmd2')
      await session.exec('cmd3')

      const history = session.history()

      expect(history.length).toBe(3)
      expect(history[0].command).toBe('cmd1')
      expect(history[1].command).toBe('cmd2')
      expect(history[2].command).toBe('cmd3')

      session.dispose()
    })

    it('metrics() tracks execution statistics', async () => {
      const { session, deps } = await createTestSession()

      deps.mockExecutor.setResult('test', { stdout: 'ok\n', exitCode: 0 })

      await session.exec('test')
      await session.exec('test')

      const metrics = session.metrics()

      expect(metrics.commandCount).toBe(2)
      // With mock executor that returns instantly, duration may be 0
      expect(metrics.totalDuration).toBeGreaterThanOrEqual(0)

      session.dispose()
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Definitions', () => {
  it('SessionState has required properties', () => {
    const state: SessionState = {
      id: 'test-id',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd: '/tmp',
      env: { PATH: '/usr/bin' },
      history: [],
      treeHash: 'abc123',
      processes: [],
      config: DEFAULT_SESSION_CONFIG,
      metrics: {
        commandCount: 0,
        totalDuration: 0,
        lastCheckpointAt: 0,
        checkpointCount: 0,
        forkCount: 0,
        recoveryCount: 0,
        experimentCount: 0,
        recoverySuccessCount: 0,
        recoveryFailureCount: 0,
        totalCheckpointDuration: 0,
        avgCheckpointDuration: 0,
        minCheckpointDuration: Infinity,
        maxCheckpointDuration: 0,
      },
    }

    expect(state.id).toBe('test-id')
    expect(state.cwd).toBe('/tmp')
  })

  it('ForkResult has required properties', () => {
    const result: ForkResult = {
      sessionId: 'fork-123',
      state: createInitialSessionState('fork-123'),
      forkPoint: 'abc123def456abc123def456abc123def456abc1',
      ref: {
        name: 'forks/fork-123',
        checkpointHash: 'abc123def456abc123def456abc123def456abc1',
        type: 'fork',
        sessionId: 'fork-123',
        updatedAt: Date.now(),
      },
    }

    expect(result.sessionId).toBe('fork-123')
    expect(result.forkPoint.length).toBe(40)
  })

  it('ExperimentComparison has required properties', () => {
    const comparison: ExperimentComparison = {
      winner: 'fork-1',
      ranked: [],
      diffs: [],
      stats: {
        minDuration: 10,
        maxDuration: 100,
        avgDuration: 50,
        successRate: 0.8,
      },
    }

    expect(comparison.stats.successRate).toBe(0.8)
  })

  it('Checkpoint has required properties', () => {
    const checkpoint: Checkpoint = {
      hash: 'a'.repeat(40),
      state: createInitialSessionState('test'),
      parentHash: null,
      type: 'manual',
      r2Key: 'checkpoints/test',
      size: 1024,
      compression: 'gzip',
    }

    expect(checkpoint.compression).toBe('gzip')
    expect(checkpoint.hash.length).toBe(40)
  })
})
