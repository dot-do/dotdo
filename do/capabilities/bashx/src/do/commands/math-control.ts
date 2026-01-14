/**
 * Math & Control Commands
 *
 * Native implementations for math and control flow commands:
 * - bc: arbitrary precision calculator
 * - expr: expression evaluator
 * - seq: sequence generator
 * - shuf: shuffle/randomize
 * - sleep: delay execution
 * - timeout: run with time limit
 *
 * @module bashx/do/commands/math-control
 */

// ============================================================================
// TIMING UTILITIES
// ============================================================================

/**
 * Time unit multipliers in milliseconds.
 * Used for parsing duration strings with suffixes.
 */
const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
}

/**
 * Signal name to number mapping for timeout command.
 * Supports both short (TERM) and long (SIGTERM) forms.
 */
const SIGNAL_MAP: Record<string, number> = {
  TERM: 15,
  SIGTERM: 15,
  KILL: 9,
  SIGKILL: 9,
  INT: 2,
  SIGINT: 2,
  HUP: 1,
  SIGHUP: 1,
}

/**
 * Timing utilities for duration parsing and delay operations.
 * Provides a unified interface for all time-related operations.
 */
export const TimingUtils = {
  /**
   * Parse a duration string into milliseconds.
   *
   * @param duration - Duration string with optional unit suffix
   * @returns Duration in milliseconds (may be Infinity)
   * @throws Error if duration format is invalid
   *
   * @example
   * ```ts
   * TimingUtils.parseDuration('5')      // 5000 (seconds)
   * TimingUtils.parseDuration('100ms')  // Invalid - only s/m/h/d supported
   * TimingUtils.parseDuration('1.5s')   // 1500
   * TimingUtils.parseDuration('2m')     // 120000
   * TimingUtils.parseDuration('1h')     // 3600000
   * TimingUtils.parseDuration('1d')     // 86400000
   * TimingUtils.parseDuration('infinity') // Infinity
   * ```
   */
  parseDuration(duration: string): number {
    if (duration === 'infinity') {
      return Infinity
    }

    const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/)
    if (!match) {
      throw new Error(`Invalid duration: ${duration}`)
    }

    const value = parseFloat(match[1])
    const unit = match[2] || 's'

    return value * (TIME_UNIT_MS[unit] ?? 1000)
  },

  /**
   * Create a delay promise that resolves after the specified milliseconds.
   *
   * @param ms - Delay in milliseconds
   * @returns Promise that resolves after delay
   *
   * @example
   * ```ts
   * await TimingUtils.delay(1000)  // Wait 1 second
   * ```
   */
  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  /**
   * Create an infinite wait promise (never resolves).
   * Useful for "sleep infinity" semantics.
   *
   * @returns Promise that never resolves
   */
  waitForever(): Promise<never> {
    return new Promise(() => {})
  },

  /**
   * Parse a signal specification into a signal number.
   *
   * @param signal - Signal name (e.g., "TERM", "SIGKILL") or number
   * @returns Signal number
   *
   * @example
   * ```ts
   * TimingUtils.parseSignal('TERM')    // 15
   * TimingUtils.parseSignal('SIGKILL') // 9
   * TimingUtils.parseSignal(9)         // 9
   * TimingUtils.parseSignal('15')      // 15
   * ```
   */
  parseSignal(signal: string | number): number {
    if (typeof signal === 'number') {
      return signal
    }
    return SIGNAL_MAP[signal.toUpperCase()] ?? (parseInt(signal, 10) || 15)
  },
}

// Backward compatibility export
export const parseDuration = TimingUtils.parseDuration

// ============================================================================
// EXPRESSION ENGINE
// ============================================================================

/**
 * Token types for the expression parser.
 */
type TokenType = 'number' | 'operator' | 'function' | 'variable' | 'paren'

/**
 * Token representation for the expression parser.
 */
export interface Token {
  type: TokenType
  value: string | number
}

/**
 * Operator precedence levels (higher = binds tighter).
 */
const OPERATOR_PRECEDENCE: Record<string, number> = {
  '|': 1,
  '&': 2,
  '=': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
  '^': 6, '**': 6,
}

/**
 * ExpressionEngine provides a reusable expression parsing and evaluation system.
 * Supports both bc-style and expr-style expression evaluation.
 */
export class ExpressionEngine {
  private variables: Map<string, number> = new Map()
  private scale: number = 0
  private ibase: number = 10
  private obase: number = 10
  private mathLib: boolean = false

  /**
   * Create a new ExpressionEngine instance.
   *
   * @param options - Configuration options
   *
   * @example
   * ```ts
   * const engine = new ExpressionEngine({ mathLib: true, scale: 10 })
   * const result = engine.evaluate('sqrt(2)')
   * ```
   */
  constructor(options: {
    mathLib?: boolean
    scale?: number
    ibase?: number
    obase?: number
  } = {}) {
    this.mathLib = options.mathLib ?? false
    this.scale = options.mathLib ? 20 : (options.scale ?? 0)
    this.ibase = options.ibase ?? 10
    this.obase = options.obase ?? 10
  }

  /**
   * Set the decimal scale (number of decimal places).
   *
   * @param scale - Number of decimal places for division results
   */
  setScale(scale: number): void {
    this.scale = scale
  }

  /**
   * Set the input base for number parsing.
   *
   * @param base - Input base (2-16)
   */
  setInputBase(base: number): void {
    this.ibase = base
  }

  /**
   * Set the output base for result formatting.
   *
   * @param base - Output base (2-16)
   */
  setOutputBase(base: number): void {
    this.obase = base
  }

  /**
   * Set a variable value.
   *
   * @param name - Variable name
   * @param value - Numeric value
   */
  setVariable(name: string, value: number): void {
    this.variables.set(name, value)
  }

  /**
   * Get the operator precedence for comparison.
   *
   * @param op - Operator string
   * @returns Precedence level (higher binds tighter)
   */
  getOperatorPrecedence(op: string): number {
    return OPERATOR_PRECEDENCE[op] ?? 0
  }

  /**
   * Check if an operator is right-associative.
   *
   * @param op - Operator string
   * @returns True if right-associative
   */
  isRightAssociative(op: string): boolean {
    return op === '^' || op === '**'
  }

  /**
   * Evaluate a bc-style expression.
   *
   * @param expr - Expression string
   * @returns Numeric result
   * @throws Error on syntax errors or invalid operations
   *
   * @example
   * ```ts
   * engine.evaluate('2+3*4')      // 14
   * engine.evaluate('(2+3)*4')    // 20
   * engine.evaluate('2^10')       // 1024
   * ```
   */
  evaluate(expr: string): number {
    // Substitute variables
    let processedExpr = expr
    for (const [name, value] of this.variables) {
      processedExpr = processedExpr.replace(
        new RegExp(`\\b${name}\\b`, 'g'),
        String(value)
      )
    }

    // Process math functions
    processedExpr = this.processMathFunctions(processedExpr)

    // Convert from input base if needed
    if (this.ibase !== 10) {
      processedExpr = processedExpr.replace(/\b([0-9A-F]+)\b/g, match => {
        return String(parseInt(match, this.ibase))
      })
    }

    // Convert ^ to ** for JavaScript exponentiation
    processedExpr = processedExpr.replace(/\^/g, '**')

    // Check for division by zero
    if (/\/\s*0(?![0-9])/.test(processedExpr)) {
      throw new Error('divide by zero')
    }

    // Check for syntax errors (consecutive operators excluding **)
    if (/[+\-*/%]{2,}/.test(processedExpr.replace(/\*\*/g, 'POW'))) {
      throw new Error('syntax error')
    }

    // Evaluate using safe Function constructor
    try {
      const fn = new Function(`return (${processedExpr})`)
      const result = fn()

      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('invalid result')
      }

      return result
    } catch {
      throw new Error('syntax error')
    }
  }

  /**
   * Process math library functions in the expression.
   *
   * @param expr - Expression with function calls
   * @returns Expression with functions evaluated
   */
  private processMathFunctions(expr: string): string {
    let result = expr

    // Always handle sqrt
    result = this.processFunction(result, 'sqrt', (val) => {
      if (val < 0) throw new Error('square root of negative number')
      return Math.sqrt(val)
    })

    // Math library functions
    if (this.mathLib) {
      result = this.processFunction(result, 's', Math.sin)
      result = this.processFunction(result, 'c', Math.cos)
      result = this.processFunction(result, 'a', Math.atan)
      result = this.processFunction(result, 'l', Math.log)
      result = this.processFunction(result, 'e', Math.exp)
    }

    return result
  }

  /**
   * Process a single function in the expression.
   *
   * @param expr - Expression string
   * @param name - Function name
   * @param fn - JavaScript function to apply
   * @returns Expression with function evaluated
   */
  private processFunction(
    expr: string,
    name: string,
    fn: (x: number) => number
  ): string {
    const pattern = new RegExp(`\\b${name}\\(([^)]+)\\)`, 'g')
    return expr.replace(pattern, (_, arg) => {
      const val = this.evaluate(arg)
      return String(fn(val))
    })
  }

  /**
   * Format a numeric result according to current settings.
   *
   * @param value - Numeric value to format
   * @returns Formatted string representation
   *
   * @example
   * ```ts
   * engine.setScale(2)
   * engine.format(3.14159)  // "3.14"
   *
   * engine.setOutputBase(16)
   * engine.format(255)      // "FF"
   * ```
   */
  format(value: number): string {
    // Handle decimal scale
    if (this.scale > 0 && !Number.isInteger(value)) {
      // bc truncates, doesn't round
      const factor = Math.pow(10, this.scale)
      const truncated = Math.trunc(value * factor) / factor
      let formatted = truncated.toFixed(this.scale)

      // bc compatibility: remove leading zero for |value| < 1
      if (Math.abs(truncated) < 1 && truncated !== 0) {
        formatted = formatted.replace(
          /^-?0\./,
          match => match.startsWith('-') ? '-.' : '.'
        )
      }
      return formatted
    }

    // Integer output
    const intValue = Math.trunc(value)

    // Convert to output base
    if (this.obase !== 10) {
      return intValue.toString(this.obase).toUpperCase()
    }

    return String(intValue)
  }
}

// ============================================================================
// FORMAT UTILITIES
// ============================================================================

/**
 * Format utilities for number output formatting.
 */
export const FormatUtils = {
  /**
   * Simple sprintf implementation for format strings.
   * Supports %g, %f, %e format specifiers.
   *
   * @param format - Format string with % specifiers
   * @param value - Numeric value to format
   * @returns Formatted string
   *
   * @example
   * ```ts
   * FormatUtils.sprintf('%.2f', 3.14159)   // "3.14"
   * FormatUtils.sprintf('%03g', 5)          // "005"
   * FormatUtils.sprintf('%.2e', 1000)       // "1.00e+03"
   * FormatUtils.sprintf('Value: %g%%', 50)  // "Value: 50%"
   * ```
   */
  sprintf(format: string, value: number): string {
    return format
      .replace(/%(\d+)?(?:\.(\d+))?(g|f|e)/, (_, width, precision, type) => {
        let result: string
        const prec = precision !== undefined ? parseInt(precision, 10) : undefined

        switch (type) {
          case 'f':
            result = prec !== undefined ? value.toFixed(prec) : String(value)
            break
          case 'e': {
            const expStr = prec !== undefined
              ? value.toExponential(prec)
              : value.toExponential()
            // Ensure exponent has at least 2 digits (e+03 not e+3)
            result = expStr.replace(/e([+-])(\d)$/, 'e$10$2')
            break
          }
          case 'g':
          default:
            if (prec !== undefined) {
              result = value.toPrecision(prec).replace(/\.?0+$/, '')
            } else {
              result = String(value)
            }
            // Pad with zeros if width specified
            if (width) {
              const w = parseInt(width, 10)
              result = result.padStart(w, '0')
            }
            break
        }

        return result
      })
      .replace(/%%/g, '%')
  },

  /**
   * Calculate the decimal precision of a number.
   *
   * @param n - Number to analyze
   * @returns Number of decimal places
   */
  getPrecision(n: number): number {
    const str = String(n)
    const dot = str.indexOf('.')
    return dot >= 0 ? str.length - dot - 1 : 0
  },
}

// ============================================================================
// RANDOM UTILITIES
// ============================================================================

/**
 * Random number utilities for shuffling and sampling.
 */
export const RandomUtils = {
  /**
   * Generate a random integer in the range [0, max).
   *
   * @param max - Exclusive upper bound
   * @returns Random integer
   */
  randomInt(max: number): number {
    return Math.floor(Math.random() * max)
  },

  /**
   * Fisher-Yates shuffle algorithm for in-place array shuffling.
   *
   * @param array - Array to shuffle (mutates in place)
   * @returns The shuffled array (same reference)
   *
   * @example
   * ```ts
   * const arr = [1, 2, 3, 4, 5]
   * RandomUtils.shuffle(arr)
   * // arr is now shuffled
   * ```
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.randomInt(i + 1)
      ;[array[i], array[j]] = [array[j], array[i]]
    }
    return array
  },

  /**
   * Sample n items from an array without replacement.
   *
   * @param array - Source array
   * @param n - Number of items to sample
   * @returns Array of sampled items
   */
  sample<T>(array: T[], n: number): T[] {
    const shuffled = this.shuffle([...array])
    return shuffled.slice(0, Math.min(n, shuffled.length))
  },

  /**
   * Sample n items from an array with replacement.
   *
   * @param array - Source array
   * @param n - Number of items to sample
   * @returns Array of sampled items (may contain duplicates)
   */
  sampleWithReplacement<T>(array: T[], n: number): T[] {
    const result: T[] = []
    for (let i = 0; i < n; i++) {
      result.push(array[this.randomInt(array.length)])
    }
    return result
  },
}

// ============================================================================
// BC - ARBITRARY PRECISION CALCULATOR
// ============================================================================

/**
 * Execute bc expression.
 *
 * bc is a calculator language supporting arbitrary precision arithmetic.
 * This implementation provides compatibility with GNU bc for common operations.
 *
 * @param expression - The bc expression to evaluate
 * @param options - Options including math library flag
 * @returns Result object with result string or error
 *
 * @example
 * ```ts
 * executeBc('2+2')                      // { result: '4', exitCode: 0, stderr: '' }
 * executeBc('scale=2; 10/3')            // { result: '3.33', exitCode: 0, stderr: '' }
 * executeBc('sqrt(16)', { mathLib: true }) // { result: '4.00...', exitCode: 0, stderr: '' }
 * ```
 */
export function executeBc(
  expression: string,
  options: { mathLib?: boolean } = {}
): { result: string; exitCode: number; stderr: string } {
  const engine = new ExpressionEngine({
    mathLib: options.mathLib,
  })

  try {
    // Split by semicolons or newlines
    const lines = expression
      .split(/[;\n]/)
      .map(l => l.trim())
      .filter(l => l.length > 0)

    const results: string[] = []

    for (const line of lines) {
      // Handle scale setting
      if (line.startsWith('scale=')) {
        engine.setScale(parseInt(line.slice(6), 10))
        continue
      }

      // Handle ibase setting
      if (line.startsWith('ibase=')) {
        engine.setInputBase(parseInt(line.slice(6), 10))
        continue
      }

      // Handle obase setting
      if (line.startsWith('obase=')) {
        engine.setOutputBase(parseInt(line.slice(6), 10))
        continue
      }

      // Handle variable assignment
      const assignMatch = line.match(/^([a-z_][a-z0-9_]*)=(.+)$/i)
      if (assignMatch) {
        const [, varName, expr] = assignMatch
        const value = engine.evaluate(expr)
        engine.setVariable(varName, value)
        continue
      }

      // Evaluate expression and collect result
      const value = engine.evaluate(line)
      results.push(engine.format(value))
    }

    return {
      result: results.join('\n'),
      exitCode: 0,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      result: '',
      exitCode: 1,
      stderr: `bc: ${message}`,
    }
  }
}

// ============================================================================
// EXPR - EXPRESSION EVALUATOR
// ============================================================================

/**
 * Execute expr command.
 *
 * expr is a command-line expression evaluator that follows POSIX semantics.
 * It handles arithmetic, string operations, and pattern matching.
 *
 * @param args - Arguments to expr (space-separated expression parts)
 * @returns Result with string output and exit code
 *
 * @example
 * ```ts
 * executeExpr(['2', '+', '2'])           // { result: '4', exitCode: 0, stderr: '' }
 * executeExpr(['hello', ':', '.*'])      // { result: '5', exitCode: 0, stderr: '' }
 * executeExpr(['length', 'hello'])       // { result: '5', exitCode: 0, stderr: '' }
 * ```
 */
export function executeExpr(args: string[]): { result: string; exitCode: number; stderr: string } {
  if (args.length === 0) {
    return { result: '', exitCode: 2, stderr: 'expr: missing operand' }
  }

  try {
    const result = evaluateExprTokens(args)
    const exitCode = result === '0' || result === '' ? 1 : 0
    return { result, exitCode, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { result: '', exitCode: 2, stderr: `expr: ${message}` }
  }
}

/**
 * Evaluate expr tokens with proper precedence.
 * Follows POSIX expr operator precedence:
 * OR < AND < comparisons < addition/subtraction < multiplication/division/modulo
 *
 * @param tokens - Array of expression tokens
 * @returns Evaluated result as string
 */
function evaluateExprTokens(tokens: string[]): string {
  // Handle parentheses first (highest precedence)
  tokens = processParentheses(tokens)

  // Handle string operations: match, substr, index, length
  if (tokens[0] === 'match' && tokens.length >= 3) {
    return exprMatch(tokens[1], tokens[2])
  }

  if (tokens[0] === 'substr' && tokens.length >= 4) {
    const str = tokens[1]
    const pos = parseInt(tokens[2], 10)
    const len = parseInt(tokens[3], 10)
    return str.substring(pos - 1, pos - 1 + len)
  }

  if (tokens[0] === 'index' && tokens.length >= 3) {
    const str = tokens[1]
    const chars = tokens[2]
    for (let idx = 0; idx < str.length; idx++) {
      if (chars.includes(str[idx])) {
        return String(idx + 1)
      }
    }
    return '0'
  }

  if (tokens[0] === 'length' && tokens.length >= 2) {
    return String(tokens[1].length)
  }

  // Handle : operator (pattern matching, anchored at start)
  const colonIdx = tokens.indexOf(':')
  if (colonIdx > 0) {
    const str = tokens[colonIdx - 1]
    const pattern = tokens[colonIdx + 1]
    const result = exprMatch(str, pattern)
    tokens = [
      ...tokens.slice(0, colonIdx - 1),
      result,
      ...tokens.slice(colonIdx + 2),
    ]
    if (tokens.length === 1) return tokens[0]
  }

  // Handle operators by precedence (lowest to highest)
  // OR (|) - lowest precedence
  const orIdx = findOperator(tokens, ['|', '\\|'])
  if (orIdx >= 0) {
    const left = evaluateExprTokens(tokens.slice(0, orIdx))
    if (left !== '0' && left !== '') return left
    return evaluateExprTokens(tokens.slice(orIdx + 1))
  }

  // AND (&)
  const andIdx = findOperator(tokens, ['&', '\\&'])
  if (andIdx >= 0) {
    const left = evaluateExprTokens(tokens.slice(0, andIdx))
    if (left === '0' || left === '') return '0'
    const right = evaluateExprTokens(tokens.slice(andIdx + 1))
    if (right === '0' || right === '') return '0'
    return left
  }

  // Comparison operators
  const compOps = ['=', '!=', '<', '>', '<=', '>=', '\\<', '\\>', '\\<=', '\\>=']
  const compIdx = findOperator(tokens, compOps)
  if (compIdx >= 0) {
    return evaluateComparison(tokens, compIdx)
  }

  // Addition/Subtraction (search from right for left-to-right associativity)
  const addSubIdx = findOperator(tokens, ['+', '-'], true)
  if (addSubIdx >= 0 && addSubIdx > 0) {
    return evaluateArithmetic(tokens, addSubIdx, ['+', '-'])
  }

  // Multiplication/Division/Modulo (highest arithmetic precedence)
  const mulDivIdx = findOperator(tokens, ['*', '\\*', '/', '%'])
  if (mulDivIdx >= 0) {
    return evaluateArithmetic(tokens, mulDivIdx, ['*', '/', '%'])
  }

  // Single value
  if (tokens.length === 1) {
    return tokens[0]
  }

  throw new Error('syntax error')
}

/**
 * Process parentheses in token array.
 *
 * @param tokens - Token array
 * @returns Token array with parenthesized expressions evaluated
 */
function processParentheses(tokens: string[]): string[] {
  let result = [...tokens]
  let i = 0

  while (i < result.length) {
    if (result[i] === '(' || result[i] === '\\(') {
      let depth = 1
      let j = i + 1
      while (j < result.length && depth > 0) {
        if (result[j] === '(' || result[j] === '\\(') depth++
        if (result[j] === ')' || result[j] === '\\)') depth--
        j++
      }
      const subResult = evaluateExprTokens(result.slice(i + 1, j - 1))
      result = [...result.slice(0, i), subResult, ...result.slice(j)]
    }
    i++
  }

  return result
}

/**
 * Evaluate a comparison operation.
 *
 * @param tokens - Token array
 * @param idx - Index of comparison operator
 * @returns '1' for true, '0' for false
 */
function evaluateComparison(tokens: string[], idx: number): string {
  const left = evaluateExprTokens(tokens.slice(0, idx))
  const op = tokens[idx].replace(/^\\/, '')
  const right = evaluateExprTokens(tokens.slice(idx + 1))

  // Try numeric comparison first
  const leftNum = parseFloat(left)
  const rightNum = parseFloat(right)
  const isNumeric = !isNaN(leftNum) && !isNaN(rightNum)

  let result: boolean
  switch (op) {
    case '=':
      result = isNumeric ? leftNum === rightNum : left === right
      break
    case '!=':
      result = isNumeric ? leftNum !== rightNum : left !== right
      break
    case '<':
      result = isNumeric ? leftNum < rightNum : left < right
      break
    case '>':
      result = isNumeric ? leftNum > rightNum : left > right
      break
    case '<=':
      result = isNumeric ? leftNum <= rightNum : left <= right
      break
    case '>=':
      result = isNumeric ? leftNum >= rightNum : left >= right
      break
    default:
      result = false
  }

  return result ? '1' : '0'
}

/**
 * Evaluate an arithmetic operation.
 *
 * @param tokens - Token array
 * @param idx - Index of arithmetic operator
 * @param ops - Valid operators for this evaluation
 * @returns Result as string
 */
function evaluateArithmetic(tokens: string[], idx: number, _ops: string[]): string {
  const left = evaluateExprTokens(tokens.slice(0, idx))
  const op = tokens[idx].replace(/^\\/, '')
  const right = evaluateExprTokens(tokens.slice(idx + 1))

  const leftNum = parseInt(left, 10)
  const rightNum = parseInt(right, 10)

  if (isNaN(leftNum) || isNaN(rightNum)) {
    throw new Error('non-numeric argument')
  }

  switch (op) {
    case '+':
      return String(leftNum + rightNum)
    case '-':
      return String(leftNum - rightNum)
    case '*':
      return String(leftNum * rightNum)
    case '/':
      if (rightNum === 0) throw new Error('division by zero')
      return String(Math.trunc(leftNum / rightNum))
    case '%':
      if (rightNum === 0) throw new Error('division by zero')
      return String(leftNum % rightNum)
    default:
      throw new Error('syntax error')
  }
}

/**
 * Find operator in tokens array.
 *
 * @param tokens - Token array to search
 * @param ops - Operators to find
 * @param fromRight - Search from right (for left-to-right associativity)
 * @returns Index of operator or -1 if not found
 */
function findOperator(tokens: string[], ops: string[], fromRight = false): number {
  if (fromRight) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (ops.includes(tokens[i])) return i
    }
  } else {
    for (let i = 0; i < tokens.length; i++) {
      if (ops.includes(tokens[i])) return i
    }
  }
  return -1
}

/**
 * Pattern matching for expr (anchored at start).
 *
 * @param str - String to match against
 * @param pattern - Regex pattern (automatically anchored at start)
 * @returns Captured group, match length, or '0' if no match
 */
function exprMatch(str: string, pattern: string): string {
  // Check for capture group
  const captureMatch = pattern.match(/\\?\((.+?)\\?\)/)

  // Build regex (anchored at start)
  const regexPattern = pattern
    .replace(/\\?\(/g, '(')
    .replace(/\\?\)/g, ')')

  try {
    const regex = new RegExp('^' + regexPattern)
    const match = str.match(regex)

    if (!match) {
      return '0'
    }

    // If there's a capture group, return captured string
    if (captureMatch && match[1] !== undefined) {
      return match[1]
    }

    // Otherwise return match length
    return String(match[0].length)
  } catch {
    return '0'
  }
}

// ============================================================================
// SEQ - SEQUENCE GENERATOR
// ============================================================================

/**
 * Options for sequence generation.
 */
export interface SeqOptions {
  /** Separator between numbers (default: newline) */
  separator?: string
  /** Pad numbers with leading zeros for equal width */
  equalWidth?: boolean
  /** Printf-style format string */
  format?: string
}

/**
 * Execute seq command.
 *
 * seq prints a sequence of numbers with optional formatting.
 *
 * @param args - Numeric arguments: [last], [first, last], or [first, increment, last]
 * @param options - Formatting options
 * @returns Sequence string
 *
 * @example
 * ```ts
 * executeSeq([5])              // "1\n2\n3\n4\n5"
 * executeSeq([2, 5])           // "2\n3\n4\n5"
 * executeSeq([1, 2, 10])       // "1\n3\n5\n7\n9"
 * executeSeq([5], { separator: ', ' })  // "1, 2, 3, 4, 5"
 * ```
 */
export function executeSeq(
  args: number[],
  options: SeqOptions = {}
): { result: string; exitCode: number } {
  // Parse arguments into first, increment, last
  let first = 1
  let increment = 1
  let last: number

  if (args.length === 1) {
    last = args[0]
  } else if (args.length === 2) {
    first = args[0]
    last = args[1]
  } else if (args.length === 3) {
    first = args[0]
    increment = args[1]
    last = args[2]
  } else {
    return { result: '', exitCode: 1 }
  }

  // Handle impossible ranges (empty output)
  if (
    (increment > 0 && first > last) ||
    (increment < 0 && first < last) ||
    increment === 0
  ) {
    return { result: '', exitCode: 0 }
  }

  const results: string[] = []
  const separator = options.separator ?? '\n'

  // Calculate width for equal-width option
  const firstStr = String(first)
  const lastStr = String(last)
  const totalWidth = Math.max(firstStr.length, lastStr.length)
  const maxWidth = first < 0 || last < 0 ? totalWidth : totalWidth

  // Determine if we're dealing with floats
  const isFloat =
    !Number.isInteger(first) ||
    !Number.isInteger(increment) ||
    !Number.isInteger(last)

  // Calculate precision for floating point
  const precision = Math.max(
    FormatUtils.getPrecision(first),
    FormatUtils.getPrecision(increment),
    FormatUtils.getPrecision(last)
  )

  // Generate sequence
  for (
    let i = first;
    increment > 0 ? i <= last + Number.EPSILON * 10 : i >= last - Number.EPSILON * 10;
    i += increment
  ) {
    // Avoid floating point errors
    const value =
      Math.round(i * Math.pow(10, precision + 2)) / Math.pow(10, precision + 2)

    // Stop if we've passed the last value
    if (increment > 0 && value > last + Number.EPSILON) break
    if (increment < 0 && value < last - Number.EPSILON) break

    let formatted: string

    if (options.format) {
      formatted = FormatUtils.sprintf(options.format, value)
    } else if (options.equalWidth) {
      if (value < 0) {
        formatted = String(Math.round(value))
      } else {
        const absStr = String(Math.abs(Math.round(value)))
        formatted = absStr.padStart(maxWidth, '0')
      }
    } else if (isFloat) {
      formatted = precision > 0 ? value.toFixed(precision) : String(value)
    } else {
      formatted = String(value)
    }

    results.push(formatted)
  }

  return {
    result: results.length > 0 ? results.join(separator) : '',
    exitCode: 0,
  }
}

// ============================================================================
// SHUF - SHUFFLE/RANDOMIZE
// ============================================================================

/**
 * Options for shuffle operation.
 */
export interface ShufOptions {
  /** Maximum number of items to output */
  count?: number
  /** Allow picking the same item multiple times */
  replacement?: boolean
  /** Generate integers in range [start, end] */
  inputRange?: { start: number; end: number }
  /** Echo these arguments instead of reading stdin */
  echoArgs?: string[]
  /** Output file path (not used in this implementation) */
  outputFile?: string
  /** Random source file (not used in this implementation) */
  randomSource?: string
}

/**
 * Execute shuf command.
 *
 * shuf shuffles input lines or generates random permutations.
 *
 * @param lines - Input lines to shuffle (from stdin)
 * @param options - Shuffle options
 * @returns Shuffled output
 *
 * @example
 * ```ts
 * executeShuf(['a', 'b', 'c'])                        // Random order of a, b, c
 * executeShuf([], { inputRange: { start: 1, end: 10 } })  // Random order of 1-10
 * executeShuf([], { echoArgs: ['red', 'green', 'blue'] }) // Random color
 * ```
 */
export function executeShuf(
  lines: string[],
  options: ShufOptions = {}
): { result: string; exitCode: number } {
  let items: string[]

  // Determine input source
  if (options.inputRange) {
    const { start, end } = options.inputRange
    items = []
    for (let i = start; i <= end; i++) {
      items.push(String(i))
    }
  } else if (options.echoArgs && options.echoArgs.length > 0) {
    items = options.echoArgs
  } else {
    items = lines.filter(l => l.length > 0)
  }

  // Handle -n 0
  if (options.count === 0) {
    return { result: '', exitCode: 0 }
  }

  let result: string[]

  if (options.replacement) {
    // With replacement - can pick same item multiple times
    const count = options.count ?? items.length
    result = RandomUtils.sampleWithReplacement(items, count)
  } else {
    // Without replacement - Fisher-Yates shuffle
    result = RandomUtils.shuffle([...items])

    // Limit to count if specified
    if (options.count !== undefined) {
      result = result.slice(0, Math.min(options.count, result.length))
    }
  }

  return {
    result: result.join('\n'),
    exitCode: 0,
  }
}

// ============================================================================
// SLEEP - DELAY EXECUTION
// ============================================================================

/**
 * Execute sleep command.
 *
 * sleep delays execution for a specified duration.
 *
 * @param durations - One or more duration strings
 * @returns Promise that resolves after delay
 *
 * @example
 * ```ts
 * await executeSleep(['1'])       // Sleep 1 second
 * await executeSleep(['0.5'])     // Sleep 500ms
 * await executeSleep(['1m'])      // Sleep 1 minute
 * await executeSleep(['1', '2'])  // Sleep 3 seconds total
 * ```
 */
export async function executeSleep(
  durations: string[]
): Promise<{ exitCode: number; stderr: string }> {
  if (durations.length === 0) {
    return { exitCode: 1, stderr: 'sleep: missing operand' }
  }

  try {
    let totalMs = 0

    for (const duration of durations) {
      const ms = TimingUtils.parseDuration(duration)

      if (ms < 0) {
        return { exitCode: 1, stderr: 'sleep: invalid time interval' }
      }

      if (!isFinite(ms)) {
        // Infinity - sleep forever (will be interrupted by timeout)
        await TimingUtils.waitForever()
        return { exitCode: 0, stderr: '' }
      }

      totalMs += ms
    }

    await TimingUtils.delay(totalMs)
    return { exitCode: 0, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stderr: `sleep: ${message}` }
  }
}

// ============================================================================
// TIMEOUT - RUN WITH TIME LIMIT
// ============================================================================

/**
 * Options for timeout command.
 */
export interface TimeoutOptions {
  /** Duration before sending signal */
  duration: string
  /** Duration before sending KILL after initial signal */
  killAfter?: string
  /** Signal to send (name or number) */
  signal?: string | number
  /** Use 128+signal as exit code instead of 124 */
  preserveStatus?: boolean
  /** Run command in foreground (not used in this implementation) */
  foreground?: boolean
  /** Print verbose timeout message */
  verbose?: boolean
}

/**
 * Execute timeout command.
 *
 * timeout runs a command with a time limit, sending a signal if it exceeds the limit.
 *
 * @param options - Timeout options
 * @param command - Command to execute
 * @param commandExecutor - Function to execute the command
 * @returns Result with exit code and timeout status
 *
 * @example
 * ```ts
 * await executeTimeout(
 *   { duration: '5s' },
 *   'sleep 10',
 *   (cmd) => executor.execute(cmd)
 * )
 * // Returns { exitCode: 124, timedOut: true, ... }
 * ```
 */
export async function executeTimeout<
  T extends { exitCode: number; stdout: string; stderr: string }
>(
  options: TimeoutOptions,
  command: string,
  commandExecutor: (cmd: string) => Promise<T>
): Promise<T & { timedOut: boolean }> {
  // Parse timeout duration
  let timeoutMs: number
  try {
    timeoutMs = TimingUtils.parseDuration(options.duration)
  } catch {
    return {
      exitCode: 125,
      stdout: '',
      stderr: `timeout: invalid time interval '${options.duration}'`,
      timedOut: false,
    } as T & { timedOut: boolean }
  }

  // Determine signal to use
  const signalNum = options.signal
    ? TimingUtils.parseSignal(options.signal)
    : 15 // SIGTERM default

  // Create abort controller for timeout
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    // Execute command with race against timeout
    const result = await Promise.race([
      commandExecutor(command),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('TIMEOUT'))
        })
      }),
    ])

    clearTimeout(timer)
    return { ...result, timedOut: false }
  } catch (error) {
    clearTimeout(timer)

    if (timedOut) {
      const exitCode = options.preserveStatus ? 128 + signalNum : 124
      let stderr = ''
      if (options.verbose) {
        stderr = `timeout: sending signal ${signalNum === 9 ? 'KILL' : 'TERM'} to command '${command}'`
      }

      // SIGKILL exit code is 137 (128 + 9)
      const finalExitCode = signalNum === 9 ? 137 : exitCode

      return {
        exitCode: finalExitCode,
        stdout: '',
        stderr,
        timedOut: true,
      } as T & { timedOut: boolean }
    }

    // Re-throw non-timeout errors
    throw error
  }
}

/**
 * Handle command not found error for timeout.
 *
 * @param command - Command that was not found
 * @returns Error result with exit code 126
 */
export function timeoutCommandNotFound(command: string): {
  exitCode: number
  stderr: string
} {
  return {
    exitCode: 126,
    stderr: `timeout: failed to run command '${command}': No such file or directory`,
  }
}

// ============================================================================
// EXPORTS FOR INTEGRATION
// ============================================================================

/**
 * Unified export of all math and control commands.
 * Useful for command dispatching in the shell executor.
 */
export const mathControlCommands = {
  bc: executeBc,
  expr: executeExpr,
  seq: executeSeq,
  shuf: executeShuf,
  sleep: executeSleep,
  timeout: executeTimeout,
}
