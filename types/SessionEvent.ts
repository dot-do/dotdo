/**
 * Session Event Schema and Validation
 *
 * Defines the SessionEvent type for session replay functionality.
 * Provides Zod schemas for validation and parsing.
 *
 * Session events capture frontend activity for replay and debugging:
 * - User interactions (clicks, inputs, scrolls)
 * - Network requests/responses
 * - Console logs and errors
 * - Custom application events
 */
import { z } from 'zod'

// ============================================================================
// Constants
// ============================================================================

/** Maximum allowed clock skew for timestamps (5 minutes in ms) */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

/** Maximum correlationId length */
const MAX_CORRELATION_ID_LENGTH = 256

/** Valid event types */
export const SESSION_EVENT_TYPES = ['request', 'response', 'error', 'log', 'custom'] as const

/** Valid source types */
export const SESSION_EVENT_SOURCES = ['frontend', 'backend'] as const

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Session event type enum schema
 */
export const SessionEventTypeSchema = z.enum(SESSION_EVENT_TYPES)

/**
 * Session event source enum schema
 */
export const SessionEventSourceSchema = z.enum(SESSION_EVENT_SOURCES)

/**
 * Validates correlationId format:
 * - Non-empty string
 * - Max length 256
 * - Alphanumeric with dashes, underscores (no special/dangerous characters)
 */
const CorrelationIdSchema = z
  .string()
  .min(1, 'correlationId cannot be empty')
  .max(MAX_CORRELATION_ID_LENGTH, `correlationId must be ${MAX_CORRELATION_ID_LENGTH} characters or less`)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/,
    'correlationId must be alphanumeric with optional dashes and underscores'
  )

/**
 * Validates timestamp:
 * - Must be positive number
 * - Cannot be 0
 * - Cannot be more than 5 minutes in the future
 */
const TimestampSchema = z
  .number()
  .positive('timestamp must be positive')
  .refine((ts) => ts > 0, { message: 'timestamp cannot be 0' })
  .refine(
    (ts) => ts <= Date.now() + MAX_CLOCK_SKEW_MS,
    { message: 'timestamp is too far in the future (>5 minutes)' }
  )

/**
 * Validates sequence number:
 * - Must be positive integer >= 1
 */
const SequenceSchema = z
  .number()
  .int('sequence must be an integer')
  .positive('sequence must be positive')
  .min(1, 'sequence must be at least 1')

/**
 * Validates event ID:
 * - Non-empty string
 */
const EventIdSchema = z
  .string()
  .min(1, 'id cannot be empty')

/**
 * Validates event data:
 * - Must be an object (not null, not array)
 */
const EventDataSchema = z
  .record(z.string(), z.unknown())
  .refine((data) => data !== null && typeof data === 'object' && !Array.isArray(data), {
    message: 'data must be an object',
  })

/**
 * Full SessionEvent Zod schema with all validations
 * Uses passthrough-then-strip pattern to allow unknown fields to be stripped
 */
export const SessionEventSchema = z.object({
  id: EventIdSchema,
  correlationId: CorrelationIdSchema,
  timestamp: TimestampSchema,
  type: SessionEventTypeSchema,
  data: EventDataSchema,
  source: SessionEventSourceSchema.optional(),
  sequence: SequenceSchema.optional(),
})

// ============================================================================
// Types
// ============================================================================

/**
 * Session event type enum
 */
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>

/**
 * Session event source type
 */
export type SessionEventSource = z.infer<typeof SessionEventSourceSchema>

/**
 * SessionEvent interface - the validated session event structure
 */
export type SessionEvent = z.infer<typeof SessionEventSchema>

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates a session event, throwing a ZodError if invalid
 *
 * @param event - The event to validate
 * @returns true if valid
 * @throws ZodError if invalid
 *
 * @example
 * ```typescript
 * const event = {
 *   id: 'evt-001',
 *   correlationId: 'corr-abc123',
 *   timestamp: Date.now(),
 *   type: 'request',
 *   data: { url: '/api/users' }
 * }
 * validateSessionEvent(event) // returns true
 * ```
 */
export function validateSessionEvent(event: unknown): boolean {
  // Handle non-object inputs - let Zod's parse handle this
  if (event === null || event === undefined || typeof event !== 'object' || Array.isArray(event)) {
    // Use Zod's built-in validation which handles error creation properly
    SessionEventSchema.parse(event) // This will throw appropriate ZodError
  }

  // Parse and validate - this throws on error
  SessionEventSchema.parse(event)
  return true
}

/**
 * Parses and validates a session event, returning the typed result
 *
 * @param event - The raw event to parse
 * @returns The validated SessionEvent
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const raw = {
 *   id: 'evt-001',
 *   correlationId: 'corr-abc123',
 *   timestamp: Date.now(),
 *   type: 'request',
 *   data: { url: '/api/users' },
 *   unknownField: 'will be stripped'
 * }
 * const event = parseSessionEvent(raw)
 * // event.unknownField is undefined (stripped by strict mode)
 * ```
 */
export function parseSessionEvent(event: unknown): SessionEvent {
  // Handle non-object inputs - let Zod's parse handle this
  if (event === null || event === undefined || typeof event !== 'object' || Array.isArray(event)) {
    // Use Zod's built-in validation which handles error creation properly
    SessionEventSchema.parse(event) // This will throw appropriate ZodError
  }

  return SessionEventSchema.parse(event)
}

/**
 * Safely validates a session event without throwing
 *
 * @param event - The event to validate
 * @returns Result object with success status and data or error
 *
 * @example
 * ```typescript
 * const result = safeValidateSessionEvent(event)
 * if (result.success) {
 *   console.log(result.data)
 * } else {
 *   console.log(result.error)
 * }
 * ```
 */
export function safeValidateSessionEvent(event: unknown): ReturnType<typeof SessionEventSchema.safeParse> {
  return SessionEventSchema.safeParse(event)
}

/**
 * Checks if an event is a valid session event type
 *
 * @param type - The type to check
 * @returns true if valid session event type
 */
export function isValidEventType(type: unknown): type is SessionEventType {
  return SESSION_EVENT_TYPES.includes(type as SessionEventType)
}

/**
 * Checks if a source is a valid session event source
 *
 * @param source - The source to check
 * @returns true if valid session event source
 */
export function isValidEventSource(source: unknown): source is SessionEventSource {
  return SESSION_EVENT_SOURCES.includes(source as SessionEventSource)
}
