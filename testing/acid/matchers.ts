/**
 * ACID Custom Vitest Matchers
 *
 * Custom matchers for asserting ACID properties in tests:
 * - toBeAtomic: Verify all-or-nothing behavior
 * - toBeConsistent: Verify state matches schema/invariants
 * - toBeIsolated: Verify no cross-operation interference
 * - toBeDurable: Verify persistence after crash
 * - toHaveEmitted: Verify lifecycle events
 * - toHaveRolledBack: Verify rollback to original state
 *
 * @module testing/acid/matchers
 *
 * @example
 * ```typescript
 * import { expect } from 'vitest'
 * import { acidMatchers } from 'dotdo/testing/acid/matchers'
 *
 * // Extend Vitest
 * expect.extend(acidMatchers)
 *
 * // Use in tests
 * expect(result).toBeAtomic(expectedState)
 * expect(state).toBeConsistent(schema)
 * expect(history).toHaveEmitted('fork', 'completed')
 * ```
 */

import type { LifecycleOperation, LifecycleStatus, LifecycleEvent } from '../../types/acid/lifecycle'

// ============================================================================
// MATCHER RESULT TYPE
// ============================================================================

/**
 * Result returned by custom matchers.
 */
interface MatcherResult {
  pass: boolean
  message: () => string
}

// ============================================================================
// ATOMIC MATCHER
// ============================================================================

/**
 * Assert that an operation result represents atomic completion.
 *
 * Checks that either:
 * - The operation succeeded and state matches expected
 * - The operation failed and state equals original (rollback)
 *
 * @param received - The result object { success, stateBefore, stateAfter }
 * @param expected - Expected final state on success
 */
function toBeAtomic(
  received: { success: boolean; stateBefore: unknown; stateAfter: unknown },
  expected: unknown
): MatcherResult {
  const { success, stateBefore, stateAfter } = received

  if (success) {
    // On success, stateAfter should match expected
    const statesEqual = JSON.stringify(stateAfter) === JSON.stringify(expected)
    return {
      pass: statesEqual,
      message: () =>
        statesEqual
          ? `Expected operation NOT to be atomic with state ${JSON.stringify(expected)}`
          : `Expected operation to be atomic.\n` +
            `Expected state: ${JSON.stringify(expected, null, 2)}\n` +
            `Actual state: ${JSON.stringify(stateAfter, null, 2)}`,
    }
  } else {
    // On failure, stateAfter should equal stateBefore (rollback)
    const rolledBack = JSON.stringify(stateAfter) === JSON.stringify(stateBefore)
    return {
      pass: rolledBack,
      message: () =>
        rolledBack
          ? `Expected operation NOT to rollback on failure`
          : `Expected operation to rollback on failure.\n` +
            `State before: ${JSON.stringify(stateBefore, null, 2)}\n` +
            `State after: ${JSON.stringify(stateAfter, null, 2)}\n` +
            `(States should be equal after rollback)`,
    }
  }
}

// ============================================================================
// CONSISTENT MATCHER
// ============================================================================

/**
 * Schema definition for consistency checking.
 */
type SchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined' | 'any'

type SchemaDefinition = Record<string, SchemaType | { type: SchemaType; optional?: boolean }>

/**
 * Assert that state is consistent with a schema.
 *
 * @param received - The state to validate
 * @param schema - Schema definition
 */
function toBeConsistent(
  received: Record<string, unknown>,
  schema: SchemaDefinition
): MatcherResult {
  const errors: string[] = []

  for (const [key, schemaDef] of Object.entries(schema)) {
    const value = received[key]
    const typeDef = typeof schemaDef === 'string' ? { type: schemaDef } : schemaDef
    const { type: expectedType, optional = false } = typeDef

    // Handle missing values
    if (value === undefined) {
      if (!optional) {
        errors.push(`Missing required field: ${key}`)
      }
      continue
    }

    // Skip 'any' type check
    if (expectedType === 'any') {
      continue
    }

    // Get actual type
    let actualType: string
    if (value === null) {
      actualType = 'null'
    } else if (Array.isArray(value)) {
      actualType = 'array'
    } else {
      actualType = typeof value
    }

    // Check type match
    if (actualType !== expectedType) {
      errors.push(`Field "${key}": expected ${expectedType}, got ${actualType}`)
    }
  }

  return {
    pass: errors.length === 0,
    message: () =>
      errors.length === 0
        ? `Expected state NOT to be consistent with schema`
        : `State is inconsistent with schema:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
  }
}

// ============================================================================
// ISOLATED MATCHER
// ============================================================================

/**
 * Result from concurrent operations.
 */
interface IsolatedResult {
  results: unknown[]
  expectedResults: unknown[]
}

/**
 * Assert that concurrent operations produced isolated results.
 *
 * @param received - Object with results and expectedResults arrays
 */
function toBeIsolated(received: IsolatedResult): MatcherResult {
  const { results, expectedResults } = received

  if (results.length !== expectedResults.length) {
    return {
      pass: false,
      message: () =>
        `Result count mismatch: got ${results.length}, expected ${expectedResults.length}`,
    }
  }

  const mismatches: string[] = []

  for (let i = 0; i < results.length; i++) {
    if (JSON.stringify(results[i]) !== JSON.stringify(expectedResults[i])) {
      mismatches.push(
        `Operation ${i}: expected ${JSON.stringify(expectedResults[i])}, got ${JSON.stringify(results[i])}`
      )
    }
  }

  return {
    pass: mismatches.length === 0,
    message: () =>
      mismatches.length === 0
        ? `Expected operations NOT to be isolated`
        : `Operations were not isolated:\n${mismatches.map((m) => `  - ${m}`).join('\n')}`,
  }
}

// ============================================================================
// DURABLE MATCHER
// ============================================================================

/**
 * Assert that state is durable (persisted after restart).
 *
 * @param received - Object with stateBefore, stateAfter (post-restart), expected
 */
function toBeDurable(
  received: { stateBefore: unknown; stateAfter: unknown },
  expected: unknown
): MatcherResult {
  const { stateBefore, stateAfter } = received

  const stateBeforeMatch = JSON.stringify(stateBefore) === JSON.stringify(expected)
  const stateAfterMatch = JSON.stringify(stateAfter) === JSON.stringify(expected)

  if (!stateBeforeMatch) {
    return {
      pass: false,
      message: () =>
        `State before restart did not match expected:\n` +
        `Expected: ${JSON.stringify(expected, null, 2)}\n` +
        `Actual: ${JSON.stringify(stateBefore, null, 2)}`,
    }
  }

  return {
    pass: stateAfterMatch,
    message: () =>
      stateAfterMatch
        ? `Expected state NOT to be durable`
        : `State was not durable (changed after restart):\n` +
          `Before restart: ${JSON.stringify(stateBefore, null, 2)}\n` +
          `After restart: ${JSON.stringify(stateAfter, null, 2)}\n` +
          `Expected: ${JSON.stringify(expected, null, 2)}`,
  }
}

// ============================================================================
// EMITTED MATCHER
// ============================================================================

/**
 * Assert that a lifecycle event was emitted.
 *
 * @param received - Array of lifecycle events (history)
 * @param operation - Expected operation type
 * @param status - Optional expected status
 * @param metadata - Optional metadata to match
 */
function toHaveEmitted(
  received: LifecycleEvent[],
  operation: LifecycleOperation,
  status?: LifecycleStatus,
  metadata?: Record<string, unknown>
): MatcherResult {
  const matchingEvents = received.filter((e) => {
    if (e.operation !== operation) return false
    if (status && e.status !== status) return false
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (JSON.stringify(e.metadata[key]) !== JSON.stringify(value)) {
          return false
        }
      }
    }
    return true
  })

  const found = matchingEvents.length > 0

  let expectedDesc = operation
  if (status) expectedDesc += `:${status}`
  if (metadata) expectedDesc += ` with ${JSON.stringify(metadata)}`

  const actualEvents = received.map((e) => `${e.operation}:${e.status}`).join(', ')

  return {
    pass: found,
    message: () =>
      found
        ? `Expected NOT to have emitted ${expectedDesc}`
        : `Expected to have emitted ${expectedDesc}.\n` +
          `Actual events: [${actualEvents}]`,
  }
}

// ============================================================================
// ROLLED BACK MATCHER
// ============================================================================

/**
 * Assert that state has been rolled back to original.
 *
 * @param received - Current state
 * @param originalState - Original state to compare against
 */
function toHaveRolledBack(
  received: unknown,
  originalState: unknown
): MatcherResult {
  const match = JSON.stringify(received) === JSON.stringify(originalState)

  return {
    pass: match,
    message: () =>
      match
        ? `Expected state NOT to have rolled back to original`
        : `Expected state to have rolled back.\n` +
          `Original: ${JSON.stringify(originalState, null, 2)}\n` +
          `Current: ${JSON.stringify(received, null, 2)}`,
  }
}

// ============================================================================
// EXPORT MATCHERS
// ============================================================================

/**
 * Custom Vitest matchers for ACID testing.
 *
 * @example
 * ```typescript
 * import { expect } from 'vitest'
 * import { acidMatchers } from 'dotdo/testing/acid/matchers'
 *
 * // Setup in vitest.setup.ts or test file
 * expect.extend(acidMatchers)
 *
 * // Use in tests
 * describe('ACID operations', () => {
 *   it('should be atomic', async () => {
 *     const result = await testAtomicOperation()
 *     expect(result).toBeAtomic(expectedState)
 *   })
 *
 *   it('should be consistent', () => {
 *     expect(state).toBeConsistent({
 *       id: 'string',
 *       count: 'number',
 *       items: 'array',
 *     })
 *   })
 *
 *   it('should emit lifecycle events', async () => {
 *     await instance.fork(target)
 *     expect(history).toHaveEmitted('fork', 'completed')
 *   })
 * })
 * ```
 */
export const acidMatchers = {
  toBeAtomic,
  toBeConsistent,
  toBeIsolated,
  toBeDurable,
  toHaveEmitted,
  toHaveRolledBack,
}

// ============================================================================
// TYPE AUGMENTATION
// ============================================================================

/**
 * Vitest type augmentation for ACID matchers.
 *
 * This extends the Vitest `expect` interface with our custom matchers.
 */
declare module 'vitest' {
  interface Assertion<T = unknown> {
    /**
     * Assert that an operation result represents atomic completion.
     * @param expected - Expected final state on success
     */
    toBeAtomic(expected: unknown): T

    /**
     * Assert that state is consistent with a schema.
     * @param schema - Schema definition
     */
    toBeConsistent(schema: SchemaDefinition): T

    /**
     * Assert that concurrent operations produced isolated results.
     */
    toBeIsolated(): T

    /**
     * Assert that state is durable (persisted after restart).
     * @param expected - Expected state
     */
    toBeDurable(expected: unknown): T

    /**
     * Assert that a lifecycle event was emitted.
     * @param operation - Expected operation type
     * @param status - Optional expected status
     * @param metadata - Optional metadata to match
     */
    toHaveEmitted(
      operation: LifecycleOperation,
      status?: LifecycleStatus,
      metadata?: Record<string, unknown>
    ): T

    /**
     * Assert that state has been rolled back to original.
     * @param originalState - Original state to compare against
     */
    toHaveRolledBack(originalState: unknown): T
  }

  interface AsymmetricMatchersContaining {
    toBeAtomic(expected: unknown): unknown
    toBeConsistent(schema: SchemaDefinition): unknown
    toBeIsolated(): unknown
    toBeDurable(expected: unknown): unknown
    toHaveEmitted(
      operation: LifecycleOperation,
      status?: LifecycleStatus,
      metadata?: Record<string, unknown>
    ): unknown
    toHaveRolledBack(originalState: unknown): unknown
  }
}

export default acidMatchers
