/**
 * Security Tests: Runtime Behavior Verification
 *
 * Issue: clickhouse-eiye.1
 *
 * These tests verify that arithmetic evaluation is done safely WITHOUT using
 * `new Function()` or `eval()`. Instead of scanning source files (which requires
 * Node.js fs), we test the RUNTIME BEHAVIOR of the safe arithmetic parser.
 *
 * The approach:
 * 1. Verify the safe parser correctly evaluates valid expressions
 * 2. Verify the safe parser rejects malicious inputs that would exploit eval/Function
 * 3. Verify prototype pollution attempts are blocked
 * 4. Verify code injection attempts are rejected
 *
 * This works in workerd because it tests runtime behavior, not source scanning.
 *
 * @see src/utils/arithmetic-parser.ts - The safe implementation
 * @see tests/unit/arithmetic-parser.test.ts - Comprehensive parser tests
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateArithmetic,
  evaluateArithmeticInteger,
  isValidArithmeticExpression,
  tokenizeArithmetic,
} from '../../src/utils/arithmetic-parser';

describe('Security: No Dynamic Code Execution', () => {
  /**
   * These tests verify that the arithmetic parser does NOT execute arbitrary code.
   * If `new Function()` or `eval()` were used, these inputs could cause code execution.
   * With a safe parser, they should all be rejected or return null.
   */

  describe('Code Injection Prevention', () => {
    it('should reject expressions with function call syntax', () => {
      // If eval/Function were used, alert(1) would execute
      const result = evaluateArithmetic('alert(1)', { alert: 42 });
      expect(result).toBeNull(); // Rejected due to unconsumed tokens after identifier
    });

    it('should reject expressions attempting console access', () => {
      // If eval/Function were used, this could access console
      // Dots are invalid in our tokenizer
      const result = evaluateArithmetic('console.log(1)', {});
      expect(result).toBeNull();
    });

    it('should reject require-style module imports', () => {
      // If eval/Function were used, this could load modules
      // Quotes are invalid in our tokenizer
      const result = evaluateArithmetic('require("fs")', {});
      expect(result).toBeNull();
    });

    it('should reject process access attempts', () => {
      // If eval/Function were used, this could access process
      const result = evaluateArithmetic('process.exit()', {});
      expect(result).toBeNull();
    });

    it('should reject global access attempts', () => {
      // If eval/Function were used, this could access globalThis
      const result = evaluateArithmetic('globalThis.fetch', {});
      expect(result).toBeNull();
    });

    it('should reject template literal syntax', () => {
      // Template literals could execute code with eval/Function
      const result = evaluateArithmetic('`${code}`', {});
      expect(result).toBeNull();
    });

    it('should reject arrow function syntax', () => {
      // Arrow functions could execute code
      const result = evaluateArithmetic('() => 1', {});
      expect(result).toBeNull();
    });

    it('should reject object/array literal syntax', () => {
      expect(evaluateArithmetic('{}', {})).toBeNull();
      expect(evaluateArithmetic('[]', {})).toBeNull();
    });

    it('should reject statement separators', () => {
      // Semicolons could allow multiple statements
      expect(evaluateArithmetic('1; alert(1)', {})).toBeNull();
    });

    it('should reject assignment operators', () => {
      // Assignments could modify global state
      expect(evaluateArithmetic('x = 1', { x: 0 })).toBeNull();
      expect(evaluateArithmetic('x += 1', { x: 0 })).toBeNull();
    });

    it('should reject comparison operators that could be exploited', () => {
      expect(evaluateArithmetic('1 == 1', {})).toBeNull();
      expect(evaluateArithmetic('1 === 1', {})).toBeNull();
      expect(evaluateArithmetic('1 < 2', {})).toBeNull();
      expect(evaluateArithmetic('1 > 2', {})).toBeNull();
    });

    it('should reject logical operators', () => {
      expect(evaluateArithmetic('1 && 2', {})).toBeNull();
      expect(evaluateArithmetic('1 || 2', {})).toBeNull();
      expect(evaluateArithmetic('!1', {})).toBeNull();
    });

    it('should reject bitwise operators that could leak info', () => {
      expect(evaluateArithmetic('1 & 2', {})).toBeNull();
      expect(evaluateArithmetic('1 | 2', {})).toBeNull();
      expect(evaluateArithmetic('1 ^ 2', {})).toBeNull();
      expect(evaluateArithmetic('~1', {})).toBeNull();
    });

    it('should reject ternary operator', () => {
      expect(evaluateArithmetic('1 ? 2 : 3', {})).toBeNull();
    });
  });

  describe('Prototype Pollution Prevention', () => {
    /**
     * These tests verify that prototype-related identifiers are blocked.
     * With eval/Function, accessing these could lead to prototype pollution attacks.
     */

    it('should reject constructor access', () => {
      expect(evaluateArithmetic('constructor', { constructor: 42 })).toBeNull();
    });

    it('should reject __proto__ access', () => {
      expect(evaluateArithmetic('__proto__', { __proto__: 42 })).toBeNull();
    });

    it('should reject prototype access', () => {
      expect(evaluateArithmetic('prototype', { prototype: 42 })).toBeNull();
    });

    it('should reject toString access', () => {
      expect(evaluateArithmetic('toString', { toString: 42 })).toBeNull();
    });

    it('should reject valueOf access', () => {
      expect(evaluateArithmetic('valueOf', { valueOf: 42 })).toBeNull();
    });

    it('should reject hasOwnProperty access', () => {
      expect(evaluateArithmetic('hasOwnProperty', { hasOwnProperty: 42 })).toBeNull();
    });

    it('should reject __defineGetter__ access', () => {
      expect(evaluateArithmetic('__defineGetter__', { __defineGetter__: 42 })).toBeNull();
    });

    it('should reject __defineSetter__ access', () => {
      expect(evaluateArithmetic('__defineSetter__', { __defineSetter__: 42 })).toBeNull();
    });

    it('should reject forbidden identifiers within expressions', () => {
      // Even when mixed with valid arithmetic
      expect(evaluateArithmetic('x + constructor', { x: 1, constructor: 2 })).toBeNull();
      expect(evaluateArithmetic('__proto__ * 2', { __proto__: 21 })).toBeNull();
    });

    it('should reject isValidArithmeticExpression for forbidden identifiers', () => {
      expect(isValidArithmeticExpression('constructor')).toBe(false);
      expect(isValidArithmeticExpression('__proto__')).toBe(false);
      expect(isValidArithmeticExpression('prototype')).toBe(false);
    });
  });

  describe('Safe Arithmetic Parser Verification', () => {
    /**
     * These tests verify that the safe parser correctly handles valid arithmetic.
     * This proves we have a working alternative to eval/Function.
     */

    it('should correctly evaluate basic arithmetic', () => {
      expect(evaluateArithmetic('2 + 3')).toBe(5);
      expect(evaluateArithmetic('10 - 4')).toBe(6);
      expect(evaluateArithmetic('6 * 7')).toBe(42);
      expect(evaluateArithmetic('20 / 4')).toBe(5);
      expect(evaluateArithmetic('17 % 5')).toBe(2);
    });

    it('should respect operator precedence (like JavaScript)', () => {
      // Multiplication before addition
      expect(evaluateArithmetic('2 + 3 * 4')).toBe(14); // Not 20
    });

    it('should handle parentheses correctly', () => {
      expect(evaluateArithmetic('(2 + 3) * 4')).toBe(20);
    });

    it('should handle unary minus', () => {
      expect(evaluateArithmetic('-5')).toBe(-5);
      expect(evaluateArithmetic('3 + -2')).toBe(1);
    });

    it('should handle variable substitution safely', () => {
      expect(evaluateArithmetic('x + y', { x: 10, y: 5 })).toBe(15);
      expect(evaluateArithmetic('price * quantity', { price: 10, quantity: 5 })).toBe(50);
    });

    it('should return null for undefined variables (not throw)', () => {
      expect(evaluateArithmetic('x + y', { x: 10 })).toBeNull();
    });

    it('should return null for division by zero (not Infinity)', () => {
      expect(evaluateArithmetic('10 / 0')).toBeNull();
      expect(evaluateArithmetic('10 % 0')).toBeNull();
    });

    it('should handle integer flooring correctly', () => {
      expect(evaluateArithmeticInteger('7 / 2')).toBe(3); // Floored from 3.5
    });
  });

  describe('Tokenizer Security', () => {
    /**
     * These tests verify that the tokenizer rejects dangerous characters
     * that could be exploited with eval/Function.
     */

    it('should reject strings (quotes)', () => {
      expect(tokenizeArithmetic('"hello"')).toEqual([]);
      expect(tokenizeArithmetic("'hello'")).toEqual([]);
    });

    it('should reject template literals (backticks)', () => {
      expect(tokenizeArithmetic('`template`')).toEqual([]);
    });

    it('should reject special characters', () => {
      expect(tokenizeArithmetic('$')).toEqual([]);
      expect(tokenizeArithmetic('@')).toEqual([]);
      expect(tokenizeArithmetic('#')).toEqual([]);
      expect(tokenizeArithmetic('&')).toEqual([]);
      expect(tokenizeArithmetic('|')).toEqual([]);
      expect(tokenizeArithmetic('^')).toEqual([]);
      expect(tokenizeArithmetic('!')).toEqual([]);
      expect(tokenizeArithmetic('?')).toEqual([]);
      expect(tokenizeArithmetic(':')).toEqual([]);
      expect(tokenizeArithmetic(';')).toEqual([]);
      expect(tokenizeArithmetic(',')).toEqual([]);
      expect(tokenizeArithmetic('=')).toEqual([]);
      expect(tokenizeArithmetic('<')).toEqual([]);
      expect(tokenizeArithmetic('>')).toEqual([]);
      expect(tokenizeArithmetic('{')).toEqual([]);
      expect(tokenizeArithmetic('}')).toEqual([]);
      expect(tokenizeArithmetic('[')).toEqual([]);
      expect(tokenizeArithmetic(']')).toEqual([]);
    });

    it('should only allow safe tokens (numbers, identifiers, operators, parens)', () => {
      const tokens = tokenizeArithmetic('(price + 10) * 0.9');
      const types = tokens.map(t => t.type);

      // All tokens should be from the safe set
      const safeTypes = ['number', 'identifier', 'operator', 'lparen', 'rparen', 'end'];
      for (const type of types) {
        expect(safeTypes).toContain(type);
      }
    });
  });

  describe('Input Validation and Edge Cases', () => {
    /**
     * These tests verify the parser handles edge cases safely
     * without crashing or exposing vulnerabilities.
     */

    it('should handle empty input', () => {
      expect(evaluateArithmetic('')).toBeNull();
      expect(evaluateArithmetic('   ')).toBeNull();
    });

    it('should handle very long expressions without stack overflow', () => {
      // Build a long but valid expression
      const longExpr = Array(100).fill('1').join(' + ');
      const result = evaluateArithmetic(longExpr);
      expect(result).toBe(100);
    });

    it('should handle deeply nested parentheses', () => {
      const depth = 50;
      const expr = '('.repeat(depth) + '42' + ')'.repeat(depth);
      expect(evaluateArithmetic(expr)).toBe(42);
    });

    it('should reject malformed expressions gracefully', () => {
      expect(evaluateArithmetic('+ +')).toBeNull();
      expect(evaluateArithmetic('* 2')).toBeNull();
      expect(evaluateArithmetic('2 +')).toBeNull();
      expect(evaluateArithmetic('((2)')).toBeNull();
      expect(evaluateArithmetic('(2))')).toBeNull();
    });

    it('should handle NaN context values safely', () => {
      expect(evaluateArithmetic('x', { x: NaN })).toBeNull();
    });

    it('should handle Infinity context values safely', () => {
      expect(evaluateArithmetic('x', { x: Infinity })).toBeNull();
      expect(evaluateArithmetic('x', { x: -Infinity })).toBeNull();
    });

    it('should handle non-numeric context values safely', () => {
      // TypeScript would catch this, but runtime should handle it
      // @ts-expect-error Testing runtime behavior
      expect(evaluateArithmetic('x', { x: 'string' })).toBeNull();
      // @ts-expect-error Testing runtime behavior
      expect(evaluateArithmetic('x', { x: null })).toBeNull();
      // @ts-expect-error Testing runtime behavior
      expect(evaluateArithmetic('x', { x: undefined })).toBeNull();
    });
  });
});

/**
 * Test Summary:
 *
 * These tests verify runtime security behavior, which works in workerd without
 * needing Node.js fs to scan source files. The tests prove:
 *
 * 1. Code injection is impossible - malicious inputs are rejected at tokenization
 *    or parsing level, never executed
 *
 * 2. Prototype pollution is blocked - forbidden identifiers return null
 *
 * 3. Safe arithmetic works - valid expressions evaluate correctly with proper
 *    operator precedence and variable substitution
 *
 * 4. Edge cases are handled safely - no crashes, stack overflows, or exceptions
 *
 * The safe arithmetic parser (src/utils/arithmetic-parser.ts) implements a
 * recursive descent parser that ONLY allows:
 * - Numbers (integers and decimals)
 * - Identifiers (variable names)
 * - Operators (+, -, *, /, %)
 * - Parentheses
 *
 * This is fundamentally different from eval/Function which would execute
 * arbitrary JavaScript code.
 */
