/**
 * ACID Types Module
 *
 * Types for ACID (Atomicity, Consistency, Isolation, Durability) operations
 * on Durable Objects. Provides type-safe interfaces for:
 *
 * - Clone operations with multiple consistency modes
 * - Lifecycle event tracking and status management
 * - Location/region configuration for multi-region testing
 *
 * @module types/acid
 *
 * @example
 * ```typescript
 * import {
 *   CloneMode,
 *   CloneOptions,
 *   CloneResult,
 *   LifecycleEvent,
 *   createLifecycleEvent
 * } from '@dotdo/types/acid'
 *
 * // Configure a clone operation
 * const options: CloneOptions = {
 *   mode: 'staged',
 *   to: 'https://target.api.dotdo.dev',
 *   includeHistory: true
 * }
 *
 * // Track lifecycle events
 * const event = createLifecycleEvent('clone', { target: options.to })
 * ```
 */

// Lifecycle types for clone operations and event tracking
export * from './lifecycle'
export type {
  // Clone mode types
  CloneMode,

  // Clone operation types
  CloneOptions,
  CloneResult,

  // Lifecycle tracking types
  LifecycleStatus,
  LifecycleOperation,
  LifecycleEvent,
} from './lifecycle'
export {
  // Type guards
  isCloneMode,
  isLifecycleStatus,
  isLifecycleOperation,

  // Validation helpers
  validateCloneOptions,
  createLifecycleEvent,
} from './lifecycle'

// Location types for multi-region testing
export * from './location'
export type {
  RegionHint,
  ColoCode,
  LocationConfig,
  ColoToRegion,
  ColosInRegion,
} from './location'
export {
  REGION_COLOS,
  ALL_REGIONS,
  ALL_COLOS,
  REGIONS_WITH_COLOS,
  getRegionForColo,
  getColosForRegion,
  isColoInRegion,
  getRandomColoInRegion,
  validateLocationConfig,
} from './location'
