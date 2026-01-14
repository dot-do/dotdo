/**
 * Health Check Utilities
 *
 * This module provides health check functionality for the API router.
 * It reports on cache status, binding availability, and overall system health.
 *
 * Design principles:
 * - Fast: No DO calls, just local state inspection
 * - Lightweight: Minimal processing overhead
 * - Informative: Reports actionable status information
 *
 * @module api/utils/health
 */

import type { Env } from '../types'
import { getNounConfigCacheStats } from './router'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Health status levels
 *
 * - healthy: All systems operational
 * - degraded: Some non-critical bindings missing or issues detected
 * - unhealthy: Critical bindings missing, system cannot function properly
 */
export type HealthStatusLevel = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Cache health information
 */
export interface CacheHealth {
  /** Current status of the cache */
  status: 'ok' | 'warning' | 'error'
  /** Current number of entries in the cache */
  size: number
  /** Maximum allowed entries before eviction */
  maxSize: number
  /** Cache entry time-to-live in milliseconds */
  ttlMs: number
  /** Cache utilization percentage (0-100) */
  utilizationPercent: number
}

/**
 * Binding availability information
 *
 * Maps binding names to their availability status.
 * true = binding is available
 * false = binding is not configured
 */
export interface BindingHealth {
  /** Main Durable Object binding */
  DO: boolean
  /** Browser automation DO binding */
  BROWSER_DO: boolean
  /** Sandbox execution DO binding */
  SANDBOX_DO: boolean
  /** Observability broadcaster DO binding */
  OBS_BROADCASTER: boolean
  /** Collection DO binding */
  COLLECTION_DO: boolean
  /** Replica DO binding (optional) */
  REPLICA_DO: boolean
  /** KV namespace binding */
  KV: boolean
  /** R2 bucket binding */
  R2: boolean
  /** AI binding */
  AI: boolean
}

/**
 * Complete health status response
 */
export interface HealthStatus {
  /** Overall health status */
  status: HealthStatusLevel
  /** ISO 8601 timestamp of the health check */
  timestamp: string
  /** Application version (from environment or package) */
  version?: string
  /** Detailed health checks */
  checks: {
    /** Cache health information */
    cache: CacheHealth
    /** Binding availability */
    bindings: BindingHealth
  }
}

// ============================================================================
// HEALTH CHECK IMPLEMENTATION
// ============================================================================

/**
 * Critical bindings that must be present for the system to function
 */
const CRITICAL_BINDINGS: Array<keyof BindingHealth> = ['DO']

/**
 * Important bindings that should be present for full functionality
 */
const IMPORTANT_BINDINGS: Array<keyof BindingHealth> = [
  'BROWSER_DO',
  'SANDBOX_DO',
  'OBS_BROADCASTER',
  'KV',
]

/**
 * Check if a binding is available in the environment
 *
 * @param env - Environment object to check
 * @param name - Name of the binding to check
 * @returns true if binding exists and is not undefined/null
 */
function isBindingAvailable(env: Env, name: string): boolean {
  const value = (env as Record<string, unknown>)[name]
  return value !== undefined && value !== null
}

/**
 * Get binding availability for all known bindings
 *
 * @param env - Environment object to check
 * @returns Object mapping binding names to availability
 */
function getBindingHealth(env: Env): BindingHealth {
  return {
    DO: isBindingAvailable(env, 'DO'),
    BROWSER_DO: isBindingAvailable(env, 'BROWSER_DO'),
    SANDBOX_DO: isBindingAvailable(env, 'SANDBOX_DO'),
    OBS_BROADCASTER: isBindingAvailable(env, 'OBS_BROADCASTER'),
    COLLECTION_DO: isBindingAvailable(env, 'COLLECTION_DO'),
    REPLICA_DO: isBindingAvailable(env, 'REPLICA_DO'),
    KV: isBindingAvailable(env, 'KV'),
    R2: isBindingAvailable(env, 'R2'),
    AI: isBindingAvailable(env, 'AI'),
  }
}

/**
 * Get cache health information
 *
 * @returns Cache health status including size, capacity, and utilization
 */
function getCacheHealth(): CacheHealth {
  const stats = getNounConfigCacheStats()
  const utilizationPercent = stats.maxSize > 0
    ? Math.round((stats.size / stats.maxSize) * 100)
    : 0

  // Determine cache status based on utilization
  let status: 'ok' | 'warning' | 'error' = 'ok'
  if (utilizationPercent >= 90) {
    status = 'warning' // Cache is nearly full, may trigger evictions
  }

  return {
    status,
    size: stats.size,
    maxSize: stats.maxSize,
    ttlMs: stats.ttlMs,
    utilizationPercent,
  }
}

/**
 * Determine overall health status based on binding availability
 *
 * @param bindings - Binding health information
 * @returns Overall health status level
 */
function determineHealthStatus(bindings: BindingHealth): HealthStatusLevel {
  // Check critical bindings - if any are missing, system is unhealthy
  for (const binding of CRITICAL_BINDINGS) {
    if (!bindings[binding]) {
      return 'unhealthy'
    }
  }

  // Check important bindings - if any are missing, system is degraded
  for (const binding of IMPORTANT_BINDINGS) {
    if (!bindings[binding]) {
      return 'degraded'
    }
  }

  return 'healthy'
}

/**
 * Get complete health status for the API
 *
 * This function performs a quick health check that:
 * - Checks cache statistics (no external calls)
 * - Verifies binding availability (no DO calls)
 * - Returns quickly (< 10ms target)
 *
 * @param env - Environment object with bindings
 * @param version - Optional version string to include in response
 * @returns Complete health status
 *
 * @example
 * ```typescript
 * const health = await getHealthStatus(env, '1.0.0')
 * // Returns:
 * // {
 * //   status: 'healthy',
 * //   timestamp: '2024-01-15T12:00:00.000Z',
 * //   version: '1.0.0',
 * //   checks: {
 * //     cache: { status: 'ok', size: 5, maxSize: 100, ttlMs: 300000, utilizationPercent: 5 },
 * //     bindings: { DO: true, BROWSER_DO: true, ... }
 * //   }
 * // }
 * ```
 */
export async function getHealthStatus(
  env: Env,
  version?: string
): Promise<HealthStatus> {
  // Get binding availability (synchronous, fast)
  const bindings = getBindingHealth(env)

  // Get cache health (synchronous, fast)
  const cache = getCacheHealth()

  // Determine overall status
  const status = determineHealthStatus(bindings)

  return {
    status,
    timestamp: new Date().toISOString(),
    version,
    checks: {
      cache,
      bindings,
    },
  }
}

/**
 * Check if the system is healthy enough to serve requests
 *
 * This is a quick check that can be used in middleware or routing
 * to fail fast if critical bindings are unavailable.
 *
 * @param env - Environment object with bindings
 * @returns true if system can serve requests, false otherwise
 */
export function isSystemHealthy(env: Env): boolean {
  // Quick check: just verify critical bindings exist
  return isBindingAvailable(env, 'DO')
}
