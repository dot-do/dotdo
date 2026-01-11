/**
 * Unified Duration utility for time-based primitives
 *
 * Provides a consistent Duration type and utilities across all primitives:
 * - temporal-store.ts (retention policies)
 * - window-manager.ts (windowing)
 * - watermark-service.ts (bounded out-of-orderness)
 * - schema-evolution.ts (history retention)
 */

/**
 * Duration input type - can be a number (milliseconds) or a string like '7d', '24h', '30m'
 *
 * Supported string formats:
 * - 'ms' - milliseconds (e.g., '1000ms')
 * - 's' - seconds (e.g., '30s')
 * - 'm' - minutes (e.g., '5m')
 * - 'h' - hours (e.g., '24h')
 * - 'd' - days (e.g., '7d')
 * - 'w' - weeks (e.g., '2w')
 */
export type Duration = number | string

/**
 * Parsed duration with milliseconds value
 */
export interface ParsedDuration {
  /** Duration in milliseconds */
  milliseconds: number
}

/**
 * Duration object interface for object-based APIs (e.g., WindowManager)
 */
export interface DurationObject {
  toMillis(): number
}

/**
 * Time unit multipliers in milliseconds
 */
const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
}

/**
 * Parse a duration string or number into ParsedDuration
 *
 * @param d - Duration as number (milliseconds) or string (e.g., '7d', '24h', '30m', '1000ms')
 * @returns ParsedDuration with milliseconds property
 * @throws Error if string format is invalid
 *
 * @example
 * parseDuration(1000)       // { milliseconds: 1000 }
 * parseDuration('1s')       // { milliseconds: 1000 }
 * parseDuration('5m')       // { milliseconds: 300000 }
 * parseDuration('1h')       // { milliseconds: 3600000 }
 * parseDuration('1d')       // { milliseconds: 86400000 }
 * parseDuration('1w')       // { milliseconds: 604800000 }
 */
export function parseDuration(d: Duration): ParsedDuration {
  if (typeof d === 'number') {
    return { milliseconds: d }
  }

  const match = d.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${d}. Use formats like '7d', '24h', '30m', '1000ms'`)
  }

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  return { milliseconds: value * UNIT_MULTIPLIERS[unit] }
}

/**
 * Parse a duration and return raw milliseconds value
 *
 * @param d - Duration as number (milliseconds) or string
 * @returns Duration in milliseconds
 *
 * @example
 * toMillis(1000)    // 1000
 * toMillis('1s')    // 1000
 * toMillis('5m')    // 300000
 */
export function toMillis(d: Duration): number {
  return parseDuration(d).milliseconds
}

/**
 * Format milliseconds as a human-readable duration string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., '7d', '24h', '30m', '1s', '500ms')
 *
 * @example
 * formatDuration(604800000)  // '7d'
 * formatDuration(86400000)   // '1d'
 * formatDuration(3600000)    // '1h'
 * formatDuration(60000)      // '1m'
 * formatDuration(1000)       // '1s'
 * formatDuration(500)        // '500ms'
 */
export function formatDuration(ms: number): string {
  if (ms === 0) {
    return '0ms'
  }

  // Try to express in the largest whole unit
  if (ms >= UNIT_MULTIPLIERS.w && ms % UNIT_MULTIPLIERS.w === 0) {
    return `${ms / UNIT_MULTIPLIERS.w}w`
  }
  if (ms >= UNIT_MULTIPLIERS.d && ms % UNIT_MULTIPLIERS.d === 0) {
    return `${ms / UNIT_MULTIPLIERS.d}d`
  }
  if (ms >= UNIT_MULTIPLIERS.h && ms % UNIT_MULTIPLIERS.h === 0) {
    return `${ms / UNIT_MULTIPLIERS.h}h`
  }
  if (ms >= UNIT_MULTIPLIERS.m && ms % UNIT_MULTIPLIERS.m === 0) {
    return `${ms / UNIT_MULTIPLIERS.m}m`
  }
  if (ms >= UNIT_MULTIPLIERS.s && ms % UNIT_MULTIPLIERS.s === 0) {
    return `${ms / UNIT_MULTIPLIERS.s}s`
  }

  return `${ms}ms`
}

// ============================================================================
// Object-based Duration API (for WindowManager compatibility)
// ============================================================================

/**
 * Internal implementation of DurationObject
 */
class DurationImpl implements DurationObject {
  constructor(private readonly ms: number) {}

  toMillis(): number {
    return this.ms
  }
}

/**
 * Create a Duration object from hours
 * @example hours(2).toMillis() // 7200000
 */
export function hours(n: number): DurationObject {
  return new DurationImpl(n * UNIT_MULTIPLIERS.h)
}

/**
 * Create a Duration object from minutes
 * @example minutes(30).toMillis() // 1800000
 */
export function minutes(n: number): DurationObject {
  return new DurationImpl(n * UNIT_MULTIPLIERS.m)
}

/**
 * Create a Duration object from seconds
 * @example seconds(10).toMillis() // 10000
 */
export function seconds(n: number): DurationObject {
  return new DurationImpl(n * UNIT_MULTIPLIERS.s)
}

/**
 * Create a Duration object from milliseconds
 * @example milliseconds(500).toMillis() // 500
 */
export function milliseconds(n: number): DurationObject {
  return new DurationImpl(n)
}

/**
 * Create a Duration object from days
 * @example days(7).toMillis() // 604800000
 */
export function days(n: number): DurationObject {
  return new DurationImpl(n * UNIT_MULTIPLIERS.d)
}

/**
 * Create a Duration object from weeks
 * @example weeks(2).toMillis() // 1209600000
 */
export function weeks(n: number): DurationObject {
  return new DurationImpl(n * UNIT_MULTIPLIERS.w)
}

/**
 * Create a Duration object from a Duration input (string or number)
 * @example duration('1h').toMillis() // 3600000
 */
export function duration(d: Duration): DurationObject {
  return new DurationImpl(toMillis(d))
}
