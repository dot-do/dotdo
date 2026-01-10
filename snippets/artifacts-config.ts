/**
 * Artifact Config Loader
 *
 * Loads and validates tenant configuration for artifact storage.
 *
 * @module snippets/artifacts-config
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Types
// ============================================================================

export type ArtifactMode = 'preview' | 'build' | 'bulk'

export interface TenantArtifactConfig {
  ns: string
  pipelines: {
    allowedModes: ArtifactMode[]
    defaultMode: ArtifactMode
  }
  cache: {
    defaultMaxAge: number
    defaultStaleWhileRevalidate: number
    minMaxAge: number
    allowFreshBypass: boolean
  }
  limits: {
    maxArtifactsPerRequest: number
    maxBytesPerRequest: number
    maxRequestsPerMinute: number
  }
}

export interface LoadConfigOptions {
  keyPrefix?: string
  keySuffix?: string
  defaults?: Partial<TenantArtifactConfig>
}

// ============================================================================
// Stub Implementations (RED phase - not implemented)
// ============================================================================

/**
 * Load tenant configuration from KV.
 */
export async function loadTenantConfig(
  _kv: KVNamespace,
  _ns: string,
  _options?: LoadConfigOptions
): Promise<TenantArtifactConfig> {
  throw new Error('loadTenantConfig not implemented')
}

/**
 * Validate and normalize configuration object.
 */
export function validateConfig(_config: unknown): TenantArtifactConfig {
  throw new Error('validateConfig not implemented')
}

/**
 * Get default configuration values.
 */
export function getDefaultConfig(): TenantArtifactConfig {
  throw new Error('getDefaultConfig not implemented')
}

/**
 * Get Pipeline HTTP endpoint for a mode.
 */
export function getPipelineEndpoint(_mode: string): string {
  throw new Error('getPipelineEndpoint not implemented')
}
