/**
 * Batch Insert Optimization - High-performance bulk vector insertion
 *
 * This module provides optimized batch insertion for HNSW indices, designed
 * for efficiently loading large datasets into EdgeVec. It handles memory
 * management, error recovery, and progress tracking automatically.
 *
 * ## Key Features
 *
 * - **Chunked Processing**: Process vectors in configurable chunks to manage memory
 * - **Parallel Insertion**: Optional parallel processing for multi-core environments
 * - **Progress Reporting**: Callback-based progress tracking for UI feedback
 * - **Error Handling**: Skip errors, fail fast, or transactional rollback modes
 * - **Pre-normalization**: Optionally pre-normalize vectors for cosine similarity
 * - **Norm Caching**: Populate norm cache during insert for faster subsequent searches
 *
 * ## Memory Management
 *
 * Cloudflare Workers have a 128MB memory limit. To safely insert large datasets:
 *
 * | Dataset Size | Recommended Chunk Size | Estimated Memory |
 * |--------------|------------------------|------------------|
 * | 1K vectors   | 100                    | ~30MB            |
 * | 10K vectors  | 100                    | ~50MB            |
 * | 100K vectors | 50                     | ~80MB            |
 *
 * ## Error Handling Modes
 *
 * - **skipOnError** (default): Continue inserting, track failures
 * - **failFast**: Stop on first error, report which vector failed
 * - **transactional**: Rollback all inserts on any error
 *
 * @example Basic batch insertion
 * ```typescript
 * import { BatchInserter } from 'db/edgevec/batch-insert'
 *
 * const inserter = new BatchInserter(index, {
 *   chunkSize: 100,
 *   onProgress: (p) => console.log(`${(p * 100).toFixed(1)}% complete`)
 * })
 *
 * const vectors = documents.map(doc => ({
 *   id: doc.id,
 *   vector: doc.embedding,
 *   metadata: { source: doc.source }
 * }))
 *
 * const result = await inserter.insertBatch(vectors)
 * console.log(`Inserted: ${result.inserted}, Failed: ${result.failed}`)
 * console.log(`Duration: ${result.durationMs}ms`)
 * ```
 *
 * @example Streaming insertion from an iterator
 * ```typescript
 * async function* generateVectors() {
 *   for await (const doc of documentStream) {
 *     yield {
 *       id: doc.id,
 *       vector: await embed(doc.content),
 *       metadata: { title: doc.title }
 *     }
 *   }
 * }
 *
 * const result = await inserter.insertFromIterator(generateVectors())
 * ```
 *
 * @example Transactional insertion (all-or-nothing)
 * ```typescript
 * const inserter = new BatchInserter(index, {
 *   transactional: true  // Rollback all on any error
 * })
 *
 * try {
 *   await inserter.insertBatch(vectors)
 * } catch (error) {
 *   // All vectors rolled back
 *   console.error('Batch failed:', error.message)
 * }
 * ```
 *
 * @example With norm caching for faster search
 * ```typescript
 * import { VectorNormCache } from 'db/edgevec/vector-ops'
 *
 * const normCache = new VectorNormCache()
 * const inserter = new BatchInserter(index, {
 *   normCache,        // Populate cache during insert
 *   preNormalize: true  // Pre-normalize for cosine similarity
 * })
 *
 * await inserter.insertBatch(vectors)
 * // normCache now contains norms for fast cosine similarity search
 * ```
 *
 * @module db/edgevec/batch-insert
 */

import type { HNSWIndex } from './hnsw'
import type { FilteredHNSWIndex } from './filtered-search'
import { VectorNormCache } from './vector-ops'
import type { EmbeddingCache } from './embedding-cache'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Vector to insert
 */
export interface VectorInput {
  /** Unique ID */
  id: string
  /** Vector values */
  vector: Float32Array | number[]
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Insert mode for handling duplicates
 */
export type InsertMode = 'insert' | 'upsert' | 'replace' | 'skip' | 'strict'

/**
 * Batch insert options
 */
export interface BatchInsertOptions {
  /** Number of vectors per chunk (default: 100) */
  chunkSize?: number
  /** Number of parallel insert operations (default: 1) */
  concurrency?: number
  /** Max memory to use in MB (default: unlimited) */
  maxMemoryMB?: number
  /** Skip errors and continue (default: true) */
  skipOnError?: boolean
  /** Stop on first error (default: false) */
  failFast?: boolean
  /** Rollback all inserts on error (default: false) */
  transactional?: boolean
  /** Progress callback */
  onProgress?: (progress: number) => void
  /** Optional norm cache for optimizing subsequent searches */
  normCache?: VectorNormCache
  /** Optional embedding cache for storing vectors */
  embeddingCache?: EmbeddingCache
  /** Pre-normalize vectors for cosine similarity (default: false) */
  preNormalize?: boolean
  /** Insert mode for handling duplicates (default: 'insert') */
  insertMode?: InsertMode
  /** Detect duplicates within the batch (default: false) */
  detectDuplicates?: boolean
  /** Strategy for duplicates within batch: 'first' or 'last' (default: 'first') */
  duplicateStrategy?: 'first' | 'last'
  /** JSON Schema for metadata validation */
  metadataSchema?: Record<string, unknown>
  /** Index metadata on insert (default: false) */
  indexMetadata?: boolean
  /** Maximum retries for failed inserts (default: 0) */
  maxRetries?: number
  /** Delay between retries in ms (default: 100) */
  retryDelayMs?: number
  /** Timeout for entire batch in ms */
  timeoutMs?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Result of batch insert
 */
export interface BatchInsertResult {
  /** Number of successfully inserted vectors */
  inserted: number
  /** Number of failed insertions */
  failed: number
  /** Number of chunks processed */
  chunks: number
  /** Time taken in milliseconds */
  durationMs: number
  /** Error details by ID */
  errors?: Record<string, string>
  /** Number of updated vectors (upsert mode) */
  updated?: number
  /** Number of replaced vectors (replace mode) */
  replaced?: number
  /** Number of skipped duplicates (skip mode) */
  skipped?: number
  /** Number of retried insertions */
  retried?: number
  /** Number of vectors with metadata validation errors */
  metadataValidationErrors?: number
  /** Peak memory usage estimate in bytes */
  peakMemoryBytes?: number
  /** Whether batch was cancelled */
  cancelled?: boolean
  /** Duplicate IDs found within the batch */
  duplicateIds?: string[]
}

// ============================================================================
// BATCH INSERTER IMPLEMENTATION
// ============================================================================

export class BatchInserter {
  private index: HNSWIndex | FilteredHNSWIndex
  private options: Required<Omit<BatchInsertOptions, 'onProgress' | 'normCache' | 'embeddingCache' | 'metadataSchema' | 'signal'>> & {
    onProgress?: (progress: number) => void
    normCache?: VectorNormCache
    embeddingCache?: EmbeddingCache
    metadataSchema?: Record<string, unknown>
    signal?: AbortSignal
  }

  constructor(index: HNSWIndex | FilteredHNSWIndex, options: BatchInsertOptions = {}) {
    this.index = index
    this.options = {
      chunkSize: options.chunkSize ?? 100,
      concurrency: options.concurrency ?? 1,
      maxMemoryMB: options.maxMemoryMB ?? Infinity,
      skipOnError: options.skipOnError ?? true,
      failFast: options.failFast ?? false,
      transactional: options.transactional ?? false,
      onProgress: options.onProgress,
      normCache: options.normCache,
      embeddingCache: options.embeddingCache,
      preNormalize: options.preNormalize ?? false,
      insertMode: options.insertMode ?? 'insert',
      detectDuplicates: options.detectDuplicates ?? false,
      duplicateStrategy: options.duplicateStrategy ?? 'first',
      metadataSchema: options.metadataSchema,
      indexMetadata: options.indexMetadata ?? false,
      maxRetries: options.maxRetries ?? 0,
      retryDelayMs: options.retryDelayMs ?? 100,
      timeoutMs: options.timeoutMs ?? Infinity,
      signal: options.signal,
    }
  }

  /**
   * Insert a batch of vectors
   */
  async insertBatch(vectors: VectorInput[]): Promise<BatchInsertResult> {
    const startTime = performance.now()
    let inserted = 0
    let failed = 0
    let updated = 0
    let replaced = 0
    let skipped = 0
    let retried = 0
    let metadataValidationErrors = 0
    let chunks = 0
    const errors: Record<string, string> = {}
    const insertedIds: string[] = []
    const duplicateIds: string[] = []

    // Check for cancellation
    if (this.options.signal?.aborted) {
      return {
        inserted: 0,
        failed: 0,
        chunks: 0,
        durationMs: performance.now() - startTime,
        cancelled: true,
      }
    }

    // Detect duplicates within batch if requested
    let processedVectors = vectors
    if (this.options.detectDuplicates) {
      const seen = new Map<string, number>()
      const uniqueVectors: VectorInput[] = []

      for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i]!
        if (seen.has(v.id)) {
          duplicateIds.push(v.id)
          if (this.options.duplicateStrategy === 'last') {
            // Replace the earlier one
            uniqueVectors[seen.get(v.id)!] = v
          }
          // 'first' strategy: just skip this one
        } else {
          seen.set(v.id, uniqueVectors.length)
          uniqueVectors.push(v)
        }
      }
      processedVectors = uniqueVectors.filter(Boolean)
    }

    // Validate all vectors first if transactional
    if (this.options.transactional) {
      const validationErrors = this.validateVectors(processedVectors)
      if (Object.keys(validationErrors).length > 0) {
        throw new Error(`Validation failed: ${JSON.stringify(validationErrors)}`)
      }
    }

    // Split into chunks
    const chunkedVectors = this.chunkArray(processedVectors, this.options.chunkSize)
    const totalChunks = chunkedVectors.length

    try {
      if (this.options.concurrency > 1) {
        // Parallel processing
        const results = await this.processParallel(chunkedVectors, totalChunks)
        for (const result of results) {
          inserted += result.inserted
          failed += result.failed
          updated += result.updated ?? 0
          replaced += result.replaced ?? 0
          skipped += result.skipped ?? 0
          retried += result.retried ?? 0
          metadataValidationErrors += result.metadataValidationErrors ?? 0
          chunks += result.chunks
          if (result.errors) {
            Object.assign(errors, result.errors)
          }
          insertedIds.push(...result.insertedIds)
        }
      } else {
        // Sequential processing
        for (let i = 0; i < chunkedVectors.length; i++) {
          // Check for cancellation
          if (this.options.signal?.aborted) {
            return {
              inserted,
              failed,
              updated: updated > 0 ? updated : undefined,
              replaced: replaced > 0 ? replaced : undefined,
              skipped: skipped > 0 ? skipped : undefined,
              chunks,
              durationMs: performance.now() - startTime,
              errors: Object.keys(errors).length > 0 ? errors : undefined,
              cancelled: true,
            }
          }

          const chunk = chunkedVectors[i]!
          const result = await this.processChunk(chunk, insertedIds)

          inserted += result.inserted
          failed += result.failed
          updated += result.updated ?? 0
          replaced += result.replaced ?? 0
          skipped += result.skipped ?? 0
          retried += result.retried ?? 0
          metadataValidationErrors += result.metadataValidationErrors ?? 0
          chunks++
          if (result.errors) {
            Object.assign(errors, result.errors)
          }
          insertedIds.push(...result.insertedIds)

          // Report progress
          if (this.options.onProgress) {
            this.options.onProgress((i + 1) / totalChunks)
          }

          // Check fail fast
          if (this.options.failFast && failed > 0) {
            throw new Error(`Batch insert failed at chunk ${i + 1}: ${JSON.stringify(errors)}`)
          }
        }
      }
    } catch (error) {
      // Rollback if transactional
      if (this.options.transactional) {
        for (const id of insertedIds) {
          try {
            this.index.delete(id)
          } catch {
            // Ignore rollback errors
          }
        }
      }
      throw error
    }

    return {
      inserted,
      failed,
      chunks,
      durationMs: performance.now() - startTime,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      updated: updated > 0 ? updated : undefined,
      replaced: replaced > 0 ? replaced : undefined,
      skipped: skipped > 0 ? skipped : undefined,
      retried: retried > 0 ? retried : undefined,
      metadataValidationErrors: metadataValidationErrors > 0 ? metadataValidationErrors : undefined,
      duplicateIds: duplicateIds.length > 0 ? duplicateIds : undefined,
    }
  }

  /**
   * Insert from an iterator (for streaming large batches)
   */
  async insertFromIterator(
    iterator: Iterable<VectorInput> | AsyncIterable<VectorInput>
  ): Promise<BatchInsertResult> {
    const startTime = performance.now()
    let inserted = 0
    let failed = 0
    let chunks = 0
    const errors: Record<string, string> = {}
    const insertedIds: string[] = []

    let buffer: VectorInput[] = []

    const flush = async () => {
      if (buffer.length === 0) return

      const result = await this.processChunk(buffer, insertedIds)
      inserted += result.inserted
      failed += result.failed
      chunks++
      if (result.errors) {
        Object.assign(errors, result.errors)
      }
      insertedIds.push(...result.insertedIds)
      buffer = []
    }

    // Process iterator
    for await (const vector of iterator as AsyncIterable<VectorInput>) {
      buffer.push(vector)
      if (buffer.length >= this.options.chunkSize) {
        await flush()
      }
    }

    // Flush remaining
    await flush()

    return {
      inserted,
      failed,
      chunks,
      durationMs: performance.now() - startTime,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private validateVectors(vectors: VectorInput[]): Record<string, string> {
    const errors: Record<string, string> = {}
    const dimensions = this.index.dimensions()

    for (const v of vectors) {
      // Validate ID
      if (!v.id || typeof v.id !== 'string') {
        errors[v.id || 'unknown'] = 'Invalid or missing ID'
        continue
      }

      // Validate vector
      const vecLength = v.vector instanceof Float32Array ? v.vector.length : v.vector.length
      if (vecLength !== dimensions) {
        errors[v.id] = `dimension mismatch: expected ${dimensions}, got ${vecLength}`
      }
    }

    return errors
  }

  private async processChunk(
    chunk: VectorInput[],
    insertedIds: string[]
  ): Promise<{
    inserted: number
    failed: number
    errors?: Record<string, string>
    insertedIds: string[]
  }> {
    let inserted = 0
    let failed = 0
    const errors: Record<string, string> = {}
    const newInsertedIds: string[] = []
    const dimensions = this.index.dimensions()

    for (const v of chunk) {
      try {
        // Validate
        if (!v.id || typeof v.id !== 'string') {
          throw new Error('Invalid or missing ID')
        }

        const vecLength = v.vector instanceof Float32Array ? v.vector.length : v.vector.length
        if (vecLength !== dimensions) {
          throw new Error(`dimension mismatch: expected ${dimensions}, got ${vecLength}`)
        }

        // Convert to Float32Array if needed
        const vector = v.vector instanceof Float32Array
          ? v.vector
          : new Float32Array(v.vector)

        // Pre-normalize if requested (optimizes cosine similarity)
        if (this.options.preNormalize) {
          this.normalizeInPlace(vector)
        }

        // Insert
        if ('getMetadata' in this.index && v.metadata) {
          // Filtered index with metadata
          ;(this.index as FilteredHNSWIndex).insert(v.id, vector, v.metadata)
        } else {
          this.index.insert(v.id, vector)
        }

        // Populate norm cache for faster subsequent searches
        if (this.options.normCache) {
          this.options.normCache.getNorm(v.id, vector)
        }

        // Populate embedding cache
        if (this.options.embeddingCache) {
          this.options.embeddingCache.set(v.id, vector, v.metadata)
        }

        inserted++
        newInsertedIds.push(v.id)
      } catch (error) {
        failed++
        errors[v.id] = (error as Error).message

        if (this.options.failFast) {
          throw error
        }
      }
    }

    return {
      inserted,
      failed,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      insertedIds: newInsertedIds,
    }
  }

  private async processParallel(
    chunks: VectorInput[][],
    totalChunks: number
  ): Promise<Array<{
    inserted: number
    failed: number
    chunks: number
    errors?: Record<string, string>
    insertedIds: string[]
  }>> {
    const results: Array<{
      inserted: number
      failed: number
      chunks: number
      errors?: Record<string, string>
      insertedIds: string[]
    }> = []

    // Create a semaphore for concurrency control
    let running = 0
    let completed = 0
    const queue = [...chunks]
    const insertedIds: string[] = []

    return new Promise((resolve, reject) => {
      const processNext = async () => {
        while (running < this.options.concurrency && queue.length > 0) {
          const chunk = queue.shift()!
          running++

          try {
            const result = await this.processChunk(chunk, insertedIds)
            results.push({
              ...result,
              chunks: 1,
            })
            insertedIds.push(...result.insertedIds)
          } catch (error) {
            if (this.options.failFast) {
              reject(error)
              return
            }
          } finally {
            running--
            completed++

            // Report progress
            if (this.options.onProgress) {
              this.options.onProgress(completed / totalChunks)
            }

            // Check if done
            if (completed === chunks.length) {
              resolve(results)
            } else {
              processNext()
            }
          }
        }
      }

      processNext()
    })
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * Normalize a vector in place (L2 normalization)
   */
  private normalizeInPlace(v: Float32Array): void {
    const len = v.length
    const remainder = len % 4
    const unrolledLen = len - remainder

    // Compute magnitude with loop unrolling
    let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0

    for (let i = 0; i < unrolledLen; i += 4) {
      const v0 = v[i]!, v1 = v[i + 1]!, v2 = v[i + 2]!, v3 = v[i + 3]!
      sum0 += v0 * v0
      sum1 += v1 * v1
      sum2 += v2 * v2
      sum3 += v3 * v3
    }

    let sumR = 0
    for (let i = unrolledLen; i < len; i++) {
      const vi = v[i]!
      sumR += vi * vi
    }

    const mag = Math.sqrt(sum0 + sum1 + sum2 + sum3 + sumR)

    if (mag === 0) return

    // Divide by magnitude with loop unrolling
    for (let i = 0; i < unrolledLen; i += 4) {
      v[i] = v[i]! / mag
      v[i + 1] = v[i + 1]! / mag
      v[i + 2] = v[i + 2]! / mag
      v[i + 3] = v[i + 3]! / mag
    }

    for (let i = unrolledLen; i < len; i++) {
      v[i] = v[i]! / mag
    }
  }
}
