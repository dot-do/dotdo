/**
 * Window Primitives - Utility Functions
 */

import type { DurationString } from './types'

/**
 * Parse duration string to milliseconds
 * Supports: '1h', '30m', '5s', '100ms'
 */
export function parseDuration(duration: DurationString | number): number {
  if (typeof duration === 'number') {
    return duration
  }

  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1], 10)
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
 * Generate a unique ID for windows
 */
export function generateWindowId(prefix: string, startTime: number): string {
  return `${prefix}_${startTime}`
}

/**
 * Calculate tumbling window boundaries for a timestamp
 */
export function getTumblingWindowBounds(
  timestamp: number,
  sizeMs: number
): { start: number; end: number } {
  const start = Math.floor(timestamp / sizeMs) * sizeMs
  return {
    start,
    end: start + sizeMs,
  }
}

/**
 * Calculate all sliding windows that contain a timestamp
 */
export function getSlidingWindowBounds(
  timestamp: number,
  sizeMs: number,
  slideMs: number
): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = []

  // Find the first window that contains this timestamp
  // Window contains timestamp if: start <= timestamp < end (where end = start + size)
  // So we need: timestamp - size < start <= timestamp

  // The latest window start that could contain the timestamp
  const latestStart = Math.floor(timestamp / slideMs) * slideMs

  // Count how many windows we need to check
  const numWindows = Math.ceil(sizeMs / slideMs)

  for (let i = 0; i < numWindows; i++) {
    const start = latestStart - i * slideMs
    const end = start + sizeMs

    // Check if window contains timestamp
    if (start <= timestamp && timestamp < end) {
      windows.push({ start, end })
    }
  }

  return windows.sort((a, b) => a.start - b.start)
}
