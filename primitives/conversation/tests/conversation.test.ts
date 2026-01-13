/**
 * Conversation State Machine - XState v5
 *
 * TDD test suite following strict red-green-refactor cycles.
 * Tests for conversation lifecycle: open -> waiting -> resolved -> closed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Conversation, defaultConversationConfig } from '../conversation.js'
import type {
  ConversationMachineConfig,
  ConversationContext,
  ConversationStorage,
  CoreConversationEvent,
} from '../types.js'

// =============================================================================
// Test Helpers
// =============================================================================

const createMockStorage = (): ConversationStorage => {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    put: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    }),
    delete: vi.fn((key: string) => {
      store.delete(key)
      return Promise.resolve()
    }),
  }
}

// =============================================================================
// TDD Cycle 1: Conversation.create() with default config
// =============================================================================

describe('Conversation.create()', () => {
  it('should create a conversation machine with default config', () => {
    const machine = Conversation.create()

    expect(machine).toBeDefined()
    expect(machine.state).toBe('open')
  })

  it('should create machine with initial context', () => {
    const machine = Conversation.create({
      id: 'conv_123',
      channel: 'email',
      priority: 'high',
    })

    expect(machine.context.id).toBe('conv_123')
    expect(machine.context.channel).toBe('email')
    expect(machine.context.priority).toBe('high')
  })

  it('should generate conversation ID if not provided', () => {
    const machine = Conversation.create()

    expect(machine.context.id).toBeDefined()
    expect(machine.context.id.length).toBeGreaterThan(0)
  })

  it('should set createdAt and updatedAt timestamps', () => {
    const machine = Conversation.create()

    expect(machine.context.createdAt).toBeInstanceOf(Date)
    expect(machine.context.updatedAt).toBeInstanceOf(Date)
  })
})

// =============================================================================
// TDD Cycle 2: Conversation.define() for custom configs
// =============================================================================

describe('Conversation.define()', () => {
  it('should create a factory from custom config', () => {
    const customConfig: ConversationMachineConfig = {
      id: 'custom-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            CLOSE: 'closed',
          },
        },
        waiting: {},
        resolved: {},
        closed: {
          type: 'final',
        },
      },
    }

    const factory = Conversation.define(customConfig)

    expect(factory).toBeDefined()
    expect(factory.create).toBeInstanceOf(Function)
  })

  it('should create machine from custom factory', () => {
    const customConfig: ConversationMachineConfig = {
      id: 'custom-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            CLOSE: 'closed',
          },
        },
        waiting: {},
        resolved: {},
        closed: {
          type: 'final',
        },
      },
    }

    const factory = Conversation.define(customConfig)
    const machine = factory.create()

    expect(machine.state).toBe('open')
  })
})

// =============================================================================
// TDD Cycle 3: Core state transitions (open -> waiting -> resolved -> closed)
// =============================================================================

describe('Core state transitions', () => {
  describe('open state', () => {
    it('should start in open state', () => {
      const machine = Conversation.create()
      expect(machine.state).toBe('open')
    })

    it('should transition from open to waiting on WAIT event', async () => {
      const machine = Conversation.create()

      const newState = await machine.send({ type: 'WAIT' })

      expect(newState).toBe('waiting')
      expect(machine.state).toBe('waiting')
    })

    it('should transition from open to resolved on RESOLVE event', async () => {
      const machine = Conversation.create()

      const newState = await machine.send({ type: 'RESOLVE', reason: 'Issue fixed' })

      expect(newState).toBe('resolved')
      expect(machine.state).toBe('resolved')
    })

    it('should transition from open to closed on CLOSE event', async () => {
      const machine = Conversation.create()

      const newState = await machine.send({ type: 'CLOSE', reason: 'Completed' })

      expect(newState).toBe('closed')
      expect(machine.state).toBe('closed')
    })

    it('should stay in open state on MESSAGE_RECEIVED', async () => {
      const machine = Conversation.create()

      const newState = await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: 'user_123',
        content: 'Hello',
      })

      expect(newState).toBe('open')
      expect(machine.context.messages).toHaveLength(1)
    })

    it('should update assignedTo on ASSIGN event', async () => {
      const machine = Conversation.create()

      await machine.send({ type: 'ASSIGN', to: 'agent_456' })

      expect(machine.context.assignedTo).toBe('agent_456')
    })

    it('should record escalation on ESCALATE event', async () => {
      const machine = Conversation.create({ assignedTo: 'agent_1' })

      await machine.send({ type: 'ESCALATE', to: 'supervisor_1', reason: 'Complex issue' })

      expect(machine.context.escalationHistory).toHaveLength(1)
      expect(machine.context.escalationHistory[0].to).toBe('supervisor_1')
      expect(machine.context.escalationHistory[0].reason).toBe('Complex issue')
      expect(machine.context.assignedTo).toBe('supervisor_1')
    })
  })

  describe('waiting state', () => {
    let machine: ReturnType<typeof Conversation.create>

    beforeEach(async () => {
      machine = Conversation.create()
      await machine.send({ type: 'WAIT' })
    })

    it('should transition from waiting to open on RESPOND event', async () => {
      const newState = await machine.send({ type: 'RESPOND' })

      expect(newState).toBe('open')
      expect(machine.state).toBe('open')
    })

    it('should transition from waiting to open on MESSAGE_RECEIVED', async () => {
      const newState = await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: 'user_123',
        content: 'Response',
      })

      expect(newState).toBe('open')
      expect(machine.context.messages).toHaveLength(1)
    })

    it('should transition from waiting to open on TIMEOUT', async () => {
      const newState = await machine.send({ type: 'TIMEOUT' })

      expect(newState).toBe('open')
    })

    it('should transition from waiting to resolved on RESOLVE', async () => {
      const newState = await machine.send({ type: 'RESOLVE', reason: 'Auto-resolved' })

      expect(newState).toBe('resolved')
    })

    it('should transition from waiting to closed on CLOSE', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'No response' })

      expect(newState).toBe('closed')
    })
  })

  describe('resolved state', () => {
    let machine: ReturnType<typeof Conversation.create>

    beforeEach(async () => {
      machine = Conversation.create()
      await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    })

    it('should set resolvedAt timestamp when entering resolved state', () => {
      expect(machine.context.resolvedAt).toBeInstanceOf(Date)
      expect(machine.context.resolveReason).toBe('Fixed')
    })

    it('should transition from resolved to open on REOPEN', async () => {
      const newState = await machine.send({ type: 'REOPEN', reason: 'Customer follow-up' })

      expect(newState).toBe('open')
      expect(machine.context.resolvedAt).toBeUndefined()
    })

    it('should transition from resolved to closed on CLOSE', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'Verified complete' })

      expect(newState).toBe('closed')
      expect(machine.context.closedAt).toBeInstanceOf(Date)
    })
  })

  describe('closed state', () => {
    let machine: ReturnType<typeof Conversation.create>

    beforeEach(async () => {
      machine = Conversation.create()
      await machine.send({ type: 'CLOSE', reason: 'Completed' })
    })

    it('should set closedAt timestamp when entering closed state', () => {
      expect(machine.context.closedAt).toBeInstanceOf(Date)
      expect(machine.context.closeReason).toBe('Completed')
    })

    it('should transition from closed to open on REOPEN', async () => {
      const newState = await machine.send({ type: 'REOPEN', reason: 'Needs more work' })

      expect(newState).toBe('open')
      expect(machine.context.closedAt).toBeUndefined()
      expect(machine.context.closeReason).toBeUndefined()
    })
  })
})

// =============================================================================
// TDD Cycle 4: can() method for transition validation
// =============================================================================

describe('Conversation.can()', () => {
  it('should return true for valid transitions', () => {
    const machine = Conversation.create()

    expect(machine.can({ type: 'WAIT' })).toBe(true)
    expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(true)
    expect(machine.can({ type: 'CLOSE', reason: 'test' })).toBe(true)
  })

  it('should return false for invalid transitions', () => {
    const machine = Conversation.create()

    // Can't RESPOND from open state
    expect(machine.can({ type: 'RESPOND' })).toBe(false)
    // Can't REOPEN from open state
    expect(machine.can({ type: 'REOPEN', reason: 'test' })).toBe(false)
  })

  it('should update valid transitions after state change', async () => {
    const machine = Conversation.create()

    expect(machine.can({ type: 'WAIT' })).toBe(true)
    expect(machine.can({ type: 'RESPOND' })).toBe(false)

    await machine.send({ type: 'WAIT' })

    expect(machine.can({ type: 'WAIT' })).toBe(false)
    expect(machine.can({ type: 'RESPOND' })).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 5: Transition handlers (onTransition, onState)
// =============================================================================

describe('Conversation.onTransition()', () => {
  it('should call handler on every transition', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTransition(handler)

    await machine.send({ type: 'WAIT' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('open', 'waiting', { type: 'WAIT' })
  })

  it('should return unsubscribe function', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    const unsubscribe = machine.onTransition(handler)
    await machine.send({ type: 'WAIT' })
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()
    await machine.send({ type: 'RESPOND' })
    expect(handler).toHaveBeenCalledTimes(1) // Not called again
  })

  it('should not call handler when state does not change', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTransition(handler)

    // MESSAGE_RECEIVED keeps us in open state
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'hi' })

    // Handler should not be called since state stayed 'open'
    // Note: This depends on implementation - if actions cause context changes
    // but state stays same, handler may or may not be called
    // Based on our implementation, it should NOT be called for same-state transitions
    expect(handler).toHaveBeenCalledTimes(0)
  })
})

describe('Conversation.onState()', () => {
  it('should call handler when entering specific state', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onState('waiting', handler)

    await machine.send({ type: 'WAIT' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }))
  })

  it('should not call handler for other states', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onState('resolved', handler)

    await machine.send({ type: 'WAIT' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('should return unsubscribe function', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    const unsubscribe = machine.onState('waiting', handler)
    await machine.send({ type: 'WAIT' })
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()

    // Go back to open and then to waiting again
    await machine.send({ type: 'RESPOND' })
    await machine.send({ type: 'WAIT' })
    expect(handler).toHaveBeenCalledTimes(1) // Not called again
  })
})

// =============================================================================
// TDD Cycle 6: Timeout handling
// =============================================================================

describe('Conversation timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should set timeout configuration', () => {
    const machine = Conversation.create()

    machine.setTimeout('1h', 'escalate')

    expect(machine.context.timeout).toBeDefined()
    expect(machine.context.timeout?.duration).toBe('1h')
    expect(machine.context.timeout?.action).toBe('escalate')
    expect(machine.context.timeout?.expiresAt).toBeInstanceOf(Date)
  })

  it('should call timeout handler after duration', () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTimeout(handler)
    machine.setTimeout('1h', 'escalate')

    // Advance time by 1 hour
    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }))
  })

  it('should clear timeout on state transition', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTimeout(handler)
    machine.setTimeout('1h', 'escalate')

    await machine.send({ type: 'WAIT' })

    // Timeout should be cleared
    expect(machine.context.timeout).toBeUndefined()

    // Advance time - handler should not be called
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('should clear timeout manually', () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTimeout(handler)
    machine.setTimeout('1h', 'escalate')

    machine.clearTimeout()

    expect(machine.context.timeout).toBeUndefined()

    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('should send TIMEOUT event when timeout fires', async () => {
    const machine = Conversation.create()
    await machine.send({ type: 'WAIT' })

    const transitionHandler = vi.fn()
    machine.onTransition(transitionHandler)

    machine.setTimeout('30m', 'notify')

    // Advance time by 30 minutes
    vi.advanceTimersByTime(30 * 60 * 1000)

    // Allow the async send() to complete
    await vi.waitFor(() => expect(machine.state).toBe('open'))

    // TIMEOUT event should transition from waiting to open
    expect(machine.state).toBe('open')
    expect(transitionHandler).toHaveBeenCalledWith('waiting', 'open', { type: 'TIMEOUT' })
  })

  it('should parse various duration formats', () => {
    const machine = Conversation.create()

    machine.setTimeout('100ms', 'notify')
    vi.advanceTimersByTime(100)
    machine.clearTimeout()

    machine.setTimeout('5s', 'notify')
    vi.advanceTimersByTime(5000)
    machine.clearTimeout()

    machine.setTimeout('10m', 'notify')
    vi.advanceTimersByTime(10 * 60 * 1000)
    machine.clearTimeout()

    machine.setTimeout('24h', 'notify')
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    machine.clearTimeout()

    machine.setTimeout('7d', 'notify')
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000)

    // All timeouts should have fired without error
    expect(true).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 7: Persistence (persist/restore)
// =============================================================================

describe('Conversation persistence', () => {
  let mockStorage: ConversationStorage

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should persist current state to storage', async () => {
    const machine = Conversation.create({ id: 'conv_persist' }, mockStorage)

    await machine.send({ type: 'WAIT' })
    await machine.persist()

    expect(mockStorage.put).toHaveBeenCalled()
  })

  it('should restore state from storage', async () => {
    // Create and persist first machine
    const machine1 = Conversation.create({ id: 'conv_restore' }, mockStorage)
    await machine1.send({ type: 'WAIT' })
    await machine1.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello',
    })
    await machine1.persist()
    machine1.stop()

    // Create new machine and restore
    const machine2 = Conversation.create({ id: 'conv_restore' }, mockStorage)
    await machine2.restore('conv_restore')

    expect(machine2.state).toBe('open') // MESSAGE_RECEIVED transitions from waiting to open
  })

  it('should handle restore when no persisted state exists', async () => {
    const machine = Conversation.create({ id: 'conv_new' }, mockStorage)

    await machine.restore('nonexistent')

    // Should stay in initial state
    expect(machine.state).toBe('open')
  })

  it('should throw error when persisting without storage', async () => {
    const machine = Conversation.create()

    await expect(machine.persist()).rejects.toThrow(/No storage configured/)
  })

  it('should throw error when restoring without storage', async () => {
    const machine = Conversation.create()

    await expect(machine.restore('test')).rejects.toThrow(/No storage configured/)
  })
})

// =============================================================================
// TDD Cycle 8: Guards and actions
// =============================================================================

describe('Guards and actions', () => {
  it('should block transition when guard returns false', async () => {
    const configWithGuard: ConversationMachineConfig = {
      id: 'guarded-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            RESOLVE: {
              target: 'resolved',
              guard: (ctx) => ctx.messages.length > 0,
            },
          },
        },
        waiting: {},
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(configWithGuard)
    const machine = factory.create()

    // No messages, guard should block
    const newState = await machine.send({ type: 'RESOLVE', reason: 'test' })

    expect(newState).toBe('open')
    expect(machine.state).toBe('open')
  })

  it('should allow transition when guard returns true', async () => {
    const configWithGuard: ConversationMachineConfig = {
      id: 'guarded-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            RESOLVE: {
              target: 'resolved',
              guard: (ctx) => ctx.messages.length > 0,
            },
            MESSAGE_RECEIVED: {
              target: 'open',
              actions: [
                (ctx, event) => {
                  if (event.type !== 'MESSAGE_RECEIVED') return ctx
                  return {
                    ...ctx,
                    messages: [
                      ...ctx.messages,
                      {
                        id: `msg_${Date.now()}`,
                        from: event.from,
                        content: event.content,
                        contentType: 'text/plain' as const,
                        createdAt: new Date(),
                      },
                    ],
                  }
                },
              ],
            },
          },
        },
        waiting: {},
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(configWithGuard)
    const machine = factory.create()

    // Add a message first
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'test' })

    // Now resolve should work
    const newState = await machine.send({ type: 'RESOLVE', reason: 'test' })

    expect(newState).toBe('resolved')
  })

  it('should execute entry actions on state entry', async () => {
    const entryAction = vi.fn((ctx) => ({
      ...ctx,
      metadata: { ...ctx.metadata, enteredWaiting: true },
    }))

    const configWithEntry: ConversationMachineConfig = {
      id: 'entry-action-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            WAIT: 'waiting',
          },
        },
        waiting: {
          entry: [entryAction],
          on: {
            RESPOND: 'open',
          },
        },
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(configWithEntry)
    const machine = factory.create()

    await machine.send({ type: 'WAIT' })

    expect(entryAction).toHaveBeenCalled()
    expect(machine.context.metadata.enteredWaiting).toBe(true)
  })

  it('should execute exit actions on state exit', async () => {
    const exitAction = vi.fn((ctx) => ({
      ...ctx,
      metadata: { ...ctx.metadata, exitedWaiting: true },
    }))

    const configWithExit: ConversationMachineConfig = {
      id: 'exit-action-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            WAIT: 'waiting',
          },
        },
        waiting: {
          exit: [exitAction],
          on: {
            RESPOND: 'open',
          },
        },
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(configWithExit)
    const machine = factory.create()

    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'RESPOND' })

    expect(exitAction).toHaveBeenCalled()
    expect(machine.context.metadata.exitedWaiting).toBe(true)
  })

  it('should reflect guard status in can()', async () => {
    const configWithGuard: ConversationMachineConfig = {
      id: 'can-guard-conversation',
      initial: 'open',
      states: {
        open: {
          on: {
            CLOSE: {
              target: 'closed',
              guard: (ctx) => ctx.priority === 'low',
            },
          },
        },
        waiting: {},
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(configWithGuard)
    const machine = factory.create({ priority: 'high' })

    // Guard should fail for high priority
    expect(machine.can({ type: 'CLOSE', reason: 'test' })).toBe(false)

    // Create another with low priority
    const machine2 = factory.create({ priority: 'low' })
    expect(machine2.can({ type: 'CLOSE', reason: 'test' })).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 9: Message handling
// =============================================================================

describe('Message handling', () => {
  it('should add messages to context on MESSAGE_RECEIVED', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello, I need help',
    })

    expect(machine.context.messages).toHaveLength(1)
    expect(machine.context.messages[0].from).toBe('user_123')
    expect(machine.context.messages[0].content).toBe('Hello, I need help')
    expect(machine.context.messages[0].createdAt).toBeInstanceOf(Date)
  })

  it('should accumulate multiple messages', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Message 1',
    })
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'agent_456',
      content: 'Message 2',
    })
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Message 3',
    })

    expect(machine.context.messages).toHaveLength(3)
    expect(machine.context.messages[0].content).toBe('Message 1')
    expect(machine.context.messages[1].content).toBe('Message 2')
    expect(machine.context.messages[2].content).toBe('Message 3')
  })

  it('should update updatedAt on message received', async () => {
    const machine = Conversation.create()
    const originalUpdatedAt = machine.context.updatedAt

    await new Promise((resolve) => setTimeout(resolve, 10))

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello',
    })

    expect(machine.context.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })
})

// =============================================================================
// TDD Cycle 10: Full conversation flow integration
// =============================================================================

describe('Integration: Full conversation flow', () => {
  it('should complete support ticket flow', async () => {
    const machine = Conversation.create({
      id: 'ticket_001',
      channel: 'email',
      subject: 'Login Issue',
    })

    expect(machine.state).toBe('open')

    // Customer sends initial message
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'I cannot log in',
    })

    // Assign to agent
    await machine.send({ type: 'ASSIGN', to: 'agent_1' })
    expect(machine.context.assignedTo).toBe('agent_1')

    // Agent responds and waits for customer
    await machine.send({ type: 'WAIT', reason: 'Awaiting customer response' })
    expect(machine.state).toBe('waiting')

    // Customer responds
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'I tried that, still not working',
    })
    expect(machine.state).toBe('open')

    // Agent escalates
    await machine.send({
      type: 'ESCALATE',
      to: 'senior_agent_1',
      reason: 'Complex authentication issue',
    })
    expect(machine.context.assignedTo).toBe('senior_agent_1')
    expect(machine.context.escalationHistory).toHaveLength(1)

    // Senior agent resolves
    await machine.send({ type: 'RESOLVE', reason: 'Password reset completed' })
    expect(machine.state).toBe('resolved')
    expect(machine.context.resolvedAt).toBeInstanceOf(Date)

    // Close the ticket
    await machine.send({ type: 'CLOSE', reason: 'Issue resolved' })
    expect(machine.state).toBe('closed')
    expect(machine.context.closedAt).toBeInstanceOf(Date)
  })

  it('should handle reopening a closed conversation', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    await machine.send({ type: 'CLOSE', reason: 'Complete' })
    expect(machine.state).toBe('closed')

    // Customer has follow-up
    await machine.send({ type: 'REOPEN', reason: 'Issue recurred' })
    expect(machine.state).toBe('open')
    expect(machine.context.closedAt).toBeUndefined()
    expect(machine.context.resolvedAt).toBeUndefined()
  })

  it('should handle timeout-based escalation flow', async () => {
    vi.useFakeTimers()

    const machine = Conversation.create()

    // Go to waiting state and set timeout
    await machine.send({ type: 'WAIT', reason: 'Awaiting response' })
    machine.setTimeout('24h', 'escalate')

    const timeoutHandler = vi.fn()
    machine.onTimeout(timeoutHandler)

    // Fast forward 24 hours
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)

    expect(timeoutHandler).toHaveBeenCalled()
    // TIMEOUT event should have transitioned back to open
    expect(machine.state).toBe('open')

    vi.useRealTimers()
  })
})

// =============================================================================
// TDD Cycle 11: Default configuration validation
// =============================================================================

describe('Default configuration', () => {
  it('should export default conversation config', () => {
    expect(defaultConversationConfig).toBeDefined()
    expect(defaultConversationConfig.id).toBe('conversation')
    expect(defaultConversationConfig.initial).toBe('open')
    expect(defaultConversationConfig.states).toBeDefined()
  })

  it('should have all four states in default config', () => {
    const states = Object.keys(defaultConversationConfig.states)

    expect(states).toContain('open')
    expect(states).toContain('waiting')
    expect(states).toContain('resolved')
    expect(states).toContain('closed')
  })

  it('should allow REOPEN from closed state (not strictly final)', () => {
    // Closed is not marked as 'final' to allow REOPEN transitions
    expect(defaultConversationConfig.states.closed.on?.REOPEN).toBeDefined()
  })
})

// =============================================================================
// TDD Cycle 12: stop() method
// =============================================================================

describe('Conversation.stop()', () => {
  it('should stop the machine and clear timeouts', () => {
    vi.useFakeTimers()

    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTimeout(handler)
    machine.setTimeout('1h', 'notify')

    machine.stop()

    // Advance time - handler should not be called
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(handler).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})
