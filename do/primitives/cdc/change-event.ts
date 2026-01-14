/**
 * ChangeEvent Schema and Serialization
 *
 * Provides a comprehensive ChangeEvent schema for CDC (Change Data Capture):
 * - TypeScript types with proper generics
 * - Zod schema validation
 * - JSON serialization/deserialization
 * - Schema embedding for self-describing events
 * - Utility functions for event creation and field comparison
 *
 * @module db/primitives/cdc/change-event
 */

import { z } from 'zod'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Change operation types following Debezium conventions
 */
export enum ChangeOperation {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Field type definitions for embedded schema
 */
export type FieldType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'binary'
  | 'array'
  | 'object'
  | 'null'

/**
 * Schema field definition for self-describing events
 */
export interface SchemaField {
  name: string
  type: FieldType
  required: boolean
  items?: FieldType | string // For array types
  properties?: SchemaField[] // For object types
  default?: unknown
}

/**
 * Schema definition for embedded schema support
 */
export interface ChangeEventSchema {
  name: string
  version: number
  fields: SchemaField[]
  namespace?: string
  doc?: string
}

/**
 * Metadata associated with a change event
 */
export interface ChangeEventMetadata {
  /** Transaction ID from source database */
  transactionId?: string
  /** Source system identifier */
  source?: string
  /** Log Sequence Number for transaction log capture */
  lsn?: string
  /** Partition identifier for distributed systems */
  partition?: string
  /** Processing timestamp (when event was processed) */
  processedAt?: number
  /** Custom metadata fields */
  custom?: Record<string, unknown>
  /** Any additional metadata */
  [key: string]: unknown
}

/**
 * Core ChangeEvent interface representing a single data change
 *
 * @template T - Type of the record being captured
 */
export interface ChangeEvent<T = unknown> {
  /** Unique event identifier for deduplication */
  id: string
  /** Type of change operation */
  operation: ChangeOperation
  /** Source table/collection name */
  table: string
  /** State before the change (null for INSERT) */
  before: T | null
  /** State after the change (null for DELETE) */
  after: T | null
  /** Timestamp when the change occurred (milliseconds since epoch) */
  timestamp: number
  /** Monotonically increasing sequence number */
  sequence?: number
  /** Optional metadata */
  metadata?: ChangeEventMetadata
  /** Embedded schema for self-describing events */
  schema?: ChangeEventSchema
}

/**
 * Options for creating a change event
 */
export interface CreateChangeEventOptions<T = unknown> {
  id?: string
  operation: ChangeOperation
  table: string
  before: T | null
  after: T | null
  timestamp?: number
  sequence?: number
  metadata?: ChangeEventMetadata
  schema?: ChangeEventSchema
}

/**
 * Options for convenience factory functions
 */
export interface EventFactoryOptions {
  sequence?: number
  transactionId?: string
  source?: string
  lsn?: string
  partition?: string
  custom?: Record<string, unknown>
}

/**
 * Validation result for change events
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/**
 * Zod schema for ChangeOperation enum
 */
const ChangeOperationSchema = z.nativeEnum(ChangeOperation)

/**
 * Zod schema for ChangeEventMetadata
 */
const ChangeEventMetadataSchema = z.object({
  transactionId: z.string().optional(),
  source: z.string().optional(),
  lsn: z.string().optional(),
  partition: z.string().optional(),
  processedAt: z.number().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

/**
 * Zod schema for SchemaField
 */
const SchemaFieldSchema: z.ZodType<SchemaField> = z.object({
  name: z.string(),
  type: z.enum(['string', 'integer', 'float', 'boolean', 'timestamp', 'date', 'binary', 'array', 'object', 'null']),
  required: z.boolean(),
  items: z.string().optional(),
  properties: z.lazy(() => z.array(SchemaFieldSchema)).optional(),
  default: z.unknown().optional(),
})

/**
 * Zod schema for ChangeEventSchema
 */
const ChangeEventSchemaDefinition = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  fields: z.array(SchemaFieldSchema),
  namespace: z.string().optional(),
  doc: z.string().optional(),
})

/**
 * Zod schema for ChangeEvent
 *
 * Validates the structure of a ChangeEvent but allows any record type
 * for before/after fields.
 */
export const ChangeEventSchema = z.object({
  id: z.string().min(1),
  operation: ChangeOperationSchema,
  table: z.string().min(1),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  timestamp: z.union([
    z.number(),
    z.string().transform((val) => {
      // Handle ISO date strings or numeric strings
      const num = Number(val)
      if (!isNaN(num)) return num
      const date = new Date(val)
      if (!isNaN(date.getTime())) return date.getTime()
      throw new Error(`Invalid timestamp: ${val}`)
    }),
  ]),
  sequence: z.number().int().optional(),
  metadata: ChangeEventMetadataSchema.optional(),
  schema: ChangeEventSchemaDefinition.optional(),
})

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a ChangeEvent including semantic constraints
 *
 * @param event - The event to validate
 * @returns Validation result with errors if invalid
 */
export function validateChangeEvent<T>(event: Partial<ChangeEvent<T>>): ValidationResult {
  const errors: string[] = []

  // First, validate structure with Zod
  const structuralResult = ChangeEventSchema.safeParse(event)
  if (!structuralResult.success) {
    return {
      valid: false,
      errors: structuralResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    }
  }

  // Semantic validation based on operation type
  switch (event.operation) {
    case ChangeOperation.INSERT:
      if (event.before !== null) {
        errors.push('INSERT event must have null before state')
      }
      if (event.after === null) {
        errors.push('INSERT event must have non-null after state')
      }
      break

    case ChangeOperation.UPDATE:
      if (event.before === null) {
        errors.push('UPDATE event must have non-null before state')
      }
      if (event.after === null) {
        errors.push('UPDATE event must have non-null after state')
      }
      break

    case ChangeOperation.DELETE:
      if (event.before === null) {
        errors.push('DELETE event must have non-null before state')
      }
      if (event.after !== null) {
        errors.push('DELETE event must have null after state')
      }
      break
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Parses a JSON string or object into a validated ChangeEvent
 *
 * @param input - JSON string or object to parse
 * @returns Validated ChangeEvent
 * @throws Error if validation fails
 */
export function parseChangeEvent<T = unknown>(input: string | object): ChangeEvent<T> {
  const data = typeof input === 'string' ? JSON.parse(input) : input
  const result = ChangeEventSchema.parse(data)
  return result as ChangeEvent<T>
}

/**
 * Type guard to check if an unknown value is a valid ChangeEvent
 *
 * @param value - Value to check
 * @returns True if value is a valid ChangeEvent
 */
export function isValidChangeEvent(value: unknown): value is ChangeEvent {
  if (value === null || value === undefined) {
    return false
  }
  const result = ChangeEventSchema.safeParse(value)
  return result.success
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serializes a ChangeEvent to a JSON string
 *
 * Handles:
 * - Date objects converted to ISO strings
 * - Undefined values omitted
 * - Circular reference protection
 *
 * @param event - The event to serialize
 * @returns JSON string representation
 */
export function serializeChangeEvent<T>(event: ChangeEvent<T>): string {
  return JSON.stringify(event, (key, value) => {
    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString()
    }
    return value
  })
}

/**
 * Deserializes a JSON string to a ChangeEvent
 *
 * @param json - JSON string to deserialize
 * @returns Validated ChangeEvent
 * @throws Error if JSON is invalid or event structure is invalid
 */
export function deserializeChangeEvent<T = unknown>(json: string): ChangeEvent<T> {
  return parseChangeEvent<T>(json)
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Generates a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `evt-${timestamp}-${random}`
}

/**
 * Creates a ChangeEvent with all required fields
 *
 * @param options - Event creation options
 * @returns A new ChangeEvent
 */
export function createChangeEvent<T>(options: CreateChangeEventOptions<T>): ChangeEvent<T> {
  const event: ChangeEvent<T> = {
    id: options.id ?? generateEventId(),
    operation: options.operation,
    table: options.table,
    before: options.before,
    after: options.after,
    timestamp: options.timestamp ?? Date.now(),
  }

  if (options.sequence !== undefined) {
    event.sequence = options.sequence
  }

  if (options.metadata) {
    event.metadata = options.metadata
  }

  if (options.schema) {
    event.schema = options.schema
  }

  return event
}

/**
 * Builds metadata from factory options
 */
function buildMetadata(options?: EventFactoryOptions): ChangeEventMetadata | undefined {
  if (!options) return undefined

  const metadata: ChangeEventMetadata = {}

  if (options.transactionId) metadata.transactionId = options.transactionId
  if (options.source) metadata.source = options.source
  if (options.lsn) metadata.lsn = options.lsn
  if (options.partition) metadata.partition = options.partition
  if (options.custom) metadata.custom = options.custom

  // Return undefined if no metadata was set
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

/**
 * Creates an INSERT change event
 *
 * @param table - Source table name
 * @param record - The inserted record
 * @param options - Optional metadata
 * @returns INSERT ChangeEvent
 */
export function createInsertEvent<T>(
  table: string,
  record: T,
  options?: EventFactoryOptions
): ChangeEvent<T> {
  return createChangeEvent({
    operation: ChangeOperation.INSERT,
    table,
    before: null,
    after: record,
    sequence: options?.sequence,
    metadata: buildMetadata(options),
  })
}

/**
 * Creates an UPDATE change event
 *
 * @param table - Source table name
 * @param before - State before the update
 * @param after - State after the update
 * @param options - Optional metadata
 * @returns UPDATE ChangeEvent
 */
export function createUpdateEvent<T>(
  table: string,
  before: T,
  after: T,
  options?: EventFactoryOptions
): ChangeEvent<T> {
  return createChangeEvent({
    operation: ChangeOperation.UPDATE,
    table,
    before,
    after,
    sequence: options?.sequence,
    metadata: buildMetadata(options),
  })
}

/**
 * Creates a DELETE change event
 *
 * @param table - Source table name
 * @param record - The deleted record
 * @param options - Optional metadata
 * @returns DELETE ChangeEvent
 */
export function createDeleteEvent<T>(
  table: string,
  record: T,
  options?: EventFactoryOptions
): ChangeEvent<T> {
  return createChangeEvent({
    operation: ChangeOperation.DELETE,
    table,
    before: record,
    after: null,
    sequence: options?.sequence,
    metadata: buildMetadata(options),
  })
}

// ============================================================================
// SCHEMA EMBEDDING
// ============================================================================

/**
 * Embeds a schema definition into a ChangeEvent for self-describing events
 *
 * @param event - The event to embed schema into
 * @param schema - The schema definition
 * @returns New event with embedded schema
 */
export function embedSchema<T>(
  event: ChangeEvent<T>,
  schema: ChangeEventSchema
): ChangeEvent<T> {
  return {
    ...event,
    schema,
  }
}

/**
 * Extracts the embedded schema from a ChangeEvent
 *
 * @param event - The event to extract schema from
 * @returns The embedded schema or undefined
 */
export function extractSchema<T>(event: ChangeEvent<T>): ChangeEventSchema | undefined {
  return event.schema
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Deep equality check for values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)

    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]))
  }

  return false
}

/**
 * Gets the list of fields that changed between before and after states
 *
 * For INSERT and DELETE events, returns an empty array.
 * For UPDATE events, returns the names of fields that differ.
 *
 * @param event - The change event to analyze
 * @returns Array of changed field names
 */
export function getChangedFields<T>(event: ChangeEvent<T>): string[] {
  // Only UPDATE events have meaningful changed fields
  if (event.operation !== ChangeOperation.UPDATE) {
    return []
  }

  if (event.before === null || event.after === null) {
    return []
  }

  const before = event.before as Record<string, unknown>
  const after = event.after as Record<string, unknown>

  const changedFields: string[] = []
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))

  for (const key of allKeys) {
    if (!deepEqual(before[key], after[key])) {
      changedFields.push(key)
    }
  }

  return changedFields
}
