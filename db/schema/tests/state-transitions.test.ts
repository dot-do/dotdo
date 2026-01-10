import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * State Transitions Tests
 *
 * These tests focus on transition mechanics, edge cases, and advanced patterns
 * for the state machine system.
 *
 * This is RED phase TDD - tests should FAIL until the transition module
 * is properly implemented in db/schema/state-machine/transitions.ts.
 *
 * Key concepts:
 * - Transition validation and error handling
 * - Complex guard conditions
 * - Chained transitions
 * - Parallel state machines
 * - Transition metadata and context
 */

// These imports should FAIL until implemented
// @ts-expect-error - Not yet implemented
import { StateMachine, createTransition, validateTransition } from '../state-machine/machine'

// @ts-expect-error - Not yet implemented
import {
  TransitionBuilder,
  TransitionChain,
  parseTransitionConfig,
  serializeState,
  deserializeState,
} from '../state-machine/transitions'

// @ts-expect-error - Types not yet implemented
import type {
  Transition,
  TransitionConfig,
  TransitionContext,
  TransitionError,
  TransitionMiddleware,
} from '../state-machine/transitions'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface Entity {
  id: string
  $state?: string | null
  $terminated?: boolean
  $history?: Array<{
    from: string | null
    to: string | null
    event: string
    timestamp: number
  }>
  [key: string]: unknown
}

interface DocumentEntity extends Entity {
  title: string
  author: string
  version: number
  reviewers?: string[]
  approvedBy?: string
  publishedAt?: number
}

interface PaymentEntity extends Entity {
  amount: number
  currency: string
  method?: string
  processorId?: string
  refundedAmount?: number
}

// ============================================================================
// Transition Validation Tests
// ============================================================================

describe('Transition Validation', () => {
  describe('validateTransition', () => {
    it('returns valid for existing transition', () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const result = validateTransition(config, 'a', 'next')

      expect(result.valid).toBe(true)
      expect(result.targetState).toBe('b')
    })

    it('returns invalid for non-existent event', () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const result = validateTransition(config, 'a', 'nonexistent')

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/event.*not.*defined/i)
    })

    it('returns invalid for non-existent source state', () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const result = validateTransition(config, 'nonexistent', 'next')

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/state.*not.*found/i)
    })

    it('validates target state exists', () => {
      const config = {
        $initial: 'a',
        a: { next: 'missing' }, // Target doesn't exist
        b: {},
      }

      const result = validateTransition(config, 'a', 'next')

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/target.*state.*invalid/i)
    })

    it('validates null target for terminal transitions', () => {
      const config = {
        $initial: 'a',
        a: { finish: null },
      }

      const result = validateTransition(config, 'a', 'finish')

      expect(result.valid).toBe(true)
      expect(result.targetState).toBeNull()
      expect(result.isTerminal).toBe(true)
    })
  })

  describe('createTransition', () => {
    it('creates simple string transition', () => {
      const transition = createTransition('nextState')

      expect(transition.to).toBe('nextState')
      expect(transition.guard).toBeUndefined()
      expect(transition.action).toBeUndefined()
    })

    it('creates guarded transition', () => {
      const guard = (entity: Entity) => entity.$state === 'valid'
      const transition = createTransition({
        to: 'nextState',
        if: guard,
      })

      expect(transition.to).toBe('nextState')
      expect(transition.guard).toBe(guard)
    })

    it('creates transition with action', () => {
      const action = vi.fn()
      const transition = createTransition({
        to: 'nextState',
        do: action,
      })

      expect(transition.to).toBe('nextState')
      expect(transition.action).toBe(action)
    })

    it('creates terminal transition from null', () => {
      const transition = createTransition(null)

      expect(transition.to).toBeNull()
      expect(transition.isTerminal).toBe(true)
    })

    it('creates transition with metadata', () => {
      const transition = createTransition({
        to: 'nextState',
        meta: {
          description: 'Move to next state',
          requiredRole: 'admin',
        },
      })

      expect(transition.meta?.description).toBe('Move to next state')
      expect(transition.meta?.requiredRole).toBe('admin')
    })
  })
})

// ============================================================================
// Guard Conditions Tests
// ============================================================================

describe('Guard Conditions', () => {
  describe('Predicate Function', () => {
    it('guard receives entity as first argument', async () => {
      const guardSpy = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: guardSpy,
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a', customField: 'value' }

      await machine.transition(entity, 'next')

      expect(guardSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'e1',
          customField: 'value',
        }),
        expect.any(Object)
      )
    })

    it('guard receives context as second argument', async () => {
      const guardSpy = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: guardSpy,
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next', { userId: 'user-1' })

      expect(guardSpy).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          event: 'next',
          from: 'a',
          to: 'b',
          userId: 'user-1',
        })
      )
    })

    it('guard returning false blocks transition', async () => {
      const config = {
        $initial: 'locked',
        locked: {
          unlock: {
            to: 'unlocked',
            if: () => false,
          },
        },
        unlocked: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'locked' }

      await expect(machine.transition(entity, 'unlock')).rejects.toThrow(/guard/i)
      expect(entity.$state).toBe('locked')
    })

    it('guard returning truthy value allows transition', async () => {
      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: () => 1, // Truthy but not boolean
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next')

      expect(entity.$state).toBe('b')
    })

    it('guard throwing error blocks transition', async () => {
      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: () => {
              throw new Error('Guard error')
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await expect(machine.transition(entity, 'next')).rejects.toThrow('Guard error')
      expect(entity.$state).toBe('a')
    })
  })

  describe('Entity Access in Guards', () => {
    it('guard can check entity properties', async () => {
      const config = {
        $initial: 'draft',
        draft: {
          publish: {
            to: 'published',
            if: (doc: DocumentEntity) => doc.title.length > 0 && doc.author.length > 0,
          },
        },
        published: {},
      }

      const machine = new StateMachine(config)

      // Missing title - should fail
      const doc1: DocumentEntity = {
        id: 'd1',
        $state: 'draft',
        title: '',
        author: 'John',
        version: 1,
      }
      await expect(machine.transition(doc1, 'publish')).rejects.toThrow()

      // Complete doc - should succeed
      const doc2: DocumentEntity = {
        id: 'd2',
        $state: 'draft',
        title: 'My Document',
        author: 'John',
        version: 1,
      }
      await machine.transition(doc2, 'publish')
      expect(doc2.$state).toBe('published')
    })

    it('guard can check array properties', async () => {
      const config = {
        $initial: 'review',
        review: {
          approve: {
            to: 'approved',
            if: (doc: DocumentEntity) => (doc.reviewers?.length ?? 0) >= 2,
          },
        },
        approved: {},
      }

      const machine = new StateMachine(config)

      // Not enough reviewers
      const doc1: DocumentEntity = {
        id: 'd1',
        $state: 'review',
        title: 'Doc',
        author: 'John',
        version: 1,
        reviewers: ['Alice'],
      }
      await expect(machine.transition(doc1, 'approve')).rejects.toThrow()

      // Enough reviewers
      const doc2: DocumentEntity = {
        id: 'd2',
        $state: 'review',
        title: 'Doc',
        author: 'John',
        version: 1,
        reviewers: ['Alice', 'Bob'],
      }
      await machine.transition(doc2, 'approve')
      expect(doc2.$state).toBe('approved')
    })

    it('guard can check nested properties', async () => {
      interface ConfigEntity extends Entity {
        settings: {
          enabled: boolean
          maxItems: number
        }
      }

      const config = {
        $initial: 'inactive',
        inactive: {
          activate: {
            to: 'active',
            if: (entity: ConfigEntity) => entity.settings?.enabled === true,
          },
        },
        active: {},
      }

      const machine = new StateMachine(config)

      const entity: ConfigEntity = {
        id: 'e1',
        $state: 'inactive',
        settings: { enabled: true, maxItems: 10 },
      }

      await machine.transition(entity, 'activate')
      expect(entity.$state).toBe('active')
    })
  })

  describe('Multiple Guards', () => {
    it('supports array of guard functions (all must pass)', async () => {
      const guard1 = vi.fn().mockReturnValue(true)
      const guard2 = vi.fn().mockReturnValue(true)
      const guard3 = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: [guard1, guard2, guard3],
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next')

      expect(guard1).toHaveBeenCalled()
      expect(guard2).toHaveBeenCalled()
      expect(guard3).toHaveBeenCalled()
      expect(entity.$state).toBe('b')
    })

    it('stops evaluation at first failing guard', async () => {
      const guard1 = vi.fn().mockReturnValue(true)
      const guard2 = vi.fn().mockReturnValue(false)
      const guard3 = vi.fn().mockReturnValue(true)

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: [guard1, guard2, guard3],
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await expect(machine.transition(entity, 'next')).rejects.toThrow()

      expect(guard1).toHaveBeenCalled()
      expect(guard2).toHaveBeenCalled()
      expect(guard3).not.toHaveBeenCalled() // Short-circuits
    })
  })
})

// ============================================================================
// Transition Context Tests
// ============================================================================

describe('Transition Context', () => {
  describe('Context Properties', () => {
    it('context includes event name', async () => {
      let capturedContext: TransitionContext | null = null

      const config = {
        $initial: 'a',
        a: {
          myEvent: {
            to: 'b',
            do: (_: Entity, ctx: TransitionContext) => {
              capturedContext = ctx
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'myEvent')

      expect(capturedContext?.event).toBe('myEvent')
    })

    it('context includes from and to states', async () => {
      let capturedContext: TransitionContext | null = null

      const config = {
        $initial: 'start',
        start: {
          proceed: {
            to: 'end',
            do: (_: Entity, ctx: TransitionContext) => {
              capturedContext = ctx
            },
          },
        },
        end: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'start' }

      await machine.transition(entity, 'proceed')

      expect(capturedContext?.from).toBe('start')
      expect(capturedContext?.to).toBe('end')
    })

    it('context includes timestamp', async () => {
      let capturedContext: TransitionContext | null = null

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: (_: Entity, ctx: TransitionContext) => {
              capturedContext = ctx
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const before = Date.now()
      await machine.transition(entity, 'next')
      const after = Date.now()

      expect(capturedContext?.timestamp).toBeGreaterThanOrEqual(before)
      expect(capturedContext?.timestamp).toBeLessThanOrEqual(after)
    })

    it('context includes machine reference', async () => {
      let capturedContext: TransitionContext | null = null

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: (_: Entity, ctx: TransitionContext) => {
              capturedContext = ctx
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next')

      expect(capturedContext?.machine).toBe(machine)
    })
  })

  describe('Custom Context Data', () => {
    it('accepts custom context in transition call', async () => {
      let capturedContext: TransitionContext | null = null

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: (_: Entity, ctx: TransitionContext) => {
              capturedContext = ctx
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next', {
        userId: 'user-123',
        reason: 'Manual transition',
        metadata: { source: 'api' },
      })

      expect(capturedContext?.userId).toBe('user-123')
      expect(capturedContext?.reason).toBe('Manual transition')
      expect(capturedContext?.metadata).toEqual({ source: 'api' })
    })

    it('custom context is available in guards', async () => {
      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: (_: Entity, ctx: TransitionContext) => ctx.userId === 'admin',
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)

      const entity1: Entity = { id: 'e1', $state: 'a' }
      await expect(machine.transition(entity1, 'next', { userId: 'user' })).rejects.toThrow()

      const entity2: Entity = { id: 'e2', $state: 'a' }
      await machine.transition(entity2, 'next', { userId: 'admin' })
      expect(entity2.$state).toBe('b')
    })

    it('custom context is available in entry/exit', async () => {
      const entrySpy = vi.fn()
      const exitSpy = vi.fn()

      const config = {
        $initial: 'a',
        a: {
          $exit: exitSpy,
          next: 'b',
        },
        b: {
          $entry: entrySpy,
        },
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await machine.transition(entity, 'next', { customData: 'test' })

      expect(exitSpy).toHaveBeenCalledWith(entity, expect.objectContaining({ customData: 'test' }))
      expect(entrySpy).toHaveBeenCalledWith(entity, expect.objectContaining({ customData: 'test' }))
    })
  })
})

// ============================================================================
// TransitionBuilder Tests
// ============================================================================

describe('TransitionBuilder', () => {
  describe('Fluent API', () => {
    it('builds simple transition', () => {
      const transition = new TransitionBuilder().to('nextState').build()

      expect(transition.to).toBe('nextState')
    })

    it('builds transition with guard', () => {
      const guard = (e: Entity) => e.$state === 'valid'

      const transition = new TransitionBuilder().to('nextState').when(guard).build()

      expect(transition.to).toBe('nextState')
      expect(transition.guard).toBe(guard)
    })

    it('builds transition with action', () => {
      const action = vi.fn()

      const transition = new TransitionBuilder().to('nextState').execute(action).build()

      expect(transition.action).toBe(action)
    })

    it('chains multiple guards', () => {
      const guard1 = () => true
      const guard2 = () => true

      const transition = new TransitionBuilder().to('nextState').when(guard1).when(guard2).build()

      expect(transition.guards).toHaveLength(2)
    })

    it('chains multiple actions', () => {
      const action1 = vi.fn()
      const action2 = vi.fn()

      const transition = new TransitionBuilder().to('nextState').execute(action1).execute(action2).build()

      expect(transition.actions).toHaveLength(2)
    })

    it('sets transition metadata', () => {
      const transition = new TransitionBuilder()
        .to('nextState')
        .meta({ description: 'Test', requiredPermission: 'admin' })
        .build()

      expect(transition.meta?.description).toBe('Test')
      expect(transition.meta?.requiredPermission).toBe('admin')
    })

    it('creates terminal transition', () => {
      const transition = new TransitionBuilder().terminal().build()

      expect(transition.to).toBeNull()
      expect(transition.isTerminal).toBe(true)
    })
  })
})

// ============================================================================
// Transition Chain Tests
// ============================================================================

describe('TransitionChain', () => {
  describe('Chained Transitions', () => {
    it('executes multiple transitions in sequence', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: { next: 'c' },
        c: { next: 'd' },
        d: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const chain = new TransitionChain(machine, entity)
      await chain.do('next').do('next').do('next').execute()

      expect(entity.$state).toBe('d')
    })

    it('stops chain on guard failure', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {
          next: {
            to: 'c',
            if: () => false,
          },
        },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const chain = new TransitionChain(machine, entity)

      await expect(chain.do('next').do('next').execute()).rejects.toThrow()
      expect(entity.$state).toBe('b') // Stopped at b
    })

    it('returns results of all transitions', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: { next: 'c' },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const chain = new TransitionChain(machine, entity)
      const results = await chain.do('next').do('next').execute()

      expect(results).toHaveLength(2)
      expect(results[0].from).toBe('a')
      expect(results[0].to).toBe('b')
      expect(results[1].from).toBe('b')
      expect(results[1].to).toBe('c')
    })

    it('passes context through chain', async () => {
      const actionSpy = vi.fn()

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: actionSpy,
          },
        },
        b: {
          next: {
            to: 'c',
            do: actionSpy,
          },
        },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const chain = new TransitionChain(machine, entity)
      await chain.do('next').do('next').withContext({ userId: 'test' }).execute()

      expect(actionSpy).toHaveBeenCalledTimes(2)
      expect(actionSpy).toHaveBeenCalledWith(entity, expect.objectContaining({ userId: 'test' }))
    })
  })

  describe('Conditional Chains', () => {
    it('conditionally includes transition', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: { skip: 'c', next: 'd' },
        c: {},
        d: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const shouldSkip = true

      const chain = new TransitionChain(machine, entity)
      await chain
        .do('next')
        .doIf(shouldSkip, 'skip')
        .doIf(!shouldSkip, 'next')
        .execute()

      expect(entity.$state).toBe('c')
    })

    it('doUnless skips transition when condition is true', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: { next: 'c' },
        c: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      const skipSecond = true

      const chain = new TransitionChain(machine, entity)
      await chain.do('next').doUnless(skipSecond, 'next').execute()

      expect(entity.$state).toBe('b')
    })
  })
})

// ============================================================================
// Transition Error Handling Tests
// ============================================================================

describe('Transition Error Handling', () => {
  describe('TransitionError', () => {
    it('includes error code', async () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      try {
        await machine.transition(entity, 'invalid')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as TransitionError).code).toBe('INVALID_EVENT')
      }
    })

    it('includes transition details', async () => {
      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            if: () => false,
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      try {
        await machine.transition(entity, 'next')
        expect.fail('Should have thrown')
      } catch (error) {
        const te = error as TransitionError
        expect(te.code).toBe('GUARD_FAILED')
        expect(te.event).toBe('next')
        expect(te.from).toBe('a')
        expect(te.to).toBe('b')
      }
    })

    it('includes entity id in error', async () => {
      const config = {
        $initial: 'a',
        a: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'entity-123', $state: 'a' }

      try {
        await machine.transition(entity, 'invalid')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as TransitionError).entityId).toBe('entity-123')
      }
    })
  })

  describe('Error Recovery', () => {
    it('entity state unchanged on guard error', async () => {
      const config = {
        $initial: 'stable',
        stable: {
          change: {
            to: 'changed',
            if: () => {
              throw new Error('Guard error')
            },
          },
        },
        changed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'stable' }

      await expect(machine.transition(entity, 'change')).rejects.toThrow()
      expect(entity.$state).toBe('stable')
    })

    it('entity state unchanged on action error', async () => {
      const config = {
        $initial: 'stable',
        stable: {
          change: {
            to: 'changed',
            do: () => {
              throw new Error('Action error')
            },
          },
        },
        changed: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'stable' }

      await expect(machine.transition(entity, 'change')).rejects.toThrow()
      expect(entity.$state).toBe('stable')
    })

    it('entity modifications in action are rolled back on error', async () => {
      const config = {
        $initial: 'a',
        a: {
          change: {
            to: 'b',
            do: (entity: Entity) => {
              entity.modified = true
              throw new Error('Late error')
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      const entity: Entity = { id: 'e1', $state: 'a' }

      await expect(machine.transition(entity, 'change')).rejects.toThrow()

      expect(entity.$state).toBe('a')
      expect(entity.modified).toBeUndefined() // Rolled back
    })
  })
})

// ============================================================================
// Transition Middleware Tests
// ============================================================================

describe('Transition Middleware', () => {
  describe('Before Middleware', () => {
    it('runs before transition', async () => {
      const order: string[] = []

      const middleware: TransitionMiddleware = {
        before: () => {
          order.push('middleware')
        },
      }

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: () => order.push('action'),
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await machine.transition(entity, 'next')

      expect(order).toEqual(['middleware', 'action'])
    })

    it('can cancel transition by returning false', async () => {
      const middleware: TransitionMiddleware = {
        before: () => false,
      }

      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await expect(machine.transition(entity, 'next')).rejects.toThrow(/cancelled/i)
      expect(entity.$state).toBe('a')
    })

    it('receives transition context', async () => {
      const middlewareSpy = vi.fn()

      const middleware: TransitionMiddleware = {
        before: middlewareSpy,
      }

      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await machine.transition(entity, 'next')

      expect(middlewareSpy).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          event: 'next',
          from: 'a',
          to: 'b',
        })
      )
    })
  })

  describe('After Middleware', () => {
    it('runs after successful transition', async () => {
      const order: string[] = []

      const middleware: TransitionMiddleware = {
        after: () => {
          order.push('after')
        },
      }

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: () => order.push('action'),
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await machine.transition(entity, 'next')

      expect(order).toEqual(['action', 'after'])
    })

    it('receives result of transition', async () => {
      const afterSpy = vi.fn()

      const middleware: TransitionMiddleware = {
        after: afterSpy,
      }

      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await machine.transition(entity, 'next')

      expect(afterSpy).toHaveBeenCalledWith(
        entity,
        expect.objectContaining({
          success: true,
          from: 'a',
          to: 'b',
        })
      )
    })
  })

  describe('Error Middleware', () => {
    it('catches transition errors', async () => {
      const errorSpy = vi.fn()

      const middleware: TransitionMiddleware = {
        error: errorSpy,
      }

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: () => {
              throw new Error('Test error')
            },
          },
        },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await expect(machine.transition(entity, 'next')).rejects.toThrow()

      expect(errorSpy).toHaveBeenCalledWith(
        entity,
        expect.any(Error),
        expect.objectContaining({ event: 'next' })
      )
    })

    it('can recover from error by returning entity', async () => {
      const middleware: TransitionMiddleware = {
        error: (entity: Entity) => {
          entity.$state = 'recovered'
          return entity
        },
      }

      const config = {
        $initial: 'a',
        a: {
          next: {
            to: 'b',
            do: () => {
              throw new Error('Test error')
            },
          },
        },
        b: {},
        recovered: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware)

      const entity: Entity = { id: 'e1', $state: 'a' }
      const result = await machine.transition(entity, 'next')

      expect(result.$state).toBe('recovered')
    })
  })

  describe('Multiple Middleware', () => {
    it('executes in order added', async () => {
      const order: string[] = []

      const middleware1: TransitionMiddleware = {
        before: () => {
          order.push('m1-before')
        },
        after: () => {
          order.push('m1-after')
        },
      }

      const middleware2: TransitionMiddleware = {
        before: () => {
          order.push('m2-before')
        },
        after: () => {
          order.push('m2-after')
        },
      }

      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      machine.use(middleware1)
      machine.use(middleware2)

      const entity: Entity = { id: 'e1', $state: 'a' }
      await machine.transition(entity, 'next')

      expect(order).toEqual(['m1-before', 'm2-before', 'm2-after', 'm1-after'])
    })
  })
})

// ============================================================================
// State Serialization Tests
// ============================================================================

describe('State Serialization', () => {
  describe('serializeState', () => {
    it('serializes entity state to JSON', () => {
      const entity: Entity = {
        id: 'e1',
        $state: 'active',
        $history: [
          { from: null, to: 'created', event: '$init', timestamp: 1000 },
          { from: 'created', to: 'active', event: 'activate', timestamp: 2000 },
        ],
      }

      const serialized = serializeState(entity)
      const parsed = JSON.parse(serialized)

      expect(parsed.$state).toBe('active')
      expect(parsed.$history).toHaveLength(2)
    })

    it('excludes non-state properties', () => {
      const entity: Entity = {
        id: 'e1',
        $state: 'active',
        customProp: 'value',
        nested: { data: 123 },
      }

      const serialized = serializeState(entity)
      const parsed = JSON.parse(serialized)

      expect(parsed.$state).toBe('active')
      expect(parsed.customProp).toBeUndefined()
      expect(parsed.nested).toBeUndefined()
    })

    it('includes custom state properties with $ prefix', () => {
      const entity: Entity = {
        id: 'e1',
        $state: 'active',
        $terminated: false,
        $customMeta: { key: 'value' },
      }

      const serialized = serializeState(entity)
      const parsed = JSON.parse(serialized)

      expect(parsed.$state).toBe('active')
      expect(parsed.$terminated).toBe(false)
      expect(parsed.$customMeta).toEqual({ key: 'value' })
    })
  })

  describe('deserializeState', () => {
    it('restores entity state from JSON', () => {
      const json = JSON.stringify({
        $state: 'active',
        $history: [{ from: 'created', to: 'active', event: 'activate', timestamp: 1000 }],
      })

      const entity: Entity = { id: 'e1' }
      deserializeState(entity, json)

      expect(entity.$state).toBe('active')
      expect(entity.$history).toHaveLength(1)
    })

    it('merges with existing entity', () => {
      const json = JSON.stringify({ $state: 'restored' })

      const entity: Entity = {
        id: 'e1',
        existingProp: 'preserved',
      }

      deserializeState(entity, json)

      expect(entity.id).toBe('e1')
      expect(entity.existingProp).toBe('preserved')
      expect(entity.$state).toBe('restored')
    })

    it('validates state exists in machine config', () => {
      const config = {
        $initial: 'a',
        a: { next: 'b' },
        b: {},
      }

      const machine = new StateMachine(config)
      const json = JSON.stringify({ $state: 'invalid' })

      const entity: Entity = { id: 'e1' }

      expect(() => deserializeState(entity, json, machine)).toThrow(/invalid.*state/i)
    })
  })
})

// ============================================================================
// parseTransitionConfig Tests
// ============================================================================

describe('parseTransitionConfig', () => {
  it('parses string as simple transition', () => {
    const result = parseTransitionConfig('nextState')

    expect(result.to).toBe('nextState')
    expect(result.guard).toBeUndefined()
    expect(result.action).toBeUndefined()
  })

  it('parses null as terminal transition', () => {
    const result = parseTransitionConfig(null)

    expect(result.to).toBeNull()
    expect(result.isTerminal).toBe(true)
  })

  it('parses object with to property', () => {
    const result = parseTransitionConfig({ to: 'nextState' })

    expect(result.to).toBe('nextState')
  })

  it('parses object with if property as guard', () => {
    const guard = () => true
    const result = parseTransitionConfig({ to: 'next', if: guard })

    expect(result.guard).toBe(guard)
  })

  it('parses object with do property as action', () => {
    const action = vi.fn()
    const result = parseTransitionConfig({ to: 'next', do: action })

    expect(result.action).toBe(action)
  })

  it('parses array of guards', () => {
    const guard1 = () => true
    const guard2 = () => true
    const result = parseTransitionConfig({ to: 'next', if: [guard1, guard2] })

    expect(result.guards).toHaveLength(2)
  })

  it('parses array of actions', () => {
    const action1 = vi.fn()
    const action2 = vi.fn()
    const result = parseTransitionConfig({ to: 'next', do: [action1, action2] })

    expect(result.actions).toHaveLength(2)
  })

  it('preserves metadata', () => {
    const result = parseTransitionConfig({
      to: 'next',
      meta: { description: 'Test transition' },
    })

    expect(result.meta?.description).toBe('Test transition')
  })
})

// ============================================================================
// Complex Workflow Tests
// ============================================================================

describe('Complex Workflow', () => {
  describe('Payment Processing', () => {
    it('handles full payment lifecycle', async () => {
      const config = {
        $initial: 'pending',
        $trackHistory: true,
        pending: {
          $entry: (payment: PaymentEntity) => {
            payment.createdAt = Date.now()
          },
          process: {
            to: 'processing',
            if: (payment: PaymentEntity) => payment.amount > 0 && payment.method !== undefined,
          },
          cancel: 'cancelled',
        },
        processing: {
          $entry: async (payment: PaymentEntity) => {
            // Simulate payment processor call
            payment.processorId = `proc-${Date.now()}`
          },
          succeed: 'completed',
          fail: 'failed',
        },
        completed: {
          $entry: (payment: PaymentEntity) => {
            payment.completedAt = Date.now()
          },
          refund: {
            to: 'refunding',
            if: (payment: PaymentEntity) => payment.refundedAmount === undefined,
          },
        },
        refunding: {
          complete: 'refunded',
          fail: 'completed',
        },
        refunded: {
          $entry: (payment: PaymentEntity) => {
            payment.refundedAmount = payment.amount
            payment.refundedAt = Date.now()
          },
        },
        failed: {
          retry: 'pending',
        },
        cancelled: {},
      }

      const machine = new StateMachine(config)
      const payment: PaymentEntity = {
        id: 'pay-001',
        amount: 100,
        currency: 'USD',
        method: 'credit_card',
      }

      // Initialize
      await machine.initialize(payment)
      expect(payment.$state).toBe('pending')
      expect(payment.createdAt).toBeDefined()

      // Process
      await machine.transition(payment, 'process')
      expect(payment.$state).toBe('processing')
      expect(payment.processorId).toBeDefined()

      // Complete
      await machine.transition(payment, 'succeed')
      expect(payment.$state).toBe('completed')
      expect(payment.completedAt).toBeDefined()

      // Refund
      await machine.transition(payment, 'refund')
      expect(payment.$state).toBe('refunding')

      await machine.transition(payment, 'complete')
      expect(payment.$state).toBe('refunded')
      expect(payment.refundedAmount).toBe(100)

      // Verify history
      const history = machine.getHistory(payment)
      expect(history.map((h: { to: string }) => h.to)).toEqual([
        'pending',
        'processing',
        'completed',
        'refunding',
        'refunded',
      ])
    })
  })

  describe('Document Review', () => {
    it('handles document review with multiple approvers', async () => {
      const config = {
        $initial: 'draft',
        draft: {
          $entry: (doc: DocumentEntity) => {
            doc.version = 1
          },
          submit: {
            to: 'review',
            if: (doc: DocumentEntity) => doc.title.length > 0,
          },
        },
        review: {
          $entry: (doc: DocumentEntity) => {
            doc.reviewers = []
          },
          addReviewer: {
            to: 'review',
            do: (doc: DocumentEntity, ctx: { reviewer: string }) => {
              doc.reviewers = [...(doc.reviewers ?? []), ctx.reviewer]
            },
          },
          approve: {
            to: 'approved',
            if: (doc: DocumentEntity) => (doc.reviewers?.length ?? 0) >= 2,
            do: (doc: DocumentEntity, ctx: { approver: string }) => {
              doc.approvedBy = ctx.approver
            },
          },
          reject: 'draft',
        },
        approved: {
          publish: {
            to: 'published',
            do: (doc: DocumentEntity) => {
              doc.publishedAt = Date.now()
            },
          },
          revise: {
            to: 'draft',
            do: (doc: DocumentEntity) => {
              doc.version += 1
            },
          },
        },
        published: {
          archive: null, // Terminal
        },
      }

      const machine = new StateMachine(config)
      const doc: DocumentEntity = {
        id: 'doc-001',
        title: 'Important Document',
        author: 'Alice',
        version: 0,
      }

      // Initialize and submit
      await machine.initialize(doc)
      await machine.transition(doc, 'submit')
      expect(doc.$state).toBe('review')
      expect(doc.reviewers).toEqual([])

      // Add reviewers
      await machine.transition(doc, 'addReviewer', { reviewer: 'Bob' })
      expect(doc.reviewers).toContain('Bob')

      // Try to approve with one reviewer - should fail
      await expect(machine.transition(doc, 'approve', { approver: 'Manager' })).rejects.toThrow()

      // Add second reviewer
      await machine.transition(doc, 'addReviewer', { reviewer: 'Carol' })

      // Approve
      await machine.transition(doc, 'approve', { approver: 'Manager' })
      expect(doc.$state).toBe('approved')
      expect(doc.approvedBy).toBe('Manager')

      // Publish
      await machine.transition(doc, 'publish')
      expect(doc.$state).toBe('published')
      expect(doc.publishedAt).toBeDefined()

      // Archive (terminal)
      await machine.transition(doc, 'archive')
      expect(doc.$state).toBeNull()
      expect(doc.$terminated).toBe(true)
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('exports TransitionBuilder', () => {
    expect(TransitionBuilder).toBeDefined()
    expect(typeof TransitionBuilder).toBe('function')
  })

  it('exports TransitionChain', () => {
    expect(TransitionChain).toBeDefined()
    expect(typeof TransitionChain).toBe('function')
  })

  it('exports parseTransitionConfig', () => {
    expect(parseTransitionConfig).toBeDefined()
    expect(typeof parseTransitionConfig).toBe('function')
  })

  it('exports serializeState', () => {
    expect(serializeState).toBeDefined()
    expect(typeof serializeState).toBe('function')
  })

  it('exports deserializeState', () => {
    expect(deserializeState).toBeDefined()
    expect(typeof deserializeState).toBe('function')
  })

  it('exports validateTransition', () => {
    expect(validateTransition).toBeDefined()
    expect(typeof validateTransition).toBe('function')
  })

  it('exports createTransition', () => {
    expect(createTransition).toBeDefined()
    expect(typeof createTransition).toBe('function')
  })
})
