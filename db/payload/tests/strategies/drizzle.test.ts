/**
 * DrizzleStorageStrategy Tests
 *
 * Tests for the D1-SQLite-style storage strategy that stores Payload
 * collections as typed SQLite tables with proper column types.
 *
 * @module @dotdo/payload/tests/strategies/drizzle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DrizzleStorageStrategy,
  createDrizzleStrategy,
  type DrizzleStrategyConfig,
} from '../../src/strategies/drizzle'
import {
  SchemaBuilder,
  createSchemaBuilder,
  getColumnType,
  requiresSeparateTable,
} from '../../src/strategies/drizzle/schema-builder'
import {
  QueryBuilder,
  createQueryBuilder,
  buildPaginationMeta,
  parseSort,
  calculateOffset,
} from '../../src/strategies/drizzle/query-builder'
import {
  generateCreateTableDDL,
  generateDropTableDDL,
  generateAddColumnDDL,
  generateVersionsTableDDL,
  generateRelationTableDDL,
  diffSchemas,
  generateDrizzleMigrationTemplate,
} from '../../src/strategies/drizzle/migrations'
import type { PayloadCollection, PayloadField } from '../../src/adapter/types'

// ============================================================================
// MOCK DATABASE
// ============================================================================

/**
 * Create a mock in-memory database for testing
 */
function createMockDb() {
  const tables: Map<string, any[]> = new Map()
  let queryLog: string[] = []

  const getTable = (name: string) => {
    if (!tables.has(name)) {
      tables.set(name, [])
    }
    return tables.get(name)!
  }

  const db = {
    tables,
    queryLog,

    select(fields?: any) {
      return {
        from: (table: any) => {
          const tableName = table?.name || table?.[Symbol.for('drizzle:Name')] || 'unknown'
          return {
            where: (condition: any) => {
              return {
                limit: (n: number) => ({
                  offset: (o: number) => Promise.resolve(getTable(tableName).slice(o, o + n)),
                }),
                orderBy: (order: any) => ({
                  limit: (n: number) => ({
                    offset: (o: number) => Promise.resolve(getTable(tableName).slice(o, o + n)),
                  }),
                }),
              }
            },
            orderBy: (order: any) => ({
              limit: (n: number) => ({
                offset: (o: number) => Promise.resolve(getTable(tableName).slice(o, o + n)),
              }),
            }),
            limit: (n: number) => ({
              offset: (o: number) => Promise.resolve(getTable(tableName).slice(o, o + n)),
            }),
          }
        },
      }
    },

    insert(table: any) {
      const tableName = table?.name || table?.[Symbol.for('drizzle:Name')] || 'unknown'
      return {
        values: (data: any) => {
          const tableData = getTable(tableName)
          tableData.push(data)
          queryLog.push(`INSERT INTO ${tableName}`)
          return Promise.resolve()
        },
      }
    },

    update(table: any) {
      const tableName = table?.name || table?.[Symbol.for('drizzle:Name')] || 'unknown'
      return {
        set: (data: any) => ({
          where: (condition: any) => {
            queryLog.push(`UPDATE ${tableName}`)
            return Promise.resolve()
          },
        }),
      }
    },

    delete(table: any) {
      const tableName = table?.name || table?.[Symbol.for('drizzle:Name')] || 'unknown'
      return {
        where: (condition: any) => {
          queryLog.push(`DELETE FROM ${tableName}`)
          return Promise.resolve()
        },
      }
    },

    // Raw query execution
    all(query: any): Promise<any[]> {
      const sqlString = typeof query === 'string' ? query : query?.sql || ''
      queryLog.push(sqlString.substring(0, 50))

      // Handle COUNT queries
      if (sqlString.includes('COUNT')) {
        return Promise.resolve([{ count: 0 }])
      }

      return Promise.resolve([])
    },
  }

  return db
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const postsCollection: PayloadCollection = {
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'content', type: 'richText' },
    { name: 'status', type: 'select', options: ['draft', 'published'] },
    { name: 'author', type: 'relationship', relationTo: 'users' },
    { name: 'views', type: 'number', index: true },
    { name: 'featured', type: 'checkbox' },
  ],
  versions: {
    drafts: true,
  },
}

const usersCollection: PayloadCollection = {
  slug: 'users',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true, unique: true, index: true },
    { name: 'role', type: 'select', options: ['admin', 'user'] },
    { name: 'posts', type: 'relationship', relationTo: 'posts', hasMany: true },
  ],
}

const categoriesCollection: PayloadCollection = {
  slug: 'categories',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'posts', type: 'relationship', relationTo: 'posts', hasMany: true },
  ],
}

// ============================================================================
// SCHEMA BUILDER TESTS
// ============================================================================

describe('SchemaBuilder', () => {
  let builder: SchemaBuilder

  beforeEach(() => {
    builder = createSchemaBuilder({
      tablePrefix: 'test_',
      idType: 'text',
      timestamps: true,
    })
  })

  describe('buildCollectionSchema', () => {
    it('should build schema for a collection', () => {
      const schema = builder.buildCollectionSchema(postsCollection)

      expect(schema.table).toBeDefined()
      expect(schema.config).toBe(postsCollection)
    })

    it('should create versions table for versioned collections', () => {
      const schema = builder.buildCollectionSchema(postsCollection)

      expect(schema.versionsTable).toBeDefined()
    })

    it('should not create versions table for non-versioned collections', () => {
      const schema = builder.buildCollectionSchema(categoriesCollection)

      expect(schema.versionsTable).toBeUndefined()
    })

    it('should create relation tables for hasMany relationships', () => {
      const schema = builder.buildCollectionSchema(usersCollection)

      expect(schema.relationTables.size).toBe(1)
      expect(schema.relationTables.has('posts')).toBe(true)
    })
  })

  describe('buildSchemas', () => {
    it('should build schemas for multiple collections', () => {
      const schemas = builder.buildSchemas([postsCollection, usersCollection])

      expect(schemas.size).toBe(2)
      expect(schemas.has('posts')).toBe(true)
      expect(schemas.has('users')).toBe(true)
    })
  })

  describe('getTableName', () => {
    it('should apply table prefix', () => {
      expect(builder.getTableName('posts')).toBe('test_posts')
    })

    it('should get versions table name', () => {
      expect(builder.getVersionsTableName('posts')).toBe('test_posts_versions')
    })

    it('should get relation table name', () => {
      expect(builder.getRelationTableName('users', 'posts')).toBe('test_users_posts_rels')
    })
  })

  describe('generateDDL', () => {
    it('should generate DDL statements', () => {
      builder.buildSchemas([postsCollection])
      const ddl = builder.generateDDL()

      expect(ddl.length).toBeGreaterThan(0)
      expect(ddl[0]).toContain('CREATE TABLE')
    })
  })
})

describe('getColumnType', () => {
  it('should map text fields to TEXT', () => {
    expect(getColumnType('text')).toBe('text')
    expect(getColumnType('textarea')).toBe('text')
    expect(getColumnType('email')).toBe('text')
  })

  it('should map number fields to REAL', () => {
    expect(getColumnType('number')).toBe('real')
  })

  it('should map checkbox to INTEGER', () => {
    expect(getColumnType('checkbox')).toBe('integer')
  })

  it('should map date to TEXT', () => {
    expect(getColumnType('date')).toBe('text')
  })
})

describe('requiresSeparateTable', () => {
  it('should return true for hasMany relationships', () => {
    const field: PayloadField = {
      name: 'posts',
      type: 'relationship',
      relationTo: 'posts',
      hasMany: true,
    }

    expect(requiresSeparateTable(field)).toBe(true)
  })

  it('should return false for single relationships', () => {
    const field: PayloadField = {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
    }

    expect(requiresSeparateTable(field)).toBe(false)
  })

  it('should return false for simple fields', () => {
    const field: PayloadField = {
      name: 'title',
      type: 'text',
    }

    expect(requiresSeparateTable(field)).toBe(false)
  })
})

// ============================================================================
// QUERY BUILDER TESTS
// ============================================================================

describe('QueryBuilder', () => {
  describe('parseSort', () => {
    it('should parse descending sort', () => {
      const result = parseSort('-createdAt')

      expect(result.field).toBe('createdAt')
      expect(result.direction).toBe('desc')
    })

    it('should parse ascending sort', () => {
      const result = parseSort('name')

      expect(result.field).toBe('name')
      expect(result.direction).toBe('asc')
    })

    it('should handle + prefix', () => {
      const result = parseSort('+name')

      expect(result.field).toBe('name')
      expect(result.direction).toBe('asc')
    })
  })

  describe('calculateOffset', () => {
    it('should calculate offset from page and limit', () => {
      expect(calculateOffset(1, 10)).toBe(0)
      expect(calculateOffset(2, 10)).toBe(10)
      expect(calculateOffset(3, 10)).toBe(20)
    })

    it('should handle page 0', () => {
      expect(calculateOffset(0, 10)).toBe(0)
    })
  })

  describe('buildPaginationMeta', () => {
    it('should build correct pagination metadata', () => {
      const meta = buildPaginationMeta(2, 10, 35)

      expect(meta.page).toBe(2)
      expect(meta.limit).toBe(10)
      expect(meta.totalDocs).toBe(35)
      expect(meta.totalPages).toBe(4)
      expect(meta.hasNextPage).toBe(true)
      expect(meta.hasPrevPage).toBe(true)
    })

    it('should handle first page', () => {
      const meta = buildPaginationMeta(1, 10, 35)

      expect(meta.hasPrevPage).toBe(false)
      expect(meta.hasNextPage).toBe(true)
    })

    it('should handle last page', () => {
      const meta = buildPaginationMeta(4, 10, 35)

      expect(meta.hasPrevPage).toBe(true)
      expect(meta.hasNextPage).toBe(false)
    })

    it('should handle single page', () => {
      const meta = buildPaginationMeta(1, 10, 5)

      expect(meta.totalPages).toBe(1)
      expect(meta.hasNextPage).toBe(false)
      expect(meta.hasPrevPage).toBe(false)
    })
  })
})

// ============================================================================
// MIGRATION HELPERS TESTS
// ============================================================================

describe('DDL Generation', () => {
  describe('generateCreateTableDDL', () => {
    it('should generate CREATE TABLE statement', () => {
      const ddl = generateCreateTableDDL(postsCollection)

      expect(ddl.operation).toBe('create')
      expect(ddl.table).toBe('posts')
      expect(ddl.sql).toContain('CREATE TABLE')
      expect(ddl.sql).toContain('"id" TEXT PRIMARY KEY NOT NULL')
      expect(ddl.sql).toContain('"title" TEXT NOT NULL')
      expect(ddl.sql).toContain('"views" REAL')
      expect(ddl.sql).toContain('"featured" INTEGER')
    })

    it('should apply table prefix', () => {
      const ddl = generateCreateTableDDL(postsCollection, 'payload_')

      expect(ddl.table).toBe('payload_posts')
      expect(ddl.sql).toContain('"payload_posts"')
    })

    it('should include timestamp columns', () => {
      const ddl = generateCreateTableDDL(postsCollection)

      expect(ddl.sql).toContain('"createdAt" TEXT NOT NULL')
      expect(ddl.sql).toContain('"updatedAt" TEXT NOT NULL')
    })
  })

  describe('generateDropTableDDL', () => {
    it('should generate DROP TABLE statement', () => {
      const ddl = generateDropTableDDL('posts')

      expect(ddl.operation).toBe('drop')
      expect(ddl.table).toBe('posts')
      expect(ddl.sql).toContain('DROP TABLE IF EXISTS')
    })
  })

  describe('generateAddColumnDDL', () => {
    it('should generate ALTER TABLE ADD COLUMN statement', () => {
      const field: PayloadField = { name: 'newField', type: 'text' }
      const ddl = generateAddColumnDDL('posts', field)

      expect(ddl.operation).toBe('alter')
      expect(ddl.sql).toContain('ALTER TABLE')
      expect(ddl.sql).toContain('ADD COLUMN')
      expect(ddl.sql).toContain('"newField"')
    })
  })

  describe('generateVersionsTableDDL', () => {
    it('should generate versions table DDL', () => {
      const ddl = generateVersionsTableDDL('posts')

      expect(ddl.table).toBe('posts_versions')
      expect(ddl.sql).toContain('"parent_id" TEXT NOT NULL')
      expect(ddl.sql).toContain('"version_number" INTEGER NOT NULL')
      expect(ddl.sql).toContain('"snapshot" TEXT NOT NULL')
    })
  })

  describe('generateRelationTableDDL', () => {
    it('should generate relation table DDL', () => {
      const ddl = generateRelationTableDDL('users', 'posts')

      expect(ddl.table).toBe('users_posts_rels')
      expect(ddl.sql).toContain('"parent_id" TEXT NOT NULL')
      expect(ddl.sql).toContain('"related_id" TEXT NOT NULL')
      expect(ddl.sql).toContain('"order" INTEGER NOT NULL')
    })

    it('should add relation_to column for polymorphic relationships', () => {
      const ddl = generateRelationTableDDL('posts', 'related', true)

      expect(ddl.sql).toContain('"relation_to" TEXT NOT NULL')
    })
  })
})

describe('Schema Diff', () => {
  describe('diffSchemas', () => {
    it('should detect new tables', () => {
      const oldCollections: PayloadCollection[] = [postsCollection]
      const newCollections: PayloadCollection[] = [postsCollection, usersCollection]

      const diff = diffSchemas(oldCollections, newCollections)

      expect(diff.create).toContain('users')
      expect(diff.hasChanges).toBe(true)
    })

    it('should detect dropped tables', () => {
      const oldCollections: PayloadCollection[] = [postsCollection, usersCollection]
      const newCollections: PayloadCollection[] = [postsCollection]

      const diff = diffSchemas(oldCollections, newCollections)

      expect(diff.drop).toContain('users')
      expect(diff.hasChanges).toBe(true)
    })

    it('should detect new columns', () => {
      const oldCollection: PayloadCollection = {
        slug: 'posts',
        fields: [{ name: 'title', type: 'text' }],
      }
      const newCollection: PayloadCollection = {
        slug: 'posts',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'content', type: 'text' },
        ],
      }

      const diff = diffSchemas([oldCollection], [newCollection])

      expect(diff.addColumns).toContainEqual({ table: 'posts', column: 'content', type: 'TEXT' })
      expect(diff.hasChanges).toBe(true)
    })

    it('should detect dropped columns', () => {
      const oldCollection: PayloadCollection = {
        slug: 'posts',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'content', type: 'text' },
        ],
      }
      const newCollection: PayloadCollection = {
        slug: 'posts',
        fields: [{ name: 'title', type: 'text' }],
      }

      const diff = diffSchemas([oldCollection], [newCollection])

      expect(diff.dropColumns).toContainEqual({ table: 'posts', column: 'content' })
      expect(diff.hasChanges).toBe(true)
    })

    it('should detect index changes', () => {
      const oldCollection: PayloadCollection = {
        slug: 'posts',
        fields: [{ name: 'title', type: 'text' }],
      }
      const newCollection: PayloadCollection = {
        slug: 'posts',
        fields: [{ name: 'title', type: 'text', index: true }],
      }

      const diff = diffSchemas([oldCollection], [newCollection])

      expect(diff.addIndexes).toContainEqual({
        table: 'posts',
        name: 'posts_title_idx',
        columns: ['title'],
      })
      expect(diff.hasChanges).toBe(true)
    })

    it('should report no changes when schemas match', () => {
      const diff = diffSchemas([postsCollection], [postsCollection])

      expect(diff.hasChanges).toBe(false)
      expect(diff.create).toHaveLength(0)
      expect(diff.drop).toHaveLength(0)
      expect(diff.addColumns).toHaveLength(0)
      expect(diff.dropColumns).toHaveLength(0)
    })
  })
})

describe('Migration Template Generation', () => {
  describe('generateDrizzleMigrationTemplate', () => {
    it('should generate valid migration template', () => {
      const template = generateDrizzleMigrationTemplate('test_migration')

      expect(template).toContain("name: 'test_migration'")
      expect(template).toContain('async function up')
      expect(template).toContain('async function down')
      expect(template).toContain('timestamp:')
    })

    it('should include DDL statements in template', () => {
      const upStatements = [
        {
          sql: 'CREATE TABLE test',
          table: 'test',
          operation: 'create' as const,
          description: 'Create test table',
        },
      ]
      const downStatements = [
        {
          sql: 'DROP TABLE test',
          table: 'test',
          operation: 'drop' as const,
          description: 'Drop test table',
        },
      ]

      const template = generateDrizzleMigrationTemplate('test', upStatements, downStatements)

      expect(template).toContain('CREATE TABLE test')
      expect(template).toContain('DROP TABLE test')
    })
  })
})

// ============================================================================
// DRIZZLE STRATEGY TESTS
// ============================================================================

describe('DrizzleStorageStrategy', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let strategy: DrizzleStorageStrategy

  beforeEach(() => {
    mockDb = createMockDb()
    strategy = createDrizzleStrategy({
      db: mockDb as any,
      tablePrefix: 'test_',
      idType: 'text',
      autoCreate: false, // Skip table creation in tests
    })
  })

  describe('init', () => {
    it('should build schemas for collections', async () => {
      await strategy.init({} as any, [postsCollection, usersCollection])

      const schemas = strategy.getAllSchemas()
      expect(schemas.size).toBe(2)
      expect(schemas.has('posts')).toBe(true)
      expect(schemas.has('users')).toBe(true)
    })

    it('should get schema for a collection', async () => {
      await strategy.init({} as any, [postsCollection])

      const schema = strategy.getSchema('posts')
      expect(schema).toBeDefined()
      expect(schema?.config.slug).toBe('posts')
    })
  })

  describe('create', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection, usersCollection])
    })

    it('should throw for unknown collection', async () => {
      await expect(
        strategy.create({
          collection: 'unknown',
          data: { title: 'Test' },
        })
      ).rejects.toThrow(/not found/)
    })
  })

  describe('transactions', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
    })

    it('should begin a transaction', async () => {
      const txId = await strategy.beginTransaction()
      expect(txId).toMatch(/^tx_/)
    })

    it('should commit a transaction', async () => {
      const txId = await strategy.beginTransaction()
      await expect(strategy.commitTransaction(txId)).resolves.toBeUndefined()
    })

    it('should rollback a transaction', async () => {
      const txId = await strategy.beginTransaction()
      await expect(strategy.rollbackTransaction(txId)).resolves.toBeUndefined()
    })

    it('should throw on invalid transaction', async () => {
      await expect(strategy.commitTransaction('invalid-tx')).rejects.toThrow(/not found/)
    })
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('factory functions', () => {
  it('should create a DrizzleStorageStrategy instance', () => {
    const mockDb = createMockDb()
    const strategy = createDrizzleStrategy({
      db: mockDb as any,
    })

    expect(strategy).toBeInstanceOf(DrizzleStorageStrategy)
  })

  it('should create a SchemaBuilder instance', () => {
    const builder = createSchemaBuilder()
    expect(builder).toBeInstanceOf(SchemaBuilder)
  })
})
