/**
 * Shared Artifact Types Module (STUB)
 *
 * Centralized type definitions for artifact storage system.
 * This file is intentionally incomplete to make tests fail (TDD RED phase).
 *
 * Problems to fix:
 * 1. ArtifactMode is duplicated in artifacts-ingest.ts and artifacts-config.ts
 * 2. RetryResult<T> uses unsafe `undefined as T` cast
 * 3. AST fields use `object` type which is too loose
 *
 * @module snippets/artifacts-types
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Artifact Mode (INTENTIONALLY INCOMPLETE - missing 'bulk')
// ============================================================================

/**
 * Valid artifact modes for routing to different Pipelines.
 *
 * STUB: Missing 'bulk' mode - will cause test failures.
 */
export type ArtifactMode = 'preview' | 'build'  // Missing 'bulk' - RED

/**
 * Array of all valid artifact modes.
 *
 * STUB: Missing 'bulk' - will cause test failures.
 */
export const ARTIFACT_MODES = ['preview', 'build'] as const  // Missing 'bulk' - RED

// ============================================================================
// RetryResult (INTENTIONALLY NOT A DISCRIMINATED UNION)
// ============================================================================

/**
 * Result from a retry operation including metadata.
 *
 * STUB: Not a discriminated union - result should be T | undefined
 * based on success field. This will cause type narrowing to fail.
 */
export interface RetryResult<T> {
  result: T  // Should be T when success=true, undefined when success=false
  success: boolean
  retries: number
  error?: string
}

// ============================================================================
// AST Types (INTENTIONALLY USING `object`)
// ============================================================================

/**
 * Base interface for AST fields.
 *
 * STUB: Using `object` which is too loose. Should use `unknown` or
 * proper AST interfaces from mdast/hast/estree.
 */
export interface AstFields {
  mdast?: object | null   // Too loose - RED
  hast?: object | null    // Too loose - RED
  estree?: object | null  // Too loose - RED
  tsast?: object | null   // Too loose - RED
}

// ============================================================================
// Artifact Record (WITH LOOSE AST TYPES)
// ============================================================================

/**
 * Represents a validated artifact record with required and optional fields.
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

  // AST artifacts (using loose object type - RED)
  mdast?: object | null
  hast?: object | null
  estree?: object | null
  tsast?: object | null

  // Metadata
  frontmatter?: object | null
  dependencies?: string[] | null
  exports?: string[] | null
  hash?: string | null
  size_bytes?: number | null

  // Visibility/access control
  visibility?: 'public' | 'private' | 'internal' | null
}

// ============================================================================
// Type Guards (INTENTIONALLY BROKEN)
// ============================================================================

/**
 * Type guard to check if a value is a valid ArtifactRecord.
 *
 * STUB: Always returns false - will cause test failures.
 */
export function isArtifactRecord(value: unknown): value is ArtifactRecord {
  return false  // Always false - RED
}

/**
 * Type guard to check if a string is a valid ArtifactMode.
 *
 * STUB: Missing 'bulk' check - will cause test failures.
 */
export function isValidArtifactMode(mode: unknown): mode is ArtifactMode {
  return mode === 'preview' || mode === 'build'  // Missing 'bulk' - RED
}

// ============================================================================
// RetryResult Factory (INTENTIONALLY BROKEN)
// ============================================================================

/**
 * Creates a success RetryResult.
 *
 * STUB: Incorrect typing - doesn't enforce discriminated union.
 */
export function createSuccessResult<T>(result: T, retries: number): RetryResult<T> {
  return {
    result,
    success: true,
    retries,
  }
}

/**
 * Creates a failure RetryResult.
 *
 * STUB: Uses `undefined as T` which is unsafe for non-nullable T.
 * This is the exact problem from the original code.
 */
export function createFailureResult<T>(error: string, retries: number): RetryResult<T> {
  return {
    result: undefined as T,  // UNSAFE CAST - RED
    success: false,
    retries,
    error,
  }
}

// ============================================================================
// AST Type Utilities (STUB)
// ============================================================================

/**
 * Type-safe accessor for MDAST field.
 *
 * STUB: Returns object type instead of proper MDAST root type.
 */
export function getMdast(record: ArtifactRecord): object | null | undefined {
  return record.mdast
}

/**
 * Type-safe accessor for HAST field.
 *
 * STUB: Returns object type instead of proper HAST root type.
 */
export function getHast(record: ArtifactRecord): object | null | undefined {
  return record.hast
}
