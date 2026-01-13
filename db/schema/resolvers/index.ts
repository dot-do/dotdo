/**
 * Cascade Resolvers Public API
 *
 * Provides unified access to forward and backward cascade resolution.
 */

// Shared types and utilities
export {
  type Entity,
  type Relationship,
  type SemanticSearchResult,
  type TypeSchema,
  generateEntityId,
  generateRelationshipId,
  buildSearchQuery,
  sortByGenerationTime,
  buildCascadeMetadata,
  createRelationship,
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
  // Types
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
