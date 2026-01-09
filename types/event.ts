import { z } from 'zod'

// ============================================================================
// 5W+H Event Type - EPCIS-compatible event model
// ============================================================================

/**
 * FunctionMethod - The execution method for HOW an event was processed
 * - code: Deterministic code execution
 * - generative: AI-generated output
 * - agentic: AI with tool use
 * - human: Human-in-the-loop
 */
export type FunctionMethod = 'code' | 'generative' | 'agentic' | 'human'

// ============================================================================
// WHO - Actor, Source, Destination
// ============================================================================

/**
 * WHO fields - Identifies the actor and endpoints
 * Maps to EPCIS: source, destination
 */
export interface EventWho {
  /** The actor who triggered the event (user ID, agent ID, etc.) */
  actor: string
  /** Source URL/endpoint where the event originated */
  source?: string
  /** Destination URL/endpoint where the event is being sent */
  destination?: string
}

// ============================================================================
// WHAT - Object, Type, Quantity
// ============================================================================

/**
 * WHAT fields - Identifies what the event is about
 * Maps to EPCIS: epcList, parentID, quantity
 */
export interface EventWhat {
  /** The object identifier (Sqid reference, URN, etc.) */
  object: string
  /** The type of object (Noun name, EPCIS event type) */
  type: string
  /** Quantity when applicable */
  quantity?: number
}

// ============================================================================
// WHEN - Timestamp, Recorded
// ============================================================================

/**
 * WHEN fields - Timestamps for the event
 * Maps to EPCIS: eventTime, recordTime
 */
export interface EventWhen {
  /** When the event occurred (eventTime) */
  timestamp?: Date | string
  /** When the event was recorded (recordTime) */
  recorded?: Date | string
}

// ============================================================================
// WHERE - Namespace, Location, ReadPoint
// ============================================================================

/**
 * WHERE fields - Location context for the event
 * Maps to EPCIS: readPoint, bizLocation
 */
export interface EventWhere {
  /** Namespace URL (required) */
  ns: string
  /** Physical or logical location (maps to bizLocation) */
  location?: string
  /** Read point - where the event was captured (maps to readPoint) */
  readPoint?: string
}

// ============================================================================
// WHY - Verb, Disposition, Reason
// ============================================================================

/**
 * WHY fields - Business context for why the event occurred
 * Maps to EPCIS: bizStep, disposition
 */
export interface EventWhy {
  /** The action verb (created, updated, shipped, etc.) - maps to bizStep */
  verb: string
  /** Current disposition/status (maps to disposition) */
  disposition?: string
  /** Human-readable reason for the event */
  reason?: string
}

// ============================================================================
// HOW - Method, Branch, Model, Tools, Channel, Cascade, Transaction, Context
// ============================================================================

/**
 * Cascade attempt tracking for function execution fallback
 */
export interface CascadeAttempt {
  method: FunctionMethod
  failed: boolean
  reason?: string
}

/**
 * Cascade tracking for HOW the event was processed through multiple attempts
 */
export interface EventCascade {
  attempts: CascadeAttempt[]
}

/**
 * HOW fields - Technical context for how the event was processed
 * Maps to EPCIS: bizTransaction (partially)
 */
export interface EventHow {
  /** Execution method (code, generative, agentic, human) */
  method?: FunctionMethod
  /** Branch/experiment variant */
  branch?: string
  /** AI model used (for generative/agentic methods) */
  model?: string
  /** Tools available (for agentic method) */
  tools?: string[]
  /** Communication channel (for human method) */
  channel?: string
  /** Cascade tracking for fallback execution */
  cascade?: EventCascade
  /** Business transaction ID (maps to bizTransaction) */
  transaction?: string
  /** Additional context data */
  context?: Record<string, unknown>
}

// ============================================================================
// Combined Event Interface
// ============================================================================

/**
 * Complete Event interface combining all 5W+H fields
 */
export interface Event extends EventWho, EventWhat, EventWhen, EventWhere, EventWhy, EventHow {}

/**
 * EventData - Partial event for creation (only requires mandatory fields)
 */
export interface EventData {
  // Required WHO
  actor: string
  source?: string
  destination?: string

  // Required WHAT
  object: string
  type: string
  quantity?: number

  // Optional WHEN (auto-generated if not provided)
  timestamp?: Date | string
  recorded?: Date | string

  // Required WHERE
  ns: string
  location?: string
  readPoint?: string

  // Required WHY
  verb: string
  disposition?: string
  reason?: string

  // Optional HOW
  method?: FunctionMethod
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade?: EventCascade
  transaction?: string
  context?: Record<string, unknown>
}

// ============================================================================
// Validation Error Types
// ============================================================================

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  success: boolean
  errors: ValidationError[]
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

const FunctionMethodSchema = z.enum(['code', 'generative', 'agentic', 'human'])

const CascadeAttemptSchema = z.object({
  method: FunctionMethodSchema,
  failed: z.boolean(),
  reason: z.string().optional(),
})

const EventCascadeSchema = z.object({
  attempts: z.array(CascadeAttemptSchema),
})

// URL validation helper
const isValidUrl = (value: string): boolean => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

// Date coercion helper - handles both Date and string inputs
const dateSchema = z.union([z.date(), z.string()]).transform((val) => {
  if (val instanceof Date) return val
  const parsed = new Date(val)
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date')
  }
  return parsed
})

/**
 * EventSchema - Zod schema for runtime validation
 */
export const EventSchema = z.object({
  // WHO
  actor: z.string().min(1, 'actor is required'),
  source: z.string().refine(isValidUrl, 'source must be a valid URL').optional(),
  destination: z.string().refine(isValidUrl, 'destination must be a valid URL').optional(),

  // WHAT
  object: z.string().min(1, 'object is required'),
  type: z.string().min(1, 'type is required'),
  quantity: z.number().positive('quantity must be positive').optional(),

  // WHEN
  timestamp: dateSchema.optional(),
  recorded: dateSchema.optional(),

  // WHERE
  ns: z.string().min(1, 'ns is required').refine(isValidUrl, 'ns must be a valid URL'),
  location: z.string().optional(),
  readPoint: z.string().optional(),

  // WHY
  verb: z.string().min(1, 'verb is required'),
  disposition: z.string().optional(),
  reason: z.string().optional(),

  // HOW
  method: FunctionMethodSchema.optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  channel: z.string().optional(),
  cascade: EventCascadeSchema.optional(),
  transaction: z.string().optional(),
  context: z.record(z.unknown()).optional(),
}).refine(
  (data) => {
    // Validate timestamp <= recorded when both are provided
    if (data.timestamp && data.recorded) {
      const ts = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp)
      const rec = data.recorded instanceof Date ? data.recorded : new Date(data.recorded)
      return ts.getTime() <= rec.getTime()
    }
    return true
  },
  {
    message: 'recorded must be >= timestamp',
    path: ['recorded'],
  }
)

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates event data and returns structured errors
 */
export function validateEvent(data: EventData): ValidationResult {
  const errors: ValidationError[] = []

  // WHO validation
  if (!data.actor || data.actor.trim() === '') {
    errors.push({ field: 'actor', message: 'actor is required and must be non-empty' })
  }

  if (data.source !== undefined && !isValidUrl(data.source)) {
    errors.push({ field: 'source', message: 'source must be a valid URL' })
  }

  if (data.destination !== undefined && !isValidUrl(data.destination)) {
    errors.push({ field: 'destination', message: 'destination must be a valid URL' })
  }

  // WHAT validation
  if (!data.object || data.object.trim() === '') {
    errors.push({ field: 'object', message: 'object is required and must be non-empty' })
  }

  if (!data.type || data.type.trim() === '') {
    errors.push({ field: 'type', message: 'type is required and must be non-empty' })
  }

  if (data.quantity !== undefined && (typeof data.quantity !== 'number' || data.quantity <= 0)) {
    errors.push({ field: 'quantity', message: 'quantity must be a positive number' })
  }

  // WHEN validation
  if (data.timestamp !== undefined) {
    const ts = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp as string)
    if (isNaN(ts.getTime())) {
      errors.push({ field: 'timestamp', message: 'timestamp must be a valid date' })
    }
  }

  if (data.recorded !== undefined) {
    const rec = data.recorded instanceof Date ? data.recorded : new Date(data.recorded as string)
    if (isNaN(rec.getTime())) {
      errors.push({ field: 'recorded', message: 'recorded must be a valid date' })
    }
  }

  // Validate timestamp <= recorded
  if (data.timestamp && data.recorded) {
    const ts = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp as string)
    const rec = data.recorded instanceof Date ? data.recorded : new Date(data.recorded as string)
    if (!isNaN(ts.getTime()) && !isNaN(rec.getTime()) && ts.getTime() > rec.getTime()) {
      errors.push({ field: 'recorded', message: 'recorded must be >= timestamp' })
    }
  }

  // WHERE validation
  if (!data.ns || data.ns.trim() === '') {
    errors.push({ field: 'ns', message: 'ns is required and must be non-empty' })
  } else if (!isValidUrl(data.ns)) {
    errors.push({ field: 'ns', message: 'ns must be a valid URL' })
  }

  // WHY validation
  if (!data.verb || data.verb.trim() === '') {
    errors.push({ field: 'verb', message: 'verb is required and must be non-empty' })
  }

  // HOW validation
  const validMethods: FunctionMethod[] = ['code', 'generative', 'agentic', 'human']
  if (data.method !== undefined && !validMethods.includes(data.method)) {
    errors.push({ field: 'method', message: 'method must be one of: code, generative, agentic, human' })
  }

  if (data.tools !== undefined && !Array.isArray(data.tools)) {
    errors.push({ field: 'tools', message: 'tools must be an array of strings' })
  }

  return {
    success: errors.length === 0,
    errors,
  }
}

/**
 * Creates a complete Event from EventData, filling in defaults
 */
export function createEvent(data: EventData): Event {
  // Validate first
  const validation = validateEvent(data)
  if (!validation.success) {
    const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ')
    throw new Error(`Invalid event data: ${errorMessages}`)
  }

  const now = new Date()

  return {
    // WHO
    actor: data.actor,
    source: data.source,
    destination: data.destination,

    // WHAT
    object: data.object,
    type: data.type,
    quantity: data.quantity,

    // WHEN (auto-generate if not provided)
    timestamp: data.timestamp instanceof Date
      ? data.timestamp
      : data.timestamp
        ? new Date(data.timestamp)
        : now,
    recorded: data.recorded instanceof Date
      ? data.recorded
      : data.recorded
        ? new Date(data.recorded)
        : now,

    // WHERE
    ns: data.ns,
    location: data.location,
    readPoint: data.readPoint,

    // WHY
    verb: data.verb,
    disposition: data.disposition,
    reason: data.reason,

    // HOW
    method: data.method,
    branch: data.branch,
    model: data.model,
    tools: data.tools,
    channel: data.channel,
    cascade: data.cascade,
    transaction: data.transaction,
    context: data.context,
  }
}
