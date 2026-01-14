/**
 * Duration utilities for time-based operations.
 *
 * Provides type-safe duration representations and conversions.
 * Supports both number (milliseconds) and string formats ('1h', '30m', '7d').
 *
 * @example
 * ```typescript
 * import { hours, minutes, seconds, milliseconds, toMillis } from './duration'
 *
 * // Create durations
 * const oneHour = hours(1)          // { hours: 1 }
 * const fiveMinutes = minutes(5)    // { minutes: 5 }
 * const halfSecond = milliseconds(500)
 *
 * // Convert to milliseconds
 * toMillis(oneHour)      // 3600000
 * toMillis(fiveMinutes)  // 300000
 * toMillis('1h')         // 3600000
 * toMillis(1000)         // 1000
 * ```
 *
 * @module primitives/utils/duration
 */

// =============================================================================
// DURATION TYPES
// =============================================================================

/**
 * Duration object with explicit time units.
 * Multiple units can be combined.
 */
export interface DurationObject {
  milliseconds?: number
  seconds?: number
  minutes?: number
  hours?: number
  days?: number
}

/**
 * Duration can be expressed as:
 * - A number (milliseconds)
 * - A duration object ({ hours: 1, minutes: 30 })
 * - A string ('1h', '30m', '7d', '1h30m')
 */
export type Duration = number | DurationObject | string

// =============================================================================
// DURATION FACTORIES
// =============================================================================

/**
 * Create a duration in milliseconds.
 */
export function milliseconds(ms: number): DurationObject {
  return { milliseconds: ms }
}

/**
 * Create a duration in seconds.
 */
export function seconds(s: number): DurationObject {
  return { seconds: s }
}

/**
 * Create a duration in minutes.
 */
export function minutes(m: number): DurationObject {
  return { minutes: m }
}

/**
 * Create a duration in hours.
 */
export function hours(h: number): DurationObject {
  return { hours: h }
}

/**
 * Create a duration in days.
 */
export function days(d: number): DurationObject {
  return { days: d }
}

// =============================================================================
// CONVERSION CONSTANTS
// =============================================================================

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

// =============================================================================
// DURATION PARSING
// =============================================================================

/**
 * Parse a duration string into milliseconds.
 * Supports: ms, s, m, h, d (case insensitive)
 *
 * @example
 * parseDurationString('1h')     // 3600000
 * parseDurationString('30m')    // 1800000
 * parseDurationString('1h30m')  // 5400000
 * parseDurationString('7d')     // 604800000
 */
function parseDurationString(str: string): number {
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi
  let totalMs = 0
  let match

  while ((match = pattern.exec(str)) !== null) {
    const value = parseFloat(match[1])
    const unit = match[2].toLowerCase()

    switch (unit) {
      case 'ms':
        totalMs += value
        break
      case 's':
        totalMs += value * MS_PER_SECOND
        break
      case 'm':
        totalMs += value * MS_PER_MINUTE
        break
      case 'h':
        totalMs += value * MS_PER_HOUR
        break
      case 'd':
        totalMs += value * MS_PER_DAY
        break
    }
  }

  return totalMs
}

/**
 * Convert a DurationObject to milliseconds.
 */
function durationObjectToMillis(obj: DurationObject): number {
  let totalMs = 0
  if (obj.milliseconds) totalMs += obj.milliseconds
  if (obj.seconds) totalMs += obj.seconds * MS_PER_SECOND
  if (obj.minutes) totalMs += obj.minutes * MS_PER_MINUTE
  if (obj.hours) totalMs += obj.hours * MS_PER_HOUR
  if (obj.days) totalMs += obj.days * MS_PER_DAY
  return totalMs
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Convert any Duration to milliseconds.
 *
 * @param duration - Duration as number (ms), string, or DurationObject
 * @returns Duration in milliseconds
 *
 * @example
 * toMillis(5000)           // 5000
 * toMillis('1h')           // 3600000
 * toMillis({ hours: 1 })   // 3600000
 * toMillis({ hours: 1, minutes: 30 })  // 5400000
 */
export function toMillis(duration: Duration): number {
  if (typeof duration === 'number') {
    return duration
  }
  if (typeof duration === 'string') {
    return parseDurationString(duration)
  }
  return durationObjectToMillis(duration)
}

/**
 * Format milliseconds as a human-readable duration string.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable string like "1h 30m 15s"
 */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) {
    return `${ms}ms`
  }

  const parts: string[] = []
  let remaining = ms

  if (remaining >= MS_PER_DAY) {
    const d = Math.floor(remaining / MS_PER_DAY)
    parts.push(`${d}d`)
    remaining %= MS_PER_DAY
  }
  if (remaining >= MS_PER_HOUR) {
    const h = Math.floor(remaining / MS_PER_HOUR)
    parts.push(`${h}h`)
    remaining %= MS_PER_HOUR
  }
  if (remaining >= MS_PER_MINUTE) {
    const m = Math.floor(remaining / MS_PER_MINUTE)
    parts.push(`${m}m`)
    remaining %= MS_PER_MINUTE
  }
  if (remaining >= MS_PER_SECOND) {
    const s = Math.floor(remaining / MS_PER_SECOND)
    parts.push(`${s}s`)
    remaining %= MS_PER_SECOND
  }
  if (remaining > 0 && parts.length === 0) {
    parts.push(`${remaining}ms`)
  }

  return parts.join(' ')
}
