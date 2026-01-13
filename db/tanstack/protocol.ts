/**
 * Wire Protocol Types for TanStack DB Sync
 *
 * Defines the WebSocket message format for client-server communication.
 * This is the canonical source for sync protocol types used by:
 * - Server: SyncEngine in objects/transport/sync-engine.ts
 * - Client: SyncClient in db/tanstack/sync-client.ts
 *
 * Wire Protocol Reference:
 *
 * Client -> Server:
 *   { type: 'subscribe', collection: 'Task', branch?: string }
 *   { type: 'unsubscribe', collection: 'Task' }
 *
 * Server -> Client:
 *   { type: 'initial', collection: 'Task', branch: string | null, data: T[], txid: number }
 *   { type: 'insert', collection: 'Task', branch: string | null, key: string, data: T, txid: number }
 *   { type: 'update', collection: 'Task', branch: string | null, key: string, data: T, txid: number }
 *   { type: 'delete', collection: 'Task', branch: string | null, key: string, txid: number }
 *
 * @module db/tanstack/protocol
 */

// =============================================================================
// Base Types
// =============================================================================

/**
 * Base item interface with required sync fields
 */
export interface SyncItem {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Change types for sync messages
 */
export type ChangeType = 'insert' | 'update' | 'delete'

// =============================================================================
// Client -> Server Messages
// =============================================================================

/**
 * Subscribe message from client
 */
export interface SubscribeMessage {
  type: 'subscribe'
  collection: string
  branch?: string | null
  query?: {
    limit?: number
    offset?: number
  }
}

/**
 * Unsubscribe message from client
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe'
  collection: string
}

/**
 * Pong response from client to server heartbeat
 */
export interface PongMessage {
  type: 'pong'
  timestamp: number
}

/**
 * All possible client -> server messages
 */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PongMessage

// =============================================================================
// Server -> Client Messages
// =============================================================================

/**
 * Initial state message sent on subscription
 */
export interface InitialMessage<T = SyncItem> {
  type: 'initial'
  collection: string
  branch: string | null
  data: T[]
  txid: number
}

/**
 * Insert change message
 */
export interface InsertMessage<T = SyncItem> {
  type: 'insert'
  collection: string
  branch: string | null
  key: string
  data: T
  txid: number
}

/**
 * Update change message
 */
export interface UpdateMessage<T = SyncItem> {
  type: 'update'
  collection: string
  branch: string | null
  key: string
  data: T
  txid: number
}

/**
 * Delete change message
 */
export interface DeleteMessage {
  type: 'delete'
  collection: string
  branch: string | null
  key: string
  txid: number
}

/**
 * Change message (insert, update, or delete)
 */
export type ChangeMessage<T = SyncItem> = InsertMessage<T> | UpdateMessage<T> | DeleteMessage

/**
 * Ping message from server for heartbeat
 */
export interface PingMessage {
  type: 'ping'
  timestamp: number
}

/**
 * All possible server -> client messages
 */
export type ServerMessage<T = SyncItem> = InitialMessage<T> | ChangeMessage<T> | PingMessage

// =============================================================================
// Deprecated Aliases (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use ChangeMessage instead
 */
export interface Change {
  type: ChangeType
  collection: string
  key: string
  branch?: string | null
  data?: SyncItem
  txid: number
}
