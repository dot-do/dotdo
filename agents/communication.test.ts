/**
 * Agent-to-Agent Communication Tests
 *
 * TDD tests for agent-to-agent communication with graph integration:
 * - Message bus for direct agent messaging
 * - Graph storage for message persistence
 * - Handoff tracking via graph relationships
 * - Message history queries
 * - Coordination patterns (fan-out, pipeline, supervisor)
 *
 * @see dotdo-fxq61 - Agent-to-Agent Communication
 * @module agents/communication.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AgentMessageBus,
  GraphMessageBus,
  createMessageBus,
  createGraphMessageBus,
  type AgentMessage,
  type MessageEnvelope,
  type MessageFilter,
  type MessageSubscription,
  type BusConfig,
} from './communication'
import { GraphEngine } from '../db/graph'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sender: 'agent-sender',
    recipient: 'agent-recipient',
    type: 'request',
    payload: { task: 'process data' },
    timestamp: new Date(),
    ...overrides,
  }
}

// ============================================================================
// AgentMessage Structure Tests
// ============================================================================

describe('AgentMessage Structure', () => {
  it('should have required fields: id, sender, recipient, type, payload', () => {
    const message: AgentMessage = {
      id: 'msg-123',
      sender: 'agent-a',
      recipient: 'agent-b',
      type: 'request',
      payload: { data: 'test' },
      timestamp: new Date(),
    }

    expect(message.id).toBe('msg-123')
    expect(message.sender).toBe('agent-a')
    expect(message.recipient).toBe('agent-b')
    expect(message.type).toBe('request')
    expect(message.payload).toEqual({ data: 'test' })
  })

  it('should support different message types', () => {
    const request: AgentMessage = createTestMessage({ type: 'request' })
    const response: AgentMessage = createTestMessage({ type: 'response' })
    const notification: AgentMessage = createTestMessage({ type: 'notification' })
    const handoff: AgentMessage = createTestMessage({ type: 'handoff' })
    const error: AgentMessage = createTestMessage({ type: 'error' })

    expect(request.type).toBe('request')
    expect(response.type).toBe('response')
    expect(notification.type).toBe('notification')
    expect(handoff.type).toBe('handoff')
    expect(error.type).toBe('error')
  })

  it('should support optional metadata', () => {
    const message: AgentMessage = createTestMessage({
      metadata: {
        priority: 'high',
        conversationId: 'conv-123',
        correlationId: 'corr-456',
        tags: ['urgent', 'billing'],
      },
    })

    expect(message.metadata?.priority).toBe('high')
    expect(message.metadata?.conversationId).toBe('conv-123')
    expect(message.metadata?.tags).toContain('urgent')
  })

  it('should support reply-to for request-response patterns', () => {
    const request: AgentMessage = createTestMessage({
      id: 'request-1',
      type: 'request',
    })

    const response: AgentMessage = createTestMessage({
      type: 'response',
      replyTo: request.id,
      sender: request.recipient,
      recipient: request.sender,
    })

    expect(response.replyTo).toBe('request-1')
  })

  it('should support TTL (time-to-live) for expiring messages', () => {
    const message: AgentMessage = createTestMessage({
      ttlMs: 30000, // 30 seconds
    })

    expect(message.ttlMs).toBe(30000)
  })
})

// ============================================================================
// MessageEnvelope Tests
// ============================================================================

describe('MessageEnvelope', () => {
  it('should wrap message with delivery metadata', () => {
    const message = createTestMessage()
    const envelope: MessageEnvelope = {
      message,
      deliveryAttempts: 0,
      createdAt: new Date(),
      status: 'pending',
    }

    expect(envelope.message).toEqual(message)
    expect(envelope.deliveryAttempts).toBe(0)
    expect(envelope.status).toBe('pending')
  })

  it('should track delivery status', () => {
    const statuses = ['pending', 'delivered', 'failed', 'expired'] as const

    for (const status of statuses) {
      const envelope: MessageEnvelope = {
        message: createTestMessage(),
        deliveryAttempts: status === 'failed' ? 3 : 1,
        createdAt: new Date(),
        status,
        deliveredAt: status === 'delivered' ? new Date() : undefined,
        error: status === 'failed' ? 'Delivery timeout' : undefined,
      }

      expect(envelope.status).toBe(status)
    }
  })

  it('should include delivery receipt', () => {
    const envelope: MessageEnvelope = {
      message: createTestMessage(),
      deliveryAttempts: 1,
      createdAt: new Date(),
      status: 'delivered',
      deliveredAt: new Date(),
      receipt: {
        acknowledgedBy: 'agent-b',
        acknowledgedAt: new Date(),
      },
    }

    expect(envelope.receipt?.acknowledgedBy).toBe('agent-b')
  })
})

// ============================================================================
// AgentMessageBus Core Tests
// ============================================================================

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus

  beforeEach(() => {
    bus = createMessageBus()
  })

  describe('send()', () => {
    it('should send a message and return envelope', async () => {
      const message = createTestMessage()
      const envelope = await bus.send(message)

      expect(envelope).toBeDefined()
      expect(envelope.message.id).toBe(message.id)
      // Status is 'delivered' because delivery is synchronous in this implementation
      expect(envelope.status).toBe('delivered')
    })

    it('should assign ID if not provided', async () => {
      const message = createTestMessage()
      delete (message as any).id

      const envelope = await bus.send(message)

      expect(envelope.message.id).toBeDefined()
      expect(envelope.message.id).toMatch(/^msg-/)
    })

    it('should assign timestamp if not provided', async () => {
      const message = createTestMessage()
      delete (message as any).timestamp

      const envelope = await bus.send(message)

      expect(envelope.message.timestamp).toBeDefined()
      expect(envelope.message.timestamp).toBeInstanceOf(Date)
    })
  })

  describe('subscribe()', () => {
    it('should subscribe to messages for a specific agent', async () => {
      const received: AgentMessage[] = []
      const subscription = bus.subscribe('agent-b', (msg) => {
        received.push(msg)
      })

      await bus.send(createTestMessage({ recipient: 'agent-b' }))
      await bus.send(createTestMessage({ recipient: 'agent-c' })) // Should not receive

      // Allow async delivery
      await new Promise((r) => setTimeout(r, 10))

      expect(received).toHaveLength(1)
      expect(received[0]?.recipient).toBe('agent-b')

      subscription.unsubscribe()
    })

    it('should support message type filtering', async () => {
      const received: AgentMessage[] = []
      const subscription = bus.subscribe('agent-b', (msg) => {
        received.push(msg)
      }, { type: 'request' })

      await bus.send(createTestMessage({ recipient: 'agent-b', type: 'request' }))
      await bus.send(createTestMessage({ recipient: 'agent-b', type: 'notification' }))

      await new Promise((r) => setTimeout(r, 10))

      expect(received).toHaveLength(1)
      expect(received[0]?.type).toBe('request')

      subscription.unsubscribe()
    })

    it('should support wildcard subscriptions for all messages', async () => {
      const received: AgentMessage[] = []
      const subscription = bus.subscribe('*', (msg) => {
        received.push(msg)
      })

      await bus.send(createTestMessage({ recipient: 'agent-a' }))
      await bus.send(createTestMessage({ recipient: 'agent-b' }))

      await new Promise((r) => setTimeout(r, 10))

      expect(received).toHaveLength(2)

      subscription.unsubscribe()
    })
  })

  describe('request()', () => {
    it('should send request and wait for response', async () => {
      // Set up responder
      bus.subscribe('agent-b', async (msg) => {
        if (msg.type === 'request') {
          await bus.send({
            id: `response-${msg.id}`,
            sender: 'agent-b',
            recipient: msg.sender,
            type: 'response',
            payload: { result: 'processed' },
            replyTo: msg.id,
            timestamp: new Date(),
          })
        }
      })

      const response = await bus.request({
        sender: 'agent-a',
        recipient: 'agent-b',
        payload: { action: 'process' },
      }, { timeoutMs: 1000 })

      expect(response.payload).toEqual({ result: 'processed' })
      expect(response.type).toBe('response')
    })

    it('should timeout if no response received', async () => {
      await expect(
        bus.request({
          sender: 'agent-a',
          recipient: 'agent-b',
          payload: { action: 'process' },
        }, { timeoutMs: 50 })
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('broadcast()', () => {
    it('should send message to multiple recipients', async () => {
      const received: AgentMessage[] = []

      bus.subscribe('agent-a', (msg) => received.push(msg))
      bus.subscribe('agent-b', (msg) => received.push(msg))
      bus.subscribe('agent-c', (msg) => received.push(msg))

      await bus.broadcast({
        sender: 'coordinator',
        recipients: ['agent-a', 'agent-b', 'agent-c'],
        type: 'notification',
        payload: { announcement: 'System update' },
      })

      await new Promise((r) => setTimeout(r, 10))

      expect(received).toHaveLength(3)
    })
  })

  describe('getHistory()', () => {
    it('should return message history for an agent', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b' }))
      await bus.send(createTestMessage({ sender: 'agent-b', recipient: 'agent-a' }))
      await bus.send(createTestMessage({ sender: 'agent-c', recipient: 'agent-d' }))

      const history = await bus.getHistory('agent-a')

      expect(history).toHaveLength(2)
    })

    it('should support filtering by message type', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b', type: 'request' }))
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b', type: 'notification' }))

      const history = await bus.getHistory('agent-a', { type: 'request' })

      expect(history).toHaveLength(1)
      expect(history[0]?.type).toBe('request')
    })

    it('should support time range filtering', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)

      await bus.send(createTestMessage({
        sender: 'agent-a',
        recipient: 'agent-b',
        timestamp: oneHourAgo,
      }))
      await bus.send(createTestMessage({
        sender: 'agent-a',
        recipient: 'agent-b',
        timestamp: now,
      }))

      const history = await bus.getHistory('agent-a', {
        since: new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes ago
      })

      expect(history).toHaveLength(1)
    })
  })
})

// ============================================================================
// GraphMessageBus Tests - Graph Storage Integration
// ============================================================================

describe('GraphMessageBus', () => {
  let graph: GraphEngine
  let bus: GraphMessageBus

  beforeEach(() => {
    graph = new GraphEngine()
    bus = createGraphMessageBus({ graph })
  })

  describe('send() with graph storage', () => {
    it('should store messages as graph relationships', async () => {
      const message = createTestMessage({
        sender: 'agent-a',
        recipient: 'agent-b',
      })

      await bus.send(message)

      // Query graph for the relationship
      const edges = await graph.queryEdges({
        type: 'sentTo',
        from: 'agent-a',
      })

      expect(edges).toHaveLength(1)
      expect(edges[0]?.to).toBe('agent-b')
      expect(edges[0]?.properties.messageId).toBe(message.id)
    })

    it('should create agent nodes if they do not exist', async () => {
      await bus.send(createTestMessage({
        sender: 'new-agent-a',
        recipient: 'new-agent-b',
      }))

      const senderNode = await graph.getNode('new-agent-a')
      const recipientNode = await graph.getNode('new-agent-b')

      expect(senderNode).not.toBeNull()
      expect(senderNode?.label).toBe('Agent')
      expect(recipientNode).not.toBeNull()
    })

    it('should store message payload in relationship data', async () => {
      const payload = { task: 'analyze data', priority: 'high' }
      await bus.send(createTestMessage({
        sender: 'agent-a',
        recipient: 'agent-b',
        payload,
      }))

      const edges = await graph.queryEdges({ type: 'sentTo' })
      expect(edges[0]?.properties.payload).toEqual(payload)
    })
  })

  describe('handoff tracking', () => {
    it('should track handoffs as graph relationships', async () => {
      await bus.send(createTestMessage({
        sender: 'agent-router',
        recipient: 'agent-support',
        type: 'handoff',
        payload: {
          reason: 'specialization',
          context: { customerId: 'cust-123' },
        },
      }))

      const handoffs = await graph.queryEdges({ type: 'handedOffTo' })

      expect(handoffs).toHaveLength(1)
      expect(handoffs[0]?.from).toBe('agent-router')
      expect(handoffs[0]?.to).toBe('agent-support')
      expect(handoffs[0]?.properties.reason).toBe('specialization')
    })

    it('should track handoff chains via graph traversal', async () => {
      // Router -> Support -> Billing
      await bus.send(createTestMessage({
        sender: 'agent-router',
        recipient: 'agent-support',
        type: 'handoff',
        payload: { reason: 'routing' },
      }))

      await bus.send(createTestMessage({
        sender: 'agent-support',
        recipient: 'agent-billing',
        type: 'handoff',
        payload: { reason: 'specialization' },
      }))

      // Query handoff chain from router
      const traversal = await graph.traverse({
        start: 'agent-router',
        direction: 'OUTGOING',
        maxDepth: 3,
        filter: { type: 'handedOffTo' },
      })

      expect(traversal.nodes).toHaveLength(2)
      expect(traversal.nodes.map((n) => n.id)).toContain('agent-support')
      expect(traversal.nodes.map((n) => n.id)).toContain('agent-billing')
    })

    it('should provide handoff history query', async () => {
      await bus.send(createTestMessage({
        sender: 'agent-router',
        recipient: 'agent-support',
        type: 'handoff',
        metadata: { conversationId: 'conv-123' },
      }))

      await bus.send(createTestMessage({
        sender: 'agent-support',
        recipient: 'agent-billing',
        type: 'handoff',
        metadata: { conversationId: 'conv-123' },
      }))

      const chain = await bus.getHandoffChain('conv-123')

      expect(chain).toHaveLength(2)
      expect(chain[0]?.from).toBe('agent-router')
      expect(chain[1]?.from).toBe('agent-support')
    })
  })

  describe('queryable history from graph', () => {
    it('should query messages between specific agents', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b' }))
      await bus.send(createTestMessage({ sender: 'agent-b', recipient: 'agent-a' }))
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-c' }))

      const conversation = await bus.getConversation('agent-a', 'agent-b')

      expect(conversation).toHaveLength(2)
    })

    it('should query all communications for an agent', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b' }))
      await bus.send(createTestMessage({ sender: 'agent-c', recipient: 'agent-a' }))
      await bus.send(createTestMessage({ sender: 'agent-d', recipient: 'agent-e' }))

      const allComms = await bus.getAgentCommunications('agent-a')

      expect(allComms).toHaveLength(2)
    })

    it('should query messages by type across agents', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b', type: 'request' }))
      await bus.send(createTestMessage({ sender: 'agent-b', recipient: 'agent-c', type: 'request' }))
      await bus.send(createTestMessage({ sender: 'agent-c', recipient: 'agent-d', type: 'notification' }))

      const requests = await bus.queryMessages({ type: 'request' })

      expect(requests).toHaveLength(2)
    })

    it('should support pagination', async () => {
      // Create 10 messages
      for (let i = 0; i < 10; i++) {
        await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b' }))
      }

      const page1 = await bus.getHistory('agent-a', { limit: 5, offset: 0 })
      const page2 = await bus.getHistory('agent-a', { limit: 5, offset: 5 })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
    })
  })

  describe('coordination patterns', () => {
    it('should support fan-out pattern (one to many)', async () => {
      const supervisor = 'agent-supervisor'
      const workers = ['agent-worker-1', 'agent-worker-2', 'agent-worker-3']

      await bus.broadcast({
        sender: supervisor,
        recipients: workers,
        type: 'request',
        payload: { task: 'process-chunk' },
      })

      // Verify all workers received
      for (const worker of workers) {
        const messages = await bus.getHistory(worker)
        expect(messages.some((m) => m.sender === supervisor)).toBe(true)
      }
    })

    it('should support pipeline pattern (sequential handoffs)', async () => {
      const pipeline = ['agent-ingress', 'agent-transform', 'agent-validate', 'agent-store']

      for (let i = 0; i < pipeline.length - 1; i++) {
        await bus.send(createTestMessage({
          sender: pipeline[i]!,
          recipient: pipeline[i + 1]!,
          type: 'handoff',
          payload: { stage: i + 1, data: `processed-${i}` },
        }))
      }

      // Verify pipeline path exists in graph
      const path = await graph.shortestPath(pipeline[0]!, pipeline[pipeline.length - 1]!, {
        relationshipTypes: ['handedOffTo'],
      })

      expect(path).not.toBeNull()
      expect(path?.length).toBe(3)
    })

    it('should support supervisor-worker pattern', async () => {
      // Supervisor assigns tasks
      await bus.send(createTestMessage({
        sender: 'supervisor',
        recipient: 'worker-1',
        type: 'request',
        payload: { taskId: 'task-1', action: 'process' },
      }))

      // Worker reports completion
      await bus.send(createTestMessage({
        sender: 'worker-1',
        recipient: 'supervisor',
        type: 'response',
        payload: { taskId: 'task-1', status: 'completed' },
      }))

      // Query supervisor's view
      const supervisorComms = await bus.getAgentCommunications('supervisor')
      const assigned = supervisorComms.filter((m) => m.sender === 'supervisor')
      const completed = supervisorComms.filter((m) => m.type === 'response')

      expect(assigned).toHaveLength(1)
      expect(completed).toHaveLength(1)
    })
  })

  describe('graph statistics', () => {
    it('should provide communication statistics', async () => {
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b', type: 'request' }))
      await bus.send(createTestMessage({ sender: 'agent-b', recipient: 'agent-a', type: 'response' }))
      await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-c', type: 'handoff' }))

      const stats = await bus.getStats()

      expect(stats.totalMessages).toBe(3)
      expect(stats.messagesByType.request).toBe(1)
      expect(stats.messagesByType.response).toBe(1)
      expect(stats.messagesByType.handoff).toBe(1)
      expect(stats.uniqueAgents).toBe(3)
    })

    it('should identify most active agents', async () => {
      // Agent-a sends many messages
      for (let i = 0; i < 5; i++) {
        await bus.send(createTestMessage({ sender: 'agent-a', recipient: 'agent-b' }))
      }

      // Agent-c sends fewer
      await bus.send(createTestMessage({ sender: 'agent-c', recipient: 'agent-d' }))

      const activeAgents = await bus.getMostActiveAgents(2)

      expect(activeAgents[0]?.agentId).toBe('agent-a')
      expect(activeAgents[0]?.messageCount).toBe(5)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Communication Integration', () => {
  it('should integrate with handoff protocol', async () => {
    const graph = new GraphEngine()
    const bus = createGraphMessageBus({ graph })

    // Simulate handoff flow
    const handoffContext = {
      messages: [
        { role: 'user', content: 'Help with my order' },
        { role: 'assistant', content: 'Let me help you with that.' },
      ],
      customerId: 'cust-123',
    }

    await bus.send({
      id: 'handoff-1',
      sender: 'agent-router',
      recipient: 'agent-support',
      type: 'handoff',
      payload: handoffContext,
      timestamp: new Date(),
      metadata: { conversationId: 'conv-123' },
    })

    // Verify stored in graph
    const handoffs = await bus.getHandoffChain('conv-123')
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]?.payload).toEqual(handoffContext)
  })

  it('should support multi-hop agent delegation', async () => {
    const graph = new GraphEngine()
    const bus = createGraphMessageBus({ graph })

    // CEO -> VP -> Manager -> Engineer
    const chain = [
      { from: 'ceo', to: 'vp-engineering', task: 'Build new feature' },
      { from: 'vp-engineering', to: 'manager', task: 'Coordinate implementation' },
      { from: 'manager', to: 'engineer', task: 'Write the code' },
    ]

    for (const { from, to, task } of chain) {
      await bus.send({
        id: `delegation-${from}-${to}`,
        sender: from,
        recipient: to,
        type: 'request',
        payload: { task, delegatedBy: from },
        timestamp: new Date(),
        metadata: { projectId: 'proj-123' },
      })
    }

    // Verify delegation chain
    const path = await graph.shortestPath('ceo', 'engineer', {
      relationshipTypes: ['sentTo'],
    })

    expect(path).not.toBeNull()
    expect(path?.length).toBe(3)
  })
})
