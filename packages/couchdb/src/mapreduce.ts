/**
 * CouchDB MapReduce Engine
 *
 * Sandboxed execution of CouchDB map functions with emit().
 * Ported from compat/couchdb/couchdb.ts with improvements.
 *
 * Security features:
 * - Pattern-based validation to detect dangerous code before compilation
 * - Strict mode to disable arguments.callee/caller
 * - Deep-frozen document copies to prevent prototype pollution
 * - Blocked globals for all dangerous runtime APIs
 */

import type { CouchDocument, EmitResult, ParsedMapFunction } from './types'

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
 */
const DANGEROUS_PATTERNS = [
  // Constructor chain escapes
  /\.constructor\b/,
  /\.__proto__\b/,
  /\[['"`]constructor['"`]\]/,
  /\[['"`]__proto__['"`]\]/,

  // Prototype access
  /\.prototype\b/,
  /\[['"`]prototype['"`]\]/,

  // arguments.callee/caller exploitation
  /\barguments\s*\.\s*callee\b/,
  /\barguments\s*\.\s*caller\b/,
  /\barguments\s*\[\s*['"`]callee['"`]\s*\]/,
  /\barguments\s*\[\s*['"`]caller['"`]\s*\]/,

  // Direct Function/eval access
  /\bFunction\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,

  // Metaprogramming APIs
  /\bReflect\b/,
  /\bProxy\b/,
  /\bSymbol\b/,

  // globalThis
  /\bglobalThis\b/,
]

/**
 * Validate that source code doesn't contain dangerous patterns.
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
 */
const functionCache = new Map<string, ParsedMapFunction>()

/**
 * Maximum size of the function cache.
 */
const MAX_CACHE_SIZE = 1000

/**
 * List of blocked global names
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
 */
export function parseMapFunction(mapFnSource: string): ParsedMapFunction {
  // Check cache first
  const cached = functionCache.get(mapFnSource)
  if (cached) {
    return cached
  }

  // Validate source before any compilation
  validateSourceSecurity(mapFnSource)

  // Normalize the source to extract the function body
  const normalizedSource = normalizeMapFunctionSource(mapFnSource)

  // Validate normalized source as well
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

  // Wrap in strict mode
  const strictSource = `"use strict"; ${normalizedSource}`

  // Create the compiled function
  let compiledFn: (...args: unknown[]) => unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    compiledFn = new Function(...paramNames, 'emit', 'doc', strictSource) as (...args: unknown[]) => unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid map function syntax: ${error.message}`)
    }
    throw error
  }

  // Pre-compute sandbox values array for execution
  const sandboxValues = Object.values(sandboxContext)

  // Create the executor function
  const executor: ParsedMapFunction = (doc: CouchDocument): EmitResult[] => {
    const results: EmitResult[] = []

    // Create emit function that captures results
    const emit = (key: unknown, value: unknown): void => {
      results.push({
        key: key !== null && typeof key === 'object' ? deepFreeze(structuredClone(key)) : key,
        value: value !== null && typeof value === 'object' ? deepFreeze(structuredClone(value)) : value,
      })
    }

    // Create a safe, frozen copy of the document
    const safeDoc = deepFreeze(structuredClone(doc))

    // Execute with sandbox context
    try {
      compiledFn(...sandboxValues, emit, safeDoc)
    } catch (error) {
      // Map function errors should not crash - just produce no results
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
 */
function normalizeMapFunctionSource(source: string): string {
  const trimmed = source.trim()

  // Pattern: function(doc) { ... }
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

  // Pattern: doc => expression
  const arrowExprMatch = trimmed.match(/^(\w+)\s*=>\s*(.+)$/)
  if (arrowExprMatch) {
    const [, paramName, expression] = arrowExprMatch
    return `var ${paramName} = doc; ${expression};`
  }

  // Pattern: (doc) => expression
  const arrowExprParenMatch = trimmed.match(/^\(\s*(\w+)\s*\)\s*=>\s*(.+)$/)
  if (arrowExprParenMatch) {
    const [, paramName, expression] = arrowExprParenMatch
    return `var ${paramName} = doc; ${expression};`
  }

  return trimmed
}

/**
 * Execute a map function against a document and return all emit results.
 */
export function executeMapFunction(mapFnSource: string, doc: CouchDocument): EmitResult[] {
  const fn = parseMapFunction(mapFnSource)
  return fn(doc)
}

/**
 * Clear the parsed function cache.
 */
export function clearMapFunctionCache(): void {
  functionCache.clear()
}

/**
 * Get the current size of the parsed function cache.
 */
export function getMapFunctionCacheSize(): number {
  return functionCache.size
}

/**
 * Apply a built-in reduce function
 */
export function applyReduce(
  reduceFn: string | '_count' | '_sum' | '_stats',
  values: unknown[]
): unknown {
  switch (reduceFn) {
    case '_count':
      return values.length

    case '_sum':
      return values.reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0)

    case '_stats':
      const nums = values.filter((v) => typeof v === 'number') as number[]
      if (nums.length === 0) {
        return { sum: 0, count: 0, min: 0, max: 0, sumsqr: 0 }
      }
      return {
        sum: nums.reduce((a, b) => a + b, 0),
        count: nums.length,
        min: Math.min(...nums),
        max: Math.max(...nums),
        sumsqr: nums.reduce((a, b) => a + b * b, 0),
      }

    default:
      // Custom reduce functions would need to be executed in sandbox
      throw new Error(`Custom reduce functions not yet implemented: ${reduceFn}`)
  }
}
