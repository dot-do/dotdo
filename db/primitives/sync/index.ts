/**
 * Sync Primitives - Core building blocks for bidirectional data synchronization
 *
 * This module provides primitives for implementing Census/Hightouch-style
 * reverse ETL and bidirectional sync workflows.
 *
 * ## Components
 *
 * - **ConflictDetector**: Identifies conflicts in bidirectional sync scenarios
 * - **RateLimiter**: Rate limits requests to respect destination API limits
 *
 * ## Usage Example
 *
 * ```typescript
 * import {
 *   ConflictDetector,
 *   createConflictDetector,
 *   RateLimiter,
 *   createRateLimiter
 * } from '@dotdo/primitives/sync'
 *
 * // Conflict detection
 * const detector = createConflictDetector({
 *   defaultStrategy: 'last-write-wins'
 * })
 * const conflicts = detector.detect(sourceChanges, destChanges)
 *
 * // Rate limiting
 * const limiter = createRateLimiter({
 *   requestsPerSecond: 10,
 *   burstSize: 20
 * })
 * await limiter.acquire()
 * await callDestinationAPI()
 * ```
 *
 * @module db/primitives/sync
 */

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

export {
  ConflictDetector,
  createConflictDetector,
  type Conflict,
  type DiffRecord,
  type DiffResult,
  type ConflictResolutionStrategy,
  type FieldComparator,
  type ConflictDetectorOptions,
} from './conflict-detector'

// =============================================================================
// RATE LIMITING
// =============================================================================

export {
  RateLimiter,
  createRateLimiter,
  type RateLimitConfig,
} from './rate-limiter'
