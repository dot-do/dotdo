/**
 * Safe JSON parsing utilities
 *
 * Provides robust JSON parsing that gracefully handles corrupted data.
 */

import type { Logger } from './logger'

/**
 * Safely parse JSON with a fallback value
 *
 * @param json - The JSON string to parse
 * @param fallback - The fallback value to return if parsing fails
 * @param logger - Optional logger for debug output
 * @returns The parsed value or the fallback
 */
export function safeJsonParse<T>(json: string, fallback: T, logger?: Logger): T {
  try {
    return JSON.parse(json) as T
  } catch (error) {
    if (logger) {
      logger.debug('Failed to parse JSON, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        jsonPreview: json.length > 50 ? json.slice(0, 50) + '...' : json,
      })
    }
    return fallback
  }
}
