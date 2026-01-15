/**
 * Broker Protocol Types and Message Format
 *
 * This module defines the RPC message protocol used by the broker for
 * cross-DO and cross-worker communication. Messages follow a simple
 * JSON-serializable format with type discrimination via the `type` field.
 *
 * Message Types:
 * - CallMessage: Invoke a method on a target worker/shard
 * - ReturnMessage: Successful response with result value
 * - ErrorMessage: Error response with message and optional code
 * - BatchMessage: Multiple calls in a single message
 * - BatchReturnMessage: Multiple responses for a batch
 */

// =============================================================================
// Message Type Interfaces
// =============================================================================

/**
 * RPC call message to invoke a method on a remote target
 */
export interface CallMessage {
  /** Unique message ID for request/response correlation */
  id: string
  /** Message type discriminator */
  type: 'call'
  /** Target worker/shard ID */
  target: string
  /** Method name to invoke */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
  /** Optional opaque capability token for authorization */
  capability?: string
}

/**
 * Successful return message with result value
 */
export interface ReturnMessage {
  /** Message ID matching the original call */
  id: string
  /** Message type discriminator */
  type: 'return'
  /** Result value from the method call */
  value: unknown
}

/**
 * Error message for failed calls
 */
export interface ErrorMessage {
  /** Message ID matching the original call */
  id: string
  /** Message type discriminator */
  type: 'error'
  /** Error message description */
  error: string
  /** Optional error code for programmatic handling */
  code?: string
}

/**
 * Batch message containing multiple calls
 */
export interface BatchMessage {
  /** Unique batch ID for batch response correlation */
  id: string
  /** Message type discriminator */
  type: 'batch'
  /** Array of call messages in this batch */
  calls: CallMessage[]
}

/**
 * Batch return message containing results for all calls in a batch
 */
export interface BatchReturnMessage {
  /** Batch ID matching the original batch request */
  id: string
  /** Message type discriminator */
  type: 'batch_return'
  /** Array of results, either ReturnMessage or ErrorMessage for each call */
  results: (ReturnMessage | ErrorMessage)[]
}

/**
 * Union type of all broker message types
 */
export type BrokerMessage =
  | CallMessage
  | ReturnMessage
  | ErrorMessage
  | BatchMessage
  | BatchReturnMessage

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for CallMessage
 */
export function isCallMessage(msg: unknown): msg is CallMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return (
    m.type === 'call' &&
    typeof m.id === 'string' &&
    typeof m.target === 'string' &&
    typeof m.method === 'string' &&
    Array.isArray(m.args)
  )
}

/**
 * Type guard for ReturnMessage
 */
export function isReturnMessage(msg: unknown): msg is ReturnMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return m.type === 'return' && typeof m.id === 'string' && 'value' in m
}

/**
 * Type guard for ErrorMessage
 */
export function isErrorMessage(msg: unknown): msg is ErrorMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return (
    m.type === 'error' &&
    typeof m.id === 'string' &&
    typeof m.error === 'string'
  )
}

/**
 * Type guard for BatchMessage
 */
export function isBatchMessage(msg: unknown): msg is BatchMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return (
    m.type === 'batch' && typeof m.id === 'string' && Array.isArray(m.calls)
  )
}

/**
 * Type guard for BatchReturnMessage
 */
export function isBatchReturnMessage(msg: unknown): msg is BatchReturnMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return (
    m.type === 'batch_return' &&
    typeof m.id === 'string' &&
    Array.isArray(m.results)
  )
}

// =============================================================================
// Utilities
// =============================================================================

/** Counter for generating unique IDs within a session */
let brokerIdCounter = 0

/**
 * Generate a unique broker message ID
 *
 * IDs are prefixed with 'brk_' to distinguish them from other message ID schemes.
 * Uses timestamp + counter + random suffix for uniqueness across sessions.
 */
export function generateBrokerMessageId(): string {
  return `brk_${Date.now()}_${++brokerIdCounter}_${Math.random().toString(36).substring(2, 8)}`
}
