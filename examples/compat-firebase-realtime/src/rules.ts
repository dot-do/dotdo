/**
 * Firebase Security Rules Parser and Evaluator
 *
 * Implements Firebase Realtime Database security rules including:
 * - Path-based rules with wildcards ($variables)
 * - Read/write permission rules
 * - Validation rules
 * - Rule expressions with auth, data, newData, root
 * - Built-in methods: hasChild, hasChildren, exists, val, child, parent, etc.
 *
 * @example
 * ```json
 * {
 *   "rules": {
 *     "users": {
 *       "$uid": {
 *         ".read": "auth != null && auth.uid == $uid",
 *         ".write": "auth != null && auth.uid == $uid",
 *         ".validate": "newData.hasChildren(['name', 'email'])"
 *       }
 *     },
 *     "posts": {
 *       ".read": true,
 *       "$postId": {
 *         ".write": "auth != null",
 *         ".validate": "newData.child('author').val() == auth.uid"
 *       }
 *     }
 *   }
 * }
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SecurityRules {
  rules: RuleNode
}

export interface RuleNode {
  '.read'?: string | boolean
  '.write'?: string | boolean
  '.validate'?: string | boolean
  '.indexOn'?: string | string[]
  [key: string]: RuleNode | string | boolean | string[] | undefined
}

export interface RuleContext {
  auth: { uid: string; token: Record<string, unknown> } | null
  path: string
  data: unknown
  newData?: unknown
  root: unknown
  now: number
}

export interface DataNode {
  val(): unknown
  child(path: string): DataNode
  parent(): DataNode | null
  hasChild(childPath: string): boolean
  hasChildren(children?: string[]): boolean
  exists(): boolean
  isString(): boolean
  isNumber(): boolean
  isBoolean(): boolean
  getPriority(): unknown
}

// ============================================================================
// DATA NODE IMPLEMENTATION
// ============================================================================

function createDataNode(data: unknown, parentNode: DataNode | null = null): DataNode {
  return {
    val(): unknown {
      if (data === undefined) return null
      return data
    },

    child(childPath: string): DataNode {
      const segments = childPath.split('/').filter(Boolean)
      let current: unknown = data

      for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return createDataNode(null, this)
        }
        current = (current as Record<string, unknown>)[segment]
      }

      return createDataNode(current, this)
    },

    parent(): DataNode | null {
      return parentNode
    },

    hasChild(childPath: string): boolean {
      const childNode = this.child(childPath)
      return childNode.exists()
    },

    hasChildren(children?: string[]): boolean {
      if (data === null || data === undefined || typeof data !== 'object') {
        return false
      }

      if (!children) {
        return Object.keys(data as Record<string, unknown>).length > 0
      }

      for (const child of children) {
        if (!this.hasChild(child)) {
          return false
        }
      }

      return true
    },

    exists(): boolean {
      return data !== null && data !== undefined
    },

    isString(): boolean {
      return typeof data === 'string'
    },

    isNumber(): boolean {
      return typeof data === 'number'
    },

    isBoolean(): boolean {
      return typeof data === 'boolean'
    },

    getPriority(): unknown {
      if (typeof data === 'object' && data !== null) {
        return (data as Record<string, unknown>)['.priority'] ?? null
      }
      return null
    },
  }
}

// ============================================================================
// RULE EXPRESSION EVALUATOR
// ============================================================================

interface EvalContext {
  auth: { uid: string; token: Record<string, unknown> } | null
  data: DataNode
  newData: DataNode
  root: DataNode
  now: number
  pathVariables: Record<string, string>
}

/**
 * Safely evaluate a rule expression
 */
function evaluateExpression(expression: string, context: EvalContext): boolean {
  try {
    // Handle boolean literals
    if (expression === 'true') return true
    if (expression === 'false') return false

    // Create sandboxed evaluation function
    const result = safeEval(expression, context)
    return Boolean(result)
  } catch (error) {
    console.warn(`Rule evaluation error for expression "${expression}":`, error)
    return false
  }
}

/**
 * Safe expression evaluator that doesn't use eval
 */
function safeEval(expression: string, context: EvalContext): unknown {
  // Tokenize and parse the expression
  const tokens = tokenize(expression)
  const ast = parseExpression(tokens, 0)
  return evaluate(ast.node, context)
}

// ============================================================================
// TOKENIZER
// ============================================================================

type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'paren'
  | 'bracket'
  | 'dot'
  | 'comma'
  | 'question'
  | 'colon'

interface Token {
  type: TokenType
  value: string
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expression.length) {
    const char = expression[i]

    // Skip whitespace
    if (/\s/.test(char)) {
      i++
      continue
    }

    // String literals
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      i++
      while (i < expression.length && expression[i] !== quote) {
        if (expression[i] === '\\' && i + 1 < expression.length) {
          i++
          const escaped = expression[i]
          switch (escaped) {
            case 'n':
              value += '\n'
              break
            case 't':
              value += '\t'
              break
            case '\\':
              value += '\\'
              break
            default:
              value += escaped
          }
        } else {
          value += expression[i]
        }
        i++
      }
      i++ // Skip closing quote
      tokens.push({ type: 'string', value })
      continue
    }

    // Numbers
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(expression[i + 1] || ''))) {
      let value = char
      i++
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        value += expression[i]
        i++
      }
      tokens.push({ type: 'number', value })
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(char)) {
      let value = char
      i++
      while (i < expression.length && /[a-zA-Z0-9_$]/.test(expression[i])) {
        value += expression[i]
        i++
      }

      if (value === 'true' || value === 'false') {
        tokens.push({ type: 'boolean', value })
      } else if (value === 'null') {
        tokens.push({ type: 'null', value })
      } else {
        tokens.push({ type: 'identifier', value })
      }
      continue
    }

    // Operators
    const twoCharOps = ['==', '!=', '<=', '>=', '&&', '||', '===', '!==']
    const twoChar = expression.slice(i, i + 2)
    const threeChar = expression.slice(i, i + 3)

    if (threeChar === '===' || threeChar === '!==') {
      tokens.push({ type: 'operator', value: threeChar })
      i += 3
      continue
    }

    if (twoCharOps.includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar })
      i += 2
      continue
    }

    if ('+-*/%<>!'.includes(char)) {
      tokens.push({ type: 'operator', value: char })
      i++
      continue
    }

    // Parentheses and brackets
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      i++
      continue
    }

    if (char === '[' || char === ']') {
      tokens.push({ type: 'bracket', value: char })
      i++
      continue
    }

    // Dot
    if (char === '.') {
      tokens.push({ type: 'dot', value: char })
      i++
      continue
    }

    // Comma
    if (char === ',') {
      tokens.push({ type: 'comma', value: char })
      i++
      continue
    }

    // Ternary
    if (char === '?') {
      tokens.push({ type: 'question', value: char })
      i++
      continue
    }

    if (char === ':') {
      tokens.push({ type: 'colon', value: char })
      i++
      continue
    }

    // Skip unknown characters
    i++
  }

  return tokens
}

// ============================================================================
// PARSER
// ============================================================================

type ASTNode =
  | { type: 'literal'; value: unknown }
  | { type: 'identifier'; name: string }
  | { type: 'member'; object: ASTNode; property: string | ASTNode; computed: boolean }
  | { type: 'call'; callee: ASTNode; arguments: ASTNode[] }
  | { type: 'unary'; operator: string; argument: ASTNode }
  | { type: 'binary'; operator: string; left: ASTNode; right: ASTNode }
  | { type: 'ternary'; test: ASTNode; consequent: ASTNode; alternate: ASTNode }
  | { type: 'array'; elements: ASTNode[] }

interface ParseResult {
  node: ASTNode
  pos: number
}

function parseExpression(tokens: Token[], pos: number): ParseResult {
  return parseTernary(tokens, pos)
}

function parseTernary(tokens: Token[], pos: number): ParseResult {
  const { node: condition, pos: afterCondition } = parseOr(tokens, pos)

  if (afterCondition < tokens.length && tokens[afterCondition].type === 'question') {
    const { node: consequent, pos: afterConsequent } = parseExpression(tokens, afterCondition + 1)
    if (afterConsequent < tokens.length && tokens[afterConsequent].type === 'colon') {
      const { node: alternate, pos: afterAlternate } = parseExpression(tokens, afterConsequent + 1)
      return {
        node: { type: 'ternary', test: condition, consequent, alternate },
        pos: afterAlternate,
      }
    }
  }

  return { node: condition, pos: afterCondition }
}

function parseOr(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseAnd(tokens, pos)

  while (currentPos < tokens.length && tokens[currentPos].value === '||') {
    const { node: right, pos: afterRight } = parseAnd(tokens, currentPos + 1)
    left = { type: 'binary', operator: '||', left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseAnd(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseEquality(tokens, pos)

  while (currentPos < tokens.length && tokens[currentPos].value === '&&') {
    const { node: right, pos: afterRight } = parseEquality(tokens, currentPos + 1)
    left = { type: 'binary', operator: '&&', left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseEquality(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseComparison(tokens, pos)

  while (
    currentPos < tokens.length &&
    ['==', '!=', '===', '!=='].includes(tokens[currentPos].value)
  ) {
    const operator = tokens[currentPos].value
    const { node: right, pos: afterRight } = parseComparison(tokens, currentPos + 1)
    left = { type: 'binary', operator, left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseComparison(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseAdditive(tokens, pos)

  while (currentPos < tokens.length && ['<', '>', '<=', '>='].includes(tokens[currentPos].value)) {
    const operator = tokens[currentPos].value
    const { node: right, pos: afterRight } = parseAdditive(tokens, currentPos + 1)
    left = { type: 'binary', operator, left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseAdditive(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseMultiplicative(tokens, pos)

  while (currentPos < tokens.length && ['+', '-'].includes(tokens[currentPos].value)) {
    const operator = tokens[currentPos].value
    const { node: right, pos: afterRight } = parseMultiplicative(tokens, currentPos + 1)
    left = { type: 'binary', operator, left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseMultiplicative(tokens: Token[], pos: number): ParseResult {
  let { node: left, pos: currentPos } = parseUnary(tokens, pos)

  while (currentPos < tokens.length && ['*', '/', '%'].includes(tokens[currentPos].value)) {
    const operator = tokens[currentPos].value
    const { node: right, pos: afterRight } = parseUnary(tokens, currentPos + 1)
    left = { type: 'binary', operator, left, right }
    currentPos = afterRight
  }

  return { node: left, pos: currentPos }
}

function parseUnary(tokens: Token[], pos: number): ParseResult {
  if (pos < tokens.length && ['!', '-'].includes(tokens[pos].value)) {
    const operator = tokens[pos].value
    const { node: argument, pos: afterArg } = parseUnary(tokens, pos + 1)
    return { node: { type: 'unary', operator, argument }, pos: afterArg }
  }

  return parsePostfix(tokens, pos)
}

function parsePostfix(tokens: Token[], pos: number): ParseResult {
  let { node, pos: currentPos } = parsePrimary(tokens, pos)

  while (currentPos < tokens.length) {
    const token = tokens[currentPos]

    // Method/property access
    if (token.type === 'dot') {
      currentPos++
      if (currentPos < tokens.length && tokens[currentPos].type === 'identifier') {
        const property = tokens[currentPos].value
        currentPos++

        // Check for method call
        if (currentPos < tokens.length && tokens[currentPos].value === '(') {
          const { args, pos: afterArgs } = parseArguments(tokens, currentPos)
          node = {
            type: 'call',
            callee: { type: 'member', object: node, property, computed: false },
            arguments: args,
          }
          currentPos = afterArgs
        } else {
          node = { type: 'member', object: node, property, computed: false }
        }
      }
      continue
    }

    // Computed property access
    if (token.type === 'bracket' && token.value === '[') {
      const { node: property, pos: afterProp } = parseExpression(tokens, currentPos + 1)
      if (afterProp < tokens.length && tokens[afterProp].value === ']') {
        node = { type: 'member', object: node, property, computed: true }
        currentPos = afterProp + 1
        continue
      }
    }

    // Function call
    if (token.value === '(') {
      const { args, pos: afterArgs } = parseArguments(tokens, currentPos)
      node = { type: 'call', callee: node, arguments: args }
      currentPos = afterArgs
      continue
    }

    break
  }

  return { node, pos: currentPos }
}

function parseArguments(tokens: Token[], pos: number): { args: ASTNode[]; pos: number } {
  const args: ASTNode[] = []
  let currentPos = pos + 1 // Skip opening paren

  while (currentPos < tokens.length && tokens[currentPos].value !== ')') {
    const { node, pos: afterArg } = parseExpression(tokens, currentPos)
    args.push(node)
    currentPos = afterArg

    if (currentPos < tokens.length && tokens[currentPos].type === 'comma') {
      currentPos++
    }
  }

  return { args, pos: currentPos + 1 } // Skip closing paren
}

function parsePrimary(tokens: Token[], pos: number): ParseResult {
  if (pos >= tokens.length) {
    return { node: { type: 'literal', value: null }, pos }
  }

  const token = tokens[pos]

  // Parenthesized expression
  if (token.value === '(') {
    const { node, pos: afterExpr } = parseExpression(tokens, pos + 1)
    return { node, pos: afterExpr + 1 } // Skip closing paren
  }

  // Array literal
  if (token.value === '[') {
    const elements: ASTNode[] = []
    let currentPos = pos + 1

    while (currentPos < tokens.length && tokens[currentPos].value !== ']') {
      const { node, pos: afterElem } = parseExpression(tokens, currentPos)
      elements.push(node)
      currentPos = afterElem

      if (currentPos < tokens.length && tokens[currentPos].type === 'comma') {
        currentPos++
      }
    }

    return { node: { type: 'array', elements }, pos: currentPos + 1 }
  }

  // Literals
  if (token.type === 'string') {
    return { node: { type: 'literal', value: token.value }, pos: pos + 1 }
  }

  if (token.type === 'number') {
    return { node: { type: 'literal', value: parseFloat(token.value) }, pos: pos + 1 }
  }

  if (token.type === 'boolean') {
    return { node: { type: 'literal', value: token.value === 'true' }, pos: pos + 1 }
  }

  if (token.type === 'null') {
    return { node: { type: 'literal', value: null }, pos: pos + 1 }
  }

  // Identifier
  if (token.type === 'identifier') {
    return { node: { type: 'identifier', name: token.value }, pos: pos + 1 }
  }

  return { node: { type: 'literal', value: null }, pos: pos + 1 }
}

// ============================================================================
// EVALUATOR
// ============================================================================

function evaluate(node: ASTNode, context: EvalContext): unknown {
  switch (node.type) {
    case 'literal':
      return node.value

    case 'array':
      return node.elements.map((elem) => evaluate(elem, context))

    case 'identifier':
      return resolveIdentifier(node.name, context)

    case 'member':
      return resolveMember(node, context)

    case 'call':
      return resolveCall(node, context)

    case 'unary':
      return evaluateUnary(node, context)

    case 'binary':
      return evaluateBinary(node, context)

    case 'ternary':
      return evaluate(node.test, context) ? evaluate(node.consequent, context) : evaluate(node.alternate, context)

    default:
      return null
  }
}

function resolveIdentifier(name: string, context: EvalContext): unknown {
  // Check path variables first (e.g., $uid)
  if (name.startsWith('$') && context.pathVariables[name]) {
    return context.pathVariables[name]
  }

  // Built-in identifiers
  switch (name) {
    case 'auth':
      return context.auth
    case 'data':
      return context.data
    case 'newData':
      return context.newData
    case 'root':
      return context.root
    case 'now':
      return context.now
    case 'true':
      return true
    case 'false':
      return false
    case 'null':
      return null
    default:
      // Check path variables without $
      if (context.pathVariables['$' + name]) {
        return context.pathVariables['$' + name]
      }
      return undefined
  }
}

function resolveMember(node: { object: ASTNode; property: string | ASTNode; computed: boolean }, context: EvalContext): unknown {
  const object = evaluate(node.object, context)

  if (object === null || object === undefined) {
    return null
  }

  let property: string
  if (node.computed) {
    property = String(evaluate(node.property as ASTNode, context))
  } else {
    property = node.property as string
  }

  // Handle DataNode methods
  if (isDataNode(object)) {
    switch (property) {
      case 'val':
        return () => object.val()
      case 'child':
        return (path: string) => object.child(path)
      case 'parent':
        return () => object.parent()
      case 'hasChild':
        return (path: string) => object.hasChild(path)
      case 'hasChildren':
        return (children?: string[]) => object.hasChildren(children)
      case 'exists':
        return () => object.exists()
      case 'isString':
        return () => object.isString()
      case 'isNumber':
        return () => object.isNumber()
      case 'isBoolean':
        return () => object.isBoolean()
      case 'getPriority':
        return () => object.getPriority()
    }
  }

  // Regular property access
  if (typeof object === 'object' && object !== null) {
    return (object as Record<string, unknown>)[property]
  }

  return undefined
}

function isDataNode(obj: unknown): obj is DataNode {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as DataNode).val === 'function' &&
    typeof (obj as DataNode).child === 'function'
  )
}

function resolveCall(node: { callee: ASTNode; arguments: ASTNode[] }, context: EvalContext): unknown {
  const callee = evaluate(node.callee, context)

  if (typeof callee === 'function') {
    const args = node.arguments.map((arg) => evaluate(arg, context))
    return callee(...args)
  }

  // Handle string methods
  if (typeof callee === 'string') {
    // This shouldn't happen in normal usage, but handle gracefully
    return null
  }

  return null
}

function evaluateUnary(node: { operator: string; argument: ASTNode }, context: EvalContext): unknown {
  const value = evaluate(node.argument, context)

  switch (node.operator) {
    case '!':
      return !value
    case '-':
      return -(value as number)
    default:
      return value
  }
}

function evaluateBinary(node: { operator: string; left: ASTNode; right: ASTNode }, context: EvalContext): unknown {
  // Short-circuit evaluation for && and ||
  if (node.operator === '&&') {
    const left = evaluate(node.left, context)
    if (!left) return false
    return Boolean(evaluate(node.right, context))
  }

  if (node.operator === '||') {
    const left = evaluate(node.left, context)
    if (left) return true
    return Boolean(evaluate(node.right, context))
  }

  const left = evaluate(node.left, context)
  const right = evaluate(node.right, context)

  switch (node.operator) {
    case '==':
    case '===':
      return left === right
    case '!=':
    case '!==':
      return left !== right
    case '<':
      return (left as number) < (right as number)
    case '>':
      return (left as number) > (right as number)
    case '<=':
      return (left as number) <= (right as number)
    case '>=':
      return (left as number) >= (right as number)
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left) + String(right)
      }
      return (left as number) + (right as number)
    case '-':
      return (left as number) - (right as number)
    case '*':
      return (left as number) * (right as number)
    case '/':
      return (left as number) / (right as number)
    case '%':
      return (left as number) % (right as number)
    default:
      return null
  }
}

// ============================================================================
// RULE EVALUATION
// ============================================================================

/**
 * Evaluate security rules for a given path and operation
 */
export function evaluateRules(
  rules: SecurityRules,
  path: string,
  operation: 'read' | 'write',
  context: RuleContext
): boolean {
  const segments = path.split('/').filter(Boolean)
  const pathVariables: Record<string, string> = {}

  // Find matching rule node
  let currentNode: RuleNode | undefined = rules.rules
  let ruleResult: boolean | null = null

  // Walk the rules tree
  for (let i = 0; i <= segments.length; i++) {
    if (!currentNode) break

    // Check for permission rule at current level
    const ruleKey = operation === 'read' ? '.read' : '.write'
    const rule = currentNode[ruleKey]

    if (rule !== undefined) {
      // Create evaluation context with DataNodes
      const evalContext: EvalContext = {
        auth: context.auth,
        data: createDataNode(context.data),
        newData: createDataNode(context.newData),
        root: createDataNode(context.root),
        now: context.now,
        pathVariables,
      }

      let result: boolean
      if (typeof rule === 'boolean') {
        result = rule
      } else {
        result = evaluateExpression(rule, evalContext)
      }

      // Once a rule grants permission, it cascades down
      if (result) {
        ruleResult = true
      }
    }

    // Navigate to next level
    if (i < segments.length) {
      const segment = segments[i]

      // Check for exact match first
      if (currentNode[segment] && typeof currentNode[segment] === 'object') {
        currentNode = currentNode[segment] as RuleNode
      } else {
        // Check for wildcard match
        const wildcardKey = Object.keys(currentNode).find(
          (k) => k.startsWith('$') && typeof currentNode![k] === 'object'
        )

        if (wildcardKey) {
          pathVariables[wildcardKey] = segment
          currentNode = currentNode[wildcardKey] as RuleNode
        } else {
          // No matching rule, stop here
          break
        }
      }
    }
  }

  // If write operation, also check .validate rules
  if (operation === 'write' && ruleResult === true && context.newData !== undefined) {
    const validateResult = evaluateValidateRules(rules.rules, segments, context, pathVariables)
    if (!validateResult) {
      return false
    }
  }

  return ruleResult === true
}

/**
 * Evaluate .validate rules for write operations
 */
function evaluateValidateRules(
  rulesNode: RuleNode,
  segments: string[],
  context: RuleContext,
  pathVariables: Record<string, string>
): boolean {
  let currentNode: RuleNode | undefined = rulesNode

  for (let i = 0; i <= segments.length; i++) {
    if (!currentNode) break

    // Check .validate rule
    const validateRule = currentNode['.validate']
    if (validateRule !== undefined) {
      const evalContext: EvalContext = {
        auth: context.auth,
        data: createDataNode(context.data),
        newData: createDataNode(context.newData),
        root: createDataNode(context.root),
        now: context.now,
        pathVariables,
      }

      let result: boolean
      if (typeof validateRule === 'boolean') {
        result = validateRule
      } else {
        result = evaluateExpression(validateRule, evalContext)
      }

      if (!result) {
        return false
      }
    }

    // Navigate to next level
    if (i < segments.length) {
      const segment = segments[i]

      if (currentNode[segment] && typeof currentNode[segment] === 'object') {
        currentNode = currentNode[segment] as RuleNode
      } else {
        const wildcardKey = Object.keys(currentNode).find(
          (k) => k.startsWith('$') && typeof currentNode![k] === 'object'
        )

        if (wildcardKey) {
          pathVariables[wildcardKey] = segment
          currentNode = currentNode[wildcardKey] as RuleNode
        } else {
          break
        }
      }
    }
  }

  return true
}

/**
 * Parse and validate security rules JSON
 */
export function parseRules(rulesJson: string | SecurityRules): SecurityRules {
  const rules = typeof rulesJson === 'string' ? JSON.parse(rulesJson) : rulesJson

  if (!rules.rules || typeof rules.rules !== 'object') {
    throw new Error('Invalid rules: missing "rules" object')
  }

  return rules as SecurityRules
}

/**
 * Get default permissive rules (for development)
 */
export function getDefaultRules(): SecurityRules {
  return {
    rules: {
      '.read': true,
      '.write': true,
    },
  }
}

/**
 * Get locked down rules (require auth for everything)
 */
export function getSecureRules(): SecurityRules {
  return {
    rules: {
      '.read': 'auth != null',
      '.write': 'auth != null',
    },
  }
}

export default {
  evaluateRules,
  parseRules,
  getDefaultRules,
  getSecureRules,
}
