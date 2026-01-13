/**
 * API Boundary Schemas
 *
 * Zod schemas for validating data at API boundaries including:
 * - FunctionData for function creation
 * - Relationship data payloads
 * - Thing creation/update inputs
 * - Store method parameters
 *
 * These schemas are used to validate data at public API entry points
 * before it reaches internal store methods.
 *
 * @module lib/validation/api-schemas
 */

import { z } from 'zod'

// ============================================================================
// FUNCTION DATA SCHEMAS
// ============================================================================

/**
 * FunctionType enum for runtime validation
 */
export const functionTypeSchema = z.enum(['code', 'generative', 'agentic', 'human'])
export type FunctionType = z.infer<typeof functionTypeSchema>

/**
 * Custom validator for DO URLs or standard URLs
 */
export const doUrlSchema = z.string().refine(
  (val) => val.startsWith('do://') || val.startsWith('http://') || val.startsWith('https://'),
  { message: 'Must be a valid URL or DO URL (do://)' }
)

/**
 * FunctionData schema - validates function creation payloads
 */
export const functionDataSchema = z.object({
  name: z.string().min(1, 'Function name is required').max(255, 'Function name too long'),
  type: functionTypeSchema,
  description: z.string().max(2000, 'Description too long').optional(),
  handler: z.string().max(500, 'Handler path too long').optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format').optional(),
  enabled: z.boolean().optional(),
})
export type FunctionData = z.infer<typeof functionDataSchema>

// ============================================================================
// RELATIONSHIP DATA SCHEMAS
// ============================================================================

/**
 * CascadeRelationshipData schema - validates cascade relationship payloads
 */
export const cascadeRelationshipDataSchema = z.object({
  priority: z.number().int().min(0, 'Priority must be non-negative'),
  condition: z.string().max(500, 'Condition too long').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CascadeRelationshipData = z.infer<typeof cascadeRelationshipDataSchema>

/**
 * CreateRelationshipInput schema - validates relationship creation
 */
export const createRelationshipSchema = z.object({
  id: z.string().min(1, 'Relationship ID is required'),
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  from: doUrlSchema,
  to: doUrlSchema,
  data: z.record(z.string(), z.unknown()).optional(),
})
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>

// ============================================================================
// THING DATA SCHEMAS
// ============================================================================

/**
 * CreateThingInput schema - validates Thing creation at API boundary
 */
export const createThingSchema = z.object({
  id: z.string().min(1, 'Thing ID is required').max(255, 'Thing ID too long'),
  typeId: z.number().int().positive('Type ID must be a positive integer'),
  typeName: z.string().min(1, 'Type name is required').max(100, 'Type name too long'),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type CreateThingInput = z.infer<typeof createThingSchema>

/**
 * ThingEntity schema for store-level validation
 */
export const thingEntitySchema = z.object({
  $id: z.string().min(1, 'ID is required').max(255, 'ID too long').optional(),
  $type: z.string().min(1, 'Type is required').max(100, 'Type name too long').optional(),
  type: z.string().min(1, 'Type is required').max(100, 'Type name too long').optional(),
  name: z.string().max(255, 'Name too long').nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  branch: z.string().max(100, 'Branch name too long').nullable().optional(),
  version: z.number().int().positive().optional(),
  deleted: z.boolean().optional(),
}).refine(
  (data) => data.$type !== undefined || data.type !== undefined,
  { message: '$type or type is required', path: ['$type'] }
)
export type ThingEntityInput = z.infer<typeof thingEntitySchema>

// ============================================================================
// STORE OPTIONS SCHEMAS
// ============================================================================

/**
 * ThingsStore.get() options schema
 */
export const thingsGetOptionsSchema = z.object({
  branch: z.string().max(100).optional(),
  version: z.number().int().positive().optional(),
  includeDeleted: z.boolean().optional(),
}).strict()

/**
 * ThingsStore.list() options schema
 */
export const thingsListOptionsSchema = z.object({
  type: z.string().max(100).optional(),
  branch: z.string().max(100).optional(),
  orderBy: z.enum(['id', 'name', 'type', 'branch', 'deleted']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  after: z.string().max(255).optional(),
  includeDeleted: z.boolean().optional(),
  where: z.record(z.string(), z.unknown()).optional(),
}).strict()

/**
 * ThingsStore.create() options schema
 */
export const thingsCreateOptionsSchema = z.object({
  branch: z.string().max(100).optional(),
}).strict()

/**
 * ThingsStore.update() options schema
 */
export const thingsUpdateOptionsSchema = z.object({
  merge: z.boolean().optional(),
  branch: z.string().max(100).optional(),
}).strict()

/**
 * ThingsStore.delete() options schema
 */
export const thingsDeleteOptionsSchema = z.object({
  hard: z.boolean().optional(),
  branch: z.string().max(100).optional(),
}).strict()

// ============================================================================
// RELATIONSHIPS STORE SCHEMAS
// ============================================================================

/**
 * RelationshipsStore.create() data schema
 */
export const relationshipCreateDataSchema = z.object({
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  from: z.string().min(1, 'From is required').max(500, 'From ID too long'),
  to: z.string().min(1, 'To is required').max(500, 'To ID too long'),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type RelationshipCreateData = z.infer<typeof relationshipCreateDataSchema>

/**
 * RelationshipsStore.list() options schema
 */
export const relationshipsListOptionsSchema = z.object({
  from: z.string().max(500).optional(),
  to: z.string().max(500).optional(),
  verb: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
}).strict()

// ============================================================================
// ACTIONS STORE SCHEMAS
// ============================================================================

/**
 * Durability level schema
 */
export const durabilitySchema = z.enum(['send', 'try', 'do'])

/**
 * Action status schema
 */
export const actionStatusSchema = z.enum([
  'pending', 'running', 'completed', 'failed', 'undone', 'retrying'
])

/**
 * ActionsStore.log() options schema
 */
export const actionsLogOptionsSchema = z.object({
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  target: z.string().min(1, 'Target is required').max(500, 'Target too long'),
  actor: z.string().max(255).optional(),
  input: z.union([z.number(), z.record(z.string(), z.unknown())]).optional(),
  output: z.number().optional(),
  durability: durabilitySchema.optional(),
  requestId: z.string().max(100).optional(),
  sessionId: z.string().max(100).optional(),
  workflowId: z.string().max(100).optional(),
})

/**
 * ActionsStore.list() options schema
 */
export const actionsListOptionsSchema = z.object({
  target: z.string().max(500).optional(),
  actor: z.string().max(255).optional(),
  status: actionStatusSchema.optional(),
  verb: z.string().max(100).optional(),
}).strict()

// ============================================================================
// EVENTS STORE SCHEMAS
// ============================================================================

/**
 * EventsStore.emit() options schema
 */
export const eventsEmitOptionsSchema = z.object({
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  source: z.string().min(1, 'Source is required').max(500, 'Source too long'),
  data: z.record(z.string(), z.unknown()),
  actionId: z.string().max(100).optional(),
})
export type EventsEmitOptions = z.infer<typeof eventsEmitOptionsSchema>

/**
 * EventsStore.list() options schema
 */
export const eventsListOptionsSchema = z.object({
  source: z.string().max(500).optional(),
  verb: z.string().max(100).optional(),
  afterSequence: z.number().int().optional(),
  orderBy: z.enum(['sequence']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).strict()

/**
 * EventsStore.replay() options schema
 */
export const eventsReplayOptionsSchema = z.object({
  fromSequence: z.number().int(),
  limit: z.number().int().min(1).max(1000).optional(),
})

// ============================================================================
// SEARCH STORE SCHEMAS
// ============================================================================

/**
 * SearchStore.index() entry schema
 */
export const searchIndexEntrySchema = z.object({
  $id: z.string().min(1, 'ID is required').max(255, 'ID too long'),
  $type: z.string().min(1, 'Type is required').max(100, 'Type too long'),
  content: z.string().max(100000, 'Content too long (max 100KB)'),
})
export type SearchIndexEntry = z.infer<typeof searchIndexEntrySchema>

/**
 * SearchStore.query() options schema
 */
export const searchQueryOptionsSchema = z.object({
  type: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

// ============================================================================
// OBJECTS STORE SCHEMAS
// ============================================================================

/**
 * Valid relation types
 */
export const relationTypeSchema = z.enum([
  'parent', 'child', 'follower', 'shard', 'reference'
])

/**
 * ObjectsStore.register() options schema
 */
export const objectsRegisterOptionsSchema = z.object({
  ns: z.string().min(1, 'Namespace is required').max(255, 'Namespace too long'),
  id: z.string().min(1, 'ID is required').max(255, 'ID too long'),
  class: z.string().min(1, 'Class is required').max(100, 'Class name too long'),
  relation: relationTypeSchema.optional(),
  shardKey: z.string().max(255).optional(),
  shardIndex: z.number().int().min(0).optional(),
  region: z.string().max(50).optional(),
  colo: z.string().max(10).optional(),
  primary: z.boolean().optional(),
})
export type ObjectsRegisterOptions = z.infer<typeof objectsRegisterOptionsSchema>

/**
 * ObjectsStore.list() options schema
 */
export const objectsListOptionsSchema = z.object({
  relation: relationTypeSchema.optional(),
  class: z.string().max(100).optional(),
  region: z.string().max(50).optional(),
  colo: z.string().max(10).optional(),
}).strict()

// ============================================================================
// DLQ STORE SCHEMAS
// ============================================================================

/**
 * DLQStore.add() options schema
 */
export const dlqAddOptionsSchema = z.object({
  eventId: z.string().max(100).optional(),
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  source: z.string().min(1, 'Source is required').max(500, 'Source too long'),
  data: z.record(z.string(), z.unknown()),
  error: z.string().min(1, 'Error is required').max(10000, 'Error message too long'),
  errorStack: z.string().max(50000, 'Error stack too long').optional(),
  maxRetries: z.number().int().min(0).max(100).optional(),
  idempotencyKey: z.string().max(255).optional(),
})
export type DLQAddOptions = z.infer<typeof dlqAddOptionsSchema>

/**
 * DLQStore.list() options schema
 */
export const dlqListOptionsSchema = z.object({
  verb: z.string().max(100).optional(),
  source: z.string().max(500).optional(),
  minRetries: z.number().int().min(0).optional(),
  maxRetries: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  status: z.enum(['pending', 'replaying', 'exhausted', 'archived']).optional(),
  readyForRetry: z.boolean().optional(),
}).strict()

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

import { ValidationError, transformValidationError } from './error-transform'

/**
 * Validate data against a schema and throw ValidationError on failure.
 *
 * @param data - Data to validate
 * @param schema - Zod schema to validate against
 * @param context - Context for error messages (e.g., 'ThingsStore.create')
 * @returns Validated data
 * @throws ValidationError if validation fails
 */
export function validateOrThrow<T>(
  data: unknown,
  schema: z.ZodType<T>,
  context: string
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw transformValidationError(result.error, context)
  }
  return result.data
}

/**
 * Create a validated wrapper for a store method.
 *
 * @param schema - Zod schema for the input data
 * @param method - The store method to wrap
 * @param methodName - Name of the method for error context
 * @returns Wrapped method that validates input before calling the original
 */
export function withValidation<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  method: (data: TInput) => TOutput,
  methodName: string
): (data: unknown) => TOutput {
  return (data: unknown): TOutput => {
    const validated = validateOrThrow(data, schema, methodName)
    return method(validated)
  }
}

/**
 * Validate an ID string with security checks.
 *
 * @param id - The ID to validate
 * @param fieldName - Name of the field for error messages
 * @returns Validated and trimmed ID
 * @throws ValidationError if ID is invalid
 */
export function validateId(id: unknown, fieldName: string = 'id'): string {
  if (id === null || id === undefined) {
    throw new ValidationError({
      message: `${fieldName} is required`,
      path: [fieldName],
      code: 'REQUIRED_FIELD',
    })
  }

  if (typeof id !== 'string') {
    throw new ValidationError({
      message: `${fieldName} must be a string`,
      path: [fieldName],
      expected: 'string',
      code: 'INVALID_TYPE',
    })
  }

  const trimmed = id.trim()

  if (trimmed.length === 0) {
    throw new ValidationError({
      message: `${fieldName} cannot be empty`,
      path: [fieldName],
      code: 'EMPTY_FIELD',
    })
  }

  if (trimmed.length > 255) {
    throw new ValidationError({
      message: `${fieldName} is too long (max 255 characters)`,
      path: [fieldName],
      code: 'TOO_LONG',
    })
  }

  // Security: check for null bytes (potential injection attack)
  if (trimmed.includes('\x00')) {
    throw new ValidationError({
      message: `${fieldName} contains invalid characters`,
      path: [fieldName],
      code: 'INVALID_CHARACTERS',
    })
  }

  return trimmed
}

/**
 * Validate a type name with security checks.
 *
 * @param typeName - The type name to validate
 * @param fieldName - Name of the field for error messages
 * @returns Validated type name
 * @throws ValidationError if type name is invalid
 */
export function validateTypeName(typeName: unknown, fieldName: string = 'type'): string {
  if (typeName === null || typeName === undefined) {
    throw new ValidationError({
      message: `${fieldName} is required`,
      path: [fieldName],
      code: 'REQUIRED_FIELD',
    })
  }

  if (typeof typeName !== 'string') {
    throw new ValidationError({
      message: `${fieldName} must be a string`,
      path: [fieldName],
      expected: 'string',
      code: 'INVALID_TYPE',
    })
  }

  const trimmed = typeName.trim()

  if (trimmed.length === 0) {
    throw new ValidationError({
      message: `${fieldName} cannot be empty`,
      path: [fieldName],
      code: 'EMPTY_FIELD',
    })
  }

  if (trimmed.length > 100) {
    throw new ValidationError({
      message: `${fieldName} is too long (max 100 characters)`,
      path: [fieldName],
      code: 'TOO_LONG',
    })
  }

  // Security: type names should be alphanumeric with underscores
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new ValidationError({
      message: `${fieldName} must start with a letter and contain only letters, numbers, and underscores`,
      path: [fieldName],
      code: 'INVALID_FORMAT',
    })
  }

  return trimmed
}

/**
 * Validate pagination options.
 *
 * @param options - Object containing limit and offset
 * @returns Validated pagination options
 * @throws ValidationError if options are invalid
 */
export function validatePagination(options: {
  limit?: unknown
  offset?: unknown
}): { limit: number; offset: number } {
  let limit = 100 // default
  let offset = 0 // default

  if (options.limit !== undefined) {
    if (typeof options.limit !== 'number' || !Number.isInteger(options.limit)) {
      throw new ValidationError({
        message: 'limit must be an integer',
        path: ['limit'],
        expected: 'integer',
        code: 'INVALID_TYPE',
      })
    }
    if (options.limit < 1) {
      throw new ValidationError({
        message: 'limit must be at least 1',
        path: ['limit'],
        code: 'TOO_SMALL',
      })
    }
    if (options.limit > 1000) {
      throw new ValidationError({
        message: 'limit cannot exceed 1000',
        path: ['limit'],
        code: 'TOO_LARGE',
      })
    }
    limit = options.limit
  }

  if (options.offset !== undefined) {
    if (typeof options.offset !== 'number' || !Number.isInteger(options.offset)) {
      throw new ValidationError({
        message: 'offset must be an integer',
        path: ['offset'],
        expected: 'integer',
        code: 'INVALID_TYPE',
      })
    }
    if (options.offset < 0) {
      throw new ValidationError({
        message: 'offset cannot be negative',
        path: ['offset'],
        code: 'TOO_SMALL',
      })
    }
    offset = options.offset
  }

  return { limit, offset }
}
