/**
 * @module db/schema/cascade
 *
 * Cascade generation utilities for scale-out entity generation.
 *
 * This module provides:
 * - CascadeGenerator: Multi-level cascade entity generation
 * - ParallelBatchGenerator: Concurrent batch entity generation
 * - DistributedCascadeExecutor: DO-distributed cascade execution
 * - CachedCascadeGenerator: Cached entity generation with deduplication
 */

export { CascadeGenerator, type CascadeGeneratorConfig, type CascadeGeneratorResult, type CascadeEntity, type CascadeRelationship } from './generator'

export { ParallelBatchGenerator, type ParallelBatchConfig, type BatchGenerateOptions, type ParallelBatchResult, type GeneratedEntity, type BatchError } from './parallel-generator'

export { DistributedCascadeExecutor, type DistributedExecutorConfig, type DONamespaceConfig, type DistributedCascadeResult, type DistributionInfo } from './distributed-executor'

export { CachedCascadeGenerator, type CachedGeneratorConfig, type GenerateOptions, type CachedEntity, type CacheStats } from './cached-generator'
