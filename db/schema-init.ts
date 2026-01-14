/**
 * Schema Initialization - CREATE TABLE statements for DO SQLite
 *
 * Drizzle doesn't auto-create tables in Cloudflare DO SQLite.
 * These SQL statements must be executed on DO startup.
 *
 * @see https://orm.drizzle.team/docs/connect-cloudflare-do
 */

/**
 * Core schema SQL statements - each executed separately
 * Uses IF NOT EXISTS for idempotency
 */
const SCHEMA_STATEMENTS = [
  // Nouns: Type registry
  `CREATE TABLE IF NOT EXISTS nouns (
    noun TEXT PRIMARY KEY,
    plural TEXT,
    description TEXT,
    schema TEXT,
    do_class TEXT
  )`,

  // Things: Versioned entity storage
  `CREATE TABLE IF NOT EXISTS things (
    id TEXT NOT NULL,
    type INTEGER NOT NULL,
    branch TEXT,
    name TEXT,
    data TEXT,
    deleted INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'user'
  )`,
  `CREATE INDEX IF NOT EXISTS things_id_idx ON things(id)`,
  `CREATE INDEX IF NOT EXISTS things_type_idx ON things(type)`,
  `CREATE INDEX IF NOT EXISTS things_branch_idx ON things(branch)`,
  `CREATE INDEX IF NOT EXISTS things_id_branch_idx ON things(id, branch)`,
  `CREATE INDEX IF NOT EXISTS things_visibility_idx ON things(visibility)`,

  // Relationships: Graph edges
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    data TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rel_verb_idx ON relationships(verb)`,
  `CREATE INDEX IF NOT EXISTS rel_from_idx ON relationships("from")`,
  `CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships("to")`,

  // Objects: DO-to-DO references
  `CREATE TABLE IF NOT EXISTS objects (
    ns TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    class TEXT NOT NULL,
    relation TEXT,
    shard_key TEXT,
    shard_index INTEGER,
    region TEXT,
    "primary" INTEGER,
    cached TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS obj_id_idx ON objects(id)`,

  // Actions: Audit log
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    noun TEXT NOT NULL,
    input TEXT,
    output TEXT,
    actor TEXT,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS actions_verb_idx ON actions(verb)`,
  `CREATE INDEX IF NOT EXISTS actions_noun_idx ON actions(noun)`,

  // Events: Event sourcing log
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source TEXT,
    data TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_type_idx ON events(type)`,
]

/**
 * Initialize core schema in DO SQLite storage
 * Call this in DO constructor: initSchema(ctx.storage.sql)
 */
export function initSchema(sql: { exec: (query: string) => unknown }): void {
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      sql.exec(statement)
    } catch (err) {
      console.error(`Schema init failed for: ${statement.substring(0, 50)}...`, err)
      throw err
    }
  }
}
