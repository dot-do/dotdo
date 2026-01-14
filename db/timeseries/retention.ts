/**
 * Retention Policy Utilities
 *
 * Handles parsing and applying retention policies for time-series data.
 */

import type { RetentionConfig } from './types'

/**
 * Parse a duration string into milliseconds
 * Supported formats: "1h", "7d", "365d", "30m", "1000ms"
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const [, value, unit] = match
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return parseInt(value) * multipliers[unit]
}

/**
 * Get the retention duration in milliseconds for a tier
 */
export function getRetentionMs(config: RetentionConfig, tier: 'hot' | 'warm' | 'cold'): number {
  const value = config[tier]
  if (!value) {
    // Default values
    const defaults: Record<string, string> = {
      hot: '1h',
      warm: '7d',
      cold: '365d',
    }
    return parseDuration(defaults[tier])
  }
  return parseDuration(value)
}

/**
 * Determine which tier data should be stored in based on its age
 */
export function getTierForTimestamp(
  timestamp: number,
  config: RetentionConfig,
  now: number = Date.now()
): 'hot' | 'warm' | 'cold' | 'expired' {
  const age = now - timestamp

  const hotMs = getRetentionMs(config, 'hot')
  const warmMs = getRetentionMs(config, 'warm')
  const coldMs = getRetentionMs(config, 'cold')

  if (age <= hotMs) {
    return 'hot'
  } else if (age <= warmMs) {
    return 'warm'
  } else if (age <= coldMs) {
    return 'cold'
  } else {
    return 'expired'
  }
}

/**
 * Calculate the cutoff timestamp for a tier
 */
export function getCutoffTimestamp(
  config: RetentionConfig,
  tier: 'hot' | 'warm' | 'cold',
  now: number = Date.now()
): number {
  return now - getRetentionMs(config, tier)
}

/**
 * Check if a timestamp is within the retention period
 */
export function isWithinRetention(
  timestamp: number,
  config: RetentionConfig,
  now: number = Date.now()
): boolean {
  const coldMs = getRetentionMs(config, 'cold')
  return now - timestamp <= coldMs
}
