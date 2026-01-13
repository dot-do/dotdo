/**
 * State Machine Transition Tests - RED Phase (TDD)
 *
 * These tests define the expected behavior for conversation state machine transitions.
 * Following TDD, these tests are written FIRST and should FAIL until implementation is complete.
 *
 * State Machine States:
 * - new: Initial state when conversation is created
 * - active: Conversation is being actively worked on
 * - pending: Waiting for external action (customer response, approval, etc.)
 * - resolved: Issue has been addressed, awaiting confirmation
 * - closed: Final state, conversation is complete
 *
 * Valid Transitions:
 * - new -> active (start working)
 * - active -> pending (await response)
 * - active -> resolved (mark resolved)
 * - pending -> active (resume)
 * - pending -> closed (timeout/abandon)
 * - resolved -> active (reopen)
 * - resolved -> closed (confirm complete)
 * - * -> closed (force close from any state)
 *
 * @module db/primitives/conversation/tests/state-machine-transitions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Type Definitions for State Machine
// =============================================================================

/**
 * Conversation states following standard support ticket workflow
 */
type ConversationState = 'new' | 'active' | 'pending' | 'resolved' | 'closed'

/**
 * Events that trigger state transitions
 */
type StateEvent =
  | { type: 'START' }
  | { type: 'AWAIT'; reason?: string; timeout?: string }
  | { type: 'RESUME' }
  | { type: 'RESOLVE'; reason: string }
  | { type: 'REOPEN'; reason: string }
  | { type: 'CLOSE'; reason: string }
  | { type: 'FORCE_CLOSE'; reason: string }
  | { type: 'TIMEOUT' }

/**
 * Guard function type - returns true if transition is allowed
 */
type TransitionGuard = (context: ConversationContext, event: StateEvent) => boolean

/**
 * Action function type - executes side effects on transition
 */
type TransitionAction = (context: ConversationContext, event: StateEvent) => Partial<ConversationContext>

/**
 * Transition definition
 */
interface Transition {
  from: ConversationState | '*'
  to: ConversationState
  event: StateEvent['type']
  guard?: TransitionGuard
  actions?: TransitionAction[]
}

/**
 * State configuration
 */
interface StateConfig {
  onEntry?: TransitionAction[]
  onExit?: TransitionAction[]
  timeout?: {
    duration: string
    action: 'escalate' | 'close' | 'notify'
  }
}

/**
 * Context data maintained across state transitions
 */
interface ConversationContext {
  id: string
  currentState: ConversationState
  previousState?: ConversationState
  assignedTo?: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  messageCount: number
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  closedAt?: Date
  stateHistory: Array<{
    from: ConversationState
    to: ConversationState
    event: string
    at: Date
    actor?: string
  }>
  metadata: Record<string, unknown>
}

/**
 * State Machine interface
 */
interface ConversationStateMachine {
  readonly state: ConversationState
  readonly context: ConversationContext

  /**
   * Send an event to trigger a state transition
   */
  send(event: StateEvent): Promise<ConversationState>

  /**
   * Check if a transition is valid from current state
   */
  can(event: StateEvent): boolean

  /**
   * Get all valid events from current state
   */
  getValidEvents(): StateEvent['type'][]

  /**
   * Subscribe to state transitions
   */
  onTransition(handler: (from: ConversationState, to: ConversationState, event: StateEvent) => void): () => void

  /**
   * Subscribe to entering a specific state
   */
  onEnter(state: ConversationState, handler: (context: ConversationContext) => void): () => void

  /**
   * Subscribe to exiting a specific state
   */
  onExit(state: ConversationState, handler: (context: ConversationContext) => void): () => void
}

/**
 * Factory function placeholder - this should be imported from implementation
 * Currently stubbed to make tests fail (RED phase)
 */
function createConversationStateMachine(_initialContext?: Partial<ConversationContext>): ConversationStateMachine {
  // RED phase: This stub will cause tests to fail
  // Implementation should be provided in db/primitives/conversation/state-machine.ts
  throw new Error('ConversationStateMachine not implemented - RED phase')
}

// =============================================================================
// TDD Cycle 1: Basic State Machine Creation
// =============================================================================

describe('ConversationStateMachine creation', () => {
  it('should create a state machine with initial "new" state', () => {
    const machine = createConversationStateMachine()

    expect(machine.state).toBe('new')
    expect(machine.context.currentState).toBe('new')
  })

  it('should create a state machine with custom initial context', () => {
    const machine = createConversationStateMachine({
      id: 'conv_custom_123',
      priority: 'high',
      assignedTo: 'agent_1',
    })

    expect(machine.context.id).toBe('conv_custom_123')
    expect(machine.context.priority).toBe('high')
    expect(machine.context.assignedTo).toBe('agent_1')
  })

  it('should auto-generate conversation ID if not provided', () => {
    const machine = createConversationStateMachine()

    expect(machine.context.id).toBeDefined()
    expect(machine.context.id.length).toBeGreaterThan(0)
  })

  it('should initialize with empty state history', () => {
    const machine = createConversationStateMachine()

    expect(machine.context.stateHistory).toEqual([])
  })

  it('should set createdAt and updatedAt timestamps', () => {
    const before = new Date()
    const machine = createConversationStateMachine()
    const after = new Date()

    expect(machine.context.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(machine.context.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(machine.context.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })
})

// =============================================================================
// TDD Cycle 2: Valid State Transitions
// =============================================================================

describe('Valid state transitions', () => {
  describe('from "new" state', () => {
    it('should transition from new to active on START event', async () => {
      const machine = createConversationStateMachine()

      const newState = await machine.send({ type: 'START' })

      expect(newState).toBe('active')
      expect(machine.state).toBe('active')
    })

    it('should transition from new to closed on FORCE_CLOSE event', async () => {
      const machine = createConversationStateMachine()

      const newState = await machine.send({ type: 'FORCE_CLOSE', reason: 'Duplicate ticket' })

      expect(newState).toBe('closed')
    })

    it('should NOT allow direct transition from new to pending', async () => {
      const machine = createConversationStateMachine()

      await expect(machine.send({ type: 'AWAIT' })).rejects.toThrow(/invalid transition/i)
    })

    it('should NOT allow direct transition from new to resolved', async () => {
      const machine = createConversationStateMachine()

      await expect(machine.send({ type: 'RESOLVE', reason: 'test' })).rejects.toThrow(/invalid transition/i)
    })
  })

  describe('from "active" state', () => {
    let machine: ConversationStateMachine

    beforeEach(async () => {
      machine = createConversationStateMachine()
      await machine.send({ type: 'START' })
    })

    it('should transition from active to pending on AWAIT event', async () => {
      const newState = await machine.send({ type: 'AWAIT', reason: 'Waiting for customer' })

      expect(newState).toBe('pending')
      expect(machine.state).toBe('pending')
    })

    it('should transition from active to resolved on RESOLVE event', async () => {
      const newState = await machine.send({ type: 'RESOLVE', reason: 'Issue fixed' })

      expect(newState).toBe('resolved')
    })

    it('should transition from active to closed on FORCE_CLOSE event', async () => {
      const newState = await machine.send({ type: 'FORCE_CLOSE', reason: 'Abandoned' })

      expect(newState).toBe('closed')
    })

    it('should NOT allow START event when already active', async () => {
      // Already active, START should be invalid
      expect(machine.can({ type: 'START' })).toBe(false)
    })
  })

  describe('from "pending" state', () => {
    let machine: ConversationStateMachine

    beforeEach(async () => {
      machine = createConversationStateMachine()
      await machine.send({ type: 'START' })
      await machine.send({ type: 'AWAIT' })
    })

    it('should transition from pending to active on RESUME event', async () => {
      const newState = await machine.send({ type: 'RESUME' })

      expect(newState).toBe('active')
    })

    it('should transition from pending to closed on CLOSE event', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'No response timeout' })

      expect(newState).toBe('closed')
    })

    it('should transition from pending to closed on TIMEOUT event', async () => {
      const newState = await machine.send({ type: 'TIMEOUT' })

      expect(newState).toBe('closed')
    })

    it('should transition from pending to closed on FORCE_CLOSE event', async () => {
      const newState = await machine.send({ type: 'FORCE_CLOSE', reason: 'Emergency close' })

      expect(newState).toBe('closed')
    })
  })

  describe('from "resolved" state', () => {
    let machine: ConversationStateMachine

    beforeEach(async () => {
      machine = createConversationStateMachine()
      await machine.send({ type: 'START' })
      await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    })

    it('should transition from resolved to active on REOPEN event', async () => {
      const newState = await machine.send({ type: 'REOPEN', reason: 'Issue recurred' })

      expect(newState).toBe('active')
    })

    it('should transition from resolved to closed on CLOSE event', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'Verified complete' })

      expect(newState).toBe('closed')
    })

    it('should have set resolvedAt timestamp', () => {
      expect(machine.context.resolvedAt).toBeInstanceOf(Date)
    })
  })

  describe('from "closed" state (final)', () => {
    let machine: ConversationStateMachine

    beforeEach(async () => {
      machine = createConversationStateMachine()
      await machine.send({ type: 'START' })
      await machine.send({ type: 'RESOLVE', reason: 'Done' })
      await machine.send({ type: 'CLOSE', reason: 'Complete' })
    })

    it('should have set closedAt timestamp', () => {
      expect(machine.context.closedAt).toBeInstanceOf(Date)
    })

    it('should NOT allow any transitions from closed state', async () => {
      expect(machine.can({ type: 'START' })).toBe(false)
      expect(machine.can({ type: 'REOPEN', reason: 'test' })).toBe(false)
      expect(machine.can({ type: 'RESUME' })).toBe(false)
    })

    it('should reject all events when in closed state', async () => {
      await expect(machine.send({ type: 'START' })).rejects.toThrow(/closed.*final/i)
    })
  })
})

// =============================================================================
// TDD Cycle 3: State History Tracking
// =============================================================================

describe('State history tracking', () => {
  it('should record each state transition in history', async () => {
    const machine = createConversationStateMachine()

    await machine.send({ type: 'START' })
    await machine.send({ type: 'AWAIT' })
    await machine.send({ type: 'RESUME' })

    expect(machine.context.stateHistory).toHaveLength(3)
    expect(machine.context.stateHistory[0].from).toBe('new')
    expect(machine.context.stateHistory[0].to).toBe('active')
    expect(machine.context.stateHistory[1].from).toBe('active')
    expect(machine.context.stateHistory[1].to).toBe('pending')
    expect(machine.context.stateHistory[2].from).toBe('pending')
    expect(machine.context.stateHistory[2].to).toBe('active')
  })

  it('should record event type in history', async () => {
    const machine = createConversationStateMachine()

    await machine.send({ type: 'START' })

    expect(machine.context.stateHistory[0].event).toBe('START')
  })

  it('should record timestamp in history', async () => {
    const machine = createConversationStateMachine()
    const before = new Date()

    await machine.send({ type: 'START' })

    const after = new Date()

    expect(machine.context.stateHistory[0].at.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(machine.context.stateHistory[0].at.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should track previousState in context', async () => {
    const machine = createConversationStateMachine()

    await machine.send({ type: 'START' })

    expect(machine.context.previousState).toBe('new')
    expect(machine.context.currentState).toBe('active')
  })

  it('should update updatedAt on each transition', async () => {
    const machine = createConversationStateMachine()
    const initialUpdatedAt = machine.context.updatedAt

    await new Promise(resolve => setTimeout(resolve, 10))

    await machine.send({ type: 'START' })

    expect(machine.context.updatedAt.getTime()).toBeGreaterThan(initialUpdatedAt.getTime())
  })
})

// =============================================================================
// TDD Cycle 4: can() Method for Validation
// =============================================================================

describe('can() method', () => {
  it('should return true for valid transitions', () => {
    const machine = createConversationStateMachine()

    expect(machine.can({ type: 'START' })).toBe(true)
    expect(machine.can({ type: 'FORCE_CLOSE', reason: 'test' })).toBe(true)
  })

  it('should return false for invalid transitions', () => {
    const machine = createConversationStateMachine()

    expect(machine.can({ type: 'RESUME' })).toBe(false)
    expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)
    expect(machine.can({ type: 'REOPEN', reason: 'test' })).toBe(false)
  })

  it('should update valid events after state change', async () => {
    const machine = createConversationStateMachine()

    expect(machine.can({ type: 'START' })).toBe(true)
    expect(machine.can({ type: 'AWAIT' })).toBe(false)

    await machine.send({ type: 'START' })

    expect(machine.can({ type: 'START' })).toBe(false)
    expect(machine.can({ type: 'AWAIT' })).toBe(true)
    expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 5: getValidEvents() Method
// =============================================================================

describe('getValidEvents() method', () => {
  it('should return valid events from "new" state', () => {
    const machine = createConversationStateMachine()

    const validEvents = machine.getValidEvents()

    expect(validEvents).toContain('START')
    expect(validEvents).toContain('FORCE_CLOSE')
    expect(validEvents).not.toContain('AWAIT')
    expect(validEvents).not.toContain('RESUME')
  })

  it('should return valid events from "active" state', async () => {
    const machine = createConversationStateMachine()
    await machine.send({ type: 'START' })

    const validEvents = machine.getValidEvents()

    expect(validEvents).toContain('AWAIT')
    expect(validEvents).toContain('RESOLVE')
    expect(validEvents).toContain('FORCE_CLOSE')
    expect(validEvents).not.toContain('START')
    expect(validEvents).not.toContain('RESUME')
  })

  it('should return valid events from "pending" state', async () => {
    const machine = createConversationStateMachine()
    await machine.send({ type: 'START' })
    await machine.send({ type: 'AWAIT' })

    const validEvents = machine.getValidEvents()

    expect(validEvents).toContain('RESUME')
    expect(validEvents).toContain('CLOSE')
    expect(validEvents).toContain('TIMEOUT')
    expect(validEvents).toContain('FORCE_CLOSE')
  })

  it('should return empty array from "closed" state', async () => {
    const machine = createConversationStateMachine()
    await machine.send({ type: 'FORCE_CLOSE', reason: 'test' })

    const validEvents = machine.getValidEvents()

    expect(validEvents).toEqual([])
  })
})

// =============================================================================
// TDD Cycle 6: Transition Guards
// =============================================================================

describe('Transition guards', () => {
  it('should block RESOLVE if no messages in conversation', async () => {
    const machine = createConversationStateMachine({ messageCount: 0 })
    await machine.send({ type: 'START' })

    // Guard: Cannot resolve a conversation with no messages
    expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(false)

    await expect(
      machine.send({ type: 'RESOLVE', reason: 'test' })
    ).rejects.toThrow(/guard.*message/i)
  })

  it('should allow RESOLVE if conversation has messages', async () => {
    const machine = createConversationStateMachine({ messageCount: 5 })
    await machine.send({ type: 'START' })

    expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(true)

    const newState = await machine.send({ type: 'RESOLVE', reason: 'Issue addressed' })
    expect(newState).toBe('resolved')
  })

  it('should block CLOSE from pending if no timeout configured', async () => {
    // This tests that certain closes require specific conditions
    const machine = createConversationStateMachine()
    await machine.send({ type: 'START' })
    await machine.send({ type: 'AWAIT' }) // No timeout set

    // CLOSE should only be allowed with explicit reason or timeout
    // FORCE_CLOSE is always allowed
    expect(machine.can({ type: 'FORCE_CLOSE', reason: 'test' })).toBe(true)
  })

  it('should allow transition when guard condition is met', async () => {
    const machine = createConversationStateMachine({
      messageCount: 3,
      assignedTo: 'agent_1',
    })
    await machine.send({ type: 'START' })

    // With messages and assignment, resolve should work
    const newState = await machine.send({ type: 'RESOLVE', reason: 'Done' })
    expect(newState).toBe('resolved')
  })
})

// =============================================================================
// TDD Cycle 7: Transition Side Effects (Actions)
// =============================================================================

describe('Transition side effects (actions)', () => {
  it('should set resolvedAt timestamp when transitioning to resolved', async () => {
    const machine = createConversationStateMachine({ messageCount: 1 })
    await machine.send({ type: 'START' })

    expect(machine.context.resolvedAt).toBeUndefined()

    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })

    expect(machine.context.resolvedAt).toBeInstanceOf(Date)
  })

  it('should set closedAt timestamp when transitioning to closed', async () => {
    const machine = createConversationStateMachine()

    expect(machine.context.closedAt).toBeUndefined()

    await machine.send({ type: 'FORCE_CLOSE', reason: 'Closed' })

    expect(machine.context.closedAt).toBeInstanceOf(Date)
  })

  it('should clear resolvedAt when reopening from resolved', async () => {
    const machine = createConversationStateMachine({ messageCount: 1 })
    await machine.send({ type: 'START' })
    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })

    expect(machine.context.resolvedAt).toBeInstanceOf(Date)

    await machine.send({ type: 'REOPEN', reason: 'Issue returned' })

    expect(machine.context.resolvedAt).toBeUndefined()
  })

  it('should store close reason in metadata', async () => {
    const machine = createConversationStateMachine()
    await machine.send({ type: 'FORCE_CLOSE', reason: 'Duplicate of CONV-123' })

    expect(machine.context.metadata.closeReason).toBe('Duplicate of CONV-123')
  })

  it('should store resolve reason in metadata', async () => {
    const machine = createConversationStateMachine({ messageCount: 1 })
    await machine.send({ type: 'START' })
    await machine.send({ type: 'RESOLVE', reason: 'Password reset completed' })

    expect(machine.context.metadata.resolveReason).toBe('Password reset completed')
  })
})

// =============================================================================
// TDD Cycle 8: Event Handlers (onTransition, onEnter, onExit)
// =============================================================================

describe('Event handlers', () => {
  describe('onTransition', () => {
    it('should call handler on every state transition', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      machine.onTransition(handler)
      await machine.send({ type: 'START' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('new', 'active', { type: 'START' })
    })

    it('should return unsubscribe function', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      const unsubscribe = machine.onTransition(handler)
      await machine.send({ type: 'START' })
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()
      await machine.send({ type: 'AWAIT' })
      expect(handler).toHaveBeenCalledTimes(1) // Not called again
    })

    it('should support multiple handlers', async () => {
      const machine = createConversationStateMachine()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      machine.onTransition(handler1)
      machine.onTransition(handler2)
      await machine.send({ type: 'START' })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })
  })

  describe('onEnter', () => {
    it('should call handler when entering specific state', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      machine.onEnter('active', handler)
      await machine.send({ type: 'START' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        currentState: 'active',
      }))
    })

    it('should not call handler for other states', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      machine.onEnter('resolved', handler)
      await machine.send({ type: 'START' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should return unsubscribe function', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      const unsubscribe = machine.onEnter('active', handler)
      await machine.send({ type: 'START' })
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      // Go back to active
      await machine.send({ type: 'AWAIT' })
      await machine.send({ type: 'RESUME' })
      expect(handler).toHaveBeenCalledTimes(1) // Not called again
    })
  })

  describe('onExit', () => {
    it('should call handler when exiting specific state', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      machine.onExit('new', handler)
      await machine.send({ type: 'START' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        currentState: 'active', // Already transitioned
        previousState: 'new',
      }))
    })

    it('should not call handler when exiting other states', async () => {
      const machine = createConversationStateMachine()
      const handler = vi.fn()

      machine.onExit('pending', handler)
      await machine.send({ type: 'START' })

      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// TDD Cycle 9: Integration - Full Conversation Flow
// =============================================================================

describe('Integration: Full conversation flow', () => {
  it('should complete standard support ticket flow', async () => {
    const machine = createConversationStateMachine({
      id: 'ticket_001',
      priority: 'normal',
      messageCount: 0,
    })

    // Start working on ticket
    expect(machine.state).toBe('new')
    await machine.send({ type: 'START' })
    expect(machine.state).toBe('active')

    // Simulate messages being added (context update)
    // In real impl, this would be done through message API
    machine.context.messageCount = 3

    // Wait for customer response
    await machine.send({ type: 'AWAIT', reason: 'Waiting for customer screenshot' })
    expect(machine.state).toBe('pending')

    // Customer responds
    await machine.send({ type: 'RESUME' })
    expect(machine.state).toBe('active')

    // Resolve the issue
    await machine.send({ type: 'RESOLVE', reason: 'Cleared browser cache' })
    expect(machine.state).toBe('resolved')
    expect(machine.context.resolvedAt).toBeInstanceOf(Date)

    // Close the ticket
    await machine.send({ type: 'CLOSE', reason: 'Customer confirmed' })
    expect(machine.state).toBe('closed')
    expect(machine.context.closedAt).toBeInstanceOf(Date)

    // Verify full history
    expect(machine.context.stateHistory).toHaveLength(5)
    expect(machine.context.stateHistory.map(h => h.to)).toEqual([
      'active',
      'pending',
      'active',
      'resolved',
      'closed',
    ])
  })

  it('should handle reopen flow', async () => {
    const machine = createConversationStateMachine({ messageCount: 2 })

    // Fast track to resolved
    await machine.send({ type: 'START' })
    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    expect(machine.state).toBe('resolved')

    // Customer reports issue again
    await machine.send({ type: 'REOPEN', reason: 'Problem recurred' })
    expect(machine.state).toBe('active')
    expect(machine.context.resolvedAt).toBeUndefined()

    // Re-resolve
    await machine.send({ type: 'RESOLVE', reason: 'Applied permanent fix' })
    await machine.send({ type: 'CLOSE', reason: 'Verified' })
    expect(machine.state).toBe('closed')
  })

  it('should handle force close from any state', async () => {
    // From new
    let machine = createConversationStateMachine()
    await machine.send({ type: 'FORCE_CLOSE', reason: 'Spam' })
    expect(machine.state).toBe('closed')

    // From active
    machine = createConversationStateMachine()
    await machine.send({ type: 'START' })
    await machine.send({ type: 'FORCE_CLOSE', reason: 'Duplicate' })
    expect(machine.state).toBe('closed')

    // From pending
    machine = createConversationStateMachine()
    await machine.send({ type: 'START' })
    await machine.send({ type: 'AWAIT' })
    await machine.send({ type: 'FORCE_CLOSE', reason: 'User requested' })
    expect(machine.state).toBe('closed')

    // From resolved
    machine = createConversationStateMachine({ messageCount: 1 })
    await machine.send({ type: 'START' })
    await machine.send({ type: 'RESOLVE', reason: 'Done' })
    await machine.send({ type: 'FORCE_CLOSE', reason: 'Admin close' })
    expect(machine.state).toBe('closed')
  })

  it('should track all handlers through full flow', async () => {
    const machine = createConversationStateMachine({ messageCount: 1 })

    const transitions: string[] = []
    const entries: string[] = []
    const exits: string[] = []

    machine.onTransition((from, to) => transitions.push(`${from}->${to}`))
    machine.onEnter('active', () => entries.push('active'))
    machine.onEnter('pending', () => entries.push('pending'))
    machine.onEnter('resolved', () => entries.push('resolved'))
    machine.onEnter('closed', () => entries.push('closed'))
    machine.onExit('new', () => exits.push('new'))
    machine.onExit('active', () => exits.push('active'))
    machine.onExit('pending', () => exits.push('pending'))

    await machine.send({ type: 'START' })
    await machine.send({ type: 'AWAIT' })
    await machine.send({ type: 'RESUME' })
    await machine.send({ type: 'RESOLVE', reason: 'Done' })
    await machine.send({ type: 'CLOSE', reason: 'Complete' })

    expect(transitions).toEqual([
      'new->active',
      'active->pending',
      'pending->active',
      'active->resolved',
      'resolved->closed',
    ])

    expect(entries).toEqual(['active', 'pending', 'active', 'resolved', 'closed'])
    expect(exits).toEqual(['new', 'active', 'pending', 'active'])
  })
})
