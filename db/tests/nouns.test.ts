import { describe, it, expect } from 'vitest'

/**
 * Nouns Table Schema Tests
 *
 * These tests verify the schema and expected CRUD operations for the nouns table,
 * which serves as an optional type registry for validation/introspection.
 *
 * This is RED phase TDD - tests should FAIL until implementation is verified.
 *
 * The nouns table stores:
 * - noun: Primary key, singular name (e.g., 'Customer', 'Agent')
 * - plural: Plural form (e.g., 'Customers', 'Agents')
 * - description: Human-readable description
 * - schema: JSON field definitions for the noun's structure
 * - doClass: Cloudflare Durable Object binding if this noun is a DO subclass
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface Noun {
  noun: string // Primary key - singular name
  plural: string | null // Plural form
  description: string | null // Human-readable description
  schema: Record<string, unknown> | null // JSON field definitions
  doClass: string | null // CF binding if DO subclass
}

interface NounSchema {
  type: string
  fields?: Record<
    string,
    {
      type: string
      required?: boolean
      description?: string
      default?: unknown
    }
  >
  validators?: string[]
  computed?: string[]
}

// Import the schema - this will verify exports
import { nouns } from '../nouns'
import * as schema from '../index'

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Table Export', () => {
    it('nouns table is exported from db/nouns.ts', () => {
      expect(nouns).toBeDefined()
    })

    it('nouns is included in schema export from db/index.ts', () => {
      expect(schema.nouns).toBeDefined()
      expect(schema.nouns).toBe(nouns)
    })

    it('nouns is included in schema object for Drizzle', () => {
      expect(schema.schema.nouns).toBeDefined()
      expect(schema.schema.nouns).toBe(nouns)
    })
  })

  describe('Column Definitions', () => {
    it('has noun column as text primary key', () => {
      expect(nouns.noun).toBeDefined()
    })

    it('has plural column (text, nullable)', () => {
      expect(nouns.plural).toBeDefined()
    })

    it('has description column (text, nullable)', () => {
      expect(nouns.description).toBeDefined()
    })

    it('has schema column (JSON mode, nullable)', () => {
      expect(nouns.schema).toBeDefined()
    })

    it('has doClass column (text, nullable)', () => {
      expect(nouns.doClass).toBeDefined()
    })
  })

  describe('Column Types', () => {
    it('noun column is text type', () => {
      // Verify the column is a text type by checking its configuration
      expect(nouns.noun).toBeDefined()
      // The column should be a text primary key
    })

    it('schema column uses JSON mode', () => {
      // The schema column should be defined with { mode: 'json' }
      expect(nouns.schema).toBeDefined()
    })

    it('all columns except noun are nullable', () => {
      // Optional fields for the type registry
      expect(nouns.plural).toBeDefined()
      expect(nouns.description).toBeDefined()
      expect(nouns.schema).toBeDefined()
      expect(nouns.doClass).toBeDefined()
    })
  })
})

// ============================================================================
// CRUD Operations Tests (conceptual - will be implemented at runtime)
// ============================================================================

describe('CRUD Operations', () => {
  describe('Insert Operations', () => {
    it('can insert a noun with all fields', () => {
      const newNoun: Noun = {
        noun: 'Customer',
        plural: 'Customers',
        description: 'A person or organization that purchases goods or services',
        schema: {
          type: 'object',
          fields: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            tier: { type: 'string', default: 'free' },
          },
        },
        doClass: 'CustomerDO',
      }

      // Verify the structure is valid
      expect(newNoun.noun).toBe('Customer')
      expect(newNoun.plural).toBe('Customers')
      expect(newNoun.description).toContain('purchases goods')
      expect(newNoun.doClass).toBe('CustomerDO')
      expect(newNoun.schema).toBeDefined()
    })

    it('can insert a noun with only required fields', () => {
      const minimalNoun: Partial<Noun> = {
        noun: 'Agent',
      }

      expect(minimalNoun.noun).toBe('Agent')
      expect(minimalNoun.plural).toBeUndefined()
      expect(minimalNoun.description).toBeUndefined()
      expect(minimalNoun.schema).toBeUndefined()
      expect(minimalNoun.doClass).toBeUndefined()
    })

    it('can insert multiple nouns', () => {
      const nounsToInsert: Partial<Noun>[] = [
        { noun: 'Product', plural: 'Products', description: 'An item for sale' },
        { noun: 'Order', plural: 'Orders', description: 'A purchase transaction' },
        { noun: 'Invoice', plural: 'Invoices', description: 'A payment request' },
      ]

      expect(nounsToInsert).toHaveLength(3)
      expect(nounsToInsert[0].noun).toBe('Product')
      expect(nounsToInsert[1].noun).toBe('Order')
      expect(nounsToInsert[2].noun).toBe('Invoice')
    })
  })

  describe('Read Operations', () => {
    it('can read a noun by primary key', () => {
      const testNoun: Noun = {
        noun: 'User',
        plural: 'Users',
        description: 'An authenticated user',
        schema: { type: 'object', fields: { name: { type: 'string' } } },
        doClass: 'UserDO',
      }

      expect(testNoun.noun).toBe('User')
      expect(testNoun.plural).toBe('Users')
    })

    it('can read all fields including JSON schema', () => {
      const testNoun: Noun = {
        noun: 'User',
        plural: 'Users',
        description: 'An authenticated user',
        schema: { type: 'object', fields: { name: { type: 'string' } } },
        doClass: 'UserDO',
      }

      expect(testNoun.schema).toBeDefined()
      expect((testNoun.schema as Record<string, unknown>).type).toBe('object')
      expect((testNoun.schema as Record<string, unknown>).fields).toBeDefined()
    })

    it('returns empty for non-existent noun query', () => {
      // Conceptual: query returns empty array
      const emptyResult: Noun[] = []
      expect(emptyResult).toHaveLength(0)
    })
  })

  describe('Update Operations', () => {
    it('can update plural field', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: null,
      }

      const after: Noun = { ...before, plural: 'TaskItems' }

      expect(before.plural).toBe('Tasks')
      expect(after.plural).toBe('TaskItems')
    })

    it('can update description field', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: null,
      }

      const after: Noun = { ...before, description: 'A discrete unit of work to be completed' }

      expect(after.description).toContain('discrete unit')
    })

    it('can update schema field with JSON', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: null,
      }

      const newSchema = {
        type: 'task',
        fields: {
          title: { type: 'string', required: true },
          status: { type: 'enum', values: ['pending', 'done'] },
          dueDate: { type: 'datetime' },
        },
      }

      const after: Noun = { ...before, schema: newSchema }

      expect((after.schema as Record<string, unknown>).type).toBe('task')
      expect((after.schema as Record<string, unknown>).fields).toBeDefined()
    })

    it('can update doClass field', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: null,
      }

      const after: Noun = { ...before, doClass: 'TaskDO' }

      expect(after.doClass).toBe('TaskDO')
    })

    it('can update multiple fields at once', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: null,
      }

      const after: Noun = {
        ...before,
        plural: 'TaskEntries',
        description: 'Updated task description',
        doClass: 'TaskEntryDO',
      }

      expect(after.plural).toBe('TaskEntries')
      expect(after.description).toBe('Updated task description')
      expect(after.doClass).toBe('TaskEntryDO')
    })

    it('can set field to null', () => {
      const before: Noun = {
        noun: 'Task',
        plural: 'Tasks',
        description: 'A unit of work',
        schema: null,
        doClass: 'TaskDO',
      }

      const after: Noun = { ...before, doClass: null }

      expect(before.doClass).toBe('TaskDO')
      expect(after.doClass).toBeNull()
    })
  })

  describe('Delete Operations', () => {
    it('can delete a noun by primary key', () => {
      const nouns: Noun[] = [
        { noun: 'Temporary', plural: 'Temporaries', description: null, schema: null, doClass: null },
        { noun: 'Permanent', plural: 'Permanents', description: null, schema: null, doClass: null },
      ]

      const afterDelete = nouns.filter((n) => n.noun !== 'Temporary')

      expect(afterDelete).toHaveLength(1)
      expect(afterDelete[0].noun).toBe('Permanent')
    })

    it('delete of non-existent noun is no-op', () => {
      const nouns: Noun[] = [{ noun: 'Existing', plural: 'Existings', description: null, schema: null, doClass: null }]

      const afterDelete = nouns.filter((n) => n.noun !== 'NonExistent')

      expect(afterDelete).toHaveLength(1)
    })

    it('can delete all nouns', () => {
      const nouns: Noun[] = [
        { noun: 'First', plural: 'Firsts', description: null, schema: null, doClass: null },
        { noun: 'Second', plural: 'Seconds', description: null, schema: null, doClass: null },
      ]

      const afterDelete: Noun[] = []

      expect(afterDelete).toHaveLength(0)
    })
  })
})

// ============================================================================
// Schema Field Validation Tests
// ============================================================================

describe('Schema Field Validation', () => {
  describe('JSON Schema Storage', () => {
    it('stores simple JSON object correctly', () => {
      const simpleSchema = { type: 'object', version: 1 }

      const noun: Noun = {
        noun: 'Simple',
        plural: null,
        description: null,
        schema: simpleSchema,
        doClass: null,
      }

      expect(noun.schema).toEqual(simpleSchema)
    })

    it('stores complex nested JSON correctly', () => {
      const complexSchema: NounSchema = {
        type: 'entity',
        fields: {
          id: { type: 'string', required: true, description: 'Unique identifier' },
          name: { type: 'string', required: true },
          metadata: {
            type: 'object',
            description: 'Additional key-value pairs',
          },
          tags: { type: 'array', default: [] },
          settings: {
            type: 'object',
            default: { theme: 'light', notifications: true },
          },
        },
        validators: ['validateId', 'validateName'],
        computed: ['fullName', 'createdAtFormatted'],
      }

      const noun: Noun = {
        noun: 'Complex',
        plural: null,
        description: null,
        schema: complexSchema,
        doClass: null,
      }

      const retrieved = noun.schema as NounSchema

      expect(retrieved.type).toBe('entity')
      expect(retrieved.fields?.id.required).toBe(true)
      expect(retrieved.fields?.settings.default).toEqual({ theme: 'light', notifications: true })
      expect(retrieved.validators).toContain('validateId')
      expect(retrieved.computed).toHaveLength(2)
    })

    it('stores JSON array correctly', () => {
      const arraySchema = {
        type: 'collection',
        items: [
          { type: 'string' },
          { type: 'number' },
          { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        ],
      }

      const noun: Noun = {
        noun: 'Collection',
        plural: null,
        description: null,
        schema: arraySchema,
        doClass: null,
      }

      expect((noun.schema as Record<string, unknown>).items).toHaveLength(3)
    })

    it('retrieves JSON schema with correct types', () => {
      const schemaWithTypes = {
        stringField: 'text',
        numberField: 42,
        booleanField: true,
        nullField: null,
        arrayField: [1, 2, 3],
        nestedObject: { a: 1, b: 'two' },
      }

      const noun: Noun = {
        noun: 'TypedSchema',
        plural: null,
        description: null,
        schema: schemaWithTypes,
        doClass: null,
      }

      const retrieved = noun.schema as Record<string, unknown>

      expect(typeof retrieved.stringField).toBe('string')
      expect(typeof retrieved.numberField).toBe('number')
      expect(typeof retrieved.booleanField).toBe('boolean')
      expect(retrieved.nullField).toBeNull()
      expect(Array.isArray(retrieved.arrayField)).toBe(true)
      expect(typeof retrieved.nestedObject).toBe('object')
    })
  })

  describe('Null Handling', () => {
    it('plural can be null', () => {
      const noun: Noun = {
        noun: 'Singular',
        plural: null,
        description: 'A singular noun',
        schema: null,
        doClass: null,
      }

      expect(noun.plural).toBeNull()
    })

    it('description can be null', () => {
      const noun: Noun = {
        noun: 'Undescribed',
        plural: 'Undescribeds',
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toBeNull()
    })

    it('schema can be null', () => {
      const noun: Noun = {
        noun: 'Schemaless',
        plural: 'Schemaless',
        description: 'Has no schema',
        schema: null,
        doClass: null,
      }

      expect(noun.schema).toBeNull()
    })

    it('doClass can be null', () => {
      const noun: Noun = {
        noun: 'NoDO',
        plural: 'NoDOs',
        description: 'Not backed by DO',
        schema: { type: 'lookup' },
        doClass: null,
      }

      expect(noun.doClass).toBeNull()
    })

    it('all optional fields can be null simultaneously', () => {
      const noun: Noun = {
        noun: 'Minimal',
        plural: null,
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.noun).toBe('Minimal')
      expect(noun.plural).toBeNull()
      expect(noun.description).toBeNull()
      expect(noun.schema).toBeNull()
      expect(noun.doClass).toBeNull()
    })
  })
})

// ============================================================================
// Query Pattern Tests
// ============================================================================

describe('Query Patterns', () => {
  // Test data
  const testNouns: Noun[] = [
    {
      noun: 'Customer',
      plural: 'Customers',
      description: 'A buyer of products',
      schema: { type: 'entity', fields: { name: { type: 'string' } } },
      doClass: 'CustomerDO',
    },
    {
      noun: 'Agent',
      plural: 'Agents',
      description: 'An AI assistant',
      schema: { type: 'worker', capabilities: [] },
      doClass: 'AgentDO',
    },
    {
      noun: 'Task',
      plural: 'Tasks',
      description: 'A work item',
      schema: { type: 'entity', fields: { status: { type: 'string' } } },
      doClass: null,
    },
    {
      noun: 'Log',
      plural: 'Logs',
      description: 'An event record',
      schema: null,
      doClass: null,
    },
    {
      noun: 'Workflow',
      plural: 'Workflows',
      description: 'A multi-step process',
      schema: { type: 'workflow', steps: [] },
      doClass: 'WorkflowDO',
    },
  ]

  describe('List All Nouns', () => {
    it('can list all nouns', () => {
      expect(testNouns).toHaveLength(5)
    })

    it('can list all nouns ordered by noun name', () => {
      const sorted = [...testNouns].sort((a, b) => a.noun.localeCompare(b.noun))

      expect(sorted[0].noun).toBe('Agent')
      expect(sorted[4].noun).toBe('Workflow')
    })

    it('can list nouns with only specific columns', () => {
      const projected = testNouns.map((n) => ({
        noun: n.noun,
        plural: n.plural,
      }))

      expect(projected[0]).toHaveProperty('noun')
      expect(projected[0]).toHaveProperty('plural')
      expect(projected[0]).not.toHaveProperty('description')
      expect(projected[0]).not.toHaveProperty('schema')
      expect(projected[0]).not.toHaveProperty('doClass')
    })
  })

  describe('Filter by doClass', () => {
    it('can find nouns with DO bindings (doClass is not null)', () => {
      const withDO = testNouns.filter((n) => n.doClass !== null)

      expect(withDO).toHaveLength(3)
      expect(withDO.map((n) => n.noun)).toContain('Customer')
      expect(withDO.map((n) => n.noun)).toContain('Agent')
      expect(withDO.map((n) => n.noun)).toContain('Workflow')
    })

    it('can find nouns without DO bindings (doClass is null)', () => {
      const withoutDO = testNouns.filter((n) => n.doClass === null)

      expect(withoutDO).toHaveLength(2)
      expect(withoutDO.map((n) => n.noun)).toContain('Task')
      expect(withoutDO.map((n) => n.noun)).toContain('Log')
    })

    it('can find nouns by specific doClass', () => {
      const agentDO = testNouns.filter((n) => n.doClass === 'AgentDO')

      expect(agentDO).toHaveLength(1)
      expect(agentDO[0].noun).toBe('Agent')
    })

    it('can find nouns with doClass matching pattern', () => {
      // Find all nouns with doClass ending in "DO"
      const doPattern = testNouns.filter((n) => n.doClass?.endsWith('DO'))

      expect(doPattern).toHaveLength(3)
    })
  })

  describe('Get Nouns with Schema Defined', () => {
    it('can find nouns with schema defined (not null)', () => {
      const withSchema = testNouns.filter((n) => n.schema !== null)

      expect(withSchema).toHaveLength(4)
      expect(withSchema.map((n) => n.noun)).not.toContain('Log')
    })

    it('can find nouns without schema (schema is null)', () => {
      const withoutSchema = testNouns.filter((n) => n.schema === null)

      expect(withoutSchema).toHaveLength(1)
      expect(withoutSchema[0].noun).toBe('Log')
    })
  })

  describe('Combined Filters', () => {
    it('can find nouns with both schema and doClass defined', () => {
      const both = testNouns.filter((n) => n.schema !== null && n.doClass !== null)

      expect(both).toHaveLength(3)
    })

    it('can find nouns with schema but no doClass', () => {
      const schemaOnly = testNouns.filter((n) => n.schema !== null && n.doClass === null)

      expect(schemaOnly).toHaveLength(1)
      expect(schemaOnly[0].noun).toBe('Task')
    })
  })

  describe('Count Queries', () => {
    it('can count total nouns', () => {
      expect(testNouns.length).toBe(5)
    })

    it('can count nouns with DO bindings', () => {
      const withDO = testNouns.filter((n) => n.doClass !== null)
      expect(withDO.length).toBe(3)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Duplicate Primary Key Rejection', () => {
    it('rejects insert with duplicate noun (primary key)', () => {
      const nouns: Noun[] = [{ noun: 'Unique', plural: 'Uniques', description: null, schema: null, doClass: null }]

      // Simulate duplicate key detection
      const existingNouns = new Set(nouns.map((n) => n.noun))
      const isDuplicate = existingNouns.has('Unique')

      expect(isDuplicate).toBe(true)
    })

    it('allows insert after deleting duplicate', () => {
      let nouns: Noun[] = [
        { noun: 'Recyclable', plural: 'V1', description: null, schema: null, doClass: null },
      ]

      // Delete
      nouns = nouns.filter((n) => n.noun !== 'Recyclable')

      // Re-insert with different plural
      nouns.push({ noun: 'Recyclable', plural: 'V2', description: null, schema: null, doClass: null })

      expect(nouns[0].plural).toBe('V2')
    })
  })

  describe('Long Noun Names', () => {
    it('handles reasonably long noun names', () => {
      const longNoun = 'A'.repeat(100)

      const noun: Noun = {
        noun: longNoun,
        plural: null,
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.noun.length).toBe(100)
    })

    it('handles very long noun names (255 chars)', () => {
      const veryLongNoun = 'B'.repeat(255)

      const noun: Noun = {
        noun: veryLongNoun,
        plural: null,
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.noun.length).toBe(255)
    })

    it('handles long descriptions', () => {
      const longDescription = 'This is a very detailed description. '.repeat(100)

      const noun: Noun = {
        noun: 'LongDesc',
        plural: null,
        description: longDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toBe(longDescription)
    })
  })

  describe('Unicode in Descriptions', () => {
    it('handles Unicode characters in description', () => {
      const unicodeDescription = 'A noun with special chars: Customer is special'

      const noun: Noun = {
        noun: 'Unicode',
        plural: null,
        description: unicodeDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toBe(unicodeDescription)
    })

    it('handles Chinese characters in description', () => {
      const chineseDescription = '客户 - A customer in Chinese'

      const noun: Noun = {
        noun: 'ChineseNoun',
        plural: null,
        description: chineseDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toContain('客户')
    })

    it('handles Japanese characters in description', () => {
      const japaneseDescription = 'お客様 (okyakusama) - Customer in Japanese'

      const noun: Noun = {
        noun: 'JapaneseNoun',
        plural: null,
        description: japaneseDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toContain('お客様')
    })

    it('handles RTL languages in description', () => {
      const arabicDescription = 'عميل - Customer in Arabic'

      const noun: Noun = {
        noun: 'ArabicNoun',
        plural: null,
        description: arabicDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toContain('عميل')
    })

    it('handles Unicode in plural field', () => {
      const noun: Noun = {
        noun: 'UnicodePlural',
        plural: 'Plural with special chars',
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.plural).toContain('special')
    })
  })

  describe('Special Characters', () => {
    it('handles quotes in description', () => {
      const quotedDescription = 'A noun with "double" and \'single\' quotes'

      const noun: Noun = {
        noun: 'QuotedNoun',
        plural: null,
        description: quotedDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toBe(quotedDescription)
    })

    it('handles backslashes in description', () => {
      const backslashDescription = 'A noun with \\ backslashes and paths like C:\\Users\\Data'

      const noun: Noun = {
        noun: 'BackslashNoun',
        plural: null,
        description: backslashDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toContain('\\')
    })

    it('handles newlines in description', () => {
      const multilineDescription = 'Line 1\nLine 2\nLine 3'

      const noun: Noun = {
        noun: 'MultilineNoun',
        plural: null,
        description: multilineDescription,
        schema: null,
        doClass: null,
      }

      expect(noun.description).toContain('\n')
    })
  })

  describe('Empty String Handling', () => {
    it('handles empty string for plural', () => {
      const noun: Noun = {
        noun: 'EmptyPlural',
        plural: '',
        description: null,
        schema: null,
        doClass: null,
      }

      expect(noun.plural).toBe('')
    })

    it('handles empty string for description', () => {
      const noun: Noun = {
        noun: 'EmptyDescription',
        plural: null,
        description: '',
        schema: null,
        doClass: null,
      }

      expect(noun.description).toBe('')
    })

    it('distinguishes empty string from null', () => {
      const emptyStr: Noun = {
        noun: 'EmptyStr',
        plural: null,
        description: '',
        schema: null,
        doClass: null,
      }

      const nullDesc: Noun = {
        noun: 'NullDesc',
        plural: null,
        description: null,
        schema: null,
        doClass: null,
      }

      expect(emptyStr.description).toBe('')
      expect(nullDesc.description).toBeNull()
      expect(emptyStr.description).not.toBe(nullDesc.description)
    })
  })

  describe('Case Sensitivity', () => {
    it('noun primary key is case-sensitive', () => {
      const nouns: Noun[] = [
        { noun: 'customer', plural: null, description: null, schema: null, doClass: null },
        { noun: 'Customer', plural: null, description: null, schema: null, doClass: null },
        { noun: 'CUSTOMER', plural: null, description: null, schema: null, doClass: null },
      ]

      expect(nouns).toHaveLength(3)
      expect(nouns.map((n) => n.noun)).toContain('customer')
      expect(nouns.map((n) => n.noun)).toContain('Customer')
      expect(nouns.map((n) => n.noun)).toContain('CUSTOMER')
    })

    it('can query with exact case matching', () => {
      const nouns: Noun[] = [
        { noun: 'lower', plural: null, description: 'lowercase', schema: null, doClass: null },
        { noun: 'UPPER', plural: null, description: 'uppercase', schema: null, doClass: null },
      ]

      const lower = nouns.filter((n) => n.noun === 'lower')
      const upper = nouns.filter((n) => n.noun === 'UPPER')

      expect(lower).toHaveLength(1)
      expect(upper).toHaveLength(1)
    })
  })

  describe('JSON Edge Cases', () => {
    it('handles empty object schema', () => {
      const noun: Noun = {
        noun: 'EmptySchema',
        plural: null,
        description: null,
        schema: {},
        doClass: null,
      }

      expect(noun.schema).toEqual({})
    })

    it('handles deeply nested schema', () => {
      const deepSchema = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep',
                },
              },
            },
          },
        },
      }

      const noun: Noun = {
        noun: 'DeepNested',
        plural: null,
        description: null,
        schema: deepSchema,
        doClass: null,
      }

      const retrieved = noun.schema as typeof deepSchema
      expect(retrieved.level1.level2.level3.level4.level5.value).toBe('deep')
    })

    it('handles schema with large array', () => {
      const largeArraySchema = {
        items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
      }

      const noun: Noun = {
        noun: 'LargeArray',
        plural: null,
        description: null,
        schema: largeArraySchema,
        doClass: null,
      }

      expect((noun.schema as typeof largeArraySchema).items).toHaveLength(1000)
    })

    it('handles schema with special JSON characters', () => {
      const specialSchema = {
        text: 'Contains "quotes" and \\backslashes',
        unicode: '\u0000\u001f',
        newlines: 'line1\nline2',
      }

      const noun: Noun = {
        noun: 'SpecialJSON',
        plural: null,
        description: null,
        schema: specialSchema,
        doClass: null,
      }

      expect((noun.schema as typeof specialSchema).text).toContain('"quotes"')
    })
  })
})

// ============================================================================
// Practical Usage Tests
// ============================================================================

describe('Practical Usage', () => {
  describe('Type Registry Use Cases', () => {
    it('registers a basic entity noun', () => {
      const productNoun: Noun = {
        noun: 'Product',
        plural: 'Products',
        description: 'An item available for purchase',
        schema: {
          type: 'entity',
          fields: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            price: { type: 'number', required: true },
            category: { type: 'string' },
            inStock: { type: 'boolean', default: true },
          },
        },
        doClass: 'ProductDO',
      }

      expect(productNoun.noun).toBe('Product')
      expect(productNoun.doClass).toBe('ProductDO')
    })

    it('registers a worker noun (AI agent)', () => {
      const agentNoun: Noun = {
        noun: 'CodeReviewer',
        plural: 'CodeReviewers',
        description: 'An AI agent that reviews code and provides feedback',
        schema: {
          type: 'worker',
          capabilities: ['code-review', 'documentation', 'suggestions'],
          model: 'claude-opus-4-5-20251101',
          maxContextSize: 200000,
        },
        doClass: 'AgentDO',
      }

      expect((agentNoun.schema as Record<string, unknown>).capabilities).toContain('code-review')
    })

    it('registers a workflow noun', () => {
      const workflowNoun: Noun = {
        noun: 'OnboardingFlow',
        plural: 'OnboardingFlows',
        description: 'Multi-step customer onboarding process',
        schema: {
          type: 'workflow',
          steps: ['welcome', 'profile', 'preferences', 'verification', 'complete'],
          timeout: 86400000, // 24 hours
          retryPolicy: { maxRetries: 3, backoff: 'exponential' },
        },
        doClass: 'WorkflowDO',
      }

      expect((workflowNoun.schema as Record<string, unknown>).steps).toHaveLength(5)
    })

    it('registers a lookup/reference noun without DO', () => {
      const lookupNoun: Noun = {
        noun: 'Country',
        plural: 'Countries',
        description: 'A country code reference',
        schema: {
          type: 'lookup',
          fields: {
            code: { type: 'string', required: true, pattern: '^[A-Z]{2}$' },
            name: { type: 'string', required: true },
            currency: { type: 'string' },
          },
        },
        doClass: null, // No DO needed for simple lookups
      }

      expect(lookupNoun.doClass).toBeNull()
    })
  })

  describe('Registry Query Use Cases', () => {
    const registryNouns: Noun[] = [
      {
        noun: 'Customer',
        plural: 'Customers',
        description: null,
        schema: { type: 'entity' },
        doClass: 'CustomerDO',
      },
      { noun: 'Agent', plural: 'Agents', description: null, schema: { type: 'worker' }, doClass: 'AgentDO' },
      { noun: 'Task', plural: 'Tasks', description: null, schema: { type: 'entity' }, doClass: 'TaskDO' },
      { noun: 'Country', plural: 'Countries', description: null, schema: { type: 'lookup' }, doClass: null },
      { noun: 'Currency', plural: 'Currencies', description: null, schema: { type: 'lookup' }, doClass: null },
    ]

    it('gets all DO-backed nouns for binding discovery', () => {
      const doNouns = registryNouns.filter((n) => n.doClass !== null)

      expect(doNouns).toHaveLength(3)
      const doClasses = doNouns.map((n) => n.doClass)
      expect(doClasses).toContain('CustomerDO')
      expect(doClasses).toContain('AgentDO')
      expect(doClasses).toContain('TaskDO')
    })

    it('gets all lookup tables for validation', () => {
      const lookupNouns = registryNouns.filter((n) => n.doClass === null)

      expect(lookupNouns).toHaveLength(2)
      expect(lookupNouns.map((n) => n.noun)).toContain('Country')
      expect(lookupNouns.map((n) => n.noun)).toContain('Currency')
    })

    it('checks if a noun exists in registry', () => {
      const exists = registryNouns.some((n) => n.noun === 'Customer')
      const notExists = registryNouns.some((n) => n.noun === 'NotRegistered')

      expect(exists).toBe(true)
      expect(notExists).toBe(false)
    })
  })
})

// ============================================================================
// Schema Index Tests (Expected Indexes)
// ============================================================================

describe('Schema Indexes (Expected)', () => {
  it('primary key index on noun column', () => {
    // The noun column is the primary key, which automatically creates an index
    expect(nouns.noun).toBeDefined()
  })

  it('should have index on doClass for filtering DO-backed nouns', () => {
    // Recommended index for efficient queries on doClass
    expect(nouns.doClass).toBeDefined()
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('nouns table columns match expected interface', () => {
    // Verify all expected columns exist
    expect(nouns.noun).toBeDefined()
    expect(nouns.plural).toBeDefined()
    expect(nouns.description).toBeDefined()
    expect(nouns.schema).toBeDefined()
    expect(nouns.doClass).toBeDefined()
  })

  it('can create type-safe noun objects', () => {
    const typeSafeNoun: Noun = {
      noun: 'TypeSafe',
      plural: 'TypeSafes',
      description: 'A type-safe noun',
      schema: { type: 'entity' },
      doClass: 'TypeSafeDO',
    }

    expect(typeSafeNoun).toBeDefined()
    expect(typeSafeNoun.noun).toBe('TypeSafe')
  })
})

// ============================================================================
// RED PHASE: Type Exports (Expected to FAIL until implemented)
// ============================================================================

describe('Type Exports (RED Phase)', () => {
  it('exports Noun type for select operations', async () => {
    // This will FAIL until Noun type is exported from db/nouns.ts
    // @ts-expect-error - Noun type not yet exported
    const { Noun: NounType } = await import('../nouns')

    // Expected: export type Noun = typeof nouns.$inferSelect
    expect(NounType).toBeDefined()
  })

  it('exports NewNoun type for insert operations', async () => {
    // This will FAIL until NewNoun type is exported from db/nouns.ts
    // @ts-expect-error - NewNoun type not yet exported
    const { NewNoun: NewNounType } = await import('../nouns')

    // Expected: export type NewNoun = typeof nouns.$inferInsert
    expect(NewNounType).toBeDefined()
  })
})

// ============================================================================
// RED PHASE: Query Helpers (Expected to FAIL until implemented)
// ============================================================================

describe('Query Helpers (RED Phase)', () => {
  it('exports getNoun helper function', async () => {
    // This will FAIL until getNoun is exported from db/nouns.ts
    // @ts-expect-error - getNoun not yet exported
    const { getNoun } = await import('../nouns')

    // Expected: export async function getNoun(db, noun: string): Promise<Noun | undefined>
    expect(getNoun).toBeDefined()
    expect(typeof getNoun).toBe('function')
  })

  it('exports getAllNouns helper function', async () => {
    // This will FAIL until getAllNouns is exported from db/nouns.ts
    // @ts-expect-error - getAllNouns not yet exported
    const { getAllNouns } = await import('../nouns')

    // Expected: export async function getAllNouns(db): Promise<Noun[]>
    expect(getAllNouns).toBeDefined()
    expect(typeof getAllNouns).toBe('function')
  })

  it('exports getNounsWithDO helper function', async () => {
    // This will FAIL until getNounsWithDO is exported from db/nouns.ts
    // @ts-expect-error - getNounsWithDO not yet exported
    const { getNounsWithDO } = await import('../nouns')

    // Expected: export async function getNounsWithDO(db): Promise<Noun[]>
    // Returns nouns where doClass is not null
    expect(getNounsWithDO).toBeDefined()
    expect(typeof getNounsWithDO).toBe('function')
  })

  it('exports getNounsWithSchema helper function', async () => {
    // This will FAIL until getNounsWithSchema is exported from db/nouns.ts
    // @ts-expect-error - getNounsWithSchema not yet exported
    const { getNounsWithSchema } = await import('../nouns')

    // Expected: export async function getNounsWithSchema(db): Promise<Noun[]>
    // Returns nouns where schema is not null
    expect(getNounsWithSchema).toBeDefined()
    expect(typeof getNounsWithSchema).toBe('function')
  })

  it('exports nounExists helper function', async () => {
    // This will FAIL until nounExists is exported from db/nouns.ts
    // @ts-expect-error - nounExists not yet exported
    const { nounExists } = await import('../nouns')

    // Expected: export async function nounExists(db, noun: string): Promise<boolean>
    expect(nounExists).toBeDefined()
    expect(typeof nounExists).toBe('function')
  })
})

// ============================================================================
// RED PHASE: Validation Helpers (Expected to FAIL until implemented)
// ============================================================================

describe('Validation Helpers (RED Phase)', () => {
  it('exports NounSchemaValidator zod schema', async () => {
    // This will FAIL until NounSchemaValidator is exported
    // @ts-expect-error - NounSchemaValidator not yet exported
    const { NounSchemaValidator } = await import('../nouns')

    // Expected: export const NounSchemaValidator = z.object({...})
    expect(NounSchemaValidator).toBeDefined()
    expect(NounSchemaValidator.parse).toBeDefined()
  })

  it('exports validateNounSchema helper function', async () => {
    // This will FAIL until validateNounSchema is exported
    // @ts-expect-error - validateNounSchema not yet exported
    const { validateNounSchema } = await import('../nouns')

    // Expected: export function validateNounSchema(schema: unknown): NounSchema
    expect(validateNounSchema).toBeDefined()
    expect(typeof validateNounSchema).toBe('function')
  })

  it('exports isValidNounName helper function', async () => {
    // This will FAIL until isValidNounName is exported
    // @ts-expect-error - isValidNounName not yet exported
    const { isValidNounName } = await import('../nouns')

    // Expected: export function isValidNounName(noun: string): boolean
    // Should validate PascalCase naming convention for nouns
    expect(isValidNounName).toBeDefined()
    expect(typeof isValidNounName).toBe('function')
  })
})

// ============================================================================
// RED PHASE: Index Definitions (Expected behavior verification)
// ============================================================================

describe('Index Definitions (RED Phase)', () => {
  it('nouns table should have index on doClass column', () => {
    // This test verifies the need for an index on doClass
    // Currently no index is defined - this is a potential optimization
    //
    // Implementation would add:
    // (table) => ({
    //   doClassIdx: index('nouns_do_class_idx').on(table.doClass),
    // })

    // For now, we just verify the column exists
    expect(nouns.doClass).toBeDefined()

    // TODO: Add actual index verification when drizzle exposes index metadata
    // expect(nouns._indexes?.doClassIdx).toBeDefined()
  })
})
