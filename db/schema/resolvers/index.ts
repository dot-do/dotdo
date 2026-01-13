/**
 * Cascade Resolvers Public API
 *
 * Provides unified access to forward and backward cascade resolution.
 *
 * The cascade resolver system handles:
 * - Forward operators: `->` (insert) and `~>` (search)
 * - Backward operators: `<-` (insert) and `<~` (search)
 *
 * Both ForwardCascadeResolver and BackwardCascadeResolver extend the
 * BaseCascadeResolver abstract class, which consolidates shared patterns:
 * - Entity generation with ID assignment
 * - Relationship creation
 * - Semantic search
 * - Context propagation
 * - Verb mapping
 *
 * @example
 * ```typescript
 * import {
 *   ForwardCascadeResolver,
 *   BackwardCascadeResolver,
 *   BaseCascadeResolver,
 * } from 'db/schema/resolvers'
 *
 * // Forward cascade: from=this, to=target
 * const forwardResolver = new ForwardCascadeResolver({
 *   generate: async (opts) => aiService.generate(opts),
 * })
 *
 * // Backward cascade: from=target, to=this
 * const backwardResolver = new BackwardCascadeResolver({
 *   generator: async (ctx) => aiService.generate(ctx),
 * })
 * ```
 */

// Shared types, utilities, and base class
export {
  type Entity,
  type Relationship,
  type SemanticSearchResult,
  type TypeSchema,
  // New consolidated types from refactor
  type GenerationContext as SharedGenerationContext,
  type GenerateOptions as SharedGenerateOptions,
  type SearchOptions,
  type RelationshipOptions,
  type BaseCascadeResolverOptions,
  // Utilities
  generateEntityId,
  generateRelationshipId,
  buildSearchQuery,
  sortByGenerationTime,
  buildCascadeMetadata,
  createRelationship,
  // Base class for custom resolver implementations
  BaseCascadeResolver,
} from './shared'

// Forward cascade resolver
export {
  ForwardCascadeResolver,
  resolveForwardInsert,
  resolveForwardSearch,
  // Session cache for within-generation caching
  SessionCache,
  // Semantic search helper
  createSemanticSearchHelper,
  // Factory with integrated caching
  createForwardResolverWithCache,
  // Types (maintain backward compatibility with original names)
  type ParsedReference,
  type GenerationContext,
  type ForwardCascadeResolverOptions,
  type GenerateOptions,
  type SemanticSearchOptions,
  type CreateRelationshipOptions,
  type ShorthandReference,
  type EmbedFunction,
  type VectorSearchFunction,
  type EntityLoaderFunction,
  type SemanticSearchHelperOptions,
  type ForwardCascadeResolverWithCacheOptions,
} from './forward'

// Backward cascade resolver
export {
  BackwardCascadeResolver,
  resolveBackwardInsert,
  resolveBackwardSearch,
  parseBackwardReference,
  deriveReverseVerb,
  type BackwardReference,
  type BackwardResolutionContext,
  type BackwardResolutionResult,
  type MatchResult,
  type ParsedBackwardReference,
  type ResolverOptions,
} from './backward'

// Verb derivation utilities
export { deriveVerbFromFieldName } from './verb-derivation'

// Parallel cascade utilities for distributed execution
export {
  // Types
  type ParallelismMode,
  type ShardingStrategy,
  type CascadeShard,
  type CascadeBatch,
  type CascadeOperation,
  type BatchResult,
  type BatchError,
  type BatchMetrics,
  type ParallelCascadeConfig,
  type ParallelCascadePlan,
  type ParallelCascadeResult,
  type ParallelCascadeMetrics,
  type CascadeError,
  type DOInvoker,
  // Sharding strategies
  createTypeShardingStrategy,
  createEntityShardingStrategy,
  createHybridShardingStrategy,
  // Planning
  CascadeBatchPlanner,
  // Execution
  ParallelCascadeExecutor,
  // High-level API
  ParallelCascadeCoordinator,
  createParallelCascadeCoordinator,
  // Utilities
  estimateShardCount,
  validateCascadePlan,
} from './parallel'
