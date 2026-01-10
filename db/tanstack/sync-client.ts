/**
 * SyncClient - WebSocket sync client for real-time updates
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

/** Base delay for reconnection in milliseconds */
const RECONNECT_BASE_DELAY_MS = 1000

/** Maximum delay for reconnection in milliseconds */
const RECONNECT_MAX_DELAY_MS = 30000

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

  // WebSocket instance
  private ws: WebSocket | null = null

  // Reconnection state
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalDisconnect = false

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
    // Reset intentional disconnect flag when connecting
    this.intentionalDisconnect = false

    // Create WebSocket connection
    const wsUrl = `${this.config.doUrl}/sync`
    this.ws = new WebSocket(wsUrl)

    this.ws.addEventListener('open', () => {
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0

      // Send subscribe message
      const subscribeMsg: Record<string, string> = {
        type: 'subscribe',
        collection: this.config.collection,
      }

      if (this.config.branch) {
        subscribeMsg.branch = this.config.branch
      }

      this.ws!.send(JSON.stringify(subscribeMsg))
    })

    this.ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'initial') {
          this.onInitial(msg.data, msg.txid)
        } else if (msg.type === 'insert' || msg.type === 'update') {
          this.onChange(msg.type, msg.data, msg.txid)
        } else if (msg.type === 'delete') {
          // For delete, pass the data or construct an object with key info
          const item = msg.data || { key: msg.key }
          this.onChange('delete', item as T, msg.txid)
        }
        // Unknown message types are silently ignored
      } catch {
        // Malformed JSON - silently ignore
      }
    })

    this.ws.addEventListener('close', () => {
      this.onDisconnect()

      // Only schedule reconnect if this wasn't an intentional disconnect
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect()
      }
    })

    this.ws.addEventListener('error', () => {
      // Error handling - the onclose handler will fire after this
      // and handle reconnection
    })
  }

  /**
   * Disconnect from the WebSocket server
   *
   * Sends an unsubscribe message and closes the WebSocket connection.
   * Cancels any pending reconnection attempts.
   */
  disconnect(): void {
    // Mark as intentional disconnect to prevent auto-reconnect
    this.intentionalDisconnect = true

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      // Only send unsubscribe if socket is open
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'unsubscribe',
          collection: this.config.collection,
        }))
      }

      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    // Calculate delay with exponential backoff, capped at max delay
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
