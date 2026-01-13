/**
 * Zod Schemas for Store Input Validation
 *
 * Provides schemas for validating inputs to all store methods in db/stores.ts.
 * These schemas can be used directly or through the validation utilities.
 *
 * @module lib/validation/store-schemas
 */

import { z } from 'zod'

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/**
 * Non-empty string schema
 */
export const nonEmptyString = z.string().min(1, 'cannot be empty')

/**
 * ID string schema - non-empty, trimmed
 */
export const idSchema = z.string().min(1, 'ID is required').transform((s) => s.trim())

/**
 * Type name schema - valid identifier pattern
 */
export const typeNameSchema = z.string().min(1, 'Type name is required').max(100, 'Type name too long')

/**
 * Branch name schema
 */
export const branchNameSchema = z.string().min(1).max(255).optional()

/**
 * Pagination limit schema
 */
export const limitSchema = z.number().int().min(1).max(1000).default(100)

/**
 * Pagination offset schema
 */
export const offsetSchema = z.number().int().min(0).default(0)

/**
 * Order direction schema
 */
export const orderSchema = z.enum(['asc', 'desc']).default('asc')

/**
 * Allowed order columns for ThingsStore
 */
export const orderColumnSchema = z.enum(['id', 'name', 'type', 'branch', 'deleted']).default('id')

// ============================================================================
// THINGS STORE SCHEMAS
// ============================================================================

/**
 * Schema for ThingsStore.get() options
 */
export const thingsGetOptionsSchema = z.object({
  branch: branchNameSchema,
  version: z.number().int().positive().optional(),
  includeDeleted: z.boolean().optional(),
})

/**
 * Schema for ThingsStore.list() options
 */
export const thingsListOptionsSchema = z.object({
  type: z.string().optional(),
  branch: branchNameSchema,
  orderBy: orderColumnSchema,
  order: orderSchema,
  limit: limitSchema,
  offset: offsetSchema,
  after: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  where: z.record(z.unknown()).optional(),
})

/**
 * Schema for ThingsStore.create() data
 */
export const thingsCreateDataSchema = z.object({
  $id: z.string().optional(),
  $type: typeNameSchema.optional(),
  type: typeNameSchema.optional(),
  name: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
}).refine(
  (data) => data.$type !== undefined || data.type !== undefined,
  { message: '$type or type is required', path: ['$type'] }
)

/**
 * Schema for ThingsStore.create() options
 */
export const thingsCreateOptionsSchema = z.object({
  branch: branchNameSchema,
})

/**
 * Schema for ThingsStore.update() data
 */
export const thingsUpdateDataSchema = z.object({
  name: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
})

/**
 * Schema for ThingsStore.update() options
 */
export const thingsUpdateOptionsSchema = z.object({
  merge: z.boolean().optional(),
  branch: branchNameSchema,
})

/**
 * Schema for ThingsStore.delete() options
 */
export const thingsDeleteOptionsSchema = z.object({
  hard: z.boolean().optional(),
  branch: branchNameSchema,
})

// ============================================================================
// RELATIONSHIPS STORE SCHEMAS
// ============================================================================

/**
 * Schema for RelationshipsStore.create() data
 */
export const relationshipsCreateDataSchema = z.object({
  verb: nonEmptyString,
  from: nonEmptyString,
  to: nonEmptyString,
  data: z.record(z.unknown()).optional(),
})

/**
 * Schema for RelationshipsStore.list() options
 */
export const relationshipsListOptionsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  verb: z.string().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

/**
 * Schema for RelationshipsStore.deleteWhere() criteria
 */
export const relationshipsDeleteWhereSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  verb: z.string().optional(),
}).refine(
  (data) => data.from !== undefined || data.to !== undefined || data.verb !== undefined,
  { message: 'At least one criteria (from, to, or verb) is required' }
)

// ============================================================================
// ACTIONS STORE SCHEMAS
// ============================================================================

/**
 * Durability levels for actions
 */
export const durabilitySchema = z.enum(['send', 'try', 'do']).default('try')

/**
 * Action status values
 */
export const actionStatusSchema = z.enum([
  'pending', 'running', 'completed', 'failed', 'undone', 'retrying'
])

/**
 * Schema for ActionsStore.log() options
 */
export const actionsLogOptionsSchema = z.object({
  verb: nonEmptyString,
  target: nonEmptyString,
  actor: z.string().optional(),
  input: z.union([z.number(), z.record(z.unknown())]).optional(),
  output: z.number().optional(),
  durability: durabilitySchema,
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  workflowId: z.string().optional(),
})

/**
 * Schema for ActionsStore.list() options
 */
export const actionsListOptionsSchema = z.object({
  target: z.string().optional(),
  actor: z.string().optional(),
  status: actionStatusSchema.optional(),
  verb: z.string().optional(),
})

// ============================================================================
// EVENTS STORE SCHEMAS
// ============================================================================

/**
 * Schema for EventsStore.emit() options
 */
export const eventsEmitOptionsSchema = z.object({
  verb: nonEmptyString,
  source: nonEmptyString,
  data: z.record(z.unknown()),
  actionId: z.string().optional(),
})

/**
 * Schema for EventsStore.list() options
 */
export const eventsListOptionsSchema = z.object({
  source: z.string().optional(),
  verb: z.string().optional(),
  afterSequence: z.number().int().optional(),
  orderBy: z.enum(['sequence']).optional(),
  order: orderSchema,
})

/**
 * Schema for EventsStore.replay() options
 */
export const eventsReplayOptionsSchema = z.object({
  fromSequence: z.number().int(),
  limit: limitSchema,
})

// ============================================================================
// SEARCH STORE SCHEMAS
// ============================================================================

/**
 * Schema for SearchStore.index() entry
 */
export const searchIndexEntrySchema = z.object({
  $id: nonEmptyString,
  $type: nonEmptyString,
  content: z.string(),
})

/**
 * Schema for SearchStore.query() options
 */
export const searchQueryOptionsSchema = z.object({
  type: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
})

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
 * Schema for ObjectsStore.register() options
 */
export const objectsRegisterOptionsSchema = z.object({
  ns: nonEmptyString,
  id: nonEmptyString,
  class: nonEmptyString,
  relation: relationTypeSchema.optional(),
  shardKey: z.string().optional(),
  shardIndex: z.number().int().optional(),
  region: z.string().optional(),
  colo: z.string().optional(),
  primary: z.boolean().optional(),
})

/**
 * Schema for ObjectsStore.create() options (alias for register)
 */
export const objectsCreateOptionsSchema = z.object({
  ns: nonEmptyString,
  doId: nonEmptyString,
  doClass: nonEmptyString,
  relation: relationTypeSchema.optional(),
  shardKey: z.string().optional(),
  shardIndex: z.number().int().optional(),
  region: z.string().optional(),
  colo: z.string().optional(),
  primary: z.boolean().optional(),
})

/**
 * Schema for ObjectsStore.list() options
 */
export const objectsListOptionsSchema = z.object({
  relation: relationTypeSchema.optional(),
  class: z.string().optional(),
  region: z.string().optional(),
  colo: z.string().optional(),
})

/**
 * Schema for ObjectsStore.update() data
 */
export const objectsUpdateDataSchema = z.object({
  cached: z.record(z.unknown()).nullable().optional(),
  region: z.string().optional(),
  primary: z.boolean().optional(),
})

// ============================================================================
// DLQ STORE SCHEMAS
// ============================================================================

/**
 * Schema for DLQStore.add() options
 */
export const dlqAddOptionsSchema = z.object({
  eventId: z.string().optional(),
  verb: nonEmptyString,
  source: nonEmptyString,
  data: z.record(z.unknown()),
  error: nonEmptyString,
  errorStack: z.string().optional(),
  maxRetries: z.number().int().min(0).max(100).default(3),
  idempotencyKey: z.string().optional(),
})

/**
 * Schema for DLQStore.list() options
 */
export const dlqListOptionsSchema = z.object({
  verb: z.string().optional(),
  source: z.string().optional(),
  minRetries: z.number().int().min(0).optional(),
  maxRetries: z.number().int().min(0).optional(),
  limit: limitSchema,
  offset: offsetSchema,
  status: z.enum(['pending', 'replaying', 'exhausted', 'archived']).optional(),
  readyForRetry: z.boolean().optional(),
})

/**
 * Schema for DLQStore.replayAll() options
 */
export const dlqReplayAllOptionsSchema = z.object({
  verb: z.string().optional(),
  source: z.string().optional(),
  includeDetails: z.boolean().optional(),
})
