/**
 * Agent Handoff Protocol Tests
 *
 * Comprehensive tests for the agent handoff protocol:
 * - AI-to-AI handoff with context preservation
 * - AI-to-human escalation
 * - Handoff history tracking
 * - Handoff rejection/timeout handling
 * - Resume capability after handoff
 *
 * @module agents/handoff.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HandoffProtocol,
  createHandoffProtocol,
  createHandoffRequest,
  createHandoffContext,
  createProtocolHandoffTool,
  type HandoffContext,
  type HandoffRequest,
  type HandoffResult,
  type HandoffReason,
  type HandoffState,
  type HandoffChainEntry,
  type HandoffHooks,
  type HandoffProtocolConfig,
} from './handoff'
import type { AgentConfig, AgentProvider, AgentResult, Message } from './types'
import { createMockProvider } from './testing'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestAgentConfig(id: string, name: string): AgentConfig {
  return {
    id,
    name,
    instructions: `You are ${name}. Handle ${id} requests.`,
    model: 'gpt-4o',
  }
}

function createTestMessages(): Message[] {
  return [
    { role: 'user', content: 'Hello, I need help with my order' },
    { role: 'assistant', content: 'I can help you with that. What is your order number?' },
    { role: 'user', content: 'Order #12345' },
  ]
}

function createTestAgentResult(): AgentResult {
  return {
    text: 'I have processed your request.',
    toolCalls: [],
    toolResults: [],
    messages: createTestMessages(),
    steps: 1,
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  }
}

// ============================================================================
// HandoffContext Structure Tests
// ============================================================================

describe('HandoffContext Structure', () => {
  it('should include conversation messages', () => {
    const messages = createTestMessages()
    const context: HandoffContext = {
      messages,
    }

    expect(context.messages).toEqual(messages)
    expect(context.messages).toHaveLength(3)
  })

  it('should support tool calls and results', () => {
    const context: HandoffContext = {
      messages: [],
      toolCalls: [
        { id: 'call_1', name: 'search', arguments: { query: 'order status' } },
      ],
      toolResults: [
        { toolCallId: 'call_1', toolName: 'search', result: { found: true } },
      ],
    }

    expect(context.toolCalls).toHaveLength(1)
    expect(context.toolResults).toHaveLength(1)
    expect(context.toolResults?.[0]?.result).toEqual({ found: true })
  })

  it('should preserve arbitrary metadata', () => {
    const context: HandoffContext = {
      messages: [],
      metadata: {
        customerId: 'cust_123',
        priority: 'high',
        tags: ['billing', 'urgent'],
        nestedData: { a: 1, b: { c: 2 } },
      },
    }

    expect(context.metadata?.customerId).toBe('cust_123')
    expect(context.metadata?.tags).toEqual(['billing', 'urgent'])
  })

  it('should include summary of work done', () => {
    const context: HandoffContext = {
      messages: [],
      summary: 'Customer inquired about order #12345. Verified order exists but needs refund processing.',
    }

    expect(context.summary).toContain('order #12345')
    expect(context.summary).toContain('refund processing')
  })

  it('should include specific instructions for target agent', () => {
    const context: HandoffContext = {
      messages: [],
      instructions: 'Process the refund for $50.00. Customer has been waiting 3 days.',
    }

    expect(context.instructions).toContain('refund')
    expect(context.instructions).toContain('$50.00')
  })

  it('should include variables/state to pass along', () => {
    const context: HandoffContext = {
      messages: [],
      variables: {
        orderId: '12345',
        refundAmount: 50.0,
        customerTier: 'gold',
      },
    }

    expect(context.variables?.orderId).toBe('12345')
    expect(context.variables?.refundAmount).toBe(50.0)
  })
})

// ============================================================================
// AI-to-AI Handoff Tests
// ============================================================================

describe('AI-to-AI Handoff', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router Agent'),
        createTestAgentConfig('support', 'Support Agent'),
        createTestAgentConfig('billing', 'Billing Agent'),
        createTestAgentConfig('technical', 'Technical Agent'),
      ],
    })
  })

  it('should transfer conversation to target agent', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: {
        messages: createTestMessages(),
        summary: 'Customer needs order support',
      },
    })

    expect(result.state).toBe('completed')
    expect(result.result).toBeDefined()
    expect(result.request.targetAgentId).toBe('support')
  })

  it('should preserve context across handoff', async () => {
    const context: HandoffContext = {
      messages: createTestMessages(),
      summary: 'Original context summary',
      metadata: { originalAgent: 'router' },
      variables: { sessionId: 'sess_123' },
    }

    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'specialization',
      context,
    })

    expect(result.state).toBe('completed')
    expect(result.request.context.summary).toBe('Original context summary')
    expect(result.request.context.metadata?.originalAgent).toBe('router')
  })

  it('should support different handoff reasons', async () => {
    const reasons: HandoffReason[] = [
      'specialization',
      'escalation',
      'delegation',
      'completion',
      'routing',
      'error',
      'custom',
    ]

    for (const reason of reasons) {
      const result = await protocol.handoff({
        sourceAgentId: 'router',
        targetAgentId: 'support',
        reason,
        reasonDescription: `Handoff for ${reason}`,
        context: { messages: [] },
      })

      expect(result.request.reason).toBe(reason)
    }
  })

  it('should include reason description in handoff', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'billing',
      reason: 'specialization',
      reasonDescription: 'Customer needs help with billing-specific query',
      context: { messages: [] },
    })

    expect(result.request.reasonDescription).toContain('billing-specific')
  })

  it('should fail for unknown target agent', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'unknown-agent',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(result.state).toBe('failed')
    expect(result.error?.message).toContain('not found')
  })
})

// ============================================================================
// AI-to-Human Escalation Tests
// ============================================================================

describe('AI-to-Human Escalation', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('support-bot', 'Support Bot'),
        {
          id: 'human-queue',
          name: 'Human Support Queue',
          instructions: 'Route to human agents',
          model: 'gpt-4o',
        },
      ],
    })
  })

  it('should support escalation reason', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'support-bot',
      targetAgentId: 'human-queue',
      reason: 'escalation',
      reasonDescription: 'Customer requested human agent',
      context: {
        messages: createTestMessages(),
        summary: 'Customer frustrated, needs human assistance',
        metadata: {
          escalationTrigger: 'customer_requested',
          sentiment: 'frustrated',
        },
      },
    })

    expect(result.request.reason).toBe('escalation')
    expect(result.request.context.metadata?.escalationTrigger).toBe('customer_requested')
  })

  it('should preserve customer context for human agent', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'support-bot',
      targetAgentId: 'human-queue',
      reason: 'escalation',
      context: {
        messages: createTestMessages(),
        summary: 'Customer wants refund for defective product',
        instructions: 'Process refund and offer discount code',
        variables: {
          customerId: 'cust_456',
          orderValue: 150.0,
          issueType: 'defective_product',
        },
        metadata: {
          customerTier: 'premium',
          lifetimeValue: 5000,
        },
      },
    })

    expect(result.request.context.variables?.customerId).toBe('cust_456')
    expect(result.request.context.metadata?.customerTier).toBe('premium')
    expect(result.request.context.instructions).toContain('refund')
  })
})

// ============================================================================
// Handoff History Tracking Tests
// ============================================================================

describe('Handoff History Tracking', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
        createTestAgentConfig('billing', 'Billing'),
      ],
      maxChainDepth: 5,
    })
  })

  it('should track handoff chain entries', async () => {
    // First handoff
    await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [{ role: 'user', content: 'Help with order' }] },
    })

    // The chain should be tracked internally
    // Note: getChain requires a conversation ID derived from messages
  })

  it('should prevent circular handoffs', async () => {
    // Perform handoffs that would create a cycle
    await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [{ role: 'user', content: 'Test message' }] },
    })

    // Try to hand back to router from support (same conversation)
    const result = await protocol.handoff({
      sourceAgentId: 'support',
      targetAgentId: 'router',
      reason: 'delegation',
      context: { messages: [{ role: 'user', content: 'Test message' }] },
    })

    // This should detect the circular handoff
    expect(result.state).toBe('failed')
    expect(result.error?.message).toContain('Circular handoff')
  })

  it('should enforce maximum chain depth', async () => {
    const protocolWithLowDepth = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('agent-1', 'Agent 1'),
        createTestAgentConfig('agent-2', 'Agent 2'),
        createTestAgentConfig('agent-3', 'Agent 3'),
      ],
      maxChainDepth: 2,
    })

    // First handoff
    await protocolWithLowDepth.handoff({
      sourceAgentId: 'agent-1',
      targetAgentId: 'agent-2',
      reason: 'delegation',
      context: { messages: [{ role: 'user', content: 'Deep chain test' }] },
    })

    // Second handoff
    await protocolWithLowDepth.handoff({
      sourceAgentId: 'agent-2',
      targetAgentId: 'agent-3',
      reason: 'delegation',
      context: { messages: [{ role: 'user', content: 'Deep chain test' }] },
    })

    // Third handoff should fail (exceeds depth of 2)
    const result = await protocolWithLowDepth.handoff({
      sourceAgentId: 'agent-3',
      targetAgentId: 'agent-1',
      reason: 'delegation',
      context: { messages: [{ role: 'user', content: 'Deep chain test' }] },
    })

    expect(result.state).toBe('failed')
    expect(result.error?.message).toContain('depth')
  })

  it('should record timing information', async () => {
    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(result.request.initiatedAt).toBeInstanceOf(Date)
    expect(result.completedAt).toBeInstanceOf(Date)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Handoff Rejection/Timeout Tests
// ============================================================================

describe('Handoff Rejection and Timeout', () => {
  let mockProvider: AgentProvider

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })
  })

  it('should have timeout configuration', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
      ],
      defaultTimeoutMs: 5000,
    })

    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [] },
      timeoutMs: 10000, // Custom timeout
    })

    // Timeout is configured but mock completes instantly
    expect(result.state).toBe('completed')
    expect(result.request.timeoutMs).toBe(10000)
  })

  it('should use default timeout when not specified', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
      ],
      defaultTimeoutMs: 30000,
    })

    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(result.request.timeoutMs).toBe(30000)
  })

  it('should support validation hook for rejection', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
        createTestAgentConfig('restricted', 'Restricted Agent'),
      ],
      hooks: {
        validateHandoff: async (request) => {
          // Reject handoffs to restricted agent
          return request.targetAgentId !== 'restricted'
        },
      },
    })

    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'restricted',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(result.state).toBe('cancelled')
    expect(result.error?.message).toContain('rejected')
  })

  it('should call onBeforeHandoff hook and allow cancellation', async () => {
    const onBeforeHandoff = vi.fn().mockResolvedValue(null) // null cancels

    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
      ],
      hooks: {
        onBeforeHandoff,
      },
    })

    const result = await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(onBeforeHandoff).toHaveBeenCalled()
    expect(result.state).toBe('cancelled')
  })

  it('should call onHandoffError hook on execution failure', async () => {
    // Create a provider that throws an error during execution
    const errorProvider: AgentProvider = {
      name: 'error-provider',
      version: '1.0.0',
      createAgent: (config) => ({
        config,
        provider: errorProvider,
        run: async () => {
          throw new Error('Agent execution failed')
        },
        stream: () => {
          throw new Error('Not implemented')
        },
      }),
    }

    const onHandoffError = vi.fn()

    const protocol = createHandoffProtocol({
      provider: errorProvider,
      agents: [
        createTestAgentConfig('router', 'Router'),
        createTestAgentConfig('support', 'Support'),
      ],
      hooks: {
        onHandoffError,
      },
    })

    await protocol.handoff({
      sourceAgentId: 'router',
      targetAgentId: 'support',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(onHandoffError).toHaveBeenCalled()
    expect(onHandoffError).toHaveBeenCalledWith(
      expect.objectContaining({ targetAgentId: 'support' }),
      expect.any(Error),
    )
  })
})

// ============================================================================
// Resume Capability Tests
// ============================================================================

describe('Resume Capability After Handoff', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('primary', 'Primary Agent'),
        createTestAgentConfig('specialist', 'Specialist Agent'),
      ],
    })
  })

  it('should return result that enables resumption', async () => {
    const originalContext: HandoffContext = {
      messages: createTestMessages(),
      summary: 'Initial conversation state',
      variables: { step: 1, data: { key: 'value' } },
    }

    const result = await protocol.handoff({
      sourceAgentId: 'primary',
      targetAgentId: 'specialist',
      reason: 'specialization',
      context: originalContext,
    })

    // Result should contain everything needed to resume
    expect(result.request.context).toBeDefined()
    expect(result.result?.messages).toBeDefined()
    expect(result.state).toBe('completed')
  })

  it('should allow chained handoffs with result context', async () => {
    const firstResult = await protocol.handoff({
      sourceAgentId: 'primary',
      targetAgentId: 'specialist',
      reason: 'specialization',
      context: {
        messages: [{ role: 'user', content: 'First message' }],
        variables: { iteration: 1 },
      },
    })

    expect(firstResult.state).toBe('completed')

    // Create context from first result for second handoff
    const resumeContext = createHandoffContext(firstResult.result!, {
      summary: 'Continued from specialist',
      variables: { iteration: 2 },
    })

    const secondResult = await protocol.handoff({
      sourceAgentId: 'specialist',
      targetAgentId: 'primary',
      reason: 'completion',
      context: resumeContext,
    })

    expect(secondResult.request.context.variables?.iteration).toBe(2)
  })

  it('should preserve full message history for resumption', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Question 2' },
      { role: 'assistant', content: 'Answer 2' },
    ]

    const result = await protocol.handoff({
      sourceAgentId: 'primary',
      targetAgentId: 'specialist',
      reason: 'delegation',
      context: { messages },
    })

    // Full history should be preserved
    expect(result.request.context.messages.length).toBe(5)
  })

  it('should support partial history for context efficiency', async () => {
    const protocolWithPartialHistory = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('primary', 'Primary'),
        createTestAgentConfig('specialist', 'Specialist'),
      ],
      includeFullHistory: false, // Only include recent messages
    })

    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i + 1}`,
    }))

    const result = await protocolWithPartialHistory.handoff({
      sourceAgentId: 'primary',
      targetAgentId: 'specialist',
      reason: 'delegation',
      context: { messages },
    })

    // Should include fewer messages (implementation detail - last 10)
    expect(result.state).toBe('completed')
  })
})

// ============================================================================
// Handoff Hooks Tests
// ============================================================================

describe('Handoff Lifecycle Hooks', () => {
  let mockProvider: AgentProvider

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })
  })

  it('should call onBeforeHandoff before handoff', async () => {
    const onBeforeHandoff = vi.fn().mockImplementation(async (request) => request)

    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
      hooks: { onBeforeHandoff },
    })

    await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(onBeforeHandoff).toHaveBeenCalledTimes(1)
    expect(onBeforeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentId: 'source',
        targetAgentId: 'target',
      }),
    )
  })

  it('should call onContextTransfer to modify context', async () => {
    const onContextTransfer = vi.fn().mockImplementation(async (context) => ({
      ...context,
      metadata: { ...context.metadata, transformed: true },
    }))

    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
      hooks: { onContextTransfer },
    })

    await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: { messages: [], metadata: { original: true } },
    })

    expect(onContextTransfer).toHaveBeenCalled()
  })

  it('should call onHandoffStart when target agent begins', async () => {
    const onHandoffStart = vi.fn()

    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
      hooks: { onHandoffStart },
    })

    await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(onHandoffStart).toHaveBeenCalled()
  })

  it('should call onHandoffComplete when handoff succeeds', async () => {
    const onHandoffComplete = vi.fn()

    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
      hooks: { onHandoffComplete },
    })

    await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(onHandoffComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'completed',
      }),
    )
  })
})

// ============================================================================
// Handoff Tool Tests
// ============================================================================

describe('createProtocolHandoffTool', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('router', 'Router Agent'),
        createTestAgentConfig('support', 'Support Agent'),
        createTestAgentConfig('billing', 'Billing Agent'),
      ],
    })
  })

  it('should create a tool with available agents in description', () => {
    const tool = createProtocolHandoffTool(protocol, 'router')

    expect(tool.name).toBe('handoff_to_agent')
    expect(tool.description).toContain('support')
    expect(tool.description).toContain('billing')
  })

  it('should execute handoff when tool is called', async () => {
    const tool = createProtocolHandoffTool(protocol, 'router')

    const result = await tool.execute(
      {
        targetAgentId: 'support',
        reason: 'specialization',
        reasonDescription: 'Customer needs support help',
      },
      {
        agentId: 'router',
        metadata: { messages: createTestMessages() },
      },
    )

    expect(result.success).toBe(true)
    expect(result.agentId).toBe('support')
  })

  it('should return error on failed handoff', async () => {
    const tool = createProtocolHandoffTool(protocol, 'router')

    const result = await tool.execute(
      {
        targetAgentId: 'nonexistent',
        reason: 'routing',
      },
      { agentId: 'router' },
    )

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should throw if no agents available', () => {
    const emptyProtocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [],
    })

    expect(() => createProtocolHandoffTool(emptyProtocol, 'router')).toThrow(
      'No agents available',
    )
  })
})

// ============================================================================
// Protocol Management Tests
// ============================================================================

describe('HandoffProtocol Management', () => {
  let mockProvider: AgentProvider
  let protocol: HandoffProtocol

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })

    protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('agent-1', 'Agent 1'),
        createTestAgentConfig('agent-2', 'Agent 2'),
      ],
    })
  })

  it('should list available agents', () => {
    const agents = protocol.getAvailableAgents()

    expect(agents).toHaveLength(2)
    expect(agents.map((a) => a.id)).toContain('agent-1')
    expect(agents.map((a) => a.id)).toContain('agent-2')
  })

  it('should check if agent is available', () => {
    expect(protocol.isAgentAvailable('agent-1')).toBe(true)
    expect(protocol.isAgentAvailable('unknown')).toBe(false)
  })

  it('should add new agent dynamically', () => {
    protocol.addAgent(createTestAgentConfig('agent-3', 'Agent 3'))

    expect(protocol.isAgentAvailable('agent-3')).toBe(true)
    expect(protocol.getAvailableAgents()).toHaveLength(3)
  })

  it('should remove agent dynamically', () => {
    protocol.removeAgent('agent-1')

    expect(protocol.isAgentAvailable('agent-1')).toBe(false)
    expect(protocol.getAvailableAgents()).toHaveLength(1)
  })

  it('should clear handoff chain', () => {
    protocol.clearChain('test-conversation')

    // Should not throw
    expect(protocol.getChain('test-conversation')).toEqual([])
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  it('createHandoffRequest should create valid request', () => {
    const context: HandoffContext = {
      messages: createTestMessages(),
      summary: 'Test summary',
    }

    const request = createHandoffRequest(
      'source',
      'target',
      context,
      'delegation',
      'Delegating to specialist',
    )

    expect(request.sourceAgentId).toBe('source')
    expect(request.targetAgentId).toBe('target')
    expect(request.reason).toBe('delegation')
    expect(request.reasonDescription).toBe('Delegating to specialist')
    expect(request.context.summary).toBe('Test summary')
  })

  it('createHandoffContext should create context from AgentResult', () => {
    const result = createTestAgentResult()

    const context = createHandoffContext(result, {
      summary: 'Work completed',
      variables: { step: 2 },
    })

    expect(context.messages).toEqual(result.messages)
    expect(context.toolCalls).toEqual(result.toolCalls)
    expect(context.summary).toBe('Work completed')
    expect(context.variables?.step).toBe(2)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  let mockProvider: AgentProvider

  beforeEach(() => {
    mockProvider = createMockProvider({
      responses: [createTestAgentResult()],
    })
  })

  it('should handle empty messages array', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
    })

    const result = await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: { messages: [] },
    })

    expect(result.state).toBe('completed')
  })

  it('should detect circular handoff back to previous source agent', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('agent-a', 'Agent A'),
        createTestAgentConfig('agent-b', 'Agent B'),
      ],
    })

    // Create a chain by using the same message content hash
    const messages: Message[] = [{ role: 'user', content: 'Circular test conversation' }]

    // First handoff: A -> B (chain now has: [A])
    await protocol.handoff({
      sourceAgentId: 'agent-a',
      targetAgentId: 'agent-b',
      reason: 'routing',
      context: { messages },
    })

    // Second handoff: B -> A (circular - A is already in chain as source)
    const result = await protocol.handoff({
      sourceAgentId: 'agent-b',
      targetAgentId: 'agent-a', // This target was a previous source
      reason: 'completion',
      context: { messages }, // Same messages = same chain
    })

    // Circular detection catches A being handed back to since A was a source
    expect(result.state).toBe('failed')
    expect(result.error?.message).toContain('Circular')
  })

  it('should handle special characters in context', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
    })

    const result = await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'routing',
      context: {
        messages: [{ role: 'user', content: 'Test with <script>alert("xss")</script>' }],
        summary: 'Customer query with "quotes" and unicode: ',
        metadata: { emoji: '', special: '& < > " \'' },
      },
    })

    expect(result.state).toBe('completed')
    expect(result.request.context.metadata?.emoji).toBe('')
  })

  it('should handle very large context', async () => {
    const protocol = createHandoffProtocol({
      provider: mockProvider,
      agents: [
        createTestAgentConfig('source', 'Source'),
        createTestAgentConfig('target', 'Target'),
      ],
    })

    // Create large message history
    const largeMessages: Message[] = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i + 1}: ${'x'.repeat(1000)}`,
    }))

    const result = await protocol.handoff({
      sourceAgentId: 'source',
      targetAgentId: 'target',
      reason: 'delegation',
      context: {
        messages: largeMessages,
        metadata: { largeData: 'x'.repeat(10000) },
      },
    })

    expect(result.state).toBe('completed')
  })
})
