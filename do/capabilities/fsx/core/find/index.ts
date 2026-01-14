/**
 * Advanced file discovery for fsx
 *
 * Provides Unix find-like functionality for searching files in the virtual filesystem.
 * Supports filtering by name patterns, file type, size, timestamps, and more.
 * Includes timeout and cancellation support for long-running searches.
 *
 * @example
 * ```typescript
 * import { find, FindTimeoutError } from 'fsx/find'
 *
 * // Find all TypeScript files
 * const tsFiles = await find({ name: '*.ts' })
 *
 * // With timeout handling
 * try {
 *   const results = await find({ path: '/', timeout: 5000 })
 * } catch (err) {
 *   if (err instanceof FindTimeoutError) {
 *     console.log('Search took too long')
 *   }
 * }
 * ```
 *
 * @module find
 */

export {
  find,
  FindTimeoutError,
  FindAbortedError,
  type FindOptions,
  type FindResult
} from './find'
