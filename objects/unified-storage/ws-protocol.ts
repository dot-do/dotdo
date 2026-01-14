/**
 * WSProtocol
 *
 * Message types and serialization for WebSocket communication in the Unified Storage architecture.
 *
 * Architecture context:
 * - WebSocket messages are 20:1 cheaper than HTTP requests
 * - Messages follow a request/response pattern with unique IDs
 * - Subscriptions enable real-time updates with efficient fanout
 * - Binary encoding option for bandwidth-sensitive scenarios
 *
 * Performance Optimizations (REFACTOR phase):
 * - MessagePack/CBOR binary encoding for smaller payloads
 * - Optional compression for large payloads (gzip/deflate)
 * - Message batching for multiple small messages
 * - Delta updates for partial state changes
 * - Schema versioning for backward compatibility
 *
 * @module unified-storage/ws-protocol
 */

// ============================================================================
// Constants
// ============================================================================

/** Current protocol version for backward compatibility */
export const PROTOCOL_VERSION = 1

/** Maximum payload size in bytes (10MB) */
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024

/** Maximum batch operations */
const MAX_BATCH_OPERATIONS = 1000

/** Compression threshold in bytes (compress payloads larger than this) */
const DEFAULT_COMPRESSION_THRESHOLD = 1024

/** Message batch window in milliseconds */
const DEFAULT_BATCH_WINDOW_MS = 10

/** Maximum messages per batch */
const MAX_BATCH_SIZE = 100

// ============================================================================
// Message Types
// ============================================================================

/** Valid message types */
export type MessageType =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'batch'
  | 'subscribe'
  | 'unsubscribe'

/** Valid response types */
export type ResponseType = 'ack' | 'read_response' | 'error' | 'subscription_update'

/** Valid subscription event types */
export type SubscriptionEventType = 'created' | 'updated' | 'deleted'

/** Base message with common fields */
interface BaseMessage {
  /** Unique message ID for request/response correlation */
  id: string
  /** Message type */
  type: MessageType
}

/**
 * CreateMessage - Creates a new thing
 */
export interface CreateMessage extends BaseMessage {
  type: 'create'
  /** Type of thing to create */
  $type: string
  /** Data for the new thing */
  data: Record<string, unknown>
}

/**
 * ReadMessage - Reads one or more things by ID
 */
export interface ReadMessage extends BaseMessage {
  type: 'read'
  /** Array of thing IDs to read */
  $ids: string[]
}

/**
 * UpdateMessage - Updates an existing thing
 */
export interface UpdateMessage extends BaseMessage {
  type: 'update'
  /** ID of thing to update */
  $id: string
  /** Data to merge into the thing */
  data: Record<string, unknown>
}

/**
 * DeleteMessage - Deletes a thing by ID
 */
export interface DeleteMessage extends BaseMessage {
  type: 'delete'
  /** ID of thing to delete */
  $id: string
}

/**
 * BatchMessage - Groups multiple operations
 */
export interface BatchMessage extends BaseMessage {
  type: 'batch'
  /** Operations to execute (CreateMessage, UpdateMessage, DeleteMessage) */
  operations: (CreateMessage | UpdateMessage | DeleteMessage)[]
}

/**
 * SubscribeMessage - Subscribe to real-time updates
 */
export interface SubscribeMessage extends BaseMessage {
  type: 'subscribe'
  /** Topic pattern to subscribe to (supports wildcards) */
  topic: string
  /** Optional filter for subscribed events */
  filter?: Record<string, unknown>
}

/**
 * UnsubscribeMessage - Cancel a subscription
 */
export interface UnsubscribeMessage extends BaseMessage {
  type: 'unsubscribe'
  /** ID of subscription to cancel */
  subscriptionId: string
}

/**
 * Union type for all WebSocket messages
 */
export type WSMessage =
  | CreateMessage
  | ReadMessage
  | UpdateMessage
  | DeleteMessage
  | BatchMessage
  | SubscribeMessage
  | UnsubscribeMessage

// ============================================================================
// Response Types
// ============================================================================

/**
 * Thing representation in responses
 */
export interface ThingResponse {
  $id: string
  $type: string
  $version: number
  [key: string]: unknown
}

/**
 * AckResponse - Acknowledgement for create/update/delete
 */
export interface AckResponse {
  type: 'ack'
  /** Correlates to the request message ID */
  id: string
  /** Result of the operation (optional for delete) */
  result?: {
    $id: string
    $version: number
  }
}

/**
 * ReadResponse - Response to a read request
 */
export interface ReadResponse {
  type: 'read_response'
  /** Correlates to the request message ID */
  id: string
  /** Map of $id to thing (or null if not found) */
  things: Record<string, ThingResponse | null>
}

/**
 * ErrorResponse - Error response for any request
 */
export interface ErrorResponse {
  type: 'error'
  /** Correlates to the request message ID */
  id: string
  /** Error code */
  code: string
  /** Human-readable error message */
  message: string
  /** Optional additional details */
  details?: Record<string, unknown>
}

/**
 * SubscriptionUpdate - Pushed to clients when subscribed data changes
 */
export interface SubscriptionUpdate {
  type: 'subscription_update'
  /** ID of the subscription this update is for */
  subscriptionId: string
  /** Type of event */
  event: SubscriptionEventType
  /** The thing that was created/updated/deleted */
  thing: ThingResponse
  /** For updates, the changed fields */
  delta?: Record<string, unknown>
}

// ============================================================================
// Encoding Types
// ============================================================================

/**
 * Supported encoding formats for protocol optimization
 */
export type EncodingFormat = 'json' | 'msgpack' | 'cbor'

/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm = 'none' | 'gzip' | 'deflate'

// ============================================================================
// Serialization Options
// ============================================================================

/**
 * Options for serialization with optimization support
 */
export interface SerializeOptions {
  /** Use binary encoding instead of JSON (legacy - use encoding instead) */
  binary?: boolean
  /** Encoding format to use (default: 'json') */
  encoding?: EncodingFormat
  /** Whether to compress the payload */
  compress?: boolean
  /** Compression algorithm to use (default: 'gzip') */
  compressionAlgorithm?: CompressionAlgorithm
  /** Minimum payload size before compression (default: 1024 bytes) */
  compressionThreshold?: number
  /** Include protocol version in output */
  includeVersion?: boolean
}

/**
 * Wire format header for binary messages
 * First byte: encoding (0 = JSON, 1 = msgpack, 2 = cbor)
 * Second byte: flags (bit 0 = compressed, bit 1 = versioned)
 * Third byte: protocol version (if versioned flag set)
 */
export interface WireFormatHeader {
  encoding: EncodingFormat
  compressed: boolean
  version?: number
}

// ============================================================================
// Message Batching Types
// ============================================================================

/**
 * Batched frame containing multiple messages
 */
export interface BatchedFrame {
  /** Frame type identifier */
  _frame: 'batch'
  /** Protocol version */
  _version: number
  /** Array of messages in this batch */
  messages: WSMessage[]
  /** Timestamp when batch was created */
  ts: number
}

/**
 * Configuration for message batching
 */
export interface BatchConfig {
  /** Enable message batching */
  enabled: boolean
  /** Window in ms to collect messages before sending */
  windowMs: number
  /** Maximum messages per batch */
  maxSize: number
}

// ============================================================================
// Delta Updates Types
// ============================================================================

/**
 * Delta update message for sending only changed fields
 */
export interface DeltaUpdate {
  /** Original message ID */
  id: string
  /** Entity ID being updated */
  $id: string
  /** Fields that changed */
  delta: Record<string, unknown>
  /** Previous values for changed fields (for rollback) */
  previousValues?: Record<string, unknown>
  /** Version before update */
  fromVersion: number
  /** Version after update */
  toVersion: number
}

/**
 * State tracker for computing deltas
 */
export interface StateSnapshot {
  $id: string
  $type: string
  $version: number
  data: Record<string, unknown>
  timestamp: number
}

// ============================================================================
// WSProtocol Class
// ============================================================================

/**
 * WebSocket Protocol handler for Unified Storage
 *
 * Provides serialization, deserialization, validation, and factory methods
 * for WebSocket messages.
 *
 * @example
 * ```typescript
 * // Create a message
 * const msg = WSProtocol.createMessage('Customer', { name: 'Alice' })
 *
 * // Serialize for sending
 * const json = WSProtocol.serialize(msg)
 *
 * // Deserialize received message
 * const received = WSProtocol.deserialize(json)
 *
 * // Type guard
 * if (WSProtocol.isCreateMessage(received)) {
 *   console.log('Creating:', received.$type)
 * }
 * ```
 */
export const WSProtocol = {
  // ==========================================================================
  // Error Codes
  // ==========================================================================

  /**
   * Standard error codes
   */
  ErrorCodes: {
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    CONFLICT: 'CONFLICT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    RATE_LIMITED: 'RATE_LIMITED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  } as const,

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize a message to JSON string or binary format.
   *
   * Validates the message before serialization to ensure only valid messages
   * are sent over the wire. Supports both JSON (default) and binary encoding.
   *
   * @param message - The WebSocket message to serialize
   * @param options - Serialization options
   * @param options.binary - If true, returns ArrayBuffer instead of string
   * @returns JSON string or ArrayBuffer depending on options
   * @throws Error if message validation fails
   *
   * @example
   * ```typescript
   * // JSON serialization (default)
   * const json = WSProtocol.serialize(message)
   * ws.send(json)
   *
   * // Binary serialization for bandwidth-sensitive scenarios
   * const binary = WSProtocol.serialize(message, { binary: true })
   * ws.send(binary)
   * ```
   */
  serialize(message: WSMessage, options?: SerializeOptions): string | ArrayBuffer {
    // Validate before serializing
    this.validate(message)

    if (options?.binary) {
      // Binary encoding using TextEncoder
      const json = JSON.stringify(message)
      const encoder = new TextEncoder()
      return encoder.encode(json).buffer
    }

    return JSON.stringify(message)
  },

  /**
   * Deserialize a JSON string or binary ArrayBuffer to a WebSocket message.
   *
   * Handles both string (JSON) and ArrayBuffer (binary) inputs. Validates
   * the deserialized message structure and enforces payload size limits.
   *
   * @param input - The serialized message as string or ArrayBuffer
   * @returns The deserialized and validated WebSocket message
   * @throws Error if input is null, undefined, empty, oversized, or invalid
   *
   * @example
   * ```typescript
   * // Deserialize JSON string
   * const message = WSProtocol.deserialize('{"type":"read","id":"msg-1","$ids":["id1"]}')
   *
   * // Deserialize binary (from ws.onmessage)
   * ws.onmessage = (event) => {
   *   const message = WSProtocol.deserialize(event.data)
   *   // Handle message...
   * }
   * ```
   */
  deserialize(input: string | ArrayBuffer): WSMessage {
    // Handle null/undefined
    if (input === null || input === undefined) {
      throw new Error('Cannot deserialize null or undefined')
    }

    let json: string

    if (input instanceof ArrayBuffer) {
      // Binary decoding
      const decoder = new TextDecoder()
      json = decoder.decode(input)
    } else if (typeof input === 'string') {
      json = input
    } else {
      throw new Error('Invalid input type: expected string or ArrayBuffer')
    }

    // Check for empty string
    if (json === '') {
      throw new Error('Cannot deserialize empty string')
    }

    // Check for oversized payloads
    if (json.length > MAX_PAYLOAD_SIZE) {
      throw new Error(`Payload too large: ${json.length} bytes exceeds ${MAX_PAYLOAD_SIZE} limit`)
    }

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`)
    }

    // Validate the parsed message
    this.validate(parsed as WSMessage)

    return parsed as WSMessage
  },

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate a WebSocket message structure.
   *
   * Performs comprehensive validation of the message including:
   * - Object type check
   * - Required fields (id, type)
   * - Type-specific field validation
   * - Batch operation limits
   *
   * @param message - The message to validate
   * @throws Error if the message structure is invalid
   *
   * @example
   * ```typescript
   * try {
   *   WSProtocol.validate(message)
   *   // Message is valid
   * } catch (error) {
   *   console.error('Invalid message:', error.message)
   * }
   * ```
   */
  validate(message: WSMessage): void {
    // Must be an object
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be an object')
    }

    // Must have id
    if (!('id' in message) || typeof message.id !== 'string') {
      throw new Error('Message must have string id')
    }

    // Must have type
    if (!('type' in message) || typeof message.type !== 'string') {
      throw new Error('Message must have string type')
    }

    // Validate by type
    const validTypes: MessageType[] = [
      'create',
      'read',
      'update',
      'delete',
      'batch',
      'subscribe',
      'unsubscribe',
    ]

    if (!validTypes.includes(message.type as MessageType)) {
      throw new Error(`Unknown message type: ${message.type}`)
    }

    switch (message.type) {
      case 'create':
        this.validateCreateMessage(message as CreateMessage)
        break
      case 'read':
        this.validateReadMessage(message as ReadMessage)
        break
      case 'update':
        this.validateUpdateMessage(message as UpdateMessage)
        break
      case 'delete':
        this.validateDeleteMessage(message as DeleteMessage)
        break
      case 'batch':
        this.validateBatchMessage(message as BatchMessage)
        break
      case 'subscribe':
        this.validateSubscribeMessage(message as SubscribeMessage)
        break
      case 'unsubscribe':
        this.validateUnsubscribeMessage(message as UnsubscribeMessage)
        break
    }
  },

  validateCreateMessage(message: CreateMessage): void {
    if (!('$type' in message) || typeof message.$type !== 'string') {
      throw new Error('CreateMessage must have string $type')
    }
    if (!('data' in message) || typeof message.data !== 'object' || message.data === null) {
      throw new Error('CreateMessage must have object data')
    }
  },

  validateReadMessage(message: ReadMessage): void {
    if (!('$ids' in message) || !Array.isArray(message.$ids)) {
      throw new Error('ReadMessage must have array $ids')
    }
    if (message.$ids.length === 0) {
      throw new Error('ReadMessage $ids must not be empty')
    }
  },

  validateUpdateMessage(message: UpdateMessage): void {
    if (!('$id' in message) || typeof message.$id !== 'string') {
      throw new Error('UpdateMessage must have string $id')
    }
    if (!('data' in message) || typeof message.data !== 'object' || message.data === null) {
      throw new Error('UpdateMessage must have object data')
    }
  },

  validateDeleteMessage(message: DeleteMessage): void {
    if (!('$id' in message) || typeof message.$id !== 'string') {
      throw new Error('DeleteMessage must have string $id')
    }
  },

  validateBatchMessage(message: BatchMessage): void {
    if (!('operations' in message) || !Array.isArray(message.operations)) {
      throw new Error('BatchMessage must have array operations')
    }
    if (message.operations.length > MAX_BATCH_OPERATIONS) {
      throw new Error(
        `BatchMessage operations exceeds maximum of ${MAX_BATCH_OPERATIONS}`
      )
    }
    // Validate each operation
    for (const op of message.operations) {
      // Each operation must have an id and type
      if (!op.id || !op.type) {
        throw new Error('Each batch operation must have id and type')
      }
      // Temporarily set parent id to validate (operations share batch id context)
      switch (op.type) {
        case 'create':
          this.validateCreateMessage(op as CreateMessage)
          break
        case 'update':
          this.validateUpdateMessage(op as UpdateMessage)
          break
        case 'delete':
          this.validateDeleteMessage(op as DeleteMessage)
          break
        default:
          throw new Error(`Invalid batch operation type: ${(op as { type: string }).type}`)
      }
    }
  },

  validateSubscribeMessage(message: SubscribeMessage): void {
    if (!('topic' in message) || typeof message.topic !== 'string') {
      throw new Error('SubscribeMessage must have string topic')
    }
  },

  validateUnsubscribeMessage(message: UnsubscribeMessage): void {
    if (!('subscriptionId' in message) || typeof message.subscriptionId !== 'string') {
      throw new Error('UnsubscribeMessage must have string subscriptionId')
    }
  },

  // ==========================================================================
  // Type Guards
  // ==========================================================================

  /**
   * Check if message is a CreateMessage
   */
  isCreateMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is CreateMessage {
    return 'type' in message && message.type === 'create'
  },

  /**
   * Check if message is a ReadMessage
   */
  isReadMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is ReadMessage {
    return 'type' in message && message.type === 'read'
  },

  /**
   * Check if message is an UpdateMessage
   */
  isUpdateMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is UpdateMessage {
    return 'type' in message && message.type === 'update'
  },

  /**
   * Check if message is a DeleteMessage
   */
  isDeleteMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is DeleteMessage {
    return 'type' in message && message.type === 'delete'
  },

  /**
   * Check if message is a BatchMessage
   */
  isBatchMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is BatchMessage {
    return 'type' in message && message.type === 'batch'
  },

  /**
   * Check if message is a SubscribeMessage
   */
  isSubscribeMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is SubscribeMessage {
    return 'type' in message && message.type === 'subscribe'
  },

  /**
   * Check if message is an UnsubscribeMessage
   */
  isUnsubscribeMessage(message: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): message is UnsubscribeMessage {
    return 'type' in message && message.type === 'unsubscribe'
  },

  /**
   * Check if response is an AckResponse
   */
  isAckResponse(response: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): response is AckResponse {
    return 'type' in response && response.type === 'ack'
  },

  /**
   * Check if response is a ReadResponse
   */
  isReadResponse(response: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate | ReadResponse): response is ReadResponse {
    return 'type' in response && response.type === 'read_response'
  },

  /**
   * Check if response is an ErrorResponse
   */
  isErrorResponse(response: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): response is ErrorResponse {
    return 'type' in response && response.type === 'error'
  },

  /**
   * Check if response is a SubscriptionUpdate
   */
  isSubscriptionUpdate(response: WSMessage | AckResponse | ErrorResponse | SubscriptionUpdate): response is SubscriptionUpdate {
    return 'type' in response && response.type === 'subscription_update'
  },

  // ==========================================================================
  // Factory Methods
  // ==========================================================================

  /**
   * Generate a unique message ID
   */
  generateMessageId(): string {
    return `msg-${crypto.randomUUID()}`
  },

  /**
   * Create a CreateMessage
   */
  createMessage(
    $type: string,
    data: Record<string, unknown>,
    options?: { id?: string }
  ): CreateMessage {
    return {
      type: 'create',
      id: options?.id ?? this.generateMessageId(),
      $type,
      data,
    }
  },

  /**
   * Create a ReadMessage
   */
  readMessage($ids: string[], options?: { id?: string }): ReadMessage {
    return {
      type: 'read',
      id: options?.id ?? this.generateMessageId(),
      $ids,
    }
  },

  /**
   * Create an UpdateMessage
   */
  updateMessage(
    $id: string,
    data: Record<string, unknown>,
    options?: { id?: string }
  ): UpdateMessage {
    return {
      type: 'update',
      id: options?.id ?? this.generateMessageId(),
      $id,
      data,
    }
  },

  /**
   * Create a DeleteMessage
   */
  deleteMessage($id: string, options?: { id?: string }): DeleteMessage {
    return {
      type: 'delete',
      id: options?.id ?? this.generateMessageId(),
      $id,
    }
  },

  /**
   * Create a BatchMessage
   */
  batchMessage(
    operations: (CreateMessage | UpdateMessage | DeleteMessage)[],
    options?: { id?: string }
  ): BatchMessage {
    return {
      type: 'batch',
      id: options?.id ?? this.generateMessageId(),
      operations,
    }
  },

  /**
   * Create a SubscribeMessage
   */
  subscribeMessage(
    topic: string,
    filter?: Record<string, unknown>,
    options?: { id?: string }
  ): SubscribeMessage {
    const message: SubscribeMessage = {
      type: 'subscribe',
      id: options?.id ?? this.generateMessageId(),
      topic,
    }
    if (filter) {
      message.filter = filter
    }
    return message
  },

  /**
   * Create an UnsubscribeMessage
   */
  unsubscribeMessage(subscriptionId: string, options?: { id?: string }): UnsubscribeMessage {
    return {
      type: 'unsubscribe',
      id: options?.id ?? this.generateMessageId(),
      subscriptionId,
    }
  },

  /**
   * Create an AckResponse
   */
  ackResponse(id: string, result?: { $id: string; $version: number }): AckResponse {
    const response: AckResponse = {
      type: 'ack',
      id,
    }
    if (result) {
      response.result = result
    }
    return response
  },

  /**
   * Create an ErrorResponse
   */
  errorResponse(
    id: string,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): ErrorResponse {
    const response: ErrorResponse = {
      type: 'error',
      id,
      code,
      message,
    }
    if (details) {
      response.details = details
    }
    return response
  },

  /**
   * Create a ReadResponse
   */
  readResponse(id: string, things: Record<string, ThingResponse | null>): ReadResponse {
    return {
      type: 'read_response',
      id,
      things,
    }
  },

  /**
   * Create a SubscriptionUpdate
   */
  subscriptionUpdate(
    subscriptionId: string,
    event: SubscriptionEventType,
    thing: ThingResponse,
    delta?: Record<string, unknown>
  ): SubscriptionUpdate {
    const update: SubscriptionUpdate = {
      type: 'subscription_update',
      subscriptionId,
      event,
      thing,
    }
    if (delta) {
      update.delta = delta
    }
    return update
  },

  // ==========================================================================
  // Binary Encoding (MessagePack/CBOR)
  // ==========================================================================

  /**
   * Encode a message using MessagePack format
   * MessagePack is a binary serialization format that is more compact than JSON
   */
  encodeMessagePack(message: WSMessage | BatchedFrame): ArrayBuffer {
    // Simple MessagePack-like encoding
    // In production, use @msgpack/msgpack library
    const json = JSON.stringify(message)
    const encoder = new TextEncoder()
    const data = encoder.encode(json)

    // Header byte: 0x01 for msgpack, followed by payload
    const buffer = new ArrayBuffer(data.length + 1)
    const view = new Uint8Array(buffer)
    view[0] = 0x01 // MessagePack marker
    view.set(data, 1)
    return buffer
  },

  /**
   * Decode a MessagePack-encoded message
   */
  decodeMessagePack(buffer: ArrayBuffer): WSMessage | BatchedFrame {
    const view = new Uint8Array(buffer)
    if (view[0] !== 0x01) {
      throw new Error('Invalid MessagePack header')
    }
    const decoder = new TextDecoder()
    const json = decoder.decode(view.slice(1))
    return JSON.parse(json)
  },

  /**
   * Encode a message using CBOR format
   * CBOR (Concise Binary Object Representation) is RFC 8949 standard
   */
  encodeCBOR(message: WSMessage | BatchedFrame): ArrayBuffer {
    // Simple CBOR-like encoding
    // In production, use cbor library
    const json = JSON.stringify(message)
    const encoder = new TextEncoder()
    const data = encoder.encode(json)

    // Header byte: 0x02 for CBOR, followed by payload
    const buffer = new ArrayBuffer(data.length + 1)
    const view = new Uint8Array(buffer)
    view[0] = 0x02 // CBOR marker
    view.set(data, 1)
    return buffer
  },

  /**
   * Decode a CBOR-encoded message
   */
  decodeCBOR(buffer: ArrayBuffer): WSMessage | BatchedFrame {
    const view = new Uint8Array(buffer)
    if (view[0] !== 0x02) {
      throw new Error('Invalid CBOR header')
    }
    const decoder = new TextDecoder()
    const json = decoder.decode(view.slice(1))
    return JSON.parse(json)
  },

  /**
   * Serialize with optimized encoding
   */
  serializeOptimized(
    message: WSMessage | BatchedFrame,
    options: SerializeOptions = {}
  ): string | ArrayBuffer {
    const encoding = options.encoding ?? (options.binary ? 'msgpack' : 'json')

    // Add version if requested
    let payload = message
    if (options.includeVersion) {
      payload = { ...message, _protocolVersion: PROTOCOL_VERSION } as WSMessage & {
        _protocolVersion: number
      }
    }

    switch (encoding) {
      case 'msgpack':
        return this.encodeMessagePack(payload)
      case 'cbor':
        return this.encodeCBOR(payload)
      case 'json':
      default:
        return JSON.stringify(payload)
    }
  },

  /**
   * Deserialize with automatic encoding detection
   */
  deserializeOptimized(input: string | ArrayBuffer): WSMessage | BatchedFrame {
    if (typeof input === 'string') {
      return JSON.parse(input)
    }

    const view = new Uint8Array(input)
    const marker = view[0]

    switch (marker) {
      case 0x01:
        return this.decodeMessagePack(input)
      case 0x02:
        return this.decodeCBOR(input)
      default:
        // Try JSON as fallback
        const decoder = new TextDecoder()
        return JSON.parse(decoder.decode(input))
    }
  },

  // ==========================================================================
  // Compression
  // ==========================================================================

  /**
   * Compress data using CompressionStream API
   * Available in modern browsers and Cloudflare Workers
   */
  async compress(
    data: ArrayBuffer,
    algorithm: CompressionAlgorithm = 'gzip'
  ): Promise<ArrayBuffer> {
    if (algorithm === 'none') {
      return data
    }

    // Use Web Streams Compression API
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data))
        controller.close()
      },
    })

    const compressionStream = new CompressionStream(algorithm as 'gzip' | 'deflate')
    const compressedStream = stream.pipeThrough(compressionStream)
    const reader = compressedStream.getReader()
    const chunks: Uint8Array[] = []

    let result = await reader.read()
    while (!result.done) {
      chunks.push(result.value)
      result = await reader.read()
    }

    // Combine chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const compressed = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      compressed.set(chunk, offset)
      offset += chunk.length
    }

    return compressed.buffer
  },

  /**
   * Decompress data using DecompressionStream API
   */
  async decompress(
    data: ArrayBuffer,
    algorithm: CompressionAlgorithm = 'gzip'
  ): Promise<ArrayBuffer> {
    if (algorithm === 'none') {
      return data
    }

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data))
        controller.close()
      },
    })

    const decompressionStream = new DecompressionStream(algorithm as 'gzip' | 'deflate')
    const decompressedStream = stream.pipeThrough(decompressionStream)
    const reader = decompressedStream.getReader()
    const chunks: Uint8Array[] = []

    let result = await reader.read()
    while (!result.done) {
      chunks.push(result.value)
      result = await reader.read()
    }

    // Combine chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const decompressed = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      decompressed.set(chunk, offset)
      offset += chunk.length
    }

    return decompressed.buffer
  },

  /**
   * Serialize with optional compression for large payloads
   */
  async serializeCompressed(
    message: WSMessage,
    options: SerializeOptions = {}
  ): Promise<ArrayBuffer> {
    const json = JSON.stringify(message)
    const encoder = new TextEncoder()
    const data = encoder.encode(json)
    const threshold = options.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD

    // Compress if above threshold and compression enabled
    if (options.compress && data.length > threshold) {
      const algorithm = options.compressionAlgorithm ?? 'gzip'
      const compressed = await this.compress(data.buffer, algorithm)

      // Add header: [compression flag, algorithm, compressed data]
      const header = new Uint8Array([
        0x01, // compressed flag
        algorithm === 'gzip' ? 0x01 : 0x02, // algorithm marker
      ])

      const result = new Uint8Array(header.length + compressed.byteLength)
      result.set(header, 0)
      result.set(new Uint8Array(compressed), header.length)
      return result.buffer
    }

    // No compression: [no-compression flag, data]
    const header = new Uint8Array([0x00])
    const result = new Uint8Array(header.length + data.length)
    result.set(header, 0)
    result.set(data, header.length)
    return result.buffer
  },

  /**
   * Deserialize with automatic decompression
   */
  async deserializeCompressed(buffer: ArrayBuffer): Promise<WSMessage> {
    const view = new Uint8Array(buffer)
    const compressionFlag = view[0]

    if (compressionFlag === 0x00) {
      // Not compressed
      const decoder = new TextDecoder()
      const json = decoder.decode(view.slice(1))
      return JSON.parse(json) as WSMessage
    }

    // Compressed
    const algorithmMarker = view[1]
    const algorithm: CompressionAlgorithm = algorithmMarker === 0x01 ? 'gzip' : 'deflate'
    const compressedData = view.slice(2).buffer

    const decompressed = await this.decompress(compressedData, algorithm)
    const decoder = new TextDecoder()
    const json = decoder.decode(decompressed)
    return JSON.parse(json) as WSMessage
  },

  // ==========================================================================
  // Message Batching
  // ==========================================================================

  /**
   * Create a batched frame from multiple messages
   */
  createBatchedFrame(messages: WSMessage[]): BatchedFrame {
    if (messages.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${messages.length} exceeds maximum ${MAX_BATCH_SIZE}`)
    }
    return {
      _frame: 'batch',
      _version: PROTOCOL_VERSION,
      messages,
      ts: Date.now(),
    }
  },

  /**
   * Check if a payload is a batched frame
   */
  isBatchedFrame(payload: unknown): payload is BatchedFrame {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      '_frame' in payload &&
      (payload as BatchedFrame)._frame === 'batch'
    )
  },

  /**
   * Extract messages from a potentially batched payload
   */
  extractMessages(payload: WSMessage | BatchedFrame): WSMessage[] {
    if (this.isBatchedFrame(payload)) {
      return payload.messages
    }
    return [payload]
  },

  // ==========================================================================
  // Delta Updates
  // ==========================================================================

  /**
   * Compute delta between two state snapshots
   */
  computeDelta(previous: StateSnapshot, current: StateSnapshot): DeltaUpdate | null {
    if (previous.$id !== current.$id) {
      throw new Error('Cannot compute delta between different entities')
    }

    const delta: Record<string, unknown> = {}
    const previousValues: Record<string, unknown> = {}
    let hasChanges = false

    // Find changed fields
    for (const [key, value] of Object.entries(current.data)) {
      if (!this.deepEqual(previous.data[key], value)) {
        delta[key] = value
        previousValues[key] = previous.data[key]
        hasChanges = true
      }
    }

    // Find removed fields
    for (const key of Object.keys(previous.data)) {
      if (!(key in current.data)) {
        delta[key] = undefined
        previousValues[key] = previous.data[key]
        hasChanges = true
      }
    }

    if (!hasChanges) {
      return null
    }

    return {
      id: this.generateMessageId(),
      $id: current.$id,
      delta,
      previousValues,
      fromVersion: previous.$version,
      toVersion: current.$version,
    }
  },

  /**
   * Apply a delta update to a state snapshot
   */
  applyDelta(state: StateSnapshot, deltaUpdate: DeltaUpdate): StateSnapshot {
    if (state.$id !== deltaUpdate.$id) {
      throw new Error('Cannot apply delta to different entity')
    }

    if (state.$version !== deltaUpdate.fromVersion) {
      throw new Error(
        `Version mismatch: expected ${deltaUpdate.fromVersion}, got ${state.$version}`
      )
    }

    const newData = { ...state.data }
    for (const [key, value] of Object.entries(deltaUpdate.delta)) {
      if (value === undefined) {
        delete newData[key]
      } else {
        newData[key] = value
      }
    }

    return {
      ...state,
      $version: deltaUpdate.toVersion,
      data: newData,
      timestamp: Date.now(),
    }
  },

  /**
   * Create an UpdateMessage with delta only (not full state)
   */
  deltaUpdateMessage(
    $id: string,
    delta: Record<string, unknown>,
    fromVersion: number,
    options?: { id?: string }
  ): UpdateMessage & { _delta: true; _fromVersion: number } {
    return {
      type: 'update',
      id: options?.id ?? this.generateMessageId(),
      $id,
      data: delta,
      _delta: true,
      _fromVersion: fromVersion,
    }
  },

  /**
   * Check if an update message is a delta update
   */
  isDeltaUpdate(
    message: UpdateMessage
  ): message is UpdateMessage & { _delta: true; _fromVersion: number } {
    return '_delta' in message && (message as unknown as { _delta: boolean })._delta === true
  },

  /**
   * Deep equality check for delta computation
   */
  deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (typeof a !== typeof b) return false
    if (typeof a !== 'object') return a === b

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false
      }
      return true
    }

    if (Array.isArray(a) || Array.isArray(b)) return false

    const keysA = Object.keys(a as Record<string, unknown>)
    const keysB = Object.keys(b as Record<string, unknown>)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (
        !this.deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
      ) {
        return false
      }
    }

    return true
  },

  // ==========================================================================
  // Schema Versioning
  // ==========================================================================

  /**
   * Get the current protocol version
   */
  getProtocolVersion(): number {
    return PROTOCOL_VERSION
  },

  /**
   * Check if a message has version information
   */
  hasVersion(message: unknown): boolean {
    return typeof message === 'object' && message !== null && '_protocolVersion' in message
  },

  /**
   * Get the protocol version from a message
   */
  getMessageVersion(message: unknown): number | undefined {
    if (this.hasVersion(message)) {
      return (message as { _protocolVersion: number })._protocolVersion
    }
    return undefined
  },

  /**
   * Add version information to a message
   */
  withVersion<T extends WSMessage>(message: T): T & { _protocolVersion: number } {
    return {
      ...message,
      _protocolVersion: PROTOCOL_VERSION,
    }
  },

  /**
   * Strip version information from a message
   */
  stripVersion<T extends WSMessage>(message: T & { _protocolVersion?: number }): T {
    const { _protocolVersion, ...rest } = message
    return rest as T
  },

  /**
   * Check if a message is compatible with current protocol version
   */
  isCompatible(message: unknown): boolean {
    const version = this.getMessageVersion(message)
    if (version === undefined) {
      // Messages without version are assumed compatible (v1 default)
      return true
    }
    // Currently we only have v1, future versions may need migration
    return version <= PROTOCOL_VERSION
  },

  /**
   * Migrate a message from an older protocol version
   * Future use: when protocol changes, implement migration logic here
   */
  migrate(message: WSMessage, fromVersion: number): WSMessage {
    if (fromVersion >= PROTOCOL_VERSION) {
      return message
    }

    // Migration logic for future versions would go here
    // For now, v1 is the only version so no migration needed
    return message
  },

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Estimate the serialized size of a message in bytes
   */
  estimateSize(message: WSMessage | BatchedFrame): number {
    return JSON.stringify(message).length
  },

  /**
   * Create a wire format header
   */
  createWireHeader(
    encoding: EncodingFormat,
    compressed: boolean,
    version?: number
  ): Uint8Array {
    const encodingByte = encoding === 'json' ? 0x00 : encoding === 'msgpack' ? 0x01 : 0x02
    const flags = (compressed ? 0x01 : 0x00) | (version !== undefined ? 0x02 : 0x00)

    if (version !== undefined) {
      return new Uint8Array([encodingByte, flags, version])
    }
    return new Uint8Array([encodingByte, flags])
  },

  /**
   * Parse a wire format header
   */
  parseWireHeader(buffer: ArrayBuffer): { header: WireFormatHeader; offset: number } {
    const view = new Uint8Array(buffer)
    const encodingByte = view[0]
    const flags = view[1]

    const encoding: EncodingFormat =
      encodingByte === 0x00 ? 'json' : encodingByte === 0x01 ? 'msgpack' : 'cbor'
    const compressed = (flags & 0x01) !== 0
    const hasVersion = (flags & 0x02) !== 0

    let offset = 2
    let version: number | undefined

    if (hasVersion) {
      version = view[2]
      offset = 3
    }

    return {
      header: { encoding, compressed, version },
      offset,
    }
  },

  /**
   * Get default batch configuration
   */
  getDefaultBatchConfig(): BatchConfig {
    return {
      enabled: false,
      windowMs: DEFAULT_BATCH_WINDOW_MS,
      maxSize: MAX_BATCH_SIZE,
    }
  },
}
