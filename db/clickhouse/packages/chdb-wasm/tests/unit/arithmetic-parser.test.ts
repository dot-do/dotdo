/**
 * Unit Tests: Arithmetic Parser Module
 *
 * Comprehensive tests for the safe arithmetic parser that was extracted
 * from http-query-handler.ts as part of the security refactoring.
 *
 * This test suite covers:
 * 1. Tokenization of arithmetic expressions
 * 2. Parsing and evaluation of expressions
 * 3. Operator precedence
 * 4. Variable substitution
 * 5. Security cases (no code execution)
 * 6. Edge cases and error handling
 *
 * @see src/utils/arithmetic-parser.ts
 */

import { describe, it, expect } from 'vitest';
import {
  tokenizeArithmetic,
  ArithmeticParser,
  evaluateArithmetic,
  evaluateArithmeticInteger,
  isValidArithmeticExpression,
  getExpressionVariables,
  type ArithmeticToken,
  type ArithmeticContext,
} from '../../src/utils/arithmetic-parser';

// =============================================================================
// Tokenizer Tests
// =============================================================================

describe('tokenizeArithmetic', () => {
  describe('numeric literals', () => {
    it('should tokenize integers', () => {
      const tokens = tokenizeArithmetic('42');
      expect(tokens).toEqual([
        { type: 'number', value: 42 },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize decimals', () => {
      const tokens = tokenizeArithmetic('3.14');
      expect(tokens).toEqual([
        { type: 'number', value: 3.14 },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize decimals starting with dot', () => {
      const tokens = tokenizeArithmetic('.5');
      expect(tokens).toEqual([
        { type: 'number', value: 0.5 },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize multiple numbers', () => {
      const tokens = tokenizeArithmetic('1 2 3');
      expect(tokens.filter(t => t.type === 'number')).toHaveLength(3);
    });

    it('should tokenize zero', () => {
      const tokens = tokenizeArithmetic('0');
      expect(tokens).toEqual([
        { type: 'number', value: 0 },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize negative-looking expressions (unary minus)', () => {
      const tokens = tokenizeArithmetic('-5');
      expect(tokens).toEqual([
        { type: 'operator', value: '-' },
        { type: 'number', value: 5 },
        { type: 'end', value: '' },
      ]);
    });
  });

  describe('operators', () => {
    it('should tokenize addition', () => {
      const tokens = tokenizeArithmetic('2 + 3');
      expect(tokens).toEqual([
        { type: 'number', value: 2 },
        { type: 'operator', value: '+' },
        { type: 'number', value: 3 },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize subtraction', () => {
      const tokens = tokenizeArithmetic('5 - 2');
      expect(tokens[1]).toEqual({ type: 'operator', value: '-' });
    });

    it('should tokenize multiplication', () => {
      const tokens = tokenizeArithmetic('3 * 4');
      expect(tokens[1]).toEqual({ type: 'operator', value: '*' });
    });

    it('should tokenize division', () => {
      const tokens = tokenizeArithmetic('10 / 2');
      expect(tokens[1]).toEqual({ type: 'operator', value: '/' });
    });

    it('should tokenize modulo', () => {
      const tokens = tokenizeArithmetic('17 % 5');
      expect(tokens[1]).toEqual({ type: 'operator', value: '%' });
    });

    it('should tokenize all operators in sequence', () => {
      const tokens = tokenizeArithmetic('1 + 2 - 3 * 4 / 5 % 6');
      const operators = tokens.filter(t => t.type === 'operator');
      expect(operators.map(t => t.value)).toEqual(['+', '-', '*', '/', '%']);
    });
  });

  describe('parentheses', () => {
    it('should tokenize left parenthesis', () => {
      const tokens = tokenizeArithmetic('(2)');
      expect(tokens[0]).toEqual({ type: 'lparen', value: '(' });
    });

    it('should tokenize right parenthesis', () => {
      const tokens = tokenizeArithmetic('(2)');
      expect(tokens[2]).toEqual({ type: 'rparen', value: ')' });
    });

    it('should tokenize nested parentheses', () => {
      const tokens = tokenizeArithmetic('((1 + 2))');
      const lparens = tokens.filter(t => t.type === 'lparen');
      const rparens = tokens.filter(t => t.type === 'rparen');
      expect(lparens).toHaveLength(2);
      expect(rparens).toHaveLength(2);
    });
  });

  describe('identifiers', () => {
    it('should tokenize simple identifier', () => {
      const tokens = tokenizeArithmetic('x');
      expect(tokens).toEqual([
        { type: 'identifier', value: 'x' },
        { type: 'end', value: '' },
      ]);
    });

    it('should tokenize identifier with numbers', () => {
      const tokens = tokenizeArithmetic('var1');
      expect(tokens[0]).toEqual({ type: 'identifier', value: 'var1' });
    });

    it('should tokenize identifier with underscores', () => {
      const tokens = tokenizeArithmetic('my_variable');
      expect(tokens[0]).toEqual({ type: 'identifier', value: 'my_variable' });
    });

    it('should tokenize identifier starting with underscore', () => {
      const tokens = tokenizeArithmetic('_private');
      expect(tokens[0]).toEqual({ type: 'identifier', value: '_private' });
    });

    it('should tokenize multiple identifiers', () => {
      const tokens = tokenizeArithmetic('price * quantity');
      expect(tokens).toEqual([
        { type: 'identifier', value: 'price' },
        { type: 'operator', value: '*' },
        { type: 'identifier', value: 'quantity' },
        { type: 'end', value: '' },
      ]);
    });
  });

  describe('whitespace handling', () => {
    it('should skip spaces', () => {
      const tokens1 = tokenizeArithmetic('2+3');
      const tokens2 = tokenizeArithmetic('2 + 3');
      const tokens3 = tokenizeArithmetic('  2   +   3  ');

      // All should produce the same tokens
      expect(tokens1).toEqual(tokens2);
      expect(tokens2).toEqual(tokens3);
    });

    it('should skip tabs', () => {
      const tokens = tokenizeArithmetic('2\t+\t3');
      expect(tokens).toHaveLength(4); // 2, +, 3, end
    });

    it('should skip newlines', () => {
      const tokens = tokenizeArithmetic('2\n+\n3');
      expect(tokens).toHaveLength(4);
    });
  });

  describe('invalid input', () => {
    it('should return empty array for unknown characters', () => {
      expect(tokenizeArithmetic('2 @ 3')).toEqual([]);
      expect(tokenizeArithmetic('2 $ 3')).toEqual([]);
      expect(tokenizeArithmetic('2 & 3')).toEqual([]);
      expect(tokenizeArithmetic('2 # 3')).toEqual([]);
    });

    it('should return empty array for invalid operators', () => {
      expect(tokenizeArithmetic('2 ^ 3')).toEqual([]);
      expect(tokenizeArithmetic('2 | 3')).toEqual([]);
      expect(tokenizeArithmetic('2 ~ 3')).toEqual([]);
    });

    it('should return empty array for brackets (not parens)', () => {
      expect(tokenizeArithmetic('[1]')).toEqual([]);
      expect(tokenizeArithmetic('{1}')).toEqual([]);
    });
  });

  describe('complex expressions', () => {
    it('should tokenize complex mathematical expression', () => {
      // (price * quantity) - (discount * 0.1)
      // Tokens: ( price * quantity ) - ( discount * 0.1 ) = 11 tokens
      const tokens = tokenizeArithmetic('(price * quantity) - (discount * 0.1)');
      expect(tokens.filter(t => t.type !== 'end')).toHaveLength(11);
    });

    it('should tokenize expression with all token types', () => {
      const tokens = tokenizeArithmetic('(a + 1) * (b - 2.5)');
      const types = new Set(tokens.map(t => t.type));
      expect(types).toContain('number');
      expect(types).toContain('operator');
      expect(types).toContain('lparen');
      expect(types).toContain('rparen');
      expect(types).toContain('identifier');
      expect(types).toContain('end');
    });
  });
});

// =============================================================================
// Parser Tests
// =============================================================================

describe('ArithmeticParser', () => {
  const parse = (expr: string, context: ArithmeticContext = {}): number | null => {
    const tokens = tokenizeArithmetic(expr);
    if (tokens.length === 0) return null;
    const parser = new ArithmeticParser(tokens, context);
    const result = parser.parseExpression();
    // Verify all tokens were consumed (no trailing garbage)
    if (result !== null && !parser.isComplete()) return null;
    return result;
  };

  describe('basic arithmetic', () => {
    it('should parse single number', () => {
      expect(parse('42')).toBe(42);
    });

    it('should parse addition', () => {
      expect(parse('2 + 3')).toBe(5);
    });

    it('should parse subtraction', () => {
      expect(parse('10 - 3')).toBe(7);
    });

    it('should parse multiplication', () => {
      expect(parse('4 * 5')).toBe(20);
    });

    it('should parse division', () => {
      expect(parse('20 / 4')).toBe(5);
    });

    it('should parse modulo', () => {
      expect(parse('17 % 5')).toBe(2);
    });

    it('should parse decimal results', () => {
      expect(parse('7 / 2')).toBe(3.5);
    });
  });

  describe('operator precedence', () => {
    it('should multiply before add', () => {
      expect(parse('2 + 3 * 4')).toBe(14); // 2 + (3*4) = 14
    });

    it('should divide before subtract', () => {
      expect(parse('10 - 8 / 2')).toBe(6); // 10 - (8/2) = 6
    });

    it('should handle modulo with same precedence as multiply', () => {
      expect(parse('10 + 17 % 5')).toBe(12); // 10 + (17%5) = 12
    });

    it('should evaluate left to right for same precedence', () => {
      expect(parse('10 - 3 - 2')).toBe(5); // (10-3) - 2 = 5
      expect(parse('20 / 4 / 2')).toBe(2.5); // (20/4) / 2 = 2.5
    });

    it('should handle complex precedence chains', () => {
      expect(parse('2 + 3 * 4 - 5 / 2')).toBe(11.5); // 2 + 12 - 2.5 = 11.5
    });
  });

  describe('parentheses', () => {
    it('should override precedence with parentheses', () => {
      expect(parse('(2 + 3) * 4')).toBe(20); // 5 * 4 = 20
    });

    it('should handle nested parentheses', () => {
      expect(parse('((2 + 3) * 4)')).toBe(20);
    });

    it('should handle multiple parenthesized groups', () => {
      expect(parse('(1 + 2) * (3 + 4)')).toBe(21); // 3 * 7 = 21
    });

    it('should handle deeply nested parentheses', () => {
      expect(parse('(((1 + 2)))')).toBe(3);
    });

    it('should return null for mismatched parentheses', () => {
      expect(parse('(2 + 3')).toBeNull();
      expect(parse('2 + 3)')).toBeNull();
      expect(parse('((2 + 3)')).toBeNull();
    });
  });

  describe('unary operators', () => {
    it('should handle unary minus', () => {
      expect(parse('-5')).toBe(-5);
    });

    it('should handle unary minus in expression', () => {
      expect(parse('3 + -2')).toBe(1);
    });

    it('should handle unary plus', () => {
      expect(parse('+5')).toBe(5);
    });

    it('should handle double unary minus', () => {
      expect(parse('--5')).toBe(5);
    });

    it('should handle unary minus on parenthesized expression', () => {
      expect(parse('-(2 + 3)')).toBe(-5);
    });

    it('should handle unary operators with multiplication', () => {
      expect(parse('2 * -3')).toBe(-6);
    });
  });

  describe('variable substitution', () => {
    it('should resolve single variable', () => {
      expect(parse('x', { x: 10 })).toBe(10);
    });

    it('should resolve multiple variables', () => {
      expect(parse('x + y', { x: 5, y: 3 })).toBe(8);
    });

    it('should handle complex expression with variables', () => {
      expect(parse('price * quantity', { price: 10, quantity: 5 })).toBe(50);
    });

    it('should handle variables mixed with numbers', () => {
      expect(parse('x * 2 + 1', { x: 5 })).toBe(11);
    });

    it('should return null for undefined variable', () => {
      expect(parse('x + y', { x: 5 })).toBeNull();
    });

    it('should return null for null variable value', () => {
      // Note: TypeScript prevents this, but testing runtime behavior
      const context = { x: 5 } as ArithmeticContext;
      // @ts-expect-error Testing runtime behavior
      context.y = null;
      expect(parse('x + y', context)).toBeNull();
    });
  });

  describe('division by zero', () => {
    it('should return null for division by zero', () => {
      expect(parse('10 / 0')).toBeNull();
    });

    it('should return null for modulo by zero', () => {
      expect(parse('10 % 0')).toBeNull();
    });

    it('should return null for division by zero variable', () => {
      expect(parse('x / y', { x: 10, y: 0 })).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle zero', () => {
      expect(parse('0')).toBe(0);
      expect(parse('0 + 0')).toBe(0);
      expect(parse('5 * 0')).toBe(0);
    });

    it('should handle negative results', () => {
      expect(parse('3 - 5')).toBe(-2);
    });

    it('should handle very small decimals', () => {
      expect(parse('0.001 + 0.001')).toBeCloseTo(0.002);
    });

    it('should handle large numbers', () => {
      expect(parse('1000000 * 1000000')).toBe(1000000000000);
    });
  });
});

// =============================================================================
// High-Level API Tests
// =============================================================================

describe('evaluateArithmetic', () => {
  it('should evaluate simple expression', () => {
    expect(evaluateArithmetic('2 + 3')).toBe(5);
  });

  it('should evaluate with context', () => {
    expect(evaluateArithmetic('x * 2', { x: 5 })).toBe(10);
  });

  it('should return null for empty expression', () => {
    expect(evaluateArithmetic('')).toBeNull();
    expect(evaluateArithmetic('   ')).toBeNull();
  });

  it('should return null for invalid expression', () => {
    expect(evaluateArithmetic('2 @ 3')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(evaluateArithmetic('  2 + 3  ')).toBe(5);
  });

  it('should return null for Infinity results', () => {
    // This would require a very specific case - large number operations
    // The parser handles division by zero, so Infinity shouldn't occur easily
    expect(evaluateArithmetic('1 / 0')).toBeNull();
  });
});

describe('evaluateArithmeticInteger', () => {
  it('should floor the result', () => {
    expect(evaluateArithmeticInteger('7 / 2')).toBe(3); // 3.5 -> 3
  });

  it('should floor negative results', () => {
    expect(evaluateArithmeticInteger('-7 / 2')).toBe(-4); // -3.5 -> -4 (floor)
  });

  it('should return exact integer for whole numbers', () => {
    expect(evaluateArithmeticInteger('10 / 2')).toBe(5);
  });

  it('should return null for invalid expression', () => {
    expect(evaluateArithmeticInteger('invalid')).toBeNull();
  });
});

describe('isValidArithmeticExpression', () => {
  it('should return true for valid expressions', () => {
    expect(isValidArithmeticExpression('2 + 3')).toBe(true);
    expect(isValidArithmeticExpression('x * y')).toBe(true);
    expect(isValidArithmeticExpression('(1 + 2) * 3')).toBe(true);
  });

  it('should return false for invalid syntax', () => {
    expect(isValidArithmeticExpression('2 + +')).toBe(false);
    expect(isValidArithmeticExpression('(2 + 3')).toBe(false);
    expect(isValidArithmeticExpression('')).toBe(false);
  });

  it('should return false for invalid characters', () => {
    expect(isValidArithmeticExpression('2 @ 3')).toBe(false);
  });

  it('should return false for forbidden identifiers', () => {
    expect(isValidArithmeticExpression('constructor')).toBe(false);
    expect(isValidArithmeticExpression('__proto__')).toBe(false);
  });
});

describe('getExpressionVariables', () => {
  it('should extract variables from expression', () => {
    const vars = getExpressionVariables('price * quantity + tax');
    expect(vars).toEqual(['price', 'quantity', 'tax']);
  });

  it('should return empty array for numeric-only expression', () => {
    expect(getExpressionVariables('2 + 3 * 4')).toEqual([]);
  });

  it('should not duplicate variables', () => {
    const vars = getExpressionVariables('x + x + x');
    expect(vars).toEqual(['x']);
  });

  it('should return empty array for invalid expression', () => {
    expect(getExpressionVariables('2 @ 3')).toEqual([]);
  });
});

// =============================================================================
// Security Tests
// =============================================================================

describe('Security: Prototype Pollution Prevention', () => {
  it('should reject constructor identifier', () => {
    expect(evaluateArithmetic('constructor', { constructor: 42 })).toBeNull();
  });

  it('should reject __proto__ identifier', () => {
    expect(evaluateArithmetic('__proto__', { __proto__: 42 })).toBeNull();
  });

  it('should reject prototype identifier', () => {
    expect(evaluateArithmetic('prototype', { prototype: 42 })).toBeNull();
  });

  it('should reject toString identifier', () => {
    expect(evaluateArithmetic('toString', { toString: 42 })).toBeNull();
  });

  it('should reject valueOf identifier', () => {
    expect(evaluateArithmetic('valueOf', { valueOf: 42 })).toBeNull();
  });

  it('should reject __defineGetter__', () => {
    expect(evaluateArithmetic('__defineGetter__', { __defineGetter__: 42 })).toBeNull();
  });

  it('should reject __defineSetter__', () => {
    expect(evaluateArithmetic('__defineSetter__', { __defineSetter__: 42 })).toBeNull();
  });

  it('should reject __lookupGetter__', () => {
    expect(evaluateArithmetic('__lookupGetter__', { __lookupGetter__: 42 })).toBeNull();
  });

  it('should reject __lookupSetter__', () => {
    expect(evaluateArithmetic('__lookupSetter__', { __lookupSetter__: 42 })).toBeNull();
  });

  it('should reject hasOwnProperty', () => {
    expect(evaluateArithmetic('hasOwnProperty', { hasOwnProperty: 42 })).toBeNull();
  });

  it('should reject forbidden identifiers in expressions', () => {
    expect(evaluateArithmetic('x + constructor', { x: 1, constructor: 2 })).toBeNull();
  });
});

describe('Security: No Code Execution', () => {
  it('should not execute function calls', () => {
    // alert(1) tokenizes as: identifier('alert'), lparen, number(1), rparen, end
    // This is valid tokenization, but parsing should fail because:
    // 1. 'alert' is an undefined variable (no context provided)
    // 2. Even if alert were defined, parentheses after an identifier don't form valid arithmetic
    const tokens = tokenizeArithmetic('alert(1)');
    expect(tokens).not.toEqual([]); // It tokenizes successfully
    expect(tokens[0]).toEqual({ type: 'identifier', value: 'alert' });

    // But evaluation should fail because the parser doesn't support function calls -
    // it will parse 'alert' as identifier, then fail with unconsumed '(1)' tokens
    const result = evaluateArithmetic('alert(1)', { alert: 5 });
    expect(result).toBeNull(); // Fails due to unconsumed tokens
  });

  it('should not allow require-like calls', () => {
    // require("fs") has quotes which are invalid characters
    expect(tokenizeArithmetic('require("fs")')).toEqual([]);
  });

  it('should not allow dot notation property access', () => {
    // console.log has a dot which is NOT followed by a digit, so it's an invalid character
    // The tokenizer will return [] when it encounters the standalone dot
    expect(tokenizeArithmetic('console.log')).toEqual([]);

    // As a result, evaluation also fails
    const result = evaluateArithmetic('console.log', {});
    expect(result).toBeNull();
  });

  it('should not execute template literals', () => {
    expect(tokenizeArithmetic('`code`')).toEqual([]); // backticks are invalid
  });

  it('should not execute object literals', () => {
    expect(tokenizeArithmetic('{}')).toEqual([]); // braces are invalid
  });

  it('should not execute array literals', () => {
    expect(tokenizeArithmetic('[]')).toEqual([]); // brackets are invalid
  });

  it('should not allow semicolons (multiple statements)', () => {
    expect(tokenizeArithmetic('1; alert(1)')).toEqual([]); // semicolon is invalid
  });

  it('should not allow comparison operators (no conditionals)', () => {
    expect(tokenizeArithmetic('1 == 1')).toEqual([]); // = is invalid
    expect(tokenizeArithmetic('1 < 2')).toEqual([]); // < is invalid
    expect(tokenizeArithmetic('1 > 2')).toEqual([]); // > is invalid
  });

  it('should not allow logical operators', () => {
    expect(tokenizeArithmetic('1 && 2')).toEqual([]); // & is invalid
    expect(tokenizeArithmetic('1 || 2')).toEqual([]); // | is invalid
    expect(tokenizeArithmetic('!1')).toEqual([]); // ! is invalid
  });

  it('should not allow bitwise operators', () => {
    expect(tokenizeArithmetic('1 & 2')).toEqual([]); // & is invalid
    expect(tokenizeArithmetic('1 | 2')).toEqual([]); // | is invalid
    expect(tokenizeArithmetic('1 ^ 2')).toEqual([]); // ^ is invalid
    expect(tokenizeArithmetic('~1')).toEqual([]); // ~ is invalid
    expect(tokenizeArithmetic('1 << 2')).toEqual([]); // < is invalid
    expect(tokenizeArithmetic('1 >> 2')).toEqual([]); // > is invalid
  });

  it('should not allow assignment operators', () => {
    expect(tokenizeArithmetic('x = 1')).toEqual([]); // = is invalid
    expect(tokenizeArithmetic('x += 1')).toEqual([]); // = is invalid
  });

  it('should not allow ternary operator', () => {
    expect(tokenizeArithmetic('1 ? 2 : 3')).toEqual([]); // ? and : are invalid
  });

  it('should not allow comma operator', () => {
    expect(tokenizeArithmetic('1, 2')).toEqual([]); // , is invalid
  });
});

describe('Security: Input Validation', () => {
  it('should handle extremely long expressions gracefully', () => {
    // Very long but valid expression
    const longExpr = Array(1000).fill('1').join(' + ');
    const result = evaluateArithmetic(longExpr);
    expect(result).toBe(1000);
  });

  it('should handle deeply nested parentheses', () => {
    const depth = 100;
    const expr = '('.repeat(depth) + '1' + ')'.repeat(depth);
    const result = evaluateArithmetic(expr);
    expect(result).toBe(1);
  });

  it('should return null for non-finite results', () => {
    // Infinity cases are prevented by division by zero check
    expect(evaluateArithmetic('1 / 0')).toBeNull();
    expect(evaluateArithmetic('1 % 0')).toBeNull();
  });

  it('should handle NaN values in context', () => {
    expect(evaluateArithmetic('x + 1', { x: NaN })).toBeNull();
  });

  it('should handle Infinity values in context', () => {
    expect(evaluateArithmetic('x + 1', { x: Infinity })).toBeNull();
    expect(evaluateArithmetic('x + 1', { x: -Infinity })).toBeNull();
  });
});

// =============================================================================
// Integration with SQL Context
// =============================================================================

describe('SQL Context Integration', () => {
  it('should evaluate column arithmetic like SQL would', () => {
    // Simulating: SELECT number % 3 FROM numbers(10)
    const rows = Array.from({ length: 10 }, (_, i) => ({ number: i }));
    const results = rows.map(row => evaluateArithmeticInteger('number % 3', row));
    expect(results).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  it('should handle complex column expressions', () => {
    // Simulating: SELECT (price * quantity) - discount FROM orders
    const order = { price: 100, quantity: 5, discount: 50 };
    const result = evaluateArithmetic('(price * quantity) - discount', order);
    expect(result).toBe(450);
  });

  it('should handle division with floored result', () => {
    // Simulating: SELECT number / 3 FROM numbers(10)
    const rows = Array.from({ length: 10 }, (_, i) => ({ number: i }));
    const results = rows.map(row => evaluateArithmeticInteger('number / 3', row));
    expect(results).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
  });

  it('should return null for missing columns', () => {
    const row = { a: 1, b: 2 };
    expect(evaluateArithmetic('a + c', row)).toBeNull(); // c is missing
  });
});
