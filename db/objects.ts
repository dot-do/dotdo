/**
 * @module db/objects
 *
 * Durable Object registry and cross-DO resolution.
 *
 * This module manages the mapping between namespace URLs and Cloudflare
 * Durable Object IDs. It enables:
 *
 * - **Cross-DO Resolution**: Find and communicate with other DOs by namespace
 * - **Sharding**: Distribute load across multiple DO instances
 * - **Geo-replication**: Track primary/replica relationships across regions
 * - **Cached Metadata**: Store denormalized data for fast lookups
 *
 * ## Key Concepts
 *
 * - **Namespace (ns)**: A URL-like identifier for a DO (e.g., 'https://startups.studio')
 * - **DO ID**: The Cloudflare-assigned Durable Object ID
 * - **Relation**: How this DO relates to others (parent, child, shard, etc.)
 * - **Shard Key/Index**: For horizontal partitioning across multiple DOs
 *
 * @example Register a new Durable Object
 * ```ts
 * import { registerObject } from 'dotdo/db'
 *
 * const obj = await registerObject(db, {
 *   ns: 'https://startups.studio',
 *   id: 'DO_ID_abc123',
 *   class: 'Startup',
 *   createdAt: new Date(),
 * })
 * ```
 *
 * @example Resolve a DO by namespace
 * ```ts
 * import { getObject } from 'dotdo/db'
 *
 * const obj = await getObject(db, 'https://startups.studio')
 * if (obj) {
 *   const doStub = env.DO.idFromString(obj.id)
 *   await doStub.fetch(request)
 * }
 * ```
 *
 * @example Query shards
 * ```ts
 * import { getShards } from 'dotdo/db'
 *
 * const shards = await getShards(db, 'users')
 * for (const shard of shards) {
 *   console.log(`Shard ${shard.shardIndex}: ${shard.id}`)
 * }
 * ```
 *
 * @see {@link stores.ts} ObjectsStore for the high-level store API
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq } from 'drizzle-orm'

// ============================================================================
// OBJECTS - DO-to-DO References (ns → CF DO ID mapping)
// ============================================================================

// ============================================================================
// ENUM CONSTANTS
// ============================================================================

/**
 * Valid relation types for DO-to-DO relationships.
 *
 * Defines how one Durable Object relates to another:
 *
 * - `parent`: This DO is a parent of other DOs (hierarchical)
 * - `child`: This DO is a child of another DO
 * - `follower`: This DO follows/replicates another DO's state
 * - `shard`: This DO is one shard of a sharded dataset
 * - `reference`: Generic reference to another DO
 *
 * @example
 * ```ts
 * await registerObject(db, {
 *   ns: 'https://users.shard-0.example.com',
 *   id: 'DO_ID_shard0',
 *   class: 'UserShard',
 *   relation: ObjectRelation.shard,
 *   shardKey: 'users',
 *   shardIndex: 0,
 *   createdAt: new Date(),
 * })
 * ```
 */
export const ObjectRelation = {
  parent: 'parent',
  child: 'child',
  follower: 'follower',
  shard: 'shard',
  reference: 'reference',
} as const

/** Type for valid relation values */
export type ObjectRelationType = (typeof ObjectRelation)[keyof typeof ObjectRelation]

// ============================================================================
// TABLE SCHEMA
// ============================================================================

/**
 * The objects table - DO registry for cross-DO resolution.
 *
 * Maps namespace URLs to Cloudflare Durable Object IDs, enabling:
 * - Cross-DO communication by namespace lookup
 * - Sharding with shard_key and shard_index
 * - Geo-replication with region and primary fields
 *
 * ## Indexes
 *
 * - `obj_id_idx`: Lookup by Cloudflare DO ID
 * - `obj_relation_idx`: Query by relation type
 * - `obj_shard_idx`: Find all shards for a shard key
 * - `obj_region_idx`: Regional queries for geo-replication
 *
 * @example Direct Drizzle query
 * ```ts
 * import { objects } from 'dotdo/db'
 * import { eq } from 'drizzle-orm'
 *
 * const result = await db
 *   .select()
 *   .from(objects)
 *   .where(eq(objects.ns, 'https://api.example.com'))
 * ```
 */
export const objects = sqliteTable(
  'objects',
  {
    // The namespace URL (which IS the DO's identity - fully qualified)
    ns: text('ns').primaryKey(), // 'https://startups.studio'

    // Cloudflare DO binding
    id: text('id').notNull(), // CF Durable Object ID
    class: text('class').notNull(), // CF binding: 'DO', 'Startup', etc.

    // Relationship type
    relation: text('relation', {
      enum: ['parent', 'child', 'follower', 'shard', 'reference'],
    }),

    // For sharding
    shardKey: text('shard_key'),
    shardIndex: integer('shard_index'),

    // For geo-replication
    region: text('region'),
    primary: integer('primary', { mode: 'boolean' }),

    // Cached data (denormalized for display)
    cached: text('cached', { mode: 'json' }),

    // Created timestamp
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('obj_id_idx').on(table.id),
    index('obj_relation_idx').on(table.relation),
    index('obj_shard_idx').on(table.shardKey, table.shardIndex),
    index('obj_region_idx').on(table.region),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type for a selected object record (all fields).
 *
 * Inferred from the objects table schema. Use this type when working
 * with object records retrieved from the database.
 *
 * @example
 * ```ts
 * import type { DOObject } from 'dotdo/db'
 *
 * function processObject(obj: DOObject) {
 *   console.log(`Namespace: ${obj.ns}`)
 *   console.log(`DO ID: ${obj.id}`)
 *   console.log(`Class: ${obj.class}`)
 *   if (obj.shardKey) {
 *     console.log(`Shard: ${obj.shardKey}[${obj.shardIndex}]`)
 *   }
 * }
 * ```
 */
export type DOObject = typeof objects.$inferSelect

/**
 * Type for inserting a new object record.
 *
 * Inferred from the objects table schema with optional fields marked.
 * Required fields: ns, id, class, createdAt.
 *
 * @example
 * ```ts
 * import type { NewDOObject } from 'dotdo/db'
 *
 * const newObj: NewDOObject = {
 *   ns: 'https://api.example.com',
 *   id: 'DO_ID_abc123',
 *   class: 'API',
 *   createdAt: new Date(),
 * }
 * ```
 */
export type NewDOObject = typeof objects.$inferInsert

// ============================================================================
// QUERY HELPER TYPES
// ============================================================================

/**
 * Database interface required for query helpers.
 *
 * This interface abstracts the database operations needed by the query helpers,
 * allowing them to work with any Drizzle database instance.
 *
 * @example Using with Drizzle
 * ```ts
 * import { drizzle } from 'drizzle-orm/d1'
 * import { getObject } from 'dotdo/db'
 *
 * const db = drizzle(env.DB)
 * const obj = await getObject(db as ObjectsDb, 'https://api.example.com')
 * ```
 */
export interface ObjectsDb {
  select(): {
    from(table: typeof objects): {
      where(condition: ReturnType<typeof eq>): Promise<DOObject[]>
    }
  }
  insert(table: typeof objects): {
    values(values: NewDOObject): {
      returning(): Promise<DOObject[]>
    }
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get a single object by namespace URL.
 * Uses the primary key for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param ns - The namespace URL to look up
 * @returns The object record or undefined if not found
 *
 * @example
 * ```ts
 * const obj = await getObject(db, 'https://startups.studio')
 * if (obj) {
 *   console.log(`Found DO: ${obj.id} (${obj.class})`)
 * }
 * ```
 */
export async function getObject(
  db: ObjectsDb,
  ns: string
): Promise<DOObject | undefined> {
  const results = await db
    .select()
    .from(objects)
    .where(eq(objects.ns, ns))

  return results[0]
}

/**
 * Register a new Durable Object in the objects table.
 *
 * @param db - Drizzle database instance
 * @param data - The object data to insert
 * @returns The inserted object record
 *
 * @example
 * ```ts
 * const obj = await registerObject(db, {
 *   ns: 'https://startups.studio',
 *   id: 'DO_ID_abc123',
 *   class: 'Startup',
 *   createdAt: new Date(),
 * })
 * ```
 */
export async function registerObject(
  db: ObjectsDb,
  data: NewDOObject
): Promise<DOObject> {
  const results = await db
    .insert(objects)
    .values(data)
    .returning()

  return results[0]!
}

/**
 * Get all objects with a specific relation type.
 * Uses the relation index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param relation - The relation type to filter by
 * @returns Array of objects with the specified relation
 *
 * @example
 * ```ts
 * const children = await getObjectsByRelation(db, 'child')
 * console.log(`Found ${children.length} child objects`)
 * ```
 */
export async function getObjectsByRelation(
  db: ObjectsDb,
  relation: ObjectRelationType
): Promise<DOObject[]> {
  return db
    .select()
    .from(objects)
    .where(eq(objects.relation, relation))
}

/**
 * Get all shards for a given shard key.
 * Uses the composite shard index for efficient lookup.
 *
 * @param db - Drizzle database instance
 * @param shardKey - The shard key to look up
 * @returns Array of shard objects
 *
 * @example
 * ```ts
 * const shards = await getShards(db, 'users')
 * console.log(`Found ${shards.length} shards for 'users'`)
 * ```
 */
export async function getShards(
  db: ObjectsDb,
  shardKey: string
): Promise<DOObject[]> {
  return db
    .select()
    .from(objects)
    .where(eq(objects.shardKey, shardKey))
}

/**
 * Get the primary replica for a namespace (geo-replication).
 * Looks up the object and returns it if it's marked as primary.
 *
 * @param db - Drizzle database instance
 * @param ns - The namespace URL to look up
 * @returns The primary replica or undefined if not found or not primary
 *
 * @example
 * ```ts
 * const primary = await getPrimaryReplica(db, 'https://startups.studio')
 * if (primary) {
 *   console.log(`Primary is in region: ${primary.region}`)
 * }
 * ```
 */
export async function getPrimaryReplica(
  db: ObjectsDb,
  ns: string
): Promise<DOObject | undefined> {
  const results = await db
    .select()
    .from(objects)
    .where(eq(objects.ns, ns))

  const obj = results[0]
  if (obj && obj.primary === true) {
    return obj
  }
  return undefined
}
