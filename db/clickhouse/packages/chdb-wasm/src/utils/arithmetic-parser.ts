/**
 * Safe Arithmetic Parser
 *
 * A secure recursive descent parser for evaluating arithmetic expressions.
 * This implementation does NOT use `eval()` or `new Function()` - it parses
 * and evaluates expressions directly, preventing any code injection attacks.
 *
 * @module utils/arithmetic-parser
 *
 * ## Security Guarantees
 *
 * - No dynamic code execution (eval/Function)
 * - Explicit whitelist of allowed operations (+, -, *, /, %)
 * - Prototype pollution prevention (forbidden identifiers)
 * - Type-safe context variable access
 * - Safe handling of division/modulo by zero
 *
 * ## Grammar
 *
 * ```
 * expr   -> term (('+' | '-') term)*
 * term   -> factor (('*' | '/' | '%') factor)*
 * factor -> number | identifier | '(' expr ')' | '-' factor | '+' factor
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { evaluateArithmetic, ArithmeticParser, tokenizeArithmetic } from './arithmetic-parser';
 *
 * // Simple evaluation
 * const result = evaluateArithmetic('2 + 3 * 4', { x: 10 });
 *
 * // With row context
 * const value = evaluateArithmetic('price * quantity', { price: 10, quantity: 5 });
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Recursive_descent_parser
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Token types recognized by the arithmetic tokenizer.
 *
 * - `number`: Numeric literal (integer or decimal)
 * - `operator`: Arithmetic operator (+, -, *, /, %)
 * - `lparen`: Left parenthesis '('
 * - `rparen`: Right parenthesis ')'
 * - `identifier`: Variable name (column reference)
 * - `end`: End of input marker
 */
export type ArithmeticTokenType =
  | 'number'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'identifier'
  | 'end';

/**
 * Represents a single token in an arithmetic expression.
 *
 * @example
 * // Number token
 * { type: 'number', value: 42 }
 *
 * @example
 * // Operator token
 * { type: 'operator', value: '+' }
 *
 * @example
 * // Identifier token
 * { type: 'identifier', value: 'price' }
 */
export interface ArithmeticToken {
  /** The type of this token */
  type: ArithmeticTokenType;
  /** The token value - number for numeric tokens, string for all others */
  value: string | number;
}

/**
 * Context for variable resolution during expression evaluation.
 * Maps variable names (identifiers) to their numeric values.
 *
 * @example
 * const context: ArithmeticContext = {
 *   price: 10.99,
 *   quantity: 5,
 *   discount: 0.1
 * };
 */
export type ArithmeticContext = Record<string, number>;

/**
 * Result of arithmetic evaluation.
 * Returns null if the expression is invalid, contains errors, or produces non-finite results.
 */
export type ArithmeticResult = number | null;

// =============================================================================
// Constants
// =============================================================================

/**
 * Set of allowed arithmetic operators.
 * Only these characters are recognized as operators.
 */
const OPERATORS = new Set(['+', '-', '*', '/', '%']);

/**
 * Forbidden identifiers that could lead to prototype pollution or
 * other security issues if accessed through the context.
 *
 * These are explicitly blocked even if they appear in the context object.
 */
const FORBIDDEN_IDENTIFIERS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'toString',
  'valueOf',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]);

// =============================================================================
// Tokenizer
// =============================================================================

/**
 * Tokenize an arithmetic expression into a sequence of tokens.
 *
 * Supports:
 * - Numbers: integers and decimals (e.g., `42`, `3.14`, `.5`)
 * - Operators: `+`, `-`, `*`, `/`, `%`
 * - Parentheses: `(`, `)`
 * - Identifiers: variable names matching `[a-zA-Z_][a-zA-Z0-9_]*`
 *
 * Whitespace is automatically skipped.
 *
 * @param expr - The arithmetic expression to tokenize
 * @returns Array of tokens, or empty array if tokenization fails (invalid characters)
 *
 * @example
 * tokenizeArithmetic('2 + 3 * 4')
 * // Returns:
 * // [
 * //   { type: 'number', value: 2 },
 * //   { type: 'operator', value: '+' },
 * //   { type: 'number', value: 3 },
 * //   { type: 'operator', value: '*' },
 * //   { type: 'number', value: 4 },
 * //   { type: 'end', value: '' }
 * // ]
 *
 * @example
 * tokenizeArithmetic('price * quantity')
 * // Returns:
 * // [
 * //   { type: 'identifier', value: 'price' },
 * //   { type: 'operator', value: '*' },
 * //   { type: 'identifier', value: 'quantity' },
 * //   { type: 'end', value: '' }
 * // ]
 *
 * @example
 * // Invalid expression (contains @)
 * tokenizeArithmetic('2 @ 3')
 * // Returns: []
 */
export function tokenizeArithmetic(expr: string): ArithmeticToken[] {
  const tokens: ArithmeticToken[] = [];
  let pos = 0;

  while (pos < expr.length) {
    const char = expr[pos];

    // Skip whitespace
    if (/\s/.test(char)) {
      pos++;
      continue;
    }

    // Numbers (including decimals starting with .)
    if (/\d/.test(char) || (char === '.' && pos + 1 < expr.length && /\d/.test(expr[pos + 1]))) {
      let numStr = '';
      while (pos < expr.length && (/\d/.test(expr[pos]) || expr[pos] === '.')) {
        numStr += expr[pos];
        pos++;
      }
      tokens.push({ type: 'number', value: parseFloat(numStr) });
      continue;
    }

    // Operators
    if (OPERATORS.has(char)) {
      tokens.push({ type: 'operator', value: char });
      pos++;
      continue;
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      pos++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      pos++;
      continue;
    }

    // Identifiers (variable/column names)
    if (/[a-zA-Z_]/.test(char)) {
      let ident = '';
      while (pos < expr.length && /[a-zA-Z0-9_]/.test(expr[pos])) {
        ident += expr[pos];
        pos++;
      }
      tokens.push({ type: 'identifier', value: ident });
      continue;
    }

    // Unknown character - return empty array to indicate invalid expression
    return [];
  }

  // Add end-of-input marker
  tokens.push({ type: 'end', value: '' });
  return tokens;
}

// =============================================================================
// Parser
// =============================================================================

/**
 * Safe arithmetic parser using recursive descent.
 *
 * Implements the following grammar with proper operator precedence:
 *
 * ```
 * expr   -> term (('+' | '-') term)*
 * term   -> factor (('*' | '/' | '%') factor)*
 * factor -> number | identifier | '(' expr ')' | '-' factor | '+' factor
 * ```
 *
 * This class handles:
 * - Operator precedence (* / % bind tighter than + -)
 * - Unary minus and plus
 * - Parenthesized sub-expressions
 * - Variable substitution from context
 * - Division by zero (returns null)
 * - Security-forbidden identifiers (returns null)
 *
 * @example
 * const tokens = tokenizeArithmetic('2 + 3 * 4');
 * const parser = new ArithmeticParser(tokens, {});
 * const result = parser.parseExpression(); // Returns 14
 *
 * @example
 * const tokens = tokenizeArithmetic('price * (1 - discount)');
 * const parser = new ArithmeticParser(tokens, { price: 100, discount: 0.1 });
 * const result = parser.parseExpression(); // Returns 90
 */
export class ArithmeticParser {
  /** Token stream */
  private tokens: ArithmeticToken[];
  /** Current position in the token stream */
  private pos: number;
  /** Variable context for identifier resolution */
  private context: ArithmeticContext;

  /**
   * Create a new arithmetic parser.
   *
   * @param tokens - Token stream from tokenizeArithmetic()
   * @param context - Variable context mapping identifiers to numbers
   */
  constructor(tokens: ArithmeticToken[], context: ArithmeticContext) {
    this.tokens = tokens;
    this.pos = 0;
    this.context = context;
  }

  /**
   * Get the current token without advancing.
   *
   * @returns The current token, or end token if past the end
   */
  private current(): ArithmeticToken {
    return this.tokens[this.pos] || { type: 'end', value: '' };
  }

  /**
   * Get the current token and advance to the next.
   *
   * @returns The current token before advancing
   */
  private advance(): ArithmeticToken {
    const token = this.current();
    this.pos++;
    return token;
  }

  /**
   * Check if all tokens have been consumed (only 'end' token remaining).
   *
   * @returns True if parsing consumed all input tokens
   */
  isComplete(): boolean {
    return this.current().type === 'end';
  }

  /**
   * Parse and evaluate the full expression.
   *
   * This is the main entry point for parsing. Call this after constructing
   * the parser with tokens and context.
   *
   * @returns The numeric result, or null if parsing/evaluation fails
   *
   * @example
   * const tokens = tokenizeArithmetic('2 + 3');
   * const parser = new ArithmeticParser(tokens, {});
   * const result = parser.parseExpression(); // 5
   */
  parseExpression(): ArithmeticResult {
    try {
      const result = this.parseTerm();
      if (result === null) return null;

      let value = result;

      // Handle + and - at expression level (lowest precedence)
      while (
        this.current().type === 'operator' &&
        (this.current().value === '+' || this.current().value === '-')
      ) {
        const op = this.advance().value as string;
        const right = this.parseTerm();
        if (right === null) return null;

        if (op === '+') {
          value = value + right;
        } else {
          value = value - right;
        }
      }

      return value;
    } catch {
      return null;
    }
  }

  /**
   * Parse a term (handles *, /, % operators).
   *
   * Terms have higher precedence than expressions, so `2 + 3 * 4`
   * is parsed as `2 + (3 * 4)`.
   *
   * @returns The numeric result, or null if parsing fails
   */
  private parseTerm(): ArithmeticResult {
    let value = this.parseFactor();
    if (value === null) return null;

    while (
      this.current().type === 'operator' &&
      (this.current().value === '*' ||
        this.current().value === '/' ||
        this.current().value === '%')
    ) {
      const op = this.advance().value as string;
      const right = this.parseFactor();
      if (right === null) return null;

      if (op === '*') {
        value = value * right;
      } else if (op === '/') {
        if (right === 0) return null; // Division by zero
        value = value / right;
      } else {
        if (right === 0) return null; // Modulo by zero
        value = value % right;
      }
    }

    return value;
  }

  /**
   * Parse a factor (highest precedence: numbers, identifiers, parens, unary ops).
   *
   * Handles:
   * - Numeric literals
   * - Variable references
   * - Parenthesized sub-expressions
   * - Unary minus and plus
   *
   * @returns The numeric result, or null if parsing fails
   */
  private parseFactor(): ArithmeticResult {
    const token = this.current();

    // Unary minus
    if (token.type === 'operator' && token.value === '-') {
      this.advance();
      const factor = this.parseFactor();
      if (factor === null) return null;
      return -factor;
    }

    // Unary plus (just skip it)
    if (token.type === 'operator' && token.value === '+') {
      this.advance();
      return this.parseFactor();
    }

    // Number literal
    if (token.type === 'number') {
      this.advance();
      return token.value as number;
    }

    // Identifier (variable/column reference)
    if (token.type === 'identifier') {
      this.advance();
      const ident = token.value as string;

      // Security: reject any prototype-related identifiers
      if (FORBIDDEN_IDENTIFIERS.has(ident)) {
        return null;
      }

      const value = this.context[ident];
      if (value === undefined || value === null) return null;
      if (typeof value !== 'number') return null;
      if (!isFinite(value)) return null;
      return value;
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.advance(); // consume '('
      const value = this.parseExpression();
      if (value === null) return null;

      if (this.current().type !== 'rparen') {
        return null; // Mismatched parentheses
      }
      this.advance(); // consume ')'
      return value;
    }

    // Invalid token
    return null;
  }
}

// =============================================================================
// High-Level API
// =============================================================================

/**
 * Evaluate an arithmetic expression with optional variable context.
 *
 * This is the main high-level function for arithmetic evaluation.
 * It combines tokenization, parsing, and evaluation in one call.
 *
 * @param expr - The arithmetic expression to evaluate
 * @param context - Optional variable context for identifier resolution
 * @returns The numeric result, or null if evaluation fails
 *
 * @example
 * // Simple arithmetic
 * evaluateArithmetic('2 + 3 * 4'); // 14
 *
 * @example
 * // With operator precedence
 * evaluateArithmetic('(2 + 3) * 4'); // 20
 *
 * @example
 * // With variables
 * evaluateArithmetic('price * quantity', { price: 10, quantity: 5 }); // 50
 *
 * @example
 * // Invalid expression
 * evaluateArithmetic('2 + +'); // null
 *
 * @example
 * // Missing variable
 * evaluateArithmetic('x + 1', {}); // null
 *
 * @example
 * // Security: prototype access blocked
 * evaluateArithmetic('constructor', { constructor: 42 }); // null
 */
export function evaluateArithmetic(
  expr: string,
  context: ArithmeticContext = {}
): ArithmeticResult {
  try {
    const trimmedExpr = expr.trim();
    if (!trimmedExpr) return null;

    // Tokenize the expression
    const tokens = tokenizeArithmetic(trimmedExpr);
    if (tokens.length === 0) return null;

    // Parse and evaluate
    const parser = new ArithmeticParser(tokens, context);
    const result = parser.parseExpression();

    if (result === null || !isFinite(result)) return null;

    // Verify all tokens were consumed (no trailing garbage like extra parentheses)
    if (!parser.isComplete()) return null;

    return result;
  } catch {
    return null;
  }
}

/**
 * Evaluate an arithmetic expression and return a floored integer result.
 *
 * This is useful for cases where integer results are required,
 * such as SQL aggregate functions that should return whole numbers.
 *
 * @param expr - The arithmetic expression to evaluate
 * @param context - Optional variable context for identifier resolution
 * @returns The floored integer result, or null if evaluation fails
 *
 * @example
 * evaluateArithmeticInteger('10 / 3'); // 3 (not 3.333...)
 *
 * @example
 * evaluateArithmeticInteger('2.7 + 3.5'); // 6 (not 6.2)
 */
export function evaluateArithmeticInteger(
  expr: string,
  context: ArithmeticContext = {}
): ArithmeticResult {
  const result = evaluateArithmetic(expr, context);
  if (result === null) return null;
  return Math.floor(result);
}

/**
 * Check if an expression is valid without evaluating it.
 *
 * Useful for validation before attempting evaluation,
 * especially when context may not yet be available.
 *
 * Note: This only checks syntax validity. It does not verify
 * that all referenced variables exist in the context.
 *
 * @param expr - The arithmetic expression to validate
 * @returns True if the expression has valid syntax
 *
 * @example
 * isValidArithmeticExpression('2 + 3'); // true
 * isValidArithmeticExpression('2 + +'); // false
 * isValidArithmeticExpression('2 @ 3'); // false (invalid operator)
 */
export function isValidArithmeticExpression(expr: string): boolean {
  try {
    const trimmedExpr = expr.trim();
    if (!trimmedExpr) return false;

    const tokens = tokenizeArithmetic(trimmedExpr);
    if (tokens.length === 0) return false;

    // Create a mock context that returns 0 for any identifier
    const mockContext = new Proxy(
      {},
      {
        get: (_, prop) => {
          if (typeof prop === 'string' && FORBIDDEN_IDENTIFIERS.has(prop)) {
            return undefined;
          }
          return 0;
        },
      }
    );

    const parser = new ArithmeticParser(tokens, mockContext as ArithmeticContext);
    const result = parser.parseExpression();

    // Verify all tokens were consumed
    return result !== null && parser.isComplete();
  } catch {
    return false;
  }
}

/**
 * Extract all variable names referenced in an expression.
 *
 * Useful for determining what context variables are needed
 * before evaluation.
 *
 * @param expr - The arithmetic expression to analyze
 * @returns Array of variable names, or empty array if tokenization fails
 *
 * @example
 * getExpressionVariables('price * quantity + tax');
 * // Returns: ['price', 'quantity', 'tax']
 *
 * @example
 * getExpressionVariables('2 + 3 * 4');
 * // Returns: []
 */
export function getExpressionVariables(expr: string): string[] {
  try {
    const tokens = tokenizeArithmetic(expr.trim());
    if (tokens.length === 0) return [];

    const variables: string[] = [];
    for (const token of tokens) {
      if (token.type === 'identifier' && typeof token.value === 'string') {
        if (!variables.includes(token.value)) {
          variables.push(token.value);
        }
      }
    }

    return variables;
  } catch {
    return [];
  }
}
