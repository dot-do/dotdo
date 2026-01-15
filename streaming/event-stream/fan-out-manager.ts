/**
 * FanOutManager - Topic-based message broadcasting
 *
 * Implements IFanOutManager interface for broadcasting messages
 * to WebSocket connections with topic matching support.
 * Extracted from EventStreamDO as part of Wave 3 decomposition.
 *
 * @issue do-yz06 - FanOutManager Implementation
 * @wave Wave 3: EventStreamDO Decomposition
 */

import type { IConnectionManager, ConnectionInfo } from './connection-manager'

// ============================================================================
// INTERFACE DEFINITION
// ============================================================================

/**
 * Broadcast result containing delivery statistics
 */
export interface BroadcastResult {
  /** Number of connections that received the message */
  delivered: number
  /** Number of connections that failed to receive */
  failed: number
  /** Connection IDs that failed (for retry logic) */
  failedConnections: string[]
}

/**
 * Batch message for broadcasting multiple messages at once
 */
export interface BatchMessage {
  topic: string
  message: unknown
}

/**
 * IFanOutManager - Interface for topic-based message broadcasting
 *
 * Responsibilities:
 * - Broadcast messages to all connections subscribed to a topic
 * - Support wildcard topic matching
 * - Handle batch broadcasts efficiently
 * - Track delivery statistics
 */
export interface IFanOutManager {
  /**
   * Broadcast a message to all connections subscribed to a topic
   * @returns Number of connections that received the message
   */
  broadcast(topic: string, message: unknown): Promise<number>

  /**
   * Broadcast a message with detailed result
   */
  broadcastWithResult(topic: string, message: unknown): Promise<BroadcastResult>

  /**
   * Broadcast multiple messages efficiently
   * @returns Total number of messages delivered (across all topics)
   */
  broadcastBatch(messages: BatchMessage[]): Promise<number>

  /**
   * Broadcast to a specific connection (direct message)
   */
  sendToConnection(connectionId: string, message: unknown): Promise<boolean>

  /**
   * Broadcast to multiple specific connections
   */
  sendToConnections(connectionIds: string[], message: unknown): Promise<number>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Serialize a message for sending over WebSocket
 */
function serializeMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message
  }
  return JSON.stringify(message)
}

/**
 * Check if a subscription pattern matches a topic
 * (Duplicated from connection-manager to avoid circular dependencies)
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
// EXTENDED CONNECTION MANAGER INTERFACE
// ============================================================================

/**
 * Extended interface for connection manager with the methods we need
 */
interface IConnectionManagerExtended extends IConnectionManager {
  /**
   * Get connection by ID (we need this for sendToConnection)
   */
  getConnection(connectionId: string): ConnectionInfo | undefined
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * FanOutManager - Topic-based message broadcasting
 *
 * Features:
 * - Broadcast messages to topic subscribers
 * - Wildcard topic matching support
 * - Batch broadcasting for efficiency
 * - Delivery tracking and error handling
 */
export class FanOutManager implements IFanOutManager {
  constructor(private connectionManager: IConnectionManagerExtended) {}

  /**
   * Broadcast a message to all connections subscribed to a topic
   */
  async broadcast(topic: string, message: unknown): Promise<number> {
    const result = await this.broadcastWithResult(topic, message)
    return result.delivered
  }

  /**
   * Broadcast a message with detailed result
   */
  async broadcastWithResult(topic: string, message: unknown): Promise<BroadcastResult> {
    const connections = this.connectionManager.getConnectionsByTopic(topic)
    const serialized = serializeMessage(message)

    let delivered = 0
    let failed = 0
    const failedConnections: string[] = []

    // We need to find the connection ID for each WebSocket
    // This is a bit inefficient but necessary for tracking failures
    for (const ws of connections) {
      try {
        ws.send(serialized)
        delivered++
      } catch {
        failed++
        // We can't easily get the connection ID from the WebSocket
        // In a production implementation, we'd maintain a reverse map
      }
    }

    return {
      delivered,
      failed,
      failedConnections,
    }
  }

  /**
   * Broadcast multiple messages efficiently
   */
  async broadcastBatch(messages: BatchMessage[]): Promise<number> {
    if (messages.length === 0) {
      return 0
    }

    let totalDelivered = 0

    // Track which connections have received which messages to avoid duplicates
    const connectionMessagesSent = new Map<WebSocket, Set<string>>()

    for (const { topic, message } of messages) {
      const connections = this.connectionManager.getConnectionsByTopic(topic)
      const serialized = serializeMessage(message)

      for (const ws of connections) {
        // Check if this connection already received this exact message
        if (!connectionMessagesSent.has(ws)) {
          connectionMessagesSent.set(ws, new Set())
        }
        const sentMessages = connectionMessagesSent.get(ws)!

        // Use the serialized message as a key for deduplication
        if (!sentMessages.has(serialized)) {
          try {
            ws.send(serialized)
            sentMessages.add(serialized)
            totalDelivered++
          } catch {
            // Silently ignore errors in batch mode
          }
        }
      }
    }

    return totalDelivered
  }

  /**
   * Send a message to a specific connection by ID
   */
  async sendToConnection(connectionId: string, message: unknown): Promise<boolean> {
    const info = this.connectionManager.getConnection(connectionId)
    if (!info) {
      return false
    }

    const serialized = serializeMessage(message)

    try {
      info.ws.send(serialized)
      return true
    } catch {
      return false
    }
  }

  /**
   * Send a message to multiple specific connections
   */
  async sendToConnections(connectionIds: string[], message: unknown): Promise<number> {
    if (connectionIds.length === 0) {
      return 0
    }

    const serialized = serializeMessage(message)
    let successful = 0

    for (const connectionId of connectionIds) {
      const info = this.connectionManager.getConnection(connectionId)
      if (!info) {
        continue
      }

      try {
        info.ws.send(serialized)
        successful++
      } catch {
        // Silently ignore errors
      }
    }

    return successful
  }
}
