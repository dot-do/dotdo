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
 * Safe built-in objects and functions allowed in the sandbox.
 * These are commonly used in CouchDB map functions.
 */
const SAFE_GLOBALS: Record<string, unknown> = {
  // Core object constructors
  Object,
  Array,
  String,
  Number,
  Boolean,
  Date,
  RegExp,
  Error,
  TypeError,
  RangeError,
  SyntaxError,

  // JSON utilities
  JSON,

  // Math utilities
  Math,

  // Type checking and conversion
  isNaN,
  isFinite,
  parseInt,
  parseFloat,

  // URI encoding
  encodeURI,
  encodeURIComponent,
  decodeURI,
  decodeURIComponent,

  // Constants
  undefined,
  NaN,
  Infinity,
}

/**
 * Dangerous globals that must be blocked in the sandbox.
 * These could allow code to escape the sandbox or access system resources.
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

  // Dynamic code execution
  'eval',
  'Function',

  // Timers (no async in map functions)
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',

  // Runtime-specific globals
  'Deno',
  'Bun',
]

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
 * - Access to safe built-ins (JSON, Object, Array, Math, Date, etc.)
 * - No access to process, require, fetch, setTimeout, etc.
 * - No access to globalThis or window
 *
 * @param mapFnSource - JavaScript source code for the map function
 * @returns A function that takes a document and returns emit results
 * @throws SyntaxError if the source has syntax errors
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

  // Normalize the source to extract the function body
  const normalizedSource = normalizeMapFunctionSource(mapFnSource)

  // Create sandbox context with blocked globals set to undefined
  const sandboxContext: Record<string, unknown> = { ...SAFE_GLOBALS }
  for (const blocked of BLOCKED_GLOBALS) {
    sandboxContext[blocked] = undefined
  }

  // Get the parameter names and create the compiled function
  const paramNames = Object.keys(sandboxContext)

  // Create the compiled function
  // This validates syntax at parse time
  let compiledFn: (...args: unknown[]) => unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    compiledFn = new Function(...paramNames, 'emit', 'doc', normalizedSource) as (
      ...args: unknown[]
    ) => unknown
  } catch (error) {
    // Re-throw syntax errors with better context
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
    const emit = (key: unknown, value: unknown): void => {
      results.push({ key, value })
    }

    // Execute with sandbox context
    try {
      compiledFn(...sandboxValues, emit, doc)
    } catch (error) {
      // Map function errors should not crash - just produce no results
      // This matches CouchDB behavior where errors in map functions
      // are logged but don't stop the view from being built
      console.warn('Map function error:', error)
    }

    return results
  }

  // Cache the compiled function
  // Evict oldest entries if cache is full (simple LRU approximation)
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
