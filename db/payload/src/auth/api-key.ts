/**
 * API Key Validation
 *
 * Validates API keys with support for:
 * - Key lookup and verification
 * - Expiration checking
 * - User ban checking
 * - Rate limiting
 * - Permission scope validation
 */

// ============================================================================
// Types
// ============================================================================

export interface ApiKeyDatabase {
  query: {
    apiKeys: {
      findFirst: (opts: { where: any; with?: any }) => Promise<ApiKeyWithUser | null>
    }
  }
}

export interface ApiKeyWithUser {
  id: string
  key: string
  name: string
  enabled: boolean
  expiresAt?: Date | null
  permissions?: string | null // JSON string of scopes
  rateLimit?: number | null
  userId: string
  user: {
    id: string
    email: string
    name: string | null
    role?: string | null
    banned?: boolean
  } | null
}

export interface RateLimitStore {
  get: (key: string) => Promise<{ count: number; resetAt: number } | null>
  set: (key: string, data: { count: number; resetAt: number }) => Promise<void>
  increment: (key: string) => Promise<number>
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: number
}

export interface ValidateApiKeyOptions {
  rateLimitStore?: RateLimitStore
  defaultRateLimit?: number // requests per window
  rateLimitWindow?: number // window in ms
  requiredScope?: string // scope to check
}

// ============================================================================
// Validation Result Types
// ============================================================================

export type ApiKeyValidationResult =
  | {
      valid: true
      user: {
        id: string
        email: string
        name: string | null
      }
      apiKey: {
        id: string
        name: string
        scopes: string[]
      }
      rateLimit?: RateLimitInfo
    }
  | {
      valid: false
      error:
        | 'invalid_key'
        | 'api_key_not_found'
        | 'api_key_disabled'
        | 'api_key_expired'
        | 'user_banned'
        | 'user_not_found'
        | 'rate_limit_exceeded'
        | 'insufficient_scope'
      rateLimit?: RateLimitInfo
    }

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate an API key
 *
 * @param db - Database interface with apiKeys query
 * @param key - The API key string to validate
 * @param options - Optional validation settings
 * @returns Validation result with user/apiKey data or error
 */
export async function validateApiKey(
  db: ApiKeyDatabase,
  key: string | null | undefined,
  options: ValidateApiKeyOptions = {},
): Promise<ApiKeyValidationResult> {
  // Check for missing/invalid key
  if (!key) {
    return { valid: false, error: 'invalid_key' }
  }

  // Lookup the API key
  const apiKey = await db.query.apiKeys.findFirst({
    where: (keys: any, { eq }: any) => eq(keys.key, key),
    with: { user: true },
  })

  // Key not found
  if (!apiKey) {
    return { valid: false, error: 'api_key_not_found' }
  }

  // Key is disabled
  if (!apiKey.enabled) {
    return { valid: false, error: 'api_key_disabled' }
  }

  // Key is expired
  if (apiKey.expiresAt && new Date() >= apiKey.expiresAt) {
    return { valid: false, error: 'api_key_expired' }
  }

  // User not found (orphaned key)
  if (!apiKey.user) {
    return { valid: false, error: 'user_not_found' }
  }

  // User is banned
  if (apiKey.user.banned) {
    return { valid: false, error: 'user_banned' }
  }

  // Check rate limit
  if (options.rateLimitStore) {
    const limit = apiKey.rateLimit ?? options.defaultRateLimit ?? 1000
    const window = options.rateLimitWindow ?? 60 * 60 * 1000 // 1 hour

    const current = await options.rateLimitStore.get(key)
    if (current && current.count >= limit && Date.now() < current.resetAt) {
      return {
        valid: false,
        error: 'rate_limit_exceeded',
        rateLimit: { limit, remaining: 0, resetAt: current.resetAt },
      }
    }
  }

  // Parse scopes from permissions JSON
  const scopes = apiKey.permissions ? (JSON.parse(apiKey.permissions) as string[]) : []

  // Check required scope
  if (options.requiredScope && !hasScope(scopes, options.requiredScope)) {
    return { valid: false, error: 'insufficient_scope' }
  }

  return {
    valid: true,
    user: {
      id: apiKey.user.id,
      email: apiKey.user.email,
      name: apiKey.user.name,
    },
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      scopes,
    },
  }
}

// ============================================================================
// Scope Checking
// ============================================================================

/**
 * Check if a set of scopes includes the required scope
 *
 * Supports:
 * - Exact matches: 'read:posts' matches 'read:posts'
 * - Wildcard '*' matches everything
 * - Action wildcards: 'read:*' matches 'read:posts', 'read:users', etc.
 *
 * @param scopes - Array of granted scopes
 * @param required - The required scope to check
 * @returns true if scope is granted
 */
export function hasScope(scopes: string[], required: string): boolean {
  // Full admin scope
  if (scopes.includes('*')) return true

  // Exact match
  if (scopes.includes(required)) return true

  // Check wildcards like 'read:*' matching 'read:posts'
  const [action] = required.split(':')
  return scopes.includes(`${action}:*`)
}
