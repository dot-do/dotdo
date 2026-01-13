/**
 * Router - Partition-aware routing for distributed processing
 *
 * Provides consistent hash-based key-to-partition routing with:
 * - Deterministic routing: same key always maps to same partition
 * - Even distribution: keys are approximately uniformly distributed
 * - Batch operations: efficient routing of multiple keys
 * - Shuffle operations: grouping data by key for distributed processing
 *
 * Uses MurmurHash3-inspired algorithm for good distribution properties.
 *
 * @module db/primitives/router
 */

// Re-export everything from keyed-router for backwards compatibility
// The "Keyed" prefix is an implementation detail - this is simply a Router
export {
  createKeyedRouter,
  createKeyedRouter as createRouter,
  type KeyedRouter,
  type KeyedRouter as Router,
  type KeyedRouterOptions,
  type KeyedRouterOptions as RouterOptions,
  KeyedRouterImpl,
  KeyedRouterImpl as RouterImpl,
} from './keyed-router'
