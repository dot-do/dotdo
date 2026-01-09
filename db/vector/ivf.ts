/**
 * IVF Index - Inverted File Index with Centroids
 *
 * STUB FILE: Implementation pending. This file provides type definitions
 * and a placeholder class so tests can run and fail properly (TDD RED phase).
 *
 * IVF (Inverted File) is an approximate nearest neighbor algorithm that:
 * 1. Partitions vectors into clusters using k-means clustering
 * 2. Maintains inverted lists mapping centroid -> vector IDs
 * 3. At query time, probes only the nprobe nearest clusters
 *
 * @see tests/vector/ivf-index.test.ts for expected behavior
 * @module db/vector/ivf
 */

import type { Centroid, DistanceMetric, SearchResult } from '../../types/vector'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for IVF index
 */
export interface IVFConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Number of clusters (centroids) */
  nlist: number
  /** Number of clusters to probe during search (default: 1) */
  nprobe?: number
  /** Distance metric */
  metric?: DistanceMetric
  /** Whether to relocate empty clusters during training */
  relocateEmptyClusters?: boolean
}

/**
 * Options for k-means training
 */
export interface IVFTrainingOptions {
  /** Maximum iterations for k-means */
  maxIterations?: number
  /** Convergence threshold for k-means */
  convergenceThreshold?: number
  /** Initialization method */
  initialization?: 'random' | 'kmeans++'
  /** Random seed for reproducibility */
  randomSeed?: number
  /** Whether to perform incremental training */
  incremental?: boolean
}

/**
 * Result of training operation
 */
export interface TrainingResult {
  /** Whether training converged */
  converged: boolean
  /** Number of iterations performed */
  iterations: number
  /** Initial clustering error */
  initialError: number
  /** Final clustering error */
  finalError: number
  /** Warnings generated during training */
  warnings: string[]
}

/**
 * An inverted list for a single cluster
 */
export interface InvertedList {
  /** Vector IDs assigned to this cluster */
  vectorIds: string[]
}

/**
 * Assignment of a vector to a cluster
 */
export interface ClusterAssignment {
  /** ID of the centroid (cluster) */
  centroidId: number
  /** Distance to the centroid */
  distance: number
}

/**
 * Cluster balance statistics
 */
export interface ClusterBalance {
  /** Minimum cluster size */
  minSize: number
  /** Maximum cluster size */
  maxSize: number
  /** Mean cluster size */
  mean: number
  /** Standard deviation of cluster sizes */
  stdDev: number
  /** Number of empty clusters */
  emptyClusters: number
}

/**
 * Cluster size distribution entry
 */
export interface ClusterSizeEntry {
  /** Centroid ID */
  centroidId: number
  /** Number of vectors in this cluster */
  count: number
}

/**
 * Search options
 */
export interface IVFSearchOptions {
  /** Number of clusters to probe (overrides index default) */
  nprobe?: number
}

/**
 * Search statistics
 */
export interface SearchStats {
  /** Number of clusters probed */
  clustersProbed: number
  /** Number of vectors scanned */
  vectorsScanned: number
  /** Number of empty clusters encountered */
  emptyClustersPassed: number
  /** Search time in milliseconds */
  searchTimeMs: number
}

/**
 * Index statistics
 */
export interface IVFStats {
  /** Total number of vectors */
  vectorCount: number
  /** Vector dimensions */
  dimensions: number
  /** Number of clusters */
  nlist: number
  /** Default probe count */
  nprobe: number
  /** Distance metric */
  metric: DistanceMetric
  /** Whether index is trained */
  trained: boolean
  /** Approximate memory usage in bytes */
  memoryUsageBytes: number
  /** Average vectors per cluster */
  avgVectorsPerCluster: number
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  /** Number of searches performed */
  searchCount: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** 50th percentile latency */
  p50LatencyMs: number
  /** 99th percentile latency */
  p99LatencyMs: number
}

/**
 * Recall evaluation options
 */
export interface RecallEvalOptions {
  /** Number of results to retrieve */
  k: number
  /** nprobe values to test */
  nprobeValues: number[]
  /** Function to compute ground truth */
  groundTruthFn: (query: Float32Array, k: number) => SearchResult[]
}

/**
 * Recall metric for a single nprobe value
 */
export interface RecallMetric {
  /** nprobe value */
  nprobe: number
  /** Mean recall across queries */
  meanRecall: number
}

/**
 * Options for computing recalls
 */
export interface RecallComputeOptions {
  /** k values to compute recall at */
  kValues: number[]
  /** Function to compute ground truth */
  groundTruthFn: (query: Float32Array, k: number) => SearchResult[]
}

/**
 * JSON serialization format
 */
export interface IVFIndexJSON {
  config: Required<IVFConfig>
  centroids: Array<{ id: number; vector: number[]; count: number }>
  invertedLists: Array<{ centroidId: number; vectorIds: string[] }>
  vectorCount: number
  trained: boolean
}

// ============================================================================
// STUB IMPLEMENTATION (Tests should FAIL)
// ============================================================================

/**
 * IVF Index Implementation
 *
 * TODO: Implement this class to make tests pass
 */
export class IVFIndex {
  readonly config: Required<IVFConfig>

  constructor(config: IVFConfig) {
    // Validate configuration
    if (config.nlist < 1) {
      throw new Error('nlist must be positive')
    }
    if (config.nprobe !== undefined && config.nprobe < 1) {
      throw new Error('nprobe must be positive')
    }
    if (config.nprobe !== undefined && config.nprobe > config.nlist) {
      throw new Error('nprobe cannot exceed nlist')
    }

    this.config = {
      dimensions: config.dimensions,
      nlist: config.nlist,
      nprobe: config.nprobe ?? 1,
      metric: config.metric ?? 'cosine',
      relocateEmptyClusters: config.relocateEmptyClusters ?? false,
    }
  }

  // --------------------------------------------------------------------------
  // Vector Operations (STUB)
  // --------------------------------------------------------------------------

  async add(_id: string, _vector: Float32Array): Promise<void> {
    throw new Error('IVFIndex.add() not implemented')
  }

  async delete(_id: string): Promise<boolean> {
    throw new Error('IVFIndex.delete() not implemented')
  }

  async update(_id: string, _vector: Float32Array): Promise<void> {
    throw new Error('IVFIndex.update() not implemented')
  }

  async getVector(_id: string): Promise<Float32Array | null> {
    throw new Error('IVFIndex.getVector() not implemented')
  }

  size(): number {
    throw new Error('IVFIndex.size() not implemented')
  }

  // --------------------------------------------------------------------------
  // Training (STUB)
  // --------------------------------------------------------------------------

  async train(_options?: IVFTrainingOptions): Promise<TrainingResult> {
    throw new Error('IVFIndex.train() not implemented')
  }

  isTrained(): boolean {
    throw new Error('IVFIndex.isTrained() not implemented')
  }

  needsRetraining(): boolean {
    throw new Error('IVFIndex.needsRetraining() not implemented')
  }

  // --------------------------------------------------------------------------
  // Centroids and Clusters (STUB)
  // --------------------------------------------------------------------------

  getCentroids(): Centroid[] {
    throw new Error('IVFIndex.getCentroids() not implemented')
  }

  getInvertedLists(): Record<number, InvertedList> {
    throw new Error('IVFIndex.getInvertedLists() not implemented')
  }

  async getVectorAssignment(_id: string): Promise<ClusterAssignment | null> {
    throw new Error('IVFIndex.getVectorAssignment() not implemented')
  }

  getClusterBalance(): ClusterBalance {
    throw new Error('IVFIndex.getClusterBalance() not implemented')
  }

  getClusterSizeDistribution(): ClusterSizeEntry[] {
    throw new Error('IVFIndex.getClusterSizeDistribution() not implemented')
  }

  // --------------------------------------------------------------------------
  // Search (STUB)
  // --------------------------------------------------------------------------

  async search(
    _query: Float32Array,
    _k: number,
    _options?: IVFSearchOptions
  ): Promise<SearchResult[]> {
    throw new Error('IVFIndex.search() not implemented')
  }

  async searchWithStats(
    _query: Float32Array,
    _k: number,
    _options?: IVFSearchOptions
  ): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    throw new Error('IVFIndex.searchWithStats() not implemented')
  }

  // --------------------------------------------------------------------------
  // Statistics (STUB)
  // --------------------------------------------------------------------------

  getStats(): IVFStats {
    throw new Error('IVFIndex.getStats() not implemented')
  }

  getLatencyStats(): LatencyStats {
    throw new Error('IVFIndex.getLatencyStats() not implemented')
  }

  // --------------------------------------------------------------------------
  // Recall Evaluation (STUB)
  // --------------------------------------------------------------------------

  async evaluateRecall(
    _queries: Float32Array[],
    _options: RecallEvalOptions
  ): Promise<RecallMetric[]> {
    throw new Error('IVFIndex.evaluateRecall() not implemented')
  }

  async computeRecalls(
    _query: Float32Array,
    _options: RecallComputeOptions
  ): Promise<Record<string, number>> {
    throw new Error('IVFIndex.computeRecalls() not implemented')
  }

  // --------------------------------------------------------------------------
  // Serialization (STUB)
  // --------------------------------------------------------------------------

  async serialize(): Promise<ArrayBuffer> {
    throw new Error('IVFIndex.serialize() not implemented')
  }

  static async deserialize(_buffer: ArrayBuffer): Promise<IVFIndex> {
    throw new Error('IVFIndex.deserialize() not implemented')
  }

  async toJSON(): Promise<IVFIndexJSON> {
    throw new Error('IVFIndex.toJSON() not implemented')
  }

  static async fromJSON(_json: IVFIndexJSON): Promise<IVFIndex> {
    throw new Error('IVFIndex.fromJSON() not implemented')
  }
}
