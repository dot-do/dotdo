/**
 * API Key middleware and utilities
 *
 * API key validation with support for:
 * - Static key configuration
 * - Environment variable loading
 * - Runtime key registration
 */

import type { MiddlewareHandler, Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

// ============================================================================
// Types
// ============================================================================

export interface ApiKeyConfig {
  userId: string
  role: 'admin' | 'user'
  permissions?: string[]
  name?: string
}

export interface ApiKeyMiddlewareConfig {
  keys?: Map<string, ApiKeyConfig>
  header?: string
  loadFromEnv?: boolean
}

// ============================================================================
// Runtime API Key Store
// ============================================================================

// Runtime API key store - used for dynamically registered keys
const runtimeApiKeys = new Map<string, ApiKeyConfig>()

/**
 * Register an API key at runtime.
 *
 * @param key - The API key string
 * @param config - The configuration for the key
 */
export function registerApiKey(key: string, config: ApiKeyConfig): void {
  runtimeApiKeys.set(key, config)
}

/**
 * Revoke an API key.
 *
 * @param key - The API key to revoke
 * @returns True if the key was found and removed
 */
export function revokeApiKey(key: string): boolean {
  return runtimeApiKeys.delete(key)
}

/**
 * Validate an API key and return its configuration.
 *
 * @param key - The API key to validate
 * @returns The key configuration if valid, undefined otherwise
 */
export function validateApiKey(key: string): ApiKeyConfig | undefined {
  return runtimeApiKeys.get(key)
}

/**
 * Clear all runtime API keys. Useful for testing.
 */
export function clearApiKeys(): void {
  runtimeApiKeys.clear()
}

// ============================================================================
// Environment Loading
// ============================================================================

/**
 * Load API keys from environment variable.
 *
 * API_KEYS should be a JSON string mapping key -> ApiKeyConfig
 *
 * Example env.API_KEYS:
 * {
 *   "prod-key-123": { "userId": "user-1", "role": "user", "name": "Production Key" },
 *   "admin-key-456": { "userId": "admin-1", "role": "admin", "name": "Admin Key" }
 * }
 *
 * SECURITY: API keys must NEVER be hardcoded in source code.
 * They must come from environment variables or KV storage.
 */
export function loadApiKeysFromEnv(env: Record<string, unknown>): Map<string, ApiKeyConfig> {
  const apiKeys = new Map<string, ApiKeyConfig>()

  const apiKeysJson = env.API_KEYS as string | undefined
  if (!apiKeysJson) {
    return apiKeys
  }

  try {
    const parsed = JSON.parse(apiKeysJson) as Record<string, ApiKeyConfig>
    for (const [key, config] of Object.entries(parsed)) {
      apiKeys.set(key, config)
    }
  } catch {
    // Invalid JSON - return empty map
    console.warn('Failed to parse API_KEYS environment variable')
  }

  return apiKeys
}

/**
 * Create an API key loader that checks multiple sources in order:
 * 1. Provided keys map
 * 2. Runtime-registered keys
 * 3. Environment keys
 * 4. KV storage
 */
export function getApiKeyLoader(
  staticKeys?: Map<string, ApiKeyConfig>,
  env?: Record<string, unknown>,
): (apiKey: string) => Promise<ApiKeyConfig | undefined> {
  // Load static keys from environment
  const envKeys = env ? loadApiKeysFromEnv(env) : new Map()

  // Get KV binding if available
  const kv = env?.KV as { get: (key: string) => Promise<string | null> } | undefined

  return async (apiKey: string): Promise<ApiKeyConfig | undefined> => {
    // Check static keys first
    if (staticKeys) {
      const staticConfig = staticKeys.get(apiKey)
      if (staticConfig) {
        return staticConfig
      }
    }

    // Check env keys
    const envConfig = envKeys.get(apiKey)
    if (envConfig) {
      return envConfig
    }

    // Check runtime-registered keys
    const runtimeConfig = runtimeApiKeys.get(apiKey)
    if (runtimeConfig) {
      return runtimeConfig
    }

    // Fall back to KV lookup
    if (kv) {
      try {
        const kvValue = await kv.get(`api-key:${apiKey}`)
        if (kvValue) {
          return JSON.parse(kvValue) as ApiKeyConfig
        }
      } catch {
        // KV lookup failed - return undefined
      }
    }

    return undefined
  }
}

// ============================================================================
// Middleware
// ============================================================================

const MIN_API_KEY_LENGTH = 10

/**
 * API key middleware for Hono.
 *
 * Validates API keys from the X-API-Key header (or custom header) and sets
 * the key configuration in the context under 'apiKeyConfig'.
 *
 * @param config - API key middleware configuration
 * @returns Hono middleware handler
 */
export function apiKeyMiddleware(config?: ApiKeyMiddlewareConfig): MiddlewareHandler {
  const headerName = config?.header || 'x-api-key'
  const staticKeys = config?.keys

  return async (c: Context, next: Next) => {
    const apiKey = c.req.header(headerName)

    if (!apiKey) {
      throw new HTTPException(401, { message: 'API key required' })
    }

    // Validate API key format
    if (apiKey.length < MIN_API_KEY_LENGTH) {
      throw new HTTPException(401, { message: 'Invalid API key format' })
    }

    // Get environment for loading keys
    const env = c.env as Record<string, unknown> | undefined
    const loader = getApiKeyLoader(staticKeys, env)

    const keyConfig = await loader(apiKey)
    if (!keyConfig) {
      throw new HTTPException(401, { message: 'Invalid API key' })
    }

    c.set('apiKeyConfig', keyConfig)

    return next()
  }
}

export default apiKeyMiddleware
