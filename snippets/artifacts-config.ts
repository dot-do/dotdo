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
// Constants
// ============================================================================

const VALID_MODES: readonly ArtifactMode[] = ['preview', 'build', 'bulk'] as const

const PIPELINE_ENDPOINTS: Record<ArtifactMode, string> = {
  preview: 'https://pipelines.cloudflare.com/artifacts-preview',
  build: 'https://pipelines.cloudflare.com/artifacts-build',
  bulk: 'https://pipelines.cloudflare.com/artifacts-bulk',
}

// Valid namespace pattern: alphanumeric, dots, hyphens, underscores
const NS_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

// Maximum TTL: 1 year in seconds
const MAX_TTL = 365 * 24 * 60 * 60

// Maximum limits
const MAX_ARTIFACTS_PER_REQUEST = 1_000_000
const MAX_BYTES_PER_REQUEST = 1024 * 1024 * 1024 // 1GB

// ============================================================================
// Implementation
// ============================================================================

/**
 * Get default configuration values.
 *
 * @param ns - Optional namespace to include in defaults
 * @returns Default TenantArtifactConfig
 */
export function getDefaultConfig(ns: string = ''): TenantArtifactConfig {
  return {
    ns,
    pipelines: {
      allowedModes: ['preview', 'build', 'bulk'],
      defaultMode: 'build',
    },
    cache: {
      defaultMaxAge: 300, // 5 minutes
      defaultStaleWhileRevalidate: 60,
      minMaxAge: 10,
      allowFreshBypass: true,
    },
    limits: {
      maxArtifactsPerRequest: 1000,
      maxBytesPerRequest: 10 * 1024 * 1024, // 10MB
      maxRequestsPerMinute: 100,
    },
  }
}

/**
 * Validate and normalize configuration object.
 *
 * @param config - Configuration to validate
 * @returns Validated TenantArtifactConfig
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: unknown): TenantArtifactConfig {
  // Reject null, undefined, non-objects
  if (config === null || config === undefined) {
    throw new Error('Config is required')
  }
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be an object')
  }

  const cfg = config as Record<string, unknown>

  // Validate ns
  if (!('ns' in cfg) || cfg.ns === undefined) {
    throw new Error('Config ns is required')
  }
  if (typeof cfg.ns !== 'string' || cfg.ns === '') {
    throw new Error('Config ns must be a non-empty string')
  }
  if (!NS_PATTERN.test(cfg.ns)) {
    throw new Error('Config ns contains invalid characters')
  }

  // Validate pipelines
  if (!('pipelines' in cfg) || cfg.pipelines === undefined) {
    throw new Error('Config pipelines is required')
  }
  const pipelines = cfg.pipelines as Record<string, unknown>

  // Validate allowedModes
  if (!Array.isArray(pipelines.allowedModes)) {
    throw new Error('Config pipelines.allowedModes must be an array')
  }
  if (pipelines.allowedModes.length === 0) {
    throw new Error('Config pipelines.allowedModes must contain at least one mode')
  }

  // Check for invalid modes
  for (const mode of pipelines.allowedModes) {
    if (!VALID_MODES.includes(mode as ArtifactMode)) {
      throw new Error(`Config pipelines.allowedModes contains invalid mode: ${mode}`)
    }
  }

  // Check for duplicates
  const uniqueModes = new Set(pipelines.allowedModes)
  if (uniqueModes.size !== pipelines.allowedModes.length) {
    throw new Error('Config pipelines.allowedModes must contain unique modes')
  }

  // Validate defaultMode
  if (!VALID_MODES.includes(pipelines.defaultMode as ArtifactMode)) {
    throw new Error(`Config pipelines.defaultMode is invalid: ${pipelines.defaultMode}`)
  }
  if (!pipelines.allowedModes.includes(pipelines.defaultMode)) {
    throw new Error('Config pipelines.defaultMode must be in allowedModes')
  }

  // Validate cache
  if (!('cache' in cfg) || cfg.cache === undefined) {
    throw new Error('Config cache is required')
  }
  const cache = cfg.cache as Record<string, unknown>

  // Validate cache.defaultMaxAge
  validatePositiveInteger(cache.defaultMaxAge, 'cache.defaultMaxAge')
  if ((cache.defaultMaxAge as number) > MAX_TTL) {
    throw new Error(`Config cache.defaultMaxAge is too large (maximum: ${MAX_TTL})`)
  }

  // Validate cache.defaultStaleWhileRevalidate
  if ((cache.defaultStaleWhileRevalidate as number) < 0) {
    throw new Error('Config cache.defaultStaleWhileRevalidate must not be negative')
  }
  if (!Number.isInteger(cache.defaultStaleWhileRevalidate)) {
    throw new Error('Config cache.defaultStaleWhileRevalidate must be an integer')
  }

  // Validate cache.minMaxAge
  validatePositiveInteger(cache.minMaxAge, 'cache.minMaxAge')

  // Validate defaultMaxAge >= minMaxAge
  if ((cache.defaultMaxAge as number) < (cache.minMaxAge as number)) {
    throw new Error('Config cache.defaultMaxAge must be >= minMaxAge (constraint violation)')
  }

  // Validate cache.allowFreshBypass
  if (typeof cache.allowFreshBypass !== 'boolean') {
    throw new Error('Config cache.allowFreshBypass must be a boolean')
  }

  // Validate limits
  if (!('limits' in cfg) || cfg.limits === undefined) {
    throw new Error('Config limits is required')
  }
  const limits = cfg.limits as Record<string, unknown>

  // Validate limits.maxArtifactsPerRequest
  validatePositiveInteger(limits.maxArtifactsPerRequest, 'limits.maxArtifactsPerRequest')
  if ((limits.maxArtifactsPerRequest as number) > MAX_ARTIFACTS_PER_REQUEST) {
    throw new Error(`Config limits.maxArtifactsPerRequest is too large (maximum: ${MAX_ARTIFACTS_PER_REQUEST})`)
  }

  // Validate limits.maxBytesPerRequest
  validatePositiveInteger(limits.maxBytesPerRequest, 'limits.maxBytesPerRequest')
  if ((limits.maxBytesPerRequest as number) > MAX_BYTES_PER_REQUEST) {
    throw new Error(`Config limits.maxBytesPerRequest is too large (maximum: ${MAX_BYTES_PER_REQUEST})`)
  }

  // Validate limits.maxRequestsPerMinute
  validatePositiveInteger(limits.maxRequestsPerMinute, 'limits.maxRequestsPerMinute')

  return config as TenantArtifactConfig
}

/**
 * Helper to validate a positive integer field.
 */
function validatePositiveInteger(value: unknown, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Config ${fieldName} must be an integer`)
  }
  if (value <= 0) {
    throw new Error(`Config ${fieldName} must be a positive integer (not zero or negative)`)
  }
}

/**
 * Load tenant configuration from KV.
 *
 * @param kv - KV namespace binding
 * @param ns - Tenant namespace
 * @param options - Optional configuration
 * @returns Validated TenantArtifactConfig
 */
export async function loadTenantConfig(
  kv: KVNamespace,
  ns: string,
  options?: LoadConfigOptions
): Promise<TenantArtifactConfig> {
  // Normalize namespace to lowercase
  const normalizedNs = ns.toLowerCase()

  // Build KV key
  const prefix = options?.keyPrefix ?? 'artifact-config:'
  const suffix = options?.keySuffix ?? ''
  const key = `${prefix}${normalizedNs}${suffix}`

  // Fetch from KV
  const stored = await kv.get(key, { type: 'json' })

  // If no stored config, return defaults with namespace
  if (stored === null || stored === undefined) {
    const defaults = getDefaultConfig(normalizedNs)
    if (options?.defaults) {
      return mergeConfigs(defaults, options.defaults, normalizedNs)
    }
    return defaults
  }

  // Handle invalid JSON (if get returns a string instead of parsed JSON)
  if (typeof stored === 'string') {
    throw new Error('Invalid JSON in KV')
  }

  // Merge stored config with defaults
  const defaults = getDefaultConfig(normalizedNs)
  const customDefaults = options?.defaults
  const baseConfig = customDefaults ? mergeConfigs(defaults, customDefaults, normalizedNs) : defaults
  const mergedConfig = mergeConfigs(baseConfig, stored as Partial<TenantArtifactConfig>, normalizedNs)

  // Validate merged config
  return validateConfig(mergedConfig)
}

/**
 * Deep merge configuration objects.
 */
function mergeConfigs(
  base: TenantArtifactConfig,
  override: Partial<TenantArtifactConfig>,
  ns: string
): TenantArtifactConfig {
  return {
    ns: override.ns ?? ns,
    pipelines: {
      ...base.pipelines,
      ...(override.pipelines ?? {}),
    },
    cache: {
      ...base.cache,
      ...(override.cache ?? {}),
    },
    limits: {
      ...base.limits,
      ...(override.limits ?? {}),
    },
  }
}

/**
 * Get Pipeline HTTP endpoint for a mode.
 *
 * @param mode - Pipeline mode (preview, build, or bulk)
 * @returns Pipeline HTTP endpoint URL
 * @throws Error if mode is invalid
 */
export function getPipelineEndpoint(mode: string): string {
  if (!mode || mode === '') {
    throw new Error('Pipeline mode is required (empty mode provided)')
  }

  const normalizedMode = mode.toLowerCase() as ArtifactMode

  if (!VALID_MODES.includes(normalizedMode)) {
    throw new Error(`Unknown pipeline mode: ${mode}`)
  }

  return PIPELINE_ENDPOINTS[normalizedMode]
}
