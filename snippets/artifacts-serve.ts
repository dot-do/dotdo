/**
 * Artifact Serve Snippet
 *
 * Serves artifacts from R2 Iceberg with SWR caching.
 * Handles path parsing, extension mapping, and cache control.
 *
 * @module snippets/artifacts-serve
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Types
// ============================================================================

export interface ParsedPath {
  ns: string
  type: string
  id: string
  ext: string
}

export interface TenantConfig {
  ns: string
  cache: {
    defaultMaxAge: number
    defaultStaleWhileRevalidate: number
    minMaxAge: number
    allowFreshBypass: boolean
  }
}

export interface ServeOptions {
  config?: TenantConfig
  icebergReader?: unknown
  cache?: Cache
}

export interface ServeResult {
  source: 'cache' | 'parquet'
  age?: number
}

// ============================================================================
// Stub Implementations (RED phase - not implemented)
// ============================================================================

/**
 * Parse URL path into artifact components.
 */
export function parsePath(_url: URL): ParsedPath | null {
  throw new Error('parsePath not implemented')
}

/**
 * Map file extension to database column name.
 */
export function getColumnForExtension(_ext: string): string {
  throw new Error('getColumnForExtension not implemented')
}

/**
 * Get Content-Type header for file extension.
 */
export function getContentType(_ext: string): string {
  throw new Error('getContentType not implemented')
}

/**
 * Build Cache-Control header from config and overrides.
 */
export function buildCacheControl(
  _config: TenantConfig,
  _overrides?: { maxAge?: number; visibility?: string; fresh?: boolean }
): string {
  throw new Error('buildCacheControl not implemented')
}

/**
 * Handle artifact serve request with SWR caching.
 */
export async function handleServe(
  _request: Request,
  _ctx: ExecutionContext,
  _options?: ServeOptions
): Promise<Response> {
  throw new Error('handleServe not implemented')
}
