/**
 * $unwind Stage - MongoDB-style array flattening
 *
 * Deconstructs an array field from input documents to output a document
 * for each element. Each output document replaces the array with a single
 * element value.
 *
 * Supports:
 * - Basic array unwind
 * - preserveNullAndEmptyArrays option
 * - includeArrayIndex option
 * - Nested array paths (dot notation)
 *
 * @example Basic unwind
 * ```typescript
 * // Input: { tags: ['a', 'b'] }
 * createUnwindStage({ path: '$tags' })
 * // Output: { tags: 'a' }, { tags: 'b' }
 * ```
 *
 * @example Preserve null and empty arrays
 * ```typescript
 * // Input: { tags: [] }, { tags: null }, { other: 1 }
 * createUnwindStage({
 *   path: '$tags',
 *   preserveNullAndEmptyArrays: true
 * })
 * // Output: { tags: null }, { tags: null }, { other: 1, tags: null }
 * ```
 *
 * @example Include array index
 * ```typescript
 * // Input: { items: ['x', 'y', 'z'] }
 * createUnwindStage({
 *   path: '$items',
 *   includeArrayIndex: 'idx'
 * })
 * // Output: { items: 'x', idx: 0 }, { items: 'y', idx: 1 }, { items: 'z', idx: 2 }
 * ```
 */

import type { Stage } from '../index'

// ============================================================================
// Types
// ============================================================================

/**
 * Basic unwind specification (string path)
 */
export type BasicUnwindSpec = string

/**
 * Extended unwind specification with options
 */
export interface ExtendedUnwindSpec {
  /** Path to array field (must start with $) */
  path: string
  /** Include documents where array is null, missing, or empty */
  preserveNullAndEmptyArrays?: boolean
  /** Field name to store array index */
  includeArrayIndex?: string
}

/**
 * Combined unwind specification
 */
export type UnwindSpec = BasicUnwindSpec | ExtendedUnwindSpec

/**
 * Unwind stage interface
 */
export interface UnwindStage<T> extends Stage<T, unknown> {
  name: '$unwind'
  specification: UnwindSpec
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  // Handle field references ($field)
  const cleanPath = path.startsWith('$') ? path.slice(1) : path
  const parts = cleanPath.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const cleanPath = path.startsWith('$') ? path.slice(1) : path
  const parts = cleanPath.split('.')

  // Clone the object to avoid mutation
  const result = deepClone(obj) as Record<string, unknown>

  let current = result
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(part in current) || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]!] = value
  return result
}

/**
 * Deep clone an object
 */
function deepClone(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj)
  if (Array.isArray(obj)) return obj.map(deepClone)

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = deepClone(value)
  }
  return result
}

/**
 * Normalize unwind spec to extended format
 */
function normalizeUnwindSpec(spec: UnwindSpec): ExtendedUnwindSpec {
  if (typeof spec === 'string') {
    return { path: spec }
  }
  return spec
}

// ============================================================================
// Unwind Stage Factory
// ============================================================================

/**
 * Create an $unwind stage for flattening arrays
 */
export function createUnwindStage<T>(spec: UnwindSpec): UnwindStage<T> {
  const normalizedSpec = normalizeUnwindSpec(spec)

  return {
    name: '$unwind',
    specification: spec,

    process(input: T[]): unknown[] {
      const results: unknown[] = []

      for (const doc of input) {
        const arrayValue = getNestedValue(doc, normalizedSpec.path)

        // Handle null, missing, or empty arrays
        if (arrayValue === null || arrayValue === undefined) {
          if (normalizedSpec.preserveNullAndEmptyArrays) {
            // Output document with field set to null
            let outputDoc = setNestedValue(
              doc as Record<string, unknown>,
              normalizedSpec.path,
              null
            )

            // Add array index if requested
            if (normalizedSpec.includeArrayIndex) {
              outputDoc = { ...outputDoc, [normalizedSpec.includeArrayIndex]: null }
            }

            results.push(outputDoc)
          }
          // Otherwise, skip this document
          continue
        }

        // Handle non-array values
        if (!Array.isArray(arrayValue)) {
          // Treat non-array as single-element array
          let outputDoc = setNestedValue(
            doc as Record<string, unknown>,
            normalizedSpec.path,
            arrayValue
          )

          if (normalizedSpec.includeArrayIndex) {
            outputDoc = { ...outputDoc, [normalizedSpec.includeArrayIndex]: 0 }
          }

          results.push(outputDoc)
          continue
        }

        // Handle empty arrays
        if (arrayValue.length === 0) {
          if (normalizedSpec.preserveNullAndEmptyArrays) {
            let outputDoc = setNestedValue(
              doc as Record<string, unknown>,
              normalizedSpec.path,
              null
            )

            if (normalizedSpec.includeArrayIndex) {
              outputDoc = { ...outputDoc, [normalizedSpec.includeArrayIndex]: null }
            }

            results.push(outputDoc)
          }
          // Otherwise, skip this document
          continue
        }

        // Unwind the array
        for (let i = 0; i < arrayValue.length; i++) {
          let outputDoc = setNestedValue(
            doc as Record<string, unknown>,
            normalizedSpec.path,
            arrayValue[i]
          )

          // Add array index if requested
          if (normalizedSpec.includeArrayIndex) {
            outputDoc = { ...outputDoc, [normalizedSpec.includeArrayIndex]: i }
          }

          results.push(outputDoc)
        }
      }

      return results
    },
  }
}
