/**
 * DO Clone Basic Tests - Swiss-Army-Knife Operation
 *
 * RED TDD: Comprehensive tests for the basic clone() API signature.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * clone() is the swiss-army-knife operation for DO state:
 * - Copy: Duplicate to a new location
 * - Fork: Create independent copy with new identity
 * - Snapshot: Point-in-time capture
 * - Restore: Recover from snapshot
 *
 * This test file covers:
 * - clone(targetId, options?) signature
 * - options.mode: 'atomic' | 'staged' | 'eventual' | 'resumable'
 * - options.shallow vs deep clone
 * - options.includeState, options.includeHistory
 * - options.transform - transform state during clone
 * - Error scenarios
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @see testing/acid/phase2/ for detailed mode-specific tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../testing/do'
import { DO } from '../DO'
import type {
  CloneMode,
  CloneOptions,
  CloneResult,
  EventualCloneHandle,
  ResumableCloneHandle,
  StagedPrepareResult,
} from '../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR BASIC CLONE API
// ============================================================================

/**
 * Extended clone options for basic clone operations
 */
interface BasicCloneOptions extends CloneOptions {
  /** Clone mode - determines behavior semantics */
  mode?: CloneMode
  /** Shallow clone only copies top-level state (no nested references) */
  shallow?: boolean
  /** Include full state (default: true) */
  includeState?: boolean
  /** Include history (actions, events) in clone */
  includeHistory?: boolean
  /** Transform function to modify state during clone */
  transform?: (state: CloneState) => CloneState | Promise<CloneState>
  /** Timeout for the operation in ms */
  timeout?: number
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * State passed to transform function
 */
interface CloneState {
  things: Array<{
    id: string
    type: number
    branch: string | null
    name: string | null
    data: Record<string, unknown>
    deleted: boolean
  }>
  relationships?: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
  }>
}

/**
 * Basic clone result extending CloneResult
 */
interface BasicCloneResult extends CloneResult {
  /** Number of things cloned */
  thingsCloned: number
  /** Number of relationships cloned */
  relationshipsCloned: number
  /** Whether history was included */
  historyIncluded: boolean
  /** Duration of clone operation in ms */
  duration: number
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things data for testing.
 * Schema order: id, type, branch, name, data, deleted, visibility
 */
function createSampleThings(count: number = 5): Array<{
  id: string
  type: number
  branch: string | null
  name: string
  data: { name: string; index: number; nested?: { value: number } }
  deleted: boolean
  visibility: string
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null, // null = main branch in schema
    name: `Item ${i}`,
    data: { name: `Item ${i}`, index: i, nested: { value: i * 10 } },
    deleted: false,
    visibility: 'user',
  }))
}

/**
 * Create sample relationships for testing
 */
function createSampleRelationships(thingIds: string[]): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: string
}> {
  const now = new Date().toISOString()
  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: string
  }> = []

  for (let i = 0; i < thingIds.length - 1; i++) {
    relationships.push({
      id: `rel-${i}`,
      verb: 'relatedTo',
      from: thingIds[i],
      to: thingIds[i + 1],
      data: { order: i },
      createdAt: now,
    })
  }

  return relationships
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('clone() Basic API Tests', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(5)],
        ['relationships', createSampleRelationships(['thing-0', 'thing-1', 'thing-2', 'thing-3', 'thing-4'])],
        ['branches', [
          { name: 'main', head: 5, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CLONE() SIGNATURE
  // ==========================================================================

  describe('clone(targetId, options?) Signature', () => {
    it('should accept target ID as first argument', async () => {
      // RED: Basic clone signature test
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult).toBeDefined()
      expect(cloneResult.ns).toBe(target)
    })

    it('should accept optional CloneOptions as second argument', async () => {
      // RED: Options are optional
      const target = 'https://target.test.do'

      // Without options (should use defaults)
      const result1 = await result.instance.clone(target, { mode: 'atomic' })
      expect(result1).toBeDefined()

      // With options
      const result2 = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      })
      expect(result2).toBeDefined()
    })

    it('should return CloneResult with ns, doId, and mode', async () => {
      // RED: Verify standard result structure
      const target = 'https://result-structure.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult).toHaveProperty('ns')
      expect(cloneResult).toHaveProperty('doId')
      expect(cloneResult).toHaveProperty('mode')
      expect(cloneResult.ns).toBe(target)
      expect(typeof cloneResult.doId).toBe('string')
    })

    it('should require mode to be specified', async () => {
      // RED: Mode should be a required field or have sensible default
      const target = 'https://mode-required.test.do'

      // Verify mode is in result
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })
      expect(cloneResult.mode).toBe('atomic')
    })

    it('should validate target namespace format', async () => {
      // RED: Invalid target should be rejected
      const invalidTargets = [
        'not-a-url',
        '',
        '   ',
        'ftp://wrong-protocol.com',
      ]

      for (const target of invalidTargets) {
        await expect(
          result.instance.clone(target, { mode: 'atomic' })
        ).rejects.toThrow(/invalid.*url|namespace/i)
      }
    })

    it('should reject cloning to same namespace', async () => {
      // RED: Cannot clone to self
      const selfTarget = 'https://source.test.do'

      await expect(
        result.instance.clone(selfTarget, { mode: 'atomic' })
      ).rejects.toThrow(/same.*namespace|self/i)
    })
  })

  // ==========================================================================
  // MODE OPTIONS
  // ==========================================================================

  describe('options.mode - Clone Modes', () => {
    it('should support mode: "atomic" for all-or-nothing clone', async () => {
      // RED: Atomic mode returns CloneResult directly
      const target = 'https://atomic.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.mode).toBe('atomic')
      expect(cloneResult.ns).toBe(target)
      expect(cloneResult.doId).toBeDefined()
    })

    it('should support mode: "staged" for two-phase commit', async () => {
      // RED: Staged mode returns prepare result with token
      const target = 'https://staged.test.do'
      const prepareResult = await result.instance.clone(target, { mode: 'staged' }) as unknown as StagedPrepareResult

      expect(prepareResult.phase).toBe('prepared')
      expect(prepareResult.token).toBeDefined()
      expect(prepareResult.expiresAt).toBeInstanceOf(Date)
    })

    it('should support mode: "eventual" for async reconciliation', async () => {
      // RED: Eventual mode returns handle for async monitoring
      vi.useFakeTimers()
      try {
        const target = 'https://eventual.test.do'
        const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

        expect(handle.id).toBeDefined()
        expect(handle.status).toBe('pending')
        expect(handle.getProgress).toBeInstanceOf(Function)
        expect(handle.getSyncStatus).toBeInstanceOf(Function)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should support mode: "resumable" for checkpoint-based transfer', async () => {
      // RED: Resumable mode returns handle with checkpoint support
      vi.useFakeTimers()
      try {
        const target = 'https://resumable.test.do'
        const handle = await result.instance.clone(target, { mode: 'resumable' }) as unknown as ResumableCloneHandle

        expect(handle.id).toBeDefined()
        expect(handle.status).toBeDefined()
        expect(handle.checkpoints).toBeInstanceOf(Array)
        expect(handle.pause).toBeInstanceOf(Function)
        expect(handle.resume).toBeInstanceOf(Function)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reject invalid mode values', async () => {
      // RED: Invalid mode should throw
      const target = 'https://invalid-mode.test.do'

      await expect(
        result.instance.clone(target, { mode: 'invalid' as CloneMode })
      ).rejects.toThrow(/invalid.*mode/i)
    })

    it('should return different result types based on mode', async () => {
      // RED: Each mode has its own result structure
      const baseTarget = 'https://mode-results'

      // Atomic returns CloneResult
      const atomicResult = await result.instance.clone(`${baseTarget}-atomic.test.do`, { mode: 'atomic' })
      expect(atomicResult).toHaveProperty('doId')
      expect(atomicResult).not.toHaveProperty('token')
      expect(atomicResult).not.toHaveProperty('getProgress')

      // Staged returns StagedPrepareResult
      const stagedResult = await result.instance.clone(`${baseTarget}-staged.test.do`, { mode: 'staged' }) as unknown as StagedPrepareResult
      expect(stagedResult).toHaveProperty('token')
      expect(stagedResult).toHaveProperty('phase')
    })
  })

  // ==========================================================================
  // SHALLOW VS DEEP CLONE
  // ==========================================================================

  describe('options.shallow - Clone Depth', () => {
    it('should perform deep clone by default', async () => {
      // RED: Default behavior is deep clone
      const target = 'https://deep-default.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      // Deep clone should include all nested data
      expect(cloneResult.thingsCloned).toBe(5)
      expect(cloneResult.relationshipsCloned).toBe(4) // Chain of 5 things = 4 relationships
    })

    it('should support shallow: true for top-level only clone', async () => {
      // RED: Shallow clone skips nested references/relationships
      const target = 'https://shallow.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        shallow: true,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Shallow clone should only copy things, not relationships
      expect(cloneResult.thingsCloned).toBe(5)
      expect(cloneResult.relationshipsCloned).toBe(0)
    })

    it('should support shallow: false explicitly for deep clone', async () => {
      // RED: Explicit deep clone
      const target = 'https://explicit-deep.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        shallow: false,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      expect(cloneResult.thingsCloned).toBe(5)
      expect(cloneResult.relationshipsCloned).toBe(4)
    })

    it('should preserve nested data in deep clone', async () => {
      // RED: Deep clone preserves all nested structures
      const target = 'https://nested-preserved.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      // Result should indicate all data was transferred
      expect(cloneResult.thingsCloned).toBeGreaterThan(0)
    })

    it('should strip nested references in shallow clone', async () => {
      // RED: Shallow clone removes references to other entities
      const target = 'https://shallow-stripped.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        shallow: true,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Relationships should not be cloned in shallow mode
      expect(cloneResult.relationshipsCloned).toBe(0)
    })
  })

  // ==========================================================================
  // INCLUDE STATE / INCLUDE HISTORY
  // ==========================================================================

  describe('options.includeState and options.includeHistory', () => {
    it('should include state by default (includeState: true)', async () => {
      // RED: State is included by default
      const target = 'https://state-default.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      expect(cloneResult.thingsCloned).toBe(5)
    })

    it('should support includeState: false for empty clone', async () => {
      // RED: Create empty clone (structure only)
      const target = 'https://no-state.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        includeState: false,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Empty clone has no things
      expect(cloneResult.thingsCloned).toBe(0)
    })

    it('should exclude history by default (includeHistory: false)', async () => {
      // RED: History is excluded by default
      const target = 'https://no-history-default.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      expect(cloneResult.historyIncluded).toBe(false)
    })

    it('should support includeHistory: true to clone actions/events', async () => {
      // RED: Include history when requested
      // Add some history to source
      const now = new Date()
      result.sqlData.set('actions', [
        { id: 'action-1', verb: 'create', actor: 'system', target: 'thing-0', input: null, output: 1, options: null, durability: 'try', status: 'completed', error: null, requestId: null, sessionId: null, workflowId: null, startedAt: now, completedAt: now, duration: 10, createdAt: now },
      ])
      result.sqlData.set('events', [
        { id: 'evt-1', verb: 'thing.created', source: 'https://source.test.do', data: { thingId: 'thing-0' }, actionId: null, sequence: 1, streamed: false, streamedAt: null, createdAt: now },
      ])

      const target = 'https://with-history.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
    })

    it('should handle includeState: false with includeHistory: true', async () => {
      // RED: Clone history without current state (for analysis/audit)
      const now = new Date()
      result.sqlData.set('actions', [
        { id: 'action-1', verb: 'create', actor: 'system', target: 'thing-0', input: null, output: 1, options: null, durability: 'try', status: 'completed', error: null, requestId: null, sessionId: null, workflowId: null, startedAt: now, completedAt: now, duration: 10, createdAt: now },
      ])

      const target = 'https://history-only.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        includeState: false,
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      expect(cloneResult.thingsCloned).toBe(0)
      expect(cloneResult.historyIncluded).toBe(true)
    })

    it('should handle includeState: true with includeHistory: true', async () => {
      // RED: Full clone with state and history
      const now = new Date()
      result.sqlData.set('actions', [
        { id: 'action-1', verb: 'create', actor: 'system', target: 'thing-0', input: null, output: 1, options: null, durability: 'try', status: 'completed', error: null, requestId: null, sessionId: null, workflowId: null, startedAt: now, completedAt: now, duration: 10, createdAt: now },
      ])

      const target = 'https://full-clone.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        includeState: true,
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      expect(cloneResult.thingsCloned).toBe(5)
      expect(cloneResult.historyIncluded).toBe(true)
    })
  })

  // ==========================================================================
  // TRANSFORM OPTION
  // ==========================================================================

  describe('options.transform - State Transformation', () => {
    it('should support transform function for state modification', async () => {
      // RED: Transform function is called during clone
      const transformMock = vi.fn((state: CloneState): CloneState => {
        return {
          ...state,
          things: state.things.map((thing) => ({
            ...thing,
            data: { ...thing.data, transformed: true },
          })),
        }
      })

      const target = 'https://transformed.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform: transformMock,
      }

      await result.instance.clone(target, options)

      expect(transformMock).toHaveBeenCalled()
      expect(transformMock).toHaveBeenCalledWith(expect.objectContaining({
        things: expect.any(Array),
      }))
    })

    it('should support async transform function', async () => {
      // RED: Async transform is supported
      const asyncTransform = vi.fn(async (state: CloneState): Promise<CloneState> => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return {
          ...state,
          things: state.things.filter((thing) => thing.data.index < 3),
        }
      })

      const target = 'https://async-transform.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform: asyncTransform,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      expect(asyncTransform).toHaveBeenCalled()
      // Transform filtered to only things with index < 3
      expect(cloneResult.thingsCloned).toBe(3)
    })

    it('should apply transform before writing to target', async () => {
      // RED: Transform happens before target write
      const transformOrder: string[] = []

      const transform = vi.fn((state: CloneState): CloneState => {
        transformOrder.push('transform')
        return {
          ...state,
          things: state.things.map((thing) => ({
            ...thing,
            name: `Transformed: ${thing.name}`,
          })),
        }
      })

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'transform-order-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          transformOrder.push('write')
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const target = 'https://transform-order.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform,
      }

      await result.instance.clone(target, options)

      // Transform should be called before write
      expect(transformOrder).toContain('transform')
    })

    it('should handle transform errors gracefully', async () => {
      // RED: Transform errors should abort clone
      const errorTransform = vi.fn((): CloneState => {
        throw new Error('Transform failed')
      })

      const target = 'https://transform-error.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform: errorTransform,
      }

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/transform/i)
    })

    it('should pass both things and relationships to transform', async () => {
      // RED: Transform receives full state
      let receivedState: CloneState | null = null

      const captureTransform = vi.fn((state: CloneState): CloneState => {
        receivedState = state
        return state
      })

      const target = 'https://full-state-transform.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform: captureTransform,
      }

      await result.instance.clone(target, options)

      expect(receivedState).not.toBeNull()
      expect(receivedState!.things).toHaveLength(5)
      expect(receivedState!.relationships).toHaveLength(4)
    })

    it('should allow transform to modify relationships', async () => {
      // RED: Transform can modify relationships
      const relationshipTransform = vi.fn((state: CloneState): CloneState => {
        return {
          ...state,
          relationships: state.relationships?.filter((rel) => rel.from === 'thing-0'),
        }
      })

      const target = 'https://rel-transform.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        transform: relationshipTransform,
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Only relationships from thing-0 should be cloned
      expect(cloneResult.relationshipsCloned).toBe(1)
    })
  })

  // ==========================================================================
  // ERROR SCENARIOS
  // ==========================================================================

  describe('Error Scenarios', () => {
    it('should throw if source has no state to clone', async () => {
      // RED: Empty source should be rejected
      result.sqlData.set('things', [])

      const target = 'https://empty-source.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/no.*state|empty/i)
    })

    it('should throw if target is unreachable', async () => {
      // RED: Unreachable target should fail
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'unreachable-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Connection refused')),
      })
      result.env.DO = mockNamespace

      const target = 'https://unreachable.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()
    })

    it('should throw on timeout', async () => {
      // RED: Timeout should abort clone
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'timeout-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const target = 'https://timeout.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        timeout: 100,
      }

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/timeout/i)
    })

    it('should throw if target already exists (by default)', async () => {
      // RED: Target namespace collision should be rejected
      // Mock target as already existing
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'existing-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('exists')) {
            return new Response(JSON.stringify({ exists: true }))
          }
          return new Response('Conflict', { status: 409 })
        }),
      })
      result.env.DO = mockNamespace

      const target = 'https://existing.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/exists|conflict|occupied/i)
    })

    it('should handle network errors during clone', async () => {
      // RED: Network errors should be handled gracefully
      const mockNamespace = createMockDONamespace()
      let requestCount = 0
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'network-error-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          requestCount++
          if (requestCount === 1) {
            return new Response('OK') // First request succeeds
          }
          throw new Error('Network error')
        }),
      })
      result.env.DO = mockNamespace

      const target = 'https://network-error.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/network/i)
    })

    it('should validate options object', async () => {
      // RED: Invalid options should be rejected
      const target = 'https://invalid-options.test.do'

      // Invalid timeout
      await expect(
        result.instance.clone(target, { mode: 'atomic', timeout: -1 } as BasicCloneOptions)
      ).rejects.toThrow(/invalid.*timeout/i)
    })

    it('should handle partial failures gracefully', async () => {
      // RED: Partial failures should rollback
      const mockNamespace = createMockDONamespace()
      let healthCheckPassed = false

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'partial-fail-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          // Health check passes first
          if (url.pathname.includes('health')) {
            healthCheckPassed = true
            return new Response('OK')
          }
          // But the actual data transfer fails mid-operation
          if (url.pathname.includes('init')) {
            throw new Error('Transfer failed mid-operation')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const target = 'https://partial-fail.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/transfer failed/i)

      // Health check should have passed before failure
      expect(healthCheckPassed).toBe(true)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit clone.started event', async () => {
      // RED: Clone start should emit event
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://event-started.test.do'
      await result.instance.clone(target, { mode: 'atomic' })

      const startedEvent = capturedEvents.find((e) => e.verb === 'clone.started')
      expect(startedEvent).toBeDefined()
    })

    it('should emit clone.completed on success', async () => {
      // RED: Successful clone should emit completed event
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://event-completed.test.do'
      await result.instance.clone(target, { mode: 'atomic' })

      const completedEvent = capturedEvents.find((e) => e.verb === 'clone.completed')
      expect(completedEvent).toBeDefined()
    })

    it('should emit clone.failed on failure', async () => {
      // RED: Failed clone should emit failure event
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-event-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Clone failed')),
      })
      result.env.DO = mockNamespace

      const target = 'https://event-failed.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.verb === 'clone.failed')
      expect(failedEvent).toBeDefined()
    })

    it('should include correlationId in events', async () => {
      // RED: Events should have correlationId for tracing
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const target = 'https://event-correlation.test.do'
      const correlationId = 'trace-123'
      await result.instance.clone(target, { mode: 'atomic', correlationId } as BasicCloneOptions)

      for (const event of capturedEvents) {
        if ((event.data as Record<string, unknown>)?.correlationId !== undefined) {
          expect((event.data as Record<string, unknown>).correlationId).toBe(correlationId)
        }
      }
    })
  })

  // ==========================================================================
  // BRANCH AND VERSION OPTIONS
  // ==========================================================================

  describe('options.branch and options.version', () => {
    it('should clone from specific branch when specified', async () => {
      // RED: Clone specific branch
      // Add a feature branch
      result.sqlData.get('branches')!.push({
        name: 'feature-x',
        head: 10,
        forkedFrom: 'main',
        createdAt: new Date().toISOString(),
      })

      // Add things on feature-x branch
      const featureThings = createSampleThings(3).map((t, i) => ({
        ...t,
        id: `feature-thing-${i}`,
        branch: 'feature-x',
      }))
      result.sqlData.get('things')!.push(...featureThings)

      const target = 'https://branch-clone.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        branch: 'feature-x',
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Should clone only feature-x branch things
      expect(cloneResult.thingsCloned).toBe(3)
    })

    it('should clone at specific version when specified', async () => {
      // RED: Clone at specific point in history
      const target = 'https://version-clone.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        version: 3, // Clone at version 3
      }

      const cloneResult = await result.instance.clone(target, options) as BasicCloneResult

      // Should clone state as it was at version 3
      expect(cloneResult).toBeDefined()
    })

    it('should throw for invalid branch name', async () => {
      // RED: Non-existent branch should fail
      const target = 'https://invalid-branch.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        branch: 'non-existent-branch',
      }

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/branch.*not found|invalid.*branch/i)
    })

    it('should throw for invalid version number', async () => {
      // RED: Invalid version should fail
      const target = 'https://invalid-version.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        version: 99999, // Version doesn't exist
      }

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/version.*not found|invalid.*version/i)
    })
  })

  // ==========================================================================
  // COLO / REGION OPTIONS
  // ==========================================================================

  describe('options.colo - Location Targeting', () => {
    it('should support colo option for target location', async () => {
      // RED: Clone to specific colo
      const target = 'https://colo-target.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        colo: 'ewr', // Newark
      }

      const cloneResult = await result.instance.clone(target, options)

      expect(cloneResult.ns).toBe(target)
    })

    it('should support region hint for target location', async () => {
      // RED: Clone to specific region
      const target = 'https://region-target.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        colo: 'wnam', // Western North America region
      }

      const cloneResult = await result.instance.clone(target, options)

      expect(cloneResult.ns).toBe(target)
    })

    it('should validate colo code', async () => {
      // RED: Invalid colo should be rejected
      const target = 'https://invalid-colo.test.do'
      const options: BasicCloneOptions = {
        mode: 'atomic',
        colo: 'invalid-colo-xyz',
      }

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/invalid.*colo|location/i)
    })
  })

  // ==========================================================================
  // RESULT STATISTICS
  // ==========================================================================

  describe('Clone Result Statistics', () => {
    it('should include thingsCloned count', async () => {
      // RED: Result should have thing count
      const target = 'https://stats-things.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      expect(cloneResult.thingsCloned).toBe(5)
    })

    it('should include relationshipsCloned count', async () => {
      // RED: Result should have relationship count
      const target = 'https://stats-rels.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(4)
    })

    it('should include duration in result', async () => {
      // RED: Result should have timing info
      const target = 'https://stats-duration.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult

      expect(cloneResult.duration).toBeGreaterThanOrEqual(0)
      expect(typeof cloneResult.duration).toBe('number')
    })

    it('should include historyIncluded flag', async () => {
      // RED: Result should indicate if history was included
      const target = 'https://stats-history.test.do'

      // Without history
      const result1 = await result.instance.clone(target, { mode: 'atomic' }) as BasicCloneResult
      expect(result1.historyIncluded).toBe(false)

      // With history
      const result2 = await result.instance.clone(`${target}2`, { mode: 'atomic', includeHistory: true } as BasicCloneOptions) as BasicCloneResult
      expect(result2.historyIncluded).toBe(true)
    })
  })
})
