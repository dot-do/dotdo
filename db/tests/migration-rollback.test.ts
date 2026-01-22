/**
 * Migration Rollback Tests
 *
 * Comprehensive tests for database migration rollback functionality.
 * Tests cover:
 * 1. Basic rollback behavior
 * 2. Multi-step rollback
 * 3. Data integrity after rollback
 * 4. Index rollback
 * 5. Foreign key constraint rollback
 * 6. Partial data migration rollback
 * 7. Migration version tracking
 * 8. Rollback logging
 * 9. State consistency
 *
 * Uses mock SQLStorage that tracks table/index state for rollback verification.
 *
 * @module db/tests/migration-rollback.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MigrationRunner,
  createMigration,
  type Migration,
} from '../migrations'

// ============================================================================
// ENHANCED MOCK SQL STORAGE
// ============================================================================

interface TableInfo {
  name: string
  columns: Map<string, string> // column name -> type
  data: Array<Record<string, unknown>>
}

interface IndexInfo {
  name: string
  table: string
  columns: string[]
}

/**
 * Creates an enhanced mock SQL storage that tracks:
 * - Tables and their columns
 * - Indexes
 * - Data in tables
 * - Migration state
 * - All executed SQL statements (for logging/debugging)
 */
function createEnhancedMockSqlStorage() {
  const state = {
    tables: new Map<string, TableInfo>(),
    indexes: new Map<string, IndexInfo>(),
    _migrations: [] as Array<{ version: number; name: string; applied_at: number }>,
    _execLog: [] as string[],
  }

  const storage = {
    // Expose state for testing
    getState: () => state,

    // Check if table exists
    hasTable: (name: string) => state.tables.has(name),

    // Check if index exists
    hasIndex: (name: string) => state.indexes.has(name),

    // Get table data
    getTableData: (name: string) => state.tables.get(name)?.data || [],

    // Get table columns
    getTableColumns: (name: string) => state.tables.get(name)?.columns || new Map(),

    // Get execution log
    getExecLog: () => [...state._execLog],

    // Clear execution log
    clearExecLog: () => {
      state._execLog.length = 0
    },

    exec(sql: string): { results: Array<Record<string, unknown>> } {
      state._execLog.push(sql)

      // Handle CREATE TABLE
      const createTableMatches = sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([^)]+)\)/gi)
      for (const match of createTableMatches) {
        const [, tableName, columnDefs] = match
        const columns = new Map<string, string>()

        // Parse column definitions
        const colDefs = columnDefs.split(',').map(c => c.trim())
        for (const colDef of colDefs) {
          const parts = colDef.split(/\s+/)
          if (parts.length >= 2 && !parts[0].toUpperCase().startsWith('PRIMARY') && !parts[0].toUpperCase().startsWith('FOREIGN')) {
            columns.set(parts[0], parts[1])
          }
        }

        if (!state.tables.has(tableName)) {
          state.tables.set(tableName, {
            name: tableName,
            columns,
            data: [],
          })
        }
      }

      // Handle DROP TABLE
      const dropTableMatches = sql.matchAll(/DROP TABLE(?: IF EXISTS)?\s+(\w+)/gi)
      for (const match of dropTableMatches) {
        const [, tableName] = match
        state.tables.delete(tableName)

        // Also remove any indexes on this table
        for (const [indexName, indexInfo] of state.indexes) {
          if (indexInfo.table === tableName) {
            state.indexes.delete(indexName)
          }
        }
      }

      // Handle CREATE INDEX
      const createIndexMatches = sql.matchAll(/CREATE INDEX(?: IF NOT EXISTS)?\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/gi)
      for (const match of createIndexMatches) {
        const [, indexName, tableName, columnList] = match
        const columns = columnList.split(',').map(c => c.trim())

        state.indexes.set(indexName, {
          name: indexName,
          table: tableName,
          columns,
        })
      }

      // Handle DROP INDEX
      const dropIndexMatches = sql.matchAll(/DROP INDEX(?: IF EXISTS)?\s+(\w+)/gi)
      for (const match of dropIndexMatches) {
        const [, indexName] = match
        state.indexes.delete(indexName)
      }

      // Handle ALTER TABLE ADD COLUMN
      const alterAddMatches = sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\s+(\w+)/gi)
      for (const match of alterAddMatches) {
        const [, tableName, columnName, columnType] = match
        const table = state.tables.get(tableName)
        if (table) {
          table.columns.set(columnName, columnType)
        }
      }

      // Handle ALTER TABLE DROP COLUMN
      const alterDropMatches = sql.matchAll(/ALTER TABLE\s+(\w+)\s+DROP COLUMN\s+(\w+)/gi)
      for (const match of alterDropMatches) {
        const [, tableName, columnName] = match
        const table = state.tables.get(tableName)
        if (table) {
          table.columns.delete(columnName)
          // Also remove the column from existing data
          for (const row of table.data) {
            delete row[columnName]
          }
        }
      }

      // Handle INSERT (for data migrations) - support multiple INSERTs in one exec
      const insertMatches = sql.matchAll(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi)
      for (const insertMatch of insertMatches) {
        const [, tableName, columns, values] = insertMatch
        const table = state.tables.get(tableName)
        if (table) {
          const colNames = columns.split(',').map(c => c.trim())
          const valArray = values.split(',').map(v => {
            const trimmed = v.trim()
            // Parse string values (remove quotes)
            if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
              return trimmed.slice(1, -1)
            }
            // Parse numbers
            if (!isNaN(Number(trimmed))) {
              return Number(trimmed)
            }
            return trimmed
          })

          const row: Record<string, unknown> = {}
          colNames.forEach((col, idx) => {
            row[col] = valArray[idx]
          })
          table.data.push(row)
        }
      }

      // Handle DELETE
      const deleteMatch = sql.match(/DELETE FROM\s+(\w+)/i)
      if (deleteMatch) {
        const [, tableName] = deleteMatch
        const table = state.tables.get(tableName)
        if (table) {
          // For simplicity, DELETE without WHERE clears all data
          if (!sql.toLowerCase().includes('where')) {
            table.data.length = 0
          }
        }
      }

      return { results: [] }
    },

    prepare(sql: string) {
      let boundValues: unknown[] = []

      return {
        bind(...values: unknown[]) {
          boundValues = values
          return {
            async first(): Promise<Record<string, unknown> | null> {
              // Query _migrations table
              if (sql.includes('FROM _migrations')) {
                if (sql.includes('ORDER BY version DESC LIMIT 1')) {
                  const sorted = [...state._migrations].sort((a, b) => b.version - a.version)
                  return sorted[0] || null
                }
                if (sql.includes('WHERE version = ?')) {
                  const version = boundValues[0] as number
                  return state._migrations.find((m) => m.version === version) || null
                }
              }
              return null
            },

            async all(): Promise<{ results: Array<Record<string, unknown>> }> {
              if (sql.includes('FROM _migrations')) {
                if (sql.includes('ORDER BY version ASC')) {
                  const sorted = [...state._migrations].sort((a, b) => a.version - b.version)
                  return { results: sorted }
                }
                return { results: state._migrations }
              }
              return { results: [] }
            },

            async run(): Promise<void> {
              // INSERT into _migrations
              if (sql.includes('INSERT INTO _migrations')) {
                const [version, name, applied_at] = boundValues as [number, string, number]
                state._migrations.push({ version, name, applied_at })
              }

              // DELETE from _migrations
              if (sql.includes('DELETE FROM _migrations WHERE version = ?')) {
                const version = boundValues[0] as number
                const index = state._migrations.findIndex((m) => m.version === version)
                if (index !== -1) {
                  state._migrations.splice(index, 1)
                }
              }
            },
          }
        },
      }
    },
  }

  return storage
}

type EnhancedMockSqlStorage = ReturnType<typeof createEnhancedMockSqlStorage>

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Migration Rollback', () => {
  let sql: EnhancedMockSqlStorage
  let runner: MigrationRunner

  beforeEach(() => {
    sql = createEnhancedMockSqlStorage()
    runner = new MigrationRunner(sql as any)
  })

  describe('Basic Rollback', () => {
    it('should rollback migration on failure', async () => {
      await runner.initialize()

      // Create a migration that we can fully rollback
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users_table',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)',
          down: 'DROP TABLE IF EXISTS users',
        }),
      ]

      // Apply migration
      const applyResult = await runner.runMigrations(migrations)
      expect(applyResult.applied).toBe(1)
      expect(sql.hasTable('users')).toBe(true)

      // Verify migration is tracked
      const appliedMigrations = await runner.getAppliedMigrations()
      expect(appliedMigrations).toHaveLength(1)
      expect(appliedMigrations[0].version).toBe(1)

      // Rollback the migration
      const rollbackResult = await runner.rollback(migrations)
      expect(rollbackResult.rolledBack).toBe(1)
      expect(rollbackResult.version).toBe(1)

      // Verify table is dropped
      expect(sql.hasTable('users')).toBe(false)

      // Verify migration is no longer tracked
      const afterRollback = await runner.getAppliedMigrations()
      expect(afterRollback).toHaveLength(0)
    })

    it('should verify state is rolled back to before migration', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_orders_table',
          up: `
            CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, total INTEGER);
            CREATE INDEX IF NOT EXISTS idx_orders_total ON orders(total);
          `,
          down: `
            DROP INDEX IF EXISTS idx_orders_total;
            DROP TABLE IF EXISTS orders;
          `,
        }),
      ]

      // Verify initial state - no orders table or index
      expect(sql.hasTable('orders')).toBe(false)
      expect(sql.hasIndex('idx_orders_total')).toBe(false)

      // Apply migration
      await runner.runMigrations(migrations)
      expect(sql.hasTable('orders')).toBe(true)
      expect(sql.hasIndex('idx_orders_total')).toBe(true)

      // Rollback
      await runner.rollback(migrations)

      // Verify state is back to initial
      expect(sql.hasTable('orders')).toBe(false)
      expect(sql.hasIndex('idx_orders_total')).toBe(false)
      expect(await runner.getCurrentVersion()).toBe(0)
    })
  })

  describe('Multi-Step Rollback', () => {
    it('should rollback multiple migration steps', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT)',
          down: 'DROP TABLE IF EXISTS posts',
        }),
        createMigration({
          version: 3,
          name: 'create_comments',
          up: 'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT)',
          down: 'DROP TABLE IF EXISTS comments',
        }),
      ]

      // Apply all 3 migrations
      const applyResult = await runner.runMigrations(migrations)
      expect(applyResult.applied).toBe(3)
      expect(sql.hasTable('users')).toBe(true)
      expect(sql.hasTable('posts')).toBe(true)
      expect(sql.hasTable('comments')).toBe(true)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Rollback to version 0 (all migrations)
      const rollbackResult = await runner.rollbackTo(0, migrations)
      expect(rollbackResult.rolledBack).toBe(3)

      // Verify all tables are dropped
      expect(sql.hasTable('users')).toBe(false)
      expect(sql.hasTable('posts')).toBe(false)
      expect(sql.hasTable('comments')).toBe(false)
      expect(await runner.getCurrentVersion()).toBe(0)
    })

    it('should rollback to specific version', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS posts',
        }),
        createMigration({
          version: 3,
          name: 'create_comments',
          up: 'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS comments',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Rollback to version 1 (should remove versions 2 and 3)
      const rollbackResult = await runner.rollbackTo(1, migrations)
      expect(rollbackResult.rolledBack).toBe(2)

      // users should still exist, posts and comments should be gone
      expect(sql.hasTable('users')).toBe(true)
      expect(sql.hasTable('posts')).toBe(false)
      expect(sql.hasTable('comments')).toBe(false)
      expect(await runner.getCurrentVersion()).toBe(1)
    })

    it('should rollback one at a time with multiple calls', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_a',
          up: 'CREATE TABLE IF NOT EXISTS table_a (id TEXT)',
          down: 'DROP TABLE IF EXISTS table_a',
        }),
        createMigration({
          version: 2,
          name: 'create_b',
          up: 'CREATE TABLE IF NOT EXISTS table_b (id TEXT)',
          down: 'DROP TABLE IF EXISTS table_b',
        }),
        createMigration({
          version: 3,
          name: 'create_c',
          up: 'CREATE TABLE IF NOT EXISTS table_c (id TEXT)',
          down: 'DROP TABLE IF EXISTS table_c',
        }),
      ]

      await runner.runMigrations(migrations)

      // Rollback one at a time
      let result = await runner.rollback(migrations)
      expect(result.version).toBe(3)
      expect(sql.hasTable('table_c')).toBe(false)
      expect(sql.hasTable('table_b')).toBe(true)
      expect(await runner.getCurrentVersion()).toBe(2)

      result = await runner.rollback(migrations)
      expect(result.version).toBe(2)
      expect(sql.hasTable('table_b')).toBe(false)
      expect(sql.hasTable('table_a')).toBe(true)
      expect(await runner.getCurrentVersion()).toBe(1)

      result = await runner.rollback(migrations)
      expect(result.version).toBe(1)
      expect(sql.hasTable('table_a')).toBe(false)
      expect(await runner.getCurrentVersion()).toBe(0)
    })
  })

  describe('Data Integrity After Rollback', () => {
    it('should preserve data in tables not affected by rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_config',
          up: `
            CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO config (key, value) VALUES ('app_name', 'MyApp');
            INSERT INTO config (key, value) VALUES ('version', '1.0.0');
          `,
          down: 'DROP TABLE IF EXISTS config',
        }),
        createMigration({
          version: 2,
          name: 'create_logs',
          up: 'CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, message TEXT)',
          down: 'DROP TABLE IF EXISTS logs',
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify config data exists
      const configData = sql.getTableData('config')
      expect(configData).toHaveLength(2)
      expect(configData.some(r => r.key === 'app_name')).toBe(true)

      // Rollback only the logs migration
      await runner.rollback(migrations)

      // Config table and data should still exist
      expect(sql.hasTable('config')).toBe(true)
      expect(sql.hasTable('logs')).toBe(false)

      const remainingConfigData = sql.getTableData('config')
      expect(remainingConfigData).toHaveLength(2)
    })

    it('should properly clean up data when rolling back data migrations', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_settings',
          up: 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
          down: 'DROP TABLE IF EXISTS settings',
        }),
        createMigration({
          version: 2,
          name: 'seed_default_settings',
          up: `
            INSERT INTO settings (key, value) VALUES ('theme', 'dark');
            INSERT INTO settings (key, value) VALUES ('language', 'en');
          `,
          down: 'DELETE FROM settings',
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify data was inserted
      let settingsData = sql.getTableData('settings')
      expect(settingsData).toHaveLength(2)

      // Rollback the seed migration
      await runner.rollback(migrations)

      // Table should exist but data should be gone
      expect(sql.hasTable('settings')).toBe(true)
      settingsData = sql.getTableData('settings')
      expect(settingsData).toHaveLength(0)
    })
  })

  describe('Index Rollback', () => {
    it('should rollback index creation', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_products',
          up: 'CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, price INTEGER)',
          down: 'DROP TABLE IF EXISTS products',
        }),
        createMigration({
          version: 2,
          name: 'add_products_indexes',
          up: `
            CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
            CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
          `,
          down: `
            DROP INDEX IF EXISTS idx_products_price;
            DROP INDEX IF EXISTS idx_products_name;
          `,
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify indexes exist
      expect(sql.hasIndex('idx_products_name')).toBe(true)
      expect(sql.hasIndex('idx_products_price')).toBe(true)

      // Rollback index migration
      await runner.rollback(migrations)

      // Indexes should be gone, but table should remain
      expect(sql.hasIndex('idx_products_name')).toBe(false)
      expect(sql.hasIndex('idx_products_price')).toBe(false)
      expect(sql.hasTable('products')).toBe(true)
    })

    it('should rollback composite index', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_order_items',
          up: 'CREATE TABLE IF NOT EXISTS order_items (order_id TEXT, product_id TEXT, quantity INTEGER)',
          down: 'DROP TABLE IF EXISTS order_items',
        }),
        createMigration({
          version: 2,
          name: 'add_composite_index',
          up: 'CREATE INDEX IF NOT EXISTS idx_order_items_composite ON order_items(order_id, product_id)',
          down: 'DROP INDEX IF EXISTS idx_order_items_composite',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(sql.hasIndex('idx_order_items_composite')).toBe(true)

      await runner.rollback(migrations)
      expect(sql.hasIndex('idx_order_items_composite')).toBe(false)
      expect(sql.hasTable('order_items')).toBe(true)
    })
  })

  describe('Foreign Key Constraint Rollback', () => {
    it('should rollback foreign key constraint migration', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_departments',
          up: 'CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT)',
          down: 'DROP TABLE IF EXISTS departments',
        }),
        createMigration({
          version: 2,
          name: 'create_employees_with_fk',
          up: `
            CREATE TABLE IF NOT EXISTS employees (
              id TEXT PRIMARY KEY,
              name TEXT,
              department_id TEXT,
              FOREIGN KEY (department_id) REFERENCES departments(id)
            )
          `,
          down: 'DROP TABLE IF EXISTS employees',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(sql.hasTable('departments')).toBe(true)
      expect(sql.hasTable('employees')).toBe(true)

      // Rollback employees table (with FK)
      await runner.rollback(migrations)
      expect(sql.hasTable('employees')).toBe(false)
      expect(sql.hasTable('departments')).toBe(true)

      // Should be able to continue and rollback departments
      await runner.rollback(migrations)
      expect(sql.hasTable('departments')).toBe(false)
    })

    it('should handle rollback of table referenced by foreign key', async () => {
      await runner.initialize()

      // In this scenario, we need to rollback in the correct order
      // (child table first, then parent table)
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_categories',
          up: 'CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT)',
          down: 'DROP TABLE IF EXISTS categories',
        }),
        createMigration({
          version: 2,
          name: 'create_products_with_fk',
          up: `
            CREATE TABLE IF NOT EXISTS products (
              id TEXT PRIMARY KEY,
              name TEXT,
              category_id TEXT,
              FOREIGN KEY (category_id) REFERENCES categories(id)
            )
          `,
          down: 'DROP TABLE IF EXISTS products',
        }),
      ]

      await runner.runMigrations(migrations)

      // Rollback to version 0 - should handle FK correctly
      const result = await runner.rollbackTo(0, migrations)
      expect(result.rolledBack).toBe(2)
      expect(sql.hasTable('products')).toBe(false)
      expect(sql.hasTable('categories')).toBe(false)
    })
  })

  describe('Partial Data Migration Rollback', () => {
    it('should handle rollback of column addition', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'add_email_column',
          up: 'ALTER TABLE users ADD COLUMN email TEXT',
          down: 'ALTER TABLE users DROP COLUMN email',
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify email column was added
      const columns = sql.getTableColumns('users')
      expect(columns.has('email')).toBe(true)

      // Rollback column addition
      await runner.rollback(migrations)

      // Email column should be gone
      const updatedColumns = sql.getTableColumns('users')
      expect(updatedColumns.has('email')).toBe(false)
      expect(updatedColumns.has('id')).toBe(true)
      expect(updatedColumns.has('name')).toBe(true)
    })

    it('should handle rollback of multiple column additions', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_profiles',
          up: 'CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS profiles',
        }),
        createMigration({
          version: 2,
          name: 'add_bio',
          up: 'ALTER TABLE profiles ADD COLUMN bio TEXT',
          down: 'ALTER TABLE profiles DROP COLUMN bio',
        }),
        createMigration({
          version: 3,
          name: 'add_avatar',
          up: 'ALTER TABLE profiles ADD COLUMN avatar TEXT',
          down: 'ALTER TABLE profiles DROP COLUMN avatar',
        }),
      ]

      await runner.runMigrations(migrations)

      let columns = sql.getTableColumns('profiles')
      expect(columns.has('bio')).toBe(true)
      expect(columns.has('avatar')).toBe(true)

      // Rollback avatar
      await runner.rollback(migrations)
      columns = sql.getTableColumns('profiles')
      expect(columns.has('avatar')).toBe(false)
      expect(columns.has('bio')).toBe(true)

      // Rollback bio
      await runner.rollback(migrations)
      columns = sql.getTableColumns('profiles')
      expect(columns.has('bio')).toBe(false)
      expect(columns.has('id')).toBe(true)
    })
  })

  describe('Migration Version Tracking', () => {
    it('should track migration versions correctly during apply and rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)', down: 'DROP TABLE IF EXISTS t2' }),
        createMigration({ version: 3, name: 'v3', up: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)', down: 'DROP TABLE IF EXISTS t3' }),
      ]

      // Initial state
      expect(await runner.getCurrentVersion()).toBe(0)
      expect(await runner.getAppliedMigrations()).toHaveLength(0)

      // Apply v1
      await runner.runMigrations([migrations[0]])
      expect(await runner.getCurrentVersion()).toBe(1)
      let applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(1)
      expect(applied[0].name).toBe('v1')

      // Apply v2 and v3
      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)
      applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(3)

      // Rollback v3
      await runner.rollback(migrations)
      expect(await runner.getCurrentVersion()).toBe(2)
      applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(2)
      expect(applied.every(m => m.version <= 2)).toBe(true)

      // Rollback to v0
      await runner.rollbackTo(0, migrations)
      expect(await runner.getCurrentVersion()).toBe(0)
      expect(await runner.getAppliedMigrations()).toHaveLength(0)
    })

    it('should correctly report pending migrations after rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)', down: 'DROP TABLE IF EXISTS t2' }),
        createMigration({ version: 3, name: 'v3', up: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)', down: 'DROP TABLE IF EXISTS t3' }),
      ]

      // Apply all
      await runner.runMigrations(migrations)
      let pending = await runner.getPendingMigrations(migrations)
      expect(pending).toHaveLength(0)

      // Rollback to v1
      await runner.rollbackTo(1, migrations)
      pending = await runner.getPendingMigrations(migrations)
      expect(pending).toHaveLength(2)
      expect(pending[0].version).toBe(2)
      expect(pending[1].version).toBe(3)
    })

    it('should track applied_at timestamps', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
      ]

      const beforeApply = Date.now()
      await runner.runMigrations(migrations)
      const afterApply = Date.now()

      const applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(1)
      expect(applied[0].applied_at).toBeGreaterThanOrEqual(beforeApply)
      expect(applied[0].applied_at).toBeLessThanOrEqual(afterApply)
    })
  })

  describe('Rollback Logging', () => {
    it('should log SQL statements during rollback', async () => {
      await runner.initialize()
      sql.clearExecLog()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_audit',
          up: `
            CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY);
            CREATE INDEX IF NOT EXISTS idx_audit_id ON audit(id);
          `,
          down: `
            DROP INDEX IF EXISTS idx_audit_id;
            DROP TABLE IF EXISTS audit;
          `,
        }),
      ]

      await runner.runMigrations(migrations)
      sql.clearExecLog()

      // Perform rollback
      await runner.rollback(migrations)

      // Check that rollback SQL was logged
      const log = sql.getExecLog()
      expect(log.length).toBeGreaterThan(0)
      expect(log.some(sql => sql.includes('DROP INDEX IF EXISTS idx_audit_id'))).toBe(true)
      expect(log.some(sql => sql.includes('DROP TABLE IF EXISTS audit'))).toBe(true)
    })

    it('should log each migration rollback in multi-step rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)', down: 'DROP TABLE IF EXISTS t2' }),
        createMigration({ version: 3, name: 'v3', up: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)', down: 'DROP TABLE IF EXISTS t3' }),
      ]

      await runner.runMigrations(migrations)
      sql.clearExecLog()

      await runner.rollbackTo(0, migrations)

      const log = sql.getExecLog()
      expect(log.some(sql => sql.includes('DROP TABLE IF EXISTS t3'))).toBe(true)
      expect(log.some(sql => sql.includes('DROP TABLE IF EXISTS t2'))).toBe(true)
      expect(log.some(sql => sql.includes('DROP TABLE IF EXISTS t1'))).toBe(true)
    })
  })

  describe('State Consistency', () => {
    it('should maintain consistent state after failed rollback attempt', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'has_rollback',
          up: 'CREATE TABLE IF NOT EXISTS good_table (id TEXT)',
          down: 'DROP TABLE IF EXISTS good_table',
        }),
        createMigration({
          version: 2,
          name: 'no_rollback',
          up: 'CREATE TABLE IF NOT EXISTS another_table (id TEXT)',
          // No down migration
        }),
      ]

      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(2)

      // Attempt rollback - should fail because v2 has no down migration
      await expect(runner.rollback(migrations)).rejects.toThrow('does not support rollback')

      // State should be unchanged
      expect(await runner.getCurrentVersion()).toBe(2)
      expect(sql.hasTable('good_table')).toBe(true)
      expect(sql.hasTable('another_table')).toBe(true)
    })

    it('should handle rollback when no migrations have been applied', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'unused',
          up: 'CREATE TABLE IF NOT EXISTS t (id TEXT)',
          down: 'DROP TABLE IF EXISTS t',
        }),
      ]

      // No migrations applied
      expect(await runner.getCurrentVersion()).toBe(0)

      // Rollback should be a no-op
      const result = await runner.rollback(migrations)
      expect(result.rolledBack).toBe(0)
      expect(result.version).toBeNull()
    })

    it('should handle rollbackTo with target higher than current version', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)', down: 'DROP TABLE IF EXISTS t2' }),
      ]

      await runner.runMigrations([migrations[0]]) // Only apply v1
      expect(await runner.getCurrentVersion()).toBe(1)

      // Try to rollback to v2 (which is higher than current v1)
      const result = await runner.rollbackTo(2, migrations)
      expect(result.rolledBack).toBe(0)
      expect(await runner.getCurrentVersion()).toBe(1)
    })

    it('should maintain idempotency when running migrations after rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_items',
          up: 'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT)',
          down: 'DROP TABLE IF EXISTS items',
        }),
      ]

      // Apply -> Rollback -> Apply cycle
      await runner.runMigrations(migrations)
      expect(sql.hasTable('items')).toBe(true)

      await runner.rollback(migrations)
      expect(sql.hasTable('items')).toBe(false)

      await runner.runMigrations(migrations)
      expect(sql.hasTable('items')).toBe(true)

      // Should only have 1 migration tracked
      const applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(1)
    })

    it('should handle re-applying migrations after partial rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)', down: 'DROP TABLE IF EXISTS t2' }),
        createMigration({ version: 3, name: 'v3', up: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)', down: 'DROP TABLE IF EXISTS t3' }),
      ]

      // Apply all
      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Rollback to v1
      await runner.rollbackTo(1, migrations)
      expect(await runner.getCurrentVersion()).toBe(1)
      expect(sql.hasTable('t1')).toBe(true)
      expect(sql.hasTable('t2')).toBe(false)
      expect(sql.hasTable('t3')).toBe(false)

      // Re-apply all - should skip v1 and apply v2, v3
      const result = await runner.runMigrations(migrations)
      expect(result.applied).toBe(2)
      expect(result.skipped).toBe(1)
      expect(await runner.getCurrentVersion()).toBe(3)
      expect(sql.hasTable('t1')).toBe(true)
      expect(sql.hasTable('t2')).toBe(true)
      expect(sql.hasTable('t3')).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should throw error when migration not found for rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)', down: 'DROP TABLE IF EXISTS t1' }),
      ]

      await runner.runMigrations(migrations)

      // Try to rollback with wrong migrations list
      const wrongMigrations: Migration[] = [
        createMigration({ version: 2, name: 'v2', up: 'SELECT 1', down: 'SELECT 1' }),
      ]

      await expect(runner.rollback(wrongMigrations)).rejects.toThrow('Migration for version 1 not found')
    })

    it('should throw error when migration has no down SQL', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'no_down',
          up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)',
          // No down property
        }),
      ]

      await runner.runMigrations(migrations)

      await expect(runner.rollback(migrations)).rejects.toThrow('does not support rollback')
    })
  })

  // ============================================================================
  // CRITICAL ROLLBACK SCENARIOS (do-stbg)
  // These tests cover edge cases with high data corruption risk
  // ============================================================================

  describe('Partial Rollback Failures', () => {
    it('should stop rollback chain when encountering failed rollback in middle', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_orders',
          up: 'CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY)',
          // This has a down migration that will work
          down: 'DROP TABLE IF EXISTS orders',
        }),
        createMigration({
          version: 3,
          name: 'create_items',
          up: 'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS items',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Now apply a v4 migration that doesn't support rollback
      const v4NoRollback = createMigration({
        version: 4,
        name: 'add_metadata',
        up: 'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY)',
        // No down migration
      })
      await runner.runMigrations([...migrations, v4NoRollback])
      expect(await runner.getCurrentVersion()).toBe(4)

      // Attempting to rollback to version 1 should fail at v4
      await expect(runner.rollbackTo(1, [...migrations, v4NoRollback])).rejects.toThrow(
        'does not support rollback'
      )

      // State should be unchanged - all tables still exist at v4
      expect(sql.hasTable('users')).toBe(true)
      expect(sql.hasTable('orders')).toBe(true)
      expect(sql.hasTable('items')).toBe(true)
      expect(sql.hasTable('metadata')).toBe(true)
      expect(await runner.getCurrentVersion()).toBe(4)
    })

    it('should not partially apply rollback when down SQL fails', async () => {
      // Create a mock that will fail on specific rollback SQL
      const failingSql = createEnhancedMockSqlStorage()
      const originalExec = failingSql.exec.bind(failingSql)
      let failOnDrop = false

      failingSql.exec = (sql: string) => {
        if (failOnDrop && sql.includes('DROP TABLE IF EXISTS fail_table')) {
          throw new Error('SQLITE_LOCKED: database table is locked')
        }
        return originalExec(sql)
      }

      const failingRunner = new MigrationRunner(failingSql as any)
      await failingRunner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_base',
          up: 'CREATE TABLE IF NOT EXISTS base_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS base_table',
        }),
        createMigration({
          version: 2,
          name: 'create_fail',
          up: 'CREATE TABLE IF NOT EXISTS fail_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS fail_table',
        }),
      ]

      await failingRunner.runMigrations(migrations)
      expect(await failingRunner.getCurrentVersion()).toBe(2)

      // Enable failure mode for rollback
      failOnDrop = true

      // Attempt rollback - should fail
      await expect(failingRunner.rollback(migrations)).rejects.toThrow('database table is locked')

      // Version tracking should still show v2 since rollback didn't complete
      // The table should still exist since the DROP failed
      expect(failingSql.hasTable('fail_table')).toBe(true)
    })

    it('should handle rollback failure at specific version in rollbackTo', async () => {
      const partialFailSql = createEnhancedMockSqlStorage()
      const originalExec = partialFailSql.exec.bind(partialFailSql)
      let failVersion = 0

      partialFailSql.exec = (sql: string) => {
        // Fail when trying to drop v2 table
        if (failVersion === 2 && sql.includes('DROP TABLE IF EXISTS v2_table')) {
          throw new Error('Cannot rollback: constraint violation')
        }
        return originalExec(sql)
      }

      const partialRunner = new MigrationRunner(partialFailSql as any)
      await partialRunner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'v1',
          up: 'CREATE TABLE IF NOT EXISTS v1_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS v1_table',
        }),
        createMigration({
          version: 2,
          name: 'v2',
          up: 'CREATE TABLE IF NOT EXISTS v2_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS v2_table',
        }),
        createMigration({
          version: 3,
          name: 'v3',
          up: 'CREATE TABLE IF NOT EXISTS v3_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS v3_table',
        }),
      ]

      await partialRunner.runMigrations(migrations)
      expect(await partialRunner.getCurrentVersion()).toBe(3)

      // Set up failure at v2 rollback
      failVersion = 2

      // First, v3 should rollback successfully
      const result1 = await partialRunner.rollback(migrations)
      expect(result1.rolledBack).toBe(1)
      expect(result1.version).toBe(3)
      expect(await partialRunner.getCurrentVersion()).toBe(2)

      // Now attempting to rollback v2 should fail
      await expect(partialRunner.rollback(migrations)).rejects.toThrow('constraint violation')

      // State should remain at v2
      expect(await partialRunner.getCurrentVersion()).toBe(2)
      expect(partialFailSql.hasTable('v1_table')).toBe(true)
      expect(partialFailSql.hasTable('v2_table')).toBe(true)
      expect(partialFailSql.hasTable('v3_table')).toBe(false)
    })
  })

  describe('Rollback with Data Loss Prevention', () => {
    it('should preserve critical data in related tables during rollback', async () => {
      await runner.initialize()

      // Scenario: We have users with important data, and we're rolling back
      // a migration that added a feature table but users should remain intact
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: `
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT);
            INSERT INTO users (id, name) VALUES ('user-1', 'Alice');
            INSERT INTO users (id, name) VALUES ('user-2', 'Bob');
          `,
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_sessions',
          up: 'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT)',
          down: 'DROP TABLE IF EXISTS sessions',
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify users exist
      const userData = sql.getTableData('users')
      expect(userData).toHaveLength(2)
      expect(userData.some(u => u.name === 'Alice')).toBe(true)

      // Rollback sessions table only
      await runner.rollback(migrations)

      // Users should still exist with their data
      expect(sql.hasTable('users')).toBe(true)
      const remainingUserData = sql.getTableData('users')
      expect(remainingUserData).toHaveLength(2)
      expect(remainingUserData.some(u => u.name === 'Alice')).toBe(true)
      expect(remainingUserData.some(u => u.name === 'Bob')).toBe(true)
    })

    it('should handle rollback that affects table with valuable data', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_transactions',
          up: `
            CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, amount INTEGER);
            INSERT INTO transactions (id, amount) VALUES ('tx-1', 1000);
            INSERT INTO transactions (id, amount) VALUES ('tx-2', 2500);
          `,
          down: 'DROP TABLE IF EXISTS transactions',
        }),
        createMigration({
          version: 2,
          name: 'add_status_column',
          up: 'ALTER TABLE transactions ADD COLUMN status TEXT',
          down: 'ALTER TABLE transactions DROP COLUMN status',
        }),
      ]

      await runner.runMigrations(migrations)

      // Verify initial data
      expect(sql.getTableColumns('transactions').has('status')).toBe(true)
      const txData = sql.getTableData('transactions')
      expect(txData).toHaveLength(2)

      // Rollback column addition
      await runner.rollback(migrations)

      // Table should exist, column removed, but data preserved
      expect(sql.hasTable('transactions')).toBe(true)
      expect(sql.getTableColumns('transactions').has('status')).toBe(false)
      const remainingData = sql.getTableData('transactions')
      expect(remainingData).toHaveLength(2)
      expect(remainingData.some(tx => tx.amount === 1000)).toBe(true)
    })

    it('should verify data integrity after rollback cycle', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_accounts',
          up: `
            CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, balance INTEGER);
            INSERT INTO accounts (id, balance) VALUES ('acc-1', 5000);
          `,
          down: 'DROP TABLE IF EXISTS accounts',
        }),
        createMigration({
          version: 2,
          name: 'create_audit_log',
          up: 'CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT)',
          down: 'DROP TABLE IF EXISTS audit_log',
        }),
        createMigration({
          version: 3,
          name: 'add_account_type',
          up: 'ALTER TABLE accounts ADD COLUMN account_type TEXT',
          down: 'ALTER TABLE accounts DROP COLUMN account_type',
        }),
      ]

      // Apply all migrations
      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Rollback to v1
      await runner.rollbackTo(1, migrations)
      expect(await runner.getCurrentVersion()).toBe(1)

      // Verify core data survived
      expect(sql.hasTable('accounts')).toBe(true)
      const accountData = sql.getTableData('accounts')
      expect(accountData).toHaveLength(1)
      expect(accountData[0]!.balance).toBe(5000)

      // Re-apply migrations
      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(3)

      // Core data should still be intact
      const finalData = sql.getTableData('accounts')
      expect(finalData).toHaveLength(1)
      expect(finalData[0]!.balance).toBe(5000)
    })
  })

  describe('Rolling Back Migrations with Dependencies', () => {
    it('should rollback in correct order when tables have dependencies', async () => {
      await runner.initialize()

      // Create a dependency chain: orders -> users (orders depends on users via FK)
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_orders',
          up: `
            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY,
              user_id TEXT,
              FOREIGN KEY (user_id) REFERENCES users(id)
            )
          `,
          down: 'DROP TABLE IF EXISTS orders',
        }),
        createMigration({
          version: 3,
          name: 'create_order_items',
          up: `
            CREATE TABLE IF NOT EXISTS order_items (
              id TEXT PRIMARY KEY,
              order_id TEXT,
              FOREIGN KEY (order_id) REFERENCES orders(id)
            )
          `,
          down: 'DROP TABLE IF EXISTS order_items',
        }),
      ]

      await runner.runMigrations(migrations)

      // Rollback should go: order_items (v3) -> orders (v2) -> users (v1)
      // This is the correct order since child tables must be dropped first
      await runner.rollbackTo(0, migrations)

      expect(sql.hasTable('order_items')).toBe(false)
      expect(sql.hasTable('orders')).toBe(false)
      expect(sql.hasTable('users')).toBe(false)
    })

    it('should track rollback order in execution log', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_parent',
          up: 'CREATE TABLE IF NOT EXISTS parent (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS parent',
        }),
        createMigration({
          version: 2,
          name: 'create_child',
          up: `
            CREATE TABLE IF NOT EXISTS child (
              id TEXT PRIMARY KEY,
              parent_id TEXT,
              FOREIGN KEY (parent_id) REFERENCES parent(id)
            )
          `,
          down: 'DROP TABLE IF EXISTS child',
        }),
      ]

      await runner.runMigrations(migrations)
      sql.clearExecLog()

      // Rollback all
      await runner.rollbackTo(0, migrations)

      const execLog = sql.getExecLog()

      // Find the positions of the DROP statements
      const childDropIdx = execLog.findIndex(s => s.includes('DROP TABLE IF EXISTS child'))
      const parentDropIdx = execLog.findIndex(s => s.includes('DROP TABLE IF EXISTS parent'))

      // Child should be dropped before parent (lower index = earlier execution)
      expect(childDropIdx).toBeLessThan(parentDropIdx)
    })

    it('should handle diamond dependency pattern in migrations', async () => {
      await runner.initialize()

      // Diamond pattern:
      // v1: base_config
      // v2: feature_a (depends on base_config)
      // v3: feature_b (depends on base_config)
      // v4: combined (depends on feature_a and feature_b)

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'base_config',
          up: 'CREATE TABLE IF NOT EXISTS base_config (key TEXT PRIMARY KEY, value TEXT)',
          down: 'DROP TABLE IF EXISTS base_config',
        }),
        createMigration({
          version: 2,
          name: 'feature_a',
          up: 'CREATE TABLE IF NOT EXISTS feature_a (id TEXT PRIMARY KEY, config_key TEXT)',
          down: 'DROP TABLE IF EXISTS feature_a',
        }),
        createMigration({
          version: 3,
          name: 'feature_b',
          up: 'CREATE TABLE IF NOT EXISTS feature_b (id TEXT PRIMARY KEY, config_key TEXT)',
          down: 'DROP TABLE IF EXISTS feature_b',
        }),
        createMigration({
          version: 4,
          name: 'combined',
          up: 'CREATE TABLE IF NOT EXISTS combined (id TEXT PRIMARY KEY, a_id TEXT, b_id TEXT)',
          down: 'DROP TABLE IF EXISTS combined',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(4)

      // Rollback to v1 (base_config only)
      await runner.rollbackTo(1, migrations)

      expect(sql.hasTable('combined')).toBe(false)
      expect(sql.hasTable('feature_a')).toBe(false)
      expect(sql.hasTable('feature_b')).toBe(false)
      expect(sql.hasTable('base_config')).toBe(true)
    })

    it('should fail gracefully when dependent migration is missing from list', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'v1',
          up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)',
          down: 'DROP TABLE IF EXISTS t1',
        }),
        createMigration({
          version: 2,
          name: 'v2',
          up: 'CREATE TABLE IF NOT EXISTS t2 (id TEXT)',
          down: 'DROP TABLE IF EXISTS t2',
        }),
        createMigration({
          version: 3,
          name: 'v3',
          up: 'CREATE TABLE IF NOT EXISTS t3 (id TEXT)',
          down: 'DROP TABLE IF EXISTS t3',
        }),
      ]

      await runner.runMigrations(migrations)

      // Try to rollback with incomplete migrations list (missing v3)
      const incompleteMigrations = migrations.slice(0, 2)

      await expect(runner.rollback(incompleteMigrations)).rejects.toThrow(
        'Migration for version 3 not found'
      )
    })
  })

  describe('Concurrent Migration Attempts', () => {
    it('should handle idempotent migrations safely under simulated concurrency', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'idempotent_table',
          up: 'CREATE TABLE IF NOT EXISTS idempotent_table (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS idempotent_table',
        }),
      ]

      // Simulate sequential migration attempts (real SQLite would serialize these)
      // Note: In a real system, SQLite's transaction isolation prevents race conditions.
      // Our mock doesn't have true transaction isolation, so we test sequential behavior
      // which is what would happen with SQLite's locking.
      const result1 = await runner.runMigrations(migrations)
      const result2 = await runner.runMigrations(migrations)
      const result3 = await runner.runMigrations(migrations)

      // First should apply, subsequent should skip
      expect(result1.applied).toBe(1)
      expect(result1.skipped).toBe(0)
      expect(result2.applied).toBe(0)
      expect(result2.skipped).toBe(1)
      expect(result3.applied).toBe(0)
      expect(result3.skipped).toBe(1)

      // Should only have one migration tracked
      const applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(1)
    })

    it('should not double-rollback when called concurrently', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'concurrent_test',
          up: 'CREATE TABLE IF NOT EXISTS concurrent_test (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS concurrent_test',
        }),
      ]

      await runner.runMigrations(migrations)
      expect(await runner.getCurrentVersion()).toBe(1)

      // Simulate concurrent rollback attempts
      const rollbackResults = await Promise.allSettled([
        runner.rollback(migrations),
        runner.rollback(migrations),
      ])

      // At least one should succeed, the other should either succeed or find nothing to rollback
      const successes = rollbackResults.filter(r => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThanOrEqual(1)

      // Final state should be version 0
      expect(await runner.getCurrentVersion()).toBe(0)
    })

    it('should maintain version consistency after concurrent apply and rollback', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'v1',
          up: 'CREATE TABLE IF NOT EXISTS consistency_test (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS consistency_test',
        }),
      ]

      // Apply first
      await runner.runMigrations(migrations)

      // Concurrent operations (in practice, these would be serialized by SQLite)
      const operations = [
        runner.rollback(migrations),
        runner.runMigrations(migrations),
        runner.rollback(migrations),
      ]

      await Promise.allSettled(operations)

      // Version should be consistent (either 0 or 1)
      const finalVersion = await runner.getCurrentVersion()
      expect([0, 1]).toContain(finalVersion)

      // Table existence should match version
      if (finalVersion === 0) {
        expect(sql.hasTable('consistency_test')).toBe(false)
      } else {
        expect(sql.hasTable('consistency_test')).toBe(true)
      }
    })

    it('should serialize migrations correctly when applied in rapid succession', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'rapid_v1', up: 'CREATE TABLE IF NOT EXISTS rapid_v1 (id TEXT)', down: 'DROP TABLE IF EXISTS rapid_v1' }),
        createMigration({ version: 2, name: 'rapid_v2', up: 'CREATE TABLE IF NOT EXISTS rapid_v2 (id TEXT)', down: 'DROP TABLE IF EXISTS rapid_v2' }),
        createMigration({ version: 3, name: 'rapid_v3', up: 'CREATE TABLE IF NOT EXISTS rapid_v3 (id TEXT)', down: 'DROP TABLE IF EXISTS rapid_v3' }),
      ]

      // Apply migrations rapidly
      await runner.runMigrations([migrations[0]!])
      await runner.runMigrations([migrations[0]!, migrations[1]!])
      await runner.runMigrations(migrations)

      // Should be at v3 with exactly 3 migrations applied
      expect(await runner.getCurrentVersion()).toBe(3)
      const applied = await runner.getAppliedMigrations()
      expect(applied).toHaveLength(3)
      expect(applied.map(m => m.version)).toEqual([1, 2, 3])
    })
  })

  describe('Migration Execution Order Verification', () => {
    it('should always execute migrations in version order regardless of array order', async () => {
      await runner.initialize()

      // Migrations provided in reverse order
      const migrations: Migration[] = [
        createMigration({ version: 5, name: 'v5', up: 'CREATE TABLE IF NOT EXISTS v5_table (id TEXT)', down: 'DROP TABLE IF EXISTS v5_table' }),
        createMigration({ version: 1, name: 'v1', up: 'CREATE TABLE IF NOT EXISTS v1_table (id TEXT)', down: 'DROP TABLE IF EXISTS v1_table' }),
        createMigration({ version: 3, name: 'v3', up: 'CREATE TABLE IF NOT EXISTS v3_table (id TEXT)', down: 'DROP TABLE IF EXISTS v3_table' }),
        createMigration({ version: 2, name: 'v2', up: 'CREATE TABLE IF NOT EXISTS v2_table (id TEXT)', down: 'DROP TABLE IF EXISTS v2_table' }),
        createMigration({ version: 4, name: 'v4', up: 'CREATE TABLE IF NOT EXISTS v4_table (id TEXT)', down: 'DROP TABLE IF EXISTS v4_table' }),
      ]

      sql.clearExecLog()
      await runner.runMigrations(migrations)

      const execLog = sql.getExecLog()

      // Find creation order
      const v1Idx = execLog.findIndex(s => s.includes('v1_table'))
      const v2Idx = execLog.findIndex(s => s.includes('v2_table'))
      const v3Idx = execLog.findIndex(s => s.includes('v3_table'))
      const v4Idx = execLog.findIndex(s => s.includes('v4_table'))
      const v5Idx = execLog.findIndex(s => s.includes('v5_table'))

      // Should be in version order
      expect(v1Idx).toBeLessThan(v2Idx)
      expect(v2Idx).toBeLessThan(v3Idx)
      expect(v3Idx).toBeLessThan(v4Idx)
      expect(v4Idx).toBeLessThan(v5Idx)
    })

    it('should rollback in reverse version order', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'order_v1', up: 'CREATE TABLE IF NOT EXISTS order_v1 (id TEXT)', down: 'DROP TABLE IF EXISTS order_v1' }),
        createMigration({ version: 2, name: 'order_v2', up: 'CREATE TABLE IF NOT EXISTS order_v2 (id TEXT)', down: 'DROP TABLE IF EXISTS order_v2' }),
        createMigration({ version: 3, name: 'order_v3', up: 'CREATE TABLE IF NOT EXISTS order_v3 (id TEXT)', down: 'DROP TABLE IF EXISTS order_v3' }),
      ]

      await runner.runMigrations(migrations)
      sql.clearExecLog()

      await runner.rollbackTo(0, migrations)

      const execLog = sql.getExecLog()

      // Find drop order
      const dropV1Idx = execLog.findIndex(s => s.includes('DROP') && s.includes('order_v1'))
      const dropV2Idx = execLog.findIndex(s => s.includes('DROP') && s.includes('order_v2'))
      const dropV3Idx = execLog.findIndex(s => s.includes('DROP') && s.includes('order_v3'))

      // Should be in reverse version order (v3 first, then v2, then v1)
      expect(dropV3Idx).toBeLessThan(dropV2Idx)
      expect(dropV2Idx).toBeLessThan(dropV1Idx)
    })
  })

  describe('Idempotent Migration Verification', () => {
    it('should not re-apply already applied migrations', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'idempotent_v1', up: 'CREATE TABLE IF NOT EXISTS idem_t1 (id TEXT)', down: 'DROP TABLE IF EXISTS idem_t1' }),
      ]

      // Apply multiple times
      const r1 = await runner.runMigrations(migrations)
      const r2 = await runner.runMigrations(migrations)
      const r3 = await runner.runMigrations(migrations)

      expect(r1.applied).toBe(1)
      expect(r1.skipped).toBe(0)

      expect(r2.applied).toBe(0)
      expect(r2.skipped).toBe(1)

      expect(r3.applied).toBe(0)
      expect(r3.skipped).toBe(1)
    })

    it('should correctly identify applied vs pending after partial application', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'partial_v1', up: 'CREATE TABLE IF NOT EXISTS partial_v1 (id TEXT)', down: 'DROP TABLE IF EXISTS partial_v1' }),
        createMigration({ version: 2, name: 'partial_v2', up: 'CREATE TABLE IF NOT EXISTS partial_v2 (id TEXT)', down: 'DROP TABLE IF EXISTS partial_v2' }),
        createMigration({ version: 3, name: 'partial_v3', up: 'CREATE TABLE IF NOT EXISTS partial_v3 (id TEXT)', down: 'DROP TABLE IF EXISTS partial_v3' }),
      ]

      // Apply only v1
      await runner.runMigrations([migrations[0]!])

      // Check states
      expect(await runner.isMigrationApplied(1)).toBe(true)
      expect(await runner.isMigrationApplied(2)).toBe(false)
      expect(await runner.isMigrationApplied(3)).toBe(false)

      const pending = await runner.getPendingMigrations(migrations)
      expect(pending).toHaveLength(2)
      expect(pending[0]!.version).toBe(2)
      expect(pending[1]!.version).toBe(3)
    })

    it('should handle gaps in migration versions', async () => {
      await runner.initialize()

      const migrations: Migration[] = [
        createMigration({ version: 1, name: 'gap_v1', up: 'CREATE TABLE IF NOT EXISTS gap_v1 (id TEXT)', down: 'DROP TABLE IF EXISTS gap_v1' }),
        createMigration({ version: 5, name: 'gap_v5', up: 'CREATE TABLE IF NOT EXISTS gap_v5 (id TEXT)', down: 'DROP TABLE IF EXISTS gap_v5' }),
        createMigration({ version: 10, name: 'gap_v10', up: 'CREATE TABLE IF NOT EXISTS gap_v10 (id TEXT)', down: 'DROP TABLE IF EXISTS gap_v10' }),
      ]

      const result = await runner.runMigrations(migrations)
      expect(result.applied).toBe(3)

      // Version should be highest applied
      expect(await runner.getCurrentVersion()).toBe(10)

      // All should be marked as applied
      const applied = await runner.getAppliedMigrations()
      expect(applied.map(m => m.version)).toEqual([1, 5, 10])
    })
  })
})
