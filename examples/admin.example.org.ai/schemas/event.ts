/**
 * Event Schema - 5W+H Event Model
 *
 * Events capture what happened in the system using the 5W+H model:
 * WHO, WHAT, WHEN, WHERE, WHY, HOW
 *
 * Compatible with EPCIS and extended for digital contexts.
 *
 * @module schemas/event
 */

import { z } from 'zod'

/**
 * Function execution method types
 */
export const FunctionMethodSchema = z.enum(['code', 'generative', 'agentic', 'human'])
export type FunctionMethod = z.infer<typeof FunctionMethodSchema>

/**
 * Actor type classification
 */
export const ActorTypeSchema = z.enum(['human', 'agent', 'system', 'webhook'])
export type ActorType = z.infer<typeof ActorTypeSchema>

/**
 * Cascade attempt tracking for function execution fallback
 */
export const CascadeAttemptSchema = z.object({
  method: FunctionMethodSchema,
  failed: z.boolean(),
  reason: z.string().optional(),
})

/**
 * Cascade tracking for HOW the event was processed
 */
export const EventCascadeSchema = z.object({
  attempts: z.array(CascadeAttemptSchema),
})

/**
 * URL validation helper
 */
const isValidUrl = (value: string): boolean => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Date coercion helper - handles both Date and string inputs
 */
const dateSchema = z.union([z.date(), z.string()]).transform((val) => {
  if (val instanceof Date) return val
  const parsed = new Date(val)
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date')
  }
  return parsed
})

/**
 * EventSchema - validates 5W+H events
 *
 * Required fields:
 * - WHO: actor (who triggered)
 * - WHAT: object, type (what entity)
 * - WHERE: ns (namespace URL)
 * - WHY: verb (what action)
 *
 * Optional fields:
 * - WHEN: timestamp, recorded (auto-generated if not provided)
 * - HOW: method, model, tools, etc.
 */
export const EventSchema = z.object({
  // WHO - who triggered the event
  actor: z.string().min(1, 'actor is required'),
  source: z.string().refine(isValidUrl, 'source must be a valid URL').optional(),
  destination: z.string().refine(isValidUrl, 'destination must be a valid URL').optional(),

  // WHAT - what entity is affected
  object: z.string().min(1, 'object is required'),
  type: z.string().min(1, 'type is required'),
  quantity: z.number().positive('quantity must be positive').optional(),

  // WHEN - timing
  timestamp: dateSchema.optional(),
  recorded: dateSchema.optional(),

  // WHERE - location/namespace
  ns: z.string().min(1, 'ns is required').refine(isValidUrl, 'ns must be a valid URL'),
  location: z.string().optional(),
  readPoint: z.string().optional(),

  // WHY - business context
  verb: z.string().min(1, 'verb is required'),
  disposition: z.string().optional(),
  reason: z.string().optional(),

  // HOW - execution context
  method: FunctionMethodSchema.optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  channel: z.string().optional(),
  cascade: EventCascadeSchema.optional(),
  transaction: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
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

export type EventSchemaType = z.infer<typeof EventSchema>

/**
 * Simplified event type for listing/display
 */
export const EventSummarySchema = z.object({
  id: z.string(),
  actor: z.string(),
  object: z.string(),
  type: z.string(),
  verb: z.string(),
  timestamp: dateSchema.optional(),
  method: FunctionMethodSchema.optional(),
})

export type EventSummaryType = z.infer<typeof EventSummarySchema>
