/**
 * Lifecycle Modules
 *
 * This module exports all lifecycle operations for Durable Objects.
 * Each module handles a specific concern and is lazy-loaded to minimize cold start impact.
 */

// Types
export * from './types'

// Lifecycle modules
export { CloneModule, createCloneModule } from './Clone'
export { BranchModule, createBranchModule } from './Branch'
export { CompactModule, createCompactModule, type CompactOptions, type CompactResult } from './Compact'
export { PromoteModule, createPromoteModule, type PromoteResult, type DemoteResult } from './Promote'
export { ShardModule, createShardModule } from './Shard'
