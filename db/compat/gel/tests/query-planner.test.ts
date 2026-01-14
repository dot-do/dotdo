/**
 * Query Planner Tests - TDD RED Phase
 *
 * Tests for the query planner that creates execution plans from EdgeQL AST.
 * The planner sits between the parser and the query translator, providing an
 * intermediate representation that enables optimization.
 *
 * Test Categories:
 * 1. Simple SELECT plans (~8 tests)
 * 2. JOIN planning for link traversal (~10 tests)
 * 3. Filter planning and optimization (~8 tests)
 * 4. Projection planning (~6 tests)
 * 5. INSERT/UPDATE/DELETE plans (~9 tests)
 * 6. Parameter handling (~5 tests)
 * 7. ORDER BY, LIMIT, OFFSET (~6 tests)
 * 8. Complex query plans (~8 tests)
 *
 * @see ../planner.ts - Implementation target
 */

import { describe, it, expect } from 'vitest'

// These imports will fail until planner.ts is implemented
import {
  planQuery,
  type QueryPlan,
  type SelectPlan,
  type InsertPlan,
  type UpdatePlan,
  type DeletePlan,
  type JoinPlan,
  type FilterPlan,
  type ProjectionPlan,
  type OrderPlan,
} from '../planner'

import type { Schema, TypeDefinition, Link } from '../sdl-parser'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a test schema with common types
 */
function createTestSchema(): Schema {
  return {
    module: 'default',
    types: [
      {
        name: 'User',
        abstract: false,
        extending: [],
        final: false,
        properties: [
          { name: 'id', type: 'uuid', required: true, readonly: false, constraints: [] },
          { name: 'name', type: 'str', required: true, readonly: false, constraints: [] },
          { name: 'email', type: 'str', required: true, readonly: false, constraints: [] },
          { name: 'age', type: 'int32', required: false, readonly: false, constraints: [] },
          { name: 'created_at', type: 'datetime', required: false, readonly: false, constraints: [] },
        ],
        links: [
          { name: 'posts', target: 'Post', required: false, cardinality: 'multi' },
          { name: 'profile', target: 'Profile', required: false, cardinality: 'single' },
        ],
        backlinks: [],
        computedProperties: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      {
        name: 'Post',
        abstract: false,
        extending: [],
        final: false,
        properties: [
          { name: 'id', type: 'uuid', required: true, readonly: false, constraints: [] },
          { name: 'title', type: 'str', required: true, readonly: false, constraints: [] },
          { name: 'content', type: 'str', required: false, readonly: false, constraints: [] },
          { name: 'published', type: 'bool', required: false, readonly: false, constraints: [] },
          { name: 'views', type: 'int32', required: false, readonly: false, constraints: [] },
        ],
        links: [
          { name: 'author', target: 'User', required: true, cardinality: 'single' },
          { name: 'comments', target: 'Comment', required: false, cardinality: 'multi' },
          { name: 'tags', target: 'Tag', required: false, cardinality: 'multi' },
        ],
        backlinks: [],
        computedProperties: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      {
        name: 'Comment',
        abstract: false,
        extending: [],
        final: false,
        properties: [
          { name: 'id', type: 'uuid', required: true, readonly: false, constraints: [] },
          { name: 'text', type: 'str', required: true, readonly: false, constraints: [] },
          { name: 'likes', type: 'int32', required: false, readonly: false, constraints: [] },
        ],
        links: [
          { name: 'author', target: 'User', required: true, cardinality: 'single' },
          { name: 'post', target: 'Post', required: true, cardinality: 'single' },
        ],
        backlinks: [],
        computedProperties: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      {
        name: 'Profile',
        abstract: false,
        extending: [],
        final: false,
        properties: [
          { name: 'id', type: 'uuid', required: true, readonly: false, constraints: [] },
          { name: 'bio', type: 'str', required: false, readonly: false, constraints: [] },
          { name: 'avatar_url', type: 'str', required: false, readonly: false, constraints: [] },
        ],
        links: [
          { name: 'user', target: 'User', required: true, cardinality: 'single' },
        ],
        backlinks: [],
        computedProperties: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
      {
        name: 'Tag',
        abstract: false,
        extending: [],
        final: false,
        properties: [
          { name: 'id', type: 'uuid', required: true, readonly: false, constraints: [] },
          { name: 'name', type: 'str', required: true, readonly: false, constraints: [] },
        ],
        links: [],
        backlinks: [],
        computedProperties: [],
        indexes: [],
        constraints: [],
        triggers: [],
      },
    ] as TypeDefinition[],
    scalars: [],
    aliases: [],
    globals: [],
    functions: [],
    annotations: [],
    extensions: [],
  }
}

// AST Builders
const str = (value: string) => ({ type: 'StringLiteral' as const, value })
const num = (value: number) => ({ type: 'NumberLiteral' as const, value })
const bool = (value: boolean) => ({ type: 'BooleanLiteral' as const, value })
const path = (...segments: string[]) => ({
  type: 'PathExpression' as const,
  path: segments.map(name => ({ type: 'PathSegment' as const, name })),
})

function selectAST(opts: {
  target: string
  fields?: string[]
  filter?: object
  orderBy?: object
  limit?: number
  offset?: number
  nestedShapes?: Record<string, { fields: string[] }>
}): object {
  const fields = opts.fields ?? ['id']
  const shape = {
    type: 'Shape',
    fields: fields.map((name) => {
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
      return { type: 'ShapeField', name }
    }),
  }

  return {
    type: 'SelectStatement',
    target: opts.target,
    shape,
    filter: opts.filter,
    orderBy: opts.orderBy,
    limit: opts.limit !== undefined ? { type: 'NumberLiteral', value: opts.limit } : undefined,
    offset: opts.offset !== undefined ? { type: 'NumberLiteral', value: opts.offset } : undefined,
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
}): object {
  return {
    type: 'UpdateStatement',
    target: opts.target,
    filter: opts.filter,
    set: {
      type: 'SetClause',
      assignments: opts.assignments.map((a) => ({
        type: 'Assignment',
        name: a.name,
        value: a.value,
      })),
    },
  }
}

function deleteAST(opts: {
  target: string
  filter?: object
}): object {
  return {
    type: 'DeleteStatement',
    target: opts.target,
    filter: opts.filter,
  }
}

function filterExpr(condition: object): object {
  return {
    type: 'FilterExpression',
    condition,
  }
}

function binExpr(left: object, op: string, right: object): object {
  return {
    type: 'BinaryExpression',
    operator: op,
    left,
    right,
  }
}

function orderByClause(expressions: Array<{ expr: object; dir?: 'asc' | 'desc'; nulls?: 'first' | 'last' }>): object {
  return {
    type: 'OrderByClause',
    expressions: expressions.map(e => ({
      type: 'OrderByExpression',
      expression: e.expr,
      direction: e.dir ?? null,
      nullsPosition: e.nulls ?? null,
    })),
  }
}

// =============================================================================
// 1. SIMPLE SELECT PLANS
// =============================================================================

describe('Query Planner - Simple SELECT', () => {
  const schema = createTestSchema()

  it('plans SELECT *', () => {
    const ast = selectAST({ target: 'User', fields: ['id', 'name', 'email'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.type).toBe('select')
    expect(plan.rootTable).toBe('User')
    expect(plan.projections).toHaveLength(3)
    expect(plan.projections.map(p => p.column)).toEqual(['id', 'name', 'email'])
    expect(plan.joins).toEqual([])
    expect(plan.filter).toBeUndefined()
  })

  it('plans SELECT with single property', () => {
    const ast = selectAST({ target: 'User', fields: ['name'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.type).toBe('select')
    expect(plan.rootTable).toBe('User')
    expect(plan.projections).toHaveLength(1)
    expect(plan.projections[0].column).toBe('name')
  })

  it('plans SELECT with multiple properties', () => {
    const ast = selectAST({ target: 'Post', fields: ['title', 'content', 'published', 'views'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.type).toBe('select')
    expect(plan.rootTable).toBe('Post')
    expect(plan.projections).toHaveLength(4)
    expect(plan.projections.map(p => p.column)).toEqual(['title', 'content', 'published', 'views'])
  })

  it('plans SELECT from different types', () => {
    const userAst = selectAST({ target: 'User', fields: ['id'] })
    const postAst = selectAST({ target: 'Post', fields: ['id'] })
    const commentAst = selectAST({ target: 'Comment', fields: ['id'] })

    const userPlan = planQuery(userAst, { schema }) as SelectPlan
    const postPlan = planQuery(postAst, { schema }) as SelectPlan
    const commentPlan = planQuery(commentAst, { schema }) as SelectPlan

    expect(userPlan.rootTable).toBe('User')
    expect(postPlan.rootTable).toBe('Post')
    expect(commentPlan.rootTable).toBe('Comment')
  })

  it('strips module prefix from type name', () => {
    const ast = selectAST({ target: 'default::User', fields: ['id'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.rootTable).toBe('User')
  })

  it('plans empty shape as SELECT *', () => {
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: { type: 'Shape', fields: [] },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.projections).toEqual([{ column: '*', alias: undefined }])
  })

  it('handles type with no schema', () => {
    const ast = selectAST({ target: 'Unknown', fields: ['id'] })
    const plan = planQuery(ast, {}) as SelectPlan

    expect(plan.rootTable).toBe('Unknown')
    expect(plan.projections).toHaveLength(1)
  })

  it('generates correct projection aliases', () => {
    const ast = selectAST({ target: 'User', fields: ['id', 'name', 'email'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.projections[0].alias).toBeUndefined()
    expect(plan.projections[1].alias).toBeUndefined()
  })
})

// =============================================================================
// 2. JOIN PLANNING
// =============================================================================

describe('Query Planner - JOIN Planning', () => {
  const schema = createTestSchema()

  it('plans single link traversal', () => {
    const ast = selectAST({
      target: 'Post',
      fields: ['title', 'author'],
      nestedShapes: {
        author: { fields: ['name', 'email'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.joins).toHaveLength(1)
    expect(plan.joins[0].targetTable).toBe('User')
    expect(plan.joins[0].joinType).toBe('LEFT')
    expect(plan.joins[0].alias).toBe('_author')
    expect(plan.joins[0].sourceColumn).toBe('author_id')
    expect(plan.joins[0].targetColumn).toBe('id')
  })

  it('plans required link as INNER JOIN', () => {
    const ast = selectAST({
      target: 'Post',
      fields: ['title', 'author'],
      nestedShapes: {
        author: { fields: ['name'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // author is required, so should be INNER JOIN
    expect(plan.joins[0].joinType).toBe('INNER')
  })

  it('plans optional link as LEFT JOIN', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['name', 'profile'],
      nestedShapes: {
        profile: { fields: ['bio'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // profile is optional, so should be LEFT JOIN
    expect(plan.joins[0].joinType).toBe('LEFT')
  })

  it('plans multi-link traversal (junction table)', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['name', 'posts'],
      nestedShapes: {
        posts: { fields: ['title'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Multi-link should use junction table
    expect(plan.joins).toHaveLength(2)
    expect(plan.joins[0].targetTable).toBe('User_posts')
    expect(plan.joins[0].joinType).toBe('LEFT')
    expect(plan.joins[1].targetTable).toBe('Post')
  })

  it('plans nested link traversal (2 levels)', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['name', 'posts'],
      nestedShapes: {
        posts: { fields: ['title', 'author'] },
      },
    })

    // Extend the nested shape to include author
    ;(ast as any).shape.fields[1].shape.fields.push({
      type: 'ShapeField',
      name: 'author',
      shape: {
        type: 'Shape',
        fields: [{ type: 'ShapeField', name: 'name' }],
      },
    })

    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should have 3 joins: User->User_posts->Post->User
    expect(plan.joins.length).toBeGreaterThanOrEqual(3)
  })

  it('plans deeply nested traversal (3+ levels)', () => {
    // User -> posts -> comments -> author
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'name' },
          {
            type: 'ShapeField',
            name: 'posts',
            shape: {
              type: 'Shape',
              fields: [
                { type: 'ShapeField', name: 'title' },
                {
                  type: 'ShapeField',
                  name: 'comments',
                  shape: {
                    type: 'Shape',
                    fields: [
                      { type: 'ShapeField', name: 'text' },
                      {
                        type: 'ShapeField',
                        name: 'author',
                        shape: {
                          type: 'Shape',
                          fields: [{ type: 'ShapeField', name: 'name' }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should have multiple joins for deep traversal
    expect(plan.joins.length).toBeGreaterThanOrEqual(4)
  })

  it('plans backlink traversal', () => {
    // Post.<author[is User]
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'name' },
          {
            type: 'ShapeField',
            name: 'authored_posts',
            backlink: { link: 'author', targetType: 'Post' },
            shape: {
              type: 'Shape',
              fields: [{ type: 'ShapeField', name: 'title' }],
            },
          },
        ],
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.joins.some(j => j.isBacklink === true)).toBe(true)
  })

  it('reuses joins for same link', () => {
    // Selecting the same link multiple times should not duplicate joins
    const ast = selectAST({
      target: 'Post',
      fields: ['title', 'author'],
      nestedShapes: {
        author: { fields: ['name', 'email', 'age'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should have exactly 1 join to User, not 3
    expect(plan.joins.filter(j => j.targetTable === 'User')).toHaveLength(1)
  })

  it('generates unique aliases for repeated link types', () => {
    // Post.author and Comment.author should have different aliases
    const ast = {
      type: 'SelectStatement',
      target: 'Post',
      shape: {
        type: 'Shape',
        fields: [
          {
            type: 'ShapeField',
            name: 'author',
            shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'name' }] },
          },
          {
            type: 'ShapeField',
            name: 'comments',
            shape: {
              type: 'Shape',
              fields: [
                {
                  type: 'ShapeField',
                  name: 'author',
                  shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'name' }] },
                },
              ],
            },
          },
        ],
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    const aliases = plan.joins.map(j => j.alias)
    const uniqueAliases = new Set(aliases)
    expect(uniqueAliases.size).toBe(aliases.length)
  })
})

// =============================================================================
// 3. FILTER PLANNING
// =============================================================================

describe('Query Planner - Filter Planning', () => {
  const schema = createTestSchema()

  it('plans simple equality filter', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id', 'name'],
      filter: filterExpr(binExpr(path('name'), '=', str('Alice'))),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter).toBeDefined()
    expect(plan.filter?.type).toBe('comparison')
    expect(plan.filter?.operator).toBe('=')
    expect(plan.filter?.left.column).toBe('name')
    expect(plan.filter?.right.value).toBe('Alice')
  })

  it('plans comparison operators', () => {
    const operators = ['=', '!=', '<', '<=', '>', '>=']

    for (const op of operators) {
      const ast = selectAST({
        target: 'User',
        fields: ['id'],
        filter: filterExpr(binExpr(path('age'), op, num(25))),
      })
      const plan = planQuery(ast, { schema }) as SelectPlan

      expect(plan.filter?.operator).toBe(op)
    }
  })

  it('plans AND filter', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(
        binExpr(
          binExpr(path('age'), '>', num(18)),
          'and',
          binExpr(path('age'), '<', num(65)),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter?.type).toBe('logical')
    expect(plan.filter?.operator).toBe('and')
    expect(plan.filter?.conditions).toHaveLength(2)
  })

  it('plans OR filter', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(
        binExpr(
          binExpr(path('name'), '=', str('Alice')),
          'or',
          binExpr(path('name'), '=', str('Bob')),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter?.type).toBe('logical')
    expect(plan.filter?.operator).toBe('or')
  })

  it('plans nested logical expressions', () => {
    // (age > 18 AND age < 65) OR name = 'Admin'
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(
        binExpr(
          binExpr(
            binExpr(path('age'), '>', num(18)),
            'and',
            binExpr(path('age'), '<', num(65)),
          ),
          'or',
          binExpr(path('name'), '=', str('Admin')),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter?.type).toBe('logical')
    expect(plan.filter?.operator).toBe('or')
  })

  it('plans filter on linked property', () => {
    // Filter on .author.name
    const ast = selectAST({
      target: 'Post',
      fields: ['title'],
      filter: filterExpr(binExpr(path('author', 'name'), '=', str('Alice'))),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should add a join for the filter
    expect(plan.joins.length).toBeGreaterThanOrEqual(1)
    expect(plan.filter?.left.table).toBe('_author')
  })

  it('optimizes constant folding in filters', () => {
    // Filter like 1 = 1 AND name = 'Alice' should simplify
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(
        binExpr(
          binExpr(num(1), '=', num(1)),
          'and',
          binExpr(path('name'), '=', str('Alice')),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should optimize away the 1=1 condition
    expect(plan.filter?.type).toBe('comparison')
    expect(plan.filter?.operator).toBe('=')
  })

  it('plans IN expression', () => {
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'id' }] },
      filter: {
        type: 'FilterExpression',
        condition: {
          type: 'InExpression',
          expression: path('name'),
          set: { type: 'SetExpression', elements: [str('Alice'), str('Bob'), str('Charlie')] },
          negated: false,
        },
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter?.type).toBe('in')
    expect(plan.filter?.values).toHaveLength(3)
  })
})

// =============================================================================
// 4. PROJECTION PLANNING
// =============================================================================

describe('Query Planner - Projection Planning', () => {
  const schema = createTestSchema()

  it('plans scalar property projection', () => {
    const ast = selectAST({ target: 'User', fields: ['name'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.projections[0]).toEqual({
      column: 'name',
      table: 'User',
      type: 'str',
      alias: undefined,
    })
  })

  it('plans multiple property projections', () => {
    const ast = selectAST({ target: 'User', fields: ['name', 'email', 'age'] })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.projections).toHaveLength(3)
    expect(plan.projections.map(p => p.type)).toEqual(['str', 'str', 'int32'])
  })

  it('plans linked property projection', () => {
    const ast = selectAST({
      target: 'Post',
      fields: ['title', 'author'],
      nestedShapes: {
        author: { fields: ['name', 'email'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should have projections from both tables
    const authorProjections = plan.projections.filter(p => p.table === '_author')
    expect(authorProjections).toHaveLength(2)
  })

  it('plans computed property projection', () => {
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'name' },
          {
            type: 'ShapeField',
            name: 'display_name',
            computed: {
              type: 'ConcatExpression',
              left: path('name'),
              right: str(' (user)'),
            },
          },
        ],
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    const computedProj = plan.projections.find(p => p.alias === 'display_name')
    expect(computedProj?.computed).toBe(true)
    expect(computedProj?.expression).toBeDefined()
  })

  it('plans aggregate function projection', () => {
    const ast = {
      type: 'SelectStatement',
      target: 'Post',
      shape: {
        type: 'Shape',
        fields: [
          {
            type: 'ShapeField',
            name: 'total_views',
            computed: {
              type: 'FunctionCall',
              name: 'sum',
              args: [path('views')],
            },
          },
        ],
      },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    const aggProj = plan.projections.find(p => p.alias === 'total_views')
    expect(aggProj?.aggregate).toBe('sum')
  })

  it('includes id projection for linked objects', () => {
    const ast = selectAST({
      target: 'Post',
      fields: ['author'],
      nestedShapes: {
        author: { fields: ['name'] },
      },
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Should include author_id from Post table
    const fkProjection = plan.projections.find(p => p.column === 'author_id')
    expect(fkProjection).toBeDefined()
  })
})

// =============================================================================
// 5. INSERT/UPDATE/DELETE PLANS
// =============================================================================

describe('Query Planner - INSERT Plans', () => {
  const schema = createTestSchema()

  it('plans simple INSERT', () => {
    const ast = insertAST({
      target: 'User',
      assignments: [
        { name: 'name', value: str('Alice') },
        { name: 'email', value: str('alice@example.com') },
      ],
    })
    const plan = planQuery(ast, { schema }) as InsertPlan

    expect(plan.type).toBe('insert')
    expect(plan.targetTable).toBe('User')
    expect(plan.columns).toEqual(['name', 'email'])
    expect(plan.values).toHaveLength(2)
  })

  it('plans INSERT with link', () => {
    const ast = insertAST({
      target: 'Post',
      assignments: [
        { name: 'title', value: str('My Post') },
        { name: 'author', value: path('existingUser') },
      ],
    })
    const plan = planQuery(ast, { schema }) as InsertPlan

    expect(plan.columns).toContain('author_id')
  })

  it('plans INSERT with nested INSERT', () => {
    const ast = insertAST({
      target: 'Post',
      assignments: [
        { name: 'title', value: str('My Post') },
        {
          name: 'author',
          value: insertAST({
            target: 'User',
            assignments: [
              { name: 'name', value: str('New User') },
              { name: 'email', value: str('new@example.com') },
            ],
          }),
        },
      ],
    })
    const plan = planQuery(ast, { schema }) as InsertPlan

    expect(plan.nestedInserts).toHaveLength(1)
    expect(plan.nestedInserts[0].targetTable).toBe('User')
  })
})

describe('Query Planner - UPDATE Plans', () => {
  const schema = createTestSchema()

  it('plans simple UPDATE', () => {
    const ast = updateAST({
      target: 'User',
      filter: filterExpr(binExpr(path('id'), '=', str('user-123'))),
      assignments: [{ name: 'name', value: str('New Name') }],
    })
    const plan = planQuery(ast, { schema }) as UpdatePlan

    expect(plan.type).toBe('update')
    expect(plan.targetTable).toBe('User')
    expect(plan.filter).toBeDefined()
    expect(plan.assignments).toHaveLength(1)
  })

  it('plans UPDATE with multiple assignments', () => {
    const ast = updateAST({
      target: 'User',
      filter: filterExpr(binExpr(path('id'), '=', str('user-123'))),
      assignments: [
        { name: 'name', value: str('New Name') },
        { name: 'email', value: str('new@example.com') },
        { name: 'age', value: num(30) },
      ],
    })
    const plan = planQuery(ast, { schema }) as UpdatePlan

    expect(plan.assignments).toHaveLength(3)
  })

  it('plans UPDATE with link assignment', () => {
    const ast = updateAST({
      target: 'Post',
      filter: filterExpr(binExpr(path('id'), '=', str('post-123'))),
      assignments: [{ name: 'author', value: path('newAuthor') }],
    })
    const plan = planQuery(ast, { schema }) as UpdatePlan

    expect(plan.assignments[0].column).toBe('author_id')
  })
})

describe('Query Planner - DELETE Plans', () => {
  const schema = createTestSchema()

  it('plans simple DELETE', () => {
    const ast = deleteAST({
      target: 'User',
      filter: filterExpr(binExpr(path('id'), '=', str('user-123'))),
    })
    const plan = planQuery(ast, { schema }) as DeletePlan

    expect(plan.type).toBe('delete')
    expect(plan.targetTable).toBe('User')
    expect(plan.filter).toBeDefined()
  })

  it('plans DELETE with complex filter', () => {
    const ast = deleteAST({
      target: 'Post',
      filter: filterExpr(
        binExpr(
          binExpr(path('published'), '=', bool(false)),
          'and',
          binExpr(path('views'), '<', num(10)),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as DeletePlan

    expect(plan.filter?.type).toBe('logical')
    expect(plan.filter?.operator).toBe('and')
  })

  it('plans DELETE all (no filter)', () => {
    const ast = deleteAST({ target: 'Comment' })
    const plan = planQuery(ast, { schema }) as DeletePlan

    expect(plan.filter).toBeUndefined()
  })
})

// =============================================================================
// 6. PARAMETER HANDLING
// =============================================================================

describe('Query Planner - Parameter Handling', () => {
  const schema = createTestSchema()

  it('captures parameter in filter', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id', 'name'],
      filter: filterExpr(binExpr(path('name'), '=', { type: 'ParameterExpression', name: 'userName' })),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.parameters).toContain('userName')
    expect(plan.filter?.right.isParameter).toBe(true)
    expect(plan.filter?.right.parameterName).toBe('userName')
  })

  it('captures multiple parameters', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(
        binExpr(
          binExpr(path('age'), '>', { type: 'ParameterExpression', name: 'minAge' }),
          'and',
          binExpr(path('age'), '<', { type: 'ParameterExpression', name: 'maxAge' }),
        ),
      ),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.parameters).toContain('minAge')
    expect(plan.parameters).toContain('maxAge')
  })

  it('captures parameter in INSERT values', () => {
    const ast = insertAST({
      target: 'User',
      assignments: [
        { name: 'name', value: { type: 'ParameterExpression', name: 'userName' } },
        { name: 'email', value: { type: 'ParameterExpression', name: 'userEmail' } },
      ],
    })
    const plan = planQuery(ast, { schema }) as InsertPlan

    expect(plan.parameters).toContain('userName')
    expect(plan.parameters).toContain('userEmail')
  })

  it('captures typed parameters', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(binExpr(path('age'), '=', {
        type: 'ParameterExpression',
        name: 'userAge',
        paramType: 'int32',
      })),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.parameterTypes?.userAge).toBe('int32')
  })

  it('captures optional parameters', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(binExpr(path('name'), '=', {
        type: 'ParameterExpression',
        name: 'userName',
        optional: true,
      })),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.optionalParameters).toContain('userName')
  })
})

// =============================================================================
// 7. ORDER BY, LIMIT, OFFSET
// =============================================================================

describe('Query Planner - ORDER BY, LIMIT, OFFSET', () => {
  const schema = createTestSchema()

  it('plans ORDER BY single column', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id', 'name'],
      orderBy: orderByClause([{ expr: path('name') }]),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.orderBy).toBeDefined()
    expect(plan.orderBy?.expressions).toHaveLength(1)
    expect(plan.orderBy?.expressions[0].column).toBe('name')
    expect(plan.orderBy?.expressions[0].direction).toBe('asc')
  })

  it('plans ORDER BY with direction', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      orderBy: orderByClause([{ expr: path('created_at'), dir: 'desc' }]),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.orderBy?.expressions[0].direction).toBe('desc')
  })

  it('plans ORDER BY multiple columns', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      orderBy: orderByClause([
        { expr: path('age'), dir: 'desc' },
        { expr: path('name'), dir: 'asc' },
      ]),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.orderBy?.expressions).toHaveLength(2)
    expect(plan.orderBy?.expressions[0].column).toBe('age')
    expect(plan.orderBy?.expressions[1].column).toBe('name')
  })

  it('plans ORDER BY with NULLS FIRST/LAST', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      orderBy: orderByClause([{ expr: path('age'), dir: 'asc', nulls: 'last' }]),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.orderBy?.expressions[0].nullsPosition).toBe('last')
  })

  it('plans LIMIT', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      limit: 10,
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.limit).toBe(10)
  })

  it('plans OFFSET', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      limit: 10,
      offset: 20,
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.limit).toBe(10)
    expect(plan.offset).toBe(20)
  })
})

// =============================================================================
// 8. COMPLEX QUERY PLANS
// =============================================================================

describe('Query Planner - Complex Queries', () => {
  const schema = createTestSchema()

  it('plans query with multiple joins and filter', () => {
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
            shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'name' }] },
          },
          {
            type: 'ShapeField',
            name: 'comments',
            shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'text' }] },
          },
        ],
      },
      filter: filterExpr(binExpr(path('published'), '=', bool(true))),
      orderBy: orderByClause([{ expr: path('title'), dir: 'asc' }]),
      limit: { type: 'NumberLiteral', value: 10 },
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.type).toBe('select')
    expect(plan.joins.length).toBeGreaterThanOrEqual(2)
    expect(plan.filter).toBeDefined()
    expect(plan.orderBy).toBeDefined()
    expect(plan.limit).toBe(10)
  })

  it('plans query with filter on nested link', () => {
    // SELECT Post { title } FILTER .author.name = 'Alice'
    const ast = selectAST({
      target: 'Post',
      fields: ['title'],
      filter: filterExpr(binExpr(path('author', 'name'), '=', str('Alice'))),
    })
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Filter should reference the joined table
    expect(plan.joins).toHaveLength(1)
    expect(plan.filter?.left.table).toBe('_author')
  })

  it('plans DISTINCT query', () => {
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'name' }] },
      distinct: true,
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.distinct).toBe(true)
  })

  it('plans query with computed filter', () => {
    // Filter on expression: len(.name) > 5
    const ast = {
      type: 'SelectStatement',
      target: 'User',
      shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'id' }] },
      filter: filterExpr(
        binExpr(
          { type: 'FunctionCall', name: 'len', args: [path('name')] },
          '>',
          num(5),
        ),
      ),
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    expect(plan.filter?.left.function).toBe('len')
  })

  it('estimates query cost', () => {
    const simpleAst = selectAST({ target: 'User', fields: ['id'] })
    const complexAst = {
      type: 'SelectStatement',
      target: 'Post',
      shape: {
        type: 'Shape',
        fields: [
          {
            type: 'ShapeField',
            name: 'author',
            shape: {
              type: 'Shape',
              fields: [
                {
                  type: 'ShapeField',
                  name: 'posts',
                  shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'title' }] },
                },
              ],
            },
          },
        ],
      },
    }

    const simplePlan = planQuery(simpleAst, { schema }) as SelectPlan
    const complexPlan = planQuery(complexAst, { schema }) as SelectPlan

    expect(complexPlan.estimatedCost).toBeGreaterThan(simplePlan.estimatedCost)
  })

  it('optimizes join order for performance', () => {
    // Query with multiple joins should order them optimally
    const ast = {
      type: 'SelectStatement',
      target: 'Comment',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'text' },
          {
            type: 'ShapeField',
            name: 'post',
            shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'title' }] },
          },
          {
            type: 'ShapeField',
            name: 'author',
            shape: { type: 'Shape', fields: [{ type: 'ShapeField', name: 'name' }] },
          },
        ],
      },
      filter: filterExpr(binExpr(path('author', 'name'), '=', str('Alice'))),
    }
    const plan = planQuery(ast, { schema }) as SelectPlan

    // Join with filter should be prioritized
    expect(plan.joins[0].alias).toBe('_author')
  })

  it('handles self-referential links', () => {
    // Add a manager link to User
    const schemaWithSelfRef: Schema = {
      ...schema,
      types: schema.types.map(t => {
        if (t.name === 'User') {
          return {
            ...t,
            links: [
              ...t.links,
              { name: 'manager', target: 'User', required: false, cardinality: 'single' as const },
            ],
          }
        }
        return t
      }),
    }

    const ast = selectAST({
      target: 'User',
      fields: ['name', 'manager'],
      nestedShapes: {
        manager: { fields: ['name'] },
      },
    })
    const plan = planQuery(ast, { schema: schemaWithSelfRef }) as SelectPlan

    expect(plan.joins).toHaveLength(1)
    expect(plan.joins[0].targetTable).toBe('User')
    expect(plan.joins[0].alias).not.toBe('User') // Should use unique alias
  })

  it('validates filter references against schema', () => {
    const ast = selectAST({
      target: 'User',
      fields: ['id'],
      filter: filterExpr(binExpr(path('nonexistent'), '=', str('value'))),
    })

    expect(() => planQuery(ast, { schema })).toThrow(/unknown property/i)
  })
})
