import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq } from 'drizzle-orm'

// ============================================================================
// OBJECTS - DO-to-DO References (ns → CF DO ID mapping)
// ============================================================================
//
// Maps namespace URLs to Cloudflare Durable Object IDs.
// Used for cross-DO resolution and geo-replication.
//
// ============================================================================

// ============================================================================
// ENUM CONSTANTS
// ============================================================================

/**
 * Valid relation types for DO-to-DO relationships
 */
export const ObjectRelation = {
  parent: 'parent',
  child: 'child',
  follower: 'follower',
  shard: 'shard',
  reference: 'reference',
} as const

export type ObjectRelationType = (typeof ObjectRelation)[keyof typeof ObjectRelation]

// ============================================================================
// TABLE SCHEMA
// ============================================================================

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
 * Type for a selected object record (all fields)
 */
export type DOObject = typeof objects.$inferSelect

/**
 * Type for inserting a new object record
 */
export type NewDOObject = typeof objects.$inferInsert

// ============================================================================
// QUERY HELPER TYPES
// ============================================================================

/**
 * Database interface required for query helpers.
 * This allows the helpers to work with any Drizzle database instance.
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
