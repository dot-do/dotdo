/**
 * Query Translator Tests - TDD RED Phase
 *
 * These tests define the complete contract for translating EdgeQL AST to SQLite SQL.
 * All tests are expected to FAIL until the query translator is implemented.
 *
 * Coverage: ~185 tests across 9 categories
 *
 * Test Categories:
 * 1. SELECT Translation (~40 tests)
 * 2. INSERT Translation (~25 tests)
 * 3. UPDATE Translation (~25 tests)
 * 4. DELETE Translation (~20 tests)
 * 5. Expression Translation (~30 tests)
 * 6. FOR Loop Translation (~15 tests)
 * 7. WITH Block Translation (~15 tests)
 * 8. Parameter Handling (~15 tests)
 * 9. Complex Queries (~15 tests)
 *
 * @see spike-sdl-mapping.md - Schema mapping reference
 */

import { describe, it, expect } from 'vitest'
import {
  translateQuery,
  translateSelect,
  translateInsert,
  translateUpdate,
  translateDelete,
  translateFor,
  translateWith,
  translateExpression,
  operatorToSQL,
  quoteIdentifier,
  getTableName,
  getColumnName,
  pathToSQL,
  type TranslatedQuery,
  type TranslateOptions,
  type UpdateStatement,
  type DeleteStatement,
  type ForStatement,
  type WithBlock,
  type SetClause,
  type ParameterExpression,
  type CastExpression,
  type ConcatExpression,
  type CoalesceExpression,
  type UnaryExpression,
  type InExpression,
  type LikeExpression,
  type SetExpression,
  type FunctionCall,
  type ASTNode,
} from '../query-translator'

import type { Schema, TypeDefinition } from '../sdl-parser'

// =============================================================================
// MOCK AST BUILDERS
// =============================================================================

// Helper functions to build AST nodes for testing
function selectAST(opts: {
  target: string
  fields: string[]
  filter?: object
  orderBy?: object
  limit?: number
  offset?: number
  nestedShapes?: Record<string, { fields: string[]; shape?: object }>
  computedFields?: Record<string, object>
}): object {
  const shape = {
    type: 'Shape',
    fields: opts.fields.map((name) => {
      if (opts.nestedShapes?.[name]) {
        return {
          type: 'ShapeField',
          name,
          shape: {
            type: 'Shape',
            fields: opts.nestedShapes[name].fields.map((f) => ({
              type: 'ShapeField',
              name: f,
            })),
          },
        }
      }
      if (opts.computedFields?.[name]) {
        return {
          type: 'ShapeField',
          name,
          computed: true,
          expression: opts.computedFields[name],
        }
      }
      return { type: 'ShapeField', name }
    }),
  }

  return {
    type: 'SelectStatement',
    target: opts.target,
    shape,
    filter: opts.filter,
    orderBy: opts.orderBy,
    limit: opts.limit !== undefined ? { type: 'LimitClause', count: { type: 'NumberLiteral', value: opts.limit } } : undefined,
    offset: opts.offset !== undefined ? { type: 'OffsetClause', count: { type: 'NumberLiteral', value: opts.offset } } : undefined,
  }
}

function insertAST(opts: {
  target: string
  assignments: Array<{ name: string; value: object }>
}): object {
  return {
    type: 'InsertStatement',
    target: opts.target,
    data: {
      type: 'InsertData',
      assignments: opts.assignments.map((a) => ({
        type: 'Assignment',
        name: a.name,
        value: a.value,
      })),
    },
  }
}

function updateAST(opts: {
  target: string
  filter?: object
  assignments: Array<{ name: string; value: object }>
}): UpdateStatement {
  return {
    type: 'UpdateStatement',
    target: opts.target,
    filter: opts.filter as any,
    set: {
      type: 'SetClause',
      assignments: opts.assignments.map((a) => ({
        type: 'Assignment',
        name: a.name,
        value: a.value,
      })),
    } as SetClause,
  }
}

function deleteAST(opts: {
  target: string
  filter?: object
}): DeleteStatement {
  return {
    type: 'DeleteStatement',
    target: opts.target,
    filter: opts.filter as any,
  }
}

function forAST(opts: {
  variable: string
  iterator: object
  body: object
}): ForStatement {
  return {
    type: 'ForStatement',
    variable: opts.variable,
    iterator: opts.iterator as any,
    body: opts.body as any,
  }
}

function withAST(opts: {
  bindings: Array<{ name: string; value: object }>
  body: object
}): WithBlock {
  return {
    type: 'WithBlock',
    bindings: opts.bindings.map((b) => ({
      type: 'WithBinding',
      name: b.name,
      value: b.value as any,
    })),
    body: opts.body as any,
  }
}

// Literal builders
const str = (value: string) => ({ type: 'StringLiteral', value })
const num = (value: number) => ({ type: 'NumberLiteral', value })
const bool = (value: boolean) => ({ type: 'BooleanLiteral', value })
const path = (...segments: string[]) => ({ type: 'PathExpression', path: segments })
const param = (name: string, paramType?: string, optional = false): ParameterExpression => ({
  type: 'ParameterExpression',
  name,
  paramType,
  optional,
})
const cast = (typeRef: string, value: object): CastExpression => ({
  type: 'CastExpression',
  typeRef,
  value: value as any,
})

// Binary expression builder
const binary = (left: object, operator: string, right: object) => ({
  type: 'BinaryExpression',
  operator,
  left,
  right,
})

// Filter expression builder
const filter = (condition: object) => ({
  type: 'FilterExpression',
  condition,
})

// Order by builder
const orderBy = (...expressions: Array<{ expr: object; direction?: 'asc' | 'desc'; nulls?: 'first' | 'last' }>) => ({
  type: 'OrderByClause',
  expressions: expressions.map((e) => ({
    type: 'OrderByExpression',
    expression: e.expr,
    direction: e.direction ?? null,
    nullsPosition: e.nulls ?? null,
  })),
})

// Unary expression builders
const not = (operand: object): UnaryExpression => ({ type: 'UnaryExpression', operator: 'not', operand: operand as any })
const neg = (operand: object): UnaryExpression => ({ type: 'UnaryExpression', operator: '-', operand: operand as any })
const exists = (operand: object): UnaryExpression => ({ type: 'UnaryExpression', operator: 'exists', operand: operand as any })
const distinct = (operand: object): UnaryExpression => ({ type: 'UnaryExpression', operator: 'distinct', operand: operand as any })

// Set operations
const inExpr = (expression: object, set: object, negated = false): InExpression => ({
  type: 'InExpression',
  expression: expression as any,
  set: set as any,
  negated,
})

const setExpr = (...elements: object[]): SetExpression => ({
  type: 'SetExpression',
  elements: elements as any[],
})

// String operations
const concat = (left: object, right: object): ConcatExpression => ({
  type: 'ConcatExpression',
  left: left as any,
  right: right as any,
})

const like = (expression: object, pattern: object, caseInsensitive = false, negated = false): LikeExpression => ({
  type: 'LikeExpression',
  expression: expression as any,
  pattern: pattern as any,
  caseInsensitive,
  negated,
})

// Coalesce
const coalesce = (left: object, right: object): CoalesceExpression => ({
  type: 'CoalesceExpression',
  left: left as any,
  right: right as any,
})

// Function call
const fn = (name: string, ...args: object[]): FunctionCall => ({
  type: 'FunctionCall',
  name,
  args: args as any[],
})

// Sample schema for type-aware tests
const sampleSchema: Schema = {
  types: [
    {
      name: 'User',
      module: 'default',
      abstract: false,
      extends: [],
      properties: [
        { name: 'name', type: 'str', required: true, readonly: false, constraints: [] },
        { name: 'email', type: 'str', required: true, readonly: false, constraints: [] },
        { name: 'age', type: 'int32', required: false, readonly: false, constraints: [] },
        { name: 'active', type: 'bool', required: false, readonly: false, constraints: [] },
        { name: 'score', type: 'float64', required: false, readonly: false, constraints: [] },
        { name: 'nickname', type: 'str', required: false, readonly: false, constraints: [] },
      ],
      links: [
        { name: 'profile', target: 'Profile', required: false, cardinality: 'single' },
        { name: 'posts', target: 'Post', required: false, cardinality: 'multi' },
        { name: 'friends', target: 'User', required: false, cardinality: 'multi' },
      ],
      backlinks: [],
      computedProperties: [
        { name: 'full_name', expression: '.first_name ++ " " ++ .last_name' },
      ],
      constraints: [],
      indexes: [],
    },
    {
      name: 'Post',
      module: 'default',
      abstract: false,
      extends: [],
      properties: [
        { name: 'title', type: 'str', required: true, readonly: false, constraints: [] },
        { name: 'content', type: 'str', required: false, readonly: false, constraints: [] },
        { name: 'published', type: 'bool', required: false, readonly: false, constraints: [] },
        { name: 'created_at', type: 'datetime', required: false, readonly: false, constraints: [] },
      ],
      links: [
        { name: 'author', target: 'User', required: true, cardinality: 'single' },
        { name: 'tags', target: 'Tag', required: false, cardinality: 'multi' },
      ],
      backlinks: [],
      computedProperties: [],
      constraints: [],
      indexes: [],
    },
    {
      name: 'Tag',
      module: 'default',
      abstract: false,
      extends: [],
      properties: [
        { name: 'name', type: 'str', required: true, readonly: false, constraints: [] },
      ],
      links: [],
      backlinks: [],
      computedProperties: [],
      constraints: [],
      indexes: [],
    },
    {
      name: 'Profile',
      module: 'default',
      abstract: false,
      extends: [],
      properties: [
        { name: 'bio', type: 'str', required: false, readonly: false, constraints: [] },
        { name: 'avatar', type: 'str', required: false, readonly: false, constraints: [] },
      ],
      links: [],
      backlinks: [],
      computedProperties: [],
      constraints: [],
      indexes: [],
    },
  ],
  enums: [],
  modules: [],
  aliases: [],
  globals: [],
  functions: [],
  scalars: [],
  extensions: [],
}

// =============================================================================
// 1. SELECT TRANSLATION TESTS (~40 tests)
// =============================================================================

describe('Query Translator - SELECT', () => {
  describe('simple select', () => {
    it('translates select with single field', () => {
      const ast = selectAST({ target: 'User', fields: ['name'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('SELECT "name" FROM "User"')
      expect(result.params).toEqual([])
    })

    it('translates select with multiple fields', () => {
      const ast = selectAST({ target: 'User', fields: ['name', 'email', 'age'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('SELECT "name", "email", "age" FROM "User"')
    })

    it('translates select with all fields (*)', () => {
      const ast = selectAST({ target: 'User', fields: [] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('FROM "User"')
    })

    it('preserves field order in SQL', () => {
      const ast = selectAST({ target: 'User', fields: ['email', 'name', 'age'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('SELECT "email", "name", "age" FROM "User"')
    })

    it('handles module-qualified type names', () => {
      const ast = selectAST({ target: 'default::User', fields: ['name'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('FROM "User"')
    })
  })

  describe('select with shape fields', () => {
    it('translates shape fields to column selection', () => {
      const ast = selectAST({ target: 'User', fields: ['name', 'email'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('SELECT "name", "email" FROM "User"')
    })

    it('generates id column for nested shapes', () => {
      const ast = selectAST({
        target: 'Post',
        fields: ['title', 'author'],
        nestedShapes: { author: { fields: ['name', 'email'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('author_id')
    })

    it('generates JOIN for nested shapes', () => {
      const ast = selectAST({
        target: 'Post',
        fields: ['title', 'author'],
        nestedShapes: { author: { fields: ['name'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('JOIN')
      expect(result.sql).toContain('"User"')
    })

    it('generates LEFT JOIN for optional links', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'profile'],
        nestedShapes: { profile: { fields: ['bio'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('LEFT JOIN')
    })

    it('handles deeply nested shapes (2 levels)', () => {
      const ast = {
        type: 'SelectStatement',
        target: 'Post',
        shape: {
          type: 'Shape',
          fields: [
            { type: 'ShapeField', name: 'title' },
            {
              type: 'ShapeField',
              name: 'author',
              shape: {
                type: 'Shape',
                fields: [
                  { type: 'ShapeField', name: 'name' },
                  {
                    type: 'ShapeField',
                    name: 'profile',
                    shape: {
                      type: 'Shape',
                      fields: [{ type: 'ShapeField', name: 'bio' }],
                    },
                  },
                ],
              },
            },
          ],
        },
      }
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('JOIN')
      expect(result.columnMap).toBeDefined()
    })

    it('handles multi-link shapes with subquery', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'posts'],
        nestedShapes: { posts: { fields: ['title'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Multi-links should generate a subquery or separate query
      expect(result.sql).toBeDefined()
    })
  })

  describe('select with filter (WHERE)', () => {
    it('translates filter to WHERE clause', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('age'), '>', num(18))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('"age"')
      expect(result.sql).toContain('>')
    })

    it('translates equality filter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('active'), '=', bool(true))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE "active" = ?')
      expect(result.params).toContain(1) // SQLite uses 1 for true
    })

    it('translates string filter with parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('email'), '=', str('test@example.com'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE "email" = ?')
      expect(result.params).toContain('test@example.com')
    })

    it('translates compound AND filter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(path('active'), '=', bool(true)),
            'and',
            binary(path('age'), '>=', num(18))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('AND')
    })

    it('translates compound OR filter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(path('role'), '=', str('admin')),
            'or',
            binary(path('role'), '=', str('moderator'))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('OR')
    })

    it('translates NOT filter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(not(path('deleted'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NOT')
    })

    it('translates nested path in filter', () => {
      const ast = selectAST({
        target: 'Post',
        fields: ['title'],
        filter: filter(binary(path('author', 'active'), '=', bool(true))),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should generate a JOIN or subquery for nested path
      expect(result.sql).toBeDefined()
    })
  })

  describe('select with ORDER BY', () => {
    it('translates simple order by', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('name') }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('"name"')
    })

    it('translates order by with ASC direction', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('name'), direction: 'asc' }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('ASC')
    })

    it('translates order by with DESC direction', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('created_at'), direction: 'desc' }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('DESC')
    })

    it('translates order by with NULLS FIRST', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('nickname'), nulls: 'first' }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NULLS FIRST')
    })

    it('translates order by with NULLS LAST', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('nickname'), nulls: 'last' }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NULLS LAST')
    })

    it('translates multiple order by expressions (THEN)', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy(
          { expr: path('last_name'), direction: 'asc' },
          { expr: path('first_name'), direction: 'asc' }
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain(',')
    })

    it('translates order by with combined direction and nulls', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        orderBy: orderBy({ expr: path('score'), direction: 'desc', nulls: 'last' }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('DESC')
      expect(result.sql).toContain('NULLS LAST')
    })
  })

  describe('select with LIMIT/OFFSET', () => {
    it('translates LIMIT', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        limit: 10,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('LIMIT')
      expect(result.sql).toContain('10')
    })

    it('translates OFFSET', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        offset: 20,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('OFFSET')
      expect(result.sql).toContain('20')
    })

    it('translates LIMIT and OFFSET together', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        limit: 10,
        offset: 20,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('LIMIT 10')
      expect(result.sql).toContain('OFFSET 20')
    })

    it('translates LIMIT 0', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        limit: 0,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('LIMIT 0')
    })

    it('translates LIMIT 1 (single result)', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        limit: 1,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('LIMIT 1')
    })
  })

  describe('select with computed fields', () => {
    it('translates computed field expression', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'full_name'],
        computedFields: {
          full_name: concat(path('first_name'), concat(str(' '), path('last_name'))),
        },
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('||')
      expect(result.sql).toContain('AS')
    })

    it('translates computed field with aggregation', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'post_count'],
        computedFields: {
          post_count: fn('count', path('posts')),
        },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('COUNT')
    })

    it('translates computed field with coalesce', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['display_name'],
        computedFields: {
          display_name: coalesce(path('nickname'), path('name')),
        },
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('COALESCE')
    })
  })

  describe('select clause ordering', () => {
    it('generates clauses in correct order: SELECT FROM WHERE ORDER BY LIMIT OFFSET', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('active'), '=', bool(true))),
        orderBy: orderBy({ expr: path('name') }),
        limit: 10,
        offset: 5,
      })
      const result = translateQuery(ast as ASTNode)

      const selectIdx = result.sql.indexOf('SELECT')
      const fromIdx = result.sql.indexOf('FROM')
      const whereIdx = result.sql.indexOf('WHERE')
      const orderIdx = result.sql.indexOf('ORDER BY')
      const limitIdx = result.sql.indexOf('LIMIT')
      const offsetIdx = result.sql.indexOf('OFFSET')

      expect(selectIdx).toBeLessThan(fromIdx)
      expect(fromIdx).toBeLessThan(whereIdx)
      expect(whereIdx).toBeLessThan(orderIdx)
      expect(orderIdx).toBeLessThan(limitIdx)
      expect(limitIdx).toBeLessThan(offsetIdx)
    })
  })
})

// =============================================================================
// 2. INSERT TRANSLATION TESTS (~25 tests)
// =============================================================================

describe('Query Translator - INSERT', () => {
  describe('simple insert', () => {
    it('translates insert with single field', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('Alice') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('INSERT INTO "User" ("name") VALUES (?)')
      expect(result.params).toEqual(['Alice'])
    })

    it('translates insert with multiple fields', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('Alice') },
          { name: 'email', value: str('alice@example.com') },
          { name: 'age', value: num(30) },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('INSERT INTO "User"')
      expect(result.sql).toContain('"name"')
      expect(result.sql).toContain('"email"')
      expect(result.sql).toContain('"age"')
      expect(result.params).toHaveLength(3)
    })

    it('translates insert with string value', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('Test User') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain('Test User')
    })

    it('translates insert with number value', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'age', value: num(25) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(25)
    })

    it('translates insert with boolean value (true)', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'active', value: bool(true) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(1) // SQLite uses 1 for true
    })

    it('translates insert with boolean value (false)', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'active', value: bool(false) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(0) // SQLite uses 0 for false
    })
  })

  describe('insert with link assignments', () => {
    it('translates single link to FK value', () => {
      const ast = insertAST({
        target: 'Post',
        assignments: [
          { name: 'title', value: str('My Post') },
          { name: 'author', value: cast('uuid', param('author_id')) },
        ],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('author_id')
    })

    it('translates link to referenced object id', () => {
      const ast = insertAST({
        target: 'Post',
        assignments: [
          { name: 'title', value: str('My Post') },
          { name: 'author', value: { type: 'PathExpression', path: ['user'] } },
        ],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('author_id')
    })
  })

  describe('insert with nested inserts', () => {
    it('generates separate INSERT for nested object', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('Alice') },
          {
            name: 'profile',
            value: {
              type: 'InsertStatement',
              target: 'Profile',
              data: {
                type: 'InsertData',
                assignments: [
                  { type: 'Assignment', name: 'bio', value: str('Hello world') },
                ],
              },
            },
          },
        ],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should generate two INSERT statements or a transaction
      expect(result.sql).toContain('INSERT')
    })

    it('handles nested insert ID reference', () => {
      // When inserting a nested object, the parent should reference its ID
      const ast = insertAST({
        target: 'Post',
        assignments: [
          { name: 'title', value: str('My Post') },
          {
            name: 'author',
            value: insertAST({
              target: 'User',
              assignments: [{ name: 'name', value: str('New Author') }],
            }),
          },
        ],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('insert with returning', () => {
    it('generates RETURNING clause for id', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('Alice') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('RETURNING')
      expect(result.sql).toContain('"id"')
    })

    it('returns all inserted fields', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('Alice') },
          { name: 'email', value: str('alice@example.com') },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('RETURNING')
    })
  })

  describe('insert edge cases', () => {
    it('escapes single quotes in strings', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str("O'Brien") }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain("O'Brien")
      // Parameterized query handles escaping
    })

    it('handles null values', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('Alice') },
          { name: 'nickname', value: { type: 'NullLiteral' } },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(null)
    })

    it('generates UUID for id if not provided', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('Alice') }],
      })
      const result = translateQuery(ast as ASTNode)

      // Should either include id generation or use SQLite default
      expect(result.sql).toBeDefined()
    })

    it('handles module-qualified target', () => {
      const ast = insertAST({
        target: 'default::User',
        assignments: [{ name: 'name', value: str('Alice') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"User"')
    })
  })
})

// =============================================================================
// 3. UPDATE TRANSLATION TESTS (~25 tests)
// =============================================================================

describe('Query Translator - UPDATE', () => {
  describe('simple update', () => {
    it('translates update with single assignment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('New Name') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('UPDATE "User" SET "name" = ?')
      expect(result.params).toEqual(['New Name'])
    })

    it('translates update with multiple assignments', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('New Name') },
          { name: 'active', value: bool(true) },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('UPDATE "User" SET')
      expect(result.sql).toContain('"name" = ?')
      expect(result.sql).toContain('"active" = ?')
    })

    it('translates update with number assignment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'age', value: num(30) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(30)
    })

    it('translates update with boolean assignment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'active', value: bool(false) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(0)
    })
  })

  describe('update with filter', () => {
    it('translates update with id filter', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
        assignments: [{ name: 'name', value: str('New Name') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('"id"')
    })

    it('translates update with string filter', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(binary(path('email'), '=', str('test@example.com'))),
        assignments: [{ name: 'active', value: bool(true) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE "email" = ?')
    })

    it('translates update with boolean filter', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(binary(path('active'), '=', bool(false))),
        assignments: [{ name: 'active', value: bool(true) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
    })

    it('translates update with compound filter', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(
          binary(
            binary(path('active'), '=', bool(true)),
            'and',
            binary(path('age'), '>=', num(18))
          )
        ),
        assignments: [{ name: 'verified', value: bool(true) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('AND')
    })
  })

  describe('update with expressions', () => {
    it('translates self-reference increment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'score', value: binary(path('score'), '+', num(1)) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"score" = "score" + ?')
    })

    it('translates self-reference decrement', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'score', value: binary(path('score'), '-', num(1)) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"score" = "score" - ?')
    })

    it('translates multiplication', () => {
      const ast = updateAST({
        target: 'Product',
        assignments: [{ name: 'price', value: binary(path('price'), '*', num(1.1)) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('*')
    })

    it('translates string concatenation', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [
          {
            name: 'name',
            value: concat(path('first_name'), concat(str(' '), path('last_name'))),
          },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('||')
    })

    it('translates coalesce in assignment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'nickname', value: coalesce(path('nickname'), path('name')) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('COALESCE')
    })
  })

  describe('update with += and -= for multi links', () => {
    it('translates += for multi-link (add to junction)', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(binary(path('id'), '=', cast('uuid', param('user_id')))),
        assignments: [{ name: 'friends', value: { type: 'AddAssignment', target: cast('uuid', param('friend_id')) } }],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should generate INSERT INTO junction table
      expect(result.sql).toContain('INSERT')
      expect(result.sql).toContain('User_friends')
    })

    it('translates -= for multi-link (remove from junction)', () => {
      const ast = updateAST({
        target: 'User',
        filter: filter(binary(path('id'), '=', cast('uuid', param('user_id')))),
        assignments: [{ name: 'friends', value: { type: 'RemoveAssignment', target: cast('uuid', param('friend_id')) } }],
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should generate DELETE FROM junction table
      expect(result.sql).toContain('DELETE')
      expect(result.sql).toContain('User_friends')
    })
  })

  describe('update edge cases', () => {
    it('handles module-qualified target', () => {
      const ast = updateAST({
        target: 'default::User',
        assignments: [{ name: 'name', value: str('New Name') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"User"')
    })

    it('handles datetime assignment', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [{ name: 'updated_at', value: fn('datetime_current') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('CURRENT_TIMESTAMP')
    })

    it('preserves assignment order', () => {
      const ast = updateAST({
        target: 'User',
        assignments: [
          { name: 'a', value: str('1') },
          { name: 'b', value: str('2') },
          { name: 'c', value: str('3') },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      const aIdx = result.sql.indexOf('"a"')
      const bIdx = result.sql.indexOf('"b"')
      const cIdx = result.sql.indexOf('"c"')

      expect(aIdx).toBeLessThan(bIdx)
      expect(bIdx).toBeLessThan(cIdx)
    })
  })
})

// =============================================================================
// 4. DELETE TRANSLATION TESTS (~20 tests)
// =============================================================================

describe('Query Translator - DELETE', () => {
  describe('simple delete', () => {
    it('translates delete all', () => {
      const ast = deleteAST({ target: 'User' })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBe('DELETE FROM "User"')
      expect(result.params).toEqual([])
    })

    it('translates delete with module-qualified target', () => {
      const ast = deleteAST({ target: 'default::User' })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"User"')
    })
  })

  describe('delete with filter', () => {
    it('translates delete with id filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('"id"')
    })

    it('translates delete with string filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(binary(path('email'), '=', str('test@example.com'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE "email" = ?')
      expect(result.params).toContain('test@example.com')
    })

    it('translates delete with boolean filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(binary(path('deleted'), '=', bool(true))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
    })

    it('translates delete with compound AND filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(
          binary(
            binary(path('status'), '=', str('inactive')),
            'and',
            binary(path('last_login'), '<', cast('datetime', param('cutoff')))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('AND')
    })

    it('translates delete with compound OR filter', () => {
      const ast = deleteAST({
        target: 'Session',
        filter: filter(
          binary(
            binary(path('expired'), '=', bool(true)),
            'or',
            binary(path('revoked'), '=', bool(true))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('OR')
    })

    it('translates delete with NOT filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(not(path('verified'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NOT')
    })

    it('translates delete with IN filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(inExpr(path('status'), setExpr(str('banned'), str('suspended')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('IN')
    })
  })

  describe('delete with exists', () => {
    it('translates delete with exists filter', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(exists(path('pending_deletion'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('EXISTS')
    })

    it('translates delete with not exists', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(not(exists(path('active_sessions')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NOT EXISTS')
    })
  })

  describe('delete cascade behavior', () => {
    it('deletes from junction tables for multi-links', () => {
      const ast = deleteAST({
        target: 'User',
        filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should handle cascade or generate additional DELETE statements
      expect(result.sql).toBeDefined()
    })
  })

  describe('delete edge cases', () => {
    it('translates delete with numeric comparison', () => {
      const ast = deleteAST({
        target: 'TempFile',
        filter: filter(binary(path('age_days'), '>', num(30))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('>')
    })

    it('translates delete with nested path filter', () => {
      const ast = deleteAST({
        target: 'Post',
        filter: filter(binary(path('author', 'deleted'), '=', bool(true))),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should generate JOIN or subquery
      expect(result.sql).toBeDefined()
    })

    it('translates delete with type check filter', () => {
      const ast = deleteAST({
        target: 'Content',
        filter: filter({
          type: 'TypeCheckExpression',
          expression: path('item'),
          typeName: 'DraftPost',
          negated: false,
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })
})

// =============================================================================
// 5. EXPRESSION TRANSLATION TESTS (~30 tests)
// =============================================================================

describe('Query Translator - Expressions', () => {
  describe('path expressions', () => {
    it('translates single path to column reference', () => {
      const result = translateExpression(path('name'))

      expect(result.sql).toBe('"name"')
    })

    it('translates path with table prefix', () => {
      const result = pathToSQL(['name'], { table: 'User' })

      expect(result).toContain('"User"')
      expect(result).toContain('"name"')
    })

    it('translates nested path to qualified reference', () => {
      const result = translateExpression(path('author', 'name'), { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })

    it('handles self path (.)', () => {
      const result = translateExpression(path())

      expect(result.sql).toBeDefined()
    })
  })

  describe('arithmetic expressions', () => {
    it('translates addition', () => {
      const result = translateExpression(binary(path('a'), '+', path('b')))

      expect(result.sql).toContain('+')
    })

    it('translates subtraction', () => {
      const result = translateExpression(binary(path('a'), '-', path('b')))

      expect(result.sql).toContain('-')
    })

    it('translates multiplication', () => {
      const result = translateExpression(binary(path('a'), '*', path('b')))

      expect(result.sql).toContain('*')
    })

    it('translates division', () => {
      const result = translateExpression(binary(path('a'), '/', path('b')))

      expect(result.sql).toContain('/')
    })

    it('translates floor division (//) to integer division', () => {
      const result = translateExpression(binary(path('a'), '//', path('b')))

      // SQLite integer division: CAST(a / b AS INTEGER) or a / b with integer operands
      expect(result.sql).toBeDefined()
    })

    it('translates modulo (%)', () => {
      const result = translateExpression(binary(path('a'), '%', path('b')))

      expect(result.sql).toContain('%')
    })

    it('translates power (^) to POW function', () => {
      const result = translateExpression(binary(num(2), '^', num(8)))

      // SQLite uses POWER or custom implementation
      expect(result.sql).toBeDefined()
    })

    it('translates unary minus', () => {
      const result = translateExpression(neg(path('value')))

      expect(result.sql).toContain('-')
    })
  })

  describe('comparison expressions', () => {
    it('translates = to SQL =', () => {
      const result = translateExpression(binary(path('a'), '=', path('b')))

      expect(result.sql).toContain('=')
    })

    it('translates != to SQL !=', () => {
      const result = translateExpression(binary(path('a'), '!=', path('b')))

      expect(result.sql).toContain('!=')
    })

    it('translates < to SQL <', () => {
      const result = translateExpression(binary(path('a'), '<', path('b')))

      expect(result.sql).toContain('<')
    })

    it('translates > to SQL >', () => {
      const result = translateExpression(binary(path('a'), '>', path('b')))

      expect(result.sql).toContain('>')
    })

    it('translates <= to SQL <=', () => {
      const result = translateExpression(binary(path('a'), '<=', path('b')))

      expect(result.sql).toContain('<=')
    })

    it('translates >= to SQL >=', () => {
      const result = translateExpression(binary(path('a'), '>=', path('b')))

      expect(result.sql).toContain('>=')
    })
  })

  describe('logical expressions', () => {
    it('translates AND to SQL AND', () => {
      const result = translateExpression(binary(path('a'), 'and', path('b')))

      expect(result.sql).toContain('AND')
    })

    it('translates OR to SQL OR', () => {
      const result = translateExpression(binary(path('a'), 'or', path('b')))

      expect(result.sql).toContain('OR')
    })

    it('translates NOT to SQL NOT', () => {
      const result = translateExpression(not(path('deleted')))

      expect(result.sql).toContain('NOT')
    })
  })

  describe('string operations', () => {
    it('translates ++ (concat) to || operator', () => {
      const result = translateExpression(concat(path('first'), path('last')))

      expect(result.sql).toContain('||')
    })

    it('translates LIKE pattern', () => {
      const result = translateExpression(like(path('name'), str('A%')))

      expect(result.sql).toContain('LIKE')
    })

    it('translates ILIKE to case-insensitive LIKE', () => {
      const result = translateExpression(like(path('name'), str('a%'), true))

      // SQLite doesn't have ILIKE, use LOWER() or COLLATE NOCASE
      expect(result.sql).toContain('LIKE')
    })

    it('translates NOT LIKE', () => {
      const result = translateExpression(like(path('name'), str('Test%'), false, true))

      expect(result.sql).toContain('NOT LIKE')
    })
  })

  describe('IN expressions', () => {
    it('translates IN with set literal', () => {
      const result = translateExpression(
        inExpr(path('status'), setExpr(str('active'), str('pending')))
      )

      expect(result.sql).toContain('IN')
      expect(result.sql).toContain('(')
      expect(result.sql).toContain(')')
    })

    it('translates NOT IN', () => {
      const result = translateExpression(
        inExpr(path('status'), setExpr(str('deleted')), true)
      )

      expect(result.sql).toContain('NOT IN')
    })

    it('translates IN with subquery', () => {
      const subquery = selectAST({ target: 'Admin', fields: ['user_id'] })
      const result = translateExpression(
        inExpr(path('id'), { type: 'SubqueryExpression', query: subquery })
      )

      expect(result.sql).toContain('IN')
      expect(result.sql).toContain('SELECT')
    })
  })

  describe('type intersection', () => {
    it('translates [is Type] to JOIN with type check', () => {
      const expr = {
        type: 'TypeFilterExpression',
        expression: path('items'),
        typeName: 'Product',
      }
      const result = translateExpression(expr as any, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('coalesce operator', () => {
    it('translates ?? to COALESCE', () => {
      const result = translateExpression(coalesce(path('nickname'), path('name')))

      expect(result.sql).toContain('COALESCE')
    })

    it('translates chained coalesce', () => {
      const result = translateExpression(
        coalesce(path('a'), coalesce(path('b'), path('c')))
      )

      expect(result.sql).toContain('COALESCE')
    })
  })
})

// =============================================================================
// 6. FOR LOOP TRANSLATION TESTS (~15 tests)
// =============================================================================

describe('Query Translator - FOR Loops', () => {
  describe('for with set literal', () => {
    it('translates for with string set to UNION subquery', () => {
      const ast = forAST({
        variable: 'x',
        iterator: setExpr(str('a'), str('b'), str('c')),
        body: selectAST({ target: 'x', fields: [] }),
      })
      const result = translateQuery(ast as ASTNode)

      // Should generate UNION or VALUES expression
      expect(result.sql).toBeDefined()
    })

    it('translates for with numeric set', () => {
      const ast = forAST({
        variable: 'n',
        iterator: setExpr(num(1), num(2), num(3)),
        body: {
          type: 'SelectStatement',
          target: 'computed',
          shape: {
            type: 'Shape',
            fields: [
              {
                type: 'ShapeField',
                name: 'result',
                computed: true,
                expression: binary({ type: 'PathExpression', path: ['n'] }, '*', num(2)),
              },
            ],
          },
        },
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBeDefined()
    })
  })

  describe('for with type iterator', () => {
    it('translates for iterating over type to subquery', () => {
      const ast = forAST({
        variable: 'user',
        iterator: path('User'),
        body: selectAST({ target: 'user', fields: ['name'] }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('SELECT')
    })

    it('translates for with filtered iterator', () => {
      const ast = forAST({
        variable: 'user',
        iterator: {
          type: 'SelectStatement',
          target: 'User',
          shape: { type: 'Shape', fields: [] },
          filter: filter(binary(path('active'), '=', bool(true))),
        },
        body: selectAST({ target: 'user', fields: ['email'] }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('WHERE')
    })
  })

  describe('for with insert body', () => {
    it('translates for with insert to INSERT SELECT', () => {
      const ast = forAST({
        variable: 'user',
        iterator: path('User'),
        body: insertAST({
          target: 'Log',
          assignments: [
            { name: 'user_id', value: path('user', 'id') },
            { name: 'action', value: str('migrated') },
          ],
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('INSERT')
    })
  })

  describe('for with update body', () => {
    it('translates for with update to UPDATE with subquery', () => {
      const ast = forAST({
        variable: 'user',
        iterator: selectAST({
          target: 'User',
          fields: [],
          filter: filter(binary(path('needs_update'), '=', bool(true))),
        }),
        body: updateAST({
          target: 'user',
          assignments: [{ name: 'updated', value: bool(true) }],
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('UPDATE')
    })
  })

  describe('nested for loops', () => {
    it('translates nested for to nested subqueries or CTE', () => {
      const ast = forAST({
        variable: 'x',
        iterator: setExpr(num(1), num(2)),
        body: forAST({
          variable: 'y',
          iterator: setExpr(num(3), num(4)),
          body: {
            type: 'SelectStatement',
            target: 'computed',
            shape: {
              type: 'Shape',
              fields: [
                {
                  type: 'ShapeField',
                  name: 'sum',
                  computed: true,
                  expression: binary(path('x'), '+', path('y')),
                },
              ],
            },
          },
        }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBeDefined()
    })
  })

  describe('for with variable binding', () => {
    it('correctly binds loop variable in expressions', () => {
      const ast = forAST({
        variable: 'item',
        iterator: path('Items'),
        body: selectAST({
          target: 'computed',
          fields: ['value'],
          computedFields: {
            value: binary(path('item', 'price'), '*', num(1.1)),
          },
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })
})

// =============================================================================
// 7. WITH BLOCK TRANSLATION TESTS (~15 tests)
// =============================================================================

describe('Query Translator - WITH Blocks', () => {
  describe('single binding', () => {
    it('translates with binding to CTE', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'active_users',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('active'), '=', bool(true))),
            }),
          },
        ],
        body: selectAST({ target: 'active_users', fields: ['name'] }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WITH')
      expect(result.sql).toContain('active_users')
      expect(result.sql).toContain('AS')
    })

    it('translates scalar binding to CTE or inline', () => {
      const ast = withAST({
        bindings: [{ name: 'limit_val', value: num(10) }],
        body: selectAST({ target: 'User', fields: ['name'], limit: 10 }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toBeDefined()
    })

    it('translates computed binding', () => {
      const ast = withAST({
        bindings: [{ name: 'total', value: fn('count', path('User')) }],
        body: selectAST({
          target: 'computed',
          fields: ['user_count'],
          computedFields: { user_count: path('total') },
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('multiple bindings', () => {
    it('translates multiple with bindings to multiple CTEs', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'active',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('active'), '=', bool(true))),
            }),
          },
          {
            name: 'count_val',
            value: fn('count', path('active')),
          },
        ],
        body: selectAST({
          target: 'computed',
          fields: ['users', 'total'],
          computedFields: {
            users: path('active'),
            total: path('count_val'),
          },
        }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WITH')
      expect(result.sql).toContain(',')
    })

    it('handles dependent bindings (second references first)', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'user',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
              limit: 1,
            }),
          },
          {
            name: 'posts',
            value: path('user', 'posts'),
          },
        ],
        body: selectAST({ target: 'posts', fields: ['title'] }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('with body types', () => {
    it('translates with + insert body', () => {
      const ast = withAST({
        bindings: [{ name: 'now', value: fn('datetime_current') }],
        body: insertAST({
          target: 'Log',
          assignments: [{ name: 'created_at', value: path('now') }],
        }),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('INSERT')
    })

    it('translates with + update body', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'user',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
              limit: 1,
            }),
          },
        ],
        body: updateAST({
          target: 'user',
          assignments: [{ name: 'active', value: bool(true) }],
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('UPDATE')
    })

    it('translates with + delete body', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'old_users',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('last_login'), '<', cast('datetime', param('cutoff')))),
            }),
          },
        ],
        body: deleteAST({ target: 'old_users' }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('DELETE')
    })

    it('translates with + for body', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'users',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('migrate'), '=', bool(true))),
            }),
          },
        ],
        body: forAST({
          variable: 'user',
          iterator: path('users'),
          body: updateAST({
            target: 'user',
            assignments: [{ name: 'migrated', value: bool(true) }],
          }),
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('with complex expressions', () => {
    it('translates with aggregate binding', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'avg_age',
            value: fn('mean', path('User', 'age')),
          },
        ],
        body: selectAST({
          target: 'User',
          fields: ['name'],
          filter: filter(binary(path('age'), '>', path('avg_age'))),
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })
})

// =============================================================================
// 8. PARAMETER HANDLING TESTS (~15 tests)
// =============================================================================

describe('Query Translator - Parameters', () => {
  describe('named parameters', () => {
    it('translates named parameter to ? placeholder', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
      expect(result.paramNames).toContain('id')
    })

    it('extracts parameter value for binding', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('name'), '=', param('name', 'str'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.paramNames).toContain('name')
    })

    it('handles multiple named parameters', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(path('name'), '=', param('name', 'str')),
            'and',
            binary(path('age'), '>', param('min_age', 'int32'))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql.match(/\?/g)).toHaveLength(2)
      expect(result.paramNames).toContain('name')
      expect(result.paramNames).toContain('min_age')
    })

    it('handles same parameter used multiple times', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(path('first_name'), '=', param('name', 'str')),
            'or',
            binary(path('last_name'), '=', param('name', 'str'))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      // Should have two ? placeholders but same param name
      expect(result.sql.match(/\?/g)).toHaveLength(2)
    })
  })

  describe('positional parameters', () => {
    it('translates positional parameter $0 to ?', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('id'), '=', cast('uuid', param('0')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })

    it('maintains positional order', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(path('name'), '=', param('0', 'str')),
            'and',
            binary(path('age'), '>', param('1', 'int32'))
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.paramNames).toEqual(['0', '1'])
    })
  })

  describe('typed parameters', () => {
    it('handles uuid typed parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('id'), '=', cast('uuid', param('id')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })

    it('handles str typed parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('name'), '=', cast('str', param('name')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })

    it('handles int32 typed parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('age'), '=', cast('int32', param('age')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })

    it('handles datetime typed parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('created_at'), '>', cast('datetime', param('since')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })

    it('handles optional typed parameter', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('parent_id'), '=', cast('optional uuid', param('parent', undefined, true)))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('?')
    })
  })

  describe('parameter extraction', () => {
    it('returns params array in correct order', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [
          { name: 'name', value: str('Alice') },
          { name: 'age', value: num(30) },
          { name: 'active', value: bool(true) },
        ],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toEqual(['Alice', 30, 1])
    })
  })
})

// =============================================================================
// 9. COMPLEX QUERIES TESTS (~15 tests)
// =============================================================================

describe('Query Translator - Complex Queries', () => {
  describe('multi-level nested shapes', () => {
    it('generates correct JOINs for 3-level nesting', () => {
      const ast = {
        type: 'SelectStatement',
        target: 'Post',
        shape: {
          type: 'Shape',
          fields: [
            { type: 'ShapeField', name: 'title' },
            {
              type: 'ShapeField',
              name: 'author',
              shape: {
                type: 'Shape',
                fields: [
                  { type: 'ShapeField', name: 'name' },
                  {
                    type: 'ShapeField',
                    name: 'profile',
                    shape: {
                      type: 'Shape',
                      fields: [{ type: 'ShapeField', name: 'bio' }],
                    },
                  },
                ],
              },
            },
          ],
        },
      }
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('JOIN')
      expect(result.columnMap).toBeDefined()
    })

    it('handles mixed required and optional links', () => {
      const ast = {
        type: 'SelectStatement',
        target: 'Post',
        shape: {
          type: 'Shape',
          fields: [
            { type: 'ShapeField', name: 'title' },
            {
              type: 'ShapeField',
              name: 'author', // required
              shape: {
                type: 'Shape',
                fields: [
                  { type: 'ShapeField', name: 'name' },
                  {
                    type: 'ShapeField',
                    name: 'profile', // optional
                    shape: {
                      type: 'Shape',
                      fields: [{ type: 'ShapeField', name: 'avatar' }],
                    },
                  },
                ],
              },
            },
          ],
        },
      }
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('JOIN')
      expect(result.sql).toContain('LEFT JOIN')
    })
  })

  describe('self-referential queries', () => {
    it('generates self-join for self-referential link', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'friends'],
        nestedShapes: { friends: { fields: ['name'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      // Should join User to itself through junction table
      expect(result.sql).toContain('User_friends')
    })

    it('handles recursive path traversal', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('friends', 'friends', 'name'), '=', str('Alice'))),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('backlink traversal', () => {
    it('translates backlink to reverse FK query', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name', 'authored_posts'],
        computedFields: {
          authored_posts: { type: 'BacklinkExpression', link: 'author', targetType: 'Post' },
        },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('combined operations', () => {
    it('translates with + for + insert', () => {
      const ast = withAST({
        bindings: [
          {
            name: 'users_to_notify',
            value: selectAST({
              target: 'User',
              fields: [],
              filter: filter(binary(path('notify'), '=', bool(true))),
            }),
          },
        ],
        body: forAST({
          variable: 'user',
          iterator: path('users_to_notify'),
          body: insertAST({
            target: 'Notification',
            assignments: [
              { name: 'user_id', value: path('user', 'id') },
              { name: 'message', value: str('You have updates') },
            ],
          }),
        }),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })

    it('handles filter + order + limit + offset', () => {
      const ast = selectAST({
        target: 'Post',
        fields: ['title', 'created_at'],
        filter: filter(binary(path('published'), '=', bool(true))),
        orderBy: orderBy({ expr: path('created_at'), direction: 'desc' }),
        limit: 10,
        offset: 20,
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('LIMIT')
      expect(result.sql).toContain('OFFSET')
    })
  })

  describe('aggregation queries', () => {
    it('translates count aggregation', () => {
      const ast = selectAST({
        target: 'computed',
        fields: ['total'],
        computedFields: { total: fn('count', path('User')) },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('COUNT')
    })

    it('translates grouped aggregation', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['country', 'user_count'],
        computedFields: {
          user_count: fn('count', path('id')),
        },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('throws on unknown type reference', () => {
      const ast = selectAST({ target: 'NonExistentType', fields: ['name'] })

      expect(() => translateQuery(ast as ASTNode, { schema: sampleSchema })).toThrow(/unknown type|not found|NonExistentType/i)
    })

    it('throws on invalid path expression', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('nonexistent', 'field'), '=', str('value'))),
      })

      expect(() => translateQuery(ast as ASTNode, { schema: sampleSchema })).toThrow(/unknown property|invalid path|not found/i)
    })
  })
})

// =============================================================================
// HELPER FUNCTION TESTS
// =============================================================================

describe('Query Translator - Helper Functions', () => {
  describe('operatorToSQL', () => {
    it('converts and to AND', () => {
      expect(operatorToSQL('and')).toBe('AND')
    })

    it('converts or to OR', () => {
      expect(operatorToSQL('or')).toBe('OR')
    })

    it('converts ++ to ||', () => {
      expect(operatorToSQL('++')).toBe('||')
    })

    it('preserves standard operators', () => {
      expect(operatorToSQL('=')).toBe('=')
      expect(operatorToSQL('!=')).toBe('!=')
      expect(operatorToSQL('<')).toBe('<')
      expect(operatorToSQL('>')).toBe('>')
    })
  })

  describe('quoteIdentifier', () => {
    it('wraps identifier in double quotes', () => {
      expect(quoteIdentifier('name')).toBe('"name"')
    })

    it('escapes embedded quotes', () => {
      expect(quoteIdentifier('my"column')).toBe('"my""column"')
    })

    it('handles reserved words', () => {
      expect(quoteIdentifier('select')).toBe('"select"')
    })
  })

  describe('getTableName', () => {
    it('returns type name as table name', () => {
      expect(getTableName('User')).toBe('User')
    })

    it('strips module prefix', () => {
      expect(getTableName('default::User')).toBe('User')
    })

    it('applies table prefix option', () => {
      expect(getTableName('User', undefined, { tablePrefix: 'app_' })).toBe('app_User')
    })
  })

  describe('getColumnName', () => {
    it('returns property name as column name', () => {
      expect(getColumnName('name')).toBe('name')
    })

    it('handles link to FK column', () => {
      const typeDef: TypeDefinition = {
        name: 'Post',
        abstract: false,
        extends: [],
        properties: [],
        links: [{ name: 'author', target: 'User', required: true, cardinality: 'single' }],
        backlinks: [],
        computedProperties: [],
        constraints: [],
        indexes: [],
      }
      expect(getColumnName('author', typeDef)).toBe('author_id')
    })
  })

  describe('pathToSQL', () => {
    it('converts simple path to column reference', () => {
      expect(pathToSQL(['name'])).toBe('"name"')
    })

    it('converts path with table context', () => {
      expect(pathToSQL(['name'], { table: 'User' })).toBe('"User"."name"')
    })

    it('handles nested paths', () => {
      const result = pathToSQL(['author', 'name'], { schema: sampleSchema })
      expect(result).toBeDefined()
    })
  })
})

// =============================================================================
// TRANSLATION OPTIONS TESTS
// =============================================================================

describe('Query Translator - Options', () => {
  describe('parameterized option', () => {
    it('uses placeholders when parameterized=true (default)', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('age'), '>', num(18))),
      })
      const result = translateQuery(ast as ASTNode, { parameterized: true })

      expect(result.sql).toContain('?')
      expect(result.params).toContain(18)
    })

    it('inlines values when parameterized=false', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('age'), '>', num(18))),
      })
      const result = translateQuery(ast as ASTNode, { parameterized: false })

      expect(result.sql).toContain('18')
      expect(result.params).toEqual([])
    })
  })

  describe('quoteIdentifiers option', () => {
    it('quotes identifiers when quoteIdentifiers=true (default)', () => {
      const ast = selectAST({ target: 'User', fields: ['name'] })
      const result = translateQuery(ast as ASTNode, { quoteIdentifiers: true })

      expect(result.sql).toContain('"User"')
      expect(result.sql).toContain('"name"')
    })

    it('does not quote when quoteIdentifiers=false', () => {
      const ast = selectAST({ target: 'User', fields: ['name'] })
      const result = translateQuery(ast as ASTNode, { quoteIdentifiers: false })

      expect(result.sql).not.toContain('"User"')
    })
  })

  describe('tablePrefix option', () => {
    it('prefixes table names', () => {
      const ast = selectAST({ target: 'User', fields: ['name'] })
      const result = translateQuery(ast as ASTNode, { tablePrefix: 'app_' })

      expect(result.sql).toContain('app_User')
    })

    it('prefixes junction table names', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['friends'],
        nestedShapes: { friends: { fields: ['name'] } },
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema, tablePrefix: 'app_' })

      expect(result.sql).toContain('app_User_friends')
    })
  })
})

// =============================================================================
// ADDITIONAL EDGE CASE TESTS
// =============================================================================

describe('Query Translator - Edge Cases', () => {
  describe('special characters', () => {
    it('handles field names with underscores', () => {
      const ast = selectAST({ target: 'User', fields: ['first_name', 'last_name'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"first_name"')
      expect(result.sql).toContain('"last_name"')
    })

    it('handles reserved SQL keywords as field names', () => {
      const ast = selectAST({ target: 'Config', fields: ['select', 'from', 'where'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"select"')
      expect(result.sql).toContain('"from"')
      expect(result.sql).toContain('"where"')
    })

    it('handles type names that are SQL keywords', () => {
      const ast = selectAST({ target: 'Order', fields: ['id'] })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"Order"')
    })
  })

  describe('empty and null values', () => {
    it('handles empty string literal', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'name', value: str('') }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain('')
    })

    it('handles zero numeric literal', () => {
      const ast = insertAST({
        target: 'User',
        assignments: [{ name: 'score', value: num(0) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(0)
    })

    it('handles negative numeric literal', () => {
      const ast = insertAST({
        target: 'Account',
        assignments: [{ name: 'balance', value: num(-100) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(-100)
    })

    it('handles floating point literal', () => {
      const ast = insertAST({
        target: 'Product',
        assignments: [{ name: 'price', value: num(19.99) }],
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(19.99)
    })
  })

  describe('complex filter patterns', () => {
    it('handles deeply nested AND/OR', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(
          binary(
            binary(
              binary(path('a'), '=', bool(true)),
              'and',
              binary(path('b'), '=', bool(true))
            ),
            'or',
            binary(
              binary(path('c'), '=', bool(true)),
              'and',
              binary(path('d'), '=', bool(true))
            )
          )
        ),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('AND')
      expect(result.sql).toContain('OR')
    })

    it('handles multiple NOT operations', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(not(not(path('active')))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('NOT')
    })

    it('handles comparison with path on both sides', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('created_at'), '<', path('updated_at'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('"created_at"')
      expect(result.sql).toContain('"updated_at"')
    })
  })

  describe('type coercion', () => {
    it('converts EdgeQL bool to SQLite INTEGER', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('active'), '=', bool(true))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain(1)
    })

    it('handles datetime comparison', () => {
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(binary(path('created_at'), '>', str('2024-01-01T00:00:00Z'))),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.params).toContain('2024-01-01T00:00:00Z')
    })
  })

  describe('subquery patterns', () => {
    it('handles IN with subquery', () => {
      const subquery = selectAST({ target: 'Admin', fields: ['user_id'] })
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(inExpr(path('id'), { type: 'SubqueryExpression', query: subquery })),
      })
      const result = translateQuery(ast as ASTNode)

      expect(result.sql).toContain('IN')
      expect(result.sql).toContain('SELECT')
    })

    it('handles EXISTS with subquery', () => {
      const subquery = selectAST({
        target: 'Post',
        fields: [],
        filter: filter(binary(path('author_id'), '=', path('User', 'id'))),
      })
      const ast = selectAST({
        target: 'User',
        fields: ['name'],
        filter: filter(exists({ type: 'SubqueryExpression', query: subquery })),
      })
      const result = translateQuery(ast as ASTNode, { schema: sampleSchema })

      expect(result.sql).toContain('EXISTS')
    })
  })
})
