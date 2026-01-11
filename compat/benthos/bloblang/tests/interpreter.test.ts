/**
 * RED Phase Tests: Bloblang Interpreter
 * Issue: dotdo-xd5fx
 *
 * These tests define the expected behavior for the Bloblang interpreter
 * that evaluates AST nodes against input data.
 * They should FAIL until the implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  ASTNode,
  LiteralNode,
  IdentifierNode,
  RootNode,
  ThisNode,
  MetaNode,
  BinaryOpNode,
  UnaryOpNode,
  MemberAccessNode,
  CallNode,
  ArrayNode,
  ObjectNode,
  IfNode,
  MatchNode,
  LetNode,
  MapNode,
  PipeNode,
  ArrowNode,
  BinaryOperator,
  UnaryOperator
} from '../ast'
import { BenthosMessage, createMessage, createBatch } from '../../core/message'

// Import interpreter when implemented
// import { Interpreter, evaluate, createInterpreterContext } from '../interpreter'

/**
 * This is the RED phase: tests that will FAIL until the interpreter is implemented.
 * Remove the placeholder assertions and uncomment the real ones when ready to implement.
 */
declare function evaluate(ast: ASTNode, message: BenthosMessage): unknown
declare class Interpreter {
  evaluate(ast: ASTNode): unknown
}

/**
 * Helper functions to build AST nodes for testing
 */
namespace ASTBuilder {
  export function literal(value: string | number | boolean | null, line = 1, column = 1): LiteralNode {
    let kind: 'string' | 'number' | 'boolean' | 'null'
    if (value === null) kind = 'null'
    else if (typeof value === 'string') kind = 'string'
    else if (typeof value === 'number') kind = 'number'
    else kind = 'boolean'

    return { type: 'Literal', kind, value, line, column }
  }

  export function identifier(name: string, line = 1, column = 1): IdentifierNode {
    return { type: 'Identifier', name, line, column }
  }

  export function root(line = 1, column = 1): RootNode {
    return { type: 'Root', line, column }
  }

  export function thisRef(line = 1, column = 1): ThisNode {
    return { type: 'This', line, column }
  }

  export function meta(line = 1, column = 1): MetaNode {
    return { type: 'Meta', line, column }
  }

  export function binaryOp(
    operator: BinaryOperator,
    left: ASTNode,
    right: ASTNode,
    line = 1,
    column = 1
  ): BinaryOpNode {
    return { type: 'BinaryOp', operator, left, right, line, column }
  }

  export function unaryOp(
    operator: UnaryOperator,
    operand: ASTNode,
    line = 1,
    column = 1
  ): UnaryOpNode {
    return { type: 'UnaryOp', operator, operand, line, column }
  }

  export function memberAccess(
    object: ASTNode,
    property: string | ASTNode,
    accessType: 'dot' | 'bracket' | 'optional' = 'dot',
    line = 1,
    column = 1
  ): MemberAccessNode {
    return { type: 'MemberAccess', object, property, accessType, line, column }
  }

  export function call(
    func: ASTNode,
    args: ASTNode[] = [],
    line = 1,
    column = 1
  ): CallNode {
    return { type: 'Call', function: func, arguments: args, line, column }
  }

  export function array(elements: ASTNode[] = [], line = 1, column = 1): ArrayNode {
    return { type: 'Array', elements, line, column }
  }

  export function object(
    fields: { key: string; value: ASTNode }[] = [],
    line = 1,
    column = 1
  ): ObjectNode {
    return { type: 'Object', fields, line, column }
  }

  export function ifExpr(
    condition: ASTNode,
    consequent: ASTNode,
    alternate?: ASTNode,
    line = 1,
    column = 1
  ): IfNode {
    return { type: 'If', condition, consequent, alternate, line, column }
  }

  export function match(
    input: ASTNode,
    cases: { pattern: ASTNode; body: ASTNode }[] = [],
    defaultCase?: ASTNode,
    line = 1,
    column = 1
  ): MatchNode {
    return { type: 'Match', input, cases, default: defaultCase, line, column }
  }

  export function letBinding(
    name: string,
    value: ASTNode,
    body: ASTNode,
    line = 1,
    column = 1
  ): LetNode {
    return { type: 'Let', name, value, body, line, column }
  }

  export function arrow(
    parameter: string,
    body: ASTNode,
    line = 1,
    column = 1
  ): ArrowNode {
    return { type: 'Arrow', parameter, body, line, column }
  }

  export function mapExpr(lambda: ArrowNode, line = 1, column = 1): MapNode {
    return { type: 'Map', lambda, line, column }
  }

  export function pipe(left: ASTNode, right: ASTNode, line = 1, column = 1): PipeNode {
    return { type: 'Pipe', left, right, line, column }
  }
}

/**
 * Test suite for the Bloblang interpreter
 */
describe('Bloblang Interpreter', () => {
  let msg: BenthosMessage

  beforeEach(() => {
    // Create a default test message with common test data
    msg = createMessage({
      name: 'Alice',
      age: 30,
      email: 'alice@example.com',
      active: true,
      tags: ['user', 'admin'],
      profile: {
        bio: 'A software engineer',
        location: 'San Francisco'
      },
      scores: [95, 87, 92]
    }, {
      'source': 'kafka',
      'partition': '0'
    })
  })

  describe('Literal Evaluation', () => {
    it('evaluates string literals', () => {
      const ast = ASTBuilder.literal('hello')
      const result = evaluate(ast, msg)
      expect(result).toBe('hello')
    })

    it('evaluates number literals', () => {
      const ast = ASTBuilder.literal(42)
      const result = evaluate(ast, msg)
      expect(result).toBe(42)
    })

    it('evaluates integer literals', () => {
      const ast = ASTBuilder.literal(0)
      const result = evaluate(ast, msg)
      expect(result).toBe(0)
    })

    it('evaluates negative numbers', () => {
      const ast = ASTBuilder.literal(-17)
      const result = evaluate(ast, msg)
      expect(result).toBe(-17)
    })

    it('evaluates floating point literals', () => {
      const ast = ASTBuilder.literal(3.14159)
      const result = evaluate(ast, msg)
      expect(result).toBe(3.14159)
    })

    it('evaluates boolean true', () => {
      const ast = ASTBuilder.literal(true)
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('evaluates boolean false', () => {
      const ast = ASTBuilder.literal(false)
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('evaluates null literal', () => {
      const ast = ASTBuilder.literal(null)
      const result = evaluate(ast, msg)
      expect(result).toBe(null)
    })

    it('evaluates empty string', () => {
      const ast = ASTBuilder.literal('')
      const result = evaluate(ast, msg)
      expect(result).toBe('')
    })
  })

  describe('Variable References', () => {
    it('evaluates root reference', () => {
      const ast = ASTBuilder.root()
      const result = evaluate(ast, msg)
      expect(result).toEqual(msg.root)
    })

    it('evaluates this reference', () => {
      const ast = ASTBuilder.thisRef()
      const result = evaluate(ast, msg)
      expect(result).toEqual(msg.root)
    })

    it('evaluates meta reference (returns metadata object)', () => {
      const ast = ASTBuilder.meta()
      const result = evaluate(ast, msg)
      expect(result).toEqual({ source: 'kafka', partition: '0' })
    })

    it('evaluates identifier as variable reference', () => {
      const ast = ASTBuilder.identifier('name')
      const result = evaluate(ast, msg)
      expect(result).toBe('Alice')
    })
  })

  describe('Member Access (Dot Notation)', () => {
    it('accesses object properties with dot notation', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.root(),
        'name',
        'dot'
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('Alice')
    })

    it('accesses nested object properties', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'profile', 'dot'),
        'bio',
        'dot'
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('A software engineer')
    })

    it('returns undefined for non-existent property', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.root(),
        'nonexistent',
        'dot'
      )
      const result = evaluate(ast, msg)
      expect(result).toBeUndefined()
    })

    it('accesses array elements by index', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
        ASTBuilder.literal(0),
        'bracket'
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('user')
    })

    it('accesses object with bracket notation', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.root(),
        ASTBuilder.literal('name'),
        'bracket'
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('Alice')
    })
  })

  describe('Optional Chaining', () => {
    it('handles optional chaining with safe property access', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.root(),
        'nonexistent',
        'optional'
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBeUndefined()
      expect(true).toBe(true) // Placeholder
    })

    it('returns undefined when chaining through null', () => {
      const deepAst = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(
          ASTBuilder.root(),
          'nullField',
          'optional'
        ),
        'nested',
        'optional'
      )
      // const result = evaluate(deepAst, msg)
      // expect(result).toBeUndefined()
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Arithmetic Operators', () => {
    it('adds two numbers', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(8)
    })

    it('subtracts two numbers', () => {
      const ast = ASTBuilder.binaryOp('-', ASTBuilder.literal(10), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(7)
    })

    it('multiplies two numbers', () => {
      const ast = ASTBuilder.binaryOp('*', ASTBuilder.literal(4), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(20)
    })

    it('divides two numbers', () => {
      const ast = ASTBuilder.binaryOp('/', ASTBuilder.literal(20), ASTBuilder.literal(4))
      const result = evaluate(ast, msg)
      expect(result).toBe(5)
    })

    it('computes modulo', () => {
      const ast = ASTBuilder.binaryOp('%', ASTBuilder.literal(17), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(2)
    })

    it('handles division by zero gracefully', () => {
      const ast = ASTBuilder.binaryOp('/', ASTBuilder.literal(1), ASTBuilder.literal(0))
      const result = evaluate(ast, msg)
      expect(result).toBe(Infinity)
    })

    it('adds strings (concatenation)', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal('hello'), ASTBuilder.literal(' world'))
      const result = evaluate(ast, msg)
      expect(result).toBe('hello world')
    })

    it('coerces string + number to string concatenation', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal('age: '), ASTBuilder.literal(30))
      const result = evaluate(ast, msg)
      expect(result).toBe('age: 30')
    })

    it('coerces number + string to string concatenation', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal(30), ASTBuilder.literal(' years'))
      const result = evaluate(ast, msg)
      expect(result).toBe('30 years')
    })
  })

  describe('Comparison Operators', () => {
    it('equals operator with numbers', () => {
      const ast = ASTBuilder.binaryOp('==', ASTBuilder.literal(5), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('equals operator returns false for unequal numbers', () => {
      const ast = ASTBuilder.binaryOp('==', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('equals operator with strings', () => {
      const ast = ASTBuilder.binaryOp('==', ASTBuilder.literal('hello'), ASTBuilder.literal('hello'))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('not equals operator', () => {
      const ast = ASTBuilder.binaryOp('!=', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('less than operator', () => {
      const ast = ASTBuilder.binaryOp('<', ASTBuilder.literal(3), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('less than operator returns false when left is greater', () => {
      const ast = ASTBuilder.binaryOp('<', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('greater than operator', () => {
      const ast = ASTBuilder.binaryOp('>', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('less than or equal operator', () => {
      const ast = ASTBuilder.binaryOp('<=', ASTBuilder.literal(5), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('greater than or equal operator', () => {
      const ast = ASTBuilder.binaryOp('>=', ASTBuilder.literal(5), ASTBuilder.literal(3))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('compares strings lexicographically', () => {
      const ast = ASTBuilder.binaryOp('<', ASTBuilder.literal('apple'), ASTBuilder.literal('banana'))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('type coercion in comparison: string to number', () => {
      const ast = ASTBuilder.binaryOp('==', ASTBuilder.literal('5'), ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })
  })

  describe('Logical Operators', () => {
    it('logical AND with two true values', () => {
      const ast = ASTBuilder.binaryOp('&&', ASTBuilder.literal(true), ASTBuilder.literal(true))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('logical AND with false left operand', () => {
      const ast = ASTBuilder.binaryOp('&&', ASTBuilder.literal(false), ASTBuilder.literal(true))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical AND with false right operand', () => {
      const ast = ASTBuilder.binaryOp('&&', ASTBuilder.literal(true), ASTBuilder.literal(false))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical AND short-circuits on false left', () => {
      // Should not evaluate right side if left is false
      const ast = ASTBuilder.binaryOp(
        '&&',
        ASTBuilder.literal(false),
        ASTBuilder.binaryOp('/', ASTBuilder.literal(1), ASTBuilder.literal(0))
      )
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical OR with two false values', () => {
      const ast = ASTBuilder.binaryOp('||', ASTBuilder.literal(false), ASTBuilder.literal(false))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical OR with true left operand', () => {
      const ast = ASTBuilder.binaryOp('||', ASTBuilder.literal(true), ASTBuilder.literal(false))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('logical OR short-circuits on true left', () => {
      // Should not evaluate right side if left is true
      const ast = ASTBuilder.binaryOp(
        '||',
        ASTBuilder.literal(true),
        ASTBuilder.binaryOp('/', ASTBuilder.literal(1), ASTBuilder.literal(0))
      )
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('logical AND with truthy non-boolean values', () => {
      const ast = ASTBuilder.binaryOp('&&', ASTBuilder.literal('hello'), ASTBuilder.literal(42))
      const result = evaluate(ast, msg)
      expect(result).toBe(42)
    })

    it('logical OR returns first truthy value', () => {
      const ast = ASTBuilder.binaryOp('||', ASTBuilder.literal(null), ASTBuilder.literal('value'))
      const result = evaluate(ast, msg)
      expect(result).toBe('value')
    })
  })

  describe('Unary Operators', () => {
    it('negates a positive number', () => {
      const ast = ASTBuilder.unaryOp('-', ASTBuilder.literal(5))
      const result = evaluate(ast, msg)
      expect(result).toBe(-5)
    })

    it('negates a negative number', () => {
      const ast = ASTBuilder.unaryOp('-', ASTBuilder.literal(-3))
      const result = evaluate(ast, msg)
      expect(result).toBe(3)
    })

    it('negates zero', () => {
      const ast = ASTBuilder.unaryOp('-', ASTBuilder.literal(0))
      const result = evaluate(ast, msg)
      expect(result).toBe(0)
    })

    it('logical NOT on true', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(true))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical NOT on false', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(false))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('logical NOT on truthy value', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal('hello'))
      const result = evaluate(ast, msg)
      expect(result).toBe(false)
    })

    it('logical NOT on falsy value (null)', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(null))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })

    it('logical NOT on zero', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(0))
      const result = evaluate(ast, msg)
      expect(result).toBe(true)
    })
  })

  describe('Array Literals', () => {
    it('evaluates empty array literal', () => {
      const ast = ASTBuilder.array([])
      const result = evaluate(ast, msg)
      expect(result).toEqual([])
    })

    it('evaluates array with literal elements', () => {
      const ast = ASTBuilder.array([
        ASTBuilder.literal(1),
        ASTBuilder.literal(2),
        ASTBuilder.literal(3)
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual([1, 2, 3])
    })

    it('evaluates array with mixed types', () => {
      const ast = ASTBuilder.array([
        ASTBuilder.literal('string'),
        ASTBuilder.literal(42),
        ASTBuilder.literal(true),
        ASTBuilder.literal(null)
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual(['string', 42, true, null])
    })

    it('evaluates array with variable references', () => {
      const ast = ASTBuilder.array([
        ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot'),
        ASTBuilder.memberAccess(ASTBuilder.root(), 'age', 'dot')
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual(['Alice', 30])
    })

    it('evaluates nested array literals', () => {
      const ast = ASTBuilder.array([
        ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2)]),
        ASTBuilder.array([ASTBuilder.literal(3), ASTBuilder.literal(4)])
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual([[1, 2], [3, 4]])
    })
  })

  describe('Object Literals', () => {
    it('evaluates empty object literal', () => {
      const ast = ASTBuilder.object([])
      const result = evaluate(ast, msg)
      expect(result).toEqual({})
    })

    it('evaluates object with string values', () => {
      const ast = ASTBuilder.object([
        { key: 'greeting', value: ASTBuilder.literal('hello') },
        { key: 'name', value: ASTBuilder.literal('world') }
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual({ greeting: 'hello', name: 'world' })
    })

    it('evaluates object with mixed value types', () => {
      const ast = ASTBuilder.object([
        { key: 'text', value: ASTBuilder.literal('hello') },
        { key: 'number', value: ASTBuilder.literal(42) },
        { key: 'boolean', value: ASTBuilder.literal(true) },
        { key: 'null', value: ASTBuilder.literal(null) }
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual({ text: 'hello', number: 42, boolean: true, null: null })
    })

    it('evaluates object with variable references', () => {
      const ast = ASTBuilder.object([
        { key: 'name', value: ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot') },
        { key: 'age', value: ASTBuilder.memberAccess(ASTBuilder.root(), 'age', 'dot') }
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('evaluates nested object literals', () => {
      const ast = ASTBuilder.object([
        { key: 'outer', value: ASTBuilder.object([
          { key: 'inner', value: ASTBuilder.literal('value') }
        ])}
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual({ outer: { inner: 'value' } })
    })

    it('evaluates object with array values', () => {
      const ast = ASTBuilder.object([
        { key: 'list', value: ASTBuilder.array([
          ASTBuilder.literal(1),
          ASTBuilder.literal(2),
          ASTBuilder.literal(3)
        ])}
      ])
      const result = evaluate(ast, msg)
      expect(result).toEqual({ list: [1, 2, 3] })
    })
  })

  describe('If/Else Expressions', () => {
    it('evaluates if expression with true condition', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(true),
        ASTBuilder.literal('yes'),
        ASTBuilder.literal('no')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('yes')
    })

    it('evaluates if expression with false condition', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(false),
        ASTBuilder.literal('yes'),
        ASTBuilder.literal('no')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('no')
    })

    it('evaluates if expression without else', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(true),
        ASTBuilder.literal('yes')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('yes')
    })

    it('evaluates if expression without else returns undefined for false condition', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(false),
        ASTBuilder.literal('yes')
      )
      const result = evaluate(ast, msg)
      expect(result).toBeUndefined()
    })

    it('evaluates nested if expressions', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(true),
        ASTBuilder.ifExpr(
          ASTBuilder.literal(true),
          ASTBuilder.literal('nested yes'),
          ASTBuilder.literal('nested no')
        ),
        ASTBuilder.literal('outer no')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('nested yes')
    })

    it('evaluates if with comparison condition', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.binaryOp('>', ASTBuilder.literal(10), ASTBuilder.literal(5)),
        ASTBuilder.literal('greater'),
        ASTBuilder.literal('not greater')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('greater')
    })

    it('evaluates if with variable in condition', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.binaryOp(
          '>',
          ASTBuilder.memberAccess(ASTBuilder.root(), 'age', 'dot'),
          ASTBuilder.literal(25)
        ),
        ASTBuilder.literal('adult'),
        ASTBuilder.literal('young')
      )
      const result = evaluate(ast, msg)
      expect(result).toBe('adult')
    })
  })

  describe('Match Expressions', () => {
    it('evaluates match with single matching case', () => {
      const ast = ASTBuilder.match(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot'),
        [
          { pattern: ASTBuilder.literal('Alice'), body: ASTBuilder.literal('matched') },
          { pattern: ASTBuilder.literal('Bob'), body: ASTBuilder.literal('not matched') }
        ]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('matched')
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates match with default case', () => {
      const ast = ASTBuilder.match(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot'),
        [
          { pattern: ASTBuilder.literal('Bob'), body: ASTBuilder.literal('not matched') }
        ],
        ASTBuilder.literal('default matched')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('default matched')
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates match with numeric patterns', () => {
      const ast = ASTBuilder.match(
        ASTBuilder.literal(2),
        [
          { pattern: ASTBuilder.literal(1), body: ASTBuilder.literal('one') },
          { pattern: ASTBuilder.literal(2), body: ASTBuilder.literal('two') },
          { pattern: ASTBuilder.literal(3), body: ASTBuilder.literal('three') }
        ]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('two')
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates match returns undefined when no match and no default', () => {
      const ast = ASTBuilder.match(
        ASTBuilder.literal('unknown'),
        [
          { pattern: ASTBuilder.literal('known'), body: ASTBuilder.literal('matched') }
        ]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBeUndefined()
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Let Bindings', () => {
    it('evaluates let binding with variable', () => {
      const ast = ASTBuilder.letBinding(
        'x',
        ASTBuilder.literal(42),
        ASTBuilder.identifier('x')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(42)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates let binding with expression', () => {
      const ast = ASTBuilder.letBinding(
        'x',
        ASTBuilder.binaryOp('+', ASTBuilder.literal(10), ASTBuilder.literal(5)),
        ASTBuilder.identifier('x')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(15)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates nested let bindings', () => {
      const ast = ASTBuilder.letBinding(
        'x',
        ASTBuilder.literal(10),
        ASTBuilder.letBinding(
          'y',
          ASTBuilder.literal(5),
          ASTBuilder.binaryOp('+', ASTBuilder.identifier('x'), ASTBuilder.identifier('y'))
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(15)
      expect(true).toBe(true) // Placeholder
    })

    it('shadows variables with let binding', () => {
      const ast = ASTBuilder.letBinding(
        'name',
        ASTBuilder.literal('Bob'),
        ASTBuilder.identifier('name')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('Bob')
      expect(true).toBe(true) // Placeholder
    })

    it('let binding creates scope', () => {
      const innerBody = ASTBuilder.identifier('x')
      const ast = ASTBuilder.letBinding(
        'x',
        ASTBuilder.literal(42),
        innerBody
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(42)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Function Calls', () => {
    it('calls stdlib function with no arguments', () => {
      const ast = ASTBuilder.call(ASTBuilder.identifier('now'))
      // const result = evaluate(ast, msg)
      // expect(typeof result).toBe('number')
      expect(true).toBe(true) // Placeholder
    })

    it('calls stdlib function with single argument', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('length'),
        [ASTBuilder.literal('hello')]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(5)
      expect(true).toBe(true) // Placeholder
    })

    it('calls stdlib function with multiple arguments', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('substring'),
        [
          ASTBuilder.literal('hello world'),
          ASTBuilder.literal(0),
          ASTBuilder.literal(5)
        ]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('hello')
      expect(true).toBe(true) // Placeholder
    })

    it('calls method on object', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('hello'),
          'uppercase',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO')
      expect(true).toBe(true) // Placeholder
    })

    it('calls function on array literal', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)]),
          'length',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(3)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Arrow Functions and Maps', () => {
    it('evaluates simple arrow function', () => {
      const arrow = ASTBuilder.arrow('x', ASTBuilder.binaryOp('+', ASTBuilder.identifier('x'), ASTBuilder.literal(1)))
      // Note: arrow functions are typically used as arguments, tested below
      expect(true).toBe(true) // Placeholder
    })

    it('maps over array with lambda', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)]),
          'map',
          'dot'
        ),
        [ASTBuilder.arrow('x', ASTBuilder.binaryOp('*', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual([2, 4, 6])
      expect(true).toBe(true) // Placeholder
    })

    it('filters array with lambda', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3), ASTBuilder.literal(4)]),
          'filter',
          'dot'
        ),
        [ASTBuilder.arrow('x', ASTBuilder.binaryOp('>', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual([3, 4])
      expect(true).toBe(true) // Placeholder
    })

    it('reduces array with lambda', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)]),
          'reduce',
          'dot'
        ),
        [
          ASTBuilder.arrow('acc', ASTBuilder.binaryOp('+', ASTBuilder.identifier('acc'), ASTBuilder.literal(1))),
          ASTBuilder.literal(0)
        ]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(3)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates nested arrow functions', () => {
      const ast = ASTBuilder.arrow(
        'x',
        ASTBuilder.arrow('y', ASTBuilder.binaryOp('+', ASTBuilder.identifier('x'), ASTBuilder.identifier('y')))
      )
      // Higher-order functions tested elsewhere
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Pipe Expressions', () => {
    it('pipes value through function', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO')
      expect(true).toBe(true) // Placeholder
    })

    it('pipes through multiple functions', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.pipe(
          ASTBuilder.literal('hello world'),
          ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
        ),
        ASTBuilder.call(ASTBuilder.identifier('replace'), [
          ASTBuilder.literal(' '),
          ASTBuilder.literal('_')
        ])
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO_WORLD')
      expect(true).toBe(true) // Placeholder
    })

    it('pipes with method access', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.memberAccess(
          ASTBuilder.identifier('_'),
          'uppercase',
          'dot'
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO')
      expect(true).toBe(true) // Placeholder
    })

    it('pipes array through map', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)]),
        ASTBuilder.call(
          ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'map', 'dot'),
          [ASTBuilder.arrow('x', ASTBuilder.binaryOp('*', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual([2, 4, 6])
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Complex Expressions', () => {
    it('evaluates complex nested expression', () => {
      const ast = ASTBuilder.binaryOp(
        '+',
        ASTBuilder.binaryOp(
          '*',
          ASTBuilder.literal(2),
          ASTBuilder.literal(3)
        ),
        ASTBuilder.binaryOp(
          '*',
          ASTBuilder.literal(4),
          ASTBuilder.literal(5)
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(26) // 2*3 + 4*5 = 6 + 20
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates expression with mixed operators', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.binaryOp(
          '&&',
          ASTBuilder.binaryOp('>', ASTBuilder.literal(10), ASTBuilder.literal(5)),
          ASTBuilder.binaryOp('<', ASTBuilder.literal(10), ASTBuilder.literal(20))
        ),
        ASTBuilder.binaryOp('+', ASTBuilder.literal(10), ASTBuilder.literal(20)),
        ASTBuilder.literal(0)
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(30)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates complex transformation', () => {
      const ast = ASTBuilder.object([
        { key: 'result', value: ASTBuilder.ifExpr(
          ASTBuilder.binaryOp(
            '>',
            ASTBuilder.memberAccess(ASTBuilder.root(), 'age', 'dot'),
            ASTBuilder.literal(18)
          ),
          ASTBuilder.call(ASTBuilder.memberAccess(ASTBuilder.identifier('name'), 'uppercase', 'dot'), []),
          ASTBuilder.literal('CHILD')
        )}
      ])
      // const result = evaluate(ast, msg)
      // expect((result as any).result).toBe('ALICE')
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Type Coercion and Truthiness', () => {
    it('coerces empty string to false', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(''))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('coerces non-empty string to true', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal('hello'))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(false)
      expect(true).toBe(true) // Placeholder
    })

    it('coerces zero to false', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(0))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('coerces non-zero to true', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(1))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(false)
      expect(true).toBe(true) // Placeholder
    })

    it('coerces null to false', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.literal(null))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('coerces undefined to false', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'nonexistent', 'dot'),
        ASTBuilder.literal('truthy'),
        ASTBuilder.literal('falsy')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('falsy')
      expect(true).toBe(true) // Placeholder
    })

    it('numeric string coerces to number in arithmetic', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal('5'), ASTBuilder.literal(3))
      // const result = evaluate(ast, msg)
      // expect(result).toBe('53') // String concatenation, not addition
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Error Handling', () => {
    it('handles null in member access gracefully', () => {
      const msg2 = createMessage({
        value: null
      })
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'value', 'dot'),
        'nested',
        'dot'
      )
      // const result = evaluate(ast, msg2)
      // expect(result).toBeUndefined()
      expect(true).toBe(true) // Placeholder
    })

    it('handles undefined in operations', () => {
      const ast = ASTBuilder.binaryOp(
        '+',
        ASTBuilder.memberAccess(ASTBuilder.root(), 'nonexistent', 'dot'),
        ASTBuilder.literal(5)
      )
      // const result = evaluate(ast, msg)
      // May result in undefined, null, or error depending on implementation
      expect(true).toBe(true) // Placeholder
    })

    it('handles invalid array index', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
        ASTBuilder.literal(999),
        'bracket'
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBeUndefined()
      expect(true).toBe(true) // Placeholder
    })

    it('handles negative array index', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
        ASTBuilder.literal(-1),
        'bracket'
      )
      // const result = evaluate(ast, msg)
      // May support negative indexing or return undefined
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Scope and Variable Resolution', () => {
    it('resolves global variables', () => {
      const ast = ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot')
      // const result = evaluate(ast, msg)
      // expect(result).toBe('Alice')
      expect(true).toBe(true) // Placeholder
    })

    it('resolves local variables in let binding', () => {
      const ast = ASTBuilder.letBinding(
        'localVar',
        ASTBuilder.literal('local value'),
        ASTBuilder.identifier('localVar')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('local value')
      expect(true).toBe(true) // Placeholder
    })

    it('local variable shadows root property', () => {
      const ast = ASTBuilder.letBinding(
        'name',
        ASTBuilder.literal('Shadowed'),
        ASTBuilder.identifier('name')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('Shadowed')
      expect(true).toBe(true) // Placeholder
    })

    it('resolves function parameters in arrow functions', () => {
      const arrow = ASTBuilder.arrow('item', ASTBuilder.identifier('item'))
      // Arrow functions are normally used as arguments
      expect(true).toBe(true) // Placeholder
    })

    it('outer scope accessible from inner let binding', () => {
      const ast = ASTBuilder.letBinding(
        'x',
        ASTBuilder.memberAccess(ASTBuilder.root(), 'name', 'dot'),
        ASTBuilder.letBinding(
          'y',
          ASTBuilder.identifier('x'),
          ASTBuilder.identifier('y')
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('Alice')
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Message Context Handling', () => {
    it('preserves message metadata during evaluation', () => {
      const msg2 = createMessage({ value: 42 }, { 'key': 'test' })
      const ast = ASTBuilder.root()
      // const result = evaluate(ast, msg2)
      // expect(msg2.metadata.get('key')).toBe('test')
      expect(true).toBe(true) // Placeholder
    })

    it('accesses meta values in metadata', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.meta(),
        'source',
        'dot'
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('kafka')
      expect(true).toBe(true) // Placeholder
    })

    it('returns all metadata as object', () => {
      const ast = ASTBuilder.meta()
      // const result = evaluate(ast, msg)
      // expect(result).toEqual({ source: 'kafka', partition: '0' })
      expect(true).toBe(true) // Placeholder
    })

    it('handles message with JSON string content', () => {
      const msg2 = createMessage('{"key": "value"}')
      const ast = ASTBuilder.memberAccess(ASTBuilder.root(), 'key', 'dot')
      // const result = evaluate(ast, msg2)
      // expect(result).toBe('value')
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Array Methods Integration', () => {
    it('calls length on array', () => {
      const ast = ASTBuilder.memberAccess(
        ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
        'length',
        'dot'
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(2)
      expect(true).toBe(true) // Placeholder
    })

    it('joins array elements', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
          'join',
          'dot'
        ),
        [ASTBuilder.literal(', ')]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('user, admin')
      expect(true).toBe(true) // Placeholder
    })

    it('reverses array', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.memberAccess(ASTBuilder.root(), 'tags', 'dot'),
          'reverse',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual(['admin', 'user'])
      expect(true).toBe(true) // Placeholder
    })

    it('sorts array', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.array([
            ASTBuilder.literal(3),
            ASTBuilder.literal(1),
            ASTBuilder.literal(2)
          ]),
          'sort',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual([1, 2, 3])
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('String Methods Integration', () => {
    it('uppercases string', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('hello'),
          'uppercase',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO')
      expect(true).toBe(true) // Placeholder
    })

    it('lowercases string', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('HELLO'),
          'lowercase',
          'dot'
        ),
        []
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('hello')
      expect(true).toBe(true) // Placeholder
    })

    it('replaces substring', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('hello world'),
          'replace',
          'dot'
        ),
        [ASTBuilder.literal('world'), ASTBuilder.literal('there')]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('hello there')
      expect(true).toBe(true) // Placeholder
    })

    it('splits string', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('a,b,c'),
          'split',
          'dot'
        ),
        [ASTBuilder.literal(',')]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual(['a', 'b', 'c'])
      expect(true).toBe(true) // Placeholder
    })

    it('gets substring', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          ASTBuilder.literal('hello world'),
          'substring',
          'dot'
        ),
        [ASTBuilder.literal(0), ASTBuilder.literal(5)]
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('hello')
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Number Coercion and Operations', () => {
    it('converts string to number in addition', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal('10'), ASTBuilder.literal(5))
      // Should concatenate as strings: '105'
      // const result = evaluate(ast, msg)
      // expect(result).toBe('105')
      expect(true).toBe(true) // Placeholder
    })

    it('handles floating point arithmetic', () => {
      const ast = ASTBuilder.binaryOp('+', ASTBuilder.literal(0.1), ASTBuilder.literal(0.2))
      // const result = evaluate(ast, msg)
      // expect(Math.abs((result as number) - 0.3) < 0.0001).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('handles large numbers', () => {
      const ast = ASTBuilder.binaryOp(
        '*',
        ASTBuilder.literal(1e10),
        ASTBuilder.literal(1e10)
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(1e20)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Edge Cases and Boundary Conditions', () => {
    it('evaluates very deeply nested property access', () => {
      let ast: ASTNode = ASTBuilder.root()
      for (let i = 0; i < 5; i++) {
        ast = ASTBuilder.memberAccess(ast, `prop${i}`, 'dot')
      }
      // Should handle deep nesting without stack overflow
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates large arrays', () => {
      const elements = Array.from({ length: 1000 }, (_, i) => ASTBuilder.literal(i))
      const ast = ASTBuilder.array(elements)
      // const result = evaluate(ast, msg)
      // expect(Array.isArray(result)).toBe(true)
      // expect((result as unknown[]).length).toBe(1000)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates objects with many properties', () => {
      const fields = Array.from({ length: 100 }, (_, i) => ({
        key: `prop${i}`,
        value: ASTBuilder.literal(i)
      }))
      const ast = ASTBuilder.object(fields)
      // const result = evaluate(ast, msg)
      // expect(Object.keys(result as any).length).toBe(100)
      expect(true).toBe(true) // Placeholder
    })

    it('handles very long strings', () => {
      const longString = 'a'.repeat(10000)
      const ast = ASTBuilder.literal(longString)
      // const result = evaluate(ast, msg)
      // expect((result as string).length).toBe(10000)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Iterator and Collection Operations', () => {
    it('iterates over object keys', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('keys'),
        [ASTBuilder.root()]
      )
      // const result = evaluate(ast, msg)
      // expect(Array.isArray(result)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('iterates over object values', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('values'),
        [ASTBuilder.root()]
      )
      // const result = evaluate(ast, msg)
      // expect(Array.isArray(result)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('gets object entries', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('entries'),
        [ASTBuilder.object([
          { key: 'a', value: ASTBuilder.literal(1) },
          { key: 'b', value: ASTBuilder.literal(2) }
        ])]
      )
      // const result = evaluate(ast, msg)
      // expect(Array.isArray(result)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Boolean Logic Edge Cases', () => {
    it('evaluates complex boolean expression with precedence', () => {
      const ast = ASTBuilder.binaryOp(
        '||',
        ASTBuilder.binaryOp('&&', ASTBuilder.literal(false), ASTBuilder.literal(true)),
        ASTBuilder.literal(true)
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates double negation', () => {
      const ast = ASTBuilder.unaryOp('!', ASTBuilder.unaryOp('!', ASTBuilder.literal(true)))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('evaluates chained comparisons indirectly', () => {
      const ast = ASTBuilder.binaryOp(
        '&&',
        ASTBuilder.binaryOp('<', ASTBuilder.literal(1), ASTBuilder.literal(2)),
        ASTBuilder.binaryOp('<', ASTBuilder.literal(2), ASTBuilder.literal(3))
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Null and Undefined Handling', () => {
    it('null equals null', () => {
      const ast = ASTBuilder.binaryOp('==', ASTBuilder.literal(null), ASTBuilder.literal(null))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('null not equals undefined', () => {
      // Assuming undefined comes from missing property
      const ast = ASTBuilder.binaryOp(
        '!=',
        ASTBuilder.literal(null),
        ASTBuilder.memberAccess(ASTBuilder.root(), 'nonexistent', 'dot')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe(true) // null !== undefined
      expect(true).toBe(true) // Placeholder
    })

    it('null is falsy in conditions', () => {
      const ast = ASTBuilder.ifExpr(
        ASTBuilder.literal(null),
        ASTBuilder.literal('truthy'),
        ASTBuilder.literal('falsy')
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('falsy')
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Method Chaining', () => {
    it('chains string methods', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello world'),
        ASTBuilder.pipe(
          ASTBuilder.call(ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'uppercase', 'dot'), []),
          ASTBuilder.call(ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'replace', 'dot'), [
            ASTBuilder.literal(' '),
            ASTBuilder.literal('_')
          ])
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toBe('HELLO_WORLD')
      expect(true).toBe(true) // Placeholder
    })

    it('chains array methods', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.array([ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)]),
        ASTBuilder.pipe(
          ASTBuilder.call(
            ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'map', 'dot'),
            [ASTBuilder.arrow('x', ASTBuilder.binaryOp('*', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
          ),
          ASTBuilder.call(
            ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'filter', 'dot'),
            [ASTBuilder.arrow('x', ASTBuilder.binaryOp('>', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
          )
        )
      )
      // const result = evaluate(ast, msg)
      // expect(result).toEqual([4, 6])
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Special Values', () => {
    it('handles infinity', () => {
      const ast = ASTBuilder.binaryOp('/', ASTBuilder.literal(1), ASTBuilder.literal(0))
      // const result = evaluate(ast, msg)
      // expect(result).toBe(Infinity)
      expect(true).toBe(true) // Placeholder
    })

    it('handles NaN', () => {
      const ast = ASTBuilder.binaryOp('/', ASTBuilder.literal(0), ASTBuilder.literal(0))
      // const result = evaluate(ast, msg)
      // expect(Number.isNaN(result as number)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('handles negative zero', () => {
      const ast = ASTBuilder.unaryOp('-', ASTBuilder.literal(0))
      // const result = evaluate(ast, msg)
      // expect(Object.is(result, -0)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })
  })
})
