/**
 * RED Phase Tests: BloblangValue Type System Safety
 * Issue: dotdo-1jo2z
 *
 * These tests define expected type safety behavior for the Bloblang interpreter.
 * They should FAIL until proper type validation is implemented.
 *
 * Problem: The interpreter uses pervasive `any` types and unsafe casts like
 * `(left as number) + (right as number)` without validating input types first.
 *
 * Expected behavior: Operations should validate types and throw descriptive
 * TypeError messages including the actual type received.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  ASTNode,
  LiteralNode,
  BinaryOpNode,
  UnaryOpNode,
  CallNode,
  MemberAccessNode,
  IdentifierNode,
  ArrayNode,
  ObjectNode,
  BinaryOperator,
  UnaryOperator
} from '../ast'
import { BenthosMessage, createMessage } from '../../core/message'
import { Interpreter, evaluate } from '../interpreter'

/**
 * Helper to build AST nodes for type safety testing
 */
namespace AST {
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

  export function call(
    func: ASTNode,
    args: ASTNode[] = [],
    line = 1,
    column = 1
  ): CallNode {
    return { type: 'Call', function: func, arguments: args, line, column }
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
}

describe('BloblangValue Type System Safety', () => {
  let msg: BenthosMessage

  beforeEach(() => {
    msg = createMessage({
      name: 'Alice',
      age: 30,
      items: ['a', 'b', 'c'],
      nested: { value: 42 }
    })
  })

  describe('Arithmetic Operations Type Validation', () => {
    describe('Addition (+) operator', () => {
      it('should REJECT string - string subtraction with TypeError', () => {
        // Current: casts to number silently, produces NaN
        // Expected: throw TypeError with message about expected number types
        const ast = AST.binaryOp('-', AST.literal('hello'), AST.literal('world'))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/expected number/i)
      })

      it('should REJECT boolean operands in subtraction', () => {
        const ast = AST.binaryOp('-', AST.literal(true), AST.literal(false))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot subtract boolean/i)
      })

      it('should REJECT null operands in subtraction', () => {
        const ast = AST.binaryOp('-', AST.literal(null), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot perform arithmetic on null/i)
      })

      it('should REJECT array operands in arithmetic', () => {
        const ast = AST.binaryOp('+', AST.array([AST.literal(1)]), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot perform arithmetic on array/i)
      })

      it('should REJECT object operands in arithmetic', () => {
        const ast = AST.binaryOp('+', AST.object([{ key: 'a', value: AST.literal(1) }]), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot perform arithmetic on object/i)
      })
    })

    describe('Subtraction (-) operator', () => {
      it('should REJECT string operands with clear error', () => {
        const ast = AST.binaryOp('-', AST.literal('10'), AST.literal('5'))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/expected number.*got string/i)
      })

      it('should include both operand types in error message', () => {
        const ast = AST.binaryOp('-', AST.literal('text'), AST.literal(null))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        // Error should mention the types involved
        const errorCheck = () => {
          try {
            evaluate(ast, msg)
          } catch (e) {
            const message = (e as Error).message.toLowerCase()
            return message.includes('string') || message.includes('null')
          }
          return false
        }
        expect(errorCheck()).toBe(true)
      })
    })

    describe('Multiplication (*) operator', () => {
      it('should REJECT string * number', () => {
        const ast = AST.binaryOp('*', AST.literal('hello'), AST.literal(3))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot multiply/i)
      })

      it('should REJECT boolean * boolean', () => {
        const ast = AST.binaryOp('*', AST.literal(true), AST.literal(true))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Division (/) operator', () => {
      it('should REJECT string / number', () => {
        const ast = AST.binaryOp('/', AST.literal('100'), AST.literal(10))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot divide/i)
      })

      it('should REJECT array / number', () => {
        const ast = AST.binaryOp('/', AST.array([AST.literal(1), AST.literal(2)]), AST.literal(2))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Modulo (%) operator', () => {
      it('should REJECT string % number', () => {
        const ast = AST.binaryOp('%', AST.literal('17'), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/expected number/i)
      })

      it('should REJECT null % null', () => {
        const ast = AST.binaryOp('%', AST.literal(null), AST.literal(null))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Unary negation (-) operator', () => {
      it('should REJECT negating a string', () => {
        const ast = AST.unaryOp('-', AST.literal('hello'))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot negate string/i)
      })

      it('should REJECT negating an array', () => {
        const ast = AST.unaryOp('-', AST.array([AST.literal(1), AST.literal(2)]))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot negate array/i)
      })

      it('should REJECT negating an object', () => {
        const ast = AST.unaryOp('-', AST.object([{ key: 'x', value: AST.literal(1) }]))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot negate object/i)
      })

      it('should REJECT negating null', () => {
        const ast = AST.unaryOp('-', AST.literal(null))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot negate null/i)
      })

      it('should REJECT negating a boolean', () => {
        const ast = AST.unaryOp('-', AST.literal(true))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot negate boolean/i)
      })
    })
  })

  describe('String Method Type Validation', () => {
    describe('uppercase() method', () => {
      it('should REJECT number.uppercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'uppercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/uppercase expects a string/i)
      })

      it('should REJECT array.uppercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal('a')]), 'uppercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/uppercase expects a string.*got array/i)
      })

      it('should REJECT null.uppercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'uppercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT object.uppercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.object([{ key: 'x', value: AST.literal(1) }]), 'uppercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/uppercase expects a string.*got object/i)
      })
    })

    describe('lowercase() method', () => {
      it('should REJECT number.lowercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'lowercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/lowercase expects a string/i)
      })

      it('should REJECT boolean.lowercase()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(true), 'lowercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('trim() method', () => {
      it('should REJECT number.trim()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(123), 'trim'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/trim expects a string/i)
      })
    })

    describe('replace() method', () => {
      it('should REJECT number.replace()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'replace'),
          [AST.literal('4'), AST.literal('X')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/replace expects a string/i)
      })

      it('should REJECT array.replace()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal('a'), AST.literal('b')]), 'replace'),
          [AST.literal('a'), AST.literal('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('split() method', () => {
      it('should REJECT number.split()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(123), 'split'),
          [AST.literal(',')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/split expects a string/i)
      })
    })

    describe('contains() on string', () => {
      it('should REJECT number.contains() as string method', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(12345), 'contains'),
          [AST.literal('23')]
        )

        // Should fail because 12345 is not a string
        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('slice() on string', () => {
      it('should REJECT number.slice()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(12345), 'slice'),
          [AST.literal(0), AST.literal(2)]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/slice expects a string or array/i)
      })
    })

    describe('has_prefix() method', () => {
      it('should REJECT number.has_prefix()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(12345), 'has_prefix'),
          [AST.literal('12')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/has_prefix expects a string/i)
      })
    })

    describe('has_suffix() method', () => {
      it('should REJECT array.has_suffix()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal('test')]), 'has_suffix'),
          [AST.literal('st')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/has_suffix expects a string/i)
      })
    })
  })

  describe('Array Method Type Validation', () => {
    describe('map() method', () => {
      it('should REJECT string.map()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'map'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/map expects an array/i)
      })

      it('should REJECT number.map()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'map'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT object.map()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.object([{ key: 'a', value: AST.literal(1) }]), 'map'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/map expects an array.*got object/i)
      })
    })

    describe('filter() method', () => {
      it('should REJECT string.filter()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'filter'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/filter expects an array/i)
      })

      it('should REJECT null.filter()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'filter'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('reduce() method', () => {
      it('should REJECT string.reduce()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'reduce'),
          [AST.identifier('acc'), AST.literal(0)]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/reduce expects an array/i)
      })

      it('should REJECT number.reduce()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'reduce'),
          [AST.identifier('acc'), AST.literal(0)]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('join() method', () => {
      it('should REJECT string.join()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'join'),
          [AST.literal(',')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/join expects an array/i)
      })

      it('should REJECT number.join()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(12345), 'join'),
          [AST.literal('-')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('reverse() method', () => {
      it('should REJECT string.reverse() - strings have no reverse method', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'reverse'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/reverse expects an array/i)
      })

      it('should REJECT number.reverse()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(12345), 'reverse'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('sort() method', () => {
      it('should REJECT string.sort()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('dcba'), 'sort'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/sort expects an array/i)
      })

      it('should REJECT object.sort()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.object([{ key: 'a', value: AST.literal(1) }]), 'sort'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('first() method', () => {
      it('should REJECT string.first()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'first'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/first expects an array/i)
      })
    })

    describe('last() method', () => {
      it('should REJECT number.last()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'last'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/last expects an array/i)
      })
    })

    describe('flatten() method', () => {
      it('should REJECT string.flatten()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'flatten'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/flatten expects an array/i)
      })
    })

    describe('unique() method', () => {
      it('should REJECT object.unique()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.object([{ key: 'a', value: AST.literal(1) }]), 'unique'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/unique expects an array/i)
      })
    })

    describe('append() method', () => {
      it('should REJECT string.append()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'append'),
          [AST.literal('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/append expects an array/i)
      })
    })

    describe('concat() method', () => {
      it('should REJECT string.concat() as array method', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'concat'),
          [AST.array([AST.literal('a')])]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/concat expects an array/i)
      })
    })

    describe('slice() on arrays', () => {
      it('should REJECT slice() with non-number start index', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal(2), AST.literal(3)]), 'slice'),
          [AST.literal('0'), AST.literal(2)]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/slice.*start.*must be a number/i)
      })

      it('should REJECT slice() with non-number end index', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal(2), AST.literal(3)]), 'slice'),
          [AST.literal(0), AST.literal('2')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/slice.*end.*must be a number/i)
      })
    })

    describe('index() method', () => {
      it('should REJECT string.index()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'index'),
          [AST.literal(0)]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/index expects an array/i)
      })

      it('should REJECT index() with non-number argument', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal(2)]), 'index'),
          [AST.literal('0')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/index.*must be a number/i)
      })
    })

    describe('sum() method', () => {
      it('should REJECT string.sum()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('12345'), 'sum'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/sum expects an array/i)
      })

      it('should REJECT sum() on array with non-numbers', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal('two'), AST.literal(3)]), 'sum'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/sum.*array must contain only numbers/i)
      })
    })
  })

  describe('Object Method Type Validation', () => {
    describe('keys() method', () => {
      it('should REJECT array.keys() as object method', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal(2)]), 'keys'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/keys.*requires.*object/i)
      })

      it('should REJECT string.keys()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'keys'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT number.keys()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(42), 'keys'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT null.keys()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'keys'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('values() method', () => {
      it('should REJECT array.values() as object method', () => {
        const ast = AST.call(
          AST.memberAccess(AST.array([AST.literal(1), AST.literal(2)]), 'values'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/values.*requires.*object/i)
      })

      it('should REJECT string.values()', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal('hello'), 'values'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })

  describe('Explicit Type Coercion (Not Implicit)', () => {
    describe('Numeric string coercion should require explicit conversion', () => {
      it('should NOT implicitly coerce "5" - 3 to number subtraction', () => {
        // Current: silently produces NaN or incorrect result
        // Expected: either throw or require explicit int()/float() conversion
        const ast = AST.binaryOp('-', AST.literal('5'), AST.literal(3))

        // Should either throw or produce a predictable, documented result
        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should NOT implicitly coerce "10" * 2 to number multiplication', () => {
        const ast = AST.binaryOp('*', AST.literal('10'), AST.literal(2))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should NOT implicitly coerce "20" / 4 to number division', () => {
        const ast = AST.binaryOp('/', AST.literal('20'), AST.literal(4))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Boolean coercion should be explicit', () => {
      it('should NOT implicitly coerce true + 1 to number', () => {
        // Current: true becomes 1, produces 2
        // Expected: throw TypeError requiring explicit int(true)
        const ast = AST.binaryOp('+', AST.literal(true), AST.literal(1))

        // String concatenation with boolean is also problematic
        // If we're not in string context, this should fail
        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should NOT implicitly coerce false - 1 to number', () => {
        const ast = AST.binaryOp('-', AST.literal(false), AST.literal(1))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Null coercion should be explicit', () => {
      it('should NOT implicitly coerce null + 5 to number', () => {
        const ast = AST.binaryOp('+', AST.literal(null), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should NOT implicitly coerce null * 3 to number', () => {
        const ast = AST.binaryOp('*', AST.literal(null), AST.literal(3))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })

  describe('Error Messages Include Actual Type', () => {
    it('should include actual type "string" when number expected', () => {
      const ast = AST.binaryOp('-', AST.literal('hello'), AST.literal(5))

      expect(() => evaluate(ast, msg)).toThrow(/got string/i)
    })

    it('should include actual type "number" when string expected', () => {
      const ast = AST.call(
        AST.memberAccess(AST.literal(42), 'uppercase'),
        []
      )

      expect(() => evaluate(ast, msg)).toThrow(/got number/i)
    })

    it('should include actual type "array" when object expected', () => {
      const ast = AST.call(
        AST.memberAccess(AST.array([AST.literal(1)]), 'keys'),
        []
      )

      expect(() => evaluate(ast, msg)).toThrow(/got array/i)
    }  )

    it('should include actual type "object" when array expected', () => {
      const ast = AST.call(
        AST.memberAccess(AST.object([{ key: 'a', value: AST.literal(1) }]), 'map'),
        [AST.identifier('x')]
      )

      expect(() => evaluate(ast, msg)).toThrow(/got object/i)
    })

    it('should include actual type "null" in error messages', () => {
      const ast = AST.binaryOp('-', AST.literal(null), AST.literal(5))

      expect(() => evaluate(ast, msg)).toThrow(/got null/i)
    })

    it('should include actual type "boolean" in error messages', () => {
      const ast = AST.binaryOp('*', AST.literal(true), AST.literal(5))

      expect(() => evaluate(ast, msg)).toThrow(/got bool/i)
    })

    it('should identify the operation in error messages', () => {
      const ast = AST.binaryOp('/', AST.literal('hello'), AST.literal(5))

      expect(() => evaluate(ast, msg)).toThrow(/division|divide/i)
    })
  })

  describe('Null/Undefined Handling in Operations', () => {
    describe('Arithmetic with null', () => {
      it('should throw on null + number', () => {
        const ast = AST.binaryOp('+', AST.literal(null), AST.literal(10))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw on number + null', () => {
        const ast = AST.binaryOp('+', AST.literal(10), AST.literal(null))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw on null - null', () => {
        const ast = AST.binaryOp('-', AST.literal(null), AST.literal(null))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw on null * number', () => {
        const ast = AST.binaryOp('*', AST.literal(null), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw on null / number', () => {
        const ast = AST.binaryOp('/', AST.literal(null), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Method calls on null', () => {
      it('should throw when calling uppercase() on null', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'uppercase'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw when calling map() on null', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'map'),
          [AST.identifier('x')]
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw when calling keys() on null', () => {
        const ast = AST.call(
          AST.memberAccess(AST.literal(null), 'keys'),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('Undefined handling (from missing properties)', () => {
      it('should throw when performing arithmetic on undefined property', () => {
        // msg.nonexistent is undefined
        const ast = AST.binaryOp(
          '-',
          AST.memberAccess(AST.identifier('nonexistent'), 'value'),
          AST.literal(5)
        )

        // Should throw rather than produce NaN
        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should throw when calling string method on undefined', () => {
        const ast = AST.call(
          AST.memberAccess(
            AST.memberAccess(AST.identifier('nonexistent'), 'value'),
            'uppercase'
          ),
          []
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })

  describe('Object Property Access Type Safety', () => {
    describe('Accessing properties on non-objects', () => {
      it('should handle property access on number gracefully', () => {
        const ast = AST.memberAccess(AST.literal(42), 'property')

        // Should return undefined, not throw (but should NOT try to access .property on 42)
        const result = evaluate(ast, msg)
        expect(result).toBeUndefined()
      })

      it('should handle property access on string gracefully', () => {
        const ast = AST.memberAccess(AST.literal('hello'), 'property')

        const result = evaluate(ast, msg)
        expect(result).toBeUndefined()
      })

      it('should handle property access on boolean gracefully', () => {
        const ast = AST.memberAccess(AST.literal(true), 'property')

        const result = evaluate(ast, msg)
        expect(result).toBeUndefined()
      })
    })

    describe('Array index access type safety', () => {
      it('should throw on string index for array', () => {
        const ast = AST.memberAccess(
          AST.array([AST.literal(1), AST.literal(2), AST.literal(3)]),
          AST.literal('one'),
          'bracket'
        )

        // Arrays should not accept non-numeric string indices
        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/array index must be a number/i)
      })

      it('should handle boolean index for array', () => {
        const ast = AST.memberAccess(
          AST.array([AST.literal(1), AST.literal(2)]),
          AST.literal(true),
          'bracket'
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should handle object index for array', () => {
        const ast = AST.memberAccess(
          AST.array([AST.literal(1), AST.literal(2)]),
          AST.object([{ key: 'a', value: AST.literal(1) }]),
          'bracket'
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })

  describe('Global Function Type Validation', () => {
    describe('abs() function', () => {
      it('should REJECT abs(string)', () => {
        const ast = AST.call(AST.identifier('abs'), [AST.literal('hello')])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/abs.*expects.*number/i)
      })

      it('should REJECT abs(array)', () => {
        const ast = AST.call(AST.identifier('abs'), [AST.array([AST.literal(1)])])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT abs(null)', () => {
        const ast = AST.call(AST.identifier('abs'), [AST.literal(null)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('ceil() function', () => {
      it('should REJECT ceil(string)', () => {
        const ast = AST.call(AST.identifier('ceil'), [AST.literal('3.7')])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/ceil.*expects.*number/i)
      })

      it('should REJECT ceil(boolean)', () => {
        const ast = AST.call(AST.identifier('ceil'), [AST.literal(true)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('floor() function', () => {
      it('should REJECT floor(string)', () => {
        const ast = AST.call(AST.identifier('floor'), [AST.literal('3.7')])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/floor.*expects.*number/i)
      })
    })

    describe('round() function', () => {
      it('should REJECT round(string)', () => {
        const ast = AST.call(AST.identifier('round'), [AST.literal('3.5')])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/round.*expects.*number/i)
      })

      it('should REJECT round(object)', () => {
        const ast = AST.call(AST.identifier('round'), [AST.object([{ key: 'a', value: AST.literal(1) }])])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('max() function', () => {
      it('should REJECT max(string, number)', () => {
        const ast = AST.call(AST.identifier('max'), [AST.literal('5'), AST.literal(3)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/max.*expects.*number/i)
      })

      it('should REJECT max(number, null)', () => {
        const ast = AST.call(AST.identifier('max'), [AST.literal(5), AST.literal(null)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })

    describe('min() function', () => {
      it('should REJECT min(array, number)', () => {
        const ast = AST.call(AST.identifier('min'), [AST.array([AST.literal(1)]), AST.literal(2)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/min.*expects.*number/i)
      })
    })

    describe('sum() function', () => {
      it('should REJECT sum(number)', () => {
        const ast = AST.call(AST.identifier('sum'), [AST.literal(42)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/sum.*expects.*array/i)
      })

      it('should REJECT sum(string)', () => {
        const ast = AST.call(AST.identifier('sum'), [AST.literal('123')])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT sum() on mixed-type array', () => {
        const ast = AST.call(AST.identifier('sum'), [
          AST.array([AST.literal(1), AST.literal('two'), AST.literal(3)])
        ])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/sum.*must contain only numbers/i)
      })
    })

    describe('length() function', () => {
      it('should REJECT length(number)', () => {
        const ast = AST.call(AST.identifier('length'), [AST.literal(12345)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/length.*expects.*string or array/i)
      })

      it('should REJECT length(object)', () => {
        const ast = AST.call(AST.identifier('length'), [AST.object([{ key: 'a', value: AST.literal(1) }])])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT length(null)', () => {
        const ast = AST.call(AST.identifier('length'), [AST.literal(null)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT length(boolean)', () => {
        const ast = AST.call(AST.identifier('length'), [AST.literal(true)])

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })

  describe('Comparison Operator Type Validation', () => {
    describe('Ordering comparisons (<, >, <=, >=)', () => {
      it('should REJECT comparing number < array', () => {
        const ast = AST.binaryOp('<', AST.literal(5), AST.array([AST.literal(1)]))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot compare number.*array/i)
      })

      it('should REJECT comparing string > object', () => {
        const ast = AST.binaryOp('>', AST.literal('hello'), AST.object([{ key: 'a', value: AST.literal(1) }]))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot compare string.*object/i)
      })

      it('should REJECT comparing boolean <= number', () => {
        const ast = AST.binaryOp('<=', AST.literal(true), AST.literal(5))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT comparing null >= string', () => {
        const ast = AST.binaryOp('>=', AST.literal(null), AST.literal('hello'))

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })

      it('should REJECT comparing array < array (not orderable)', () => {
        const ast = AST.binaryOp(
          '<',
          AST.array([AST.literal(1)]),
          AST.array([AST.literal(2)])
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
        expect(() => evaluate(ast, msg)).toThrow(/cannot compare array.*array/i)
      })

      it('should REJECT comparing object > object (not orderable)', () => {
        const ast = AST.binaryOp(
          '>',
          AST.object([{ key: 'a', value: AST.literal(1) }]),
          AST.object([{ key: 'b', value: AST.literal(2) }])
        )

        expect(() => evaluate(ast, msg)).toThrow(TypeError)
      })
    })
  })
})
