/**
 * Workflow Primitives - Durable Timers
 */

import type { DurationString } from './types'

/**
 * Parse a duration string to milliseconds
 */
export function parseDuration(duration: DurationString | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Sleep for a duration
 */
export async function sleep(duration: DurationString | number): Promise<void> {
  const ms = parseDuration(duration)
  if (ms <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Sleep until a specific timestamp
 */
export async function sleepUntil(timestamp: string | Date): Promise<void> {
  const target = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const now = Date.now()
  const ms = target.getTime() - now

  if (ms <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}
