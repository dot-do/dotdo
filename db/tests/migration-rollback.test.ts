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

      // Handle INSERT (for data migrations)
      const insertMatch = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
      if (insertMatch) {
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
})
