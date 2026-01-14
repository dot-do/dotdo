/**
 * Safe Expression Parser Tests - RED Phase (TDD)
 *
 * This module tests the safe expression parser that replaces eval() for
 * arithmetic evaluation. The parser must handle:
 * - Basic arithmetic operations (+, -, *, /, %)
 * - Power operator (^)
 * - Parentheses and operator precedence
 * - Negative numbers
 * - bc-specific features (scale, ibase, obase, variables)
 * - Math library functions (sqrt, sin, cos, etc.)
 *
 * SECURITY: These tests verify that code injection attempts are blocked.
 *
 * @module bashx/tests/do/commands/safe-expr.test
 */

import { describe, it, expect } from 'vitest'
import {
  tokenize,
  parse,
  evaluate,
  safeEval,
  type Token,
  type AstNode,
  SafeExprError,
} from '../../../src/do/commands/safe-expr.js'

// ============================================================================
// TOKENIZER TESTS
// ============================================================================

describe('Tokenizer', () => {
  describe('basic number tokenization', () => {
    it('should tokenize a single integer', () => {
      const tokens = tokenize('42')
      expect(tokens).toEqual([{ type: 'number', value: 42 }])
    })

    it('should tokenize a decimal number', () => {
      const tokens = tokenize('3.14')
      expect(tokens).toEqual([{ type: 'number', value: 3.14 }])
    })

    it('should tokenize a negative number', () => {
      const tokens = tokenize('-5')
      expect(tokens).toEqual([
        { type: 'operator', value: '-' },
        { type: 'number', value: 5 },
      ])
    })

    it('should tokenize leading decimal (.5)', () => {
      const tokens = tokenize('.5')
      expect(tokens).toEqual([{ type: 'number', value: 0.5 }])
    })

    it('should tokenize trailing decimal (5.)', () => {
      const tokens = tokenize('5.')
      expect(tokens).toEqual([{ type: 'number', value: 5 }])
    })
  })

  describe('operator tokenization', () => {
    it('should tokenize addition', () => {
      const tokens = tokenize('2+3')
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
      ])
    })

    it('should tokenize subtraction', () => {
      const tokens = tokenize('10-3')
      expect(tokens).toEqual([
        { type: 'number', value: 10 },
        { type: 'operator', value: '-' },
        { type: 'number', value: 3 },
      ])
    })

    it('should tokenize multiplication', () => {
      const tokens = tokenize('6*7')
      expect(tokens).toEqual([
        { type: 'number', value: 6 },
        { type: 'operator', value: '*' },
        { type: 'number', value: 7 },
      ])
    })

    it('should tokenize division', () => {
      const tokens = tokenize('10/3')
      expect(tokens).toEqual([
        { type: 'number', value: 10 },
        { type: 'operator', value: '/' },
        { type: 'number', value: 3 },
      ])
    })

    it('should tokenize modulo', () => {
      const tokens = tokenize('17%5')
      expect(tokens).toEqual([
        { type: 'number', value: 17 },
        { type: 'operator', value: '%' },
        { type: 'number', value: 5 },
      ])
    })

    it('should tokenize power', () => {
      const tokens = tokenize('2^10')
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '^' },
        { type: 'number', value: 10 },
      ])
    })
  })

  describe('parentheses tokenization', () => {
    it('should tokenize parentheses', () => {
      const tokens = tokenize('(2+3)')
      expect(tokens).toEqual([
        { type: 'lparen', value: '(' },
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
        { type: 'rparen', value: ')' },
      ])
    })

    it('should tokenize nested parentheses', () => {
      const tokens = tokenize('((2+3)*4)')
      expect(tokens).toHaveLength(9)
      expect(tokens[0]).toEqual({ type: 'lparen', value: '(' })
      expect(tokens[8]).toEqual({ type: 'rparen', value: ')' })
    })
  })

  describe('whitespace handling', () => {
    it('should ignore whitespace', () => {
      const tokens = tokenize('2 + 3')
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
      ])
    })

    it('should handle multiple spaces', () => {
      const tokens = tokenize('  2   +   3  ')
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
      ])
    })

    it('should handle newlines', () => {
      const tokens = tokenize('2\n+\n3')
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
      ])
    })
  })

  describe('bc-specific features', () => {
    it('should tokenize variable assignment', () => {
      const tokens = tokenize('x=5')
      expect(tokens).toEqual([
        { type: 'identifier', value: 'x' },
        { type: 'assign', value: '=' },
        { type: 'number', value: 5 },
      ])
    })

    it('should tokenize scale directive', () => {
      const tokens = tokenize('scale=2')
      expect(tokens).toEqual([
        { type: 'identifier', value: 'scale' },
        { type: 'assign', value: '=' },
        { type: 'number', value: 2 },
      ])
    })

    it('should tokenize semicolon-separated statements', () => {
      const tokens = tokenize('scale=2; 10/3')
      expect(tokens).toContainEqual({ type: 'semicolon', value: ';' })
    })

    it('should tokenize function calls', () => {
      const tokens = tokenize('sqrt(16)')
      expect(tokens).toEqual([
        { type: 'function', value: 'sqrt' },
        { type: 'lparen', value: '(' },
        { type: 'number', value: 16 },
        { type: 'rparen', value: ')' },
      ])
    })

    it('should tokenize bc math functions (s, c, a, l, e)', () => {
      const tokens = tokenize('s(0)')
      expect(tokens[0]).toEqual({ type: 'function', value: 's' })
    })

    it('should tokenize ibase', () => {
      const tokens = tokenize('ibase=16')
      expect(tokens).toEqual([
        { type: 'identifier', value: 'ibase' },
        { type: 'assign', value: '=' },
        { type: 'number', value: 16 },
      ])
    })

    it('should tokenize obase', () => {
      const tokens = tokenize('obase=2')
      expect(tokens).toEqual([
        { type: 'identifier', value: 'obase' },
        { type: 'assign', value: '=' },
        { type: 'number', value: 2 },
      ])
    })

    it('should tokenize hex numbers after ibase=16', () => {
      const tokens = tokenize('ibase=16; FF')
      // After ibase=16, FF should be recognized as a hex number
      expect(tokens).toContainEqual({ type: 'number', value: 255 })
    })
  })
})

// ============================================================================
// PARSER TESTS
// ============================================================================

describe('Parser', () => {
  describe('basic expressions', () => {
    it('should parse a single number', () => {
      const ast = parse(tokenize('42'))
      expect(ast).toEqual({
        type: 'number',
        value: 42,
      })
    })

    it('should parse addition', () => {
      const ast = parse(tokenize('2+3'))
      expect(ast).toEqual({
        type: 'binary',
        operator: '+',
        left: { type: 'number', value: 2 },
        right: { type: 'number', value: 3 },
      })
    })

    it('should parse subtraction', () => {
      const ast = parse(tokenize('10-3'))
      expect(ast).toEqual({
        type: 'binary',
        operator: '-',
        left: { type: 'number', value: 10 },
        right: { type: 'number', value: 3 },
      })
    })
  })

  describe('operator precedence', () => {
    it('should respect multiplication over addition (left)', () => {
      const ast = parse(tokenize('2+3*4'))
      // Should be 2 + (3*4), not (2+3) * 4
      expect(ast).toEqual({
        type: 'binary',
        operator: '+',
        left: { type: 'number', value: 2 },
        right: {
          type: 'binary',
          operator: '*',
          left: { type: 'number', value: 3 },
          right: { type: 'number', value: 4 },
        },
      })
    })

    it('should respect multiplication over addition (right)', () => {
      const ast = parse(tokenize('2*3+4'))
      // Should be (2*3) + 4
      expect(ast).toEqual({
        type: 'binary',
        operator: '+',
        left: {
          type: 'binary',
          operator: '*',
          left: { type: 'number', value: 2 },
          right: { type: 'number', value: 3 },
        },
        right: { type: 'number', value: 4 },
      })
    })

    it('should respect power over multiplication', () => {
      const ast = parse(tokenize('2*3^2'))
      // Should be 2 * (3^2)
      expect(ast).toEqual({
        type: 'binary',
        operator: '*',
        left: { type: 'number', value: 2 },
        right: {
          type: 'binary',
          operator: '^',
          left: { type: 'number', value: 3 },
          right: { type: 'number', value: 2 },
        },
      })
    })

    it('should respect parentheses override precedence', () => {
      const ast = parse(tokenize('(2+3)*4'))
      expect(ast).toEqual({
        type: 'binary',
        operator: '*',
        left: {
          type: 'binary',
          operator: '+',
          left: { type: 'number', value: 2 },
          right: { type: 'number', value: 3 },
        },
        right: { type: 'number', value: 4 },
      })
    })
  })

  describe('unary operators', () => {
    it('should parse unary minus', () => {
      const ast = parse(tokenize('-5'))
      expect(ast).toEqual({
        type: 'unary',
        operator: '-',
        operand: { type: 'number', value: 5 },
      })
    })

    it('should parse unary plus', () => {
      const ast = parse(tokenize('+5'))
      expect(ast).toEqual({
        type: 'unary',
        operator: '+',
        operand: { type: 'number', value: 5 },
      })
    })

    it('should parse double negation', () => {
      const ast = parse(tokenize('--5'))
      expect(ast).toEqual({
        type: 'unary',
        operator: '-',
        operand: {
          type: 'unary',
          operator: '-',
          operand: { type: 'number', value: 5 },
        },
      })
    })
  })

  describe('function calls', () => {
    it('should parse sqrt function', () => {
      const ast = parse(tokenize('sqrt(16)'))
      expect(ast).toEqual({
        type: 'call',
        name: 'sqrt',
        args: [{ type: 'number', value: 16 }],
      })
    })

    it('should parse bc s (sin) function', () => {
      const ast = parse(tokenize('s(0)'))
      expect(ast).toEqual({
        type: 'call',
        name: 's',
        args: [{ type: 'number', value: 0 }],
      })
    })

    it('should parse function with expression argument', () => {
      const ast = parse(tokenize('sqrt(2+2)'))
      expect(ast).toEqual({
        type: 'call',
        name: 'sqrt',
        args: [
          {
            type: 'binary',
            operator: '+',
            left: { type: 'number', value: 2 },
            right: { type: 'number', value: 2 },
          },
        ],
      })
    })
  })

  describe('variable assignments', () => {
    it('should parse variable assignment', () => {
      const ast = parse(tokenize('x=5'))
      expect(ast).toEqual({
        type: 'assign',
        name: 'x',
        value: { type: 'number', value: 5 },
      })
    })

    it('should parse scale assignment', () => {
      const ast = parse(tokenize('scale=2'))
      expect(ast).toEqual({
        type: 'assign',
        name: 'scale',
        value: { type: 'number', value: 2 },
      })
    })
  })

  describe('multiple statements', () => {
    it('should parse semicolon-separated statements', () => {
      const ast = parse(tokenize('x=5; x*2'))
      expect(ast).toEqual({
        type: 'statements',
        body: [
          {
            type: 'assign',
            name: 'x',
            value: { type: 'number', value: 5 },
          },
          {
            type: 'binary',
            operator: '*',
            left: { type: 'identifier', name: 'x' },
            right: { type: 'number', value: 2 },
          },
        ],
      })
    })
  })
})

// ============================================================================
// EVALUATOR TESTS
// ============================================================================

describe('Evaluator', () => {
  describe('basic arithmetic', () => {
    it('should evaluate addition', () => {
      expect(evaluate(parse(tokenize('2+3')))).toBe(5)
    })

    it('should evaluate subtraction', () => {
      expect(evaluate(parse(tokenize('10-3')))).toBe(7)
    })

    it('should evaluate multiplication', () => {
      expect(evaluate(parse(tokenize('6*7')))).toBe(42)
    })

    it('should evaluate integer division', () => {
      expect(evaluate(parse(tokenize('10/3')))).toBe(3)
    })

    it('should evaluate modulo', () => {
      expect(evaluate(parse(tokenize('17%5')))).toBe(2)
    })

    it('should evaluate power', () => {
      expect(evaluate(parse(tokenize('2^10')))).toBe(1024)
    })

    it('should evaluate power of zero', () => {
      expect(evaluate(parse(tokenize('5^0')))).toBe(1)
    })

    it('should evaluate negative numbers', () => {
      expect(evaluate(parse(tokenize('-5+3')))).toBe(-2)
    })

    it('should respect operator precedence', () => {
      expect(evaluate(parse(tokenize('2+3*4')))).toBe(14)
    })

    it('should respect parentheses', () => {
      expect(evaluate(parse(tokenize('(2+3)*4')))).toBe(20)
    })

    it('should handle complex expression', () => {
      expect(evaluate(parse(tokenize('2+3*4-5')))).toBe(9)
    })
  })

  describe('decimal precision with scale', () => {
    it('should use scale for decimal division', () => {
      const result = safeEval('scale=2; 10/3')
      expect(result).toBe('3.33')
    })

    it('should handle higher precision', () => {
      const result = safeEval('scale=10; 1/7')
      expect(result).toBe('.1428571428')
    })

    it('should handle scale=0 for integer math', () => {
      const result = safeEval('scale=0; 10/3')
      expect(result).toBe('3')
    })
  })

  describe('negative exponents with scale', () => {
    it('should handle negative exponents', () => {
      const result = safeEval('scale=4; 2^-2')
      expect(result).toBe('.2500')
    })
  })

  describe('math library functions (-l)', () => {
    it('should calculate sqrt', () => {
      const result = safeEval('sqrt(16)', { mathLib: true })
      expect(parseFloat(result)).toBeCloseTo(4.0, 5)
    })

    it('should calculate sin (s)', () => {
      const result = safeEval('s(0)', { mathLib: true })
      expect(parseFloat(result)).toBeCloseTo(0, 5)
    })

    it('should calculate cos (c)', () => {
      const result = safeEval('c(0)', { mathLib: true })
      expect(parseFloat(result)).toBeCloseTo(1, 5)
    })

    it('should calculate atan (a)', () => {
      const result = safeEval('a(1)', { mathLib: true })
      // atan(1) = pi/4 = 0.785398...
      expect(parseFloat(result)).toBeCloseTo(0.785398, 4)
    })

    it('should calculate natural log (l)', () => {
      const result = safeEval('l(2.71828)', { mathLib: true })
      expect(parseFloat(result)).toBeCloseTo(1, 2)
    })

    it('should calculate e^x (e)', () => {
      const result = safeEval('e(1)', { mathLib: true })
      expect(parseFloat(result)).toBeCloseTo(2.71828, 4)
    })
  })

  describe('base conversion', () => {
    it('should convert hex to decimal (ibase=16)', () => {
      const result = safeEval('ibase=16; FF')
      expect(result).toBe('255')
    })

    it('should convert binary to decimal (ibase=2)', () => {
      const result = safeEval('ibase=2; 1010')
      expect(result).toBe('10')
    })

    it('should output in binary (obase=2)', () => {
      const result = safeEval('obase=2; 10')
      expect(result).toBe('1010')
    })

    it('should output in hex (obase=16)', () => {
      const result = safeEval('obase=16; 255')
      expect(result).toBe('FF')
    })

    it('should handle hex to binary', () => {
      const result = safeEval('ibase=16; obase=2; A')
      expect(result).toBe('1010')
    })
  })

  describe('variables', () => {
    it('should support variable assignment and use', () => {
      const result = safeEval('x=5; x*2')
      expect(result).toBe('10')
    })

    it('should support multiple variables', () => {
      const result = safeEval('a=3; b=4; a+b')
      expect(result).toBe('7')
    })
  })

  describe('error handling', () => {
    it('should error on division by zero', () => {
      expect(() => safeEval('1/0')).toThrow(SafeExprError)
      expect(() => safeEval('1/0')).toThrow(/divide by zero/i)
    })

    it('should error on syntax errors', () => {
      expect(() => safeEval('2++2')).toThrow(SafeExprError)
    })

    it('should error on sqrt of negative', () => {
      expect(() => safeEval('sqrt(-1)', { mathLib: true })).toThrow(SafeExprError)
    })

    it('should error on undefined variable', () => {
      expect(() => safeEval('y*2')).toThrow(SafeExprError)
    })
  })
})

// ============================================================================
// SECURITY TESTS - INJECTION PREVENTION
// ============================================================================

describe('Security - Injection Prevention', () => {
  describe('JavaScript code injection', () => {
    it('should reject process.exit()', () => {
      expect(() => safeEval('process.exit()')).toThrow(SafeExprError)
    })

    it('should reject require()', () => {
      expect(() => safeEval('require("fs")')).toThrow(SafeExprError)
    })

    it('should reject import()', () => {
      expect(() => safeEval('import("fs")')).toThrow(SafeExprError)
    })

    it('should reject eval()', () => {
      expect(() => safeEval('eval("1+1")')).toThrow(SafeExprError)
    })

    it('should reject Function constructor', () => {
      expect(() => safeEval('Function("return 1")')).toThrow(SafeExprError)
    })

    it('should reject constructor access', () => {
      expect(() => safeEval('(1).constructor.constructor("return 1")()')).toThrow(SafeExprError)
    })

    it('should reject __proto__ access', () => {
      expect(() => safeEval('(1).__proto__')).toThrow(SafeExprError)
    })

    it('should reject prototype access', () => {
      expect(() => safeEval('Object.prototype')).toThrow(SafeExprError)
    })

    it('should reject globalThis', () => {
      expect(() => safeEval('globalThis.process')).toThrow(SafeExprError)
    })

    it('should reject window', () => {
      expect(() => safeEval('window.location')).toThrow(SafeExprError)
    })

    it('should reject this', () => {
      expect(() => safeEval('this.constructor')).toThrow(SafeExprError)
    })

    it('should reject console', () => {
      expect(() => safeEval('console.log("pwned")')).toThrow(SafeExprError)
    })
  })

  describe('shell injection', () => {
    it('should reject backticks', () => {
      expect(() => safeEval('`cat /etc/passwd`')).toThrow(SafeExprError)
    })

    it('should reject $() command substitution', () => {
      expect(() => safeEval('$(cat /etc/passwd)')).toThrow(SafeExprError)
    })

    it('should reject semicolon command chaining (outside bc syntax)', () => {
      // Semicolons in bc are valid for separating statements
      // But shell-style injection should be caught
      expect(() => safeEval('1; rm -rf /')).toThrow(SafeExprError)
    })

    it('should reject pipe operators', () => {
      expect(() => safeEval('1 | cat')).toThrow(SafeExprError)
    })

    it('should reject && chaining', () => {
      expect(() => safeEval('1 && rm -rf /')).toThrow(SafeExprError)
    })

    it('should reject || chaining', () => {
      expect(() => safeEval('1 || rm -rf /')).toThrow(SafeExprError)
    })
  })

  describe('sneaky injection attempts', () => {
    it('should reject unicode escapes for process', () => {
      expect(() => safeEval('\\u0070rocess.exit()')).toThrow(SafeExprError)
    })

    it('should reject hex escapes', () => {
      expect(() => safeEval('\\x70rocess.exit()')).toThrow(SafeExprError)
    })

    it('should reject comments with injection', () => {
      expect(() => safeEval('1 /* */ + process.exit()')).toThrow(SafeExprError)
    })

    it('should reject line comments with injection', () => {
      expect(() => safeEval('1 // process.exit()')).toThrow(SafeExprError)
    })

    it('should reject array access notation', () => {
      expect(() => safeEval('(1)["constructor"]')).toThrow(SafeExprError)
    })

    it('should reject template literals', () => {
      expect(() => safeEval('`${process.exit()}`')).toThrow(SafeExprError)
    })

    it('should reject arrow functions', () => {
      expect(() => safeEval('() => process.exit()')).toThrow(SafeExprError)
    })

    it('should reject class definition', () => {
      expect(() => safeEval('class X {}')).toThrow(SafeExprError)
    })

    it('should reject async functions', () => {
      expect(() => safeEval('async function x() {}')).toThrow(SafeExprError)
    })

    it('should reject await', () => {
      expect(() => safeEval('await fetch("http://evil.com")')).toThrow(SafeExprError)
    })

    it('should reject new keyword', () => {
      expect(() => safeEval('new Function("return 1")')).toThrow(SafeExprError)
    })

    it('should reject throw keyword', () => {
      expect(() => safeEval('throw new Error()')).toThrow(SafeExprError)
    })

    it('should reject typeof exploitation', () => {
      // typeof is sometimes used in injection attacks
      expect(() => safeEval('typeof process !== "undefined" && process.exit()')).toThrow(SafeExprError)
    })

    it('should reject Object.keys() access', () => {
      expect(() => safeEval('Object.keys(process.env)')).toThrow(SafeExprError)
    })

    it('should reject JSON access', () => {
      expect(() => safeEval('JSON.stringify(process.env)')).toThrow(SafeExprError)
    })

    it('should reject Reflect API', () => {
      expect(() => safeEval('Reflect.get(process, "env")')).toThrow(SafeExprError)
    })

    it('should reject Proxy creation', () => {
      expect(() => safeEval('new Proxy({}, {})')).toThrow(SafeExprError)
    })

    it('should reject Symbol access', () => {
      expect(() => safeEval('Symbol.iterator')).toThrow(SafeExprError)
    })
  })

  describe('valid bc expressions should work', () => {
    it('should allow scale=2; 10/3', () => {
      const result = safeEval('scale=2; 10/3')
      expect(result).toBe('3.33')
    })

    it('should allow complex arithmetic', () => {
      const result = safeEval('(2+3)*4-5')
      expect(result).toBe('15')
    })

    it('should allow variable chains', () => {
      const result = safeEval('a=5; b=a*2; b+3')
      expect(result).toBe('13')
    })

    it('should allow math functions', () => {
      const result = safeEval('sqrt(16)', { mathLib: true })
      expect(parseFloat(result)).toBe(4)
    })

    it('should allow base conversion', () => {
      const result = safeEval('ibase=16; FF')
      expect(result).toBe('255')
    })

    it('should allow power operations', () => {
      const result = safeEval('2^10')
      expect(result).toBe('1024')
    })
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Performance', () => {
  it('should evaluate simple expression in under 1ms', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      safeEval('2+2')
    }
    const elapsed = performance.now() - start
    const perOp = elapsed / 100
    expect(perOp).toBeLessThan(1)
  })

  it('should evaluate complex expression in under 1ms', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      safeEval('((2+3)*4-5)/2^3')
    }
    const elapsed = performance.now() - start
    const perOp = elapsed / 100
    expect(perOp).toBeLessThan(1)
  })

  it('should evaluate with scale in under 1ms', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      safeEval('scale=10; 22/7')
    }
    const elapsed = performance.now() - start
    const perOp = elapsed / 100
    expect(perOp).toBeLessThan(1)
  })

  it('should evaluate with variables in under 1ms', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      safeEval('x=5; y=10; x*y+x-y')
    }
    const elapsed = performance.now() - start
    const perOp = elapsed / 100
    expect(perOp).toBeLessThan(1)
  })

  it('should reject injection attempts quickly (under 1ms)', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      try {
        safeEval('process.exit()')
      } catch {
        // Expected
      }
    }
    const elapsed = performance.now() - start
    const perOp = elapsed / 100
    expect(perOp).toBeLessThan(1)
  })
})

// ============================================================================
// INTEGRATION WITH safeEval() FUNCTION
// ============================================================================

describe('safeEval() integration', () => {
  describe('bc compatibility', () => {
    it('should handle echo "2+2" | bc style input', () => {
      const result = safeEval('2+2')
      expect(result).toBe('4')
    })

    it('should output trailing newline stripped', () => {
      // safeEval returns string without trailing newline for consistency
      const result = safeEval('42')
      expect(result).toBe('42')
      expect(result.endsWith('\n')).toBe(false)
    })

    it('should handle multi-line input', () => {
      const result = safeEval('x=10\nx+5')
      expect(result).toBe('15')
    })
  })

  describe('bc output formatting', () => {
    it('should format negative results correctly', () => {
      const result = safeEval('-5+3')
      expect(result).toBe('-2')
    })

    it('should format zero correctly', () => {
      const result = safeEval('5-5')
      expect(result).toBe('0')
    })

    it('should format decimals with leading zero removed (bc style)', () => {
      const result = safeEval('scale=2; 1/4')
      expect(result).toBe('.25')
    })

    it('should format large numbers correctly', () => {
      const result = safeEval('2^20')
      expect(result).toBe('1048576')
    })
  })
})
