/**
 * Sync Protocol Types
 *
 * Protocol types shared between server (Durable Objects) and client
 * for WebSocket sync communication.
 *
 * @module types/sync-protocol
 */

import { z } from 'zod'

// ============================================================================
// ZOD SCHEMAS - Runtime validation
// ============================================================================

/**
 * Thing schema for sync messages
 */
export const ThingSchema = z.object({
  $id: z.string(),
  $type: z.string(),
  name: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  branch: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().optional(),
}).passthrough()

export const QueryOptionsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  orderBy: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  where: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================================
// CLIENT -> SERVER MESSAGES
// ============================================================================

export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  collection: z.string().min(1),
  branch: z.string().nullable().optional(),
  query: QueryOptionsSchema.optional(),
})

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  collection: z.string().min(1),
})

// ============================================================================
// SERVER -> CLIENT MESSAGES
// ============================================================================

export const InitialMessageSchema = z.object({
  type: z.literal('initial'),
  collection: z.string(),
  data: z.array(ThingSchema),
  txid: z.number().int().nonnegative(),
})

// Base change message for insert/update (requires data)
const InsertMessageSchema = z.object({
  type: z.literal('insert'),
  collection: z.string(),
  key: z.string().min(1),
  data: ThingSchema,
  txid: z.number().int().nonnegative(),
})

const UpdateMessageSchema = z.object({
  type: z.literal('update'),
  collection: z.string(),
  key: z.string().min(1),
  data: ThingSchema,
  txid: z.number().int().nonnegative(),
})

const DeleteMessageSchema = z.object({
  type: z.literal('delete'),
  collection: z.string(),
  key: z.string().min(1),
  data: ThingSchema.optional(),
  txid: z.number().int().nonnegative(),
})

export const ChangeMessageSchema = z.discriminatedUnion('type', [
  InsertMessageSchema,
  UpdateMessageSchema,
  DeleteMessageSchema,
])

export const MutationResponseSchema = z.object({
  success: z.boolean(),
  rowid: z.number(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
})

// SyncMessage includes client messages (subscribe/unsubscribe) and server messages (initial/change)
export const SyncMessageSchema = z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  InitialMessageSchema,
  InsertMessageSchema,
  UpdateMessageSchema,
  DeleteMessageSchema,
])

// ============================================================================
// TYPE ALIASES from schemas
// ============================================================================

export type Thing = z.infer<typeof ThingSchema>
export type QueryOptions = z.infer<typeof QueryOptionsSchema>
export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>
export type InitialMessage = z.infer<typeof InitialMessageSchema>
export type ChangeMessage = z.infer<typeof ChangeMessageSchema>
export type SyncMessage = z.infer<typeof SyncMessageSchema>
export type MutationResponse = z.infer<typeof MutationResponseSchema>

// ============================================================================
// LEGACY INTERFACES (for backward compatibility with server code)
// ============================================================================

/**
 * Minimal Thing representation for sync messages.
 * Matches the core ThingData structure but simplified for wire format.
 */
export interface SyncThing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  branch?: string | null
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
  deletedAt?: string | null
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage

export type ServerMessage = InitialMessage | ChangeMessage

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract collection name from a $type URL
 * e.g., 'https://example.com.ai/Task' -> 'Task'
 */
export function getCollectionFromType($type: string): string {
  try {
    const url = new URL($type)
    return url.pathname.slice(1) // Remove leading /
  } catch {
    // If not a URL, treat as plain collection name
    return $type
  }
}

/**
 * Serialize a thing for sync messages
 */
export function serializeThing(thing: {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  branch?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  deletedAt?: Date | string | null
}): SyncThing {
  return {
    $id: thing.$id,
    $type: thing.$type,
    name: thing.name,
    data: thing.data,
    meta: thing.meta,
    branch: thing.branch ?? null,
    createdAt: thing.createdAt instanceof Date ? thing.createdAt.toISOString() : thing.createdAt,
    updatedAt: thing.updatedAt instanceof Date ? thing.updatedAt.toISOString() : thing.updatedAt,
    deletedAt: thing.deletedAt
      ? thing.deletedAt instanceof Date
        ? thing.deletedAt.toISOString()
        : thing.deletedAt
      : null,
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isSubscribeMessage(msg: unknown): msg is SubscribeMessage {
  return SubscribeMessageSchema.safeParse(msg).success
}

export function isUnsubscribeMessage(msg: unknown): msg is UnsubscribeMessage {
  return UnsubscribeMessageSchema.safeParse(msg).success
}

export function isInitialMessage(msg: unknown): msg is InitialMessage {
  return InitialMessageSchema.safeParse(msg).success
}

export function isChangeMessage(msg: unknown): msg is ChangeMessage {
  return ChangeMessageSchema.safeParse(msg).success
}

export function isMutationResponse(msg: unknown): msg is MutationResponse {
  return MutationResponseSchema.safeParse(msg).success
}

// ============================================================================
// PARSER
// ============================================================================

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError }

export function parseSyncMessage(data: unknown): ParseResult<SyncMessage> {
  // If string, try to parse as JSON first
  let parsed = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {
      return {
        success: false,
        error: new z.ZodError([{ code: 'custom', message: 'Invalid JSON', path: [] }])
      }
    }
  }

  const result = SyncMessageSchema.safeParse(parsed)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}
