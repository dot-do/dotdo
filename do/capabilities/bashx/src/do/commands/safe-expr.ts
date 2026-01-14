/**
 * Safe Expression Parser - Security Fix for eval() Vulnerability
 *
 * This module implements a safe arithmetic expression parser that replaces
 * the use of eval() for bc command evaluation. It uses a proper tokenizer,
 * recursive descent parser, and AST evaluator to safely evaluate expressions.
 *
 * SECURITY: This module is designed to prevent code injection attacks.
 * It rejects any input containing JavaScript/shell injection patterns.
 *
 * Supports:
 * - Basic arithmetic: +, -, *, /, %
 * - Power operator: ^
 * - Parentheses and operator precedence
 * - Negative numbers
 * - bc features: scale, ibase, obase, variables
 * - Math library functions: sqrt, s (sin), c (cos), a (atan), l (log), e (exp)
 *
 * @module bashx/do/commands/safe-expr
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Token types produced by the tokenizer.
 */
export type TokenType =
  | 'number'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'identifier'
  | 'function'
  | 'assign'
  | 'semicolon'

/**
 * Token produced by the tokenizer.
 */
export interface Token {
  type: TokenType
  value: string | number
}

/**
 * AST node types.
 */
export type AstNodeType =
  | 'number'
  | 'binary'
  | 'unary'
  | 'call'
  | 'identifier'
  | 'assign'
  | 'statements'

/**
 * Base AST node interface.
 */
export interface AstNodeBase {
  type: AstNodeType
}

/**
 * Number literal node.
 */
export interface NumberNode extends AstNodeBase {
  type: 'number'
  value: number
}

/**
 * Binary operation node.
 */
export interface BinaryNode extends AstNodeBase {
  type: 'binary'
  operator: string
  left: AstNode
  right: AstNode
}

/**
 * Unary operation node.
 */
export interface UnaryNode extends AstNodeBase {
  type: 'unary'
  operator: string
  operand: AstNode
}

/**
 * Function call node.
 */
export interface CallNode extends AstNodeBase {
  type: 'call'
  name: string
  args: AstNode[]
}

/**
 * Identifier reference node.
 */
export interface IdentifierNode extends AstNodeBase {
  type: 'identifier'
  name: string
}

/**
 * Variable assignment node.
 */
export interface AssignNode extends AstNodeBase {
  type: 'assign'
  name: string
  value: AstNode
}

/**
 * Multiple statements node.
 */
export interface StatementsNode extends AstNodeBase {
  type: 'statements'
  body: AstNode[]
}

/**
 * Union type for all AST nodes.
 */
export type AstNode =
  | NumberNode
  | BinaryNode
  | UnaryNode
  | CallNode
  | IdentifierNode
  | AssignNode
  | StatementsNode

/**
 * Options for safeEval function.
 */
export interface SafeEvalOptions {
  /** Enable math library functions (sqrt, sin, cos, etc.) */
  mathLib?: boolean
  /** Initial scale for decimal precision */
  scale?: number
  /** Input base (2-16, default 10) */
  ibase?: number
  /** Output base (2-16, default 10) */
  obase?: number
}

/**
 * Error thrown for invalid expressions or injection attempts.
 */
export class SafeExprError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SafeExprError'
  }
}

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/**
 * Dangerous patterns that indicate injection attempts.
 * These patterns are checked before tokenization.
 */
const DANGEROUS_PATTERNS = [
  // JavaScript globals and keywords
  /\bprocess\b/i,
  /\brequire\b/i,
  /\bimport\b/i,
  /\beval\b/i,
  /\bFunction\b/,
  /\bconstructor\b/i,
  /\b__proto__\b/,
  /\bprototype\b/i,
  /\bglobalThis\b/i,
  /\bwindow\b/i,
  /\bthis\b/i,
  /\bconsole\b/i,
  /\bObject\b/,
  /\bJSON\b/,
  /\bReflect\b/,
  /\bProxy\b/,
  /\bSymbol\b/,
  /\basync\b/i,
  /\bawait\b/i,
  /\bnew\b/i,
  /\bthrow\b/i,
  /\btypeof\b/i,
  /\bclass\b/i,
  /\bfetch\b/i,

  // Shell injection patterns
  /`[^`]*`/, // Backticks
  /\$\(/, // $() command substitution
  /&&/, // AND chaining
  /\|\|/, // OR chaining (but not || in bc which is different)
  /\|(?!\|)/, // Pipe (but allow || for OR in expressions)

  // JavaScript syntax
  /=>/, // Arrow functions
  /\[['"`]/, // Array/bracket access with strings
  /\.\s*constructor/, // .constructor access
  /\.\s*__proto__/, // .__proto__ access

  // Unicode/hex escapes
  /\\u[0-9a-fA-F]{4}/, // Unicode escapes
  /\\x[0-9a-fA-F]{2}/, // Hex escapes

  // JavaScript increment operator (-- is valid in bc as - -)
  /\+\+/, // ++ increment is not valid in bc

  // Comments with potential injection
  /\/\*[\s\S]*?\*\//, // Block comments
  /\/\/.*/, // Line comments

  // Template literals
  /\$\{/, // Template literal expressions
]

/**
 * Allowed function names in bc math library.
 */
const ALLOWED_FUNCTIONS = new Set([
  'sqrt',
  's', // sin
  'c', // cos
  'a', // atan
  'l', // natural log
  'e', // exp (e^x)
])

/**
 * Reserved bc variable names.
 */
const RESERVED_VARS = new Set(['scale', 'ibase', 'obase'])

// ============================================================================
// SECURITY CHECK
// ============================================================================

/**
 * Check input for dangerous patterns before tokenization.
 * Throws SafeExprError if injection attempt is detected.
 */
function checkSecurity(input: string): void {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      throw new SafeExprError(`Invalid expression: contains forbidden pattern`)
    }
  }

  // Check for balanced parentheses (basic sanity check)
  let depth = 0
  for (const char of input) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth < 0) {
      throw new SafeExprError('Invalid expression: unbalanced parentheses')
    }
  }
  if (depth !== 0) {
    throw new SafeExprError('Invalid expression: unbalanced parentheses')
  }
}

// ============================================================================
// TOKENIZER
// ============================================================================

/**
 * Tokenize an expression string into tokens.
 */
export function tokenize(input: string, ibase = 10): Token[] {
  // Security check first
  checkSecurity(input)

  const tokens: Token[] = []
  let i = 0
  let currentIbase = ibase

  // Track if we just processed an ibase assignment
  let pendingIbaseValue: number | null = null

  while (i < input.length) {
    const char = input[i]

    // Skip whitespace
    if (/\s/.test(char)) {
      i++
      continue
    }

    // Semicolon
    if (char === ';') {
      tokens.push({ type: 'semicolon', value: ';' })
      i++
      // Apply pending ibase
      if (pendingIbaseValue !== null) {
        currentIbase = pendingIbaseValue
        pendingIbaseValue = null
      }
      continue
    }

    // Assignment operator
    if (char === '=') {
      // Check if previous token was ibase identifier
      const prevToken = tokens[tokens.length - 1]
      if (prevToken && prevToken.type === 'identifier' && prevToken.value === 'ibase') {
        // Look ahead to get the ibase value
        tokens.push({ type: 'assign', value: '=' })
        i++
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) i++
        // Parse the number
        let numStr = ''
        while (i < input.length && /[0-9]/.test(input[i])) {
          numStr += input[i]
          i++
        }
        if (numStr) {
          const val = parseInt(numStr, 10)
          tokens.push({ type: 'number', value: val })
          pendingIbaseValue = val
        }
        continue
      }
      tokens.push({ type: 'assign', value: '=' })
      i++
      continue
    }

    // Numbers (including hex letters when ibase > 10)
    if (/[0-9]/.test(char) || char === '.' ||
        (currentIbase > 10 && /[A-Fa-f]/.test(char) && isStartOfNumber(input, i, tokens))) {
      let numStr = ''
      let hasDecimal = false

      while (i < input.length) {
        const c = input[i]
        if (/[0-9]/.test(c)) {
          numStr += c
          i++
        } else if (c === '.' && !hasDecimal) {
          numStr += c
          hasDecimal = true
          i++
        } else if (currentIbase > 10 && /[A-Fa-f]/.test(c)) {
          numStr += c.toUpperCase()
          i++
        } else {
          break
        }
      }

      // Parse number with current base
      let value: number
      if (hasDecimal) {
        value = parseFloat(numStr)
      } else if (currentIbase !== 10) {
        value = parseInt(numStr, currentIbase)
      } else {
        value = parseFloat(numStr)
      }

      tokens.push({ type: 'number', value })
      continue
    }

    // Operators
    if ('+-*/%^'.includes(char)) {
      tokens.push({ type: 'operator', value: char })
      i++
      continue
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(' })
      i++
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')' })
      i++
      continue
    }

    // Identifiers and functions
    if (/[a-zA-Z_]/.test(char)) {
      let name = ''
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        name += input[i]
        i++
      }

      // Check if it's a function call (followed by parenthesis)
      // Skip whitespace to check for (
      let lookAhead = i
      while (lookAhead < input.length && /\s/.test(input[lookAhead])) {
        lookAhead++
      }

      if (lookAhead < input.length && input[lookAhead] === '(') {
        if (!ALLOWED_FUNCTIONS.has(name) && !RESERVED_VARS.has(name)) {
          throw new SafeExprError(`Invalid expression: unknown function '${name}'`)
        }
        tokens.push({ type: 'function', value: name })
      } else {
        // It's an identifier (variable)
        tokens.push({ type: 'identifier', value: name })
      }
      continue
    }

    // Unknown character
    throw new SafeExprError(`Invalid expression: unexpected character '${char}'`)
  }

  return tokens
}

/**
 * Helper to check if we're at the start of a hex number.
 */
function isStartOfNumber(_input: string, _pos: number, tokens: Token[]): boolean {
  // If the last token was an operator, lparen, assign, or semicolon, we're at start of number
  const prevToken = tokens[tokens.length - 1]
  if (!prevToken) return true
  if (prevToken.type === 'operator') return true
  if (prevToken.type === 'lparen') return true
  if (prevToken.type === 'assign') return true
  if (prevToken.type === 'semicolon') return true
  return false
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Recursive descent parser for arithmetic expressions.
 */
class Parser {
  private tokens: Token[]
  private pos: number

  constructor(tokens: Token[]) {
    this.tokens = tokens
    this.pos = 0
  }

  parse(): AstNode {
    const statements: AstNode[] = []

    while (this.pos < this.tokens.length) {
      const stmt = this.parseStatement()
      statements.push(stmt)

      // Consume semicolon if present
      if (this.pos < this.tokens.length && this.peek()?.type === 'semicolon') {
        this.consume()
      }
    }

    if (statements.length === 0) {
      throw new SafeExprError('Invalid expression: empty expression')
    }

    if (statements.length === 1) {
      return statements[0]
    }

    return {
      type: 'statements',
      body: statements,
    }
  }

  private parseStatement(): AstNode {
    // Check for assignment
    if (this.pos + 1 < this.tokens.length &&
        this.peek()?.type === 'identifier' &&
        this.tokens[this.pos + 1]?.type === 'assign') {
      const name = this.consume().value as string
      this.consume() // consume '='
      const value = this.parseExpression()
      return {
        type: 'assign',
        name,
        value,
      }
    }

    return this.parseExpression()
  }

  private parseExpression(): AstNode {
    return this.parseAdditive()
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative()

    while (this.peek()?.type === 'operator' &&
           (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value as string
      const right = this.parseMultiplicative()
      left = {
        type: 'binary',
        operator: op,
        left,
        right,
      }
    }

    return left
  }

  private parseMultiplicative(): AstNode {
    let left = this.parsePower()

    while (this.peek()?.type === 'operator' &&
           (this.peek()?.value === '*' || this.peek()?.value === '/' || this.peek()?.value === '%')) {
      const op = this.consume().value as string
      const right = this.parsePower()
      left = {
        type: 'binary',
        operator: op,
        left,
        right,
      }
    }

    return left
  }

  private parsePower(): AstNode {
    const left = this.parseUnary()

    // Power is right-associative
    if (this.peek()?.type === 'operator' && this.peek()?.value === '^') {
      this.consume()
      const right = this.parsePower() // Recursive for right-associativity
      return {
        type: 'binary',
        operator: '^',
        left,
        right,
      }
    }

    return left
  }

  private parseUnary(): AstNode {
    if (this.peek()?.type === 'operator' &&
        (this.peek()?.value === '-' || this.peek()?.value === '+')) {
      const op = this.consume().value as string
      const operand = this.parseUnary()
      return {
        type: 'unary',
        operator: op,
        operand,
      }
    }

    return this.parsePrimary()
  }

  private parsePrimary(): AstNode {
    const token = this.peek()

    if (!token) {
      throw new SafeExprError('Invalid expression: unexpected end of expression')
    }

    // Number literal
    if (token.type === 'number') {
      this.consume()
      return {
        type: 'number',
        value: token.value as number,
      }
    }

    // Function call
    if (token.type === 'function') {
      const name = this.consume().value as string

      // Expect (
      if (this.peek()?.type !== 'lparen') {
        throw new SafeExprError(`Invalid expression: expected '(' after function '${name}'`)
      }
      this.consume()

      // Parse arguments
      const args: AstNode[] = []
      if (this.peek()?.type !== 'rparen') {
        args.push(this.parseExpression())
      }

      // Expect )
      if (this.peek()?.type !== 'rparen') {
        throw new SafeExprError(`Invalid expression: expected ')' after function arguments`)
      }
      this.consume()

      return {
        type: 'call',
        name,
        args,
      }
    }

    // Identifier (variable reference)
    if (token.type === 'identifier') {
      const name = this.consume().value as string
      return {
        type: 'identifier',
        name,
      }
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.consume()
      const expr = this.parseExpression()
      if (this.peek()?.type !== 'rparen') {
        throw new SafeExprError('Invalid expression: missing closing parenthesis')
      }
      this.consume()
      return expr
    }

    throw new SafeExprError(`Invalid expression: unexpected token '${token.value}'`)
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    return this.tokens[this.pos++]
  }
}

/**
 * Parse tokens into an AST.
 */
export function parse(tokens: Token[]): AstNode {
  const parser = new Parser(tokens)
  return parser.parse()
}

// ============================================================================
// EVALUATOR
// ============================================================================

/**
 * Evaluation context containing variables and settings.
 */
interface EvalContext {
  variables: Map<string, number>
  scale: number
  ibase: number
  obase: number
  mathLib: boolean
}

/**
 * Evaluate an AST node and return the numeric result.
 */
export function evaluate(node: AstNode, ctx?: EvalContext): number {
  const context: EvalContext = ctx ?? {
    variables: new Map(),
    scale: 0,
    ibase: 10,
    obase: 10,
    mathLib: false,
  }

  return evalNode(node, context)
}

function evalNode(node: AstNode, ctx: EvalContext): number {
  switch (node.type) {
    case 'number':
      return node.value

    case 'binary':
      return evalBinary(node, ctx)

    case 'unary':
      return evalUnary(node, ctx)

    case 'call':
      return evalCall(node, ctx)

    case 'identifier':
      return evalIdentifier(node, ctx)

    case 'assign':
      return evalAssign(node, ctx)

    case 'statements':
      return evalStatements(node, ctx)

    default:
      throw new SafeExprError(`Invalid expression: unknown node type`)
  }
}

function evalBinary(node: BinaryNode, ctx: EvalContext): number {
  const left = evalNode(node.left, ctx)
  const right = evalNode(node.right, ctx)

  switch (node.operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      if (right === 0) {
        throw new SafeExprError('bc: divide by zero')
      }
      if (ctx.scale === 0) {
        return Math.trunc(left / right)
      }
      return left / right
    case '%':
      if (right === 0) {
        throw new SafeExprError('bc: divide by zero')
      }
      return left % right
    case '^':
      return Math.pow(left, right)
    default:
      throw new SafeExprError(`Invalid expression: unknown operator '${node.operator}'`)
  }
}

function evalUnary(node: UnaryNode, ctx: EvalContext): number {
  const operand = evalNode(node.operand, ctx)
  switch (node.operator) {
    case '-':
      return -operand
    case '+':
      return operand
    default:
      throw new SafeExprError(`Invalid expression: unknown unary operator '${node.operator}'`)
  }
}

function evalCall(node: CallNode, ctx: EvalContext): number {
  if (!ALLOWED_FUNCTIONS.has(node.name)) {
    throw new SafeExprError(`Invalid expression: unknown function '${node.name}'`)
  }

  if (node.args.length !== 1) {
    throw new SafeExprError(`Invalid expression: function '${node.name}' expects 1 argument`)
  }

  const arg = evalNode(node.args[0], ctx)

  switch (node.name) {
    case 'sqrt':
      if (arg < 0) {
        throw new SafeExprError('bc: sqrt of negative number')
      }
      return Math.sqrt(arg)
    case 's': // sin
      return Math.sin(arg)
    case 'c': // cos
      return Math.cos(arg)
    case 'a': // atan
      return Math.atan(arg)
    case 'l': // natural log
      if (arg <= 0) {
        throw new SafeExprError('bc: log of non-positive number')
      }
      return Math.log(arg)
    case 'e': // exp
      return Math.exp(arg)
    default:
      throw new SafeExprError(`Invalid expression: unknown function '${node.name}'`)
  }
}

function evalIdentifier(node: IdentifierNode, ctx: EvalContext): number {
  // Check for reserved variables
  switch (node.name) {
    case 'scale':
      return ctx.scale
    case 'ibase':
      return ctx.ibase
    case 'obase':
      return ctx.obase
  }

  // Look up user variable
  const value = ctx.variables.get(node.name)
  if (value === undefined) {
    throw new SafeExprError(`bc: undefined variable '${node.name}'`)
  }
  return value
}

function evalAssign(node: AssignNode, ctx: EvalContext): number {
  const value = evalNode(node.value, ctx)

  // Handle reserved variables
  switch (node.name) {
    case 'scale':
      ctx.scale = Math.floor(value)
      return value
    case 'ibase':
      if (value < 2 || value > 16) {
        throw new SafeExprError('bc: ibase must be between 2 and 16')
      }
      ctx.ibase = Math.floor(value)
      return value
    case 'obase':
      if (value < 2 || value > 16) {
        throw new SafeExprError('bc: obase must be between 2 and 16')
      }
      ctx.obase = Math.floor(value)
      return value
  }

  // Set user variable
  ctx.variables.set(node.name, value)
  return value
}

function evalStatements(node: StatementsNode, ctx: EvalContext): number {
  let lastValue = 0
  for (const stmt of node.body) {
    lastValue = evalNode(stmt, ctx)
  }
  return lastValue
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Safely evaluate a bc-style expression and return the result as a string.
 *
 * @param input - The expression to evaluate
 * @param options - Optional evaluation options
 * @returns The result formatted as a string (bc-compatible output)
 * @throws SafeExprError if the expression is invalid or contains injection attempts
 *
 * @example
 * ```typescript
 * safeEval('2+2')           // '4'
 * safeEval('scale=2; 10/3') // '3.33'
 * safeEval('ibase=16; FF')  // '255'
 * safeEval('sqrt(16)', { mathLib: true }) // '4'
 * ```
 */
export function safeEval(input: string, options?: SafeEvalOptions): string {
  // Additional security check for the raw input
  checkSecurity(input)

  // Create evaluation context
  const ctx: EvalContext = {
    variables: new Map(),
    scale: options?.scale ?? 0,
    ibase: options?.ibase ?? 10,
    obase: options?.obase ?? 10,
    mathLib: options?.mathLib ?? false,
  }

  // Handle math library default scale
  if (ctx.mathLib && ctx.scale === 0) {
    ctx.scale = 20
  }

  // Tokenize
  const tokens = tokenize(input, ctx.ibase)

  // Parse
  const ast = parse(tokens)

  // Evaluate
  const result = evalNode(ast, ctx)

  // Format output according to obase and scale
  return formatOutput(result, ctx)
}

/**
 * Format the numeric result according to bc conventions.
 */
function formatOutput(value: number, ctx: EvalContext): string {
  // Handle obase conversion for non-decimal output
  if (ctx.obase !== 10) {
    const intValue = Math.trunc(value)
    if (intValue < 0) {
      return '-' + Math.abs(intValue).toString(ctx.obase).toUpperCase()
    }
    return intValue.toString(ctx.obase).toUpperCase()
  }

  // Handle integer result
  if (ctx.scale === 0 || Number.isInteger(value)) {
    return Math.trunc(value).toString()
  }

  // Handle decimal result with scale
  // bc truncates (doesn't round) to the specified scale
  const factor = Math.pow(10, ctx.scale)
  const truncated = Math.trunc(value * factor) / factor
  const fixed = truncated.toFixed(ctx.scale)

  // bc style: remove leading zero for decimals between -1 and 1
  if (Math.abs(truncated) < 1 && truncated !== 0) {
    if (truncated > 0) {
      return fixed.replace(/^0\./, '.')
    } else {
      return fixed.replace(/^-0\./, '-.')
    }
  }

  return fixed
}
