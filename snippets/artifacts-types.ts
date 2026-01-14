/**
 * Shared Artifact Types Module
 *
 * Centralized type definitions for artifact storage system.
 * Single source of truth for ArtifactMode, RetryResult, and ArtifactRecord types.
 *
 * Key design decisions:
 * 1. ArtifactMode: Single definition - 'preview' | 'build' | 'bulk'
 * 2. RetryResult<T>: Proper discriminated union for type-safe success/failure handling
 * 3. AST fields: Use `unknown` instead of `object` for type safety
 *
 * @module snippets/artifacts-types
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Artifact Mode
// ============================================================================

/**
 * Valid artifact modes for routing to different Pipelines.
 *
 * - preview: Fast path for development preview
 * - build: Production build pipeline
 * - bulk: Batch operations for large imports
 */
export type ArtifactMode = 'preview' | 'build' | 'bulk'

/**
 * Readonly array of all valid artifact modes.
 * Use this for runtime validation and iteration.
 *
 * This is a Proxy-backed array that silently ignores mutation attempts,
 * making it truly immutable at both compile-time and runtime.
 */
const _ARTIFACT_MODES_BASE = ['preview', 'build', 'bulk'] as const
export const ARTIFACT_MODES: readonly ['preview', 'build', 'bulk'] = new Proxy(_ARTIFACT_MODES_BASE as unknown as ['preview', 'build', 'bulk'], {
  set() { return true }, // Silently ignore property sets
  deleteProperty() { return true }, // Silently ignore deletes
  defineProperty() { return true }, // Silently ignore defineProperty
}) as readonly ['preview', 'build', 'bulk']

// ============================================================================
// RetryResult Discriminated Union
// ============================================================================

/**
 * Success variant of RetryResult.
 * When success is true, result is guaranteed to be T.
 */
export interface RetryResultSuccess<T> {
  success: true
  result: T
  retries: number
  error?: undefined
}

/**
 * Failure variant of RetryResult.
 * When success is false, result is undefined and error is present.
 */
export interface RetryResultFailure {
  success: false
  result: undefined
  retries: number
  error: string
}

/**
 * Result from a retry operation including metadata.
 *
 * This is a proper discriminated union - TypeScript can narrow
 * the type based on the `success` field:
 *
 * @example
 * ```typescript
 * const result = await withRetry(() => fetch(url))
 * if (result.success) {
 *   // result.result is T, not T | undefined
 *   console.log(result.result)
 * } else {
 *   // result.result is undefined, result.error is string
 *   console.error(result.error)
 * }
 * ```
 */
export type RetryResult<T> = RetryResultSuccess<T> | RetryResultFailure

// ============================================================================
// AST Types
// ============================================================================

/**
 * Base interface for AST fields.
 *
 * Uses `unknown` instead of `object` for type safety:
 * - `unknown` requires explicit type checking before property access
 * - `object` allows any property access without type checking
 */
export interface AstFields {
  mdast?: unknown | null
  hast?: unknown | null
  estree?: unknown | null
  tsast?: unknown | null
}

// ============================================================================
// Artifact Record
// ============================================================================

/**
 * Represents a validated artifact record with required and optional fields.
 *
 * Required fields: ns, type, id
 * All other fields are optional and may be null.
 */
export interface ArtifactRecord {
  // Required identity fields
  ns: string
  type: string
  id: string
  ts?: string

  // Source artifacts
  markdown?: string | null
  mdx?: string | null

  // Compiled artifacts
  html?: string | null
  esm?: string | null
  dts?: string | null
  css?: string | null

  // AST artifacts (using unknown for type safety)
  mdast?: unknown | null
  hast?: unknown | null
  estree?: unknown | null
  tsast?: unknown | null

  // Metadata
  frontmatter?: unknown | null
  dependencies?: string[] | null
  exports?: string[] | null
  hash?: string | null
  size_bytes?: number | null

  // Visibility/access control
  visibility?: 'public' | 'private' | 'internal' | null
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid ArtifactRecord.
 *
 * Validates:
 * - Value is a non-null object (not an array)
 * - Required fields (ns, type, id) are present and non-empty strings
 *
 * @param value - The value to check
 * @returns True if value is a valid ArtifactRecord
 *
 * @example
 * ```typescript
 * const data: unknown = await fetchData()
 * if (isArtifactRecord(data)) {
 *   // data is now typed as ArtifactRecord
 *   console.log(data.ns, data.type, data.id)
 * }
 * ```
 */
export function isArtifactRecord(value: unknown): value is ArtifactRecord {
  // Check for null/undefined
  if (value === null || value === undefined) {
    return false
  }

  // Check it's an object (and not an array)
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Validate required fields are present and non-empty strings
  if (typeof obj.ns !== 'string' || obj.ns === '') {
    return false
  }
  if (typeof obj.type !== 'string' || obj.type === '') {
    return false
  }
  if (typeof obj.id !== 'string' || obj.id === '') {
    return false
  }

  return true
}

/**
 * Type guard to check if a value is a valid ArtifactMode.
 *
 * @param mode - The value to check
 * @returns True if mode is a valid ArtifactMode
 *
 * @example
 * ```typescript
 * const mode: unknown = request.headers.get('X-Mode')
 * if (isValidArtifactMode(mode)) {
 *   // mode is now typed as ArtifactMode
 *   routeToPipeline(mode)
 * }
 * ```
 */
export function isValidArtifactMode(mode: unknown): mode is ArtifactMode {
  return mode === 'preview' || mode === 'build' || mode === 'bulk'
}

// ============================================================================
// RetryResult Factory Functions
// ============================================================================

/**
 * Creates a success RetryResult.
 *
 * @param result - The successful result value
 * @param retries - Number of retries before success
 * @returns RetryResultSuccess<T>
 */
export function createSuccessResult<T>(result: T, retries: number): RetryResultSuccess<T> {
  return {
    success: true,
    result,
    retries,
  }
}

/**
 * Creates a failure RetryResult.
 *
 * @param error - Error message
 * @param retries - Number of retries before failure
 * @returns RetryResultFailure
 */
export function createFailureResult<T>(error: string, retries: number): RetryResultFailure {
  return {
    success: false,
    result: undefined,
    retries,
    error,
  }
}

// ============================================================================
// AST Type Utilities
// ============================================================================

/**
 * Type-safe accessor for MDAST field.
 *
 * @param record - The artifact record
 * @returns The MDAST value or null/undefined
 */
export function getMdast(record: ArtifactRecord): unknown | null | undefined {
  return record.mdast
}

/**
 * Type-safe accessor for HAST field.
 *
 * @param record - The artifact record
 * @returns The HAST value or null/undefined
 */
export function getHast(record: ArtifactRecord): unknown | null | undefined {
  return record.hast
}

/**
 * Type-safe accessor for ESTree field.
 *
 * @param record - The artifact record
 * @returns The ESTree value or null/undefined
 */
export function getEstree(record: ArtifactRecord): unknown | null | undefined {
  return record.estree
}

/**
 * Type-safe accessor for TypeScript AST field.
 *
 * @param record - The artifact record
 * @returns The TS AST value or null/undefined
 */
export function getTsast(record: ArtifactRecord): unknown | null | undefined {
  return record.tsast
}
