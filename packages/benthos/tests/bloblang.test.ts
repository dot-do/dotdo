/**
 * RED Phase Tests: Bloblang Parser and Interpreter
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for the Bloblang expression language.
 */

import { describe, it, expect } from 'vitest'
import { parse, evaluate, createMessage, Interpreter, DELETED, NOTHING } from '../src'

describe('Bloblang Parser', () => {
  describe('literals', () => {
    it('should parse strings', () => {
      const ast = parse('"hello world"')
      expect(ast.type).toBe('Literal')
    })

    it('should parse numbers', () => {
      const ast = parse('42')
      expect(ast.type).toBe('Literal')
    })

    it('should parse floats', () => {
      const ast = parse('3.14')
      expect(ast.type).toBe('Literal')
    })

    it('should parse booleans', () => {
      expect(parse('true').type).toBe('Literal')
      expect(parse('false').type).toBe('Literal')
    })

    it('should parse null', () => {
      const ast = parse('null')
      expect(ast.type).toBe('Literal')
    })
  })

  describe('identifiers', () => {
    it('should parse root reference', () => {
      const ast = parse('root')
      expect(ast.type).toBe('Root')
    })

    it('should parse this reference', () => {
      const ast = parse('this')
      expect(ast.type).toBe('This')
    })

    it('should parse meta reference', () => {
      const ast = parse('meta')
      expect(ast.type).toBe('Meta')
    })

    it('should parse identifiers', () => {
      const ast = parse('fieldName')
      expect(ast.type).toBe('Identifier')
    })

    it('should parse dot shorthand', () => {
      // .field is shorthand for root.field
      const ast = parse('.field')
      expect(ast.type).toBe('MemberAccess')
    })
  })

  describe('operators', () => {
    it('should parse arithmetic', () => {
      const ast = parse('1 + 2')
      expect(ast.type).toBe('BinaryOp')
    })

    it('should parse comparisons', () => {
      expect(parse('a > b').type).toBe('BinaryOp')
      expect(parse('a < b').type).toBe('BinaryOp')
      expect(parse('a >= b').type).toBe('BinaryOp')
      expect(parse('a <= b').type).toBe('BinaryOp')
      expect(parse('a == b').type).toBe('BinaryOp')
      expect(parse('a != b').type).toBe('BinaryOp')
    })

    it('should parse logical operators', () => {
      expect(parse('a && b').type).toBe('BinaryOp')
      expect(parse('a || b').type).toBe('BinaryOp')
    })

    it('should parse unary operators', () => {
      expect(parse('-x').type).toBe('UnaryOp')
      expect(parse('!x').type).toBe('UnaryOp')
    })

    it('should respect precedence', () => {
      // 1 + 2 * 3 should parse as 1 + (2 * 3)
      const ast = parse('1 + 2 * 3')
      expect(ast.type).toBe('BinaryOp')
    })
  })

  describe('member access', () => {
    it('should parse dot access', () => {
      const ast = parse('root.field')
      expect(ast.type).toBe('MemberAccess')
    })

    it('should parse bracket access', () => {
      const ast = parse('root["field"]')
      expect(ast.type).toBe('MemberAccess')
    })

    it('should parse index access', () => {
      const ast = parse('arr[0]')
      expect(ast.type).toBe('MemberAccess')
    })

    it('should parse optional chaining', () => {
      const ast = parse('root?.field')
      expect(ast.type).toBe('MemberAccess')
    })

    it('should parse chained access', () => {
      const ast = parse('root.a.b.c')
      expect(ast.type).toBe('MemberAccess')
    })
  })

  describe('function calls', () => {
    it('should parse function calls', () => {
      const ast = parse('length("hello")')
      expect(ast.type).toBe('Call')
    })

    it('should parse method calls', () => {
      const ast = parse('"hello".uppercase()')
      expect(ast.type).toBe('Call')
    })

    it('should parse chained methods', () => {
      const ast = parse('"hello".trim().uppercase()')
      expect(ast.type).toBe('Call')
    })

    it('should parse calls with multiple arguments', () => {
      const ast = parse('"hello".replace("l", "L")')
      expect(ast.type).toBe('Call')
    })
  })

  describe('collections', () => {
    it('should parse arrays', () => {
      const ast = parse('[1, 2, 3]')
      expect(ast.type).toBe('Array')
    })

    it('should parse objects', () => {
      const ast = parse('{"key": "value"}')
      expect(ast.type).toBe('Object')
    })

    it('should parse nested structures', () => {
      const ast = parse('{"arr": [1, 2], "obj": {"nested": true}}')
      expect(ast.type).toBe('Object')
    })
  })

  describe('control flow', () => {
    it('should parse if expression', () => {
      const ast = parse('if x > 0 then "positive" else "negative"')
      expect(ast.type).toBe('If')
    })

    it('should parse match expression', () => {
      const ast = parse('match x { case 1: "one" case 2: "two" default: "other" }')
      expect(ast.type).toBe('Match')
    })

    it('should parse let binding', () => {
      const ast = parse('let x = 5 in x * 2')
      expect(ast.type).toBe('Let')
    })
  })

  describe('pipes and arrows', () => {
    it('should parse pipe expression', () => {
      const ast = parse('"hello" | uppercase()')
      expect(ast.type).toBe('Pipe')
    })

    it('should parse arrow function', () => {
      const ast = parse('x -> x * 2')
      expect(ast.type).toBe('Arrow')
    })

    it('should parse array map', () => {
      const ast = parse('[1, 2, 3].map(x -> x * 2)')
      expect(ast.type).toBe('Call')
    })
  })

  describe('assignments', () => {
    it('should parse root assignment', () => {
      const ast = parse('root = "new value"')
      expect(ast.type).toBe('Assign')
    })

    it('should parse field assignment', () => {
      const ast = parse('root.field = "value"')
      expect(ast.type).toBe('Assign')
    })

    it('should parse meta assignment', () => {
      const ast = parse('meta("key") = "value"')
      expect(ast.type).toBe('Assign')
    })
  })

  describe('sequences', () => {
    it('should parse multiple statements', () => {
      const ast = parse('let x = 1; let y = 2; x + y')
      expect(ast.type).toBe('Sequence')
    })
  })
})

describe('Bloblang Interpreter', () => {
  describe('literals', () => {
    it('should evaluate strings', () => {
      expect(evaluate(parse('"hello"'), createMessage({}))).toBe('hello')
    })

    it('should evaluate numbers', () => {
      expect(evaluate(parse('42'), createMessage({}))).toBe(42)
    })

    it('should evaluate booleans', () => {
      expect(evaluate(parse('true'), createMessage({}))).toBe(true)
      expect(evaluate(parse('false'), createMessage({}))).toBe(false)
    })

    it('should evaluate null', () => {
      expect(evaluate(parse('null'), createMessage({}))).toBe(null)
    })
  })

  describe('root access', () => {
    it('should access root', () => {
      const msg = createMessage({ foo: 'bar' })
      expect(evaluate(parse('root'), msg)).toEqual({ foo: 'bar' })
    })

    it('should access root fields', () => {
      const msg = createMessage({ name: 'Alice', age: 30 })
      expect(evaluate(parse('root.name'), msg)).toBe('Alice')
      expect(evaluate(parse('root.age'), msg)).toBe(30)
    })

    it('should access nested fields', () => {
      const msg = createMessage({ user: { profile: { name: 'Bob' } } })
      expect(evaluate(parse('root.user.profile.name'), msg)).toBe('Bob')
    })
  })

  describe('arithmetic', () => {
    it('should add', () => {
      expect(evaluate(parse('5 + 3'), createMessage({}))).toBe(8)
    })

    it('should subtract', () => {
      expect(evaluate(parse('10 - 4'), createMessage({}))).toBe(6)
    })

    it('should multiply', () => {
      expect(evaluate(parse('6 * 7'), createMessage({}))).toBe(42)
    })

    it('should divide', () => {
      expect(evaluate(parse('15 / 3'), createMessage({}))).toBe(5)
    })

    it('should modulo', () => {
      expect(evaluate(parse('17 % 5'), createMessage({}))).toBe(2)
    })

    it('should respect precedence', () => {
      expect(evaluate(parse('2 + 3 * 4'), createMessage({}))).toBe(14)
    })

    it('should handle parentheses', () => {
      expect(evaluate(parse('(2 + 3) * 4'), createMessage({}))).toBe(20)
    })
  })

  describe('string concatenation', () => {
    it('should concatenate strings', () => {
      expect(evaluate(parse('"hello" + " " + "world"'), createMessage({}))).toBe('hello world')
    })

    it('should concatenate string and number', () => {
      expect(evaluate(parse('"value: " + 42'), createMessage({}))).toBe('value: 42')
    })
  })

  describe('comparisons', () => {
    it('should compare equal', () => {
      expect(evaluate(parse('1 == 1'), createMessage({}))).toBe(true)
      expect(evaluate(parse('1 == 2'), createMessage({}))).toBe(false)
    })

    it('should compare not equal', () => {
      expect(evaluate(parse('1 != 2'), createMessage({}))).toBe(true)
      expect(evaluate(parse('1 != 1'), createMessage({}))).toBe(false)
    })

    it('should compare less than', () => {
      expect(evaluate(parse('1 < 2'), createMessage({}))).toBe(true)
      expect(evaluate(parse('2 < 1'), createMessage({}))).toBe(false)
    })

    it('should compare greater than', () => {
      expect(evaluate(parse('2 > 1'), createMessage({}))).toBe(true)
      expect(evaluate(parse('1 > 2'), createMessage({}))).toBe(false)
    })
  })

  describe('logical operators', () => {
    it('should evaluate AND', () => {
      expect(evaluate(parse('true && true'), createMessage({}))).toBe(true)
      expect(evaluate(parse('true && false'), createMessage({}))).toBe(false)
    })

    it('should evaluate OR', () => {
      expect(evaluate(parse('false || true'), createMessage({}))).toBe(true)
      expect(evaluate(parse('false || false'), createMessage({}))).toBe(false)
    })

    it('should short-circuit AND', () => {
      // false && anything should return false without evaluating right side
      expect(evaluate(parse('false && undefined_var'), createMessage({}))).toBe(false)
    })

    it('should short-circuit OR', () => {
      // true || anything should return true
      expect(evaluate(parse('true || undefined_var'), createMessage({}))).toBe(true)
    })
  })

  describe('string methods', () => {
    it('should uppercase', () => {
      expect(evaluate(parse('"hello".uppercase()'), createMessage({}))).toBe('HELLO')
    })

    it('should lowercase', () => {
      expect(evaluate(parse('"HELLO".lowercase()'), createMessage({}))).toBe('hello')
    })

    it('should trim', () => {
      expect(evaluate(parse('"  hello  ".trim()'), createMessage({}))).toBe('hello')
    })

    it('should replace', () => {
      expect(evaluate(parse('"hello".replace("l", "L")'), createMessage({}))).toBe('heLlo')
    })

    it('should replace_all', () => {
      expect(evaluate(parse('"hello".replace_all("l", "L")'), createMessage({}))).toBe('heLLo')
    })

    it('should split', () => {
      expect(evaluate(parse('"a,b,c".split(",")'), createMessage({}))).toEqual(['a', 'b', 'c'])
    })

    it('should get length', () => {
      expect(evaluate(parse('"hello".length()'), createMessage({}))).toBe(5)
    })

    it('should check contains', () => {
      expect(evaluate(parse('"hello world".contains("world")'), createMessage({}))).toBe(true)
      expect(evaluate(parse('"hello".contains("x")'), createMessage({}))).toBe(false)
    })

    it('should check has_prefix', () => {
      expect(evaluate(parse('"hello".has_prefix("he")'), createMessage({}))).toBe(true)
      expect(evaluate(parse('"hello".has_prefix("x")'), createMessage({}))).toBe(false)
    })

    it('should check has_suffix', () => {
      expect(evaluate(parse('"hello".has_suffix("lo")'), createMessage({}))).toBe(true)
      expect(evaluate(parse('"hello".has_suffix("x")'), createMessage({}))).toBe(false)
    })

    it('should slice', () => {
      expect(evaluate(parse('"hello".slice(1, 3)'), createMessage({}))).toBe('el')
    })
  })

  describe('array methods', () => {
    it('should map', () => {
      expect(evaluate(parse('[1, 2, 3].map(x -> x * 2)'), createMessage({}))).toEqual([2, 4, 6])
    })

    it('should filter', () => {
      expect(evaluate(parse('[1, 2, 3, 4].filter(x -> x > 2)'), createMessage({}))).toEqual([3, 4])
    })

    it('should get length', () => {
      expect(evaluate(parse('[1, 2, 3].length()'), createMessage({}))).toBe(3)
    })

    it('should get first', () => {
      expect(evaluate(parse('[1, 2, 3].first()'), createMessage({}))).toBe(1)
    })

    it('should get last', () => {
      expect(evaluate(parse('[1, 2, 3].last()'), createMessage({}))).toBe(3)
    })

    it('should join', () => {
      expect(evaluate(parse('["a", "b", "c"].join("-")'), createMessage({}))).toBe('a-b-c')
    })

    it('should flatten', () => {
      expect(evaluate(parse('[[1, 2], [3, 4]].flatten()'), createMessage({}))).toEqual([1, 2, 3, 4])
    })

    it('should unique', () => {
      const result = evaluate(parse('[1, 2, 2, 3, 3, 3].unique()'), createMessage({}))
      expect(result).toEqual([1, 2, 3])
    })

    it('should sum', () => {
      expect(evaluate(parse('[1, 2, 3, 4].sum()'), createMessage({}))).toBe(10)
    })

    it('should append', () => {
      expect(evaluate(parse('[1, 2].append(3)'), createMessage({}))).toEqual([1, 2, 3])
    })

    it('should concat', () => {
      expect(evaluate(parse('[1, 2].concat([3, 4])'), createMessage({}))).toEqual([1, 2, 3, 4])
    })
  })

  describe('object methods', () => {
    it('should get keys', () => {
      const result = evaluate(parse('{"a": 1, "b": 2}.keys()'), createMessage({}))
      expect(result).toContain('a')
      expect(result).toContain('b')
    })

    it('should get values', () => {
      const result = evaluate(parse('{"a": 1, "b": 2}.values()'), createMessage({}))
      expect(result).toContain(1)
      expect(result).toContain(2)
    })
  })

  describe('control flow', () => {
    it('should evaluate if true', () => {
      expect(evaluate(parse('if true then "yes" else "no"'), createMessage({}))).toBe('yes')
    })

    it('should evaluate if false', () => {
      expect(evaluate(parse('if false then "yes" else "no"'), createMessage({}))).toBe('no')
    })

    it('should evaluate if with condition', () => {
      const msg = createMessage({ value: 10 })
      expect(evaluate(parse('if root.value > 5 then "big" else "small"'), msg)).toBe('big')
    })

    it('should evaluate match', () => {
      const msg = createMessage({ status: 'active' })
      const result = evaluate(parse(`
        match root.status {
          case "active": "is active"
          case "inactive": "is inactive"
          default: "unknown"
        }
      `), msg)
      expect(result).toBe('is active')
    })

    it('should evaluate let binding', () => {
      expect(evaluate(parse('let x = 5 in x * 2'), createMessage({}))).toBe(10)
    })
  })

  describe('pipes', () => {
    it('should pipe to method', () => {
      expect(evaluate(parse('"hello" | uppercase()'), createMessage({}))).toBe('HELLO')
    })

    it('should chain pipes', () => {
      expect(evaluate(parse('"  HELLO  " | trim() | lowercase()'), createMessage({}))).toBe('hello')
    })
  })

  describe('metadata', () => {
    it('should access all metadata', () => {
      const msg = createMessage('test', { key: 'value' })
      const result = evaluate(parse('meta()'), msg)
      expect(result).toEqual({ key: 'value' })
    })

    it('should access specific metadata', () => {
      const msg = createMessage('test', { source: 'api' })
      expect(evaluate(parse('meta("source")'), msg)).toBe('api')
    })
  })

  describe('special values', () => {
    it('should return DELETED for deleted()', () => {
      expect(evaluate(parse('deleted()'), createMessage({}))).toBe(DELETED)
    })

    it('should return NOTHING for nothing()', () => {
      expect(evaluate(parse('nothing()'), createMessage({}))).toBe(NOTHING)
    })
  })

  describe('type errors', () => {
    it('should throw on arithmetic with non-numbers', () => {
      expect(() => evaluate(parse('"a" - "b"'), createMessage({}))).toThrow(TypeError)
    })

    it('should throw on comparison of incompatible types', () => {
      expect(() => evaluate(parse('"a" > 1'), createMessage({}))).toThrow(TypeError)
    })
  })
})

describe('Interpreter class', () => {
  it('should be instantiable', () => {
    const interp = new Interpreter(createMessage({}))
    expect(interp).toBeDefined()
  })

  it('should evaluate AST', () => {
    const interp = new Interpreter(createMessage({ x: 5 }))
    expect(interp.evaluate(parse('root.x'))).toBe(5)
  })
})
