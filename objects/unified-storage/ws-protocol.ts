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
 * @module unified-storage/ws-protocol
 */

// ============================================================================
// Constants
// ============================================================================

/** Maximum payload size in bytes (10MB) */
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024

/** Maximum batch operations */
const MAX_BATCH_OPERATIONS = 1000

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
// Serialization Options
// ============================================================================

/**
 * Options for serialization
 */
export interface SerializeOptions {
  /** Use binary encoding instead of JSON */
  binary?: boolean
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
   * Serialize a message to JSON string or binary
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
   * Deserialize a JSON string or binary to a message
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
   * Validate a message structure
   * @throws Error if message is invalid
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
}
