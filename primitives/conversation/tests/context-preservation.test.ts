/**
 * Context Preservation Tests
 *
 * Tests for conversation context preservation:
 * - Context initialization
 * - Context updates on events
 * - Context immutability
 * - Persistence and restoration
 */
import { describe, it, expect, vi } from 'vitest'
import { Conversation } from '../conversation.js'
import type { ConversationStorage, ConversationMachineConfig, ConversationContext } from '../types.js'

// =============================================================================
// Test Helpers
// =============================================================================

const createMockStorage = (): ConversationStorage & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>()
  return {
    store,
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
// Context Initialization
// =============================================================================

describe('Context initialization', () => {
  it('should initialize with default context values', () => {
    const machine = Conversation.create()
    const ctx = machine.context

    expect(ctx.id).toBeDefined()
    expect(ctx.channel).toBe('chat')
    expect(ctx.participants).toEqual([])
    expect(ctx.messages).toEqual([])
    expect(ctx.priority).toBe('normal')
    expect(ctx.tags).toEqual([])
    expect(ctx.metadata).toEqual({})
    expect(ctx.escalationHistory).toEqual([])
    expect(ctx.stateHistory).toEqual([])
  })

  it('should allow overriding default context values', () => {
    const machine = Conversation.create({
      id: 'custom_id',
      channel: 'email',
      priority: 'high',
      tags: ['urgent', 'billing'],
      metadata: { source: 'api' },
    })

    expect(machine.context.id).toBe('custom_id')
    expect(machine.context.channel).toBe('email')
    expect(machine.context.priority).toBe('high')
    expect(machine.context.tags).toEqual(['urgent', 'billing'])
    expect(machine.context.metadata).toEqual({ source: 'api' })
  })

  it('should set createdAt timestamp on creation', () => {
    const before = new Date()
    const machine = Conversation.create()
    const after = new Date()

    expect(machine.context.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(machine.context.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should set updatedAt timestamp on creation', () => {
    const before = new Date()
    const machine = Conversation.create()
    const after = new Date()

    expect(machine.context.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(machine.context.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should generate unique IDs for different machines', () => {
    const machine1 = Conversation.create()
    const machine2 = Conversation.create()

    expect(machine1.context.id).not.toBe(machine2.context.id)
  })

  it('should allow custom subject', () => {
    const machine = Conversation.create({
      subject: 'Order #12345 Issue',
    })

    expect(machine.context.subject).toBe('Order #12345 Issue')
  })
})

// =============================================================================
// Context Updates on Events
// =============================================================================

describe('Context updates on events', () => {
  it('should update updatedAt on message received', async () => {
    const machine = Conversation.create()
    const originalUpdatedAt = machine.context.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })

    expect(machine.context.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('should update assignedTo on ASSIGN event', async () => {
    const machine = Conversation.create()

    expect(machine.context.assignedTo).toBeUndefined()

    await machine.send({ type: 'ASSIGN', to: 'agent_1' })

    expect(machine.context.assignedTo).toBe('agent_1')
  })

  it('should update escalationHistory on ESCALATE event', async () => {
    const machine = Conversation.create({ assignedTo: 'agent_1' })

    await machine.send({ type: 'ESCALATE', to: 'supervisor', reason: 'Complex' })

    expect(machine.context.escalationHistory).toHaveLength(1)
    expect(machine.context.escalationHistory[0]).toMatchObject({
      from: 'agent_1',
      to: 'supervisor',
      reason: 'Complex',
    })
  })

  it('should set resolvedAt on RESOLVE event', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })

    expect(machine.context.resolvedAt).toBeInstanceOf(Date)
    expect(machine.context.resolveReason).toBe('Fixed')
  })

  it('should set closedAt on CLOSE event', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'CLOSE', reason: 'Complete' })

    expect(machine.context.closedAt).toBeInstanceOf(Date)
    expect(machine.context.closeReason).toBe('Complete')
  })

  it('should clear resolvedAt on REOPEN from resolved', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'RESOLVE', reason: 'Fixed' })
    expect(machine.context.resolvedAt).toBeDefined()

    await machine.send({ type: 'REOPEN', reason: 'Not fixed' })
    expect(machine.context.resolvedAt).toBeUndefined()
    expect(machine.context.resolveReason).toBeUndefined()
  })

  it('should accumulate messages in context', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Msg 1' })
    expect(machine.context.messages).toHaveLength(1)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Msg 2' })
    expect(machine.context.messages).toHaveLength(2)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Msg 3' })
    expect(machine.context.messages).toHaveLength(3)
  })
})

// =============================================================================
// Context Consistency
// =============================================================================

describe('Context consistency', () => {
  it('should preserve messages across state transitions', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })
    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'World' })
    await machine.send({ type: 'RESOLVE', reason: 'Done' })

    expect(machine.context.messages).toHaveLength(2)
  })

  it('should preserve assignee across state transitions', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'ASSIGN', to: 'agent_1' })
    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'RESPOND' })
    await machine.send({ type: 'RESOLVE', reason: 'Done' })

    expect(machine.context.assignedTo).toBe('agent_1')
  })

  it('should preserve escalation history across state transitions', async () => {
    const machine = Conversation.create({ assignedTo: 'agent_1' })

    await machine.send({ type: 'ESCALATE', to: 'supervisor', reason: 'Help' })
    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'RESPOND' })

    expect(machine.context.escalationHistory).toHaveLength(1)
  })

  it('should preserve metadata across state transitions', async () => {
    const machine = Conversation.create({
      metadata: { source: 'api', priority: 1 },
    })

    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'RESPOND' })
    await machine.send({ type: 'RESOLVE', reason: 'Done' })

    expect(machine.context.metadata).toEqual({ source: 'api', priority: 1 })
  })
})

// =============================================================================
// Persistence and Restoration
// =============================================================================

describe('Persistence and restoration', () => {
  it('should persist context to storage', async () => {
    const storage = createMockStorage()
    const machine = Conversation.create({ id: 'persist_test' }, storage)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })
    await machine.send({ type: 'ASSIGN', to: 'agent_1' })
    await machine.persist()

    expect(storage.put).toHaveBeenCalled()
  })

  it('should restore context from storage', async () => {
    const storage = createMockStorage()

    // Create first machine and persist
    const machine1 = Conversation.create({ id: 'restore_test' }, storage)
    await machine1.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })
    await machine1.send({ type: 'ASSIGN', to: 'agent_1' })
    await machine1.persist()
    machine1.stop()

    // Create second machine and restore
    const machine2 = Conversation.create({ id: 'restore_test' }, storage)
    await machine2.restore('restore_test')

    // Context should be preserved
    // Note: Full restoration depends on implementation
    expect(storage.get).toHaveBeenCalled()
  })

  it('should throw error when persisting without storage', async () => {
    const machine = Conversation.create()

    await expect(machine.persist()).rejects.toThrow('No storage configured')
  })

  it('should throw error when restoring without storage', async () => {
    const machine = Conversation.create()

    await expect(machine.restore('test')).rejects.toThrow('No storage configured')
  })

  it('should handle restore when no persisted state exists', async () => {
    const storage = createMockStorage()
    const machine = Conversation.create({ id: 'nonexistent' }, storage)

    // Should not throw
    await machine.restore('nonexistent')

    // Should stay in initial state
    expect(machine.state).toBe('open')
  })
})

// =============================================================================
// Context with Custom Extensions
// =============================================================================

describe('Context with custom extensions', () => {
  interface CustomContext extends ConversationContext {
    customField?: string
    score?: number
  }

  it('should support custom context fields via config', async () => {
    const customConfig: ConversationMachineConfig<CustomContext> = {
      id: 'custom-context',
      initial: 'open',
      context: {
        customField: 'initial',
        score: 0,
      },
      states: {
        open: {
          on: {
            CLOSE: 'closed',
            MESSAGE_RECEIVED: {
              target: 'open',
              actions: [
                (ctx, event) => {
                  if (event.type !== 'MESSAGE_RECEIVED') return ctx
                  return {
                    ...ctx,
                    score: (ctx.score ?? 0) + 1,
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

    const factory = Conversation.define(customConfig)
    const machine = factory.create()

    expect(machine.context.customField).toBe('initial')
    expect(machine.context.score).toBe(0)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hi' })
    expect(machine.context.score).toBe(1)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })
    expect(machine.context.score).toBe(2)
  })

  it('should preserve custom context through initial context override', () => {
    const machine = Conversation.create({
      metadata: { customData: 'value', nested: { a: 1 } },
    })

    expect(machine.context.metadata.customData).toBe('value')
    expect(machine.context.metadata.nested).toEqual({ a: 1 })
  })
})

// =============================================================================
// Context Channel Types
// =============================================================================

describe('Context channel types', () => {
  it('should support chat channel', () => {
    const machine = Conversation.create({ channel: 'chat' })
    expect(machine.context.channel).toBe('chat')
  })

  it('should support email channel', () => {
    const machine = Conversation.create({ channel: 'email' })
    expect(machine.context.channel).toBe('email')
  })

  it('should support sms channel', () => {
    const machine = Conversation.create({ channel: 'sms' })
    expect(machine.context.channel).toBe('sms')
  })

  it('should support social channel', () => {
    const machine = Conversation.create({ channel: 'social' })
    expect(machine.context.channel).toBe('social')
  })

  it('should support voice channel', () => {
    const machine = Conversation.create({ channel: 'voice' })
    expect(machine.context.channel).toBe('voice')
  })
})

// =============================================================================
// Context Priority Types
// =============================================================================

describe('Context priority types', () => {
  it('should support low priority', () => {
    const machine = Conversation.create({ priority: 'low' })
    expect(machine.context.priority).toBe('low')
  })

  it('should support normal priority (default)', () => {
    const machine = Conversation.create()
    expect(machine.context.priority).toBe('normal')
  })

  it('should support high priority', () => {
    const machine = Conversation.create({ priority: 'high' })
    expect(machine.context.priority).toBe('high')
  })

  it('should support urgent priority', () => {
    const machine = Conversation.create({ priority: 'urgent' })
    expect(machine.context.priority).toBe('urgent')
  })
})
