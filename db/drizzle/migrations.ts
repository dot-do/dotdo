/**
 * Drizzle migrations for Cloudflare Durable Objects
 *
 * This module exports the migrations for use with the Drizzle migrator.
 * Generated migrations are bundled as text via wrangler's rules config.
 *
 * @see https://orm.drizzle.team/docs/connect-cloudflare-do
 */

import { sql } from 'drizzle-orm'

// Import the generated SQL migration as text
// Wrangler bundler will inline this as a string via the Text rule
import migration0000 from './0000_gray_revanche.sql'
import journal from './meta/_journal.json'

/**
 * Migration entry format expected by drizzle-orm migrator
 */
export interface MigrationEntry {
  sql: string[]
  folderMillis: number
  hash: string
  bps: boolean
}

/**
 * Journal entry from drizzle-kit
 */
interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

/**
 * Parse a SQL migration file into individual statements
 * Drizzle uses --> statement-breakpoint to separate statements
 */
function parseMigration(sqlContent: string): string[] {
  return sqlContent
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Generate a simple hash from the SQL content
 */
function hashSql(sqlContent: string): string {
  let hash = 0
  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

// Map migration files to their tags
const migrationFiles: Record<string, string> = {
  '0000_gray_revanche': migration0000,
}

/**
 * Build migrations array from journal
 */
export const migrations: MigrationEntry[] = (journal.entries as JournalEntry[]).map((entry) => {
  const sqlContent = migrationFiles[entry.tag]
  if (!sqlContent) {
    throw new Error(`Migration file not found for tag: ${entry.tag}`)
  }
  return {
    sql: parseMigration(sqlContent),
    folderMillis: entry.when,
    hash: hashSql(sqlContent),
    bps: entry.breakpoints,
  }
})

/**
 * Run all migrations on the provided SQL interface
 *
 * This is designed for use in DO constructor with blockConcurrencyWhile:
 * ```typescript
 * ctx.blockConcurrencyWhile(async () => {
 *   runMigrations(ctx.storage.sql)
 * })
 * ```
 *
 * @param sqlInterface - The SQL interface from ctx.storage.sql
 */
export function runMigrations(sqlInterface: { exec: (query: string) => unknown }): void {
  // Create migrations tracking table if it doesn't exist
  sqlInterface.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  // Get already applied migrations
  const applied = new Set<string>()
  try {
    const results = sqlInterface.exec('SELECT hash FROM __drizzle_migrations') as { hash: string }[]
    if (Array.isArray(results)) {
      for (const row of results) {
        applied.add(row.hash)
      }
    }
  } catch {
    // Table might be empty or query format differs
  }

  // Apply pending migrations
  for (const migration of migrations) {
    if (applied.has(migration.hash)) {
      continue
    }

    // Execute each statement in the migration
    for (const statement of migration.sql) {
      try {
        sqlInterface.exec(statement)
      } catch (err) {
        console.error(`Migration failed for statement: ${statement.substring(0, 100)}...`, err)
        throw err
      }
    }

    // Record the migration
    sqlInterface.exec(`
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('${migration.hash}', ${Date.now()})
    `)
  }
}
