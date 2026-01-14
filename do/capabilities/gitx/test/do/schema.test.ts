import { describe, it, expect, beforeEach } from 'vitest'
import {
  SchemaManager,
  DurableObjectStorage,
  SCHEMA_VERSION,
  SCHEMA_SQL
} from '../../src/do/schema'

/**
 * Mock DurableObjectStorage for testing SQLite schema operations
 */
class MockDurableObjectStorage implements DurableObjectStorage {
  private tables: Map<string, { columns: string[]; rows: unknown[][] }> = new Map()
  private indexes: Set<string> = new Set()
  private executedQueries: string[] = []

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.executedQueries.push(query)

      // Parse CREATE TABLE statements (handles multi-line and nested parentheses)
      const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/gi
      let match
      while ((match = tableRegex.exec(query)) !== null) {
        const tableName = match[1]
        const startIdx = match.index + match[0].length
        let depth = 1
        let endIdx = startIdx
        while (endIdx < query.length && depth > 0) {
          if (query[endIdx] === '(') depth++
          else if (query[endIdx] === ')') depth--
          endIdx++
        }
        const columnsStr = query.slice(startIdx, endIdx - 1)
        // Parse columns, excluding constraint definitions
        const columns = columnsStr
          .split(',')
          .map(col => col.trim().split(/\s+/)[0])
          .filter(col =>
            col &&
            !col.toUpperCase().startsWith('PRIMARY') &&
            !col.toUpperCase().startsWith('FOREIGN') &&
            !col.toUpperCase().startsWith('UNIQUE') &&
            !col.toUpperCase().startsWith('CHECK') &&
            !col.toUpperCase().startsWith('CONSTRAINT')
          )
        this.tables.set(tableName, { columns, rows: [] })
      }

      // Parse CREATE INDEX statements
      const createIndexMatch = query.match(/CREATE INDEX IF NOT EXISTS (\w+)/gi)
      if (createIndexMatch) {
        for (const match of createIndexMatch) {
          const indexMatch = match.match(/CREATE INDEX IF NOT EXISTS (\w+)/i)
          if (indexMatch) {
            this.indexes.add(indexMatch[1])
          }
        }
      }

      // Handle sqlite_master queries for table listing
      if (query.includes('sqlite_master') && query.includes("type='table'")) {
        const tableNames = Array.from(this.tables.keys())
        return {
          toArray: () => tableNames.map(name => ({ name }))
        }
      }

      // Handle PRAGMA table_info queries
      const pragmaMatch = query.match(/PRAGMA table_info\((\w+)\)/i)
      if (pragmaMatch) {
        const tableName = pragmaMatch[1]
        const table = this.tables.get(tableName)
        if (table) {
          return {
            toArray: () => table.columns.map((name, idx) => ({
              cid: idx,
              name,
              type: 'TEXT',
              notnull: 0,
              dflt_value: null,
              pk: idx === 0 ? 1 : 0
            }))
          }
        }
        return { toArray: () => [] }
      }

      // Handle index listing queries
      if (query.includes('sqlite_master') && query.includes("type='index'")) {
        return {
          toArray: () => Array.from(this.indexes).map(name => ({ name }))
        }
      }

      // Handle schema version queries (from a hypothetical schema_version table)
      if (query.includes('schema_version')) {
        const versionTable = this.tables.get('schema_version')
        if (versionTable && versionTable.rows.length > 0) {
          return { toArray: () => versionTable.rows.map(row => ({ version: row[0] })) }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getExecutedQueries(): string[] {
    return [...this.executedQueries]
  }

  getTables(): string[] {
    return Array.from(this.tables.keys())
  }

  getTableColumns(tableName: string): string[] | undefined {
    return this.tables.get(tableName)?.columns
  }

  getIndexes(): string[] {
    return Array.from(this.indexes)
  }

  hasTable(tableName: string): boolean {
    return this.tables.has(tableName)
  }

  clearTables(): void {
    this.tables.clear()
    this.indexes.clear()
    this.executedQueries = []
  }

  // Simulate a table being missing
  removeTable(tableName: string): void {
    this.tables.delete(tableName)
  }
}

describe('SchemaManager', () => {
  let storage: MockDurableObjectStorage
  let schemaManager: SchemaManager

  beforeEach(() => {
    storage = new MockDurableObjectStorage()
    schemaManager = new SchemaManager(storage)
  })

  describe('initializeSchema', () => {
    it('should create all required tables', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('objects')
      expect(tables).toContain('object_index')
      expect(tables).toContain('hot_objects')
      expect(tables).toContain('wal')
      expect(tables).toContain('refs')
      expect(tables).toContain('git')
      expect(tables).toContain('git_branches')
      expect(tables).toContain('git_content')
    })

    it('should create objects table with correct columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('objects')
      expect(columns).toBeDefined()
      expect(columns).toContain('sha')
      expect(columns).toContain('type')
      expect(columns).toContain('size')
      expect(columns).toContain('data')
      expect(columns).toContain('created_at')
    })

    it('should create object_index table with correct columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('object_index')
      expect(columns).toBeDefined()
      expect(columns).toContain('sha')
      expect(columns).toContain('tier')
      expect(columns).toContain('pack_id')
      expect(columns).toContain('offset')
      expect(columns).toContain('size')
      expect(columns).toContain('type')
      expect(columns).toContain('updated_at')
    })

    it('should create hot_objects table with correct columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('hot_objects')
      expect(columns).toBeDefined()
      expect(columns).toContain('sha')
      expect(columns).toContain('type')
      expect(columns).toContain('data')
      expect(columns).toContain('accessed_at')
      expect(columns).toContain('created_at')
    })

    it('should create wal table with correct columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('wal')
      expect(columns).toBeDefined()
      expect(columns).toContain('id')
      expect(columns).toContain('operation')
      expect(columns).toContain('payload')
      expect(columns).toContain('created_at')
      expect(columns).toContain('flushed')
    })

    it('should create refs table with correct columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('refs')
      expect(columns).toBeDefined()
      expect(columns).toContain('name')
      expect(columns).toContain('target')
      expect(columns).toContain('type')
      expect(columns).toContain('updated_at')
    })

    it('should create all required indexes', async () => {
      await schemaManager.initializeSchema()

      const indexes = storage.getIndexes()
      expect(indexes).toContain('idx_objects_type')
      expect(indexes).toContain('idx_wal_flushed')
      expect(indexes).toContain('idx_hot_objects_accessed')
    })

    it('should create exec table for BashModule integration', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('exec')

      const columns = storage.getTableColumns('exec')
      expect(columns).toBeDefined()
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('blocked_commands')
      expect(columns).toContain('require_confirmation')
      expect(columns).toContain('default_timeout')
      expect(columns).toContain('default_cwd')
      expect(columns).toContain('allowed_patterns')
      expect(columns).toContain('denied_patterns')
      expect(columns).toContain('max_concurrent')
      expect(columns).toContain('enabled')
    })

    it('should create exec table indexes', async () => {
      await schemaManager.initializeSchema()

      const indexes = storage.getIndexes()
      expect(indexes).toContain('idx_exec_name')
      expect(indexes).toContain('idx_exec_enabled')
    })

    it('should create git table for GitModule integration', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('git')

      const columns = storage.getTableColumns('git')
      expect(columns).toBeDefined()
      expect(columns).toContain('id')
      expect(columns).toContain('repo')
      expect(columns).toContain('path')
      expect(columns).toContain('branch')
      expect(columns).toContain('commit')
      expect(columns).toContain('last_sync')
      expect(columns).toContain('object_prefix')
      expect(columns).toContain('created_at')
      expect(columns).toContain('updated_at')
    })

    it('should create git_branches table for branch tracking', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('git_branches')

      const columns = storage.getTableColumns('git_branches')
      expect(columns).toBeDefined()
      expect(columns).toContain('id')
      expect(columns).toContain('repo_id')
      expect(columns).toContain('name')
      expect(columns).toContain('head')
      expect(columns).toContain('upstream')
      expect(columns).toContain('tracking')
      expect(columns).toContain('ahead')
      expect(columns).toContain('behind')
      expect(columns).toContain('created_at')
      expect(columns).toContain('updated_at')
    })

    it('should create git_content table for staged files', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('git_content')

      const columns = storage.getTableColumns('git_content')
      expect(columns).toBeDefined()
      expect(columns).toContain('id')
      expect(columns).toContain('repo_id')
      expect(columns).toContain('path')
      expect(columns).toContain('content')
      expect(columns).toContain('mode')
      expect(columns).toContain('status')
      expect(columns).toContain('sha')
      expect(columns).toContain('created_at')
      expect(columns).toContain('updated_at')
    })

    it('should create git-related indexes', async () => {
      await schemaManager.initializeSchema()

      const indexes = storage.getIndexes()
      expect(indexes).toContain('idx_git_branches_repo')
      expect(indexes).toContain('idx_git_content_repo_path')
      expect(indexes).toContain('idx_git_content_status')
    })

    it('should be idempotent - can be called multiple times without error', async () => {
      await schemaManager.initializeSchema()
      const tablesAfterFirst = storage.getTables()

      // Should not throw when called again
      await expect(schemaManager.initializeSchema()).resolves.not.toThrow()

      const tablesAfterSecond = storage.getTables()
      expect(tablesAfterSecond).toEqual(tablesAfterFirst)
    })
  })

  describe('getSchemaVersion', () => {
    it('should return current schema version after initialization', async () => {
      await schemaManager.initializeSchema()

      const version = await schemaManager.getSchemaVersion()
      expect(version).toBe(SCHEMA_VERSION)
    })

    it('should return 0 when schema is not initialized', async () => {
      const version = await schemaManager.getSchemaVersion()
      expect(version).toBe(0)
    })
  })

  describe('validateSchema', () => {
    it('should return true when all tables exist', async () => {
      await schemaManager.initializeSchema()

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(true)
    })

    it('should return false when objects table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('objects')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when refs table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('refs')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when wal table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('wal')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when exec table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('exec')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when git table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('git')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when git_branches table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('git_branches')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when git_content table is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('git_content')

      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return false when schema is not initialized', async () => {
      const isValid = await schemaManager.validateSchema()
      expect(isValid).toBe(false)
    })
  })

  describe('SCHEMA_SQL constant', () => {
    it('should contain CREATE TABLE statements for all required tables', () => {
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS objects')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS object_index')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS hot_objects')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS wal')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS refs')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS exec')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS git')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS git_branches')
      expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS git_content')
    })

    it('should contain CREATE INDEX statements for performance indexes', () => {
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_objects_type')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_wal_flushed')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_hot_objects_accessed')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_exec_name')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_exec_enabled')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_git_branches_repo')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_git_content_repo_path')
      expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_git_content_status')
    })
  })

  describe('SCHEMA_VERSION constant', () => {
    it('should be a positive integer', () => {
      expect(SCHEMA_VERSION).toBeGreaterThan(0)
      expect(Number.isInteger(SCHEMA_VERSION)).toBe(true)
    })
  })
})
