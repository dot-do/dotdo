/**
 * Agent-to-Agent Communication
 *
 * Provides a message bus for agent-to-agent communication with graph integration:
 * - Direct messaging between agents
 * - Message persistence in graph storage
 * - Handoff tracking via graph relationships
 * - Message history queries
 * - Coordination patterns (fan-out, pipeline, supervisor)
 *
 * Connects to the DO Graph model for persistence and querying.
 *
 * @module agents/communication
 */

import type { GraphEngine, Edge, Node } from '../../db/graph'

// ============================================================================
// Types
// ============================================================================

/**
 * Message types for agent-to-agent communication
 */
export type MessageType = 'request' | 'response' | 'notification' | 'handoff' | 'error'

/**
 * Message sent between agents
 */
export interface AgentMessage<T = unknown> {
  /** Unique message identifier */
  id: string
  /** Sending agent ID */
  sender: string
  /** Receiving agent ID */
  recipient: string
  /** Message type */
  type: MessageType
  /** Message payload */
  payload: T
  /** When the message was created */
  timestamp: Date
  /** Optional: ID of message this is responding to */
  replyTo?: string
  /** Optional: Time-to-live in milliseconds */
  ttlMs?: number
  /** Optional: Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Delivery status for a message
 */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'expired'

/**
 * Receipt acknowledging message delivery
 */
export interface DeliveryReceipt {
  acknowledgedBy: string
  acknowledgedAt: Date
}

/**
 * Envelope wrapping a message with delivery metadata
 */
export interface MessageEnvelope<T = unknown> {
  /** The wrapped message */
  message: AgentMessage<T>
  /** Number of delivery attempts */
  deliveryAttempts: number
  /** When the envelope was created */
  createdAt: Date
  /** Current delivery status */
  status: DeliveryStatus
  /** When the message was delivered (if applicable) */
  deliveredAt?: Date
  /** Error message if delivery failed */
  error?: string
  /** Delivery receipt from recipient */
  receipt?: DeliveryReceipt
}

/**
 * Filter criteria for messages
 */
export interface MessageFilter {
  /** Filter by message type */
  type?: MessageType
  /** Filter by sender */
  sender?: string
  /** Filter by recipient */
  recipient?: string
  /** Messages since this date */
  since?: Date
  /** Messages until this date */
  until?: Date
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Message subscription handle
 */
export interface MessageSubscription {
  /** Unique subscription ID */
  id: string
  /** The agent ID being subscribed to */
  agentId: string
  /** Unsubscribe from messages */
  unsubscribe: () => void
}

/**
 * Message handler callback
 */
export type MessageHandler<T = unknown> = (message: AgentMessage<T>) => void | Promise<void>

/**
 * Configuration for message bus
 */
export interface BusConfig {
  /** Default TTL for messages in milliseconds */
  defaultTtlMs?: number
  /** Maximum delivery attempts */
  maxDeliveryAttempts?: number
  /** Retry delay in milliseconds */
  retryDelayMs?: number
}

/**
 * Request options for request-response pattern
 */
export interface RequestOptions {
  /** Timeout in milliseconds */
  timeoutMs: number
}

/**
 * Broadcast request (one-to-many)
 */
export interface BroadcastRequest<T = unknown> {
  sender: string
  recipients: string[]
  type: MessageType
  payload: T
  metadata?: Record<string, unknown>
}

/**
 * Simple request (generates ID automatically)
 */
export interface SimpleRequest<T = unknown> {
  sender: string
  recipient: string
  payload: T
  metadata?: Record<string, unknown>
}

/**
 * Communication statistics
 */
export interface CommunicationStats {
  totalMessages: number
  messagesByType: Record<string, number>
  uniqueAgents: number
}

/**
 * Agent activity entry
 */
export interface AgentActivity {
  agentId: string
  messageCount: number
}

/**
 * Handoff record from graph
 */
export interface HandoffRecord {
  id: string
  from: string
  to: string
  timestamp: Date
  reason?: string
  payload: unknown
}

// ============================================================================
// AgentMessageBus - In-Memory Implementation
// ============================================================================

/**
 * In-memory message bus for agent-to-agent communication
 */
export class AgentMessageBus {
  private subscriptions: Map<string, Set<{
    handler: MessageHandler
    filter?: MessageFilter
  }>> = new Map()
  private messages: MessageEnvelope[] = []
  private config: Required<BusConfig>

  constructor(config: BusConfig = {}) {
    this.config = {
      defaultTtlMs: config.defaultTtlMs ?? 60 * 60 * 1000, // 1 hour
      maxDeliveryAttempts: config.maxDeliveryAttempts ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
    }
  }

  /**
   * Send a message to an agent
   */
  async send<T>(message: AgentMessage<T>): Promise<MessageEnvelope<T>> {
    // Assign ID if not provided
    if (!message.id) {
      message.id = this.generateId()
    }

    // Assign timestamp if not provided
    if (!message.timestamp) {
      message.timestamp = new Date()
    }

    const envelope: MessageEnvelope<T> = {
      message,
      deliveryAttempts: 0,
      createdAt: new Date(),
      status: 'pending',
    }

    this.messages.push(envelope as MessageEnvelope)

    // Deliver to subscribers asynchronously
    this.deliver(envelope)

    return envelope
  }

  /**
   * Subscribe to messages for a specific agent
   */
  subscribe<T = unknown>(
    agentId: string,
    handler: MessageHandler<T>,
    filter?: Omit<MessageFilter, 'recipient'>
  ): MessageSubscription {
    const subscriptionId = this.generateId('sub')

    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, new Set())
    }

    const entry = { handler: handler as MessageHandler, filter }
    this.subscriptions.get(agentId)!.add(entry)

    return {
      id: subscriptionId,
      agentId,
      unsubscribe: () => {
        this.subscriptions.get(agentId)?.delete(entry)
      },
    }
  }

  /**
   * Send a request and wait for response
   */
  async request<TReq, TRes>(
    request: SimpleRequest<TReq>,
    options: RequestOptions
  ): Promise<AgentMessage<TRes>> {
    const messageId = this.generateId()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error(`Request timeout after ${options.timeoutMs}ms`))
      }, options.timeoutMs)

      // Subscribe to response
      const subscription = this.subscribe<TRes>(request.sender, (response) => {
        if (response.replyTo === messageId) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve(response)
        }
      }, { type: 'response' })

      // Send the request
      this.send({
        id: messageId,
        sender: request.sender,
        recipient: request.recipient,
        type: 'request',
        payload: request.payload,
        timestamp: new Date(),
        metadata: request.metadata,
      })
    })
  }

  /**
   * Broadcast a message to multiple recipients
   */
  async broadcast<T>(broadcast: BroadcastRequest<T>): Promise<MessageEnvelope<T>[]> {
    const envelopes: MessageEnvelope<T>[] = []

    for (const recipient of broadcast.recipients) {
      const envelope = await this.send({
        id: this.generateId(),
        sender: broadcast.sender,
        recipient,
        type: broadcast.type,
        payload: broadcast.payload,
        timestamp: new Date(),
        metadata: broadcast.metadata,
      })
      envelopes.push(envelope)
    }

    return envelopes
  }

  /**
   * Get message history for an agent
   */
  async getHistory(agentId: string, filter?: MessageFilter): Promise<AgentMessage[]> {
    let messages = this.messages
      .map((e) => e.message)
      .filter((m) => m.sender === agentId || m.recipient === agentId)

    if (filter?.type) {
      messages = messages.filter((m) => m.type === filter.type)
    }

    if (filter?.since) {
      messages = messages.filter((m) => m.timestamp >= filter.since!)
    }

    if (filter?.until) {
      messages = messages.filter((m) => m.timestamp <= filter.until!)
    }

    if (filter?.offset) {
      messages = messages.slice(filter.offset)
    }

    if (filter?.limit) {
      messages = messages.slice(0, filter.limit)
    }

    return messages
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async deliver<T>(envelope: MessageEnvelope<T>): Promise<void> {
    const message = envelope.message
    envelope.deliveryAttempts++

    // Deliver to specific recipient
    const recipientSubs = this.subscriptions.get(message.recipient) ?? new Set()
    for (const sub of Array.from(recipientSubs)) {
      if (this.matchesFilter(message, sub.filter)) {
        try {
          await sub.handler(message)
        } catch (error) {
          console.error('Error in message handler:', error)
        }
      }
    }

    // Deliver to wildcard subscribers
    const wildcardSubs = this.subscriptions.get('*') ?? new Set()
    for (const sub of Array.from(wildcardSubs)) {
      if (this.matchesFilter(message, sub.filter)) {
        try {
          await sub.handler(message)
        } catch (error) {
          console.error('Error in wildcard handler:', error)
        }
      }
    }

    envelope.status = 'delivered'
    envelope.deliveredAt = new Date()
  }

  private matchesFilter(message: AgentMessage, filter?: MessageFilter): boolean {
    if (!filter) return true

    if (filter.type && message.type !== filter.type) return false
    if (filter.sender && message.sender !== filter.sender) return false
    if (filter.recipient && message.recipient !== filter.recipient) return false
    if (filter.since && message.timestamp < filter.since) return false
    if (filter.until && message.timestamp > filter.until) return false

    return true
  }

  private generateId(prefix = 'msg'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

// ============================================================================
// GraphMessageBus - Graph-Integrated Implementation
// ============================================================================

export interface GraphMessageBusConfig extends BusConfig {
  /** Graph engine for persistence */
  graph: GraphEngine
}

/**
 * Message bus with graph storage integration
 *
 * Stores all messages as graph relationships:
 * - Regular messages: (sender)-[:sentTo]->(recipient)
 * - Handoffs: (sender)-[:handedOffTo]->(recipient)
 *
 * This enables:
 * - Queryable message history
 * - Handoff chain traversal
 * - Communication pattern analysis
 */
export class GraphMessageBus extends AgentMessageBus {
  private graph: GraphEngine

  constructor(config: GraphMessageBusConfig) {
    super(config)
    this.graph = config.graph
  }

  /**
   * Send a message with graph persistence
   */
  async send<T>(message: AgentMessage<T>): Promise<MessageEnvelope<T>> {
    // Assign ID if not provided (before graph persistence)
    if (!message.id) {
      message.id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    }

    // Assign timestamp if not provided (before graph persistence)
    if (!message.timestamp) {
      message.timestamp = new Date()
    }

    // Ensure agent nodes exist
    await this.ensureAgentNode(message.sender)
    await this.ensureAgentNode(message.recipient)

    // Determine relationship type
    const relType = message.type === 'handoff' ? 'handedOffTo' : 'sentTo'

    // Create relationship in graph
    await this.graph.createEdge(message.sender, relType, message.recipient, {
      messageId: message.id,
      type: message.type,
      payload: message.payload,
      timestamp: message.timestamp.toISOString(),
      metadata: message.metadata,
      replyTo: message.replyTo,
      reason: message.type === 'handoff' ? (message.payload as any)?.reason : undefined,
    })

    // Use parent implementation for in-memory handling
    return super.send(message)
  }

  /**
   * Broadcast with graph persistence
   */
  async broadcast<T>(broadcast: BroadcastRequest<T>): Promise<MessageEnvelope<T>[]> {
    const envelopes: MessageEnvelope<T>[] = []

    for (const recipient of broadcast.recipients) {
      const envelope = await this.send({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sender: broadcast.sender,
        recipient,
        type: broadcast.type,
        payload: broadcast.payload,
        timestamp: new Date(),
        metadata: broadcast.metadata,
      })
      envelopes.push(envelope)
    }

    return envelopes
  }

  /**
   * Get handoff chain for a conversation
   */
  async getHandoffChain(conversationId: string): Promise<HandoffRecord[]> {
    const edges = await this.graph.queryEdges({ type: 'handedOffTo' })

    return edges
      .filter((e) => {
        const metadata = e.properties.metadata as Record<string, unknown> | undefined
        return metadata?.conversationId === conversationId
      })
      .map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        timestamp: new Date(e.properties.timestamp as string),
        reason: e.properties.reason as string | undefined,
        payload: e.properties.payload,
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  /**
   * Get conversation between two agents
   */
  async getConversation(agent1: string, agent2: string): Promise<AgentMessage[]> {
    const edges = await this.graph.queryEdges({ type: 'sentTo' })

    return edges
      .filter(
        (e) =>
          (e.from === agent1 && e.to === agent2) || (e.from === agent2 && e.to === agent1)
      )
      .map((e) => this.edgeToMessage(e))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  /**
   * Get all communications for an agent (sent and received)
   */
  async getAgentCommunications(agentId: string): Promise<AgentMessage[]> {
    const sent = await this.graph.queryEdges({ from: agentId })
    const received = await this.graph.queryEdges({ to: agentId })

    const allEdges = [...sent, ...received].filter(
      (e) => e.type === 'sentTo' || e.type === 'handedOffTo'
    )

    return allEdges
      .map((e) => this.edgeToMessage(e))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  /**
   * Query messages by filter
   */
  async queryMessages(filter: MessageFilter): Promise<AgentMessage[]> {
    let edges = await this.graph.queryEdges({})

    edges = edges.filter((e) => e.type === 'sentTo' || e.type === 'handedOffTo')

    if (filter.type) {
      edges = edges.filter((e) => e.properties.type === filter.type)
    }

    if (filter.sender) {
      edges = edges.filter((e) => e.from === filter.sender)
    }

    if (filter.recipient) {
      edges = edges.filter((e) => e.to === filter.recipient)
    }

    let messages = edges.map((e) => this.edgeToMessage(e))

    if (filter.since) {
      messages = messages.filter((m) => m.timestamp >= filter.since!)
    }

    if (filter.until) {
      messages = messages.filter((m) => m.timestamp <= filter.until!)
    }

    if (filter.offset) {
      messages = messages.slice(filter.offset)
    }

    if (filter.limit) {
      messages = messages.slice(0, filter.limit)
    }

    return messages
  }

  /**
   * Get communication statistics
   */
  async getStats(): Promise<CommunicationStats> {
    const edges = await this.graph.queryEdges({})
    const messageEdges = edges.filter((e) => e.type === 'sentTo' || e.type === 'handedOffTo')

    const messagesByType: Record<string, number> = {}
    const agents = new Set<string>()

    for (const edge of messageEdges) {
      const type = (edge.properties.type as string) || 'unknown'
      messagesByType[type] = (messagesByType[type] || 0) + 1
      agents.add(edge.from)
      agents.add(edge.to)
    }

    return {
      totalMessages: messageEdges.length,
      messagesByType,
      uniqueAgents: agents.size,
    }
  }

  /**
   * Get most active agents by message count
   */
  async getMostActiveAgents(limit: number): Promise<AgentActivity[]> {
    const edges = await this.graph.queryEdges({})
    const messageEdges = edges.filter((e) => e.type === 'sentTo' || e.type === 'handedOffTo')

    const counts = new Map<string, number>()

    for (const edge of messageEdges) {
      counts.set(edge.from, (counts.get(edge.from) || 0) + 1)
    }

    return Array.from(counts.entries())
      .map(([agentId, messageCount]) => ({ agentId, messageCount }))
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit)
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async ensureAgentNode(agentId: string): Promise<void> {
    const existing = await this.graph.getNode(agentId)
    if (!existing) {
      await this.graph.createNode('Agent', { name: agentId }, { id: agentId })
    }
  }

  private edgeToMessage(edge: Edge): AgentMessage {
    return {
      id: edge.properties.messageId as string || edge.id,
      sender: edge.from,
      recipient: edge.to,
      type: (edge.properties.type as MessageType) || 'notification',
      payload: edge.properties.payload,
      timestamp: new Date(edge.properties.timestamp as string || edge.createdAt),
      replyTo: edge.properties.replyTo as string | undefined,
      metadata: edge.properties.metadata as Record<string, unknown> | undefined,
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an in-memory message bus
 */
export function createMessageBus(config?: BusConfig): AgentMessageBus {
  return new AgentMessageBus(config)
}

/**
 * Create a graph-integrated message bus
 */
export function createGraphMessageBus(config: GraphMessageBusConfig): GraphMessageBus {
  return new GraphMessageBus(config)
}

export default AgentMessageBus
