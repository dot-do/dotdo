/**
 * Auth Defaults - Default authentication configuration for dotdo
 *
 * Provides secure defaults for all methods with:
 * - Public methods for health/version (read-only operations)
 * - User-level for standard data access
 * - Admin-level for management operations
 * - System-level for internal operations
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Role hierarchy: public < user < admin < system
 */
export type Role = 'public' | 'user' | 'admin' | 'system'

/**
 * Audit levels for tracking method calls
 */
export type AuditLevel = 'none' | 'basic' | 'full'

/**
 * Configuration for a single method's authentication requirements
 */
export interface MethodAuthConfig {
  /** No auth required - accessible to everyone */
  public?: boolean
  /** Any authenticated user can access */
  requireAuth?: boolean
  /** Specific roles required to access */
  roles?: Role[]
  /** Specific permissions required */
  permissions?: string[]
  /** Audit level for this method */
  audit?: AuditLevel
}

/**
 * Complete auth configuration mapping methods to their auth requirements
 */
export type AuthConfig = Record<string, MethodAuthConfig>

// =============================================================================
// Default Configuration
// =============================================================================

const _DEFAULT_AUTH_CONFIG: AuthConfig = {
  // System endpoints
  '$introspect': { requireAuth: true },
  '$health': { public: true },
  '$version': { public: true },
  '$metrics': { roles: ['admin'] },

  // Things (data) endpoints
  'things.list': { requireAuth: true },
  'things.get': { requireAuth: true },
  'things.create': { requireAuth: true, permissions: ['write'] },
  'things.update': { requireAuth: true, permissions: ['write'] },
  'things.delete': { roles: ['admin'], audit: 'full' },

  // Actions and events (admin only)
  'actions.*': { roles: ['admin'] },
  'events.*': { roles: ['admin'] },

  // Storage endpoints
  'fsx.*': { requireAuth: true },
  'gitx.*': { requireAuth: true },
  'bashx.*': { roles: ['admin'], audit: 'full' },
  'r2.*': { roles: ['admin'] },
  'sql.*': { roles: ['admin'] },

  // Platform endpoints
  'users.me': { requireAuth: true },
  'users.*': { roles: ['admin'] },
  'orgs.*': { roles: ['admin'] },

  // System internals
  'dlq.*': { roles: ['system'] },
  'objects.*': { roles: ['system'] },
}

/**
 * Default auth configuration with secure defaults.
 * This object is frozen to prevent accidental modification.
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = Object.freeze(_DEFAULT_AUTH_CONFIG)

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Merge custom auth configuration with defaults.
 * Custom config takes precedence, but properties are deep merged.
 *
 * @param custom - Custom configuration to merge with defaults
 * @returns Frozen merged configuration
 */
export function mergeAuthConfig(custom: Partial<AuthConfig>): AuthConfig {
  const result: AuthConfig = {}

  // Copy all defaults
  for (const [key, value] of Object.entries(DEFAULT_AUTH_CONFIG)) {
    result[key] = { ...value }
  }

  // Merge custom config
  for (const [key, value] of Object.entries(custom)) {
    if (result[key]) {
      // Deep merge with existing default
      result[key] = { ...result[key], ...value }
    } else {
      // Add new entry
      result[key] = { ...value }
    }
  }

  return Object.freeze(result)
}

/**
 * Match a method name against an auth pattern.
 * Supports:
 * - Exact matches: 'users.me' matches 'users.me'
 * - Single wildcard: 'bashx.*' matches 'bashx.exec' but not 'bashx.scripts.run'
 * - Double wildcard: 'fsx.**' matches 'fsx.read' and 'fsx.files.nested.read'
 *
 * @param method - The method name to check
 * @param pattern - The pattern to match against
 * @returns True if the method matches the pattern
 */
export function matchAuthPattern(method: string, pattern: string): boolean {
  // Handle empty strings
  if (!method || !pattern) {
    return false
  }

  // Handle leading/trailing dots
  if (method.startsWith('.') || method.endsWith('.')) {
    return false
  }

  // Exact match
  if (method === pattern) {
    return true
  }

  // Double wildcard (**) - matches any depth
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3) // Remove '.**'
    return method.startsWith(prefix + '.')
  }

  // Single wildcard (*) - matches exactly one level
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2) // Remove '.*'
    if (!method.startsWith(prefix + '.')) {
      return false
    }
    const suffix = method.slice(prefix.length + 1)
    // Must not contain additional dots (single level only)
    return !suffix.includes('.')
  }

  return false
}

/**
 * Calculate pattern specificity for precedence ordering.
 * Higher number = more specific pattern.
 *
 * @param pattern - The pattern to calculate specificity for
 * @returns Specificity score
 */
function getPatternSpecificity(pattern: string): number {
  // Exact match is most specific
  if (!pattern.includes('*')) {
    return 1000
  }

  // Count dots for prefix length
  const dotCount = pattern.replace(/\.\*+$/, '').split('.').length - 1

  // Single wildcard is more specific than double
  if (pattern.endsWith('.**')) {
    return dotCount * 10
  }

  if (pattern.endsWith('.*')) {
    return dotCount * 10 + 5
  }

  return 0
}

/**
 * Get auth configuration for a specific method.
 * Looks up the method in the config, checking both exact matches and patterns.
 * Prefers more specific patterns over less specific ones.
 * Falls back to DEFAULT_AUTH_CONFIG if method not found in custom config.
 *
 * @param method - The method name to look up
 * @param config - Optional custom config (will fallback to defaults)
 * @returns The auth configuration for the method
 */
export function getMethodAuth(method: string, config?: AuthConfig): MethodAuthConfig {
  // Helper function to find auth in a single config
  function findInConfig(cfg: AuthConfig): MethodAuthConfig | null {
    // First, check for exact match
    if (cfg[method]) {
      return cfg[method]
    }

    // Find all matching patterns and sort by specificity
    const matches: Array<{ pattern: string; specificity: number }> = []

    for (const pattern of Object.keys(cfg)) {
      if (matchAuthPattern(method, pattern)) {
        matches.push({
          pattern,
          specificity: getPatternSpecificity(pattern),
        })
      }
    }

    // Sort by specificity (highest first) and return the most specific match
    if (matches.length > 0) {
      matches.sort((a, b) => b.specificity - a.specificity)
      return cfg[matches[0].pattern]
    }

    return null
  }

  // If custom config provided, check it first, then fall back to defaults
  if (config) {
    const customResult = findInConfig(config)
    if (customResult) {
      return customResult
    }
    // Fall back to defaults
    const defaultResult = findInConfig(DEFAULT_AUTH_CONFIG)
    if (defaultResult) {
      return defaultResult
    }
  } else {
    // Use defaults directly
    const defaultResult = findInConfig(DEFAULT_AUTH_CONFIG)
    if (defaultResult) {
      return defaultResult
    }
  }

  // Default for unknown methods: require authentication
  return { requireAuth: true }
}
