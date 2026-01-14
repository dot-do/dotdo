/**
 * Environment type definitions for Vercel Edge deployment
 *
 * @module deploy/vercel/env.d.ts
 */

/**
 * Vercel Edge environment variables
 */
export interface VercelEnv {
  /**
   * Turso/libSQL database URL
   * @example 'libsql://my-db-username.turso.io'
   */
  TURSO_URL: string

  /**
   * Turso auth token
   */
  TURSO_TOKEN: string

  /**
   * Edge function region (optional)
   * @example 'iad1', 'sfo1', 'cdg1'
   */
  VERCEL_REGION?: string

  /**
   * Node ID for this edge function instance
   * Generated from VERCEL_REGION + random suffix
   */
  NODE_ID?: string

  /**
   * DO class mappings (JSON string)
   * Maps DO type to class constructor
   * @example '{"Business":"Business","Agent":"Agent"}'
   */
  DO_CLASSES?: string

  /**
   * Default DO class when type is not specified
   * @default 'DO'
   */
  DEFAULT_DO_CLASS?: string

  /**
   * Enable consistency guard
   * @default 'true'
   */
  ENABLE_CONSISTENCY_GUARD?: string

  /**
   * Lock TTL in milliseconds
   * @default '30000'
   */
  LOCK_TTL_MS?: string

  /**
   * Debug mode
   * @default 'false'
   */
  DEBUG?: string
}

/**
 * Environment with type assertions
 */
export function getEnv(env: Record<string, string | undefined>): VercelEnv {
  const tursoUrl = env.TURSO_URL
  const tursoToken = env.TURSO_TOKEN

  if (!tursoUrl) {
    throw new Error('TURSO_URL environment variable is required')
  }
  if (!tursoToken) {
    throw new Error('TURSO_TOKEN environment variable is required')
  }

  return {
    TURSO_URL: tursoUrl,
    TURSO_TOKEN: tursoToken,
    VERCEL_REGION: env.VERCEL_REGION,
    NODE_ID: env.NODE_ID || `${env.VERCEL_REGION || 'local'}-${Math.random().toString(36).slice(2, 8)}`,
    DO_CLASSES: env.DO_CLASSES,
    DEFAULT_DO_CLASS: env.DEFAULT_DO_CLASS || 'DO',
    ENABLE_CONSISTENCY_GUARD: env.ENABLE_CONSISTENCY_GUARD || 'true',
    LOCK_TTL_MS: env.LOCK_TTL_MS || '30000',
    DEBUG: env.DEBUG || 'false',
  }
}

/**
 * Parse DO classes from environment
 */
export function parseDOClasses(env: VercelEnv): Record<string, string> {
  if (!env.DO_CLASSES) {
    return {}
  }

  try {
    return JSON.parse(env.DO_CLASSES)
  } catch {
    console.error('Failed to parse DO_CLASSES environment variable')
    return {}
  }
}

/**
 * Check if debug mode is enabled
 */
export function isDebug(env: VercelEnv): boolean {
  return env.DEBUG === 'true' || env.DEBUG === '1'
}

/**
 * Check if consistency guard is enabled
 */
export function isConsistencyGuardEnabled(env: VercelEnv): boolean {
  return env.ENABLE_CONSISTENCY_GUARD !== 'false' && env.ENABLE_CONSISTENCY_GUARD !== '0'
}

/**
 * Get lock TTL in milliseconds
 */
export function getLockTtl(env: VercelEnv): number {
  const ttl = parseInt(env.LOCK_TTL_MS || '30000', 10)
  return isNaN(ttl) ? 30000 : ttl
}
