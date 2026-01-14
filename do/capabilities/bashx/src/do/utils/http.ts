/**
 * HTTP utilities for Cloudflare Workers and Hono
 *
 * @module bashx/do/utils/http
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Converts a numeric HTTP status code to Hono's ContentfulStatusCode type.
 * Clamps values to valid HTTP range (100-599).
 *
 * @param code - Numeric status code
 * @returns Type-safe ContentfulStatusCode
 * @example
 * toContentfulStatus(200) // 200 as ContentfulStatusCode
 * toContentfulStatus(404) // 404 as ContentfulStatusCode
 * toContentfulStatus(999) // 599 as ContentfulStatusCode (clamped)
 * toContentfulStatus(50)  // 100 as ContentfulStatusCode (clamped)
 */
export function toContentfulStatus(code: number): ContentfulStatusCode {
  return Math.min(Math.max(code, 100), 599) as ContentfulStatusCode
}
