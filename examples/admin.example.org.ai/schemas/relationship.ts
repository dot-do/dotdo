/**
 * Relationship Schema - Graph Edges
 *
 * Relationships connect Things with verbs (predicates).
 * They use fully qualified URLs and can span DOs or external systems.
 *
 * @module schemas/relationship
 */

import { z } from 'zod'

/**
 * RelationshipSchema - validates graph edges
 *
 * Relationships are edges in the graph:
 * - from: Source URL (can be local, cross-DO, or external)
 * - to: Target URL
 * - verb: Predicate connecting them (e.g., 'creates', 'manages', 'owns')
 *
 * Example relationships:
 * - 'https://startups.studio/headless.ly' --creates--> 'https://startups.studio/nathan'
 * - 'https://api.example.org.ai/User/1' --manages--> 'https://api.example.org.ai/Team/1'
 */
export const RelationshipSchema = z.object({
  /** Unique relationship ID */
  id: z.string().min(1, 'id is required'),

  /** Predicate verb (e.g., 'created', 'manages', 'owns') */
  verb: z.string().min(1, 'verb is required'),

  /** Source URL - can be local, cross-DO, or external */
  from: z.string().url('from must be a valid URL'),
  /** Target URL - can be local, cross-DO, or external */
  to: z.string().url('to must be a valid URL'),

  /** Edge properties (arbitrary JSON data) */
  data: z.record(z.string(), z.unknown()).optional(),

  /** When the relationship was created */
  createdAt: z.date(),
})

export type RelationshipSchemaType = z.infer<typeof RelationshipSchema>

/**
 * Schema for creating a new relationship (subset of required fields)
 */
export const NewRelationshipSchema = RelationshipSchema.pick({
  verb: true,
  from: true,
  to: true,
  data: true,
}).extend({
  id: z.string().optional(),
})

export type NewRelationshipType = z.infer<typeof NewRelationshipSchema>

/**
 * Schema for relationship query filters
 */
export const RelationshipFilterSchema = z.object({
  /** Filter by source URL */
  from: z.string().url().optional(),
  /** Filter by target URL */
  to: z.string().url().optional(),
  /** Filter by verb */
  verb: z.string().optional(),
  /** Limit results */
  limit: z.number().int().positive().default(100),
})

export type RelationshipFilterType = z.infer<typeof RelationshipFilterSchema>
