import { describe, it, expect, vi } from 'vitest'

/**
 * State Machine Schema Tests
 *
 * These tests verify the $state directive integration for entity state machines.
 * State machines enable declarative workflow state management within schemas.
 *
 * This is RED phase TDD - tests should FAIL until the state machine module
 * is properly implemented in db/schema/state-machine/machine.ts.
 *
 * Key design principles:
 * - $initial: Required starting state
 * - State names as object keys
 * - Transitions defined as values (string, object, or null)
 * - Entry/exit actions via $entry/$exit hooks
 * - Guard conditions prevent invalid transitions
 * - State history for auditing
 */

// These imports should FAIL until implemented
// @ts-expect-error - StateMachine class not yet implemented
import { StateMachine } from '../state-machine/machine'

// @ts-expect-error - Types not yet implemented
import type {
  StateConfig,
  StateDefinition,
  TransitionDefinition,
  TransitionResult,
  GuardFunction,
  ActionFunction,
  StateHistory,
} from '../state-machine/machine'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface Entity {
  id: string
  $state?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

interface OrderEntity extends Entity {
  total: number
  paymentMethod?: string
  items: Array<{ sku: string; qty: number }>
}

interface TicketEntity extends Entity {
  priority: 'low' | 'medium' | 'high'
  assignee?: string
  resolution?: string
}

// ============================================================================
// State Definition Tests
// ============================================================================

describe('State Definition', () => {
  describe('$initial: Starting State', () => {
    it('requires $initial to define starting state', () => {
      const config = {
        $initial: 'draft',
        draft: {
          submit: 'pending',
        },
        pending: {
          approve: 'approved',
        },
        approved: {},
      }

      expect(config.$initial).toBe('draft')
    })

    it('StateMachine constructor validates $initial exists', () => {
      const invalidConfig = {
        // Missing $initial
        draft: { submit: 'pending' },
      }

      // @ts-expect-error - Testing runtime validation
      expect(() => new StateMachine(invalidConfig)).toThrow(/\$initial.*required/)
    })

    it('StateMachine constructor validates $initial references valid state', () => {
      const invalidConfig = {
        $initial: 'nonexistent', // References non-existent state
        draft: { submit: 'pending' },
      }

      expect(() => new StateMachine(invalidConfig)).toThrow(/invalid.*initial.*state/i)
    })

    it('new entity starts in $initial state', async () => {
      const config = {
        $initial: 'created',
        created: { activate: 'active' },
        active: { deactivate: 'inactive' },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'entity-001' }

      const initialized = await machine.initialize(entity)

      expect(initialized.$state).toBe('created')
    })

    it('entity with existing $state is not reinitialized', async () => {
      const config = {
        $initial: 'created',
        created: { activate: 'active' },
        active: { deactivate: 'inactive' },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'entity-001', $state: 'active' }

      const result = await machine.initialize(entity)

      expect(result.$state).toBe('active')
    })
  })

  describe('State Names as Keys', () => {
    it('each state is a key in the config object', () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: { stop: 'stopped', pause: 'paused' },
        paused: { resume: 'running', stop: 'stopped' },
        stopped: {},
      }

      const stateNames = Object.keys(config).filter((k) => !k.startsWith('$'))

      expect(stateNames).toContain('idle')
      expect(stateNames).toContain('running')
      expect(stateNames).toContain('paused')
      expect(stateNames).toContain('stopped')
    })

    it('state names are case-sensitive', () => {
      const config = {
        $initial: 'Draft',
        Draft: { submit: 'Pending' },
        Pending: { approve: 'Approved' },
        Approved: {},
      }

      const machine = new StateMachine(config)
      const states = machine.getStates()

      expect(states).toContain('Draft')
      expect(states).not.toContain('draft')
    })

    it('state names can use any valid identifier', () => {
      const config = {
        $initial: 'state_with_underscores',
        state_with_underscores: { next: 'stateWithCamelCase' },
        stateWithCamelCase: { next: 'SCREAMING_SNAKE' },
        SCREAMING_SNAKE: { next: 'kebab-state' },
        'kebab-state': {},
      }

      const machine = new StateMachine(config)
      const states = machine.getStates()

      expect(states).toHaveLength(4)
    })

    it('$ prefixed keys are reserved for directives', () => {
      const config = {
        $initial: 'start',
        $timeout: 30000, // Directive, not a state
        $retryPolicy: { maxRetries: 3 }, // Directive, not a state
        start: { proceed: 'end' },
        end: {},
      }

      const machine = new StateMachine(config)
      const states = machine.getStates()

      expect(states).not.toContain('$initial')
      expect(states).not.toContain('$timeout')
      expect(states).not.toContain('$retryPolicy')
      expect(states).toEqual(['start', 'end'])
    })
  })

  describe('Transitions as Values', () => {
    it('state value is object mapping events to transitions', () => {
      const config = {
        $initial: 'draft',
        draft: {
          submit: 'review',
          archive: 'archived',
        },
        review: {
          approve: 'published',
          reject: 'draft',
        },
        published: {},
        archived: {},
      }

      expect(config.draft.submit).toBe('review')
      expect(config.draft.archive).toBe('archived')
      expect(config.review.approve).toBe('published')
      expect(config.review.reject).toBe('draft')
    })

    it('empty object means terminal state (no transitions)', () => {
      const config = {
        $initial: 'active',
        active: { complete: 'completed' },
        completed: {}, // Terminal state
      }

      const machine = new StateMachine(config)
      const transitions = machine.getTransitions('completed')

      expect(transitions).toEqual([])
    })

    it('getTransitions returns available event names for a state', () => {
      const config = {
        $initial: 'new',
        new: {
          start: 'in_progress',
          cancel: 'cancelled',
          defer: 'deferred',
        },
        in_progress: { complete: 'done' },
        cancelled: {},
        deferred: { resume: 'new' },
        done: {},
      }

      const machine = new StateMachine(config)
      const newTransitions = machine.getTransitions('new')

      expect(newTransitions).toContain('start')
      expect(newTransitions).toContain('cancel')
      expect(newTransitions).toContain('defer')
      expect(newTransitions).toHaveLength(3)
    })
  })
})

// ============================================================================
// Transition Types Tests
// ============================================================================

describe('Transition Types', () => {
  describe('Simple Transitions: event: "nextState"', () => {
    it('string value is target state name', async () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: { stop: 'idle' },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      const result = await machine.transition(entity, 'start')

      expect(result.$state).toBe('running')
    })

    it('multiple simple transitions from same state', async () => {
      const config = {
        $initial: 'pending',
        pending: {
          approve: 'approved',
          reject: 'rejected',
          escalate: 'escalated',
        },
        approved: {},
        rejected: {},
        escalated: { resolve: 'approved' },
      }

      const machine = new StateMachine(config)

      const entity1: Entity = { id: 'e1', $state: 'pending' }
      const result1 = await machine.transition(entity1, 'approve')
      expect(result1.$state).toBe('approved')

      const entity2: Entity = { id: 'e2', $state: 'pending' }
      const result2 = await machine.transition(entity2, 'reject')
      expect(result2.$state).toBe('rejected')
    })

    it('transition to same state is valid (self-loop)', async () => {
      const config = {
        $initial: 'active',
        active: {
          refresh: 'active', // Self-loop
          deactivate: 'inactive',
        },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      const result = await machine.transition(entity, 'refresh')

      expect(result.$state).toBe('active')
    })

    it('throws error for undefined event', async () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await expect(machine.transition(entity, 'stop')).rejects.toThrow(/no transition.*stop/i)
    })

    it('throws error for invalid target state', () => {
      const invalidConfig = {
        $initial: 'start',
        start: { go: 'nonexistent' }, // Target doesn't exist
      }

      expect(() => new StateMachine(invalidConfig)).toThrow(/invalid.*target.*state/i)
    })
  })

  describe('Guarded Transitions: { to: "state", if: condition }', () => {
    it('guard function receives entity and context', async () => {
      const guardSpy = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: guardSpy,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: OrderEntity = {
        id: 'order-1',
        $state: 'pending',
        total: 100,
        items: [{ sku: 'ITEM-1', qty: 1 }],
      }

      await machine.transition(entity, 'approve')

      expect(guardSpy).toHaveBeenCalledWith(entity, expect.any(Object))
    })

    it('transition proceeds when guard returns true', async () => {
      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: (entity: OrderEntity) => entity.total > 0,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: OrderEntity = {
        id: 'order-1',
        $state: 'pending',
        total: 100,
        items: [],
      }

      const result = await machine.transition(entity, 'approve')

      expect(result.$state).toBe('approved')
    })

    it('transition blocked when guard returns false', async () => {
      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: (entity: OrderEntity) => entity.total > 0,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: OrderEntity = {
        id: 'order-1',
        $state: 'pending',
        total: 0, // Guard will fail
        items: [],
      }

      await expect(machine.transition(entity, 'approve')).rejects.toThrow(/guard.*failed/i)
    })

    it('async guard functions are supported', async () => {
      const asyncGuard = vi.fn().mockResolvedValue(true)

      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: asyncGuard,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      const result = await machine.transition(entity, 'approve')

      expect(asyncGuard).toHaveBeenCalled()
      expect(result.$state).toBe('approved')
    })

    it('guard can access entity data properties', async () => {
      const config = {
        $initial: 'open',
        open: {
          close: {
            to: 'closed',
            if: (entity: TicketEntity) => entity.resolution !== undefined,
          },
        },
        closed: {},
      }

      const machine = new StateMachine(config)

      // Without resolution - should fail
      const entity1: TicketEntity = {
        id: 't1',
        $state: 'open',
        priority: 'high',
      }
      await expect(machine.transition(entity1, 'close')).rejects.toThrow()

      // With resolution - should succeed
      const entity2: TicketEntity = {
        id: 't2',
        $state: 'open',
        priority: 'high',
        resolution: 'Fixed in v2.0',
      }
      const result = await machine.transition(entity2, 'close')
      expect(result.$state).toBe('closed')
    })
  })

  describe('Action Transitions: { to: "state", do: action }', () => {
    it('action function is called during transition', async () => {
      const actionSpy = vi.fn()

      const config = {
        $initial: 'pending',
        pending: {
          process: {
            to: 'processed',
            do: actionSpy,
          },
        },
        processed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await machine.transition(entity, 'process')

      expect(actionSpy).toHaveBeenCalled()
    })

    it('action receives entity and context', async () => {
      const actionSpy = vi.fn()

      const config = {
        $initial: 'idle',
        idle: {
          activate: {
            to: 'active',
            do: actionSpy,
          },
        },
        active: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await machine.transition(entity, 'activate')

      expect(actionSpy).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          event: 'activate',
          from: 'idle',
          to: 'active',
        })
      )
    })

    it('action can modify entity data', async () => {
      const config = {
        $initial: 'draft',
        draft: {
          publish: {
            to: 'published',
            do: (entity: Entity) => {
              entity.publishedAt = new Date().toISOString()
            },
          },
        },
        published: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'draft' }

      const result = await machine.transition(entity, 'publish')

      expect(result.publishedAt).toBeDefined()
      expect(result.$state).toBe('published')
    })

    it('async actions are supported', async () => {
      const asyncAction = vi.fn().mockResolvedValue(undefined)

      const config = {
        $initial: 'pending',
        pending: {
          process: {
            to: 'processed',
            do: asyncAction,
          },
        },
        processed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await machine.transition(entity, 'process')

      expect(asyncAction).toHaveBeenCalled()
    })

    it('action error prevents transition', async () => {
      const failingAction = vi.fn().mockRejectedValue(new Error('Action failed'))

      const config = {
        $initial: 'pending',
        pending: {
          process: {
            to: 'processed',
            do: failingAction,
          },
        },
        processed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await expect(machine.transition(entity, 'process')).rejects.toThrow('Action failed')
      expect(entity.$state).toBe('pending') // State unchanged
    })

    it('combined guard and action: guard runs first', async () => {
      const order: string[] = []

      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: () => {
              order.push('guard')
              return true
            },
            do: () => {
              order.push('action')
            },
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await machine.transition(entity, 'approve')

      expect(order).toEqual(['guard', 'action'])
    })

    it('action not called if guard fails', async () => {
      const actionSpy = vi.fn()

      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: () => false,
            do: actionSpy,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await expect(machine.transition(entity, 'approve')).rejects.toThrow()
      expect(actionSpy).not.toHaveBeenCalled()
    })
  })

  describe('Terminal Transitions: event: null', () => {
    it('null transition means event exits the state machine', async () => {
      const config = {
        $initial: 'active',
        active: {
          complete: null, // Terminal - exits machine
          cancel: 'cancelled',
        },
        cancelled: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      const result = await machine.transition(entity, 'complete')

      expect(result.$state).toBeNull()
      expect(result.$terminated).toBe(true)
    })

    it('terminated entity cannot transition further', async () => {
      const config = {
        $initial: 'active',
        active: {
          complete: null,
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await machine.transition(entity, 'complete')

      await expect(machine.transition(entity, 'complete')).rejects.toThrow(/terminated/i)
    })

    it('null transition can have guard', async () => {
      const config = {
        $initial: 'active',
        active: {
          complete: {
            to: null,
            if: (entity: Entity) => entity.data?.canComplete === true,
          },
        },
      }

      const machine = new StateMachine(config)

      const entity1: Entity = { id: 'e1', $state: 'active', data: { canComplete: false } }
      await expect(machine.transition(entity1, 'complete')).rejects.toThrow()

      const entity2: Entity = { id: 'e2', $state: 'active', data: { canComplete: true } }
      const result = await machine.transition(entity2, 'complete')
      expect(result.$state).toBeNull()
    })

    it('null transition can have action', async () => {
      const cleanupAction = vi.fn()

      const config = {
        $initial: 'active',
        active: {
          complete: {
            to: null,
            do: cleanupAction,
          },
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await machine.transition(entity, 'complete')

      expect(cleanupAction).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Entry/Exit Actions Tests
// ============================================================================

describe('Entry/Exit Actions', () => {
  describe('$entry: Called When Entering State', () => {
    it('$entry action is called when entering state', async () => {
      const entryAction = vi.fn()

      const config = {
        $initial: 'idle',
        idle: {
          start: 'running',
        },
        running: {
          $entry: entryAction,
          stop: 'idle',
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await machine.transition(entity, 'start')

      expect(entryAction).toHaveBeenCalled()
    })

    it('$entry receives entity and transition context', async () => {
      const entryAction = vi.fn()

      const config = {
        $initial: 'pending',
        pending: {
          approve: 'approved',
        },
        approved: {
          $entry: entryAction,
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      await machine.transition(entity, 'approve')

      expect(entryAction).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          event: 'approve',
          from: 'pending',
          to: 'approved',
        })
      )
    })

    it('$entry on initial state is called during initialize', async () => {
      const initialEntry = vi.fn()

      const config = {
        $initial: 'created',
        created: {
          $entry: initialEntry,
          activate: 'active',
        },
        active: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)

      expect(initialEntry).toHaveBeenCalled()
    })

    it('$entry can modify entity', async () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {
          $entry: (entity: Entity) => {
            entity.startedAt = Date.now()
          },
          stop: 'idle',
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      const result = await machine.transition(entity, 'start')

      expect(result.startedAt).toBeDefined()
    })

    it('$entry error rolls back transition', async () => {
      const failingEntry = vi.fn().mockRejectedValue(new Error('Entry failed'))

      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {
          $entry: failingEntry,
          stop: 'idle',
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await expect(machine.transition(entity, 'start')).rejects.toThrow('Entry failed')
      expect(entity.$state).toBe('idle') // Rolled back
    })
  })

  describe('$exit: Called When Leaving State', () => {
    it('$exit action is called when leaving state', async () => {
      const exitAction = vi.fn()

      const config = {
        $initial: 'idle',
        idle: {
          $exit: exitAction,
          start: 'running',
        },
        running: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await machine.transition(entity, 'start')

      expect(exitAction).toHaveBeenCalled()
    })

    it('$exit receives entity and transition context', async () => {
      const exitAction = vi.fn()

      const config = {
        $initial: 'active',
        active: {
          $exit: exitAction,
          deactivate: 'inactive',
        },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await machine.transition(entity, 'deactivate')

      expect(exitAction).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          event: 'deactivate',
          from: 'active',
          to: 'inactive',
        })
      )
    })

    it('$exit runs before $entry of new state', async () => {
      const order: string[] = []

      const config = {
        $initial: 'state1',
        state1: {
          $exit: () => order.push('exit-state1'),
          next: 'state2',
        },
        state2: {
          $entry: () => order.push('entry-state2'),
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'state1' }

      await machine.transition(entity, 'next')

      expect(order).toEqual(['exit-state1', 'entry-state2'])
    })

    it('$exit can perform cleanup', async () => {
      const config = {
        $initial: 'active',
        active: {
          $exit: (entity: Entity) => {
            entity.activeSession = null
            entity.exitedAt = Date.now()
          },
          deactivate: 'inactive',
        },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = {
        id: 'e1',
        $state: 'active',
        activeSession: 'session-123',
      }

      const result = await machine.transition(entity, 'deactivate')

      expect(result.activeSession).toBeNull()
      expect(result.exitedAt).toBeDefined()
    })

    it('$exit error prevents transition', async () => {
      const failingExit = vi.fn().mockRejectedValue(new Error('Exit failed'))

      const config = {
        $initial: 'active',
        active: {
          $exit: failingExit,
          deactivate: 'inactive',
        },
        inactive: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await expect(machine.transition(entity, 'deactivate')).rejects.toThrow('Exit failed')
      expect(entity.$state).toBe('active') // Not transitioned
    })
  })

  describe('Async Support', () => {
    it('async $entry is awaited', async () => {
      let completed = false

      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {
          $entry: async () => {
            await new Promise((r) => setTimeout(r, 10))
            completed = true
          },
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      await machine.transition(entity, 'start')

      expect(completed).toBe(true)
    })

    it('async $exit is awaited', async () => {
      let cleaned = false

      const config = {
        $initial: 'active',
        active: {
          $exit: async () => {
            await new Promise((r) => setTimeout(r, 10))
            cleaned = true
          },
          stop: 'stopped',
        },
        stopped: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await machine.transition(entity, 'stop')

      expect(cleaned).toBe(true)
    })

    it('execution order: guard -> exit -> action -> entry', async () => {
      const order: string[] = []

      const config = {
        $initial: 'state1',
        state1: {
          $exit: async () => {
            await new Promise((r) => setTimeout(r, 5))
            order.push('exit')
          },
          next: {
            to: 'state2',
            if: async () => {
              await new Promise((r) => setTimeout(r, 5))
              order.push('guard')
              return true
            },
            do: async () => {
              await new Promise((r) => setTimeout(r, 5))
              order.push('action')
            },
          },
        },
        state2: {
          $entry: async () => {
            await new Promise((r) => setTimeout(r, 5))
            order.push('entry')
          },
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'state1' }

      await machine.transition(entity, 'next')

      expect(order).toEqual(['guard', 'exit', 'action', 'entry'])
    })
  })
})

// ============================================================================
// State Queries Tests
// ============================================================================

describe('State Queries', () => {
  describe('Current State Access', () => {
    it('getCurrentState returns entity $state', () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'running' }

      expect(machine.getCurrentState(entity)).toBe('running')
    })

    it('getCurrentState returns $initial for uninitialized entity', () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' } // No $state set

      expect(machine.getCurrentState(entity)).toBe('idle')
    })

    it('isInState checks current state', () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: { stop: 'idle' },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'running' }

      expect(machine.isInState(entity, 'running')).toBe(true)
      expect(machine.isInState(entity, 'idle')).toBe(false)
    })

    it('isTerminated checks if entity exited machine', () => {
      const config = {
        $initial: 'active',
        active: { complete: null },
      }

      const machine = new StateMachine(config)

      const activeEntity: Entity = { id: 'e1', $state: 'active' }
      expect(machine.isTerminated(activeEntity)).toBe(false)

      const terminatedEntity: Entity = { id: 'e2', $state: null, $terminated: true }
      expect(machine.isTerminated(terminatedEntity)).toBe(true)
    })
  })

  describe('Available Transitions', () => {
    it('getAvailableTransitions returns events for current state', () => {
      const config = {
        $initial: 'pending',
        pending: {
          approve: 'approved',
          reject: 'rejected',
          escalate: 'escalated',
        },
        approved: {},
        rejected: {},
        escalated: { resolve: 'approved' },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      const transitions = machine.getAvailableTransitions(entity)

      expect(transitions).toContain('approve')
      expect(transitions).toContain('reject')
      expect(transitions).toContain('escalate')
      expect(transitions).toHaveLength(3)
    })

    it('canTransition checks if event is valid', async () => {
      const config = {
        $initial: 'idle',
        idle: { start: 'running' },
        running: { stop: 'idle' },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      expect(await machine.canTransition(entity, 'start')).toBe(true)
      expect(await machine.canTransition(entity, 'stop')).toBe(false)
    })

    it('canTransition evaluates guards without executing', async () => {
      const guardSpy = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: guardSpy,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      const canApprove = await machine.canTransition(entity, 'approve')

      expect(guardSpy).toHaveBeenCalled()
      expect(canApprove).toBe(true)
      expect(entity.$state).toBe('pending') // State unchanged
    })

    it('canTransition returns false when guard fails', async () => {
      const config = {
        $initial: 'pending',
        pending: {
          approve: {
            to: 'approved',
            if: () => false,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'pending' }

      expect(await machine.canTransition(entity, 'approve')).toBe(false)
    })

    it('returns empty for terminal state', () => {
      const config = {
        $initial: 'active',
        active: { complete: 'completed' },
        completed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'completed' }

      expect(machine.getAvailableTransitions(entity)).toEqual([])
    })
  })

  describe('State History', () => {
    it('trackHistory option enables history tracking', async () => {
      const config = {
        $initial: 'draft',
        $trackHistory: true,
        draft: { submit: 'review' },
        review: { approve: 'published', reject: 'draft' },
        published: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'submit')
      await machine.transition(entity, 'reject')
      await machine.transition(entity, 'submit')

      const history = machine.getHistory(entity)

      expect(history).toHaveLength(4)
    })

    it('history entries contain state, event, timestamp', async () => {
      const config = {
        $initial: 'idle',
        $trackHistory: true,
        idle: { start: 'running' },
        running: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'start')

      const history = machine.getHistory(entity)
      const lastEntry = history[history.length - 1]

      expect(lastEntry).toMatchObject({
        from: 'idle',
        to: 'running',
        event: 'start',
        timestamp: expect.any(Number),
      })
    })

    it('getPreviousState returns previous state from history', async () => {
      const config = {
        $initial: 'a',
        $trackHistory: true,
        a: { next: 'b' },
        b: { next: 'c' },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'next')
      await machine.transition(entity, 'next')

      expect(machine.getPreviousState(entity)).toBe('b')
    })

    it('getStateAt returns state at specific point in history', async () => {
      const config = {
        $initial: 'a',
        $trackHistory: true,
        a: { next: 'b' },
        b: { next: 'c' },
        c: { next: 'd' },
        d: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'next')
      await machine.transition(entity, 'next')
      await machine.transition(entity, 'next')

      expect(machine.getStateAt(entity, 0)).toBe('a') // Initial
      expect(machine.getStateAt(entity, 1)).toBe('b')
      expect(machine.getStateAt(entity, 2)).toBe('c')
      expect(machine.getStateAt(entity, 3)).toBe('d')
    })

    it('wasInState checks if entity was ever in state', async () => {
      const config = {
        $initial: 'a',
        $trackHistory: true,
        a: { next: 'b' },
        b: { next: 'c' },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'next')
      await machine.transition(entity, 'next')

      expect(machine.wasInState(entity, 'a')).toBe(true)
      expect(machine.wasInState(entity, 'b')).toBe(true)
      expect(machine.wasInState(entity, 'c')).toBe(true)
      expect(machine.wasInState(entity, 'd')).toBe(false)
    })

    it('history is stored on entity when $trackHistory is true', async () => {
      const config = {
        $initial: 'a',
        $trackHistory: true,
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1' }

      await machine.initialize(entity)
      await machine.transition(entity, 'next')

      expect(entity.$history).toBeDefined()
      expect(Array.isArray(entity.$history)).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty Configuration', () => {
    it('config with only $initial and one state is valid', () => {
      const config = {
        $initial: 'only',
        only: {},
      }

      const machine = new StateMachine(config)
      expect(machine.getStates()).toEqual(['only'])
    })
  })

  describe('Concurrent Transitions', () => {
    it('concurrent transitions on same entity are serialized', async () => {
      const order: string[] = []

      const config = {
        $initial: 'idle',
        idle: {
          slow: {
            to: 'a',
            do: async () => {
              await new Promise((r) => setTimeout(r, 50))
              order.push('slow')
            },
          },
          fast: {
            to: 'b',
            do: async () => {
              await new Promise((r) => setTimeout(r, 10))
              order.push('fast')
            },
          },
        },
        a: {},
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'idle' }

      // Start both transitions - second should wait or fail
      const p1 = machine.transition(entity, 'slow')
      const p2 = machine.transition(entity, 'fast').catch(() => order.push('fast-rejected'))

      await Promise.all([p1, p2])

      // Either slow completes and fast is rejected, or they're serialized
      expect(order[0]).toBe('slow')
    })
  })

  describe('Self-Loops', () => {
    it('self-loop triggers exit and entry', async () => {
      const exitSpy = vi.fn()
      const entrySpy = vi.fn()

      const config = {
        $initial: 'active',
        active: {
          $exit: exitSpy,
          $entry: entrySpy,
          refresh: 'active',
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'active' }

      await machine.transition(entity, 'refresh')

      expect(exitSpy).toHaveBeenCalled()
      expect(entrySpy).toHaveBeenCalled()
    })
  })

  describe('State Validation', () => {
    it('rejects entity with invalid $state', async () => {
      const config = {
        $initial: 'valid',
        valid: { next: 'also_valid' },
        also_valid: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'invalid_state' }

      await expect(machine.transition(entity, 'next')).rejects.toThrow(/invalid.*state/i)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  describe('Order Workflow', () => {
    it('complete order workflow', async () => {
      const config = {
        $initial: 'created',
        $trackHistory: true,
        created: {
          $entry: (order: OrderEntity) => {
            order.createdAt = Date.now()
          },
          submit: {
            to: 'pending_payment',
            if: (order: OrderEntity) => order.items.length > 0,
          },
          cancel: 'cancelled',
        },
        pending_payment: {
          pay: {
            to: 'paid',
            if: (order: OrderEntity) => order.paymentMethod !== undefined,
            do: (order: OrderEntity) => {
              order.paidAt = Date.now()
            },
          },
          cancel: 'cancelled',
        },
        paid: {
          ship: 'shipped',
          refund: 'refunded',
        },
        shipped: {
          deliver: {
            to: 'delivered',
            do: (order: OrderEntity) => {
              order.deliveredAt = Date.now()
            },
          },
        },
        delivered: {},
        cancelled: {},
        refunded: {},
      }

      const machine = new StateMachine(config)
      const order: OrderEntity = {
        id: 'order-001',
        total: 99.99,
        items: [{ sku: 'ITEM-1', qty: 2 }],
      }

      // Initialize
      await machine.initialize(order)
      expect(order.$state).toBe('created')
      expect(order.createdAt).toBeDefined()

      // Submit order
      await machine.transition(order, 'submit')
      expect(order.$state).toBe('pending_payment')

      // Try to pay without payment method - should fail
      await expect(machine.transition(order, 'pay')).rejects.toThrow()

      // Add payment method and pay
      order.paymentMethod = 'credit_card'
      await machine.transition(order, 'pay')
      expect(order.$state).toBe('paid')
      expect(order.paidAt).toBeDefined()

      // Ship and deliver
      await machine.transition(order, 'ship')
      await machine.transition(order, 'deliver')
      expect(order.$state).toBe('delivered')
      expect(order.deliveredAt).toBeDefined()

      // Verify history
      const history = machine.getHistory(order)
      expect(history.map((h: StateHistory) => h.to)).toEqual([
        'created',
        'pending_payment',
        'paid',
        'shipped',
        'delivered',
      ])
    })
  })

  describe('Ticket Workflow', () => {
    it('support ticket workflow with escalation', async () => {
      const config = {
        $initial: 'open',
        open: {
          assign: {
            to: 'assigned',
            if: (ticket: TicketEntity) => ticket.assignee !== undefined,
          },
          close: {
            to: 'closed',
            if: (ticket: TicketEntity) => ticket.resolution !== undefined,
          },
        },
        assigned: {
          $entry: (ticket: TicketEntity, ctx: { event: string }) => {
            ticket.assignedAt = Date.now()
          },
          unassign: 'open',
          escalate: {
            to: 'escalated',
            if: (ticket: TicketEntity) => ticket.priority === 'high',
          },
          resolve: 'resolved',
        },
        escalated: {
          resolve: 'resolved',
          downgrade: 'assigned',
        },
        resolved: {
          $entry: (ticket: TicketEntity) => {
            ticket.resolvedAt = Date.now()
          },
          close: 'closed',
          reopen: 'open',
        },
        closed: {
          reopen: 'open',
        },
      }

      const machine = new StateMachine(config)
      const ticket: TicketEntity = {
        id: 'ticket-001',
        priority: 'high',
      }

      await machine.initialize(ticket)
      expect(ticket.$state).toBe('open')

      // Can't assign without assignee
      await expect(machine.transition(ticket, 'assign')).rejects.toThrow()

      // Assign
      ticket.assignee = 'agent-1'
      await machine.transition(ticket, 'assign')
      expect(ticket.$state).toBe('assigned')
      expect(ticket.assignedAt).toBeDefined()

      // Escalate (high priority)
      await machine.transition(ticket, 'escalate')
      expect(ticket.$state).toBe('escalated')

      // Resolve
      await machine.transition(ticket, 'resolve')
      expect(ticket.$state).toBe('resolved')
      expect(ticket.resolvedAt).toBeDefined()

      // Close
      await machine.transition(ticket, 'close')
      expect(ticket.$state).toBe('closed')
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('StateMachine class is exported', () => {
    expect(StateMachine).toBeDefined()
    expect(typeof StateMachine).toBe('function')
  })

  it('exports StateConfig type', () => {
    // This is a type test - will fail at compile time if type doesn't exist
    const config: StateConfig = {
      $initial: 'test',
      test: {},
    }
    expect(config.$initial).toBe('test')
  })

  it('exports TransitionResult type', () => {
    // Type test
    const result: TransitionResult = {
      success: true,
      from: 'a',
      to: 'b',
      event: 'next',
    }
    expect(result.success).toBe(true)
  })

  it('exports GuardFunction type', () => {
    // Type test
    const guard: GuardFunction = (entity: Entity) => entity.$state === 'valid'
    expect(typeof guard).toBe('function')
  })

  it('exports ActionFunction type', () => {
    // Type test
    const action: ActionFunction = (entity: Entity) => {
      entity.modified = true
    }
    expect(typeof action).toBe('function')
  })
})
