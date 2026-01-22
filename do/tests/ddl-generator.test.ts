/**
 * DDL Generator Tests (do-lekf.3)
 *
 * Tests for SQLite DDL generation from unified schema definitions.
 *
 * @module do/tests/ddl-generator.test
 */
import { describe, it, expect } from 'vitest'
import {
  generateEntityDDL,
  generateSchemaDDL,
  generateTableExistsQuery,
  generateMigrationDDL,
} from '../schema/ddl'
import { parseSchema, parseEntitySchema } from '../schema/parser'

// =============================================================================
// generateEntityDDL Tests
// =============================================================================

describe('generateEntityDDL', () => {
  describe('basic table generation', () => {
    it('should generate CREATE TABLE with standard DO columns', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('CREATE TABLE IF NOT EXISTS "product"')
      expect(result.ddl).toContain('"$id" TEXT PRIMARY KEY')
      expect(result.ddl).toContain('"$type" TEXT NOT NULL')
      expect(result.ddl).toContain('"$createdAt" INTEGER NOT NULL')
      expect(result.ddl).toContain('"$updatedAt" INTEGER NOT NULL')
      expect(result.entities).toContain('Product')
    })

    it('should generate column for required field', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"name" TEXT NOT NULL')
    })

    it('should generate column for optional field', () => {
      const entity = parseEntitySchema('Product', {
        description: 'string?',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"description" TEXT')
      expect(result.ddl).not.toContain('"description" TEXT NOT NULL')
    })

    it('should generate UNIQUE constraint for indexed field', () => {
      const entity = parseEntitySchema('Product', {
        sku: 'string!#',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('UNIQUE ("sku")')
    })

    it('should generate JSON column for array types', () => {
      const entity = parseEntitySchema('Product', {
        tags: 'string[]',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"tags" TEXT')
    })
  })

  describe('type mapping', () => {
    it('should map string types to TEXT', () => {
      const entity = parseEntitySchema('Test', {
        text: 'text',
        markdown: 'markdown',
        url: 'url',
        uuid: 'uuid',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"text" TEXT')
      expect(result.ddl).toContain('"markdown" TEXT')
      expect(result.ddl).toContain('"url" TEXT')
      expect(result.ddl).toContain('"uuid" TEXT')
    })

    it('should map integer types to INTEGER', () => {
      const entity = parseEntitySchema('Test', {
        count: 'int',
        amount: 'long',
        bigValue: 'bigint',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"count" INTEGER')
      expect(result.ddl).toContain('"amount" INTEGER')
      expect(result.ddl).toContain('"bigValue" INTEGER')
    })

    it('should map float types to REAL', () => {
      const entity = parseEntitySchema('Test', {
        price: 'float',
        rate: 'double',
        value: 'number',
        amount: 'decimal(10,2)',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"price" REAL')
      expect(result.ddl).toContain('"rate" REAL')
      expect(result.ddl).toContain('"value" REAL')
      expect(result.ddl).toContain('"amount" REAL')
    })

    it('should map boolean to INTEGER', () => {
      const entity = parseEntitySchema('Test', {
        active: 'boolean',
        enabled: 'bool',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"active" INTEGER')
      expect(result.ddl).toContain('"enabled" INTEGER')
    })

    it('should map timestamp types to INTEGER', () => {
      const entity = parseEntitySchema('Test', {
        createdAt: 'timestamp',
        updatedAt: 'datetime',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"createdAt" INTEGER')
      expect(result.ddl).toContain('"updatedAt" INTEGER')
    })

    it('should map json to TEXT', () => {
      const entity = parseEntitySchema('Test', {
        metadata: 'json',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"metadata" TEXT')
    })

    it('should map binary to BLOB', () => {
      const entity = parseEntitySchema('Test', {
        data: 'binary',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"data" BLOB')
    })
  })

  describe('index generation', () => {
    it('should generate index on $type column', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity)

      expect(result.indexes).toContain(
        'CREATE INDEX IF NOT EXISTS "idx_product_type" ON "product"("$type");'
      )
    })

    it('should generate index on $createdAt column', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity)

      expect(result.indexes).toContain(
        'CREATE INDEX IF NOT EXISTS "idx_product_created_at" ON "product"("$createdAt" DESC);'
      )
    })

    it('should generate index for foreign key fields', () => {
      const entity = parseEntitySchema('Product', {
        vendor: '-> Vendor?',
      })

      const result = generateEntityDDL(entity)

      expect(result.indexes).toContain(
        'CREATE INDEX IF NOT EXISTS "idx_product_vendor" ON "product"("vendor");'
      )
    })

    it('should generate composite indexes from $index directive', () => {
      const entity = parseEntitySchema('Product', {
        $index: [['category', 'status']],
        category: 'string',
        status: 'string',
      })

      const result = generateEntityDDL(entity)

      expect(result.indexes).toContain(
        'CREATE INDEX IF NOT EXISTS "idx_product_category_status" ON "product"("category", "status");'
      )
    })
  })

  describe('foreign key generation', () => {
    it('should generate foreign key for forward relation', () => {
      const entity = parseEntitySchema('Product', {
        vendor: '-> Vendor?',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('FOREIGN KEY ("vendor") REFERENCES "vendor"("$id")')
    })

    it('should not generate column for backward relation', () => {
      const entity = parseEntitySchema('Vendor', {
        products: '<- Product.vendor[]',
      })

      const result = generateEntityDDL(entity)

      // Backward relations are virtual - no column created
      expect(result.ddl).not.toContain('"products"')
    })
  })

  describe('prompt fields', () => {
    it('should generate TEXT column for AI-generated fields', () => {
      const entity = parseEntitySchema('Product', {
        description: 'A compelling product description',
      })

      const result = generateEntityDDL(entity)

      expect(result.ddl).toContain('"description" TEXT')
    })
  })

  describe('options', () => {
    it('should apply table prefix', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity, { tablePrefix: 'app_' })

      expect(result.ddl).toContain('CREATE TABLE IF NOT EXISTS "app_product"')
    })

    it('should omit IF NOT EXISTS when option is false', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity, { ifNotExists: false })

      expect(result.ddl).toContain('CREATE TABLE "product"')
      expect(result.ddl).not.toContain('IF NOT EXISTS')
    })

    it('should skip foreign keys when option is false', () => {
      const entity = parseEntitySchema('Product', {
        vendor: '-> Vendor?',
      })

      const result = generateEntityDDL(entity, { foreignKeys: false })

      expect(result.ddl).not.toContain('FOREIGN KEY')
    })

    it('should skip indexes when option is false', () => {
      const entity = parseEntitySchema('Product', {
        name: 'string!',
      })

      const result = generateEntityDDL(entity, { indexes: false })

      // Should still have type and created_at indexes
      expect(result.indexes.length).toBe(2)
    })
  })
})

// =============================================================================
// generateSchemaDDL Tests
// =============================================================================

describe('generateSchemaDDL', () => {
  it('should generate DDL for multiple entities', () => {
    const schema = parseSchema({
      Product: {
        sku: 'string!#',
        name: 'string!',
        price: 'decimal(10,2)!',
      },
      Vendor: {
        name: 'string!',
        email: 'string!#',
      },
    })

    const result = generateSchemaDDL(schema.entities)

    expect(result.entities).toContain('Product')
    expect(result.entities).toContain('Vendor')
    expect(result.tables.length).toBe(2)
    expect(result.ddl).toContain('CREATE TABLE IF NOT EXISTS "product"')
    expect(result.ddl).toContain('CREATE TABLE IF NOT EXISTS "vendor"')
  })

  it('should generate foreign keys between related entities', () => {
    const schema = parseSchema({
      Product: {
        name: 'string!',
        vendor: '-> Vendor?',
      },
      Vendor: {
        name: 'string!',
        products: '<- Product.vendor[]',
      },
    })

    const result = generateSchemaDDL(schema.entities)

    expect(result.ddl).toContain('FOREIGN KEY ("vendor") REFERENCES "vendor"("$id")')
  })

  it('should handle complex schema with multiple relations', () => {
    const schema = parseSchema({
      User: {
        email: 'string!#',
        name: 'string!',
      },
      Post: {
        title: 'string!',
        content: 'markdown',
        author: '-> User',
        tags: 'string[]',
      },
      Comment: {
        body: 'string!',
        author: '-> User',
        post: '-> Post',
      },
    })

    const result = generateSchemaDDL(schema.entities)

    expect(result.entities).toHaveLength(3)
    expect(result.ddl).toContain('FOREIGN KEY ("author") REFERENCES "user"("$id")')
    expect(result.ddl).toContain('FOREIGN KEY ("post") REFERENCES "post"("$id")')
  })
})

// =============================================================================
// generateTableExistsQuery Tests
// =============================================================================

describe('generateTableExistsQuery', () => {
  it('should generate query to check table existence', () => {
    const query = generateTableExistsQuery('Product')

    expect(query).toBe("SELECT name FROM sqlite_master WHERE type='table' AND name='product';")
  })

  it('should include table prefix', () => {
    const query = generateTableExistsQuery('Product', 'app_')

    expect(query).toBe("SELECT name FROM sqlite_master WHERE type='table' AND name='app_product';")
  })
})

// =============================================================================
// generateMigrationDDL Tests
// =============================================================================

describe('generateMigrationDDL', () => {
  it('should generate CREATE TABLE for new entity', () => {
    const newEntity = parseEntitySchema('Product', {
      name: 'string!',
      price: 'decimal(10,2)',
    })

    const statements = generateMigrationDDL(null, newEntity)

    expect(statements.length).toBeGreaterThan(0)
    expect(statements.some(s => s.includes('CREATE TABLE'))).toBe(true)
  })

  it('should generate ALTER TABLE ADD COLUMN for new fields', () => {
    const oldEntity = parseEntitySchema('Product', {
      name: 'string!',
    })

    const newEntity = parseEntitySchema('Product', {
      name: 'string!',
      description: 'string?',
      price: 'decimal(10,2)',
    })

    const statements = generateMigrationDDL(oldEntity, newEntity)

    expect(statements.some(s => s.includes('ALTER TABLE "product" ADD COLUMN "description"'))).toBe(true)
    expect(statements.some(s => s.includes('ALTER TABLE "product" ADD COLUMN "price"'))).toBe(true)
  })

  it('should add warning comment for removed fields', () => {
    const oldEntity = parseEntitySchema('Product', {
      name: 'string!',
      oldField: 'string',
    })

    const newEntity = parseEntitySchema('Product', {
      name: 'string!',
    })

    const statements = generateMigrationDDL(oldEntity, newEntity)

    expect(statements.some(s => s.includes('WARNING'))).toBe(true)
    expect(statements.some(s => s.includes('oldField'))).toBe(true)
  })

  it('should not generate ALTER for backward relations', () => {
    const oldEntity = parseEntitySchema('Vendor', {
      name: 'string!',
    })

    const newEntity = parseEntitySchema('Vendor', {
      name: 'string!',
      products: '<- Product.vendor[]',
    })

    const statements = generateMigrationDDL(oldEntity, newEntity)

    // Backward relations are virtual, no column needed
    expect(statements.some(s => s.includes('products'))).toBe(false)
  })
})

// =============================================================================
// Integration Tests - Full Schema to DDL
// =============================================================================

describe('Full Schema Integration', () => {
  it('should generate valid SQLite DDL for e-commerce schema', () => {
    const schema = parseSchema({
      Product: {
        $index: [['category', 'status']],
        sku: 'string!#',
        name: 'string!',
        description: 'A compelling product description',
        price: 'decimal(10,2)!',
        category: 'string',
        status: 'string',
        vendor: '-> Vendor?',
        tags: 'string[]',
      },
      Vendor: {
        name: 'string!',
        email: 'string!#',
        active: 'boolean',
        products: '<- Product.vendor[]',
      },
      Order: {
        orderNumber: 'string!#',
        status: 'string!',
        total: 'decimal(10,2)!',
        customer: '-> Customer',
        createdAt: 'timestamp',
      },
      Customer: {
        email: 'string!#',
        name: 'string!',
        orders: '<- Order.customer[]',
      },
    })

    const result = generateSchemaDDL(schema.entities)

    // Verify all tables created
    expect(result.tables.length).toBe(4)

    // Verify indexes
    expect(result.indexes.some(i => i.includes('idx_product_category_status'))).toBe(true)

    // Verify foreign keys
    expect(result.ddl).toContain('FOREIGN KEY ("vendor") REFERENCES "vendor"("$id")')
    expect(result.ddl).toContain('FOREIGN KEY ("customer") REFERENCES "customer"("$id")')

    // Verify unique constraints
    expect(result.ddl).toContain('UNIQUE ("sku")')
    expect(result.ddl).toContain('UNIQUE ("email")')
    expect(result.ddl).toContain('UNIQUE ("orderNumber")')

    // DDL should be non-empty
    expect(result.ddl.length).toBeGreaterThan(0)
  })

  it('should generate valid SQLite DDL for blog schema', () => {
    const schema = parseSchema({
      User: {
        $fts: ['name', 'bio'],
        email: 'string!#',
        name: 'string!',
        bio: 'string?',
      },
      Post: {
        $fts: ['title', 'content'],
        title: 'string!',
        slug: 'string!#',
        content: 'markdown',
        excerpt: 'A brief summary of the post',
        author: '-> User',
        publishedAt: 'timestamp?',
        tags: 'string[]',
      },
      Comment: {
        body: 'string!',
        author: '-> User',
        post: '-> Post',
        approved: 'boolean',
      },
    })

    const result = generateSchemaDDL(schema.entities, {
      fullTextSearch: true,
    })

    // Verify FTS tables are created
    expect(result.fts.some(s => s.includes('user_fts'))).toBe(true)
    expect(result.fts.some(s => s.includes('post_fts'))).toBe(true)

    // Verify triggers for FTS sync
    expect(result.fts.some(s => s.includes('TRIGGER'))).toBe(true)
  })
})
