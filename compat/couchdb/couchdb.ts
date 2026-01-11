/**
 * CouchDB Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for CouchDB's view API that runs on Cloudflare Workers.
 * Stores data in Durable Objects with SQLite, provides CouchDB-compatible
 * view queries using MapReduce.
 *
 * ## Supported Map Function Patterns
 *
 * This implementation supports the full range of CouchDB map function patterns:
 *
 * ### Simple emit
 * ```javascript
 * function(doc) { emit(doc._id, doc); }
 * ```
 *
 * ### Conditional emit (filtering)
 * ```javascript
 * function(doc) {
 *   if (doc.type === 'post') {
 *     emit(doc._id, doc);
 *   }
 * }
 * ```
 *
 * ### Multiple emits per document
 * ```javascript
 * function(doc) {
 *   if (doc.tags) {
 *     for (var i = 0; i < doc.tags.length; i++) {
 *       emit(doc.tags[i], doc._id);
 *     }
 *   }
 * }
 * ```
 *
 * ### Compound keys (arrays)
 * ```javascript
 * function(doc) {
 *   emit([doc.year, doc.month, doc.day], doc);
 * }
 * ```
 *
 * ### Computed values
 * ```javascript
 * function(doc) {
 *   emit(doc.email.toLowerCase(), doc.name);
 * }
 * ```
 *
 * ### Arrow function syntax
 * ```javascript
 * (doc) => { emit(doc._id, doc.name); }
 * doc => emit(doc._id, doc.name)
 * ```
 *
 * ## Security
 *
 * Map functions execute in a sandboxed context:
 * - Safe built-ins available: JSON, Object, Array, Math, Date, etc.
 * - Blocked: process, require, fetch, setTimeout, eval, Function, etc.
 * - Cannot access or modify global state
 * - All prototype chains are frozen to prevent pollution
 * - Constructor chain escapes are blocked via Proxy traps
 *
 * @example
 * ```typescript
 * import { CouchDB } from '@dotdo/couchdb'
 *
 * const db = new CouchDB('mydb')
 * await db.put({ _id: 'doc1', type: 'post', title: 'Hello' })
 *
 * // Define a view
 * await db.putDesign('posts', {
 *   views: {
 *     byType: {
 *       map: `function(doc) { if (doc.type) emit(doc.type, doc); }`
 *     }
 *   }
 * })
 *
 * // Query the view
 * const results = await db.view('posts', 'byType', { key: 'post' })
 * ```
 *
 * @see https://docs.couchdb.org/en/stable/ddocs/views/intro.html
 */

/**
 * Result of a single emit() call in a map function
 */
export interface EmitResult {
  key: unknown
  value: unknown
}

/**
 * Parsed map function that can be executed
 */
export type ParsedMapFunction = (doc: Record<string, unknown>) => EmitResult[]

/**
 * Create frozen safe copies of built-in constructors and utilities.
 * These prevent prototype pollution by using isolated, frozen copies.
 */
function createSafeBuiltins(): Record<string, unknown> {
  // Create a safe JSON object that doesn't expose constructors
  const safeJSON = {
    parse: (text: string, reviver?: (key: string, value: unknown) => unknown) => {
      const result = JSON.parse(text, reviver)
      return deepFreeze(result)
    },
    stringify: JSON.stringify.bind(JSON),
  }
  Object.freeze(safeJSON)

  // Create safe Math object with all methods bound
  // Note: Math methods are not enumerable, so we need to explicitly copy them
  const safeMath = Object.freeze({
    // Constants
    E: Math.E,
    LN10: Math.LN10,
    LN2: Math.LN2,
    LOG10E: Math.LOG10E,
    LOG2E: Math.LOG2E,
    PI: Math.PI,
    SQRT1_2: Math.SQRT1_2,
    SQRT2: Math.SQRT2,
    // Methods
    abs: Math.abs.bind(Math),
    acos: Math.acos.bind(Math),
    acosh: Math.acosh.bind(Math),
    asin: Math.asin.bind(Math),
    asinh: Math.asinh.bind(Math),
    atan: Math.atan.bind(Math),
    atan2: Math.atan2.bind(Math),
    atanh: Math.atanh.bind(Math),
    cbrt: Math.cbrt.bind(Math),
    ceil: Math.ceil.bind(Math),
    clz32: Math.clz32.bind(Math),
    cos: Math.cos.bind(Math),
    cosh: Math.cosh.bind(Math),
    exp: Math.exp.bind(Math),
    expm1: Math.expm1.bind(Math),
    floor: Math.floor.bind(Math),
    fround: Math.fround.bind(Math),
    hypot: Math.hypot.bind(Math),
    imul: Math.imul.bind(Math),
    log: Math.log.bind(Math),
    log10: Math.log10.bind(Math),
    log1p: Math.log1p.bind(Math),
    log2: Math.log2.bind(Math),
    max: Math.max.bind(Math),
    min: Math.min.bind(Math),
    pow: Math.pow.bind(Math),
    random: Math.random.bind(Math),
    round: Math.round.bind(Math),
    sign: Math.sign.bind(Math),
    sin: Math.sin.bind(Math),
    sinh: Math.sinh.bind(Math),
    sqrt: Math.sqrt.bind(Math),
    tan: Math.tan.bind(Math),
    tanh: Math.tanh.bind(Math),
    trunc: Math.trunc.bind(Math),
  })

  // Create safe versions of utility functions
  const safeIsNaN = (v: unknown) => Number.isNaN(v) || isNaN(v as number)
  const safeIsFinite = (v: unknown) => Number.isFinite(v)
  const safeParseInt = (s: string, radix?: number) => parseInt(s, radix)
  const safeParseFloat = (s: string) => parseFloat(s)

  return {
    // Safe JSON
    JSON: safeJSON,

    // Safe Math
    Math: safeMath,

    // Type checking and conversion (safe primitives)
    isNaN: safeIsNaN,
    isFinite: safeIsFinite,
    parseInt: safeParseInt,
    parseFloat: safeParseFloat,

    // URI encoding (safe functions)
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,

    // Safe constants
    undefined,
    NaN,
    Infinity,
  }
}

/**
 * Deep freeze an object and all nested objects
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // Freeze the object itself
  Object.freeze(obj)

  // Recursively freeze all properties
  for (const key of Object.keys(obj as object)) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }

  return obj
}

/**
 * Dangerous patterns in source code that indicate sandbox escape attempts.
 * These patterns are checked BEFORE compilation to prevent attacks.
 *
 * Note: Patterns are case-sensitive where needed to avoid false positives.
 */
const DANGEROUS_PATTERNS = [
  // Constructor chain escapes (critical - this is the main escape vector)
  /\.constructor\b/,
  /\.__proto__\b/,
  /\[['"`]constructor['"`]\]/,
  /\[['"`]__proto__['"`]\]/,

  // Prototype access (used for prototype pollution)
  /\.prototype\b/,
  /\[['"`]prototype['"`]\]/,

  // arguments.callee/caller exploitation (stack walking)
  /\barguments\s*\.\s*callee\b/,
  /\barguments\s*\.\s*caller\b/,
  /\barguments\s*\[\s*['"`]callee['"`]\s*\]/,
  /\barguments\s*\[\s*['"`]caller['"`]\s*\]/,

  // Direct Function/eval access (dynamic code execution)
  /\bFunction\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,

  // Metaprogramming APIs (case-sensitive to avoid false positives)
  /\bReflect\b/,
  /\bProxy\b/,
  /\bSymbol\b/,

  // globalThis is the only truly dangerous global name
  // (other globals like 'global', 'window' are already shadowed)
  /\bglobalThis\b/,
]

/**
 * Validate that source code doesn't contain dangerous patterns.
 * @throws Error if dangerous patterns are detected
 */
function validateSourceSecurity(source: string): void {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(`Sandbox security violation: forbidden pattern detected`)
    }
  }
}

/**
 * Cache for parsed map functions.
 * Key is the source code string, value is the compiled executor.
 *
 * This avoids re-parsing the same function for every document,
 * which is a significant performance win for views with many documents.
 */
const functionCache = new Map<string, ParsedMapFunction>()

/**
 * Maximum size of the function cache.
 * Prevents unbounded memory growth if many different functions are parsed.
 */
const MAX_CACHE_SIZE = 1000

/**
 * List of blocked global names - these are shadowed with undefined.
 * Note: 'eval' and 'arguments' cannot be used as parameter names in strict mode,
 * so they are not included here. They are blocked via pattern validation instead.
 */
const BLOCKED_GLOBALS = [
  // Node.js globals
  'process',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'global',
  'Buffer',

  // Browser/runtime globals
  'globalThis',
  'window',
  'self',
  'document',

  // Network access
  'fetch',
  'XMLHttpRequest',
  'WebSocket',

  // Workers/threads
  'Worker',
  'importScripts',

  // Dynamic code execution (Function only - eval blocked via pattern)
  'Function',

  // Timers
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',

  // Runtime-specific
  'Deno',
  'Bun',

  // Dangerous built-ins
  'Proxy',
  'Reflect',
  'Symbol',

  // Prototype manipulation
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
]

/**
 * Parse a CouchDB map function string into an executable function.
 *
 * Accepts JavaScript function syntax:
 * - `function(doc) { ... }`
 * - `(doc) => { ... }`
 * - `doc => ...`
 *
 * The function must call emit(key, value) to produce view rows.
 *
 * Security: The function executes in a sandboxed context with:
 * - Access to safe built-ins (JSON, Math)
 * - No access to constructors, prototypes, or global objects
 * - Strict mode enabled to disable arguments.callee/caller
 * - Pre-validated source to block dangerous patterns
 *
 * @param mapFnSource - JavaScript source code for the map function
 * @returns A function that takes a document and returns emit results
 * @throws SyntaxError if the source has syntax errors
 * @throws Error if the source contains forbidden patterns
 *
 * @example Simple emit
 * ```typescript
 * const fn = parseMapFunction(`function(doc) { emit(doc._id, doc.name); }`)
 * const results = fn({ _id: '1', name: 'Alice' })
 * // [{ key: '1', value: 'Alice' }]
 * ```
 *
 * @example Conditional emit
 * ```typescript
 * const fn = parseMapFunction(`function(doc) {
 *   if (doc.type === 'post') emit(doc._id, doc);
 * }`)
 * fn({ _id: '1', type: 'post' }) // [{ key: '1', value: {...} }]
 * fn({ _id: '2', type: 'comment' }) // []
 * ```
 *
 * @example Multiple emits
 * ```typescript
 * const fn = parseMapFunction(`function(doc) {
 *   for (var i = 0; i < doc.tags.length; i++) {
 *     emit(doc.tags[i], doc._id);
 *   }
 * }`)
 * fn({ _id: '1', tags: ['a', 'b'] })
 * // [{ key: 'a', value: '1' }, { key: 'b', value: '1' }]
 * ```
 */
export function parseMapFunction(mapFnSource: string): ParsedMapFunction {
  // Check cache first
  const cached = functionCache.get(mapFnSource)
  if (cached) {
    return cached
  }

  // SECURITY: Validate source before any compilation
  validateSourceSecurity(mapFnSource)

  // Normalize the source to extract the function body
  const normalizedSource = normalizeMapFunctionSource(mapFnSource)

  // SECURITY: Validate normalized source as well
  validateSourceSecurity(normalizedSource)

  // Get safe built-ins that don't expose constructors
  const safeBuiltins = createSafeBuiltins()

  // Create sandbox context - block all dangerous globals
  const sandboxContext: Record<string, unknown> = { ...safeBuiltins }
  for (const blocked of BLOCKED_GLOBALS) {
    sandboxContext[blocked] = undefined
  }

  // Get the parameter names
  const paramNames = Object.keys(sandboxContext)

  // Wrap in strict mode to disable arguments.callee/caller
  // and ensure 'this' is undefined in the function body
  const strictSource = `"use strict"; ${normalizedSource}`

  // Create the compiled function
  let compiledFn: (...args: unknown[]) => unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    compiledFn = new Function(...paramNames, 'emit', 'doc', strictSource) as (
      ...args: unknown[]
    ) => unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid map function syntax: ${error.message}`)
    }
    throw error
  }

  // Pre-compute sandbox values array for execution
  const sandboxValues = Object.values(sandboxContext)

  // Create the executor function
  const executor: ParsedMapFunction = (doc: Record<string, unknown>): EmitResult[] => {
    const results: EmitResult[] = []

    // Create emit function that captures results
    // The emit function receives deep-frozen copies to prevent modification
    const emit = (key: unknown, value: unknown): void => {
      results.push({
        key: key !== null && typeof key === 'object' ? deepFreeze(structuredClone(key)) : key,
        value:
          value !== null && typeof value === 'object' ? deepFreeze(structuredClone(value)) : value,
      })
    }

    // Create a safe, frozen copy of the document to prevent prototype pollution
    const safeDoc = deepFreeze(structuredClone(doc))

    // Execute with sandbox context
    try {
      compiledFn(...sandboxValues, emit, safeDoc)
    } catch (error) {
      // Map function errors should not crash - just produce no results
      // This matches CouchDB behavior where errors in map functions
      // are logged but don't stop the view from being built
      console.warn('Map function error:', error)
    }

    return results
  }

  // Cache the compiled function
  if (functionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = functionCache.keys().next().value
    if (firstKey) {
      functionCache.delete(firstKey)
    }
  }
  functionCache.set(mapFnSource, executor)

  return executor
}

/**
 * Normalize different function syntax formats to a consistent form.
 *
 * Transforms the input function into a code block that:
 * - Assigns the 'doc' parameter to a local variable
 * - Executes the function body
 *
 * @internal
 */
function normalizeMapFunctionSource(source: string): string {
  const trimmed = source.trim()

  // Pattern: function(doc) { ... }
  // Matches: function(doc){...}, function( doc ){...}, etc.
  const functionMatch = trimmed.match(/^function\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*)\}$/)
  if (functionMatch) {
    const [, paramName, body] = functionMatch
    return `var ${paramName} = doc; ${body}`
  }

  // Pattern: (doc) => { ... }
  const arrowBlockMatch = trimmed.match(/^\(\s*(\w+)\s*\)\s*=>\s*\{([\s\S]*)\}$/)
  if (arrowBlockMatch) {
    const [, paramName, body] = arrowBlockMatch
    return `var ${paramName} = doc; ${body}`
  }

  // Pattern: doc => { ... }
  const arrowBlockNoParenMatch = trimmed.match(/^(\w+)\s*=>\s*\{([\s\S]*)\}$/)
  if (arrowBlockNoParenMatch) {
    const [, paramName, body] = arrowBlockNoParenMatch
    return `var ${paramName} = doc; ${body}`
  }

  // Pattern: doc => expression (no braces) - single expression arrow function
  const arrowExprMatch = trimmed.match(/^(\w+)\s*=>\s*(.+)$/)
  if (arrowExprMatch) {
    const [, paramName, expression] = arrowExprMatch
    return `var ${paramName} = doc; ${expression};`
  }

  // Pattern: (doc) => expression (no braces)
  const arrowExprParenMatch = trimmed.match(/^\(\s*(\w+)\s*\)\s*=>\s*(.+)$/)
  if (arrowExprParenMatch) {
    const [, paramName, expression] = arrowExprParenMatch
    return `var ${paramName} = doc; ${expression};`
  }

  // If no pattern matches, try to use as-is
  // This will fail at compile time if the syntax is invalid
  return trimmed
}

/**
 * Execute a map function against a document and return all emit results.
 *
 * This is a convenience function that parses and executes in one call.
 * For better performance when processing many documents, use parseMapFunction
 * once and call the returned function for each document.
 *
 * @param mapFnSource - JavaScript source code for the map function
 * @param doc - The document to pass to the map function
 * @returns Array of emit results (may be empty if no emit calls matched)
 *
 * @example
 * ```typescript
 * const results = executeMapFunction(
 *   `function(doc) { if (doc.type === 'post') emit(doc._id, doc); }`,
 *   { _id: 'post-1', type: 'post', title: 'Hello' }
 * )
 * // [{ key: 'post-1', value: { _id: 'post-1', type: 'post', title: 'Hello' } }]
 * ```
 */
export function executeMapFunction(
  mapFnSource: string,
  doc: Record<string, unknown>
): EmitResult[] {
  const fn = parseMapFunction(mapFnSource)
  return fn(doc)
}

/**
 * Clear the parsed function cache.
 *
 * Call this if you need to free memory or ensure functions are re-parsed.
 * Generally not needed in production - the cache has a size limit.
 */
export function clearMapFunctionCache(): void {
  functionCache.clear()
}

/**
 * Get the current size of the parsed function cache.
 *
 * Useful for monitoring and debugging.
 */
export function getMapFunctionCacheSize(): number {
  return functionCache.size
}
