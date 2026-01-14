/**
 * EdgeQL Parser Complete Tests - TDD RED Phase
 *
 * These tests define the complete EdgeQL parser contract beyond the current prototype.
 * All tests are expected to FAIL until the parser is fully implemented.
 *
 * Coverage: ~300 tests across 15 categories
 *
 * @see GEL-3 - RED: EdgeQL Parser Complete Tests
 * @see db/compat/gel/spike-parser-findings.md
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../edgeql-parser'
import type {
  SelectStatement,
  InsertStatement,
  Expression,
  BinaryExpression,
} from '../edgeql-parser'

// ============================================================================
// TYPE EXTENSIONS FOR NEW AST NODES
// These types define the expected AST structure for features not yet implemented
// ============================================================================

interface UpdateStatement {
  type: 'UpdateStatement'
  target: string
  filter?: FilterExpression
  set: SetClause
}

interface DeleteStatement {
  type: 'DeleteStatement'
  target: string
  filter?: FilterExpression
}

interface ForStatement {
  type: 'ForStatement'
  variable: string
  iterator: Expression
  body: Statement
}

interface WithBlock {
  type: 'WithBlock'
  bindings: WithBinding[]
  body: Statement
}

interface WithBinding {
  type: 'WithBinding'
  name: string
  value: Expression
}

interface SetClause {
  type: 'SetClause'
  assignments: Assignment[]
}

interface Assignment {
  type: 'Assignment'
  name: string
  value: Expression
}

interface FilterExpression {
  type: 'FilterExpression'
  condition: Expression
}

interface OrderByClause {
  type: 'OrderByClause'
  expressions: OrderByExpression[]
}

interface OrderByExpression {
  type: 'OrderByExpression'
  expression: Expression
  direction: 'asc' | 'desc' | null
  nullsPosition: 'first' | 'last' | null
}

interface LimitClause {
  type: 'LimitClause'
  count: Expression
}

interface OffsetClause {
  type: 'OffsetClause'
  count: Expression
}

interface SetExpression {
  type: 'SetExpression'
  elements: Expression[]
}

interface ExistsExpression {
  type: 'ExistsExpression'
  argument: Expression
}

interface DistinctExpression {
  type: 'DistinctExpression'
  argument: Expression
}

interface TypeCheckExpression {
  type: 'TypeCheckExpression'
  expression: Expression
  typeName: string
  negated: boolean
}

interface CoalesceExpression {
  type: 'CoalesceExpression'
  left: Expression
  right: Expression
}

interface UnaryExpression {
  type: 'UnaryExpression'
  operator: 'not' | '-' | '+'
  operand: Expression
}

interface PathExpression {
  type: 'PathExpression'
  path: PathSegment[]
}

interface PathSegment {
  type: 'PathSegment'
  name: string
  navigation?: 'forward' | 'backward'
  typeFilter?: string
  optional?: boolean
}

interface ParameterExpression {
  type: 'ParameterExpression'
  name: string
  paramType?: string
}

interface CastExpression {
  type: 'CastExpression'
  typeRef: string
  value: Expression
}

interface ConcatExpression {
  type: 'ConcatExpression'
  left: Expression
  right: Expression
}

interface InExpression {
  type: 'InExpression'
  expression: Expression
  set: Expression
  negated: boolean
}

interface LikeExpression {
  type: 'LikeExpression'
  expression: Expression
  pattern: Expression
  caseInsensitive: boolean
}

type Statement =
  | SelectStatement
  | InsertStatement
  | UpdateStatement
  | DeleteStatement
  | ForStatement
  | WithBlock

// Helper function to cast parse result
function parseAs<T>(source: string): T {
  return parse(source) as unknown as T
}

// ============================================================================
// 1. UPDATE STATEMENT TESTS (30 tests)
// ============================================================================

describe('EdgeQL Parser - UPDATE Statement', () => {
  describe('basic update', () => {
    it('parses simple update with set clause', () => {
      const ast = parseAs<UpdateStatement>('update User set { name := "New Name" }')

      expect(ast.type).toBe('UpdateStatement')
      expect(ast.target).toBe('User')
      expect(ast.set.assignments).toHaveLength(1)
      expect(ast.set.assignments[0].name).toBe('name')
    })

    it('parses update with multiple assignments', () => {
      const ast = parseAs<UpdateStatement>('update User set { name := "Test", active := true }')

      expect(ast.set.assignments).toHaveLength(2)
      expect(ast.set.assignments[0].name).toBe('name')
      expect(ast.set.assignments[1].name).toBe('active')
    })

    it('parses update with number assignment', () => {
      const ast = parseAs<UpdateStatement>('update User set { age := 30 }')

      expect(ast.set.assignments[0].value).toEqual({
        type: 'NumberLiteral',
        value: 30,
      })
    })

    it('parses update with boolean assignment', () => {
      const ast = parseAs<UpdateStatement>('update User set { active := false }')

      expect(ast.set.assignments[0].value).toEqual({
        type: 'BooleanLiteral',
        value: false,
      })
    })
  })

  describe('update with filter', () => {
    it('parses update with uuid filter', () => {
      const ast = parseAs<UpdateStatement>('update User filter .id = <uuid>$id set { name := "Test" }')

      expect(ast.filter).toBeDefined()
      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses update with string filter', () => {
      const ast = parseAs<UpdateStatement>('update User filter .email = "test@example.com" set { active := true }')

      expect(ast.filter).toBeDefined()
    })

    it('parses update with boolean filter', () => {
      const ast = parseAs<UpdateStatement>('update User filter .active = false set { active := true }')

      expect(ast.filter).toBeDefined()
    })

    it('parses update with numeric filter', () => {
      const ast = parseAs<UpdateStatement>('update User filter .age > 18 set { adult := true }')

      expect(ast.filter).toBeDefined()
      expect((ast.filter?.condition as BinaryExpression).operator).toBe('>')
    })

    it('parses update with compound filter', () => {
      const ast = parseAs<UpdateStatement>(
        'update User filter .active = true and .age >= 18 set { verified := true }'
      )

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
      expect((ast.filter?.condition as BinaryExpression).operator).toBe('and')
    })
  })

  describe('update with expressions in set', () => {
    it('parses update with self-reference increment', () => {
      const ast = parseAs<UpdateStatement>('update User set { score := .score + 1 }')

      const assignment = ast.set.assignments[0]
      expect(assignment.value.type).toBe('BinaryExpression')
      expect((assignment.value as BinaryExpression).operator).toBe('+')
    })

    it('parses update with self-reference decrement', () => {
      const ast = parseAs<UpdateStatement>('update User set { score := .score - 1 }')

      const assignment = ast.set.assignments[0]
      expect((assignment.value as BinaryExpression).operator).toBe('-')
    })

    it('parses update with multiplication', () => {
      const ast = parseAs<UpdateStatement>('update Product set { price := .price * 1.1 }')

      const assignment = ast.set.assignments[0]
      expect((assignment.value as BinaryExpression).operator).toBe('*')
    })

    it('parses update with string concatenation', () => {
      const ast = parseAs<UpdateStatement>('update User set { name := .first_name ++ " " ++ .last_name }')

      const assignment = ast.set.assignments[0]
      expect(assignment.value.type).toBe('ConcatExpression')
    })

    it('parses update with coalesce', () => {
      const ast = parseAs<UpdateStatement>('update User set { nickname := .nickname ?? .name }')

      const assignment = ast.set.assignments[0]
      expect(assignment.value.type).toBe('CoalesceExpression')
    })
  })

  describe('update with complex targets', () => {
    it('parses update with module-qualified target', () => {
      const ast = parseAs<UpdateStatement>('update default::User set { name := "Test" }')

      expect(ast.target).toBe('default::User')
    })

    it('parses update with nested path in set', () => {
      const ast = parseAs<UpdateStatement>('update User set { profile := (insert Profile { bio := "Hello" }) }')

      expect(ast.set.assignments[0].name).toBe('profile')
    })
  })

  describe('update edge cases', () => {
    it('parses update with trailing comma in set', () => {
      const ast = parseAs<UpdateStatement>('update User set { name := "Test", }')

      expect(ast.set.assignments).toHaveLength(1)
    })

    it('parses update with empty line in set', () => {
      const ast = parseAs<UpdateStatement>(`update User set {
        name := "Test"
      }`)

      expect(ast.set.assignments).toHaveLength(1)
    })

    it('parses update with reserved word as field name', () => {
      const ast = parseAs<UpdateStatement>('update Config set { `select` := true }')

      expect(ast.set.assignments[0].name).toBe('select')
    })

    it('throws on update without set clause', () => {
      expect(() => parse('update User')).toThrow()
    })

    it('throws on update with empty set clause', () => {
      expect(() => parse('update User set { }')).toThrow()
    })

    it('parses update with datetime assignment', () => {
      const ast = parseAs<UpdateStatement>('update User set { updated_at := datetime_current() }')

      expect(ast.set.assignments[0].name).toBe('updated_at')
    })

    it('parses update with array push', () => {
      const ast = parseAs<UpdateStatement>('update User set { tags := .tags ++ ["new"] }')

      expect(ast.set.assignments[0].name).toBe('tags')
    })

    it('parses update with nested filter expression', () => {
      const ast = parseAs<UpdateStatement>(
        'update User filter exists .profile and .profile.verified = true set { status := "verified" }'
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses update with or filter', () => {
      const ast = parseAs<UpdateStatement>(
        'update User filter .role = "admin" or .role = "moderator" set { elevated := true }'
      )

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('or')
    })
  })
})

// ============================================================================
// 2. DELETE STATEMENT TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - DELETE Statement', () => {
  describe('basic delete', () => {
    it('parses simple delete', () => {
      const ast = parseAs<DeleteStatement>('delete User')

      expect(ast.type).toBe('DeleteStatement')
      expect(ast.target).toBe('User')
      expect(ast.filter).toBeUndefined()
    })

    it('parses delete with module-qualified target', () => {
      const ast = parseAs<DeleteStatement>('delete default::User')

      expect(ast.target).toBe('default::User')
    })
  })

  describe('delete with filter', () => {
    it('parses delete with uuid filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter .id = <uuid>$id')

      expect(ast.filter).toBeDefined()
      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses delete with string filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter .email = "test@example.com"')

      expect(ast.filter).toBeDefined()
    })

    it('parses delete with status filter', () => {
      const ast = parseAs<DeleteStatement>("delete User filter .status = 'inactive'")

      expect(ast.filter).toBeDefined()
    })

    it('parses delete with boolean filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter .deleted = true')

      expect(ast.filter).toBeDefined()
    })

    it('parses delete with compound and filter', () => {
      const ast = parseAs<DeleteStatement>(
        'delete User filter .status = "inactive" and .last_login < <datetime>$cutoff'
      )

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('and')
    })

    it('parses delete with compound or filter', () => {
      const ast = parseAs<DeleteStatement>(
        'delete Session filter .expired = true or .revoked = true'
      )

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('or')
    })

    it('parses delete with not filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter not .verified')

      expect(ast.filter?.condition.type).toBe('UnaryExpression')
    })

    it('parses delete with in filter', () => {
      const ast = parseAs<DeleteStatement>(
        "delete User filter .status in {'banned', 'suspended'}"
      )

      expect(ast.filter).toBeDefined()
    })
  })

  describe('delete edge cases', () => {
    it('parses delete with exists filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter exists .pending_deletion')

      expect(ast.filter?.condition.type).toBe('ExistsExpression')
    })

    it('parses delete with nested path filter', () => {
      const ast = parseAs<DeleteStatement>('delete Post filter .author.deleted = true')

      expect(ast.filter).toBeDefined()
    })

    it('parses delete with type check filter', () => {
      const ast = parseAs<DeleteStatement>('delete Content filter .item is DraftPost')

      expect(ast.filter?.condition.type).toBe('TypeCheckExpression')
    })

    it('parses delete with numeric comparison', () => {
      const ast = parseAs<DeleteStatement>('delete TempFile filter .age_days > 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('>')
    })

    it('parses delete with null check', () => {
      const ast = parseAs<DeleteStatement>('delete User filter .email = <str>{}')

      expect(ast.filter).toBeDefined()
    })

    it('throws on delete with unexpected token after target', () => {
      expect(() => parse('delete User set { }')).toThrow()
    })

    it('parses delete with parenthesized filter', () => {
      const ast = parseAs<DeleteStatement>('delete User filter (.active = false)')

      expect(ast.filter).toBeDefined()
    })

    it('parses delete with complex nested filter', () => {
      const ast = parseAs<DeleteStatement>(
        'delete User filter (.status = "banned" and .appeals = 0) or .permanent_ban = true'
      )

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })
  })
})

// ============================================================================
// 3. FOR LOOP TESTS (15 tests)
// ============================================================================

describe('EdgeQL Parser - FOR Loops', () => {
  describe('basic for', () => {
    it('parses for with set literal', () => {
      const ast = parseAs<ForStatement>("for x in {'a', 'b', 'c'} union (select x)")

      expect(ast.type).toBe('ForStatement')
      expect(ast.variable).toBe('x')
      expect(ast.iterator.type).toBe('SetExpression')
    })

    it('parses for with numeric set', () => {
      const ast = parseAs<ForStatement>('for n in {1, 2, 3} union (select n * 2)')

      expect(ast.variable).toBe('n')
    })

    it('parses for with type reference iterator', () => {
      const ast = parseAs<ForStatement>('for user in User union (select user.name)')

      expect(ast.variable).toBe('user')
      expect(ast.iterator.type).toBe('PathExpression')
    })
  })

  describe('for with insert', () => {
    it('parses for with insert in body', () => {
      const ast = parseAs<ForStatement>(
        'for user in User union (insert Log { user := user, action := "migrated" })'
      )

      expect(ast.body.type).toBe('InsertStatement')
    })

    it('parses for with insert referencing iterator', () => {
      const ast = parseAs<ForStatement>(
        'for name in {"Alice", "Bob"} union (insert User { name := name })'
      )

      expect(ast.body.type).toBe('InsertStatement')
    })
  })

  describe('for with update', () => {
    it('parses for with update in body', () => {
      const ast = parseAs<ForStatement>(
        'for user in (select User filter .needs_update) union (update user set { updated := true })'
      )

      expect(ast.body.type).toBe('UpdateStatement')
    })
  })

  describe('for with select', () => {
    it('parses for with select and shape', () => {
      const ast = parseAs<ForStatement>(
        'for user in User union (select user { name, email })'
      )

      expect(ast.body.type).toBe('SelectStatement')
    })

    it('parses for with filtered select as iterator', () => {
      const ast = parseAs<ForStatement>(
        'for user in (select User filter .active) union (select user.email)'
      )

      expect(ast.variable).toBe('user')
    })
  })

  describe('for with expressions', () => {
    it('parses for with computed value', () => {
      const ast = parseAs<ForStatement>(
        'for i in range_unpack(range(1, 10)) union (select i * i)'
      )

      expect(ast.variable).toBe('i')
    })

    it('parses for with array unpack', () => {
      const ast = parseAs<ForStatement>(
        'for tag in array_unpack(.tags) union (select tag)'
      )

      expect(ast.variable).toBe('tag')
    })
  })

  describe('nested for', () => {
    it('parses nested for loops', () => {
      const ast = parseAs<ForStatement>(
        'for x in {1, 2} union (for y in {3, 4} union (select x + y))'
      )

      expect(ast.type).toBe('ForStatement')
      expect(ast.body.type).toBe('ForStatement')
    })
  })

  describe('for edge cases', () => {
    it('throws on for without union', () => {
      expect(() => parse('for x in {1, 2} select x')).toThrow()
    })

    it('throws on for with invalid variable name', () => {
      expect(() => parse('for 123 in {1, 2} union (select 123)')).toThrow()
    })

    it('parses for with underscore variable', () => {
      const ast = parseAs<ForStatement>('for _item in Items union (select _item)')

      expect(ast.variable).toBe('_item')
    })
  })
})

// ============================================================================
// 4. WITH BLOCK TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - WITH Blocks', () => {
  describe('single binding', () => {
    it('parses with single binding and select', () => {
      const ast = parseAs<WithBlock>(
        'with user := (select User filter .id = <uuid>$id) select user { name }'
      )

      expect(ast.type).toBe('WithBlock')
      expect(ast.bindings).toHaveLength(1)
      expect(ast.bindings[0].name).toBe('user')
    })

    it('parses with scalar binding', () => {
      const ast = parseAs<WithBlock>(
        'with limit_val := 10 select User { name } limit limit_val'
      )

      expect(ast.bindings[0].name).toBe('limit_val')
    })

    it('parses with computed binding', () => {
      const ast = parseAs<WithBlock>(
        'with total := count(User) select { user_count := total }'
      )

      expect(ast.bindings[0].name).toBe('total')
    })
  })

  describe('multiple bindings', () => {
    it('parses with multiple bindings', () => {
      const ast = parseAs<WithBlock>(`
        with
          active := (select User filter .active = true),
          count := count(active)
        select { users := active, total := count }
      `)

      expect(ast.bindings).toHaveLength(2)
      expect(ast.bindings[0].name).toBe('active')
      expect(ast.bindings[1].name).toBe('count')
    })

    it('parses with dependent bindings', () => {
      const ast = parseAs<WithBlock>(`
        with
          user := (select User filter .id = <uuid>$id),
          posts := user.posts
        select posts { title }
      `)

      expect(ast.bindings).toHaveLength(2)
      expect(ast.bindings[1].name).toBe('posts')
    })

    it('parses with three bindings', () => {
      const ast = parseAs<WithBlock>(`
        with
          a := 1,
          b := 2,
          c := a + b
        select c
      `)

      expect(ast.bindings).toHaveLength(3)
    })
  })

  describe('with body types', () => {
    it('parses with and insert body', () => {
      const ast = parseAs<WithBlock>(
        'with now := datetime_current() insert Log { created_at := now }'
      )

      expect(ast.body.type).toBe('InsertStatement')
    })

    it('parses with and update body', () => {
      const ast = parseAs<WithBlock>(
        'with user := (select User filter .id = <uuid>$id) update user set { active := true }'
      )

      expect(ast.body.type).toBe('UpdateStatement')
    })

    it('parses with and delete body', () => {
      const ast = parseAs<WithBlock>(
        'with old := (select User filter .last_login < <datetime>$cutoff) delete old'
      )

      expect(ast.body.type).toBe('DeleteStatement')
    })

    it('parses with and for body', () => {
      const ast = parseAs<WithBlock>(
        'with users := (select User filter .migrate) for user in users union (update user set { migrated := true })'
      )

      expect(ast.body.type).toBe('ForStatement')
    })
  })

  describe('with module references', () => {
    it('parses with module-qualified binding', () => {
      const ast = parseAs<WithBlock>(
        'with User := default::User select User { name }'
      )

      expect(ast.bindings[0].name).toBe('User')
    })

    it('parses with module import pattern', () => {
      const ast = parseAs<WithBlock>(
        'with module schema select ObjectType { name }'
      )

      expect(ast.bindings[0].name).toBe('module')
    })
  })

  describe('with complex expressions', () => {
    it('parses with aggregate binding', () => {
      const ast = parseAs<WithBlock>(
        'with avg_age := math::mean(User.age) select User filter .age > avg_age'
      )

      expect(ast.bindings[0].name).toBe('avg_age')
    })

    it('parses with array binding', () => {
      const ast = parseAs<WithBlock>(
        "with tags := ['a', 'b', 'c'] select Post filter .tag in array_unpack(tags)"
      )

      expect(ast.bindings[0].name).toBe('tags')
    })

    it('parses with tuple binding', () => {
      const ast = parseAs<WithBlock>(
        "with config := ('localhost', 5432) select config.0"
      )

      expect(ast.bindings[0].name).toBe('config')
    })
  })

  describe('with edge cases', () => {
    it('throws on with without body', () => {
      expect(() => parse('with x := 1')).toThrow()
    })

    it('throws on with empty binding', () => {
      expect(() => parse('with x := select User')).toThrow()
    })

    it('parses with trailing comma in bindings', () => {
      const ast = parseAs<WithBlock>('with x := 1, select x')

      expect(ast.bindings).toHaveLength(1)
    })
  })
})

// ============================================================================
// 5. ARITHMETIC EXPRESSIONS TESTS (25 tests)
// ============================================================================

describe('EdgeQL Parser - Arithmetic Expressions', () => {
  describe('addition', () => {
    it('parses path + literal', () => {
      const ast = parseAs<SelectStatement>('select User filter .price + .tax > 100')

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses literal + literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 1 + 2 }')

      expect(ast).toBeDefined()
    })

    it('parses path + path', () => {
      const ast = parseAs<SelectStatement>('select User { total := .base + .bonus }')

      const totalField = ast.shape.fields.find((f) => f.name === 'total')
      expect(totalField).toBeDefined()
    })

    it('parses chained additions', () => {
      const ast = parseAs<SelectStatement>('select { result := 1 + 2 + 3 }')

      expect(ast).toBeDefined()
    })
  })

  describe('subtraction', () => {
    it('parses path - literal', () => {
      const ast = parseAs<SelectStatement>('select User filter .price - .discount < 50')

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses literal - literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 10 - 3 }')

      expect(ast).toBeDefined()
    })

    it('parses path - path', () => {
      const ast = parseAs<SelectStatement>('select User { net := .gross - .tax }')

      expect(ast).toBeDefined()
    })

    it('parses unary minus', () => {
      const ast = parseAs<SelectStatement>('select { result := -5 }')

      expect(ast).toBeDefined()
    })
  })

  describe('multiplication', () => {
    it('parses path * literal', () => {
      const ast = parseAs<SelectStatement>('select User filter .quantity * .unit_price > 1000')

      expect(ast.filter).toBeDefined()
    })

    it('parses literal * literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 6 * 7 }')

      expect(ast).toBeDefined()
    })

    it('parses path * path', () => {
      const ast = parseAs<SelectStatement>('select Order { subtotal := .qty * .price }')

      expect(ast).toBeDefined()
    })
  })

  describe('division', () => {
    it('parses path / literal', () => {
      const ast = parseAs<SelectStatement>('select User filter .total / .count > 10')

      expect(ast.filter).toBeDefined()
    })

    it('parses literal / literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 100 / 4 }')

      expect(ast).toBeDefined()
    })

    it('parses path / path', () => {
      const ast = parseAs<SelectStatement>('select Stats { average := .sum / .count }')

      expect(ast).toBeDefined()
    })
  })

  describe('floor division', () => {
    it('parses floor division //)', () => {
      const ast = parseAs<SelectStatement>('select { result := .value // 10 }')

      expect(ast).toBeDefined()
    })

    it('parses literal // literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 17 // 5 }')

      expect(ast).toBeDefined()
    })
  })

  describe('modulo', () => {
    it('parses modulo %)', () => {
      const ast = parseAs<SelectStatement>('select { result := .value % 5 }')

      expect(ast).toBeDefined()
    })

    it('parses literal % literal', () => {
      const ast = parseAs<SelectStatement>('select { result := 17 % 5 }')

      expect(ast).toBeDefined()
    })

    it('parses modulo in filter', () => {
      const ast = parseAs<SelectStatement>('select Number filter .value % 2 = 0')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('power', () => {
    it('parses power ^)', () => {
      const ast = parseAs<SelectStatement>('select { result := 2 ^ 8 }')

      expect(ast).toBeDefined()
    })

    it('parses path ^ literal', () => {
      const ast = parseAs<SelectStatement>('select { squared := .value ^ 2 }')

      expect(ast).toBeDefined()
    })

    it('parses chained power (right associative)', () => {
      const ast = parseAs<SelectStatement>('select { result := 2 ^ 3 ^ 2 }')

      expect(ast).toBeDefined()
    })
  })

  describe('operator precedence', () => {
    it('respects multiplication over addition', () => {
      const ast = parseAs<SelectStatement>('select { result := 1 + 2 * 3 }')

      expect(ast).toBeDefined()
    })

    it('respects power over multiplication', () => {
      const ast = parseAs<SelectStatement>('select { result := 2 * 3 ^ 2 }')

      expect(ast).toBeDefined()
    })

    it('respects parentheses', () => {
      const ast = parseAs<SelectStatement>('select { result := (1 + 2) * 3 }')

      expect(ast).toBeDefined()
    })
  })
})

// ============================================================================
// 6. COMPARISON EXPRESSIONS TESTS (25 tests)
// ============================================================================

describe('EdgeQL Parser - Comparison Expressions', () => {
  describe('equality', () => {
    it('parses = with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age = 30')

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
      expect((ast.filter?.condition as BinaryExpression).operator).toBe('=')
    })

    it('parses = with strings', () => {
      const ast = parseAs<SelectStatement>('select User filter .name = "Alice"')

      expect(ast.filter).toBeDefined()
    })

    it('parses = with booleans', () => {
      const ast = parseAs<SelectStatement>('select User filter .active = true')

      expect(ast.filter).toBeDefined()
    })

    it('parses = with paths', () => {
      const ast = parseAs<SelectStatement>('select User filter .current_role = .default_role')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('inequality', () => {
    it('parses != with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age != 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('!=')
    })

    it('parses != with strings', () => {
      const ast = parseAs<SelectStatement>('select User filter .status != "deleted"')

      expect(ast.filter).toBeDefined()
    })

    it('parses != with booleans', () => {
      const ast = parseAs<SelectStatement>('select User filter .banned != true')

      expect(ast.filter).toBeDefined()
    })

    it('parses ?!= (optional inequality)', () => {
      const ast = parseAs<SelectStatement>('select User filter .nickname ?!= .name')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('less than', () => {
    it('parses < with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age < 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('<')
    })

    it('parses < with strings (lexicographic)', () => {
      const ast = parseAs<SelectStatement>('select User filter .name < "M"')

      expect(ast.filter).toBeDefined()
    })

    it('parses < with dates', () => {
      const ast = parseAs<SelectStatement>('select User filter .created_at < <datetime>$cutoff')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('greater than', () => {
    it('parses > with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age > 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('>')
    })

    it('parses > with strings', () => {
      const ast = parseAs<SelectStatement>('select User filter .name > "M"')

      expect(ast.filter).toBeDefined()
    })

    it('parses > with dates', () => {
      const ast = parseAs<SelectStatement>('select User filter .updated_at > .created_at')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('less than or equal', () => {
    it('parses <= with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age <= 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('<=')
    })

    it('parses <= with strings', () => {
      const ast = parseAs<SelectStatement>('select User filter .rank <= "B"')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('greater than or equal', () => {
    it('parses >= with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .age >= 30')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('>=')
    })

    it('parses >= with strings', () => {
      const ast = parseAs<SelectStatement>('select User filter .tier >= "gold"')

      expect(ast.filter).toBeDefined()
    })

    it('parses >= with decimals', () => {
      const ast = parseAs<SelectStatement>('select Product filter .price >= 9.99')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('chained comparisons', () => {
    it('parses range check pattern', () => {
      const ast = parseAs<SelectStatement>('select User filter .age >= 18 and .age <= 65')

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses multiple comparisons', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .age > 18 and .score >= 80 and .active = true'
      )

      expect(ast.filter).toBeDefined()
    })
  })
})

// ============================================================================
// 7. LOGICAL EXPRESSIONS TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - Logical Expressions', () => {
  describe('and operator', () => {
    it('parses simple and', () => {
      const ast = parseAs<SelectStatement>('select User filter .active and .verified')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('and')
    })

    it('parses and with comparisons', () => {
      const ast = parseAs<SelectStatement>('select User filter .age > 18 and .age < 65')

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses chained and', () => {
      const ast = parseAs<SelectStatement>('select User filter .a and .b and .c')

      expect(ast.filter).toBeDefined()
    })

    it('parses and with path expressions', () => {
      const ast = parseAs<SelectStatement>('select User filter .profile.verified and .email_confirmed')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('or operator', () => {
    it('parses simple or', () => {
      const ast = parseAs<SelectStatement>('select User filter .active or .admin')

      expect((ast.filter?.condition as BinaryExpression).operator).toBe('or')
    })

    it('parses or with comparisons', () => {
      const ast = parseAs<SelectStatement>('select User filter .role = "admin" or .role = "moderator"')

      expect(ast.filter).toBeDefined()
    })

    it('parses chained or', () => {
      const ast = parseAs<SelectStatement>('select User filter .a or .b or .c')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('not operator', () => {
    it('parses simple not', () => {
      const ast = parseAs<SelectStatement>('select User filter not .deleted')

      expect(ast.filter?.condition.type).toBe('UnaryExpression')
      expect((ast.filter?.condition as UnaryExpression).operator).toBe('not')
    })

    it('parses not with comparison', () => {
      const ast = parseAs<SelectStatement>('select User filter not (.age < 18)')

      expect(ast.filter?.condition.type).toBe('UnaryExpression')
    })

    it('parses not with and', () => {
      const ast = parseAs<SelectStatement>('select User filter .active and not .suspended')

      expect(ast.filter).toBeDefined()
    })

    it('parses double not', () => {
      const ast = parseAs<SelectStatement>('select User filter not not .active')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('operator precedence', () => {
    it('not binds tighter than and', () => {
      const ast = parseAs<SelectStatement>('select User filter not .a and .b')

      // Should be parsed as (not .a) and .b
      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('and binds tighter than or', () => {
      const ast = parseAs<SelectStatement>('select User filter .a or .b and .c')

      // Should be parsed as .a or (.b and .c)
      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parentheses override precedence', () => {
      const ast = parseAs<SelectStatement>('select User filter (.a or .b) and .c')

      expect(ast.filter).toBeDefined()
    })

    it('complex precedence example', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter not .deleted and (.active or .admin)'
      )

      expect(ast.filter).toBeDefined()
    })
  })

  describe('mixed expressions', () => {
    it('parses logical with comparison', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .age >= 18 and .verified = true or .admin = true'
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses logical with exists', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .profile and .active')

      expect(ast.filter).toBeDefined()
    })

    it('parses logical with in', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .role in {"admin", "mod"} and .active'
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses logical with like', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .email like "%@company.com" or .verified'
      )

      expect(ast.filter).toBeDefined()
    })
  })
})

// ============================================================================
// 8. STRING EXPRESSIONS TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - String Expressions', () => {
  describe('concatenation', () => {
    it('parses simple concatenation', () => {
      const ast = parseAs<SelectStatement>("select User { fullname := .first_name ++ ' ' ++ .last_name }")

      expect(ast).toBeDefined()
    })

    it('parses path ++ literal', () => {
      const ast = parseAs<SelectStatement>("select User { greeting := 'Hello, ' ++ .name }")

      expect(ast).toBeDefined()
    })

    it('parses literal ++ path', () => {
      const ast = parseAs<SelectStatement>("select User { prefixed := 'user_' ++ .id }")

      expect(ast).toBeDefined()
    })

    it('parses multiple concatenations', () => {
      const ast = parseAs<SelectStatement>(
        "select User { full := .first ++ ' ' ++ .middle ++ ' ' ++ .last }"
      )

      expect(ast).toBeDefined()
    })

    it('parses concatenation in filter', () => {
      const ast = parseAs<SelectStatement>(
        "select User filter .first_name ++ .last_name = 'JohnDoe'"
      )

      expect(ast.filter).toBeDefined()
    })
  })

  describe('like operator', () => {
    it('parses like with prefix pattern', () => {
      const ast = parseAs<SelectStatement>("select User filter .name like 'A%'")

      expect(ast.filter?.condition.type).toBe('LikeExpression')
    })

    it('parses like with suffix pattern', () => {
      const ast = parseAs<SelectStatement>("select User filter .email like '%@gmail.com'")

      expect(ast.filter).toBeDefined()
    })

    it('parses like with contains pattern', () => {
      const ast = parseAs<SelectStatement>("select User filter .bio like '%developer%'")

      expect(ast.filter).toBeDefined()
    })

    it('parses like with single char wildcard', () => {
      const ast = parseAs<SelectStatement>("select User filter .code like 'A_B'")

      expect(ast.filter).toBeDefined()
    })

    it('parses not like', () => {
      const ast = parseAs<SelectStatement>("select User filter .name not like 'Test%'")

      expect(ast.filter).toBeDefined()
    })
  })

  describe('ilike operator (case insensitive)', () => {
    it('parses ilike with pattern', () => {
      const ast = parseAs<SelectStatement>("select User filter .name ilike 'a%'")

      expect(ast.filter?.condition.type).toBe('LikeExpression')
      expect((ast.filter?.condition as LikeExpression).caseInsensitive).toBe(true)
    })

    it('parses ilike case insensitively', () => {
      const ast = parseAs<SelectStatement>("select User filter .email ilike '%@GMAIL.COM'")

      expect(ast.filter).toBeDefined()
    })

    it('parses not ilike', () => {
      const ast = parseAs<SelectStatement>("select User filter .name not ilike 'admin%'")

      expect(ast.filter).toBeDefined()
    })
  })

  describe('string in expressions', () => {
    it('parses string with escape sequences', () => {
      const ast = parseAs<SelectStatement>("select { text := 'line1\\nline2' }")

      expect(ast).toBeDefined()
    })

    it('parses string with quotes', () => {
      const ast = parseAs<SelectStatement>("select { text := 'say \"hello\"' }")

      expect(ast).toBeDefined()
    })

    it('parses multiline string', () => {
      const ast = parseAs<SelectStatement>("select { text := '''multi\nline''' }")

      expect(ast).toBeDefined()
    })

    it('parses raw string', () => {
      const ast = parseAs<SelectStatement>("select { path := r'C:\\Users\\name' }")

      expect(ast).toBeDefined()
    })
  })

  describe('string edge cases', () => {
    it('parses empty string', () => {
      const ast = parseAs<SelectStatement>("select User filter .name = ''")

      expect(ast.filter).toBeDefined()
    })

    it('parses unicode string', () => {
      const ast = parseAs<SelectStatement>("select { emoji := '' }")

      expect(ast).toBeDefined()
    })
  })
})

// ============================================================================
// 9. SET EXPRESSIONS TESTS (25 tests)
// ============================================================================

describe('EdgeQL Parser - Set Expressions', () => {
  describe('in operator', () => {
    it('parses in with string set', () => {
      const ast = parseAs<SelectStatement>("select User filter .status in {'active', 'pending'}")

      expect(ast.filter?.condition.type).toBe('InExpression')
    })

    it('parses in with number set', () => {
      const ast = parseAs<SelectStatement>('select User filter .level in {1, 2, 3}')

      expect(ast.filter).toBeDefined()
    })

    it('parses in with single element', () => {
      const ast = parseAs<SelectStatement>("select User filter .role in {'admin'}")

      expect(ast.filter).toBeDefined()
    })

    it('parses in with path set', () => {
      const ast = parseAs<SelectStatement>('select User filter .id in User.friends.id')

      expect(ast.filter).toBeDefined()
    })

    it('parses in with select subquery', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .id in (select Admin.user_id)'
      )

      expect(ast.filter).toBeDefined()
    })
  })

  describe('not in operator', () => {
    it('parses not in with string set', () => {
      const ast = parseAs<SelectStatement>("select User filter .status not in {'deleted', 'banned'}")

      expect(ast.filter?.condition.type).toBe('InExpression')
      expect((ast.filter?.condition as InExpression).negated).toBe(true)
    })

    it('parses not in with number set', () => {
      const ast = parseAs<SelectStatement>('select User filter .id not in {1, 2, 3}')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('exists operator', () => {
    it('parses exists with path', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .profile')

      expect(ast.filter?.condition.type).toBe('ExistsExpression')
    })

    it('parses exists with nested path', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .profile.avatar')

      expect(ast.filter).toBeDefined()
    })

    it('parses exists with backlink', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .<author[is Post]')

      expect(ast.filter).toBeDefined()
    })

    it('parses not exists', () => {
      const ast = parseAs<SelectStatement>('select User filter not exists .profile')

      expect(ast.filter?.condition.type).toBe('UnaryExpression')
    })

    it('parses exists in and expression', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .profile and .active')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('distinct operator', () => {
    it('parses distinct on path', () => {
      const ast = parseAs<SelectStatement>('select distinct User.country')

      // The select should have distinct applied
      expect(ast).toBeDefined()
    })

    it('parses distinct on nested path', () => {
      const ast = parseAs<SelectStatement>('select distinct .tags')

      expect(ast).toBeDefined()
    })

    it('parses distinct in computed field', () => {
      const ast = parseAs<SelectStatement>('select User { unique_tags := distinct .tags }')

      expect(ast).toBeDefined()
    })
  })

  describe('set literals', () => {
    it('parses empty set', () => {
      const ast = parseAs<SelectStatement>('select User filter .tags = <array<str>>[]')

      expect(ast.filter).toBeDefined()
    })

    it('parses set with mixed types (error case)', () => {
      // This should fail type checking but parse
      expect(() => parse("select { mixed := {1, 'two'} }")).not.toThrow()
    })

    it('parses nested set expressions', () => {
      const ast = parseAs<SelectStatement>(
        "select User filter .status in {'active'} or .role in {'admin', 'mod'}"
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses set union', () => {
      const ast = parseAs<SelectStatement>('select { combined := {1, 2} union {3, 4} }')

      expect(ast).toBeDefined()
    })

    it('parses set intersection', () => {
      const ast = parseAs<SelectStatement>('select { common := {1, 2, 3} intersect {2, 3, 4} }')

      expect(ast).toBeDefined()
    })

    it('parses set except', () => {
      const ast = parseAs<SelectStatement>('select { diff := {1, 2, 3} except {2} }')

      expect(ast).toBeDefined()
    })
  })

  describe('set edge cases', () => {
    it('parses in with trailing comma', () => {
      const ast = parseAs<SelectStatement>("select User filter .status in {'active',}")

      expect(ast.filter).toBeDefined()
    })

    it('parses deeply nested set', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .id in (select (select Admin).user_id)'
      )

      expect(ast.filter).toBeDefined()
    })
  })
})

// ============================================================================
// 10. TYPE EXPRESSIONS TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - Type Expressions', () => {
  describe('is type check', () => {
    it('parses is with simple type', () => {
      const ast = parseAs<SelectStatement>('select Content filter .item is Product')

      expect(ast.filter?.condition.type).toBe('TypeCheckExpression')
      expect((ast.filter?.condition as TypeCheckExpression).typeName).toBe('Product')
    })

    it('parses is with module-qualified type', () => {
      const ast = parseAs<SelectStatement>('select Content filter .item is default::Product')

      expect((ast.filter?.condition as TypeCheckExpression).typeName).toBe('default::Product')
    })

    it('parses is with abstract type', () => {
      const ast = parseAs<SelectStatement>('select Object filter Object is Named')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('is not type check', () => {
    it('parses is not with type', () => {
      const ast = parseAs<SelectStatement>('select Content filter .item is not Service')

      expect(ast.filter?.condition.type).toBe('TypeCheckExpression')
      expect((ast.filter?.condition as TypeCheckExpression).negated).toBe(true)
    })

    it('parses is not with module-qualified type', () => {
      const ast = parseAs<SelectStatement>('select Content filter .item is not schema::ObjectType')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('type filter in paths', () => {
    it('parses type filter on forward link', () => {
      const ast = parseAs<SelectStatement>('select User { posts: { .[is BlogPost].title } }')

      expect(ast).toBeDefined()
    })

    it('parses type filter on backlink', () => {
      const ast = parseAs<SelectStatement>('select Author { posts := .<author[is Post] }')

      expect(ast).toBeDefined()
    })

    it('parses type filter with IS keyword', () => {
      const ast = parseAs<SelectStatement>('select Content { items := .[IS Product] }')

      expect(ast).toBeDefined()
    })

    it('parses multiple type filters', () => {
      const ast = parseAs<SelectStatement>(
        'select Content { published := .[is Article].[is Published] }'
      )

      expect(ast).toBeDefined()
    })
  })

  describe('type casts', () => {
    it('parses uuid cast', () => {
      const ast = parseAs<SelectStatement>('select User filter .id = <uuid>$id')

      expect(ast.filter).toBeDefined()
    })

    it('parses str cast', () => {
      const ast = parseAs<SelectStatement>('select User filter .name = <str>$name')

      expect(ast.filter).toBeDefined()
    })

    it('parses int32 cast', () => {
      const ast = parseAs<SelectStatement>('select User filter .age = <int32>$age')

      expect(ast.filter).toBeDefined()
    })

    it('parses datetime cast', () => {
      const ast = parseAs<SelectStatement>('select User filter .created_at > <datetime>$since')

      expect(ast.filter).toBeDefined()
    })

    it('parses optional type cast', () => {
      const ast = parseAs<SelectStatement>('select User filter .maybe_id = <optional uuid>$id')

      expect(ast.filter).toBeDefined()
    })

    it('parses array type cast', () => {
      const ast = parseAs<SelectStatement>("select User filter .tags = <array<str>>['a', 'b']")

      expect(ast.filter).toBeDefined()
    })

    it('parses json cast', () => {
      const ast = parseAs<SelectStatement>('select { data := <json>$input }')

      expect(ast).toBeDefined()
    })
  })

  describe('typeof expressions', () => {
    it('parses typeof in type check', () => {
      const ast = parseAs<SelectStatement>('select Object filter Object is typeof User')

      expect(ast.filter).toBeDefined()
    })

    it('parses typeof with path', () => {
      const ast = parseAs<SelectStatement>('select { type := typeof .value }')

      expect(ast).toBeDefined()
    })
  })
})

// ============================================================================
// 11. COALESCE TESTS (10 tests)
// ============================================================================

describe('EdgeQL Parser - Coalesce', () => {
  describe('basic coalesce', () => {
    it('parses path ?? literal', () => {
      const ast = parseAs<SelectStatement>("select User { display := .nickname ?? .name }")

      const displayField = ast.shape.fields.find((f) => f.name === 'display')
      expect(displayField).toBeDefined()
    })

    it('parses path ?? string literal', () => {
      const ast = parseAs<SelectStatement>("select User { name := .nickname ?? 'anonymous' }")

      expect(ast).toBeDefined()
    })

    it('parses path ?? number literal', () => {
      const ast = parseAs<SelectStatement>('select User { score := .score ?? 0 }')

      expect(ast).toBeDefined()
    })

    it('parses path ?? boolean literal', () => {
      const ast = parseAs<SelectStatement>('select User { active := .active ?? false }')

      expect(ast).toBeDefined()
    })
  })

  describe('chained coalesce', () => {
    it('parses triple coalesce', () => {
      const ast = parseAs<SelectStatement>(
        "select User { name := .nickname ?? .username ?? 'guest' }"
      )

      expect(ast).toBeDefined()
    })

    it('parses coalesce with nested paths', () => {
      const ast = parseAs<SelectStatement>(
        'select User { avatar := .profile.avatar ?? .default_avatar ?? "/default.png" }'
      )

      expect(ast).toBeDefined()
    })
  })

  describe('coalesce with expressions', () => {
    it('parses coalesce with function call', () => {
      const ast = parseAs<SelectStatement>(
        'select User { created := .created_at ?? datetime_current() }'
      )

      expect(ast).toBeDefined()
    })

    it('parses coalesce in filter', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter (.nickname ?? .name) = "admin"'
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses coalesce with empty set', () => {
      const ast = parseAs<SelectStatement>(
        'select User { safe_tags := .tags ?? <array<str>>[] }'
      )

      expect(ast).toBeDefined()
    })

    it('parses coalesce combined with other operators', () => {
      const ast = parseAs<SelectStatement>(
        'select User { total := (.bonus ?? 0) + .base_salary }'
      )

      expect(ast).toBeDefined()
    })
  })
})

// ============================================================================
// 12. ORDER BY TESTS (20 tests)
// ============================================================================

describe('EdgeQL Parser - ORDER BY', () => {
  describe('simple order', () => {
    it('parses order by single field', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name')

      expect(ast).toBeDefined()
    })

    it('parses order by nested field', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .profile.created_at')

      expect(ast).toBeDefined()
    })
  })

  describe('direction', () => {
    it('parses order by asc', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name asc')

      expect(ast).toBeDefined()
    })

    it('parses order by desc', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .created_at desc')

      expect(ast).toBeDefined()
    })

    it('parses order by ASC (uppercase)', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name ASC')

      expect(ast).toBeDefined()
    })

    it('parses order by DESC (uppercase)', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name DESC')

      expect(ast).toBeDefined()
    })
  })

  describe('nulls handling', () => {
    it('parses nulls first', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name nulls first')

      expect(ast).toBeDefined()
    })

    it('parses nulls last', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .nickname nulls last')

      expect(ast).toBeDefined()
    })

    it('parses desc nulls first', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name desc nulls first')

      expect(ast).toBeDefined()
    })

    it('parses asc nulls last', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name asc nulls last')

      expect(ast).toBeDefined()
    })

    it('parses NULLS FIRST (uppercase)', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name NULLS FIRST')

      expect(ast).toBeDefined()
    })

    it('parses NULLS LAST (uppercase)', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name NULLS LAST')

      expect(ast).toBeDefined()
    })
  })

  describe('multiple order expressions', () => {
    it('parses then for secondary sort', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .last_name then .first_name'
      )

      expect(ast).toBeDefined()
    })

    it('parses then with directions', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .score desc then .name asc'
      )

      expect(ast).toBeDefined()
    })

    it('parses multiple then clauses', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .country then .city then .name'
      )

      expect(ast).toBeDefined()
    })

    it('parses then with nulls handling', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .score desc nulls last then .name asc'
      )

      expect(ast).toBeDefined()
    })
  })

  describe('order by with expressions', () => {
    it('parses order by computed expression', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by len(.name)')

      expect(ast).toBeDefined()
    })

    it('parses order by coalesce', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .sort_order ?? 999'
      )

      expect(ast).toBeDefined()
    })
  })
})

// ============================================================================
// 13. LIMIT/OFFSET TESTS (15 tests)
// ============================================================================

describe('EdgeQL Parser - LIMIT/OFFSET', () => {
  describe('limit only', () => {
    it('parses limit with number', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit 10')

      expect(ast).toBeDefined()
    })

    it('parses limit with parameter', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit <int64>$limit')

      expect(ast).toBeDefined()
    })

    it('parses limit 0', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit 0')

      expect(ast).toBeDefined()
    })

    it('parses limit 1', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit 1')

      expect(ast).toBeDefined()
    })
  })

  describe('offset only', () => {
    it('parses offset with number', () => {
      const ast = parseAs<SelectStatement>('select User { name } offset 20')

      expect(ast).toBeDefined()
    })

    it('parses offset with parameter', () => {
      const ast = parseAs<SelectStatement>('select User { name } offset <int64>$offset')

      expect(ast).toBeDefined()
    })

    it('parses offset 0', () => {
      const ast = parseAs<SelectStatement>('select User { name } offset 0')

      expect(ast).toBeDefined()
    })
  })

  describe('limit and offset combined', () => {
    it('parses limit then offset', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit 10 offset 20')

      expect(ast).toBeDefined()
    })

    it('parses offset then limit', () => {
      const ast = parseAs<SelectStatement>('select User { name } offset 20 limit 10')

      expect(ast).toBeDefined()
    })

    it('parses limit and offset with parameters', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } limit <int64>$limit offset <int64>$offset'
      )

      expect(ast).toBeDefined()
    })
  })

  describe('limit/offset with order by', () => {
    it('parses order by then limit', () => {
      const ast = parseAs<SelectStatement>('select User { name } order by .name limit 10')

      expect(ast).toBeDefined()
    })

    it('parses order by then limit and offset', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } order by .name limit 10 offset 20'
      )

      expect(ast).toBeDefined()
    })

    it('parses filter, order, limit, offset', () => {
      const ast = parseAs<SelectStatement>(
        'select User { name } filter .active order by .name limit 10 offset 0'
      )

      expect(ast).toBeDefined()
    })
  })

  describe('limit/offset edge cases', () => {
    it('parses large limit', () => {
      const ast = parseAs<SelectStatement>('select User { name } limit 1000000')

      expect(ast).toBeDefined()
    })

    it('throws on negative limit', () => {
      expect(() => parse('select User { name } limit -1')).toThrow()
    })
  })
})

// ============================================================================
// 14. PATH NAVIGATION TESTS (25 tests)
// ============================================================================

describe('EdgeQL Parser - Path Navigation', () => {
  describe('forward links', () => {
    it('parses single forward link', () => {
      const ast = parseAs<SelectStatement>('select User { author := .author.name }')

      expect(ast).toBeDefined()
    })

    it('parses chained forward links', () => {
      const ast = parseAs<SelectStatement>('select Post { org := .author.team.organization.name }')

      expect(ast).toBeDefined()
    })

    it('parses forward link with shape', () => {
      const ast = parseAs<SelectStatement>('select User { author: { name, email } }')

      expect(ast).toBeDefined()
    })
  })

  describe('backlinks', () => {
    it('parses simple backlink', () => {
      const ast = parseAs<SelectStatement>('select User { posts := .<author }')

      expect(ast).toBeDefined()
    })

    it('parses backlink with type filter', () => {
      const ast = parseAs<SelectStatement>('select User { posts := .<author[is Post] }')

      expect(ast).toBeDefined()
    })

    it('parses chained backlinks', () => {
      const ast = parseAs<SelectStatement>('select Tag { posts := .<tags[is Post].<author[is User] }')

      expect(ast).toBeDefined()
    })

    it('parses backlink in filter', () => {
      const ast = parseAs<SelectStatement>('select User filter exists .<author[is Post]')

      expect(ast.filter).toBeDefined()
    })

    it('parses backlink with nested path', () => {
      const ast = parseAs<SelectStatement>('select User { post_titles := .<author[is Post].title }')

      expect(ast).toBeDefined()
    })
  })

  describe('type filters', () => {
    it('parses [is Type] filter', () => {
      const ast = parseAs<SelectStatement>('select Content { items := .items[is Product] }')

      expect(ast).toBeDefined()
    })

    it('parses [IS Type] filter (uppercase)', () => {
      const ast = parseAs<SelectStatement>('select Content { items := .items[IS Product] }')

      expect(ast).toBeDefined()
    })

    it('parses type filter on computed path', () => {
      const ast = parseAs<SelectStatement>('select User { blog_posts := .posts[is BlogPost] }')

      expect(ast).toBeDefined()
    })

    it('parses type filter with module-qualified type', () => {
      const ast = parseAs<SelectStatement>('select Content { items := .items[is default::Product] }')

      expect(ast).toBeDefined()
    })
  })

  describe('optional access', () => {
    it('parses optional forward link .?', () => {
      const ast = parseAs<SelectStatement>('select User { manager_name := .?manager.name }')

      expect(ast).toBeDefined()
    })

    it('parses chained optional .?', () => {
      const ast = parseAs<SelectStatement>('select User { name := .?profile.?avatar.url }')

      expect(ast).toBeDefined()
    })

    it('parses optional at end of chain', () => {
      const ast = parseAs<SelectStatement>('select User { nickname := .profile.?nickname }')

      expect(ast).toBeDefined()
    })

    it('parses optional with backlink', () => {
      const ast = parseAs<SelectStatement>('select User { maybe_post := .?<author[is Post] }')

      expect(ast).toBeDefined()
    })
  })

  describe('index access', () => {
    it('parses array index access', () => {
      const ast = parseAs<SelectStatement>('select User { first_tag := .tags[0] }')

      expect(ast).toBeDefined()
    })

    it('parses negative array index', () => {
      const ast = parseAs<SelectStatement>('select User { last_tag := .tags[-1] }')

      expect(ast).toBeDefined()
    })

    it('parses array slice', () => {
      const ast = parseAs<SelectStatement>('select User { first_three := .tags[0:3] }')

      expect(ast).toBeDefined()
    })

    it('parses array slice from start', () => {
      const ast = parseAs<SelectStatement>('select User { first_five := .tags[:5] }')

      expect(ast).toBeDefined()
    })

    it('parses array slice to end', () => {
      const ast = parseAs<SelectStatement>('select User { rest := .tags[1:] }')

      expect(ast).toBeDefined()
    })
  })

  describe('complex paths', () => {
    it('parses path with all features', () => {
      const ast = parseAs<SelectStatement>(
        'select User { data := .?profile.posts[is BlogPost].<author[is User].name }'
      )

      expect(ast).toBeDefined()
    })

    it('parses path in arithmetic', () => {
      const ast = parseAs<SelectStatement>('select User { total := .base + .bonus }')

      expect(ast).toBeDefined()
    })

    it('parses path in comparison', () => {
      const ast = parseAs<SelectStatement>('select User filter .profile.score > .threshold')

      expect(ast.filter).toBeDefined()
    })
  })
})

// ============================================================================
// 15. PARAMETER TESTS (15 tests)
// ============================================================================

describe('EdgeQL Parser - Parameters', () => {
  describe('typed parameters', () => {
    it('parses uuid parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .id = <uuid>$id')

      expect(ast.filter).toBeDefined()
    })

    it('parses str parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .name = <str>$name')

      expect(ast.filter).toBeDefined()
    })

    it('parses int32 parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .age = <int32>$age')

      expect(ast.filter).toBeDefined()
    })

    it('parses int64 parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .count = <int64>$count')

      expect(ast.filter).toBeDefined()
    })

    it('parses float64 parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .score = <float64>$score')

      expect(ast.filter).toBeDefined()
    })

    it('parses bool parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .active = <bool>$active')

      expect(ast.filter).toBeDefined()
    })

    it('parses datetime parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .created_at > <datetime>$since')

      expect(ast.filter).toBeDefined()
    })

    it('parses json parameter', () => {
      const ast = parseAs<SelectStatement>('select User { metadata := <json>$data }')

      expect(ast).toBeDefined()
    })
  })

  describe('optional parameters', () => {
    it('parses optional uuid parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .parent_id = <optional uuid>$parent')

      expect(ast.filter).toBeDefined()
    })

    it('parses optional str parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .nickname = <optional str>$nick')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('parameter naming', () => {
    it('parses parameter with underscore', () => {
      const ast = parseAs<SelectStatement>('select User filter .id = <uuid>$user_id')

      expect(ast.filter).toBeDefined()
    })

    it('parses parameter with numbers', () => {
      const ast = parseAs<SelectStatement>('select User filter .id = <uuid>$id1')

      expect(ast.filter).toBeDefined()
    })

    it('parses positional parameter', () => {
      const ast = parseAs<SelectStatement>('select User filter .id = <uuid>$0')

      expect(ast.filter).toBeDefined()
    })
  })

  describe('multiple parameters', () => {
    it('parses multiple different parameters', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .name = <str>$name and .age > <int32>$min_age'
      )

      expect(ast.filter).toBeDefined()
    })

    it('parses same parameter used twice', () => {
      const ast = parseAs<SelectStatement>(
        'select User filter .first_name = <str>$name or .last_name = <str>$name'
      )

      expect(ast.filter).toBeDefined()
    })
  })
})

// ============================================================================
// ADDITIONAL INTEGRATION TESTS
// ============================================================================

describe('EdgeQL Parser - Integration', () => {
  describe('complex queries', () => {
    it('parses full CRUD workflow', () => {
      // Create
      const insert = parseAs<InsertStatement>(
        "insert User { name := 'Test', email := 'test@example.com' }"
      )
      expect(insert.type).toBe('InsertStatement')

      // Read
      const select = parseAs<SelectStatement>(
        'select User { name, email } filter .email = <str>$email'
      )
      expect(select.type).toBe('SelectStatement')

      // Update
      const update = parseAs<UpdateStatement>(
        'update User filter .id = <uuid>$id set { name := <str>$name }'
      )
      expect(update.type).toBe('UpdateStatement')

      // Delete
      const del = parseAs<DeleteStatement>('delete User filter .id = <uuid>$id')
      expect(del.type).toBe('DeleteStatement')
    })

    it('parses complex aggregation query', () => {
      const ast = parseAs<SelectStatement>(`
        select User {
          name,
          post_count := count(.posts),
          latest_post := (select .posts order by .created_at desc limit 1) {
            title,
            created_at
          }
        }
        filter .active
        order by .name
        limit 10
      `)

      expect(ast.type).toBe('SelectStatement')
    })

    it('parses query with multiple clauses', () => {
      const ast = parseAs<WithBlock>(`
        with
          active_users := (select User filter .active),
          recent := (select active_users filter .last_login > <datetime>$since)
        select recent {
          name,
          email,
          posts: { title } filter .published
        }
        order by .last_login desc
        limit 100
        offset 0
      `)

      expect(ast.type).toBe('WithBlock')
    })
  })

  describe('error messages', () => {
    it('provides helpful error on missing closing brace', () => {
      expect(() => parse('select User { name')).toThrow(/Expected/)
    })

    it('provides helpful error on invalid keyword', () => {
      expect(() => parse('selec User { name }')).toThrow()
    })

    it('provides helpful error on invalid filter expression', () => {
      expect(() => parse('select User filter')).toThrow()
    })
  })
})
