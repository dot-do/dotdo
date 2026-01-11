/**
 * Tests for dotdo introspect command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { emitFromMdxSchema, emitFromDOSchema, mergeEmittedTypes } from '../../commands/introspect/emitter'
import type { MdxSchema } from '../../../db/schema/mdx'
import type { DOSchema } from '../../../types/introspect'

describe('Type Emitter', () => {
  describe('emitFromMdxSchema', () => {
    it('generates entity interfaces from MDX schema', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          Startup: {
            fields: {
              name: { type: 'string', description: 'Company name' },
              founded: { type: 'Date' },
            },
          },
        },
      }

      const result = emitFromMdxSchema(schema)

      expect(result.entities).toContain('Startup')
      expect(result.content).toContain('export interface Startup')
      expect(result.content).toContain('name: string')
      expect(result.content).toContain('founded: Date')
      expect(result.content).toContain('id: string')
    })

    it('converts relationship operators to types', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          Startup: {
            fields: {
              idea: { type: '<-Idea' },
              customer: { type: '~>ICP' },
              founders: { type: '[->Founder]' },
              model: { type: '->LeanCanvas' },
            },
          },
        },
      }

      const result = emitFromMdxSchema(schema)

      expect(result.content).toContain('idea: Idea')
      expect(result.content).toContain('customer: ICP')
      expect(result.content).toContain('founders: Founder[]')
      expect(result.content).toContain('model: LeanCanvas')
    })

    it('handles code block types', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          User: {
            fields: {
              profile: { type: '`->Profile`' },
            },
          },
        },
      }

      const result = emitFromMdxSchema(schema)
      expect(result.content).toContain('profile: Profile')
    })

    it('generates state types', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          Startup: {
            fields: { name: { type: 'string' } },
            states: ['draft', 'launched', 'scaling', 'exit'],
          },
        },
      }

      const result = emitFromMdxSchema(schema)

      expect(result.content).toContain("export type StartupState = 'draft' | 'launched' | 'scaling' | 'exit'")
    })

    it('generates event types', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          Customer: {
            fields: { name: { type: 'string' } },
            events: ['Customer.signup', 'Customer.churned'],
          },
        },
      }

      const result = emitFromMdxSchema(schema)

      expect(result.events).toContain('Customer.signup')
      expect(result.events).toContain('Customer.churned')
      expect(result.content).toContain("'Customer.signup'")
    })

    it('includes JSDoc comments when enabled', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          Startup: {
            description: 'The core business entity',
            fields: {
              name: { type: 'string', description: 'Company name' },
            },
          },
        },
      }

      const result = emitFromMdxSchema(schema, { includeComments: true })

      expect(result.content).toContain('/** The core business entity */')
      expect(result.content).toContain('/** Company name */')
    })

    it('uses custom module name', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: { User: { fields: { name: { type: 'string' } } } },
      }

      const result = emitFromMdxSchema(schema, { moduleName: '@acme/types' })

      expect(result.content).toContain("declare module '@acme/types'")
    })

    it('generates Entities registry interface', () => {
      const schema: MdxSchema = {
        source: 'test.mdx',
        entities: {
          User: { fields: { name: { type: 'string' } } },
          Order: { fields: { total: { type: 'number' } } },
        },
      }

      const result = emitFromMdxSchema(schema)

      expect(result.content).toContain('export interface Entities')
      expect(result.content).toContain('User: User')
      expect(result.content).toContain('Order: Order')
    })

    it('handles empty schema gracefully', () => {
      const schema: MdxSchema = {
        source: 'empty.mdx',
        entities: {},
      }

      const result = emitFromMdxSchema(schema)

      expect(result.entities).toHaveLength(0)
      expect(result.content).toContain('export interface Entities')
    })
  })

  describe('emitFromDOSchema', () => {
    it('generates interfaces from DOSchema', () => {
      const schema: DOSchema = {
        ns: 'test',
        permissions: { role: 'user', scopes: [] },
        classes: [
          {
            name: 'UserDO',
            type: 'collection',
            pattern: '/:type/:id',
            visibility: 'user',
            tools: [],
            endpoints: [],
            properties: [
              { name: 'email', type: 'string', required: true },
              { name: 'avatar', type: 'string', required: false },
            ],
            actions: [],
          },
        ],
        nouns: [{ noun: 'User', plural: 'Users' }],
        verbs: [],
        stores: [],
        storage: { fsx: false, gitx: false, bashx: false, r2: { enabled: false }, sql: { enabled: true }, iceberg: false, edgevec: false },
      }

      const result = emitFromDOSchema(schema)

      expect(result.entities).toContain('UserDO')
      expect(result.content).toContain('export interface UserDO')
      expect(result.content).toContain('email: string')
      expect(result.content).toContain('avatar?: string')
    })

    it('generates method signatures from tools', () => {
      const schema: DOSchema = {
        ns: 'test',
        permissions: { role: 'user', scopes: [] },
        classes: [
          {
            name: 'OrderDO',
            type: 'collection',
            pattern: '/:type/:id',
            visibility: 'user',
            tools: [
              { name: 'create', description: 'Create order', inputSchema: {} },
              { name: 'cancel', description: 'Cancel order', inputSchema: {} },
            ],
            endpoints: [],
            properties: [],
            actions: [],
          },
        ],
        nouns: [],
        verbs: [],
        stores: [],
        storage: { fsx: false, gitx: false, bashx: false, r2: { enabled: false }, sql: { enabled: false }, iceberg: false, edgevec: false },
      }

      const result = emitFromDOSchema(schema)

      expect(result.methods).toContain('OrderDO.create')
      expect(result.methods).toContain('OrderDO.cancel')
      expect(result.content).toContain("'OrderDO.create'")
    })

    it('generates Nouns interface', () => {
      const schema: DOSchema = {
        ns: 'test',
        permissions: { role: 'user', scopes: [] },
        classes: [],
        nouns: [
          { noun: 'Customer', plural: 'Customers' },
          { noun: 'Order', plural: 'Orders' },
        ],
        verbs: [],
        stores: [],
        storage: { fsx: false, gitx: false, bashx: false, r2: { enabled: false }, sql: { enabled: false }, iceberg: false, edgevec: false },
      }

      const result = emitFromDOSchema(schema)

      expect(result.content).toContain('export interface Nouns')
      expect(result.content).toContain("Customer: { singular: 'Customer', plural: 'Customers' }")
    })
  })

  describe('mergeEmittedTypes', () => {
    it('merges multiple EmittedTypes', () => {
      const types = [
        { content: '', entities: ['User', 'Order'], methods: [], events: ['User.created'] },
        { content: '', entities: ['Product'], methods: ['Order.create'], events: ['Order.placed'] },
      ]

      const merged = mergeEmittedTypes(types)

      expect(merged).toContain('User: User')
      expect(merged).toContain('Order: Order')
      expect(merged).toContain('Product: Product')
      expect(merged).toContain("'Order.create'")
      expect(merged).toContain("'User.created'")
      expect(merged).toContain("'Order.placed'")
    })

    it('deduplicates entities', () => {
      const types = [
        { content: '', entities: ['User'], methods: [], events: [] },
        { content: '', entities: ['User', 'Order'], methods: [], events: [] },
      ]

      const merged = mergeEmittedTypes(types)

      // Should only have User once
      const userMatches = merged.match(/User: User/g)
      expect(userMatches).toHaveLength(1)
    })
  })
})

describe('Introspect CLI', () => {
  // These are integration tests that require file system operations
  // They are marked as skipped by default and can be run manually

  it.skip('generates types from project root', async () => {
    // Would need to set up a test directory with DB.mdx files
  })

  it.skip('check mode returns error when types are outdated', async () => {
    // Would need to set up a test directory
  })
})
