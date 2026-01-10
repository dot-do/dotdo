/**
 * SyncClient - WebSocket sync client for real-time updates
 *
 * STUB FILE - Implementation pending (see dotdo-i5oxh)
 *
 * This file provides type definitions for the SyncClient class.
 * The implementation will be completed in the GREEN phase.
 *
 * Wire Protocol Reference:
 *
 * Client -> Server:
 *   { type: 'subscribe', collection: 'Task', branch?: string }
 *   { type: 'unsubscribe', collection: 'Task' }
 *
 * Server -> Client:
 *   { type: 'initial', collection: 'Task', data: T[], txid: number }
 *   { type: 'insert', collection: 'Task', key: string, data: T, txid: number }
 *   { type: 'update', collection: 'Task', key: string, data: T, txid: number }
 *   { type: 'delete', collection: 'Task', key: string, txid: number }
 */

/**
 * Configuration for SyncClient
 */
export interface SyncClientConfig {
  /** WebSocket URL for the Durable Object (will append /sync) */
  doUrl: string
  /** Collection name (Noun type) */
  collection: string
  /** Optional branch for branched data */
  branch?: string
}

/**
 * WebSocket sync client for real-time updates
 *
 * Handles:
 * - WebSocket connection to DO /sync endpoint
 * - Subscribe/unsubscribe protocol messages
 * - Initial data and change stream handling
 * - Automatic reconnection with exponential backoff
 *
 * @example
 * ```typescript
 * const client = new SyncClient<Task>({
 *   doUrl: 'wss://example.com/do/123',
 *   collection: 'Task',
 * })
 *
 * client.onInitial = (items, txid) => {
 *   console.log('Initial data:', items, 'at txid:', txid)
 * }
 *
 * client.onChange = (op, item, txid) => {
 *   console.log('Change:', op, item, 'at txid:', txid)
 * }
 *
 * client.onDisconnect = () => {
 *   console.log('Disconnected')
 * }
 *
 * client.connect()
 * ```
 */
export class SyncClient<T> {
  // Configuration
  private config: SyncClientConfig

  // Callbacks (to be set by consumer)

  /**
   * Called when initial data is received after subscribing
   * @param items - Array of items in the collection
   * @param txid - Transaction ID for the initial state
   */
  onInitial: (items: T[], txid: number) => void = () => {}

  /**
   * Called when a change is received (insert, update, or delete)
   * @param op - The operation type: 'insert', 'update', or 'delete'
   * @param item - The item that was changed (for delete, may contain key info)
   * @param txid - Transaction ID for the change
   */
  onChange: (op: 'insert' | 'update' | 'delete', item: T, txid: number) => void = () => {}

  /**
   * Called when the WebSocket connection is closed
   */
  onDisconnect: () => void = () => {}

  constructor(config: SyncClientConfig) {
    this.config = config
  }

  /**
   * Connect to the WebSocket server
   *
   * Opens a WebSocket connection to `${doUrl}/sync` and sends a subscribe
   * message for the configured collection. Automatically reconnects with
   * exponential backoff on connection loss.
   */
  connect(): void {
    // TODO: Implement in GREEN phase (dotdo-i5oxh)
    throw new Error('SyncClient.connect() not implemented')
  }

  /**
   * Disconnect from the WebSocket server
   *
   * Sends an unsubscribe message and closes the WebSocket connection.
   * Cancels any pending reconnection attempts.
   */
  disconnect(): void {
    // TODO: Implement in GREEN phase (dotdo-i5oxh)
    throw new Error('SyncClient.disconnect() not implemented')
  }
}
