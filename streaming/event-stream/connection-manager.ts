/**
 * ConnectionManager - WebSocket connection lifecycle management
 *
 * Implements IConnectionManager interface for managing WebSocket connections
 * and topic subscriptions with wildcard matching support.
 * Extracted from EventStreamDO as part of Wave 3 decomposition.
 *
 * @issue do-uryw - ConnectionManager Implementation
 * @wave Wave 3: EventStreamDO Decomposition
 */

// ============================================================================
// INTERFACE DEFINITION
// ============================================================================

/**
 * Connection metadata stored for each WebSocket connection
 */
export interface ConnectionInfo {
  /** Unique connection identifier */
  connectionId: string
  /** WebSocket instance */
  ws: WebSocket
  /** Topics this connection is subscribed to */
  topics: Set<string>
  /** Connection timestamp */
  connectedAt: number
  /** Last activity timestamp */
  lastActiveAt: number
  /** Client-provided metadata */
  metadata?: Record<string, unknown>
}

/**
 * IConnectionManager - Interface for WebSocket connection management
 *
 * Responsibilities:
 * - Track active WebSocket connections
 * - Manage topic subscriptions per connection
 * - Support wildcard topic matching
 * - Provide connection metrics
 */
export interface IConnectionManager {
  /**
   * Add a new WebSocket connection with initial topic subscriptions
   * @returns Connection ID for future reference
   */
  addConnection(ws: WebSocket, topics: string[], metadata?: Record<string, unknown>): string

  /**
   * Remove a connection by ID (on disconnect)
   */
  removeConnection(connectionId: string): void

  /**
   * Get all WebSocket connections subscribed to a topic
   * Supports wildcard matching (e.g., "orders.*" matches "orders.created")
   */
  getConnectionsByTopic(topic: string): WebSocket[]

  /**
   * Update subscriptions for an existing connection
   */
  updateSubscriptions(connectionId: string, topics: string[]): void

  /**
   * Add topics to an existing connection's subscriptions
   */
  addSubscriptions(connectionId: string, topics: string[]): void

  /**
   * Remove topics from an existing connection's subscriptions
   */
  removeSubscriptions(connectionId: string, topics: string[]): void

  /**
   * Get current connection count
   */
  getConnectionCount(): number

  /**
   * Get connection info by ID
   */
  getConnection(connectionId: string): ConnectionInfo | undefined

  /**
   * Get all topics with active subscribers
   */
  getActiveTopics(): string[]

  /**
   * Check if a connection is subscribed to a topic
   */
  isSubscribed(connectionId: string, topic: string): boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique connection ID
 */
function generateConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Check if a subscription pattern matches a topic
 *
 * Supports:
 * - Exact match: "orders" matches "orders"
 * - Single-level wildcard: "orders.*" matches "orders.created" but not "orders.item.added"
 * - Multi-level wildcard: "orders.**" matches "orders.created" and "orders.item.added"
 * - Global wildcard: "*" matches everything
 */
function matchesTopic(pattern: string, topic: string): boolean {
  // Global wildcard matches everything
  if (pattern === '*') {
    return true
  }

  // Exact match
  if (pattern === topic) {
    return true
  }

  // Multi-level wildcard (e.g., "orders.**")
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3)
    return topic === prefix || topic.startsWith(prefix + '.')
  }

  // Single-level wildcard (e.g., "orders.*")
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    // Must have exactly one more level after prefix
    if (topic.startsWith(prefix + '.')) {
      const remaining = topic.slice(prefix.length + 1)
      // Must not contain any more dots (single level only)
      return !remaining.includes('.')
    }
    return false
  }

  return false
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * ConnectionManager - WebSocket connection management
 *
 * Features:
 * - Track active WebSocket connections with metadata
 * - Manage topic subscriptions per connection
 * - Support wildcard topic matching
 * - Efficient topic-to-connection lookups via index
 */
export class ConnectionManager implements IConnectionManager {
  /** Map of connection ID to connection info */
  private connections: Map<string, ConnectionInfo> = new Map()
  /** Index of topic to connection IDs for fast lookup */
  private topicIndex: Map<string, Set<string>> = new Map()

  /**
   * Add a new WebSocket connection with initial topic subscriptions
   */
  addConnection(ws: WebSocket, topics: string[], metadata?: Record<string, unknown>): string {
    const connectionId = generateConnectionId()
    const now = Date.now()

    const info: ConnectionInfo = {
      connectionId,
      ws,
      topics: new Set(topics),
      connectedAt: now,
      lastActiveAt: now,
      metadata,
    }

    this.connections.set(connectionId, info)

    // Update topic index
    for (const topic of topics) {
      if (!this.topicIndex.has(topic)) {
        this.topicIndex.set(topic, new Set())
      }
      this.topicIndex.get(topic)!.add(connectionId)
    }

    return connectionId
  }

  /**
   * Remove a connection by ID
   */
  removeConnection(connectionId: string): void {
    const info = this.connections.get(connectionId)
    if (!info) {
      return
    }

    // Remove from topic index
    for (const topic of info.topics) {
      const connections = this.topicIndex.get(topic)
      if (connections) {
        connections.delete(connectionId)
        if (connections.size === 0) {
          this.topicIndex.delete(topic)
        }
      }
    }

    this.connections.delete(connectionId)
  }

  /**
   * Get all WebSocket connections subscribed to a topic
   * Supports wildcard matching
   */
  getConnectionsByTopic(topic: string): WebSocket[] {
    const result: WebSocket[] = []
    const seen = new Set<string>()

    for (const [connectionId, info] of this.connections) {
      if (seen.has(connectionId)) continue

      for (const subTopic of info.topics) {
        if (matchesTopic(subTopic, topic)) {
          result.push(info.ws)
          seen.add(connectionId)
          break
        }
      }
    }

    return result
  }

  /**
   * Update subscriptions for an existing connection (replaces all topics)
   */
  updateSubscriptions(connectionId: string, topics: string[]): void {
    const info = this.connections.get(connectionId)
    if (!info) {
      return
    }

    // Remove old subscriptions from index
    for (const topic of info.topics) {
      const connections = this.topicIndex.get(topic)
      if (connections) {
        connections.delete(connectionId)
        if (connections.size === 0) {
          this.topicIndex.delete(topic)
        }
      }
    }

    // Set new topics
    info.topics = new Set(topics)
    info.lastActiveAt = Date.now()

    // Add new subscriptions to index
    for (const topic of topics) {
      if (!this.topicIndex.has(topic)) {
        this.topicIndex.set(topic, new Set())
      }
      this.topicIndex.get(topic)!.add(connectionId)
    }
  }

  /**
   * Add topics to an existing connection's subscriptions
   */
  addSubscriptions(connectionId: string, topics: string[]): void {
    const info = this.connections.get(connectionId)
    if (!info) {
      return
    }

    info.lastActiveAt = Date.now()

    for (const topic of topics) {
      info.topics.add(topic)
      if (!this.topicIndex.has(topic)) {
        this.topicIndex.set(topic, new Set())
      }
      this.topicIndex.get(topic)!.add(connectionId)
    }
  }

  /**
   * Remove topics from an existing connection's subscriptions
   */
  removeSubscriptions(connectionId: string, topics: string[]): void {
    const info = this.connections.get(connectionId)
    if (!info) {
      return
    }

    info.lastActiveAt = Date.now()

    for (const topic of topics) {
      info.topics.delete(topic)
      const connections = this.topicIndex.get(topic)
      if (connections) {
        connections.delete(connectionId)
        if (connections.size === 0) {
          this.topicIndex.delete(topic)
        }
      }
    }
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Get connection info by ID
   */
  getConnection(connectionId: string): ConnectionInfo | undefined {
    return this.connections.get(connectionId)
  }

  /**
   * Get all topics with active subscribers
   */
  getActiveTopics(): string[] {
    return Array.from(this.topicIndex.keys())
  }

  /**
   * Check if a connection is subscribed to a topic
   */
  isSubscribed(connectionId: string, topic: string): boolean {
    const info = this.connections.get(connectionId)
    if (!info) {
      return false
    }
    return info.topics.has(topic)
  }
}
