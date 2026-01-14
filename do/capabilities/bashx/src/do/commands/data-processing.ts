/**
 * Data Processing Commands
 *
 * Native implementations of data processing commands:
 * - jq: JSON processor
 * - yq: YAML processor
 * - base64: Encoding/decoding
 * - envsubst: Environment variable substitution
 *
 * These run as Tier 1 native commands in the Worker.
 *
 * @module bashx/do/commands/data-processing
 */

// ============================================================================
// JQ - JSON PROCESSOR
// ============================================================================

/**
 * Options for jq execution
 */
export interface JqOptions {
  /** Output raw strings without quotes */
  raw?: boolean
  /** Compact output (no pretty printing) */
  compact?: boolean
  /** Slurp mode - read all inputs into array */
  slurp?: boolean
  /** Tab-separated output */
  tab?: boolean
  /** Variables from --arg */
  args?: Record<string, string>
  /** JSON variables from --argjson */
  argjson?: Record<string, unknown>
}

/**
 * JQ execution context containing variable bindings
 */
interface JqContext {
  /** String variables from --arg */
  vars: Record<string, string>
  /** JSON variables from --argjson */
  argjson: Record<string, unknown>
}

/**
 * Result from jq evaluation with iterator metadata
 */
interface JqResult {
  /** The evaluated value */
  value: unknown
  /** Whether the result came from an iterator operation */
  isIterator: boolean
}

/**
 * Sentinel value indicating expression was not a builtin function
 */
const NOT_A_BUILTIN = Symbol('NOT_A_BUILTIN')

/**
 * Custom error for jq parsing/execution errors
 *
 * @example
 * ```typescript
 * throw new JqError('parse error: Invalid JSON input', 5)
 * ```
 */
export class JqError extends Error {
  /**
   * Creates a new JqError
   *
   * @param message - Error message describing the problem
   * @param exitCode - Exit code to return (default: 1, parse errors: 5)
   */
  constructor(
    message: string,
    public exitCode: number = 1
  ) {
    super(message)
    this.name = 'JqError'
  }
}

/**
 * JqEngine - Reusable JSON query processor
 *
 * Provides a jq-compatible query language for filtering and transforming JSON data.
 * Supports:
 * - Key access (.key, .key.nested)
 * - Array operations (.[n], .[], map, select, sort_by)
 * - Object construction ({key, newKey: .expr})
 * - Built-in functions (length, keys, values, type, etc.)
 * - Conditionals (if-then-else, alternative operator //)
 * - Variables (--arg, --argjson)
 *
 * @example
 * ```typescript
 * const engine = new JqEngine()
 * const result = engine.execute('.name', '{"name": "test"}')
 * // result = '"test"\n'
 *
 * const filtered = engine.execute(
 *   '.[] | select(.age > 18)',
 *   '[{"name": "alice", "age": 25}]'
 * )
 * ```
 */
export class JqEngine {
  /** Cached parsed JSON to avoid re-parsing */
  private cachedInput: string | null = null
  private cachedData: unknown = null

  /**
   * Execute a jq query on JSON input
   *
   * @param query - The jq query expression (e.g., '.name', '.[] | select(.age > 18)')
   * @param input - JSON input string
   * @param options - Execution options (raw output, compact, slurp, variables)
   * @returns Query result as formatted string
   * @throws {JqError} On invalid JSON or query syntax errors
   *
   * @example
   * ```typescript
   * const engine = new JqEngine()
   *
   * // Simple key access
   * engine.execute('.name', '{"name": "test"}')
   * // => '"test"\n'
   *
   * // With raw output (no quotes)
   * engine.execute('.name', '{"name": "test"}', { raw: true })
   * // => 'test\n'
   *
   * // With variables
   * engine.execute(
   *   '.[] | select(.age > $minAge)',
   *   '[{"age": 25}, {"age": 17}]',
   *   { argjson: { minAge: 18 } }
   * )
   * ```
   */
  execute(query: string, input: string, options: JqOptions = {}): string {
    const data = this.parseInput(input, options)
    const context = this.createContext(options)
    const result = this.evaluateWithMeta(query, data, context)
    return this.formatOutput(result.value, options, result.isIterator)
  }

  /**
   * Evaluate a jq expression and return the raw value (not formatted)
   *
   * @param query - The jq query expression
   * @param data - Parsed JSON data
   * @param context - Execution context with variables
   * @returns Raw evaluated value
   */
  evaluate(query: string, data: unknown, context: JqContext): unknown {
    const trimmedQuery = query.trim()

    if (trimmedQuery === '.' || trimmedQuery === '') {
      return data
    }

    const tokens = this.tokenize(trimmedQuery)
    return this.executeTokens(tokens, data, context).value
  }

  /**
   * Parse JSON input, handling slurp mode for multiple documents
   *
   * @param input - JSON input string
   * @param options - Options containing slurp mode setting
   * @returns Parsed JSON data
   * @throws {JqError} On invalid JSON
   */
  private parseInput(input: string, options: JqOptions): unknown {
    // Check cache for non-slurp mode
    if (!options.slurp && input === this.cachedInput) {
      return this.cachedData
    }

    let data: unknown

    if (options.slurp) {
      data = this.parseSlurpMode(input)
    } else {
      try {
        data = JSON.parse(input)
        // Cache the parsed result
        this.cachedInput = input
        this.cachedData = data
      } catch {
        throw new JqError('parse error: Invalid JSON input', 5)
      }
    }

    return data
  }

  /**
   * Parse multiple JSON documents in slurp mode
   *
   * @param input - Input containing multiple JSON documents (newline-separated)
   * @returns Array of parsed documents
   */
  private parseSlurpMode(input: string): unknown[] {
    const docs: unknown[] = []
    const lines = input.trim().split('\n')
    let currentDoc = ''
    let braceCount = 0
    let bracketCount = 0

    for (const line of lines) {
      currentDoc += line
      for (const char of line) {
        if (char === '{') braceCount++
        else if (char === '}') braceCount--
        else if (char === '[') bracketCount++
        else if (char === ']') bracketCount--
      }

      if (braceCount === 0 && bracketCount === 0 && currentDoc.trim()) {
        try {
          docs.push(JSON.parse(currentDoc.trim()))
          currentDoc = ''
        } catch {
          // Continue accumulating
        }
      }
    }

    // Try to parse any remaining content
    if (currentDoc.trim()) {
      try {
        docs.push(JSON.parse(currentDoc.trim()))
      } catch {
        // Ignore
      }
    }

    return docs
  }

  /**
   * Create execution context from options
   *
   * @param options - Options containing variable bindings
   * @returns JqContext with variables
   */
  private createContext(options: JqOptions): JqContext {
    return {
      vars: { ...options.args },
      argjson: { ...options.argjson },
    }
  }

  /**
   * Evaluate a jq expression with iterator metadata
   *
   * @param query - The jq query expression
   * @param data - Parsed JSON data
   * @param context - Execution context
   * @returns Result with value and iterator flag
   */
  private evaluateWithMeta(query: string, data: unknown, context: JqContext): JqResult {
    const trimmedQuery = query.trim()

    if (trimmedQuery === '.' || trimmedQuery === '') {
      return { value: data, isIterator: false }
    }

    const tokens = this.tokenize(trimmedQuery)
    return this.executeTokens(tokens, data, context)
  }

  /**
   * Tokenize a jq query into pipe-separated components
   *
   * Handles nested structures (parentheses, brackets, braces) and strings
   * to correctly split on pipe operators.
   *
   * @param query - The jq query to tokenize
   * @returns Array of token strings
   */
  private tokenize(query: string): string[] {
    const tokens: string[] = []
    let current = ''
    let parenDepth = 0
    let bracketDepth = 0
    let braceDepth = 0
    let inString = false
    let stringChar = ''

    for (let i = 0; i < query.length; i++) {
      const char = query[i]
      const prevChar = i > 0 ? query[i - 1] : ''

      // Handle strings
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true
          stringChar = char
        } else if (char === stringChar) {
          inString = false
        }
        current += char
        continue
      }

      if (inString) {
        current += char
        continue
      }

      // Track nesting
      if (char === '(') parenDepth++
      else if (char === ')') parenDepth--
      else if (char === '[') bracketDepth++
      else if (char === ']') bracketDepth--
      else if (char === '{') braceDepth++
      else if (char === '}') braceDepth--

      // Pipe separator at top level
      if (char === '|' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (current.trim()) {
          tokens.push(current.trim())
        }
        current = ''
        continue
      }

      current += char
    }

    if (current.trim()) {
      tokens.push(current.trim())
    }

    return tokens
  }

  /**
   * Execute tokenized jq query
   *
   * Handles iterator semantics: when a filter produces multiple outputs,
   * subsequent filters are applied to each output independently.
   *
   * @param tokens - Array of query tokens (pipe-separated components)
   * @param data - Input data
   * @param context - Execution context
   * @returns Result with value and iterator flag
   */
  private executeTokens(tokens: string[], data: unknown, context: JqContext): JqResult {
    let result: unknown = data
    let isIterator = false

    for (const token of tokens) {
      if (isIterator && Array.isArray(result)) {
        // Apply filter to each element
        const filtered: unknown[] = []
        for (const item of result) {
          const itemResult = this.executeExpression(token, item, context)
          if (itemResult !== undefined) {
            filtered.push(itemResult)
          }
        }
        result = filtered
        isIterator = true
      } else {
        result = this.executeExpression(token, result, context)
        isIterator = token === '.[]' || /^\.[a-zA-Z_]\w*\[\]$/.test(token)
      }
    }

    return { value: result, isIterator }
  }

  /**
   * Execute a single jq expression
   *
   * @param expr - Expression to execute
   * @param data - Current data
   * @param context - Execution context
   * @returns Expression result
   * @throws {JqError} On invalid expression
   */
  private executeExpression(expr: string, data: unknown, context: JqContext): unknown {
    const trimmed = expr.trim()

    // Identity
    if (trimmed === '.') {
      return data
    }

    // Iterator: .[]
    if (trimmed === '.[]') {
      return this.handleIterator(data)
    }

    // Key access with iterator: .key[]
    const keyIterMatch = trimmed.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)\[\]$/)
    if (keyIterMatch) {
      return this.handleKeyIterator(data, keyIterMatch[1])
    }

    // Path with iterator: .items[].name
    const pathIterMatch = trimmed.match(/^\.([\w.]+)\[\]\.(\w+)$/)
    if (pathIterMatch) {
      return this.handlePathIterator(data, pathIterMatch[1], pathIterMatch[2])
    }

    // Simple key access: .key or .key.nested
    if (trimmed.startsWith('.') && /^\.[\w.]+$/.test(trimmed)) {
      return this.getPath(data, trimmed.slice(1))
    }

    // Array index: .[n] or .[n:m]
    const indexMatch = trimmed.match(/^\.\[(-?\d+)(?::(-?\d+))?\]$/)
    if (indexMatch) {
      return this.handleArrayIndex(data, indexMatch)
    }

    // Key with array index: .key[n] or .key[n:m]
    const keyIndexMatch = trimmed.match(/^\.(\w+)\[(-?\d+)(?::(-?\d+))?\]$/)
    if (keyIndexMatch) {
      return this.handleKeyIndex(data, keyIndexMatch)
    }

    // Nested path with array index: .items[0].name
    const nestedIndexMatch = trimmed.match(/^\.(\w+)\[(-?\d+)\]\.(\w+)$/)
    if (nestedIndexMatch) {
      return this.handleNestedIndex(data, nestedIndexMatch)
    }

    // Variable access: $var
    if (trimmed.startsWith('$')) {
      return this.handleVariable(trimmed, context)
    }

    // Dynamic key access with variable: .[$key]
    const dynKeyMatch = trimmed.match(/^\.\[\$(\w+)\]$/)
    if (dynKeyMatch) {
      return this.handleDynamicKey(data, dynKeyMatch[1], context)
    }

    // Built-in functions
    const builtinResult = this.handleBuiltinFunction(trimmed, data, context)
    if (builtinResult !== NOT_A_BUILTIN) {
      return builtinResult
    }

    // Object construction
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return this.constructObject(trimmed, data, context)
    }

    // Object addition
    const addMatch = trimmed.match(/^\.\s*\+\s*(\{.+\})$/)
    if (addMatch) {
      const newObj = this.constructObject(addMatch[1], data, context)
      return { ...(data as object), ...newObj }
    }

    // Alternative operator: expr // default
    if (trimmed.includes(' // ')) {
      return this.handleAlternative(trimmed, data, context)
    }

    // if-then-else
    const ifMatch = trimmed.match(/^if\s+(.+)\s+then\s+(.+)\s+else\s+(.+)\s+end$/)
    if (ifMatch) {
      return this.handleConditional(ifMatch, data, context)
    }

    // try-catch
    const tryMatch = trimmed.match(/^try\s+(.+)\s+catch\s+(.+)$/)
    if (tryMatch) {
      return this.handleTryCatch(tryMatch, data, context)
    }

    // Literals
    const literalResult = this.handleLiteral(trimmed)
    if (literalResult !== NOT_A_BUILTIN) {
      return literalResult
    }

    throw new JqError(`Unknown expression: ${trimmed}`)
  }

  /**
   * Handle iterator expression (.[] )
   */
  private handleIterator(data: unknown): unknown[] {
    if (Array.isArray(data)) {
      return data
    }
    if (data && typeof data === 'object') {
      return Object.values(data)
    }
    throw new JqError(`Cannot iterate over ${typeof data}`)
  }

  /**
   * Handle key iterator (.key[])
   */
  private handleKeyIterator(data: unknown, key: string): unknown[] {
    const obj = data as Record<string, unknown>
    const value = obj?.[key]
    if (Array.isArray(value)) {
      return value
    }
    if (value && typeof value === 'object') {
      return Object.values(value)
    }
    throw new JqError(`Cannot iterate over ${typeof value}`)
  }

  /**
   * Handle path iterator (.items[].name)
   */
  private handlePathIterator(data: unknown, basePath: string, finalKey: string): unknown[] {
    let current: unknown = data

    for (const key of basePath.split('.')) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[key]
      } else {
        return [null]
      }
    }

    if (Array.isArray(current)) {
      return current.map((item) => (item as Record<string, unknown>)?.[finalKey])
    }
    throw new JqError(`Cannot iterate: not an array`)
  }

  /**
   * Handle array index (.[n] or .[n:m])
   */
  private handleArrayIndex(data: unknown, match: RegExpMatchArray): unknown {
    if (!Array.isArray(data)) {
      throw new JqError('Cannot index non-array')
    }
    const start = parseInt(match[1], 10)
    if (match[2] !== undefined) {
      const end = parseInt(match[2], 10)
      return data.slice(start < 0 ? data.length + start : start, end < 0 ? data.length + end : end)
    }
    const idx = start < 0 ? data.length + start : start
    return data[idx]
  }

  /**
   * Handle key with array index (.key[n])
   */
  private handleKeyIndex(data: unknown, match: RegExpMatchArray): unknown {
    const key = match[1]
    const arr = (data as Record<string, unknown>)?.[key]
    if (!Array.isArray(arr)) {
      throw new JqError(`Cannot index: .${key} is not an array`)
    }
    const start = parseInt(match[2], 10)
    if (match[3] !== undefined) {
      const end = parseInt(match[3], 10)
      return arr.slice(start < 0 ? arr.length + start : start, end < 0 ? arr.length + end : end)
    }
    const idx = start < 0 ? arr.length + start : start
    return arr[idx]
  }

  /**
   * Handle nested path with array index (.items[0].name)
   */
  private handleNestedIndex(data: unknown, match: RegExpMatchArray): unknown {
    const key = match[1]
    const idx = parseInt(match[2], 10)
    const finalKey = match[3]
    const arr = (data as Record<string, unknown>)?.[key]
    if (!Array.isArray(arr)) {
      throw new JqError(`Cannot index: .${key} is not an array`)
    }
    const realIdx = idx < 0 ? arr.length + idx : idx
    const item = arr[realIdx]
    if (item === undefined || item === null) {
      throw new JqError(`Cannot get .${finalKey} of null`)
    }
    return (item as Record<string, unknown>)?.[finalKey]
  }

  /**
   * Handle variable access ($var)
   */
  private handleVariable(varExpr: string, context: JqContext): unknown {
    const varName = varExpr.slice(1)
    if (varName in context.argjson) {
      return context.argjson[varName]
    }
    if (varName in context.vars) {
      return context.vars[varName]
    }
    throw new JqError(`Variable ${varExpr} is not defined`)
  }

  /**
   * Handle dynamic key access (.[$key])
   */
  private handleDynamicKey(data: unknown, varName: string, context: JqContext): unknown {
    let key: string
    if (varName in context.argjson) {
      key = String(context.argjson[varName])
    } else if (varName in context.vars) {
      key = context.vars[varName]
    } else {
      throw new JqError(`Variable $${varName} is not defined`)
    }
    return (data as Record<string, unknown>)?.[key]
  }

  /**
   * Handle built-in functions (length, keys, sort, etc.)
   *
   * @returns Result value, undefined for select filter-out, or NOT_A_BUILTIN if not a builtin
   */
  private handleBuiltinFunction(expr: string, data: unknown, context: JqContext): unknown | typeof NOT_A_BUILTIN {
    // Simple builtins
    switch (expr) {
      case 'length':
        if (Array.isArray(data)) return data.length
        if (typeof data === 'string') return data.length
        if (data && typeof data === 'object') return Object.keys(data).length
        return 0

      case 'keys':
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          return Object.keys(data).sort()
        }
        if (Array.isArray(data)) {
          return data.map((_, i) => i)
        }
        throw new JqError('keys requires an object or array')

      case 'values':
        if (data === null || data === undefined) {
          return undefined
        }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          return Object.values(data)
        }
        return data

      case 'type':
        if (data === null) return 'null'
        if (Array.isArray(data)) return 'array'
        return typeof data

      case 'tonumber': {
        const num = Number(data)
        if (isNaN(num)) throw new JqError('Cannot convert to number')
        return num
      }

      case 'tostring':
        if (typeof data === 'string') return data
        return JSON.stringify(data)

      case 'sort':
        if (!Array.isArray(data)) throw new JqError('sort requires an array')
        return [...data].sort((a, b) => {
          if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
          if (typeof a === 'number' && typeof b === 'number') return a - b
          return String(a).localeCompare(String(b))
        })

      case 'reverse':
        if (!Array.isArray(data)) throw new JqError('reverse requires an array')
        return [...data].reverse()

      case 'unique':
        if (!Array.isArray(data)) throw new JqError('unique requires an array')
        return this.uniqueArray(data)

      case 'flatten':
        if (!Array.isArray(data)) throw new JqError('flatten requires an array')
        return data.flat(Infinity)

      case 'add':
        if (!Array.isArray(data)) throw new JqError('add requires an array')
        return this.addArray(data)

      case 'ascii_upcase':
        if (typeof data !== 'string') throw new JqError('ascii_upcase requires a string')
        return data.toUpperCase()

      case 'ascii_downcase':
        if (typeof data !== 'string') throw new JqError('ascii_downcase requires a string')
        return data.toLowerCase()
    }

    // Parameterized builtins
    return this.handleParameterizedBuiltin(expr, data, context)
  }

  /**
   * Handle parameterized built-in functions (sort_by, map, select, etc.)
   */
  private handleParameterizedBuiltin(expr: string, data: unknown, context: JqContext): unknown {
    // sort_by(.key)
    const sortByMatch = expr.match(/^sort_by\(\.(\w+)\)$/)
    if (sortByMatch) {
      if (!Array.isArray(data)) throw new JqError('sort_by requires an array')
      const key = sortByMatch[1]
      return [...data].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)?.[key]
        const bVal = (b as Record<string, unknown>)?.[key]
        if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal
        return String(aVal ?? '').localeCompare(String(bVal ?? ''))
      })
    }

    // map(expr)
    const mapMatch = expr.match(/^map\((.+)\)$/)
    if (mapMatch) {
      if (!Array.isArray(data)) throw new JqError('map requires an array')
      const innerExpr = mapMatch[1]
      // Handle select inside map - filter out undefined results
      const results: unknown[] = []
      for (const item of data) {
        const result = this.evaluate(innerExpr, item, context)
        if (result !== undefined) {
          results.push(result)
        }
      }
      return results
    }

    // select(condition)
    const selectMatch = expr.match(/^select\((.+)\)$/)
    if (selectMatch) {
      if (this.evaluateCondition(selectMatch[1], data, context)) {
        return data
      }
      return undefined
    }

    // has("key")
    const hasMatch = expr.match(/^has\("([^"]+)"\)$/) || expr.match(/^has\(\\"([^"]+)\\"\)$/)
    if (hasMatch) {
      if (data && typeof data === 'object') {
        return hasMatch[1] in (data as Record<string, unknown>)
      }
      return false
    }

    // split("delimiter")
    const splitMatch = expr.match(/^split\("([^"]*)"\)$/) || expr.match(/^split\(\\"([^"]*)\\"\)$/)
    if (splitMatch) {
      if (typeof data !== 'string') throw new JqError('split requires a string')
      return data.split(splitMatch[1])
    }

    // join("delimiter")
    const joinMatch = expr.match(/^join\("([^"]*)"\)$/) || expr.match(/^join\(\\"([^"]*)\\"\)$/)
    if (joinMatch) {
      if (!Array.isArray(data)) throw new JqError('join requires an array')
      return data.join(joinMatch[1])
    }

    // test("pattern")
    const testMatch = expr.match(/^test\("([^"]+)"\)$/) || expr.match(/^test\(\\"([^"]+)\\"\)$/)
    if (testMatch) {
      if (typeof data !== 'string') throw new JqError('test requires a string')
      return new RegExp(testMatch[1]).test(data)
    }

    return NOT_A_BUILTIN
  }

  /**
   * Get unique values from array
   */
  private uniqueArray(data: unknown[]): unknown[] {
    const seen = new Set<string>()
    return data.filter((item) => {
      const key = JSON.stringify(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * Add array elements (numbers, strings, arrays, or objects)
   */
  private addArray(data: unknown[]): unknown {
    if (data.length === 0) return null
    if (typeof data[0] === 'number') {
      return data.reduce((a, b) => (a as number) + (b as number), 0)
    }
    if (typeof data[0] === 'string') {
      return data.join('')
    }
    if (Array.isArray(data[0])) {
      return data.flat(1)
    }
    return data.reduce((a, b) => ({ ...(a as object), ...(b as object) }), {})
  }

  /**
   * Handle alternative operator (expr // default)
   */
  private handleAlternative(expr: string, data: unknown, context: JqContext): unknown {
    const [primary, fallback] = expr.split(' // ')
    try {
      const result = this.evaluate(primary.trim(), data, context)
      if (result === null || result === undefined) {
        return this.evaluate(fallback.trim(), data, context)
      }
      return result
    } catch {
      return this.evaluate(fallback.trim(), data, context)
    }
  }

  /**
   * Handle if-then-else conditional
   */
  private handleConditional(match: RegExpMatchArray, data: unknown, context: JqContext): unknown {
    const condition = match[1]
    const thenExpr = match[2]
    const elseExpr = match[3]
    if (this.evaluateCondition(condition, data, context)) {
      return this.evaluate(thenExpr, data, context)
    }
    return this.evaluate(elseExpr, data, context)
  }

  /**
   * Handle try-catch expression
   */
  private handleTryCatch(match: RegExpMatchArray, data: unknown, context: JqContext): unknown {
    try {
      return this.evaluate(match[1], data, context)
    } catch {
      const catchExpr = match[2].trim()
      if (catchExpr.startsWith('"') && catchExpr.endsWith('"')) {
        return catchExpr.slice(1, -1)
      }
      if (catchExpr.startsWith('\\"') && catchExpr.endsWith('\\"')) {
        return catchExpr.slice(2, -2)
      }
      return this.evaluate(catchExpr, data, context)
    }
  }

  /**
   * Handle literal values (strings, numbers, booleans, null)
   */
  private handleLiteral(expr: string): unknown {
    // String literal
    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith('\\"') && expr.endsWith('\\"'))) {
      return expr.startsWith('\\"') ? expr.slice(2, -2) : expr.slice(1, -1)
    }

    // Number literal
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return parseFloat(expr)
    }

    // Boolean and null literals
    if (expr === 'true') return true
    if (expr === 'false') return false
    if (expr === 'null') return null

    return NOT_A_BUILTIN
  }

  /**
   * Evaluate a condition expression for select/if-then-else
   */
  private evaluateCondition(condition: string, data: unknown, context: JqContext): boolean {
    const trimmed = condition.trim()

    // Handle compound conditions (and/or)
    if (trimmed.includes(' and ')) {
      const parts = trimmed.split(' and ')
      return parts.every((part) => this.evaluateCondition(part.trim(), data, context))
    }

    if (trimmed.includes(' or ')) {
      const parts = trimmed.split(' or ')
      return parts.some((part) => this.evaluateCondition(part.trim(), data, context))
    }

    // Comparison operators
    const compMatch = trimmed.match(/^(.+?)\s*(>=|<=|>|<|==|!=)\s*(.+)$/)
    if (compMatch) {
      return this.evaluateComparison(compMatch, data, context)
    }

    // Truthy check for path expressions
    if (trimmed.startsWith('.')) {
      const value = this.evaluate(trimmed, data, context)
      return Boolean(value)
    }

    // has("key") condition
    const hasCondMatch = trimmed.match(/^has\("([^"]+)"\)$/) || trimmed.match(/^has\(\\"([^"]+)\\"\)$/)
    if (hasCondMatch) {
      const hasKey = data && typeof data === 'object' && hasCondMatch[1] in (data as Record<string, unknown>)
      return hasKey as boolean
    }

    return false
  }

  /**
   * Evaluate comparison expression
   */
  private evaluateComparison(match: RegExpMatchArray, data: unknown, context: JqContext): boolean {
    const left = this.evaluate(match[1].trim(), data, context)
    const op = match[2]
    let right: unknown = match[3].trim()

    // Parse right side
    if (/^-?\d+(\.\d+)?$/.test(right as string)) {
      right = parseFloat(right as string)
    } else if ((right as string).startsWith('$')) {
      const varName = (right as string).slice(1)
      right = context.argjson[varName] ?? context.vars[varName]
    } else if ((right as string).startsWith('.')) {
      right = this.evaluate(right as string, data, context)
    } else if ((right as string).startsWith('"') && (right as string).endsWith('"')) {
      right = (right as string).slice(1, -1)
    }

    switch (op) {
      case '>':
        return (left as number) > (right as number)
      case '<':
        return (left as number) < (right as number)
      case '>=':
        return (left as number) >= (right as number)
      case '<=':
        return (left as number) <= (right as number)
      case '==':
        return left === right
      case '!=':
        return left !== right
      default:
        return false
    }
  }

  /**
   * Construct an object from jq object syntax ({key, newKey: .expr})
   */
  private constructObject(expr: string, data: unknown, context: JqContext): Record<string, unknown> {
    const inner = expr.slice(1, -1).trim()
    const result: Record<string, unknown> = {}

    const pairs = this.parseObjectPairs(inner)

    for (const pair of pairs) {
      // Shorthand: key (same as key: .key)
      if (/^\w+$/.test(pair)) {
        result[pair] = (data as Record<string, unknown>)?.[pair]
        continue
      }

      // Full syntax: newKey: .expr or newKey: "value"
      const colonIdx = pair.indexOf(':')
      if (colonIdx > 0) {
        const key = pair.slice(0, colonIdx).trim()
        const valueExpr = pair.slice(colonIdx + 1).trim()

        if (valueExpr.startsWith('\\"') && valueExpr.endsWith('\\"')) {
          result[key] = valueExpr.slice(2, -2)
        } else if (valueExpr.startsWith('"') && valueExpr.endsWith('"')) {
          result[key] = valueExpr.slice(1, -1)
        } else {
          result[key] = this.evaluate(valueExpr, data, context)
        }
      }
    }

    return result
  }

  /**
   * Parse object key-value pairs, handling nested structures
   */
  private parseObjectPairs(inner: string): string[] {
    const pairs: string[] = []
    let current = ''
    let depth = 0
    let inString = false

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]
      if (char === '"' && inner[i - 1] !== '\\') {
        inString = !inString
      }
      if (!inString) {
        if (char === '{' || char === '[') depth++
        else if (char === '}' || char === ']') depth--
        else if (char === ',' && depth === 0) {
          pairs.push(current.trim())
          current = ''
          continue
        }
      }
      current += char
    }
    if (current.trim()) {
      pairs.push(current.trim())
    }

    return pairs
  }

  /**
   * Get value at a dot-separated path
   */
  private getPath(data: unknown, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = data

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null
      }
      if (typeof current !== 'object') {
        return null
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current === undefined ? null : current
  }

  /**
   * Format jq output based on options
   */
  private formatOutput(result: unknown, options: JqOptions, isIteratorResult: boolean = false): string {
    // Filter out undefined values
    if (Array.isArray(result) && result.some((r) => r === undefined)) {
      result = result.filter((r) => r !== undefined)
    }

    // Handle undefined
    if (result === undefined) {
      return ''
    }

    // Handle empty iterator result
    if (isIteratorResult && Array.isArray(result) && result.length === 0) {
      return ''
    }

    // Iterator output - each result on its own line
    if (isIteratorResult && Array.isArray(result)) {
      if (options.tab) {
        return result
          .map((item) => {
            if (typeof item === 'string') return options.raw ? item : JSON.stringify(item)
            return JSON.stringify(item)
          })
          .join('\n') + '\n'
      }
      return result
        .map((item) => {
          if (options.raw && typeof item === 'string') return item
          return options.compact ? JSON.stringify(item) : JSON.stringify(item, null, 2)
        })
        .join('\n') + '\n'
    }

    // Raw output for strings
    if (options.raw && typeof result === 'string') {
      return result + '\n'
    }

    // Normal JSON output
    const formatted = options.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2)
    return formatted + '\n'
  }

  /**
   * Clear the parsed JSON cache
   */
  clearCache(): void {
    this.cachedInput = null
    this.cachedData = null
  }
}

// Global JqEngine instance for simple usage
const defaultJqEngine = new JqEngine()

/**
 * Execute a jq query on JSON input
 *
 * This is the main entry point for jq functionality. For repeated queries
 * on the same input, consider using JqEngine directly for better caching.
 *
 * @param query - The jq query expression
 * @param input - JSON input string
 * @param options - Execution options
 * @returns Query result as string
 * @throws {JqError} On invalid JSON or query syntax errors
 *
 * @example
 * ```typescript
 * // Simple key extraction
 * executeJq('.name', '{"name": "test"}')
 * // => '"test"\n'
 *
 * // Filter array
 * executeJq('.[] | select(.age > 18)', '[{"age": 25}, {"age": 17}]')
 * ```
 */
export function executeJq(query: string, input: string, options: JqOptions = {}): string {
  return defaultJqEngine.execute(query, input, options)
}

// ============================================================================
// YQ - YAML PROCESSOR
// ============================================================================

/**
 * Options for yq execution
 */
export interface YqOptions {
  /** Output format (yaml, json, props, csv) */
  output?: 'yaml' | 'json' | 'props' | 'csv'
  /** Compact JSON output */
  compact?: boolean
  /** In-place edit mode */
  inPlace?: boolean
}

/**
 * Parse result from YAML lines
 */
interface ParseResult {
  /** Parsed value */
  value: unknown
  /** Number of lines consumed */
  consumed: number
}

/**
 * Parse a YAML string into a JavaScript value
 *
 * Supports a subset of YAML including:
 * - Key-value pairs
 * - Nested objects
 * - Arrays (both block and inline)
 * - Anchors and aliases
 * - Multi-document files
 * - Basic scalar types (strings, numbers, booleans, null)
 *
 * @param input - YAML input string
 * @returns Parsed JavaScript value
 * @throws {Error} On invalid YAML syntax
 *
 * @example
 * ```typescript
 * parseYaml('name: bashx\nversion: 1.0.0')
 * // => { name: 'bashx', version: '1.0.0' }
 * ```
 */
export function parseYaml(input: string): unknown {
  const lines = input.split('\n')
  const docs: unknown[] = []
  let currentDocLines: string[] = []

  for (const line of lines) {
    if (line === '---') {
      if (currentDocLines.length > 0) {
        docs.push(parseYamlDocument(currentDocLines))
        currentDocLines = []
      }
    } else {
      currentDocLines.push(line)
    }
  }

  if (currentDocLines.length > 0 || docs.length === 0) {
    docs.push(parseYamlDocument(currentDocLines))
  }

  return docs.length === 1 ? docs[0] : docs
}

/**
 * Parse a single YAML document
 */
function parseYamlDocument(lines: string[]): unknown {
  const anchors: Record<string, unknown> = {}
  return parseYamlLines(lines, 0, anchors).value
}

/**
 * Parse YAML lines at a given indentation level
 */
function parseYamlLines(lines: string[], startIndent: number, anchors: Record<string, unknown>): ParseResult {
  const result: Record<string, unknown> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }

    const indent = line.search(/\S/)
    if (indent < startIndent) {
      break
    }

    const content = line.trim()

    // Handle list item
    if (content.startsWith('- ')) {
      const arr: unknown[] = []
      while (i < lines.length) {
        const listLine = lines[i]
        if (!listLine.trim() || listLine.trim().startsWith('#')) {
          i++
          continue
        }
        const listIndent = listLine.search(/\S/)
        if (listIndent < startIndent || !listLine.trim().startsWith('-')) {
          break
        }
        const itemContent = listLine.trim().slice(2).trim()
        arr.push(parseYamlValue(itemContent, anchors))
        i++
      }
      return { value: arr, consumed: i }
    }

    // Handle key: value
    const colonIdx = content.indexOf(':')
    if (colonIdx > 0) {
      const key = content.slice(0, colonIdx).trim()
      let valueStr = content.slice(colonIdx + 1).trim()

      // Handle anchor definition: &anchorName
      let anchorName: string | null = null
      const anchorMatch = valueStr.match(/^&(\w+)\s*/)
      if (anchorMatch) {
        anchorName = anchorMatch[1]
        valueStr = valueStr.slice(anchorMatch[0].length)
      }

      // Handle merge: <<: *anchorName
      if (key === '<<') {
        const mergeAliasMatch = valueStr.match(/^\*(\w+)$/)
        if (mergeAliasMatch) {
          const merged = anchors[mergeAliasMatch[1]]
          if (merged && typeof merged === 'object') {
            Object.assign(result, merged)
          }
        }
        i++
        continue
      }

      // Handle alias: *anchorName
      const aliasMatch = valueStr.match(/^\*(\w+)$/)
      if (aliasMatch) {
        result[key] = anchors[aliasMatch[1]]
        i++
        continue
      }

      if (valueStr) {
        // Inline value
        const value = parseYamlValue(valueStr, anchors)
        if (anchorName) {
          anchors[anchorName] = value
        }
        result[key] = value
        i++
      } else {
        // Nested structure
        i++
        const nextIndent = i < lines.length ? lines[i].search(/\S/) : 0
        if (nextIndent > indent) {
          const nested = parseYamlLines(lines.slice(i), nextIndent, anchors)
          if (anchorName) {
            anchors[anchorName] = nested.value
          }
          result[key] = nested.value
          i += nested.consumed
        } else {
          result[key] = null
        }
      }
    } else {
      i++
    }
  }

  return { value: result, consumed: i }
}

/**
 * Parse a single YAML value
 */
function parseYamlValue(str: string, anchors: Record<string, unknown>): unknown {
  const trimmed = str.trim()

  // Handle anchor reference
  if (trimmed.startsWith('*')) {
    return anchors[trimmed.slice(1)]
  }

  // Handle quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  // Detect unclosed quotes - invalid YAML
  if ((trimmed.startsWith('"') && !trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && !trimmed.endsWith("'"))) {
    throw new Error(`Unclosed quote in YAML value: ${trimmed}`)
  }

  // Handle inline array
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1)
    if (!inner.trim()) return []
    return inner.split(',').map((s) => parseYamlValue(s.trim(), anchors))
  }

  // Detect unclosed bracket - invalid YAML
  if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
    throw new Error(`Unclosed bracket in YAML value: ${trimmed}`)
  }

  // Handle inline object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1)
    if (!inner.trim()) return {}
    const obj: Record<string, unknown> = {}
    const pairs = inner.split(',')
    for (const pair of pairs) {
      const [k, v] = pair.split(':').map((s) => s.trim())
      if (k && v !== undefined) {
        obj[k] = parseYamlValue(v, anchors)
      }
    }
    return obj
  }

  // Detect unclosed brace - invalid YAML
  if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
    throw new Error(`Unclosed brace in YAML value: ${trimmed}`)
  }

  // Handle numbers
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed)
  }

  // Handle booleans
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === 'on') {
    return true
  }
  if (trimmed === 'false' || trimmed === 'no' || trimmed === 'off') {
    return false
  }

  // Handle null
  if (trimmed === 'null' || trimmed === '~' || trimmed === '') {
    return null
  }

  // Plain string
  return trimmed
}

/**
 * Convert a JavaScript value to YAML format
 *
 * @param data - Value to stringify
 * @param indent - Current indentation level
 * @returns YAML string representation
 *
 * @example
 * ```typescript
 * stringifyYaml({ name: 'bashx', version: '1.0.0' })
 * // => 'name: bashx\nversion: 1.0.0'
 * ```
 */
export function stringifyYaml(data: unknown, indent: number = 0): string {
  const prefix = '  '.repeat(indent)

  if (data === null || data === undefined) {
    return 'null'
  }

  if (typeof data === 'string') {
    // Quote if contains special characters
    if (/[:\[\]{}"'#|>&*!?]/.test(data) || /^\s|\s$/.test(data)) {
      return JSON.stringify(data)
    }
    return data
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data)
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '[]'
    return data.map((item) => `${prefix}- ${stringifyYaml(item, indent + 1).trimStart()}`).join('\n')
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data)
    if (entries.length === 0) return '{}'

    return entries
      .map(([key, value]) => {
        if (value && typeof value === 'object') {
          return `${prefix}${key}:\n${stringifyYaml(value, indent + 1)}`
        }
        return `${prefix}${key}: ${stringifyYaml(value, indent)}`
      })
      .join('\n')
  }

  return String(data)
}

/**
 * Execute yq command on YAML input
 *
 * @param query - The yq query expression
 * @param input - YAML input string
 * @param options - Execution options
 * @returns Query result as formatted string
 * @throws {Error} On invalid YAML or query errors
 *
 * @example
 * ```typescript
 * executeYq('.name', 'name: bashx\nversion: 1.0.0')
 * // => 'bashx\n'
 *
 * executeYq('.', 'name: bashx', { output: 'json' })
 * // => '{"name":"bashx"}\n'
 * ```
 */
export function executeYq(query: string, input: string, options: YqOptions = {}): string {
  // Parse YAML
  let data: unknown
  try {
    data = parseYaml(input)
  } catch (e) {
    throw new Error(`YAML parse error: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Handle multi-document queries
  const docs = Array.isArray(data) && input.includes('---') ? (data as unknown[]) : [data]

  // Process query
  let result: unknown

  // Handle eval-all
  if (query.startsWith('eval-all ')) {
    query = query.slice(9).trim()
  }

  // Handle document_index selection
  const docIndexMatch = query.match(/select\(document_index\s*==\s*(\d+)\)/)
  if (docIndexMatch) {
    result = docs[parseInt(docIndexMatch[1], 10)]
  } else if (query === '.') {
    result = docs.length === 1 ? docs[0] : docs
  } else if (query.startsWith('.') && query.includes(' = ')) {
    // Assignment
    const [path, valueExpr] = query.split(' = ')
    const pathParts = path.slice(1).split('.')
    const value = parseYamlValue(valueExpr.replace(/^\\?"/, '').replace(/\\?"$/, ''), {})
    result = setPath(docs[0], pathParts, value)
  } else if (query.startsWith('del(')) {
    // Deletion
    const pathMatch = query.match(/del\(\.(\w+)\)/)
    if (pathMatch) {
      const obj = { ...(docs[0] as Record<string, unknown>) }
      delete obj[pathMatch[1]]
      result = obj
    } else {
      result = docs[0]
    }
  } else if (query.startsWith('explode(')) {
    // Explode anchors (already expanded during parse)
    result = docs[0]
  } else if (query.includes(' += ')) {
    // Append to array
    const [path, valueExpr] = query.split(' += ')
    const pathParts = path.slice(1).split('.')
    const arr = getPath(docs[0], path.slice(1)) as unknown[]
    const newItems = JSON.parse(valueExpr.replace(/\\"/g, '"'))
    result = setPath(docs[0], pathParts, [...arr, ...newItems])
  } else {
    // Use jq-style evaluation
    result = defaultJqEngine.evaluate(query, docs[0], { vars: {}, argjson: {} })
  }

  // Format output
  if (options.output === 'json') {
    return options.compact ? JSON.stringify(result) + '\n' : JSON.stringify(result, null, 2) + '\n'
  }

  if (options.output === 'props') {
    return formatAsProps(result)
  }

  if (options.output === 'csv') {
    return formatAsCsv(result)
  }

  // Default YAML output
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return String(result) + '\n'
  }

  return stringifyYaml(result) + '\n'
}

/**
 * Get value at a dot-separated path (for yq)
 */
function getPath(data: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = data

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null
    }
    if (typeof current !== 'object') {
      return null
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current === undefined ? null : current
}

/**
 * Set value at path in object (for yq mutations)
 */
function setPath(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value

  const result = { ...(obj as Record<string, unknown>) }
  const [head, ...rest] = path

  if (rest.length === 0) {
    result[head] = value
  } else {
    result[head] = setPath(result[head], rest, value)
  }

  return result
}

/**
 * Format data as properties file format
 */
function formatAsProps(data: unknown, prefix: string = ''): string {
  const lines: string[] = []

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object') {
        lines.push(formatAsProps(value, path))
      } else {
        lines.push(`${path} = ${value}`)
      }
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Format data as CSV
 */
function formatAsCsv(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item) => (Array.isArray(item) ? item.join(',') : String(item))).join('\n') + '\n'
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const keys = Object.keys(obj)
    const values = Object.values(obj)
    return keys.join(',') + '\n' + values.join(',') + '\n'
  }
  return String(data) + '\n'
}

// ============================================================================
// BASE64 - ENCODING/DECODING
// ============================================================================

/**
 * Options for base64 execution
 */
export interface Base64Options {
  /** Decode mode */
  decode?: boolean
  /** Line wrap width (0 = no wrap, default = 76) */
  wrap?: number
  /** Ignore garbage characters when decoding */
  ignoreGarbage?: boolean
  /** URL-safe mode (use - and _ instead of + and /) */
  urlSafe?: boolean
}

/**
 * Custom error for base64 encoding/decoding errors
 */
export class Base64Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base64Error'
  }
}

/**
 * Execute base64 encoding or decoding
 *
 * @param input - Input string to encode/decode
 * @param options - Encoding/decoding options
 * @returns Encoded or decoded string
 * @throws {Base64Error} On invalid base64 input during decoding
 *
 * @example
 * ```typescript
 * // Encode
 * executeBase64('Hello, World!')
 * // => 'SGVsbG8sIFdvcmxkIQ==\n'
 *
 * // Decode
 * executeBase64('SGVsbG8sIFdvcmxkIQ==', { decode: true })
 * // => 'Hello, World!'
 * ```
 */
export function executeBase64(input: string, options: Base64Options = {}): string {
  if (options.decode) {
    return decodeBase64(input, options)
  }
  return encodeBase64(input, options)
}

/**
 * Encode string to base64
 */
function encodeBase64(input: string, options: Base64Options): string {
  let encoded: string

  if (options.urlSafe) {
    // URL-safe base64
    encoded = btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } else {
    encoded = btoa(input)
  }

  // Apply line wrapping
  const wrap = options.wrap ?? 76
  if (wrap > 0 && encoded.length > wrap) {
    const lines: string[] = []
    for (let i = 0; i < encoded.length; i += wrap) {
      lines.push(encoded.slice(i, i + wrap))
    }
    return lines.join('\n') + '\n'
  }

  return encoded + '\n'
}

/**
 * Decode base64 string
 */
function decodeBase64(input: string, options: Base64Options): string {
  let cleaned = input.replace(/\s/g, '')

  if (options.ignoreGarbage) {
    if (options.urlSafe) {
      cleaned = cleaned.replace(/[^A-Za-z0-9\-_=]/g, '')
    } else {
      cleaned = cleaned.replace(/[^A-Za-z0-9+/=]/g, '')
    }
    // For standard base64, truncate at padding
    if (!options.urlSafe) {
      const paddingMatch = cleaned.match(/^[A-Za-z0-9+/]*(={0,2})/)
      if (paddingMatch) {
        cleaned = paddingMatch[0]
      }
    }
  }

  if (options.urlSafe) {
    cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/')
    while (cleaned.length % 4 !== 0) {
      cleaned += '='
    }
  }

  // Validate base64
  if (!options.ignoreGarbage && !options.urlSafe && !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Base64Error('invalid base64 input')
  }

  try {
    return atob(cleaned)
  } catch {
    if (options.urlSafe) {
      return ''
    }
    throw new Base64Error('invalid base64 input')
  }
}

// ============================================================================
// ENVSUBST - ENVIRONMENT VARIABLE SUBSTITUTION
// ============================================================================

/**
 * Options for envsubst execution
 */
export interface EnvsubstOptions {
  /** Environment variables to use for substitution */
  env: Record<string, string>
  /** Only substitute these specific variables (if specified) */
  variables?: string[]
  /** List variables mode - return list of variables found in template */
  listVariables?: boolean
}

/**
 * Custom error for envsubst errors (e.g., required variable missing)
 */
export class EnvsubstError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvsubstError'
  }
}

/**
 * Execute environment variable substitution
 *
 * Supports:
 * - $VAR and ${VAR} syntax
 * - ${VAR:-default} - use default if unset/empty
 * - ${VAR:+alternate} - use alternate if set and non-empty
 * - ${VAR:?error} - error if unset/empty
 * - ${VAR:=default} - use default if unset/empty (assignment)
 * - $$ escape sequence for literal $
 *
 * @param template - Template string with variable references
 * @param options - Substitution options including env vars
 * @returns Substituted string
 * @throws {EnvsubstError} On ${VAR:?error} with missing variable
 *
 * @example
 * ```typescript
 * executeEnvsubst('Hello, $NAME!', { env: { NAME: 'World' } })
 * // => 'Hello, World!'
 *
 * executeEnvsubst('${VAR:-default}', { env: {} })
 * // => 'default'
 * ```
 */
export function executeEnvsubst(template: string, options: EnvsubstOptions): string {
  const { env, variables, listVariables } = options

  if (listVariables) {
    const vars = extractVariables(template)
    return vars.join('\n') + '\n'
  }

  return substituteVariables(template, env, variables)
}

/**
 * Extract variable names from template
 */
function extractVariables(template: string): string[] {
  const vars = new Set<string>()

  const bracedPattern = /\$\{([A-Z_][A-Z0-9_]*)(:[^}]+)?\}/gi
  const simplePattern = /\$([A-Z_][A-Z0-9_]*)/gi

  let match
  while ((match = bracedPattern.exec(template)) !== null) {
    vars.add(match[1])
  }
  while ((match = simplePattern.exec(template)) !== null) {
    vars.add(match[1])
  }

  return Array.from(vars)
}

/**
 * Substitute variables in template
 */
function substituteVariables(template: string, env: Record<string, string>, onlyVars?: string[]): string {
  let result = template

  // Handle escaped dollar signs: $$ -> $
  result = result.replace(/\$\$/g, '\x00ESCAPED_DOLLAR\x00')

  // Handle ${VAR:modifier} patterns
  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*)(:[^}]+)?\}/gi, (match, varName, modifier) => {
    if (onlyVars && !onlyVars.includes(varName)) {
      return match
    }

    const value = env[varName]
    const isEmpty = value === undefined || value === ''

    if (modifier) {
      const modType = modifier.slice(1, 2)
      const modValue = modifier.slice(2)

      switch (modType) {
        case '-':
          return isEmpty ? modValue : value
        case '+':
          return isEmpty ? '' : modValue
        case '?':
          if (isEmpty) {
            throw new EnvsubstError(`${varName}: ${modValue}`)
          }
          return value
        case '=':
          return isEmpty ? modValue : value
        default:
          return value ?? ''
      }
    }

    return value ?? ''
  })

  // Handle simple $VAR patterns
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (match, varName) => {
    if (onlyVars && !onlyVars.includes(varName)) {
      return match
    }
    return env[varName] ?? ''
  })

  // Restore escaped dollar signs
  result = result.replace(/\x00ESCAPED_DOLLAR\x00/g, '$')

  return result
}

// ============================================================================
// COMMAND PARSING HELPERS
// ============================================================================

/**
 * Parse jq command line arguments
 *
 * @param args - Array of command line arguments
 * @returns Parsed query, file path, and options
 *
 * @example
 * ```typescript
 * parseJqArgs(['-r', '.name', 'file.json'])
 * // => { query: '.name', file: 'file.json', options: { raw: true } }
 * ```
 */
export function parseJqArgs(
  args: string[]
): { query: string; file?: string; options: JqOptions } {
  const options: JqOptions = {
    args: {},
    argjson: {},
  }
  let query = ''
  let file: string | undefined
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '-r' || arg === '--raw-output') {
      options.raw = true
    } else if (arg === '-c' || arg === '--compact-output') {
      options.compact = true
    } else if (arg === '-s' || arg === '--slurp') {
      options.slurp = true
    } else if (arg === '-t' || arg === '--tab') {
      options.tab = true
    } else if (arg === '--arg' && i + 2 < args.length) {
      const name = args[++i]
      const value = args[++i]
      options.args![name] = value
    } else if (arg === '--argjson' && i + 2 < args.length) {
      const name = args[++i]
      const value = args[++i]
      options.argjson![name] = JSON.parse(value)
    } else if (!arg.startsWith('-') && !query) {
      query = arg
    } else if (!arg.startsWith('-')) {
      file = arg
    }

    i++
  }

  return { query, file, options }
}

/**
 * Parse yq command line arguments
 *
 * @param args - Array of command line arguments
 * @returns Parsed query, file path, and options
 */
export function parseYqArgs(
  args: string[]
): { query: string; file?: string; options: YqOptions } {
  const options: YqOptions = {}
  let query = ''
  let file: string | undefined
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '-o' && i + 1 < args.length) {
      const format = args[++i]
      if (format === 'json' || format === 'yaml' || format === 'props' || format === 'csv') {
        options.output = format
      }
    } else if (arg === '-c' || arg === '--compact-output') {
      options.compact = true
    } else if (arg === '-i' || arg === '--inplace') {
      options.inPlace = true
    } else if (arg === 'eval-all') {
      query = 'eval-all ' + (args[i + 1] || '.')
      i++
    } else if (!arg.startsWith('-') && !query) {
      query = arg
    } else if (!arg.startsWith('-')) {
      file = arg
    }

    i++
  }

  return { query: query || '.', file, options }
}

/**
 * Parse base64 command line arguments
 *
 * @param args - Array of command line arguments
 * @returns Parsed file path and options
 */
export function parseBase64Args(args: string[]): { file?: string; options: Base64Options } {
  const options: Base64Options = {}
  let file: string | undefined
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '-d' || arg === '--decode' || arg === '-D') {
      options.decode = true
    } else if (arg === '-w' && i + 1 < args.length) {
      options.wrap = parseInt(args[++i], 10)
    } else if (arg.startsWith('-w')) {
      options.wrap = parseInt(arg.slice(2), 10)
    } else if (arg === '-i' || arg === '--ignore-garbage') {
      options.ignoreGarbage = true
    } else if (arg === '--url') {
      options.urlSafe = true
    } else if (!arg.startsWith('-')) {
      file = arg
    }

    i++
  }

  return { file, options }
}

/**
 * Parse envsubst command line arguments
 *
 * @param args - Array of command line arguments
 * @param env - Environment variables
 * @returns Parsed options and input redirect path
 */
export function parseEnvsubstArgs(
  args: string[],
  env: Record<string, string>
): { options: EnvsubstOptions; inputRedirect?: string } {
  const options: EnvsubstOptions = { env }
  let inputRedirect: string | undefined
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--variables' || arg === '-v') {
      options.listVariables = true
    } else if (arg === '<' && i + 1 < args.length) {
      inputRedirect = args[++i]
    } else if (arg.startsWith('$')) {
      options.variables = arg
        .split(/\s+/)
        .filter((v) => v.startsWith('$'))
        .map((v) => v.slice(1))
    } else if (!arg.startsWith('-')) {
      if (arg.includes('$')) {
        options.variables = arg
          .split(/\s+/)
          .filter((v) => v.startsWith('$'))
          .map((v) => v.slice(1))
      }
    }

    i++
  }

  return { options, inputRedirect }
}
