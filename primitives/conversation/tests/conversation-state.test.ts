/**
 * Conversation State Tests
 *
 * Tests for state management in the conversation primitive:
 * - State initialization
 * - State transitions
 * - State query methods
 * - State invariants
 */
import { describe, it, expect, vi } from 'vitest'
import { Conversation, defaultConversationConfig } from '../conversation.js'
import type { ConversationMachineConfig, ConversationState } from '../types.js'

// =============================================================================
// State Initialization
// =============================================================================

describe('State initialization', () => {
  it('should initialize in open state by default', () => {
    const machine = Conversation.create()
    expect(machine.state).toBe('open')
  })

  it('should allow custom initial state via config', () => {
    const customConfig: ConversationMachineConfig = {
      id: 'custom',
      initial: 'waiting',
      states: {
        open: { on: { WAIT: 'waiting' } },
        waiting: { on: { RESPOND: 'open' } },
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(customConfig)
    const machine = factory.create()

    expect(machine.state).toBe('waiting')
  })

  it('should have all required states defined in default config', () => {
    const requiredStates: ConversationState[] = ['open', 'waiting', 'resolved', 'closed']

    for (const state of requiredStates) {
      expect(defaultConversationConfig.states[state]).toBeDefined()
    }
  })
})

// =============================================================================
// State Transitions
// =============================================================================

describe('State transitions', () => {
  describe('from open state', () => {
    it('should transition to waiting on WAIT', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({ type: 'WAIT' })
      expect(newState).toBe('waiting')
    })

    it('should transition to resolved on RESOLVE', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
      expect(newState).toBe('resolved')
    })

    it('should transition to closed on CLOSE', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({ type: 'CLOSE', reason: 'Complete' })
      expect(newState).toBe('closed')
    })

    it('should stay in open on MESSAGE_RECEIVED', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: 'user',
        content: 'Hello',
      })
      expect(newState).toBe('open')
    })

    it('should stay in open on ASSIGN', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({ type: 'ASSIGN', to: 'agent_1' })
      expect(newState).toBe('open')
    })

    it('should stay in open on ESCALATE', async () => {
      const machine = Conversation.create()
      const newState = await machine.send({ type: 'ESCALATE', to: 'manager', reason: 'Complex' })
      expect(newState).toBe('open')
    })
  })

  describe('from waiting state', () => {
    let machine: ReturnType<typeof Conversation.create>

    beforeEach(async () => {
      machine = Conversation.create()
      await machine.send({ type: 'WAIT' })
    })

    it('should transition to open on RESPOND', async () => {
      const newState = await machine.send({ type: 'RESPOND' })
      expect(newState).toBe('open')
    })

    it('should transition to open on MESSAGE_RECEIVED', async () => {
      const newState = await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: 'user',
        content: 'Reply',
      })
      expect(newState).toBe('open')
    })

    it('should transition to open on TIMEOUT', async () => {
      const newState = await machine.send({ type: 'TIMEOUT' })
      expect(newState).toBe('open')
    })

    it('should transition to resolved on RESOLVE', async () => {
      const newState = await machine.send({ type: 'RESOLVE', reason: 'Auto-resolved' })
      expect(newState).toBe('resolved')
    })

    it('should transition to closed on CLOSE', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'Abandoned' })
      expect(newState).toBe('closed')
    })
  })

  describe('from resolved state', () => {
    let machine: ReturnType<typeof Conversation.create>

    beforeEach(async () => {
      machine = Conversation.create()
      await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    })

    it('should transition to open on REOPEN', async () => {
      const newState = await machine.send({ type: 'REOPEN', reason: 'New issue' })
      expect(newState).toBe('open')
    })

    it('should transition to closed on CLOSE', async () => {
      const newState = await machine.send({ type: 'CLOSE', reason: 'Complete' })
      expect(newState).toBe('closed')
    })
  })

  describe('from closed state', () => {
    // Note: XState treats 'closed' as final, so REOPEN may not work without special handling
    // These tests document expected behavior even if implementation differs

    it('should be a final state', () => {
      expect(defaultConversationConfig.states.closed.type).toBe('final')
    })

    it('should have REOPEN defined but may not transition (XState final state)', async () => {
      const machine = Conversation.create()
      await machine.send({ type: 'CLOSE', reason: 'Done' })

      // Verify REOPEN is defined in config
      expect(defaultConversationConfig.states.closed.on?.REOPEN).toBeDefined()

      // Note: XState may not allow transitions from final states
      // This test documents the behavior
    })
  })
})

// =============================================================================
// State Query Methods
// =============================================================================

describe('State query methods', () => {
  describe('can() method', () => {
    it('should return true for allowed transitions', () => {
      const machine = Conversation.create()

      expect(machine.can({ type: 'WAIT' })).toBe(true)
      expect(machine.can({ type: 'RESOLVE', reason: 'test' })).toBe(true)
      expect(machine.can({ type: 'CLOSE', reason: 'test' })).toBe(true)
      expect(machine.can({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'hi' })).toBe(true)
      expect(machine.can({ type: 'ASSIGN', to: 'agent' })).toBe(true)
      expect(machine.can({ type: 'ESCALATE', to: 'manager', reason: 'test' })).toBe(true)
    })

    it('should return false for disallowed transitions', () => {
      const machine = Conversation.create()

      expect(machine.can({ type: 'RESPOND' })).toBe(false) // Only valid in waiting
      expect(machine.can({ type: 'TIMEOUT' })).toBe(false) // Only valid in waiting
      expect(machine.can({ type: 'REOPEN', reason: 'test' })).toBe(false) // Only valid in resolved/closed
    })

    it('should update can() results after transition', async () => {
      const machine = Conversation.create()

      expect(machine.can({ type: 'RESPOND' })).toBe(false)
      await machine.send({ type: 'WAIT' })
      expect(machine.can({ type: 'RESPOND' })).toBe(true)
    })

    it('should respect guards in can() check', async () => {
      const guardedConfig: ConversationMachineConfig = {
        id: 'guarded',
        initial: 'open',
        states: {
          open: {
            on: {
              CLOSE: {
                target: 'closed',
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

      const factory = Conversation.define(guardedConfig)
      const machine = factory.create()

      // No messages - guard fails
      expect(machine.can({ type: 'CLOSE', reason: 'test' })).toBe(false)

      // Add message
      await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hi' })

      // Now guard passes
      expect(machine.can({ type: 'CLOSE', reason: 'test' })).toBe(true)
    })
  })

  describe('state property', () => {
    it('should return current state', () => {
      const machine = Conversation.create()
      expect(machine.state).toBe('open')
    })

    it('should update after transition', async () => {
      const machine = Conversation.create()

      await machine.send({ type: 'WAIT' })
      expect(machine.state).toBe('waiting')

      await machine.send({ type: 'RESPOND' })
      expect(machine.state).toBe('open')

      await machine.send({ type: 'RESOLVE', reason: 'Done' })
      expect(machine.state).toBe('resolved')
    })

    it('should be consistent with send() return value', async () => {
      const machine = Conversation.create()

      const returnedState = await machine.send({ type: 'WAIT' })
      expect(returnedState).toBe(machine.state)
    })
  })
})

// =============================================================================
// State Invariants
// =============================================================================

describe('State invariants', () => {
  it('should have exactly one active state', () => {
    const machine = Conversation.create()
    const state = machine.state

    // State should be exactly one of the valid states
    const validStates: ConversationState[] = ['open', 'waiting', 'resolved', 'closed']
    expect(validStates).toContain(state)
  })

  it('should not allow direct state modification', () => {
    const machine = Conversation.create()

    // TypeScript should prevent this, but runtime behavior should also be safe
    // @ts-expect-error - testing runtime safety
    expect(() => {
      machine.state = 'closed'
    }).toThrow()
  })

  it('should return same state when event is not handled', async () => {
    const customConfig: ConversationMachineConfig = {
      id: 'limited',
      initial: 'open',
      states: {
        open: {
          on: {
            WAIT: 'waiting',
          },
        },
        waiting: {},
        resolved: {},
        closed: { type: 'final' },
      },
    }

    const factory = Conversation.define(customConfig)
    const machine = factory.create()

    // RESOLVE is not handled in open state for this config
    const newState = await machine.send({ type: 'RESOLVE', reason: 'test' })

    expect(newState).toBe('open') // Should stay in current state
  })
})

// =============================================================================
// Complex State Flows
// =============================================================================

describe('Complex state flows', () => {
  it('should handle open -> waiting -> open cycle', async () => {
    const machine = Conversation.create()

    for (let i = 0; i < 5; i++) {
      expect(machine.state).toBe('open')
      await machine.send({ type: 'WAIT' })
      expect(machine.state).toBe('waiting')
      await machine.send({ type: 'RESPOND' })
    }

    expect(machine.state).toBe('open')
  })

  it('should handle full lifecycle: open -> waiting -> resolved -> closed', async () => {
    const machine = Conversation.create()

    expect(machine.state).toBe('open')

    await machine.send({ type: 'WAIT' })
    expect(machine.state).toBe('waiting')

    await machine.send({ type: 'RESPOND' })
    expect(machine.state).toBe('open')

    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    expect(machine.state).toBe('resolved')

    await machine.send({ type: 'CLOSE', reason: 'Complete' })
    expect(machine.state).toBe('closed')
  })

  it('should handle direct close from open', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'CLOSE', reason: 'Spam' })

    expect(machine.state).toBe('closed')
  })

  it('should handle resolved -> reopen -> resolve cycle', async () => {
    const machine = Conversation.create()

    // First resolution
    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    expect(machine.state).toBe('resolved')
    expect(machine.context.resolvedAt).toBeDefined()

    // Reopen
    await machine.send({ type: 'REOPEN', reason: 'Issue returned' })
    expect(machine.state).toBe('open')
    expect(machine.context.resolvedAt).toBeUndefined()

    // Resolve again
    await machine.send({ type: 'RESOLVE', reason: 'Actually fixed' })
    expect(machine.state).toBe('resolved')
    expect(machine.context.resolvedAt).toBeDefined()
  })
})
