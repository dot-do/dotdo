/**
 * Property Operations for Analytics
 *
 * Amplitude/PostHog-style property operations for incremental
 * updates to user/event properties.
 *
 * Operations:
 * - $set: Set property value (overwrites existing)
 * - $setOnce: Set property only if not already set
 * - $add: Increment numeric property
 * - $append: Append to array property
 * - $prepend: Prepend to array property
 * - $unset: Remove property entirely
 * - $remove: Remove value from array property
 *
 * @module @dotdo/compat/analytics/property-ops
 */

// Re-export PropertyOperations type from types.ts
export type { PropertyOperations } from './types'

/**
 * Deep equality check for objects
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const aKeys = Object.keys(a as object)
  const bKeys = Object.keys(b as object)

  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}

/**
 * Deep clone a value
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as object)) {
    result[key] = deepClone((value as Record<string, unknown>)[key])
  }
  return result as T
}

/**
 * Apply property operations to a properties object.
 *
 * Operations are applied in the following order:
 * 1. $set
 * 2. $setOnce
 * 3. $add
 * 4. $append
 * 5. $prepend
 * 6. $remove
 * 7. $unset (last)
 *
 * @param properties - The original properties object
 * @param operations - The property operations to apply
 * @returns A new properties object with operations applied
 *
 * @example
 * ```typescript
 * const properties = { count: 5, tags: ['a'] }
 * const operations = {
 *   $add: { count: 1 },
 *   $append: { tags: 'b' },
 *   $set: { name: 'John' }
 * }
 *
 * const result = applyPropertyOperations(properties, operations)
 * // { count: 6, tags: ['a', 'b'], name: 'John' }
 * ```
 */
export function applyPropertyOperations(
  properties: Record<string, unknown>,
  operations: import('./types').PropertyOperations
): Record<string, unknown> {
  // Deep clone to avoid mutating the original
  const result = deepClone(properties)

  // 1. $set - Set property values (overwrites existing)
  if (operations.$set) {
    for (const [key, value] of Object.entries(operations.$set)) {
      result[key] = value
    }
  }

  // 2. $setOnce - Set property only if not already set (undefined means not set)
  if (operations.$setOnce) {
    for (const [key, value] of Object.entries(operations.$setOnce)) {
      // Only set if the property doesn't exist or is undefined
      if (!(key in result) || result[key] === undefined) {
        result[key] = value
      }
    }
  }

  // 3. $add - Increment numeric properties
  if (operations.$add) {
    for (const [key, increment] of Object.entries(operations.$add)) {
      if (!(key in result) || result[key] === undefined) {
        // Initialize with the increment value if property doesn't exist
        result[key] = increment
      } else if (typeof result[key] === 'number') {
        result[key] = (result[key] as number) + increment
      } else {
        throw new Error(`Cannot $add to non-numeric property '${key}'`)
      }
    }
  }

  // 4. $append - Append to array properties
  if (operations.$append) {
    for (const [key, value] of Object.entries(operations.$append)) {
      if (!(key in result) || result[key] === undefined) {
        // Create array with value if property doesn't exist
        result[key] = [value]
      } else if (Array.isArray(result[key])) {
        ;(result[key] as unknown[]).push(value)
      } else {
        throw new Error(`Cannot $append to non-array property '${key}'`)
      }
    }
  }

  // 5. $prepend - Prepend to array properties
  if (operations.$prepend) {
    for (const [key, value] of Object.entries(operations.$prepend)) {
      if (!(key in result) || result[key] === undefined) {
        // Create array with value if property doesn't exist
        result[key] = [value]
      } else if (Array.isArray(result[key])) {
        ;(result[key] as unknown[]).unshift(value)
      } else {
        throw new Error(`Cannot $prepend to non-array property '${key}'`)
      }
    }
  }

  // 6. $remove - Remove value from array properties
  if (operations.$remove) {
    for (const [key, valueToRemove] of Object.entries(operations.$remove)) {
      if (!(key in result) || result[key] === undefined) {
        // No-op if property doesn't exist
        continue
      } else if (Array.isArray(result[key])) {
        // Remove all occurrences using deep equality
        result[key] = (result[key] as unknown[]).filter((item) => !deepEqual(item, valueToRemove))
      } else {
        throw new Error(`Cannot $remove from non-array property '${key}'`)
      }
    }
  }

  // 7. $unset - Remove properties entirely (applied last)
  if (operations.$unset) {
    for (const key of operations.$unset) {
      delete result[key]
    }
  }

  return result
}

// ============================================================================
// TYPE-SAFE OPERATION BUILDERS
// ============================================================================

/**
 * Type-safe property operations builder for improved DX.
 * Allows building complex operations with method chaining.
 *
 * @example
 * ```typescript
 * const ops = propertyOps()
 *   .set('name', 'John')
 *   .set('email', 'john@example.com.ai')
 *   .increment('loginCount', 1)
 *   .append('tags', 'premium')
 *   .build()
 *
 * const result = applyPropertyOperations(properties, ops)
 * ```
 */
export class PropertyOpsBuilder {
  private operations: import('./types').PropertyOperations = {}

  /**
   * Set a property value (overwrites existing)
   */
  set<T>(key: string, value: T): this {
    if (!this.operations.$set) {
      this.operations.$set = {}
    }
    this.operations.$set[key] = value
    return this
  }

  /**
   * Set a property only if it doesn't already exist
   */
  setOnce<T>(key: string, value: T): this {
    if (!this.operations.$setOnce) {
      this.operations.$setOnce = {}
    }
    this.operations.$setOnce[key] = value
    return this
  }

  /**
   * Increment a numeric property
   */
  increment(key: string, amount: number = 1): this {
    if (!this.operations.$add) {
      this.operations.$add = {}
    }
    this.operations.$add[key] = amount
    return this
  }

  /**
   * Decrement a numeric property (convenience for negative increment)
   */
  decrement(key: string, amount: number = 1): this {
    return this.increment(key, -amount)
  }

  /**
   * Append a value to an array property
   */
  append<T>(key: string, value: T): this {
    if (!this.operations.$append) {
      this.operations.$append = {}
    }
    this.operations.$append[key] = value
    return this
  }

  /**
   * Prepend a value to an array property
   */
  prepend<T>(key: string, value: T): this {
    if (!this.operations.$prepend) {
      this.operations.$prepend = {}
    }
    this.operations.$prepend[key] = value
    return this
  }

  /**
   * Remove a specific value from an array property
   */
  remove<T>(key: string, value: T): this {
    if (!this.operations.$remove) {
      this.operations.$remove = {}
    }
    this.operations.$remove[key] = value
    return this
  }

  /**
   * Unset (delete) a property entirely
   */
  unset(key: string): this {
    if (!this.operations.$unset) {
      this.operations.$unset = []
    }
    this.operations.$unset.push(key)
    return this
  }

  /**
   * Build the final PropertyOperations object
   */
  build(): import('./types').PropertyOperations {
    return { ...this.operations }
  }

  /**
   * Apply operations to a properties object and return the result
   */
  apply(properties: Record<string, unknown>): Record<string, unknown> {
    return applyPropertyOperations(properties, this.operations)
  }
}

/**
 * Create a new PropertyOpsBuilder for fluent operation building
 *
 * @example
 * ```typescript
 * const result = propertyOps()
 *   .set('name', 'John')
 *   .increment('visits', 1)
 *   .apply({ visits: 5 })
 * // { name: 'John', visits: 6 }
 * ```
 */
export function propertyOps(): PropertyOpsBuilder {
  return new PropertyOpsBuilder()
}

// ============================================================================
// CONVENIENCE HELPER FUNCTIONS
// ============================================================================

/**
 * Create a $set operation for a single property
 *
 * @param key - Property key to set
 * @param value - Value to set
 * @returns PropertyOperations with $set
 *
 * @example
 * ```typescript
 * const ops = setProperty('name', 'John')
 * const result = applyPropertyOperations({}, ops)
 * // { name: 'John' }
 * ```
 */
export function setProperty<T>(key: string, value: T): import('./types').PropertyOperations {
  return { $set: { [key]: value } }
}

/**
 * Create a $setOnce operation for a single property
 *
 * @param key - Property key to set (only if not exists)
 * @param value - Value to set
 * @returns PropertyOperations with $setOnce
 *
 * @example
 * ```typescript
 * const ops = setPropertyOnce('firstSeen', new Date())
 * const result = applyPropertyOperations({ firstSeen: 'old' }, ops)
 * // { firstSeen: 'old' } - unchanged because already exists
 * ```
 */
export function setPropertyOnce<T>(key: string, value: T): import('./types').PropertyOperations {
  return { $setOnce: { [key]: value } }
}

/**
 * Create an $add operation for incrementing a numeric property
 *
 * @param key - Property key to increment
 * @param amount - Amount to add (default: 1)
 * @returns PropertyOperations with $add
 *
 * @example
 * ```typescript
 * const ops = incrementProperty('loginCount', 1)
 * const result = applyPropertyOperations({ loginCount: 5 }, ops)
 * // { loginCount: 6 }
 * ```
 */
export function incrementProperty(key: string, amount: number = 1): import('./types').PropertyOperations {
  return { $add: { [key]: amount } }
}

/**
 * Create an $add operation for decrementing a numeric property
 *
 * @param key - Property key to decrement
 * @param amount - Amount to subtract (default: 1)
 * @returns PropertyOperations with $add (negative value)
 *
 * @example
 * ```typescript
 * const ops = decrementProperty('credits', 10)
 * const result = applyPropertyOperations({ credits: 100 }, ops)
 * // { credits: 90 }
 * ```
 */
export function decrementProperty(key: string, amount: number = 1): import('./types').PropertyOperations {
  return { $add: { [key]: -amount } }
}

/**
 * Create an $append operation for adding to an array property
 *
 * @param key - Property key (array) to append to
 * @param value - Value to append
 * @returns PropertyOperations with $append
 *
 * @example
 * ```typescript
 * const ops = appendProperty('tags', 'vip')
 * const result = applyPropertyOperations({ tags: ['user'] }, ops)
 * // { tags: ['user', 'vip'] }
 * ```
 */
export function appendProperty<T>(key: string, value: T): import('./types').PropertyOperations {
  return { $append: { [key]: value } }
}

/**
 * Create a $prepend operation for adding to the beginning of an array property
 *
 * @param key - Property key (array) to prepend to
 * @param value - Value to prepend
 * @returns PropertyOperations with $prepend
 *
 * @example
 * ```typescript
 * const ops = prependProperty('history', 'latest')
 * const result = applyPropertyOperations({ history: ['old'] }, ops)
 * // { history: ['latest', 'old'] }
 * ```
 */
export function prependProperty<T>(key: string, value: T): import('./types').PropertyOperations {
  return { $prepend: { [key]: value } }
}

/**
 * Create an $unset operation for removing a property
 *
 * @param keys - Property key(s) to remove
 * @returns PropertyOperations with $unset
 *
 * @example
 * ```typescript
 * const ops = unsetProperty('temporaryToken')
 * const result = applyPropertyOperations({ name: 'John', temporaryToken: 'xyz' }, ops)
 * // { name: 'John' }
 * ```
 */
export function unsetProperty(...keys: string[]): import('./types').PropertyOperations {
  return { $unset: keys }
}

/**
 * Create a $remove operation for removing a value from an array
 *
 * @param key - Property key (array) to remove from
 * @param value - Value to remove (all occurrences)
 * @returns PropertyOperations with $remove
 *
 * @example
 * ```typescript
 * const ops = removeFromProperty('tags', 'deprecated')
 * const result = applyPropertyOperations({ tags: ['active', 'deprecated'] }, ops)
 * // { tags: ['active'] }
 * ```
 */
export function removeFromProperty<T>(key: string, value: T): import('./types').PropertyOperations {
  return { $remove: { [key]: value } }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Result of a batch operation for a single user
 */
export interface BatchOperationResult<T = Record<string, unknown>> {
  userId: string
  properties: T
  success: boolean
  error?: Error
}

/**
 * Apply property operations to multiple users' properties in batch.
 *
 * @param usersProperties - Map of userId to their properties
 * @param operations - Operations to apply to all users
 * @returns Array of results for each user
 *
 * @example
 * ```typescript
 * const users = {
 *   'user-1': { loginCount: 5, tags: ['a'] },
 *   'user-2': { loginCount: 10, tags: ['b'] },
 * }
 * const ops = { $add: { loginCount: 1 }, $append: { tags: 'updated' } }
 *
 * const results = batchApplyOperations(users, ops)
 * // [
 * //   { userId: 'user-1', properties: { loginCount: 6, tags: ['a', 'updated'] }, success: true },
 * //   { userId: 'user-2', properties: { loginCount: 11, tags: ['b', 'updated'] }, success: true },
 * // ]
 * ```
 */
export function batchApplyOperations(
  usersProperties: Record<string, Record<string, unknown>>,
  operations: import('./types').PropertyOperations
): BatchOperationResult[] {
  const results: BatchOperationResult[] = []

  for (const [userId, properties] of Object.entries(usersProperties)) {
    try {
      const updatedProperties = applyPropertyOperations(properties, operations)
      results.push({
        userId,
        properties: updatedProperties,
        success: true,
      })
    } catch (error) {
      results.push({
        userId,
        properties,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  return results
}

/**
 * Apply different operations to different users in batch.
 *
 * @param operations - Array of { userId, properties, operations } to apply
 * @returns Array of results for each user
 *
 * @example
 * ```typescript
 * const batch = [
 *   { userId: 'user-1', properties: { count: 5 }, operations: { $add: { count: 1 } } },
 *   { userId: 'user-2', properties: { name: 'Jane' }, operations: { $set: { name: 'John' } } },
 * ]
 *
 * const results = batchApplyDifferentOperations(batch)
 * ```
 */
export function batchApplyDifferentOperations(
  operations: Array<{
    userId: string
    properties: Record<string, unknown>
    operations: import('./types').PropertyOperations
  }>
): BatchOperationResult[] {
  const results: BatchOperationResult[] = []

  for (const { userId, properties, operations: ops } of operations) {
    try {
      const updatedProperties = applyPropertyOperations(properties, ops)
      results.push({
        userId,
        properties: updatedProperties,
        success: true,
      })
    } catch (error) {
      results.push({
        userId,
        properties,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  return results
}

// ============================================================================
// USER-CENTRIC CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * User property manager for convenient single-user operations.
 * Wraps properties with user context for cleaner API.
 *
 * @example
 * ```typescript
 * const user = userProperties('user-123', { name: 'John', loginCount: 5 })
 *
 * user.set('email', 'john@example.com.ai')
 * user.increment('loginCount')
 * user.append('tags', 'premium')
 *
 * const updated = user.getProperties()
 * // { name: 'John', email: 'john@example.com.ai', loginCount: 6, tags: ['premium'] }
 * ```
 */
export class UserPropertyManager {
  private _userId: string
  private _properties: Record<string, unknown>

  constructor(userId: string, properties: Record<string, unknown> = {}) {
    this._userId = userId
    this._properties = { ...properties }
  }

  /**
   * Get the user ID
   */
  get userId(): string {
    return this._userId
  }

  /**
   * Get the current properties (immutable copy)
   */
  getProperties(): Record<string, unknown> {
    return { ...this._properties }
  }

  /**
   * Set a property value
   */
  set<T>(key: string, value: T): this {
    this._properties = applyPropertyOperations(this._properties, { $set: { [key]: value } })
    return this
  }

  /**
   * Set a property only if it doesn't exist
   */
  setOnce<T>(key: string, value: T): this {
    this._properties = applyPropertyOperations(this._properties, { $setOnce: { [key]: value } })
    return this
  }

  /**
   * Increment a numeric property
   */
  increment(key: string, amount: number = 1): this {
    this._properties = applyPropertyOperations(this._properties, { $add: { [key]: amount } })
    return this
  }

  /**
   * Decrement a numeric property
   */
  decrement(key: string, amount: number = 1): this {
    return this.increment(key, -amount)
  }

  /**
   * Append a value to an array property
   */
  append<T>(key: string, value: T): this {
    this._properties = applyPropertyOperations(this._properties, { $append: { [key]: value } })
    return this
  }

  /**
   * Prepend a value to an array property
   */
  prepend<T>(key: string, value: T): this {
    this._properties = applyPropertyOperations(this._properties, { $prepend: { [key]: value } })
    return this
  }

  /**
   * Remove a value from an array property
   */
  remove<T>(key: string, value: T): this {
    this._properties = applyPropertyOperations(this._properties, { $remove: { [key]: value } })
    return this
  }

  /**
   * Unset (remove) a property
   */
  unset(key: string): this {
    this._properties = applyPropertyOperations(this._properties, { $unset: [key] })
    return this
  }

  /**
   * Apply a PropertyOperations object
   */
  apply(operations: import('./types').PropertyOperations): this {
    this._properties = applyPropertyOperations(this._properties, operations)
    return this
  }

  /**
   * Get the result as a batch operation result format
   */
  toResult(): BatchOperationResult {
    return {
      userId: this._userId,
      properties: this.getProperties(),
      success: true,
    }
  }
}

/**
 * Create a UserPropertyManager for convenient single-user operations
 *
 * @param userId - The user's ID
 * @param properties - Initial properties (optional)
 * @returns UserPropertyManager instance
 *
 * @example
 * ```typescript
 * const user = userProperties('user-123', { name: 'John' })
 *   .set('email', 'john@example.com.ai')
 *   .increment('loginCount')
 *
 * console.log(user.getProperties())
 * ```
 */
export function userProperties(userId: string, properties?: Record<string, unknown>): UserPropertyManager {
  return new UserPropertyManager(userId, properties)
}

// ============================================================================
// OPERATION MERGING UTILITIES
// ============================================================================

/**
 * Merge multiple PropertyOperations objects into one.
 * Later operations take precedence for conflicting keys within the same operation type.
 *
 * @param operations - Array of PropertyOperations to merge
 * @returns Merged PropertyOperations
 *
 * @example
 * ```typescript
 * const ops1 = { $set: { a: 1 }, $add: { count: 1 } }
 * const ops2 = { $set: { b: 2 }, $add: { count: 2 } }
 *
 * const merged = mergeOperations(ops1, ops2)
 * // { $set: { a: 1, b: 2 }, $add: { count: 2 } }
 * ```
 */
export function mergeOperations(
  ...operations: import('./types').PropertyOperations[]
): import('./types').PropertyOperations {
  const result: import('./types').PropertyOperations = {}

  for (const ops of operations) {
    if (ops.$set) {
      result.$set = { ...result.$set, ...ops.$set }
    }
    if (ops.$setOnce) {
      result.$setOnce = { ...result.$setOnce, ...ops.$setOnce }
    }
    if (ops.$add) {
      result.$add = { ...result.$add, ...ops.$add }
    }
    if (ops.$append) {
      result.$append = { ...result.$append, ...ops.$append }
    }
    if (ops.$prepend) {
      result.$prepend = { ...result.$prepend, ...ops.$prepend }
    }
    if (ops.$remove) {
      result.$remove = { ...result.$remove, ...ops.$remove }
    }
    if (ops.$unset) {
      result.$unset = [...(result.$unset || []), ...ops.$unset]
    }
  }

  return result
}

/**
 * Check if a PropertyOperations object is empty (has no operations)
 *
 * @param operations - PropertyOperations to check
 * @returns true if no operations are defined
 *
 * @example
 * ```typescript
 * isEmptyOperations({}) // true
 * isEmptyOperations({ $set: {} }) // true
 * isEmptyOperations({ $set: { name: 'John' } }) // false
 * ```
 */
export function isEmptyOperations(operations: import('./types').PropertyOperations): boolean {
  if (operations.$set && Object.keys(operations.$set).length > 0) return false
  if (operations.$setOnce && Object.keys(operations.$setOnce).length > 0) return false
  if (operations.$add && Object.keys(operations.$add).length > 0) return false
  if (operations.$append && Object.keys(operations.$append).length > 0) return false
  if (operations.$prepend && Object.keys(operations.$prepend).length > 0) return false
  if (operations.$remove && Object.keys(operations.$remove).length > 0) return false
  if (operations.$unset && operations.$unset.length > 0) return false
  return true
}
