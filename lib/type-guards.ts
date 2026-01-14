/**
 * Type Guards - Common type guard utilities for safe type narrowing
 *
 * This module provides type-safe alternatives to `as unknown as` patterns,
 * enabling proper runtime type checking with TypeScript type narrowing.
 *
 * @example
 * ```typescript
 * // Instead of: payload as unknown as Record<string, unknown>
 * if (isRecord(payload)) {
 *   // payload is now Record<string, unknown>
 *   console.log(payload.someKey)
 * }
 *
 * // For dynamic property access
 * const value = getProperty(obj, 'field')
 * ```
 */

// ============================================================================
// PRIMITIVE TYPE GUARDS
// ============================================================================

/**
 * Check if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Check if value is a number (and not NaN)
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

/**
 * Check if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Check if value is null
 */
export function isNull(value: unknown): value is null {
  return value === null
}

/**
 * Check if value is undefined
 */
export function isUndefined(value: unknown): value is undefined {
  return value === undefined
}

/**
 * Check if value is null or undefined
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/**
 * Check if value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

/**
 * Check if value is a symbol
 */
export function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol'
}

/**
 * Check if value is a bigint
 */
export function isBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint'
}

// ============================================================================
// FUNCTION TYPE GUARDS
// ============================================================================

/**
 * Check if value is a function
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

/**
 * Check if value is an async function
 */
export function isAsyncFunction(value: unknown): value is (...args: unknown[]) => Promise<unknown> {
  return (
    typeof value === 'function' &&
    (value.constructor.name === 'AsyncFunction' ||
      Object.prototype.toString.call(value) === '[object AsyncFunction]')
  )
}

// ============================================================================
// OBJECT TYPE GUARDS
// ============================================================================

/**
 * Check if value is a plain object (not null, not array)
 */
export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check if value is a Record<string, unknown> (plain object)
 *
 * This is the primary replacement for `as unknown as Record<string, unknown>`
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check if value is a Record with specific key types
 */
export function isRecordOf<T>(
  value: unknown,
  valueGuard: (v: unknown) => v is T
): value is Record<string, T> {
  if (!isRecord(value)) return false
  return Object.values(value).every(valueGuard)
}

/**
 * Check if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Check if value is an array of a specific type
 */
export function isArrayOf<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(itemGuard)
}

/**
 * Check if value is a non-empty array
 */
export function isNonEmptyArray<T>(value: T[]): value is [T, ...T[]] {
  return value.length > 0
}

/**
 * Check if value is a Date object
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * Check if value is a RegExp
 */
export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp
}

/**
 * Check if value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * Check if value is a Promise
 */
export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return (
    value instanceof Promise ||
    (isObject(value) && isFunction((value as { then?: unknown }).then))
  )
}

/**
 * Check if value is a Map
 */
export function isMap<K = unknown, V = unknown>(value: unknown): value is Map<K, V> {
  return value instanceof Map
}

/**
 * Check if value is a Set
 */
export function isSet<T = unknown>(value: unknown): value is Set<T> {
  return value instanceof Set
}

// ============================================================================
// PROPERTY ACCESS HELPERS
// ============================================================================

/**
 * Safely get a property from an object with unknown type
 *
 * This is a type-safe alternative to:
 * `(item as unknown as Record<string, unknown>)[field]`
 */
export function getProperty(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined
  return obj[key]
}

/**
 * Safely get a nested property from an object using a path
 *
 * @example
 * getNestedProperty(obj, 'user.address.city')
 */
export function getNestedProperty(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }

  return current
}

/**
 * Safely set a property on an object
 * Returns true if successful, false if obj is not a record
 */
export function setProperty(obj: unknown, key: string, value: unknown): boolean {
  if (!isRecord(obj)) return false
  ;(obj as Record<string, unknown>)[key] = value
  return true
}

/**
 * Check if an object has a specific property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isRecord(obj) && key in obj
}

/**
 * Check if an object has all specified properties
 */
export function hasProperties<K extends string>(
  obj: unknown,
  keys: K[]
): obj is Record<K, unknown> {
  return isRecord(obj) && keys.every((key) => key in obj)
}

/**
 * Check if an object has a property with a specific type
 */
export function hasTypedProperty<K extends string, T>(
  obj: unknown,
  key: K,
  typeGuard: (value: unknown) => value is T
): obj is Record<K, T> {
  return isRecord(obj) && key in obj && typeGuard(obj[key])
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert that a value satisfies a type guard, throwing if it doesn't
 *
 * @throws Error if the type guard returns false
 */
export function assertType<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  message?: string
): asserts value is T {
  if (!guard(value)) {
    throw new TypeError(message ?? `Type assertion failed`)
  }
}

/**
 * Assert that a value is defined (not null or undefined)
 *
 * @throws Error if value is null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new TypeError(message ?? `Expected defined value, got ${value}`)
  }
}

/**
 * Assert that a value is a record
 */
export function assertRecord(
  value: unknown,
  message?: string
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(message ?? `Expected object, got ${typeof value}`)
  }
}

// ============================================================================
// COERCION HELPERS (Safe casting with validation)
// ============================================================================

/**
 * Safely cast a value to a record, returning undefined if not possible
 *
 * This is a safe alternative to `value as unknown as Record<string, unknown>`
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

/**
 * Safely cast a value to an array, returning undefined if not possible
 */
export function asArray<T>(
  value: unknown,
  itemGuard?: (item: unknown) => item is T
): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (itemGuard && !value.every(itemGuard)) return undefined
  return value as T[]
}

/**
 * Safely cast a value to a string, returning undefined if not possible
 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Safely cast a value to a number, returning undefined if not possible
 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined
}

// ============================================================================
// DISCRIMINATED UNION HELPERS
// ============================================================================

/**
 * Create a type guard for discriminated unions based on a discriminator property
 *
 * @example
 * type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number }
 * const isCircle = createDiscriminantGuard<Shape, 'kind', 'circle'>('kind', 'circle')
 * if (isCircle(shape)) {
 *   console.log(shape.radius) // TypeScript knows shape is Circle
 * }
 */
export function createDiscriminantGuard<
  T extends Record<K, string>,
  K extends keyof T,
  V extends T[K],
>(discriminator: K, value: V): (obj: T) => obj is Extract<T, Record<K, V>> {
  return (obj: T): obj is Extract<T, Record<K, V>> => obj[discriminator] === value
}

/**
 * Check if a value matches a discriminated union variant
 */
export function isDiscriminated<K extends string, V extends string>(
  value: unknown,
  discriminator: K,
  discriminatorValue: V
): value is Record<K, V> {
  return isRecord(value) && value[discriminator] === discriminatorValue
}

// ============================================================================
// CLASS INSTANCE HELPERS
// ============================================================================

/**
 * Create a type guard for checking if a value is an instance of a class
 */
export function isInstanceOf<T>(
  constructor: new (...args: unknown[]) => T
): (value: unknown) => value is T {
  return (value: unknown): value is T => value instanceof constructor
}

/**
 * Check if a value has a specific method (duck typing)
 */
export function hasMethod<K extends string>(
  obj: unknown,
  methodName: K
): obj is Record<K, (...args: unknown[]) => unknown> {
  return isRecord(obj) && typeof obj[methodName] === 'function'
}

// ============================================================================
// JSON/SERIALIZATION HELPERS
// ============================================================================

/**
 * Check if a value is JSON-serializable
 */
export function isJsonSerializable(
  value: unknown
): value is string | number | boolean | null | JsonSerializable[] | { [key: string]: JsonSerializable } {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonSerializable)
  if (isRecord(value)) return Object.values(value).every(isJsonSerializable)
  return false
}

type JsonSerializable = string | number | boolean | null | JsonSerializable[] | { [key: string]: JsonSerializable }

/**
 * Safely parse JSON with type validation
 */
export function parseJsonAs<T>(
  json: string,
  guard: (value: unknown) => value is T
): T | undefined {
  try {
    const parsed = JSON.parse(json)
    return guard(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

// ============================================================================
// UTILITY TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a valid ISO date string
 */
export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && value.includes('T')
}

/**
 * Check if a value is a valid UUID
 */
export function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Check if a value is a valid email address
 */
export function isEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Check if a value is a valid URL
 */
export function isUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// SAFE WIDENING CASTS - For narrowing specific types to broader types
// ============================================================================

/**
 * Safely widen a typed object to Record<string, unknown>
 *
 * This is the type-safe replacement for the pattern:
 * `someTypedData as unknown as Record<string, unknown>`
 *
 * Use this when you have a known typed object and need to pass it to an API
 * that accepts Record<string, unknown> (e.g., graph store data fields).
 *
 * @example
 * ```typescript
 * interface FunctionData { name: string; type: string }
 * const data: FunctionData = { name: 'test', type: 'code' }
 *
 * // Instead of: data as unknown as Record<string, unknown>
 * await store.createThing({ data: toRecord(data) })
 * ```
 */
export function toRecord<T extends object>(value: T): Record<string, unknown> {
  return value as Record<string, unknown>
}

/**
 * Safely widen a typed object or null to Record<string, unknown> | null
 *
 * Like toRecord but handles null values for optional data fields.
 */
export function toRecordOrNull<T extends object>(
  value: T | null | undefined
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  return value as Record<string, unknown>
}

// ============================================================================
// DYNAMIC METHOD ACCESS - For safe method invocation on objects
// ============================================================================

/**
 * Interface for callable methods on an object
 */
type CallableMethod = (...args: unknown[]) => unknown

/**
 * Safely get a method from an object and invoke it
 *
 * This is the type-safe replacement for the pattern:
 * `(obj as unknown as Record<string, Function>)[methodName](...args)`
 *
 * @example
 * ```typescript
 * // Instead of:
 * const method = (this.client as unknown as Record<string, Function>)[cmd.method]
 * const result = await method.apply(this.client, cmd.args)
 *
 * // Use:
 * const result = await invokeMethod(this.client, cmd.method, cmd.args)
 * ```
 *
 * @returns The result of the method call, or undefined if method doesn't exist
 * @throws Error if the method exists but throws during execution
 */
export function invokeMethod<T>(
  obj: object,
  methodName: string,
  args: unknown[] = [],
  context?: T
): unknown {
  if (!isRecord(obj)) return undefined
  const method = obj[methodName]
  if (typeof method !== 'function') return undefined
  return (method as CallableMethod).apply(context ?? obj, args)
}

/**
 * Check if an object has a callable method and return it
 *
 * @returns The method function if it exists, undefined otherwise
 */
export function getMethod(
  obj: unknown,
  methodName: string
): CallableMethod | undefined {
  if (!isRecord(obj)) return undefined
  const method = obj[methodName]
  if (typeof method !== 'function') return undefined
  return method as CallableMethod
}

// ============================================================================
// PERFORMANCE API - Safe access to performance.memory
// ============================================================================

/**
 * Interface for Chrome's performance.memory extension
 */
export interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/**
 * Interface for performance object with optional memory property
 */
export interface PerformanceWithMemory {
  memory?: PerformanceMemory
}

/**
 * Check if the global performance object has memory information
 *
 * This is available in Chrome/V8 environments but not in all browsers.
 */
export function hasPerformanceMemory(
  perf: unknown
): perf is PerformanceWithMemory & { memory: PerformanceMemory } {
  return (
    isRecord(perf) &&
    'memory' in perf &&
    isRecord(perf.memory) &&
    typeof (perf.memory as Record<string, unknown>).usedJSHeapSize === 'number'
  )
}

/**
 * Safely get memory usage from performance API
 *
 * @returns The usedJSHeapSize if available, undefined otherwise
 */
export function getMemoryUsage(): number | undefined {
  const perf = (globalThis as { performance?: unknown }).performance
  if (hasPerformanceMemory(perf)) {
    return perf.memory.usedJSHeapSize
  }
  return undefined
}

// ============================================================================
// DRIZZLE TABLE INTERNALS - Safe access to Drizzle ORM table properties
// ============================================================================

/**
 * Symbol used by Drizzle ORM for table names
 */
export const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name')

/**
 * Interface for Drizzle table internal properties
 */
export interface DrizzleTableInternals {
  [DRIZZLE_NAME_SYMBOL]?: string
  _?: { name?: string }
}

/**
 * Check if a table has Drizzle internal name property
 */
export function hasDrizzleTableName(
  table: unknown
): table is DrizzleTableInternals {
  if (!isRecord(table)) return false
  // Check for symbol-based name (newer Drizzle)
  if (DRIZZLE_NAME_SYMBOL in table && typeof table[DRIZZLE_NAME_SYMBOL] === 'string') {
    return true
  }
  // Check for underscore-based name (older Drizzle)
  if ('_' in table && isRecord(table._) && typeof table._.name === 'string') {
    return true
  }
  return false
}

/**
 * Safely get the table name from a Drizzle table
 *
 * @returns The table name if available, undefined otherwise
 */
export function getDrizzleTableName(table: unknown): string | undefined {
  if (!isRecord(table)) return undefined

  // Try symbol-based name first (newer Drizzle versions)
  const symbolName = (table as DrizzleTableInternals)[DRIZZLE_NAME_SYMBOL]
  if (typeof symbolName === 'string') {
    return symbolName
  }

  // Fall back to underscore-based name (older Drizzle versions)
  if ('_' in table && isRecord(table._) && typeof table._.name === 'string') {
    return table._.name
  }

  return undefined
}
