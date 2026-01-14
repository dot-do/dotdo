/**
 * @dotdo/sentry - Capture Module
 *
 * Event capture utilities including exception normalization,
 * stack trace extraction, and event creation helpers.
 *
 * @module @dotdo/sentry/capture
 */

import type {
  SentryEvent,
  ExceptionValue,
  StackFrame,
  SeverityLevel,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Exception mechanism info.
 */
export interface ExceptionMechanism {
  type: string
  handled?: boolean
  data?: Record<string, unknown>
}

/**
 * Serialized error representation.
 */
export interface SerializedError {
  name: string
  message: string
  stack?: string
  cause?: SerializedError
  [key: string]: unknown
}

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/sentry'
const SDK_VERSION = '0.1.0'

// =============================================================================
// Event ID Generation
// =============================================================================

/**
 * Generate a unique event ID (32 character hex string).
 */
export function createEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // Set version 4
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80
  }

  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// =============================================================================
// Stack Frame Extraction
// =============================================================================

/**
 * Extract stack frames from an Error object.
 */
export function extractStackFrames(error: Error): StackFrame[] {
  if (!error.stack) {
    return []
  }

  const lines = error.stack.split('\n')
  const frames: StackFrame[] = []

  // Skip the first line (error message)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    // Try V8/Chrome format: "    at functionName (filename:line:col)"
    let match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/)

    if (match) {
      const filename = match[2] ?? '<unknown>'
      const linenoStr = match[3] ?? '0'
      const colnoStr = match[4] ?? '0'

      frames.push({
        function: match[1] || '<anonymous>',
        filename,
        lineno: parseInt(linenoStr, 10),
        colno: parseInt(colnoStr, 10),
        in_app: !filename.includes('node_modules') && !filename.startsWith('internal/'),
      })
      continue
    }

    // Try Firefox format: "functionName@filename:line:col"
    match = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/)
    if (match) {
      const filename = match[2] ?? '<unknown>'
      const linenoStr = match[3] ?? '0'
      const colnoStr = match[4] ?? '0'

      frames.push({
        function: match[1] || '<anonymous>',
        filename,
        lineno: parseInt(linenoStr, 10),
        colno: parseInt(colnoStr, 10),
        in_app: !filename.includes('node_modules'),
      })
      continue
    }

    // Try Safari format: "functionName@filename:line"
    match = line.match(/^(.+?)@(.+?):(\d+)$/)
    if (match) {
      const filename = match[2] ?? '<unknown>'
      const linenoStr = match[3] ?? '0'

      frames.push({
        function: match[1] || '<anonymous>',
        filename,
        lineno: parseInt(linenoStr, 10),
        in_app: !filename.includes('node_modules'),
      })
    }
  }

  // Sentry expects frames in reverse order (oldest first)
  return frames.reverse()
}

// =============================================================================
// Exception Normalization
// =============================================================================

/**
 * Normalize any value to an ExceptionValue.
 */
export function normalizeException(
  exception: unknown,
  mechanism?: ExceptionMechanism
): ExceptionValue {
  // Handle Error objects
  if (exception instanceof Error) {
    return {
      type: exception.name,
      value: exception.message,
      stacktrace: {
        frames: extractStackFrames(exception),
      },
      mechanism: mechanism ?? {
        type: 'generic',
        handled: true,
      },
    }
  }

  // Handle null/undefined
  if (exception === null) {
    return {
      type: 'Error',
      value: 'null',
      mechanism: mechanism ?? { type: 'generic', handled: true },
    }
  }

  if (exception === undefined) {
    return {
      type: 'Error',
      value: 'undefined',
      mechanism: mechanism ?? { type: 'generic', handled: true },
    }
  }

  // Handle strings
  if (typeof exception === 'string') {
    return {
      type: 'Error',
      value: exception,
      mechanism: mechanism ?? { type: 'generic', handled: true },
    }
  }

  // Handle numbers
  if (typeof exception === 'number') {
    return {
      type: 'Error',
      value: String(exception),
      mechanism: mechanism ?? { type: 'generic', handled: true },
    }
  }

  // Handle objects
  if (typeof exception === 'object') {
    try {
      const value = JSON.stringify(exception)
      return {
        type: 'Error',
        value,
        mechanism: mechanism ?? { type: 'generic', handled: true },
      }
    } catch {
      return {
        type: 'Error',
        value: '[Object object]',
        mechanism: mechanism ?? { type: 'generic', handled: true },
      }
    }
  }

  // Fallback
  return {
    type: 'Error',
    value: String(exception),
    mechanism: mechanism ?? { type: 'generic', handled: true },
  }
}

/**
 * Normalize an exception and extract error chain (cause).
 */
export function normalizeExceptionChain(
  exception: unknown,
  mechanism?: ExceptionMechanism
): ExceptionValue[] {
  const values: ExceptionValue[] = []

  let current: unknown = exception
  let depth = 0
  const maxDepth = 10

  while (current && depth < maxDepth) {
    values.push(normalizeException(current, depth === 0 ? mechanism : undefined))

    if (current instanceof Error && current.cause) {
      current = current.cause
      depth++
    } else {
      break
    }
  }

  // Sentry expects the chain in reverse order (root cause first)
  return values.reverse()
}

// =============================================================================
// Error Serialization
// =============================================================================

const seen = new WeakSet<object>()

/**
 * Serialize an Error object to a plain object.
 */
export function serializeError(error: Error): SerializedError {
  // Reset circular reference tracking
  seen.delete(error)

  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }

  // Handle cause chain
  if (error.cause instanceof Error) {
    if (!seen.has(error.cause)) {
      seen.add(error.cause)
      serialized.cause = serializeError(error.cause)
    }
  }

  // Copy custom properties
  const errorAny = error as Record<string, unknown>
  for (const key of Object.keys(error)) {
    if (key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'cause') {
      const value = errorAny[key]

      // Skip circular references
      if (value !== null && typeof value === 'object') {
        if (seen.has(value)) {
          continue
        }
        seen.add(value)
      }

      try {
        // Test serializability
        JSON.stringify(value)
        serialized[key] = value
      } catch {
        // Skip unserializable values
      }
    }
  }

  return serialized
}

// =============================================================================
// Event Creation Helpers
// =============================================================================

/**
 * Create a base event with common fields.
 */
export function createBaseEvent(options: {
  eventId?: string
  level?: SeverityLevel
  message?: string
  release?: string
  environment?: string
}): SentryEvent {
  return {
    event_id: options.eventId ?? createEventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: options.level ?? 'error',
    message: options.message,
    release: options.release,
    environment: options.environment,
    sdk: {
      name: SDK_NAME,
      version: SDK_VERSION,
    },
  }
}

/**
 * Create an exception event.
 */
export function createExceptionEvent(
  exception: unknown,
  options: {
    eventId?: string
    release?: string
    environment?: string
    mechanism?: ExceptionMechanism
  } = {}
): SentryEvent {
  const event = createBaseEvent({
    eventId: options.eventId,
    level: 'error',
    release: options.release,
    environment: options.environment,
  })

  event.exception = {
    values: normalizeExceptionChain(exception, options.mechanism),
  }

  return event
}

/**
 * Create a message event.
 */
export function createMessageEvent(
  message: string,
  options: {
    eventId?: string
    level?: SeverityLevel
    release?: string
    environment?: string
    attachStacktrace?: boolean
  } = {}
): SentryEvent {
  const event = createBaseEvent({
    eventId: options.eventId,
    level: options.level ?? 'info',
    message,
    release: options.release,
    environment: options.environment,
  })

  // Optionally attach stacktrace
  if (options.attachStacktrace) {
    const syntheticError = new Error(message)
    event.exception = {
      values: [
        {
          type: 'Error',
          value: message,
          stacktrace: {
            frames: extractStackFrames(syntheticError),
          },
          mechanism: {
            type: 'generic',
            handled: true,
          },
        },
      ],
    }
  }

  return event
}
