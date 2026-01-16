/**
 * Thing Schema - Versioned Entity Storage
 *
 * Things are the fundamental data abstraction in dotdo - versioned, typed entities
 * stored in an append-only log. Each row represents a version.
 *
 * @module schemas/thing
 */

import { z } from 'zod'

/**
 * Visibility levels for things
 * - public: Visible to everyone, including anonymous users
 * - unlisted: Not discoverable, but accessible with direct link
 * - org: Visible only to organization members
 * - user: Visible only to the owner (most restrictive, default)
 */
export const VisibilitySchema = z.enum(['public', 'unlisted', 'org', 'user'])
export type Visibility = z.infer<typeof VisibilitySchema>

/**
 * ThingSchema - validates versioned entities
 *
 * Key concepts:
 * - Append-only: Things are never mutated; new versions are appended
 * - Version = rowid: The SQLite rowid serves as the version identifier
 * - Branching: Things can exist on multiple branches (null = main branch)
 * - Soft delete: Deleted things have deleted=true, enabling undelete
 */
export const ThingSchema = z.object({
  /** Local path identifier (e.g., 'acme', 'headless.ly') */
  id: z.string().min(1, 'id is required'),

  /** Type ID (references noun registry) */
  type: z.number().int().nonnegative(),

  /** Branch name (null = main branch) */
  branch: z.string().nullable().optional(),

  /** Human-readable name */
  name: z.string().nullable().optional(),

  /** Arbitrary JSON data payload */
  data: z.record(z.string(), z.unknown()).nullable().optional(),

  /** Soft delete marker */
  deleted: z.boolean().default(false),

  /** Visibility level */
  visibility: VisibilitySchema.default('user'),
})

export type ThingSchemaType = z.infer<typeof ThingSchema>

/**
 * Schema for creating a new thing
 */
export const NewThingSchema = ThingSchema.pick({
  id: true,
  type: true,
  name: true,
  data: true,
  branch: true,
  visibility: true,
})

export type NewThingType = z.infer<typeof NewThingSchema>

/**
 * Schema for thing query filters
 */
export const ThingFilterSchema = z.object({
  /** Filter by type ID */
  type: z.number().int().nonnegative().optional(),
  /** Filter by branch (null = main branch) */
  branch: z.string().nullable().optional(),
  /** Include soft-deleted things */
  includeDeleted: z.boolean().default(false),
  /** Filter by visibility */
  visibility: z.union([VisibilitySchema, z.array(VisibilitySchema)]).optional(),
  /** Maximum results */
  limit: z.number().int().positive().default(100),
})

export type ThingFilterType = z.infer<typeof ThingFilterSchema>

/**
 * Schema for thing with metadata (for API responses)
 */
export const ThingWithMetaSchema = ThingSchema.extend({
  /** Version number (rowid) */
  version: z.number().int().nonnegative().optional(),
  /** Noun name (resolved from type) */
  typeName: z.string().optional(),
  /** Full URL path */
  url: z.string().url().optional(),
  /** Created timestamp (from action) */
  createdAt: z.date().optional(),
  /** Updated timestamp (from action) */
  updatedAt: z.date().optional(),
  /** Creator actor (from action) */
  createdBy: z.string().optional(),
})

export type ThingWithMetaType = z.infer<typeof ThingWithMetaSchema>
