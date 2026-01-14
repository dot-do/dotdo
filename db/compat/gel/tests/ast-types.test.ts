/**
 * AST Types Tests - TDD RED Phase
 *
 * Tests that verify EdgeQL AST types are properly defined and used
 * throughout the query translator and client modules.
 *
 * These tests ensure type safety for AST operations, replacing
 * `any` types with proper EdgeQL AST types.
 *
 * @see client.ts - lines 402, 548, 589, 711, 718, 721
 * @see query-translator.ts - lines 401, 648, 844, 917
 */

import { describe, it, expect } from 'vitest'
import type {
  Statement,
  SelectStatement,
  InsertStatement,
  UpdateStatement,
  DeleteStatement,
  ForStatement,
  WithBlock,
  Expression,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  PathExpression,
  BinaryExpression,
  UnaryExpression,
  CastExpression,
  ParameterExpression,
  FunctionCall,
  SetExpression,
  InExpression,
  LikeExpression,
  FilterExpression,
  Shape,
  ShapeField,
  InsertData,
  Assignment,
  SetClause,
  OrderByClause,
  PathSegment,
} from '../edgeql-parser'

import type {
  TranslatedQuery,
  TranslateOptions,
  ASTNode,
  ExtendedExpression,
} from '../query-translator'

import { translateQuery, translateExpression } from '../query-translator'

// =============================================================================
// AST TYPE DEFINITIONS TESTS
// =============================================================================

describe('AST type definitions', () => {
  describe('InsertStatement AST structure', () => {
    it('should have proper InsertData with typed assignments', () => {
      const insertData: InsertData = {
        type: 'InsertData',
        assignments: [
          {
            type: 'Assignment',
            name: 'email',
            value: { type: 'StringLiteral', value: 'test@example.com' },
          },
          {
            type: 'Assignment',
            name: 'age',
            value: { type: 'NumberLiteral', value: 25 },
          },
        ],
      }

      expect(insertData.type).toBe('InsertData')
      expect(insertData.assignments).toHaveLength(2)
      expect(insertData.assignments[0].name).toBe('email')
      expect(insertData.assignments[0].value.type).toBe('StringLiteral')
    })

    it('should enforce Assignment name is string', () => {
      const assignment: Assignment = {
        type: 'Assignment',
        name: 'fieldName',
        value: { type: 'NumberLiteral', value: 42 },
      }

      expect(typeof assignment.name).toBe('string')
    })

    it('should enforce Assignment value is Expression', () => {
      const stringAssignment: Assignment = {
        type: 'Assignment',
        name: 'name',
        value: { type: 'StringLiteral', value: 'Alice' } as StringLiteral,
      }

      const numberAssignment: Assignment = {
        type: 'Assignment',
        name: 'count',
        value: { type: 'NumberLiteral', value: 100 } as NumberLiteral,
      }

      const boolAssignment: Assignment = {
        type: 'Assignment',
        name: 'active',
        value: { type: 'BooleanLiteral', value: true } as BooleanLiteral,
      }

      expect(stringAssignment.value.type).toBe('StringLiteral')
      expect(numberAssignment.value.type).toBe('NumberLiteral')
      expect(boolAssignment.value.type).toBe('BooleanLiteral')
    })
  })

  describe('SelectStatement AST structure', () => {
    it('should have properly typed Shape with ShapeFields', () => {
      const shape: Shape = {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'id' },
          { type: 'ShapeField', name: 'name' },
          {
            type: 'ShapeField',
            name: 'author',
            shape: {
              type: 'Shape',
              fields: [{ type: 'ShapeField', name: 'name' }],
            },
          },
        ],
      }

      expect(shape.type).toBe('Shape')
      expect(shape.fields).toHaveLength(3)
      expect(shape.fields[2].shape?.fields[0].name).toBe('name')
    })

    it('should support computed ShapeFields with Expression', () => {
      const computedField: ShapeField = {
        type: 'ShapeField',
        name: 'full_name',
        computed: {
          type: 'ConcatExpression',
          left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'first_name' }] },
          right: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'last_name' }] },
        } as Expression,
      }

      expect(computedField.computed).toBeDefined()
      expect((computedField.computed as any).type).toBe('ConcatExpression')
    })
  })

  describe('Expression type union', () => {
    it('should accept StringLiteral as Expression', () => {
      const expr: Expression = { type: 'StringLiteral', value: 'hello' }
      expect(expr.type).toBe('StringLiteral')
    })

    it('should accept NumberLiteral as Expression', () => {
      const expr: Expression = { type: 'NumberLiteral', value: 42 }
      expect(expr.type).toBe('NumberLiteral')
    })

    it('should accept BooleanLiteral as Expression', () => {
      const expr: Expression = { type: 'BooleanLiteral', value: true }
      expect(expr.type).toBe('BooleanLiteral')
    })

    it('should accept PathExpression as Expression', () => {
      const expr: Expression = {
        type: 'PathExpression',
        path: [{ type: 'PathSegment', name: 'name' }],
      }
      expect(expr.type).toBe('PathExpression')
    })

    it('should accept BinaryExpression as Expression', () => {
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: '=',
        left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'id' }] },
        right: { type: 'NumberLiteral', value: 1 },
      }
      expect(expr.type).toBe('BinaryExpression')
    })

    it('should accept nested BinaryExpressions', () => {
      const expr: Expression = {
        type: 'BinaryExpression',
        operator: 'and',
        left: {
          type: 'BinaryExpression',
          operator: '=',
          left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'a' }] },
          right: { type: 'NumberLiteral', value: 1 },
        },
        right: {
          type: 'BinaryExpression',
          operator: '>',
          left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'b' }] },
          right: { type: 'NumberLiteral', value: 2 },
        },
      }
      expect(expr.type).toBe('BinaryExpression')
    })
  })

  describe('PathSegment type', () => {
    it('should have required name property', () => {
      const segment: PathSegment = {
        type: 'PathSegment',
        name: 'field',
      }
      expect(segment.name).toBe('field')
    })

    it('should support optional navigation property', () => {
      const forwardSegment: PathSegment = {
        type: 'PathSegment',
        name: 'link',
        navigation: 'forward',
      }

      const backwardSegment: PathSegment = {
        type: 'PathSegment',
        name: 'owner',
        navigation: 'backward',
      }

      expect(forwardSegment.navigation).toBe('forward')
      expect(backwardSegment.navigation).toBe('backward')
    })

    it('should support optional typeFilter property', () => {
      const segment: PathSegment = {
        type: 'PathSegment',
        name: 'items',
        typeFilter: 'Book',
      }
      expect(segment.typeFilter).toBe('Book')
    })

    it('should support optional index property', () => {
      const segmentWithIndex: PathSegment = {
        type: 'PathSegment',
        name: 'items',
        index: 0,
      }

      const segmentWithExprIndex: PathSegment = {
        type: 'PathSegment',
        name: 'items',
        index: { type: 'NumberLiteral', value: 0 },
      }

      expect(segmentWithIndex.index).toBe(0)
      expect((segmentWithExprIndex.index as NumberLiteral).type).toBe('NumberLiteral')
    })
  })
})

// =============================================================================
// AST TRANSLATION TYPE SAFETY TESTS
// =============================================================================

describe('AST translation type safety', () => {
  describe('translateQuery with typed AST', () => {
    it('should translate SelectStatement with full type safety', () => {
      const ast: SelectStatement = {
        type: 'SelectStatement',
        target: 'User',
        shape: {
          type: 'Shape',
          fields: [
            { type: 'ShapeField', name: 'id' },
            { type: 'ShapeField', name: 'name' },
          ],
        },
      }

      const result: TranslatedQuery = translateQuery(ast)
      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('User')
    })

    it('should translate InsertStatement with typed InsertData', () => {
      const ast: InsertStatement = {
        type: 'InsertStatement',
        target: 'User',
        data: {
          type: 'InsertData',
          assignments: [
            {
              type: 'Assignment',
              name: 'name',
              value: { type: 'StringLiteral', value: 'Alice' },
            },
          ],
        },
      }

      const result: TranslatedQuery = translateQuery(ast)
      expect(result.sql).toContain('INSERT')
      expect(result.sql).toContain('User')
    })

    it('should translate UpdateStatement with typed SetClause', () => {
      const ast: UpdateStatement = {
        type: 'UpdateStatement',
        target: 'User',
        set: {
          type: 'SetClause',
          assignments: [
            {
              type: 'Assignment',
              name: 'name',
              value: { type: 'StringLiteral', value: 'Bob' },
            },
          ],
        },
      }

      const result: TranslatedQuery = translateQuery(ast)
      expect(result.sql).toContain('UPDATE')
      expect(result.sql).toContain('User')
    })

    it('should translate DeleteStatement with typed filter', () => {
      const ast: DeleteStatement = {
        type: 'DeleteStatement',
        target: 'User',
        filter: {
          type: 'FilterExpression',
          condition: {
            type: 'BinaryExpression',
            operator: '=',
            left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'id' }] },
            right: { type: 'NumberLiteral', value: 1 },
          },
        },
      }

      const result: TranslatedQuery = translateQuery(ast)
      expect(result.sql).toContain('DELETE')
      expect(result.sql).toContain('User')
    })
  })

  describe('translateExpression with typed expressions', () => {
    it('should translate StringLiteral', () => {
      const expr: StringLiteral = { type: 'StringLiteral', value: 'hello' }
      const result = translateExpression(expr)
      expect(result.params).toContain('hello')
    })

    it('should translate NumberLiteral', () => {
      const expr: NumberLiteral = { type: 'NumberLiteral', value: 42 }
      const result = translateExpression(expr)
      expect(result.params).toContain(42)
    })

    it('should translate BooleanLiteral', () => {
      const expr: BooleanLiteral = { type: 'BooleanLiteral', value: true }
      const result = translateExpression(expr)
      expect(result.params).toContain(1) // SQLite uses 1/0 for booleans
    })

    it('should translate PathExpression', () => {
      const expr: PathExpression = {
        type: 'PathExpression',
        path: [{ type: 'PathSegment', name: 'name' }],
      }
      const result = translateExpression(expr)
      expect(result.sql).toContain('name')
    })

    it('should translate BinaryExpression', () => {
      const expr: BinaryExpression = {
        type: 'BinaryExpression',
        operator: '=',
        left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'id' }] },
        right: { type: 'NumberLiteral', value: 1 },
      }
      const result = translateExpression(expr)
      expect(result.sql).toContain('=')
    })
  })
})

// =============================================================================
// AST TYPE GUARD TESTS
// =============================================================================

describe('AST type discrimination', () => {
  it('should discriminate Statement types', () => {
    const statements: Statement[] = [
      {
        type: 'SelectStatement',
        target: 'User',
        shape: { type: 'Shape', fields: [] },
      },
      {
        type: 'InsertStatement',
        target: 'User',
        data: { type: 'InsertData', assignments: [] },
      },
      {
        type: 'UpdateStatement',
        target: 'User',
        set: { type: 'SetClause', assignments: [] },
      },
      {
        type: 'DeleteStatement',
        target: 'User',
      },
    ]

    for (const stmt of statements) {
      switch (stmt.type) {
        case 'SelectStatement':
          expect(stmt.shape).toBeDefined()
          break
        case 'InsertStatement':
          expect(stmt.data).toBeDefined()
          break
        case 'UpdateStatement':
          expect(stmt.set).toBeDefined()
          break
        case 'DeleteStatement':
          expect(stmt.target).toBeDefined()
          break
        default:
          // ForStatement and WithBlock handled separately
          break
      }
    }
  })

  it('should discriminate Expression types', () => {
    const expressions: Expression[] = [
      { type: 'StringLiteral', value: 'hello' },
      { type: 'NumberLiteral', value: 42 },
      { type: 'BooleanLiteral', value: true },
      {
        type: 'PathExpression',
        path: [{ type: 'PathSegment', name: 'name' }],
      },
      {
        type: 'BinaryExpression',
        operator: '=',
        left: { type: 'NumberLiteral', value: 1 },
        right: { type: 'NumberLiteral', value: 2 },
      },
    ]

    for (const expr of expressions) {
      switch (expr.type) {
        case 'StringLiteral':
          expect(typeof expr.value).toBe('string')
          break
        case 'NumberLiteral':
          expect(typeof expr.value).toBe('number')
          break
        case 'BooleanLiteral':
          expect(typeof expr.value).toBe('boolean')
          break
        case 'PathExpression':
          expect(Array.isArray(expr.path)).toBe(true)
          break
        case 'BinaryExpression':
          expect(expr.left).toBeDefined()
          expect(expr.right).toBeDefined()
          break
      }
    }
  })
})

// =============================================================================
// INSERT AST HYDRATION TYPE TESTS (client.ts line 402)
// =============================================================================

describe('INSERT AST value extraction type safety', () => {
  it('should extract StringLiteral values from Assignment', () => {
    const assignment: Assignment = {
      type: 'Assignment',
      name: 'email',
      value: { type: 'StringLiteral', value: 'test@example.com' },
    }

    const value = assignment.value
    if (value.type === 'StringLiteral') {
      expect(value.value).toBe('test@example.com')
    }
  })

  it('should extract NumberLiteral values from Assignment', () => {
    const assignment: Assignment = {
      type: 'Assignment',
      name: 'age',
      value: { type: 'NumberLiteral', value: 25 },
    }

    const value = assignment.value
    if (value.type === 'NumberLiteral') {
      expect(value.value).toBe(25)
    }
  })

  it('should extract BooleanLiteral values from Assignment', () => {
    const assignment: Assignment = {
      type: 'Assignment',
      name: 'active',
      value: { type: 'BooleanLiteral', value: true },
    }

    const value = assignment.value
    if (value.type === 'BooleanLiteral') {
      expect(value.value).toBe(true)
    }
  })

  it('should handle nested InsertStatement in Assignment', () => {
    const nestedInsert: InsertStatement = {
      type: 'InsertStatement',
      target: 'Address',
      data: {
        type: 'InsertData',
        assignments: [
          {
            type: 'Assignment',
            name: 'street',
            value: { type: 'StringLiteral', value: '123 Main St' },
          },
        ],
      },
    }

    const assignment: Assignment = {
      type: 'Assignment',
      name: 'address',
      value: nestedInsert,
    }

    expect(assignment.value.type).toBe('InsertStatement')
  })
})

// =============================================================================
// FILTER AST TYPE TESTS (client.ts lines 548, 589)
// =============================================================================

describe('Filter AST type safety for INSERT validation', () => {
  it('should access InsertData assignments with type safety', () => {
    const insertAST: InsertStatement = {
      type: 'InsertStatement',
      target: 'User',
      data: {
        type: 'InsertData',
        assignments: [
          {
            type: 'Assignment',
            name: 'email',
            value: { type: 'StringLiteral', value: 'test@example.com' },
          },
        ],
      },
    }

    // Type-safe access to assignments
    const assignments = insertAST.data.assignments
    expect(assignments).toBeInstanceOf(Array)

    for (const assignment of assignments) {
      expect(assignment.type).toBe('Assignment')
      expect(typeof assignment.name).toBe('string')
    }
  })

  it('should extract values for unique constraint validation', () => {
    const insertAST: InsertStatement = {
      type: 'InsertStatement',
      target: 'User',
      data: {
        type: 'InsertData',
        assignments: [
          {
            type: 'Assignment',
            name: 'email',
            value: { type: 'StringLiteral', value: 'unique@example.com' },
          },
        ],
      },
    }

    const assignments = insertAST.data.assignments
    const providedValues: Record<string, string> = {}

    for (const assignment of assignments) {
      const value = assignment.value
      if (value.type === 'StringLiteral') {
        providedValues[assignment.name] = value.value
      }
    }

    expect(providedValues['email']).toBe('unique@example.com')
  })
})

// =============================================================================
// HYDRATION AST TYPE TESTS (client.ts lines 711, 718, 721)
// =============================================================================

describe('Result hydration AST type safety', () => {
  it('should handle SelectStatement shape for hydration', () => {
    const selectAST: SelectStatement = {
      type: 'SelectStatement',
      target: 'User',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'id' },
          { type: 'ShapeField', name: 'name' },
          { type: 'ShapeField', name: 'active' },
        ],
      },
    }

    // Type-safe field iteration for hydration
    const fieldNames = selectAST.shape.fields.map(f => f.name)
    expect(fieldNames).toContain('id')
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('active')
  })

  it('should handle nested shapes for hydration', () => {
    const selectAST: SelectStatement = {
      type: 'SelectStatement',
      target: 'Post',
      shape: {
        type: 'Shape',
        fields: [
          { type: 'ShapeField', name: 'id' },
          { type: 'ShapeField', name: 'title' },
          {
            type: 'ShapeField',
            name: 'author',
            shape: {
              type: 'Shape',
              fields: [
                { type: 'ShapeField', name: 'id' },
                { type: 'ShapeField', name: 'name' },
              ],
            },
          },
        ],
      },
    }

    // Type-safe nested shape access
    const authorField = selectAST.shape.fields.find(f => f.name === 'author')
    expect(authorField?.shape).toBeDefined()
    expect(authorField?.shape?.fields.map(f => f.name)).toContain('name')
  })
})

// =============================================================================
// TRANSLATOR INTERNAL TYPE TESTS (query-translator.ts lines 401, 648, 844, 917)
// =============================================================================

describe('Query translator internal type safety', () => {
  describe('exprToSQL type handling (line 401)', () => {
    it('should handle all Expression variant types', () => {
      const expressionVariants: Expression[] = [
        { type: 'StringLiteral', value: 'test' },
        { type: 'NumberLiteral', value: 123 },
        { type: 'BooleanLiteral', value: false },
        {
          type: 'PathExpression',
          path: [{ type: 'PathSegment', name: 'field' }],
        },
        {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'NumberLiteral', value: 1 },
          right: { type: 'NumberLiteral', value: 2 },
        },
        {
          type: 'UnaryExpression',
          operator: '-',
          operand: { type: 'NumberLiteral', value: 5 },
        },
      ]

      for (const expr of expressionVariants) {
        const result = translateExpression(expr)
        expect(result.sql).toBeDefined()
      }
    })
  })

  describe('translateSelectInternal type handling (line 648)', () => {
    it('should handle SelectStatement with all optional clauses', () => {
      const fullSelect: SelectStatement = {
        type: 'SelectStatement',
        target: 'User',
        shape: {
          type: 'Shape',
          fields: [{ type: 'ShapeField', name: 'id' }],
        },
        filter: {
          type: 'FilterExpression',
          condition: {
            type: 'BinaryExpression',
            operator: '>',
            left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'age' }] },
            right: { type: 'NumberLiteral', value: 18 },
          },
        },
        orderBy: {
          type: 'OrderByClause',
          expressions: [
            {
              type: 'OrderByExpression',
              expression: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'name' }] },
              direction: 'asc',
              nullsPosition: null,
            },
          ],
        },
        limit: { type: 'NumberLiteral', value: 10 },
        offset: { type: 'NumberLiteral', value: 0 },
      }

      const result = translateQuery(fullSelect)
      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('LIMIT')
    })
  })

  describe('translateInsertInternal type handling (line 844)', () => {
    it('should handle InsertStatement with various value types', () => {
      const insert: InsertStatement = {
        type: 'InsertStatement',
        target: 'User',
        data: {
          type: 'InsertData',
          assignments: [
            {
              type: 'Assignment',
              name: 'name',
              value: { type: 'StringLiteral', value: 'Alice' },
            },
            {
              type: 'Assignment',
              name: 'age',
              value: { type: 'NumberLiteral', value: 30 },
            },
            {
              type: 'Assignment',
              name: 'active',
              value: { type: 'BooleanLiteral', value: true },
            },
          ],
        },
      }

      const result = translateQuery(insert)
      expect(result.sql).toContain('INSERT INTO')
      expect(result.sql).toContain('VALUES')
    })
  })

  describe('translateUpdateInternal type handling (line 917)', () => {
    it('should handle UpdateStatement with SetClause', () => {
      const update: UpdateStatement = {
        type: 'UpdateStatement',
        target: 'User',
        filter: {
          type: 'FilterExpression',
          condition: {
            type: 'BinaryExpression',
            operator: '=',
            left: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'id' }] },
            right: { type: 'NumberLiteral', value: 1 },
          },
        },
        set: {
          type: 'SetClause',
          assignments: [
            {
              type: 'Assignment',
              name: 'name',
              value: { type: 'StringLiteral', value: 'Updated Name' },
            },
          ],
        },
      }

      const result = translateQuery(update)
      expect(result.sql).toContain('UPDATE')
      expect(result.sql).toContain('SET')
      expect(result.sql).toContain('WHERE')
    })
  })
})

// =============================================================================
// ASTNode TYPE COVERAGE TESTS
// =============================================================================

describe('ASTNode type coverage', () => {
  it('should include all statement types in ASTNode union', () => {
    const nodes: ASTNode[] = [
      {
        type: 'SelectStatement',
        target: 'User',
        shape: { type: 'Shape', fields: [] },
      } as SelectStatement,
      {
        type: 'InsertStatement',
        target: 'User',
        data: { type: 'InsertData', assignments: [] },
      } as InsertStatement,
      {
        type: 'UpdateStatement',
        target: 'User',
        set: { type: 'SetClause', assignments: [] },
      } as UpdateStatement,
      {
        type: 'DeleteStatement',
        target: 'User',
      } as DeleteStatement,
      {
        type: 'ForStatement',
        variable: 'item',
        iterator: { type: 'PathExpression', path: [{ type: 'PathSegment', name: 'items' }] },
        body: {
          type: 'SelectStatement',
          target: 'item',
          shape: { type: 'Shape', fields: [] },
        },
      } as ForStatement,
      {
        type: 'WithBlock',
        bindings: [],
        body: {
          type: 'SelectStatement',
          target: 'User',
          shape: { type: 'Shape', fields: [] },
        },
      } as WithBlock,
    ]

    // All should be translatable without errors
    for (const node of nodes) {
      expect(() => translateQuery(node)).not.toThrow()
    }
  })
})
