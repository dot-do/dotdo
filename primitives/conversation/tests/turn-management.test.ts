/**
 * Turn Management Tests
 *
 * Tests for turn-based conversation flow:
 * - Turn sequencing between participants
 * - Waiting for responses
 * - Timeout handling for turns
 * - Assignment and escalation turns
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Conversation } from '../conversation.js'
import type { ConversationMachineConfig } from '../types.js'

// =============================================================================
// Turn Sequencing
// =============================================================================

describe('Turn sequencing', () => {
  it('should allow customer to initiate conversation', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'I need help',
    })

    expect(machine.context.messages).toHaveLength(1)
    expect(machine.context.messages[0].from).toBe('customer_1')
  })

  it('should support back-and-forth messaging', async () => {
    const machine = Conversation.create()

    // Customer initiates
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'Question?',
    })

    // Agent responds
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'agent_1',
      content: 'Answer.',
    })

    // Customer follows up
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'Follow-up?',
    })

    // Agent responds again
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'agent_1',
      content: 'More info.',
    })

    expect(machine.context.messages).toHaveLength(4)
    expect(machine.context.messages[0].from).toBe('customer_1')
    expect(machine.context.messages[1].from).toBe('agent_1')
    expect(machine.context.messages[2].from).toBe('customer_1')
    expect(machine.context.messages[3].from).toBe('agent_1')
  })

  it('should allow multiple messages from same participant', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'First part' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Second part' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Third part' })

    expect(machine.context.messages).toHaveLength(3)
    expect(machine.context.messages.every((m) => m.from === 'user')).toBe(true)
  })
})

// =============================================================================
// Waiting for Responses
// =============================================================================

describe('Waiting for responses', () => {
  it('should transition to waiting when awaiting customer response', async () => {
    const machine = Conversation.create()

    // Agent handles initial message and waits for customer
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'customer', content: 'Help me' })
    await machine.send({ type: 'WAIT', reason: 'Awaiting customer response' })

    expect(machine.state).toBe('waiting')
  })

  it('should return to open when customer responds', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'WAIT' })
    expect(machine.state).toBe('waiting')

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer',
      content: 'Here is my response',
    })

    expect(machine.state).toBe('open')
  })

  it('should return to open on explicit RESPOND event', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'RESPOND' })

    expect(machine.state).toBe('open')
  })

  it('should handle waiting -> response cycle multiple times', async () => {
    const machine = Conversation.create()

    for (let i = 0; i < 3; i++) {
      await machine.send({ type: 'WAIT' })
      expect(machine.state).toBe('waiting')

      await machine.send({ type: 'MESSAGE_RECEIVED', from: 'customer', content: `Response ${i}` })
      expect(machine.state).toBe('open')
    }

    expect(machine.context.messages).toHaveLength(3)
  })
})

// =============================================================================
// Timeout Handling for Turns
// =============================================================================

describe('Timeout handling for turns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should fire timeout after specified duration', async () => {
    const machine = Conversation.create()
    const timeoutHandler = vi.fn()

    await machine.send({ type: 'WAIT' })
    machine.onTimeout(timeoutHandler)
    machine.setTimeout('30m', 'notify')

    vi.advanceTimersByTime(30 * 60 * 1000)

    expect(timeoutHandler).toHaveBeenCalledTimes(1)
  })

  it('should cancel timeout when response received', async () => {
    const machine = Conversation.create()
    const timeoutHandler = vi.fn()

    await machine.send({ type: 'WAIT' })
    machine.onTimeout(timeoutHandler)
    machine.setTimeout('1h', 'escalate')

    // Customer responds before timeout
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'customer', content: 'Response' })

    // Advance past original timeout
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)

    expect(timeoutHandler).not.toHaveBeenCalled()
  })

  it('should support different timeout durations', async () => {
    const machine = Conversation.create()
    const handler = vi.fn()

    machine.onTimeout(handler)

    // Test various durations
    const durations = ['100ms', '5s', '10m', '2h', '1d']

    for (const duration of durations) {
      machine.setTimeout(duration, 'notify')
      machine.clearTimeout()
    }

    // No errors should occur
    expect(true).toBe(true)
  })

  it('should send TIMEOUT event when timer fires', async () => {
    const machine = Conversation.create()
    await machine.send({ type: 'WAIT' })

    const transitionHandler = vi.fn()
    machine.onTransition(transitionHandler)

    machine.setTimeout('5s', 'notify')
    vi.advanceTimersByTime(5000)

    // Allow async processing
    await vi.waitFor(() => expect(machine.state).toBe('open'))

    expect(transitionHandler).toHaveBeenCalledWith('waiting', 'open', { type: 'TIMEOUT' })
  })
})

// =============================================================================
// Assignment Turns
// =============================================================================

describe('Assignment turns', () => {
  it('should assign conversation to agent', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'ASSIGN', to: 'agent_123' })

    expect(machine.context.assignedTo).toBe('agent_123')
  })

  it('should allow reassignment to different agent', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'ASSIGN', to: 'agent_1' })
    expect(machine.context.assignedTo).toBe('agent_1')

    await machine.send({ type: 'ASSIGN', to: 'agent_2' })
    expect(machine.context.assignedTo).toBe('agent_2')
  })

  it('should stay in open state after assignment', async () => {
    const machine = Conversation.create()

    const newState = await machine.send({ type: 'ASSIGN', to: 'agent_1' })

    expect(newState).toBe('open')
    expect(machine.state).toBe('open')
  })

  it('should update updatedAt on assignment', async () => {
    const machine = Conversation.create()
    const originalUpdatedAt = machine.context.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await machine.send({ type: 'ASSIGN', to: 'agent_1' })

    expect(machine.context.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })
})

// =============================================================================
// Escalation Turns
// =============================================================================

describe('Escalation turns', () => {
  it('should escalate to specified agent', async () => {
    const machine = Conversation.create({ assignedTo: 'agent_1' })

    await machine.send({ type: 'ESCALATE', to: 'supervisor_1', reason: 'Complex issue' })

    expect(machine.context.assignedTo).toBe('supervisor_1')
  })

  it('should record escalation in history', async () => {
    const machine = Conversation.create({ assignedTo: 'agent_1' })

    await machine.send({ type: 'ESCALATE', to: 'supervisor_1', reason: 'Complex issue' })

    expect(machine.context.escalationHistory).toHaveLength(1)
    expect(machine.context.escalationHistory[0]).toMatchObject({
      from: 'agent_1',
      to: 'supervisor_1',
      reason: 'Complex issue',
    })
    expect(machine.context.escalationHistory[0].at).toBeInstanceOf(Date)
  })

  it('should support multiple escalations', async () => {
    const machine = Conversation.create({ assignedTo: 'agent_1' })

    await machine.send({ type: 'ESCALATE', to: 'supervisor_1', reason: 'First escalation' })
    await machine.send({ type: 'ESCALATE', to: 'manager_1', reason: 'Second escalation' })
    await machine.send({ type: 'ESCALATE', to: 'director_1', reason: 'Third escalation' })

    expect(machine.context.escalationHistory).toHaveLength(3)
    expect(machine.context.assignedTo).toBe('director_1')
  })

  it('should record system as from when no assignee', async () => {
    const machine = Conversation.create() // No initial assignee

    await machine.send({ type: 'ESCALATE', to: 'agent_1', reason: 'Initial routing' })

    expect(machine.context.escalationHistory[0].from).toBe('system')
  })

  it('should stay in open state after escalation', async () => {
    const machine = Conversation.create()

    const newState = await machine.send({
      type: 'ESCALATE',
      to: 'supervisor',
      reason: 'Needs help',
    })

    expect(newState).toBe('open')
  })
})

// =============================================================================
// Turn-based Conversation Flow
// =============================================================================

describe('Turn-based conversation flow', () => {
  it('should handle complete support conversation', async () => {
    const machine = Conversation.create({ channel: 'chat' })

    // Customer initiates
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'My order is wrong',
    })

    // Route to agent
    await machine.send({ type: 'ASSIGN', to: 'agent_1' })

    // Agent acknowledges and waits for details
    await machine.send({ type: 'WAIT', reason: 'Awaiting order details' })

    // Customer provides details
    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_1',
      content: 'Order #12345, wrong size',
    })

    // Agent escalates for refund approval
    await machine.send({
      type: 'ESCALATE',
      to: 'supervisor_1',
      reason: 'Refund approval needed',
    })

    // Supervisor resolves
    await machine.send({ type: 'RESOLVE', reason: 'Refund approved and processed' })

    expect(machine.state).toBe('resolved')
    expect(machine.context.messages).toHaveLength(2)
    expect(machine.context.escalationHistory).toHaveLength(1)
    expect(machine.context.assignedTo).toBe('supervisor_1')
    expect(machine.context.resolvedAt).toBeDefined()
  })

  it('should track message flow correctly', async () => {
    const machine = Conversation.create()

    const messages = [
      { from: 'customer', content: 'Hello' },
      { from: 'ai_bot', content: 'Hi, how can I help?' },
      { from: 'customer', content: 'Billing question' },
      { from: 'ai_bot', content: 'Let me connect you to billing' },
      { from: 'agent', content: 'Hi, I can help with billing' },
      { from: 'customer', content: 'Thanks!' },
    ]

    for (const msg of messages) {
      await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: msg.from,
        content: msg.content,
      })
    }

    expect(machine.context.messages).toHaveLength(messages.length)

    for (let i = 0; i < messages.length; i++) {
      expect(machine.context.messages[i].from).toBe(messages[i].from)
      expect(machine.context.messages[i].content).toBe(messages[i].content)
    }
  })
})
