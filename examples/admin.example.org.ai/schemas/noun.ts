/**
 * Noun Schema - Type Registry
 *
 * Nouns define collection types and their metadata.
 * Simplified from dotdo main branch for admin UI use.
 *
 * @module schemas/noun
 */

import { z } from 'zod'

/**
 * Schema for noun field definitions
 */
export const NounFieldSchema = z.object({
  /** Field data type */
  type: z.string(),
  /** Whether the field is required */
  required: z.boolean().optional(),
  /** Human-readable description */
  description: z.string().optional(),
  /** Default value */
  default: z.unknown().optional(),
})

/**
 * Schema for storage tier configuration
 */
export const StorageTierSchema = z.enum(['hot', 'cold', 'tiered'])

/**
 * Schema for consistency mode
 */
export const ConsistencyModeSchema = z.enum(['strong', 'eventual', 'causal'])

/**
 * Schema for namespace strategy
 */
export const NsStrategySchema = z.enum(['tenant', 'singleton', 'sharded'])

/**
 * NounSchema - validates noun type definitions
 *
 * Nouns are the type registry for Things. They define:
 * - Identity (name, plural, description)
 * - Schema (field definitions)
 * - Storage configuration (sharding, tiers, TTL)
 * - Query optimization (indexed fields)
 */
export const NounSchema = z.object({
  /** Noun name (PascalCase) - primary key */
  noun: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/, 'Noun must be PascalCase'),
  /** Plural form of the noun */
  plural: z.string().optional(),
  /** Human-readable description */
  description: z.string().optional(),

  /** Schema definition - field types and validation */
  schema: z.object({
    type: z.string(),
    fields: z.record(z.string(), NounFieldSchema).optional(),
    validators: z.array(z.string()).optional(),
    computed: z.array(z.string()).optional(),
  }).passthrough().optional(),

  /** Durable Object class binding name */
  doClass: z.string().optional(),

  /** Whether this noun is sharded across multiple DOs */
  sharded: z.boolean().default(false),
  /** Number of shards if sharded */
  shardCount: z.number().int().positive().default(1),
  /** Field to shard by (default: id) */
  shardKey: z.string().optional(),

  /** Storage tier: hot (DO), cold (R2/Iceberg), or tiered */
  storage: StorageTierSchema.default('hot'),
  /** Days before archiving to cold storage (for tiered) */
  ttlDays: z.number().int().positive().optional(),

  /** Fields to index for query optimization */
  indexedFields: z.array(z.string()).optional(),

  /** Namespace strategy */
  nsStrategy: NsStrategySchema.default('tenant'),

  /** Replica regions for geo-distribution */
  replicaRegions: z.array(z.string()).optional(),
  /** Consistency mode for replicas */
  consistencyMode: ConsistencyModeSchema.default('eventual'),
  /** DO binding name pattern for replicas */
  replicaBinding: z.string().optional(),
})

export type NounSchemaType = z.infer<typeof NounSchema>
export type NounFieldSchemaType = z.infer<typeof NounFieldSchema>
