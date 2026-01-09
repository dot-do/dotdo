/**
 * Migration Template Generation
 *
 * Generates migration file templates for both Things and Drizzle strategies.
 * Each strategy has different available helpers and typical use cases.
 *
 * Things migrations: Data transforms + JSON index operations (no DDL)
 * Drizzle migrations: Schema DDL + data transforms
 *
 * @module @dotdo/payload/migrations/templates
 */

import type { StorageMode } from '../strategies/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Migration file info
 */
export interface MigrationFileInfo {
  /** Full migration name (timestamp_name) */
  name: string
  /** File path */
  path: string
  /** File content */
  content: string
  /** Timestamp extracted from name */
  timestamp: number
}

/**
 * Options for generating a migration template
 */
export interface GenerateMigrationOptions {
  /** Migration name (human readable) */
  name: string
  /** Storage strategy to generate for */
  strategy: StorageMode
  /** Whether to generate a blank template */
  blank?: boolean
  /** Migration directory path */
  migrationDir?: string
}

// ============================================================================
// TIMESTAMP GENERATION
// ============================================================================

/**
 * Generate a timestamp string for migration naming.
 *
 * Format: YYYYMMDD_HHMMSS
 *
 * @returns Timestamp string
 */
export function generateTimestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
}

/**
 * Sanitize a migration name for use in file/variable names.
 *
 * @param name - Raw migration name
 * @returns Sanitized name
 */
export function sanitizeMigrationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/**
 * Parse timestamp from a migration name.
 *
 * @param name - Migration name (e.g., '20260109_120000_add_posts')
 * @returns Timestamp as number, or 0 if parsing fails
 */
export function parseTimestampFromName(name: string): number {
  const match = name.match(/^(\d{8}_\d{6})/)
  if (!match) return 0

  const ts = match[1]
  // Convert YYYYMMDD_HHMMSS to epoch-ish number for sorting
  const year = parseInt(ts.slice(0, 4), 10)
  const month = parseInt(ts.slice(4, 6), 10)
  const day = parseInt(ts.slice(6, 8), 10)
  const hour = parseInt(ts.slice(9, 11), 10)
  const minute = parseInt(ts.slice(11, 13), 10)
  const second = parseInt(ts.slice(13, 15), 10)

  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

// ============================================================================
// THINGS MODE TEMPLATE
// ============================================================================

/**
 * Generate a migration template for Things mode.
 *
 * Things mode migrations support:
 * - JSON index operations (createJsonIndex, dropJsonIndex)
 * - Data transforms via Payload API
 * - Bulk update helpers
 *
 * @param name - Migration name
 * @param blank - Whether to generate blank template
 * @returns Migration file content
 */
export function generateThingsMigrationTemplate(name: string, blank = false): string {
  const timestamp = Date.now()

  if (blank) {
    return `import type { MigrateUpArgs, MigrateDownArgs } from '@dotdo/payload';

/**
 * Migration: ${name}
 * Strategy: Things (MongoDB-style)
 * Created: ${new Date().toISOString()}
 */

export async function up({ payload, req, session, helpers }: MigrateUpArgs): Promise<void> {
  // Add your migration logic here
}

export async function down({ payload, req, session, helpers }: MigrateDownArgs): Promise<void> {
  // Add rollback logic here
}

export const migration = {
  name: '${name}',
  timestamp: ${timestamp},
  up,
  down,
};
`
  }

  return `import type { MigrateUpArgs, MigrateDownArgs } from '@dotdo/payload';

/**
 * Migration: ${name}
 * Strategy: Things (MongoDB-style)
 * Created: ${new Date().toISOString()}
 *
 * Things migrations support:
 * - JSON index operations via helpers.createJsonIndex / dropJsonIndex
 * - Data transforms via payload.find / payload.update
 * - Bulk operations via helpers.bulkUpdateData
 *
 * Note: No DDL schema changes - data structure changes "just work"
 */

export async function up({ payload, req, session, helpers }: MigrateUpArgs): Promise<void> {
  const { createJsonIndex, bulkUpdateData } = helpers;

  // Example: Create JSON index on a field for better query performance
  // await createJsonIndex({ collection: 'posts', path: 'publishedAt' });
  // await createJsonIndex({ collection: 'posts', path: 'author.name' });

  // Example: Data transform using Payload API
  // const posts = await payload.find({ collection: 'posts', limit: 10000 });
  // for (const post of posts.docs) {
  //   await payload.update({
  //     collection: 'posts',
  //     id: post.id,
  //     data: { newField: 'default value' },
  //   });
  // }

  // Example: Bulk update with transform function
  // await bulkUpdateData({
  //   collection: 'posts',
  //   where: { status: { equals: 'draft' } },
  //   transform: (doc) => ({ ...doc, publishedAt: null }),
  // });
}

export async function down({ payload, req, session, helpers }: MigrateDownArgs): Promise<void> {
  const { dropJsonIndex, bulkUpdateData } = helpers;

  // Example: Drop JSON index
  // await dropJsonIndex({ collection: 'posts', path: 'publishedAt' });

  // Example: Reverse data transform
  // await bulkUpdateData({
  //   collection: 'posts',
  //   where: {},
  //   transform: (doc) => {
  //     const { newField, ...rest } = doc;
  //     return rest;
  //   },
  // });
}

export const migration = {
  name: '${name}',
  timestamp: ${timestamp},
  up,
  down,
};
`
}

// ============================================================================
// DRIZZLE MODE TEMPLATE
// ============================================================================

/**
 * Generate a migration template for Drizzle mode.
 *
 * Drizzle mode migrations support:
 * - Raw SQL execution
 * - Schema DDL changes
 * - Data transforms
 *
 * @param name - Migration name
 * @param blank - Whether to generate blank template
 * @returns Migration file content
 */
export function generateDrizzleMigrationTemplate(name: string, blank = false): string {
  const timestamp = Date.now()

  if (blank) {
    return `import type { MigrateUpArgs, MigrateDownArgs } from '@dotdo/payload';

/**
 * Migration: ${name}
 * Strategy: Drizzle (SQL-style)
 * Created: ${new Date().toISOString()}
 */

export async function up({ payload, req, session, execute }: MigrateUpArgs): Promise<void> {
  // Add your schema changes here
}

export async function down({ payload, req, session, execute }: MigrateDownArgs): Promise<void> {
  // Add rollback logic here
}

export const migration = {
  name: '${name}',
  timestamp: ${timestamp},
  up,
  down,
};
`
  }

  return `import type { MigrateUpArgs, MigrateDownArgs } from '@dotdo/payload';

/**
 * Migration: ${name}
 * Strategy: Drizzle (SQL-style)
 * Created: ${new Date().toISOString()}
 *
 * Drizzle migrations support:
 * - Raw SQL execution via execute()
 * - Schema DDL changes (CREATE TABLE, ALTER TABLE, etc.)
 * - Data transforms via SQL or Payload API
 */

export async function up({ payload, req, session, execute }: MigrateUpArgs): Promise<void> {
  // Example: Add a new column
  // await execute(\`ALTER TABLE posts ADD COLUMN published_at TEXT\`);

  // Example: Create an index
  // await execute(\`CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at)\`);

  // Example: Data migration
  // await execute(\`UPDATE posts SET published_at = created_at WHERE published_at IS NULL\`);

  // Example: Create a new table
  // await execute(\`
  //   CREATE TABLE IF NOT EXISTS post_tags (
  //     id TEXT PRIMARY KEY,
  //     post_id TEXT NOT NULL REFERENCES posts(id),
  //     tag TEXT NOT NULL,
  //     created_at TEXT NOT NULL
  //   )
  // \`);
}

export async function down({ payload, req, session, execute }: MigrateDownArgs): Promise<void> {
  // Example: Drop the column (SQLite doesn't support DROP COLUMN easily)
  // You may need to recreate the table without the column
  // await execute(\`
  //   CREATE TABLE posts_new AS SELECT id, title, content, created_at FROM posts;
  //   DROP TABLE posts;
  //   ALTER TABLE posts_new RENAME TO posts;
  // \`);

  // Example: Drop index
  // await execute(\`DROP INDEX IF EXISTS idx_posts_published_at\`);

  // Example: Drop table
  // await execute(\`DROP TABLE IF EXISTS post_tags\`);
}

export const migration = {
  name: '${name}',
  timestamp: ${timestamp},
  up,
  down,
};
`
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate a migration file.
 *
 * @param options - Generation options
 * @returns Migration file info
 */
export function generateMigration(options: GenerateMigrationOptions): MigrationFileInfo {
  const { name, strategy, blank = false, migrationDir = './src/migrations' } = options

  // Generate filename
  const timestamp = generateTimestamp()
  const sanitizedName = sanitizeMigrationName(name)
  const fullName = `${timestamp}_${sanitizedName}`
  const path = `${migrationDir}/${fullName}.ts`

  // Generate content based on strategy
  const content = strategy === 'things'
    ? generateThingsMigrationTemplate(fullName, blank)
    : generateDrizzleMigrationTemplate(fullName, blank)

  // Parse timestamp for sorting
  const timestampNum = parseTimestampFromName(fullName)

  return {
    name: fullName,
    path,
    content,
    timestamp: timestampNum,
  }
}

/**
 * Generate a migration template string for the given strategy.
 *
 * @param strategy - Storage strategy
 * @param name - Migration name
 * @param blank - Whether to generate blank template
 * @returns Template string
 */
export function generateMigrationTemplate(
  strategy: StorageMode,
  name: string,
  blank = false
): string {
  return strategy === 'things'
    ? generateThingsMigrationTemplate(name, blank)
    : generateDrizzleMigrationTemplate(name, blank)
}
