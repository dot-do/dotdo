/**
 * State Machine Tests - RED Phase (TDD)
 *
 * Comprehensive tests for conversation state machine covering:
 * - States: new, active, pending, resolved, closed
 * - Valid transitions between states
 * - Invalid transition rejection
 * - Guard conditions on transitions
 * - Side effects on state change
 * - State history tracking
 *
 * Following TDD RED phase - these tests should FAIL until implementation.
 *
 * @module db/primitives/conversation/tests/state-machine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createStateMachine,
  type ConversationState,
  type TransitionEvent,
  type StateHistoryEntry,
  type StateMachineContext,
  type StateMachineConfig,
  type ConversationStateMachine,
  type SideEffect,
} from '../state-machine'

// =============================================================================
// Test Suite 1: Initial State
// =============================================================================

describe('State Machine: Initial State', () => {
  describe('default initialization', () => {
    it('should start in "new" state', () => {
      const sm = createStateMachine()

      expect(sm.state).toBe('new')
    })

    it('should have context with currentState set to "new"', () => {
      const sm = createStateMachine()

      expect(sm.context.state).toBe('new')
    })

    it('should have no previous state initially', () => {
      const sm = createStateMachine()

      expect(sm.context.previousState).toBeUndefined()
    })

    it('should have empty history initially', () => {
      const sm = createStateMachine()

      expect(sm.context.history).toEqual([])
      expect(sm.getHistory()).toEqual([])
    })

    it('should auto-generate context id', () => {
      const sm = createStateMachine()

      expect(sm.context.id).toBeDefined()
      expect(typeof sm.context.id).toBe('string')
      expect(sm.context.id.length).toBeGreaterThan(0)
    })

    it('should set createdAt timestamp', () => {
      const before = new Date()
      const sm = createStateMachine()
      const after = new Date()

      expect(sm.context.createdAt).toBeInstanceOf(Date)
      expect(sm.context.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(sm.context.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should set updatedAt equal to createdAt initially', () => {
      const sm = createStateMachine()

      expect(sm.context.updatedAt.getTime()).toBe(sm.context.createdAt.getTime())
    })

    it('should initialize with default priority "normal"', () => {
      const sm = createStateMachine()

      expect(sm.context.priority).toBe('normal')
    })

    it('should initialize messageCount to 0', () => {
      const sm = createStateMachine()

      expect(sm.context.messageCount).toBe(0)
    })

    it('should initialize slaBreached to false', () => {
      const sm = createStateMachine()

      expect(sm.context.slaBreached).toBe(false)
    })

    it('should initialize with empty metadata', () => {
      const sm = createStateMachine()

      expect(sm.context.metadata).toEqual({})
    })
  })

  describe('custom initialization', () => {
    it('should accept custom id', () => {
      const sm = createStateMachine({
        initialContext: { id: 'conv_custom_123' },
      })

      expect(sm.context.id).toBe('conv_custom_123')
    })

    it('should accept custom priority', () => {
      const sm = createStateMachine({
        initialContext: { priority: 'urgent' },
      })

      expect(sm.context.priority).toBe('urgent')
    })

    it('should accept custom messageCount', () => {
      const sm = createStateMachine({
        initialContext: { messageCount: 5 },
      })

      expect(sm.context.messageCount).toBe(5)
    })

    it('should accept assignee', () => {
      const sm = createStateMachine({
        initialContext: { assignee: 'agent_1' },
      })

      expect(sm.context.assignee).toBe('agent_1')
    })

    it('should accept custom metadata', () => {
      const sm = createStateMachine({
        initialContext: {
          metadata: { customerId: 'cust_123', channel: 'chat' },
        },
      })

      expect(sm.context.metadata.customerId).toBe('cust_123')
      expect(sm.context.metadata.channel).toBe('chat')
    })

    it('should still start in "new" state regardless of context', () => {
      const sm = createStateMachine({
        initialContext: {
          priority: 'high',
          messageCount: 10,
          assignee: 'agent_1',
        },
      })

      // Initial state is always 'new' for fresh machines
      expect(sm.state).toBe('new')
    })
  })
})

// =============================================================================
// Test Suite 2: Valid Transitions
// =============================================================================

describe('State Machine: Valid Transitions', () => {
  describe('from "new" state', () => {
    it('should transition new -> active on START', async () => {
      const sm = createStateMachine()

      const result = await sm.send({ type: 'START' })

      expect(result).toBe('active')
      expect(sm.state).toBe('active')
    })

    it('should transition new -> closed on FORCE_CLOSE', async () => {
      const sm = createStateMachine()

      const result = await sm.send({ type: 'FORCE_CLOSE', reason: 'Spam' })

      expect(result).toBe('closed')
      expect(sm.state).toBe('closed')
    })

    it('should record actor in history when provided', async () => {
      const sm = createStateMachine()

      await sm.send({ type: 'START', actor: 'agent_1' })

      const history = sm.getHistory()
      expect(history[0].actor).toBe('agent_1')
    })
  })

  describe('from "active" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'START' })
    })

    it('should transition active -> pending on AWAIT', async () => {
      const result = await sm.send({ type: 'AWAIT', reason: 'Waiting for customer' })

      expect(result).toBe('pending')
      expect(sm.state).toBe('pending')
    })

    it('should transition active -> resolved on RESOLVE', async () => {
      // Need messages for resolve guard
      sm.context.messageCount = 1

      const result = await sm.send({ type: 'RESOLVE', reason: 'Issue fixed' })

      expect(result).toBe('resolved')
      expect(sm.state).toBe('resolved')
    })

    it('should transition active -> closed on FORCE_CLOSE', async () => {
      const result = await sm.send({ type: 'FORCE_CLOSE', reason: 'Duplicate' })

      expect(result).toBe('closed')
    })

    it('should store await reason in context', async () => {
      await sm.send({ type: 'AWAIT', reason: 'Waiting for screenshot' })

      expect(sm.context.awaitReason).toBe('Waiting for screenshot')
    })
  })

  describe('from "pending" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting' })
    })

    it('should transition pending -> active on RESUME', async () => {
      const result = await sm.send({ type: 'RESUME' })

      expect(result).toBe('active')
      expect(sm.state).toBe('active')
    })

    it('should transition pending -> closed on TIMEOUT', async () => {
      const result = await sm.send({ type: 'TIMEOUT' })

      expect(result).toBe('closed')
    })

    it('should transition pending -> closed on CLOSE', async () => {
      const result = await sm.send({ type: 'CLOSE', reason: 'No response' })

      expect(result).toBe('closed')
    })

    it('should transition pending -> closed on FORCE_CLOSE', async () => {
      const result = await sm.send({ type: 'FORCE_CLOSE', reason: 'Admin close' })

      expect(result).toBe('closed')
    })

    it('should clear awaitReason on RESUME', async () => {
      expect(sm.context.awaitReason).toBeDefined()

      await sm.send({ type: 'RESUME' })

      expect(sm.context.awaitReason).toBeUndefined()
    })

    it('should track pendingSince timestamp', () => {
      expect(sm.context.pendingSince).toBeInstanceOf(Date)
    })
  })

  describe('from "resolved" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Fixed' })
    })

    it('should transition resolved -> active on REOPEN', async () => {
      const result = await sm.send({ type: 'REOPEN', reason: 'Issue recurred' })

      expect(result).toBe('active')
      expect(sm.state).toBe('active')
    })

    it('should transition resolved -> closed on CLOSE', async () => {
      const result = await sm.send({ type: 'CLOSE', reason: 'Customer confirmed' })

      expect(result).toBe('closed')
    })

    it('should transition resolved -> closed on FORCE_CLOSE', async () => {
      const result = await sm.send({ type: 'FORCE_CLOSE', reason: 'Admin' })

      expect(result).toBe('closed')
    })

    it('should have resolvedAt timestamp set', () => {
      expect(sm.context.resolvedAt).toBeInstanceOf(Date)
    })
  })

  describe('from "closed" state (final)', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })
    })

    it('should not allow any transitions', async () => {
      expect(sm.can({ type: 'START' })).toBe(false)
      expect(sm.can({ type: 'REOPEN', reason: 'test' })).toBe(false)
      expect(sm.can({ type: 'RESUME' })).toBe(false)
      expect(sm.can({ type: 'FORCE_CLOSE', reason: 'test' })).toBe(false)
    })

    it('should return empty valid transitions', () => {
      expect(sm.getValidTransitions()).toEqual([])
    })

    it('should have closedAt timestamp set', () => {
      expect(sm.context.closedAt).toBeInstanceOf(Date)
    })

    it('should have closeReason in context', () => {
      expect(sm.context.closeReason).toBe('Test')
    })
  })

  describe('FORCE_CLOSE from any state', () => {
    it('should work from new', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })
      expect(sm.state).toBe('closed')
    })

    it('should work from active', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })
      expect(sm.state).toBe('closed')
    })

    it('should work from pending', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Test' })
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })
      expect(sm.state).toBe('closed')
    })

    it('should work from resolved', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Done' })
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })
      expect(sm.state).toBe('closed')
    })
  })
})

// =============================================================================
// Test Suite 3: Invalid Transitions
// =============================================================================

describe('State Machine: Invalid Transitions', () => {
  describe('from "new" state', () => {
    let sm: ConversationStateMachine

    beforeEach(() => {
      sm = createStateMachine()
    })

    it('should reject AWAIT from new', async () => {
      await expect(sm.send({ type: 'AWAIT', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESUME from new', async () => {
      await expect(sm.send({ type: 'RESUME' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESOLVE from new', async () => {
      await expect(sm.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject REOPEN from new', async () => {
      await expect(sm.send({ type: 'REOPEN', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject CLOSE from new', async () => {
      await expect(sm.send({ type: 'CLOSE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject TIMEOUT from new', async () => {
      await expect(sm.send({ type: 'TIMEOUT' })).rejects.toThrow(/invalid transition/i)
    })

    it('should return false for can() on invalid transitions', () => {
      expect(sm.can({ type: 'AWAIT', reason: 'test' })).toBe(false)
      expect(sm.can({ type: 'RESUME' })).toBe(false)
      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
      expect(sm.can({ type: 'REOPEN', reason: 'test' })).toBe(false)
    })
  })

  describe('from "active" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'START' })
    })

    it('should reject START when already active', async () => {
      await expect(sm.send({ type: 'START' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESUME when not pending', async () => {
      await expect(sm.send({ type: 'RESUME' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject REOPEN when not resolved', async () => {
      await expect(sm.send({ type: 'REOPEN', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject TIMEOUT when not pending', async () => {
      await expect(sm.send({ type: 'TIMEOUT' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject CLOSE directly (use FORCE_CLOSE)', async () => {
      await expect(sm.send({ type: 'CLOSE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })
  })

  describe('from "pending" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting' })
    })

    it('should reject START when pending', async () => {
      await expect(sm.send({ type: 'START' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject AWAIT when already pending', async () => {
      await expect(sm.send({ type: 'AWAIT', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESOLVE from pending', async () => {
      await expect(sm.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject REOPEN from pending', async () => {
      await expect(sm.send({ type: 'REOPEN', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })
  })

  describe('from "resolved" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Done' })
    })

    it('should reject START when resolved', async () => {
      await expect(sm.send({ type: 'START' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject AWAIT when resolved', async () => {
      await expect(sm.send({ type: 'AWAIT', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESUME when resolved', async () => {
      await expect(sm.send({ type: 'RESUME' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject RESOLVE when already resolved', async () => {
      await expect(sm.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })

    it('should reject TIMEOUT when resolved', async () => {
      await expect(sm.send({ type: 'TIMEOUT' })).rejects.toThrow(/invalid transition/i)
    })
  })

  describe('from "closed" state', () => {
    let sm: ConversationStateMachine

    beforeEach(async () => {
      sm = createStateMachine()
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Done' })
    })

    it('should reject all events when closed', async () => {
      await expect(sm.send({ type: 'START' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'AWAIT', reason: 'test' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'RESUME' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'REOPEN', reason: 'test' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'CLOSE', reason: 'test' })).rejects.toThrow(/closed.*final|cannot transition/i)
      await expect(sm.send({ type: 'FORCE_CLOSE', reason: 'test' })).rejects.toThrow(/closed.*final|cannot transition/i)
    })
  })

  describe('error messages', () => {
    it('should include current state in error message', async () => {
      const sm = createStateMachine()

      try {
        await sm.send({ type: 'RESUME' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/new/i)
      }
    })

    it('should include event type in error message', async () => {
      const sm = createStateMachine()

      try {
        await sm.send({ type: 'RESOLVE', reason: 'test' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/RESOLVE/i)
      }
    })
  })
})

// =============================================================================
// Test Suite 4: Guards on Transitions
// =============================================================================

describe('State Machine: Guards on Transitions', () => {
  describe('RESOLVE guard: requires messages', () => {
    it('should block RESOLVE with zero messages', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 0 } })
      await sm.send({ type: 'START' })

      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
    })

    it('should throw on RESOLVE with zero messages', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 0 } })
      await sm.send({ type: 'START' })

      await expect(sm.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/guard|message/i)
    })

    it('should allow RESOLVE with messages', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 5 } })
      await sm.send({ type: 'START' })

      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(true)

      const result = await sm.send({ type: 'RESOLVE', reason: 'Done' })
      expect(result).toBe('resolved')
    })
  })

  describe('custom guards', () => {
    it('should apply custom guard function', async () => {
      const customGuard = vi.fn().mockReturnValue(false)

      const sm = createStateMachine({
        initialContext: { messageCount: 1 },
        guards: {
          'active.RESOLVE': customGuard,
        },
      })
      await sm.send({ type: 'START' })

      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
      expect(customGuard).toHaveBeenCalled()
    })

    it('should pass context and event to guard', async () => {
      const customGuard = vi.fn().mockReturnValue(true)

      const sm = createStateMachine({
        initialContext: { messageCount: 1 },
        guards: {
          'active.RESOLVE': customGuard,
        },
      })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Test reason' })

      expect(customGuard).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'active' }),
        expect.objectContaining({ type: 'RESOLVE', reason: 'Test reason' })
      )
    })

    it('should support priority-based guard', async () => {
      const sm = createStateMachine({
        initialContext: { messageCount: 1, priority: 'urgent' },
        guards: {
          // Urgent tickets require manager approval (simulated by assignee check)
          'active.RESOLVE': (ctx) => ctx.priority !== 'urgent' || ctx.assignee !== undefined,
        },
      })
      await sm.send({ type: 'START' })

      // No assignee, should fail for urgent
      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
    })

    it('should support SLA-based guard', async () => {
      const sm = createStateMachine({
        initialContext: { messageCount: 1, slaBreached: true },
        guards: {
          // Cannot auto-close if SLA breached
          'active.RESOLVE': (ctx) => !ctx.slaBreached,
        },
      })
      await sm.send({ type: 'START' })

      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
    })
  })

  describe('guard composition', () => {
    it('should combine built-in and custom guards', async () => {
      const customGuard = vi.fn().mockReturnValue(true)

      const sm = createStateMachine({
        initialContext: { messageCount: 0 }, // Will fail built-in guard
        guards: {
          'active.RESOLVE': customGuard,
        },
      })
      await sm.send({ type: 'START' })

      // Built-in guard (messageCount > 0) should still apply
      expect(sm.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
    })
  })
})

// =============================================================================
// Test Suite 5: Side Effects on State Change
// =============================================================================

describe('State Machine: Side Effects on State Change', () => {
  describe('automatic timestamp updates', () => {
    it('should set resolvedAt when entering resolved state', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })

      expect(sm.context.resolvedAt).toBeUndefined()

      await sm.send({ type: 'RESOLVE', reason: 'Done' })

      expect(sm.context.resolvedAt).toBeInstanceOf(Date)
    })

    it('should set closedAt when entering closed state', async () => {
      const sm = createStateMachine()

      expect(sm.context.closedAt).toBeUndefined()

      await sm.send({ type: 'FORCE_CLOSE', reason: 'Done' })

      expect(sm.context.closedAt).toBeInstanceOf(Date)
    })

    it('should set pendingSince when entering pending state', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })

      expect(sm.context.pendingSince).toBeUndefined()

      await sm.send({ type: 'AWAIT', reason: 'Waiting' })

      expect(sm.context.pendingSince).toBeInstanceOf(Date)
    })

    it('should clear pendingSince when leaving pending state', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting' })

      expect(sm.context.pendingSince).toBeInstanceOf(Date)

      await sm.send({ type: 'RESUME' })

      expect(sm.context.pendingSince).toBeUndefined()
    })

    it('should clear resolvedAt when reopening', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Fixed' })

      expect(sm.context.resolvedAt).toBeInstanceOf(Date)

      await sm.send({ type: 'REOPEN', reason: 'Issue returned' })

      expect(sm.context.resolvedAt).toBeUndefined()
    })

    it('should update updatedAt on every transition', async () => {
      const sm = createStateMachine()
      const initial = sm.context.updatedAt

      await new Promise((r) => setTimeout(r, 10))

      await sm.send({ type: 'START' })

      expect(sm.context.updatedAt.getTime()).toBeGreaterThan(initial.getTime())
    })
  })

  describe('reason storage', () => {
    it('should store closeReason in context', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'FORCE_CLOSE', reason: 'Duplicate of CONV-123' })

      expect(sm.context.closeReason).toBe('Duplicate of CONV-123')
    })

    it('should store resolveReason in context', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Password reset completed' })

      expect(sm.context.resolveReason).toBe('Password reset completed')
    })

    it('should store awaitReason in context', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting for customer screenshot' })

      expect(sm.context.awaitReason).toBe('Waiting for customer screenshot')
    })

    it('should clear awaitReason on RESUME', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting' })

      expect(sm.context.awaitReason).toBe('Waiting')

      await sm.send({ type: 'RESUME' })

      expect(sm.context.awaitReason).toBeUndefined()
    })
  })

  describe('custom onEntry actions', () => {
    it('should call onEntry when entering a state', async () => {
      const onEnterActive = vi.fn()

      const sm = createStateMachine({
        actions: {
          onEntry: {
            active: [onEnterActive],
          },
        },
      })

      await sm.send({ type: 'START' })

      expect(onEnterActive).toHaveBeenCalledTimes(1)
      expect(onEnterActive).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'active' }),
        expect.objectContaining({ type: 'START' })
      )
    })

    it('should support multiple onEntry actions', async () => {
      const action1 = vi.fn()
      const action2 = vi.fn()

      const sm = createStateMachine({
        actions: {
          onEntry: {
            closed: [action1, action2],
          },
        },
      })

      await sm.send({ type: 'FORCE_CLOSE', reason: 'Test' })

      expect(action1).toHaveBeenCalledTimes(1)
      expect(action2).toHaveBeenCalledTimes(1)
    })

    it('should execute onEntry actions in order', async () => {
      const order: number[] = []

      const sm = createStateMachine({
        actions: {
          onEntry: {
            active: [
              () => order.push(1),
              () => order.push(2),
              () => order.push(3),
            ],
          },
        },
      })

      await sm.send({ type: 'START' })

      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('custom onExit actions', () => {
    it('should call onExit when leaving a state', async () => {
      const onExitNew = vi.fn()

      const sm = createStateMachine({
        actions: {
          onExit: {
            new: [onExitNew],
          },
        },
      })

      await sm.send({ type: 'START' })

      expect(onExitNew).toHaveBeenCalledTimes(1)
      expect(onExitNew).toHaveBeenCalledWith(
        expect.objectContaining({ previousState: 'new' }),
        expect.objectContaining({ type: 'START' })
      )
    })

    it('should call onExit before onEntry', async () => {
      const order: string[] = []

      const sm = createStateMachine({
        actions: {
          onExit: {
            new: [() => order.push('exit-new')],
          },
          onEntry: {
            active: [() => order.push('enter-active')],
          },
        },
      })

      await sm.send({ type: 'START' })

      expect(order).toEqual(['exit-new', 'enter-active'])
    })
  })

  describe('onTransition actions', () => {
    it('should call onTransition for every state change', async () => {
      const onTransition = vi.fn()

      const sm = createStateMachine({
        actions: {
          onTransition: [onTransition],
        },
      })

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'test' })
      await sm.send({ type: 'RESUME' })

      expect(onTransition).toHaveBeenCalledTimes(3)
    })
  })

  describe('async side effects', () => {
    it('should wait for async onEntry actions', async () => {
      let completed = false

      const sm = createStateMachine({
        actions: {
          onEntry: {
            active: [
              async () => {
                await new Promise((r) => setTimeout(r, 50))
                completed = true
              },
            ],
          },
        },
      })

      await sm.send({ type: 'START' })

      expect(completed).toBe(true)
    })
  })
})

// =============================================================================
// Test Suite 6: State History Tracking
// =============================================================================

describe('State Machine: State History Tracking', () => {
  describe('history entries', () => {
    it('should record transition in history', async () => {
      const sm = createStateMachine()

      await sm.send({ type: 'START' })

      const history = sm.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        from: 'new',
        to: 'active',
        event: 'START',
      })
    })

    it('should record multiple transitions', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting' })
      await sm.send({ type: 'RESUME' })
      await sm.send({ type: 'RESOLVE', reason: 'Done' })

      const history = sm.getHistory()
      expect(history).toHaveLength(4)
      expect(history.map((h) => `${h.from}->${h.to}`)).toEqual([
        'new->active',
        'active->pending',
        'pending->active',
        'active->resolved',
      ])
    })

    it('should include timestamp in history entry', async () => {
      const before = new Date()
      const sm = createStateMachine()

      await sm.send({ type: 'START' })

      const after = new Date()
      const history = sm.getHistory()

      expect(history[0].timestamp).toBeInstanceOf(Date)
      expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should include actor in history entry when provided', async () => {
      const sm = createStateMachine()

      await sm.send({ type: 'START', actor: 'agent_123' })

      const history = sm.getHistory()
      expect(history[0].actor).toBe('agent_123')
    })

    it('should include reason in history entry when applicable', async () => {
      const sm = createStateMachine()

      await sm.send({ type: 'FORCE_CLOSE', reason: 'Spam ticket' })

      const history = sm.getHistory()
      expect(history[0].reason).toBe('Spam ticket')
    })
  })

  describe('previousState tracking', () => {
    it('should update previousState on each transition', async () => {
      const sm = createStateMachine()

      expect(sm.context.previousState).toBeUndefined()

      await sm.send({ type: 'START' })
      expect(sm.context.previousState).toBe('new')

      await sm.send({ type: 'AWAIT', reason: 'test' })
      expect(sm.context.previousState).toBe('active')

      await sm.send({ type: 'RESUME' })
      expect(sm.context.previousState).toBe('pending')
    })
  })

  describe('history is immutable', () => {
    it('should return copy of history array', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })

      const history1 = sm.getHistory()
      const history2 = sm.getHistory()

      expect(history1).not.toBe(history2)
      expect(history1).toEqual(history2)
    })

    it('should not allow modification of returned history', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })

      const history = sm.getHistory()
      history.push({ from: 'fake', to: 'fake', event: 'FAKE', timestamp: new Date() } as StateHistoryEntry)

      expect(sm.getHistory()).toHaveLength(1)
    })
  })

  describe('context.history', () => {
    it('should be accessible via context.history', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })

      expect(sm.context.history).toHaveLength(1)
      expect(sm.context.history).toEqual(sm.getHistory())
    })
  })

  describe('getTimeInState()', () => {
    it('should return time elapsed in current state', async () => {
      const sm = createStateMachine()

      await new Promise((r) => setTimeout(r, 50))

      const time = sm.getTimeInState()
      expect(time).toBeGreaterThanOrEqual(50)
    })

    it('should reset on state change', async () => {
      const sm = createStateMachine()

      await new Promise((r) => setTimeout(r, 50))
      const timeInNew = sm.getTimeInState()

      await sm.send({ type: 'START' })

      const timeInActive = sm.getTimeInState()
      expect(timeInActive).toBeLessThan(timeInNew)
    })
  })
})

// =============================================================================
// Test Suite 7: Event Subscriptions
// =============================================================================

describe('State Machine: Event Subscriptions', () => {
  describe('onTransition', () => {
    it('should call callback on transition', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onTransition(callback)
      await sm.send({ type: 'START' })

      expect(callback).toHaveBeenCalledWith('new', 'active', { type: 'START' })
    })

    it('should return unsubscribe function', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      const unsubscribe = sm.onTransition(callback)
      await sm.send({ type: 'START' })
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      await sm.send({ type: 'AWAIT', reason: 'test' })
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should support multiple subscribers', async () => {
      const sm = createStateMachine()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      sm.onTransition(callback1)
      sm.onTransition(callback2)
      await sm.send({ type: 'START' })

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)
    })
  })

  describe('onStateEnter', () => {
    it('should call callback when entering specific state', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onStateEnter('active', callback)
      await sm.send({ type: 'START' })

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }))
    })

    it('should not call callback for other states', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onStateEnter('resolved', callback)
      await sm.send({ type: 'START' })

      expect(callback).not.toHaveBeenCalled()
    })

    it('should call callback each time state is entered', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onStateEnter('active', callback)

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'test' })
      await sm.send({ type: 'RESUME' }) // Back to active

      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('should return unsubscribe function', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      const unsubscribe = sm.onStateEnter('active', callback)
      await sm.send({ type: 'START' })
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      await sm.send({ type: 'AWAIT', reason: 'test' })
      await sm.send({ type: 'RESUME' })
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('onStateExit', () => {
    it('should call callback when exiting specific state', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onStateExit('new', callback)
      await sm.send({ type: 'START' })

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ previousState: 'new' }))
    })

    it('should not call callback for other states', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      sm.onStateExit('pending', callback)
      await sm.send({ type: 'START' })

      expect(callback).not.toHaveBeenCalled()
    })

    it('should return unsubscribe function', async () => {
      const sm = createStateMachine()
      const callback = vi.fn()

      const unsubscribe = sm.onStateExit('active', callback)

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'test' }) // Exit active
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      await sm.send({ type: 'RESUME' })
      await sm.send({ type: 'AWAIT', reason: 'test' }) // Exit active again
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })
})

// =============================================================================
// Test Suite 8: Serialization & Hydration
// =============================================================================

describe('State Machine: Serialization & Hydration', () => {
  describe('serialize()', () => {
    it('should return JSON string', () => {
      const sm = createStateMachine()

      const serialized = sm.serialize()

      expect(typeof serialized).toBe('string')
      expect(() => JSON.parse(serialized)).not.toThrow()
    })

    it('should include current state', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })

      const serialized = JSON.parse(sm.serialize())

      expect(serialized.state).toBe('active')
    })

    it('should include full context', async () => {
      const sm = createStateMachine({
        initialContext: {
          id: 'conv_123',
          messageCount: 5,
          priority: 'high',
        },
      })

      const serialized = JSON.parse(sm.serialize())

      expect(serialized.context.id).toBe('conv_123')
      expect(serialized.context.messageCount).toBe(5)
      expect(serialized.context.priority).toBe('high')
    })

    it('should include history', async () => {
      const sm = createStateMachine()
      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'test' })

      const serialized = JSON.parse(sm.serialize())

      expect(serialized.context.history).toHaveLength(2)
    })
  })

  describe('hydrate()', () => {
    it('should restore state from serialized data', async () => {
      const sm1 = createStateMachine()
      await sm1.send({ type: 'START' })
      await sm1.send({ type: 'AWAIT', reason: 'Waiting' })

      const serialized = sm1.serialize()

      const sm2 = createStateMachine()
      sm2.hydrate(serialized)

      expect(sm2.state).toBe('pending')
    })

    it('should restore context from serialized data', async () => {
      const sm1 = createStateMachine({
        initialContext: { id: 'conv_hydrate_test', messageCount: 10 },
      })
      await sm1.send({ type: 'START' })

      const serialized = sm1.serialize()

      const sm2 = createStateMachine()
      sm2.hydrate(serialized)

      expect(sm2.context.id).toBe('conv_hydrate_test')
      expect(sm2.context.messageCount).toBe(10)
    })

    it('should restore history from serialized data', async () => {
      const sm1 = createStateMachine()
      await sm1.send({ type: 'START' })
      await sm1.send({ type: 'AWAIT', reason: 'test' })

      const serialized = sm1.serialize()

      const sm2 = createStateMachine()
      sm2.hydrate(serialized)

      expect(sm2.getHistory()).toHaveLength(2)
    })

    it('should allow continued transitions after hydration', async () => {
      const sm1 = createStateMachine()
      await sm1.send({ type: 'START' })

      const serialized = sm1.serialize()

      const sm2 = createStateMachine()
      sm2.hydrate(serialized)

      await sm2.send({ type: 'AWAIT', reason: 'test' })
      expect(sm2.state).toBe('pending')

      await sm2.send({ type: 'RESUME' })
      expect(sm2.state).toBe('active')
    })

    it('should restore Date objects correctly', async () => {
      const sm1 = createStateMachine({ initialContext: { messageCount: 1 } })
      await sm1.send({ type: 'START' })
      await sm1.send({ type: 'RESOLVE', reason: 'Done' })

      const serialized = sm1.serialize()

      const sm2 = createStateMachine()
      sm2.hydrate(serialized)

      expect(sm2.context.createdAt).toBeInstanceOf(Date)
      expect(sm2.context.updatedAt).toBeInstanceOf(Date)
      expect(sm2.context.resolvedAt).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Test Suite 9: Integration Tests - Full Flows
// =============================================================================

describe('State Machine: Integration Tests', () => {
  describe('complete support ticket flow', () => {
    it('should handle standard resolution flow', async () => {
      const sm = createStateMachine({
        initialContext: {
          id: 'ticket_001',
          messageCount: 0,
          priority: 'normal',
        },
      })

      // Start working on ticket
      expect(sm.state).toBe('new')
      await sm.send({ type: 'START', actor: 'agent_1' })
      expect(sm.state).toBe('active')

      // Simulate messages (context update)
      sm.context.messageCount = 3

      // Wait for customer
      await sm.send({ type: 'AWAIT', reason: 'Waiting for screenshot' })
      expect(sm.state).toBe('pending')
      expect(sm.context.awaitReason).toBe('Waiting for screenshot')

      // Customer responds
      await sm.send({ type: 'RESUME', actor: 'customer_1' })
      expect(sm.state).toBe('active')
      expect(sm.context.awaitReason).toBeUndefined()

      // Resolve
      await sm.send({ type: 'RESOLVE', reason: 'Cleared cache, issue resolved', actor: 'agent_1' })
      expect(sm.state).toBe('resolved')
      expect(sm.context.resolvedAt).toBeInstanceOf(Date)

      // Close
      await sm.send({ type: 'CLOSE', reason: 'Customer confirmed', actor: 'system' })
      expect(sm.state).toBe('closed')
      expect(sm.context.closedAt).toBeInstanceOf(Date)

      // Verify history
      expect(sm.getHistory()).toHaveLength(5)
    })

    it('should handle reopen flow', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 2 } })

      await sm.send({ type: 'START' })
      await sm.send({ type: 'RESOLVE', reason: 'Fixed' })
      expect(sm.state).toBe('resolved')

      await sm.send({ type: 'REOPEN', reason: 'Customer reports issue recurred' })
      expect(sm.state).toBe('active')
      expect(sm.context.resolvedAt).toBeUndefined()

      await sm.send({ type: 'RESOLVE', reason: 'Applied permanent fix' })
      await sm.send({ type: 'CLOSE', reason: 'Verified' })
      expect(sm.state).toBe('closed')
    })

    it('should handle escalation flow', async () => {
      const onEnterPending = vi.fn()

      const sm = createStateMachine({
        initialContext: { messageCount: 1, priority: 'urgent' },
        actions: {
          onEntry: {
            pending: [onEnterPending],
          },
        },
      })

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Escalated to manager' })

      expect(onEnterPending).toHaveBeenCalled()
      expect(sm.state).toBe('pending')
    })

    it('should handle timeout flow', async () => {
      const sm = createStateMachine()

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'Waiting for response' })

      // Simulate timeout
      await sm.send({ type: 'TIMEOUT' })
      expect(sm.state).toBe('closed')
    })
  })

  describe('event tracking through flow', () => {
    it('should track all events with subscribers', async () => {
      const sm = createStateMachine({ initialContext: { messageCount: 1 } })

      const transitions: string[] = []
      const enterStates: string[] = []
      const exitStates: string[] = []

      sm.onTransition((from, to) => transitions.push(`${from}->${to}`))
      sm.onStateEnter('active', () => enterStates.push('active'))
      sm.onStateEnter('pending', () => enterStates.push('pending'))
      sm.onStateEnter('resolved', () => enterStates.push('resolved'))
      sm.onStateEnter('closed', () => enterStates.push('closed'))
      sm.onStateExit('new', () => exitStates.push('new'))
      sm.onStateExit('active', () => exitStates.push('active'))
      sm.onStateExit('pending', () => exitStates.push('pending'))
      sm.onStateExit('resolved', () => exitStates.push('resolved'))

      await sm.send({ type: 'START' })
      await sm.send({ type: 'AWAIT', reason: 'test' })
      await sm.send({ type: 'RESUME' })
      await sm.send({ type: 'RESOLVE', reason: 'done' })
      await sm.send({ type: 'CLOSE', reason: 'confirmed' })

      expect(transitions).toEqual([
        'new->active',
        'active->pending',
        'pending->active',
        'active->resolved',
        'resolved->closed',
      ])

      expect(enterStates).toEqual(['active', 'pending', 'active', 'resolved', 'closed'])
      expect(exitStates).toEqual(['new', 'active', 'pending', 'active', 'resolved'])
    })
  })

  describe('persistence across sessions', () => {
    it('should restore and continue from serialized state', async () => {
      // Session 1
      const sm1 = createStateMachine({
        initialContext: { id: 'persist_test', messageCount: 3 },
      })
      await sm1.send({ type: 'START' })
      await sm1.send({ type: 'AWAIT', reason: 'Waiting for approval' })

      const snapshot = sm1.serialize()

      // Session 2
      const sm2 = createStateMachine()
      sm2.hydrate(snapshot)

      expect(sm2.state).toBe('pending')
      expect(sm2.context.id).toBe('persist_test')
      expect(sm2.context.awaitReason).toBe('Waiting for approval')

      // Continue
      await sm2.send({ type: 'RESUME' })
      await sm2.send({ type: 'RESOLVE', reason: 'Approved and resolved' })

      expect(sm2.state).toBe('resolved')
      expect(sm2.getHistory()).toHaveLength(4)
    })
  })
})
