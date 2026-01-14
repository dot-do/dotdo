/**
 * Batched Prerendering for Large Documentation Sites
 *
 * This module provides utilities for memory-efficient static prerendering of
 * large documentation sites (200+ pages). Instead of loading all MDX content
 * into memory at once, it:
 *
 * 1. Batches pages by collection to limit concurrent memory usage
 * 2. Releases memory between batches via explicit GC hints
 * 3. Tracks progress for debugging and resumable builds
 *
 * @see https://github.com/fuma-nama/fumadocs/issues/1287
 */

import type { CollectionName } from './source'

/**
 * Configuration for batched prerendering
 */
export interface BatchConfig {
  /** Maximum pages to prerender per batch (default: 20) */
  batchSize: number
  /** Delay between batches in ms to allow GC (default: 100) */
  batchDelay: number
  /** Whether to run GC hints between batches (default: true) */
  gcBetweenBatches: boolean
  /** Enable verbose logging (default: false) */
  verbose: boolean
}

const defaultConfig: BatchConfig = {
  batchSize: 20,
  batchDelay: 100,
  gcBetweenBatches: true,
  verbose: process.env.DEBUG_PRERENDER === 'true',
}

/**
 * Collection priority order for prerendering
 * High-traffic collections are rendered first for faster incremental builds
 */
export const collectionPriority: CollectionName[] = [
  // Most visited - render first
  'gettingStarted',
  'concepts',
  'api',
  // Developer experience
  'sdk',
  'rpc',
  'cli',
  // Core features
  'objects',
  'workflows',
  'functions',
  'events',
  'actions',
  // AI & Humans
  'agents',
  'humans',
  // Infrastructure
  'architecture',
  'database',
  'storage',
  'transport',
  'primitives',
  // Integrations
  'integrations',
  'compat',
  'mcp',
  // Platform
  'platform',
  'deployment',
  'observability',
  'security',
  // UI & Library
  'ui',
  'lib',
  // Guides & Roadmap
  'guides',
  'roadmap',
]

/**
 * Estimate memory usage for a collection based on page count
 * Returns estimated MB of heap usage
 */
export function estimateCollectionMemory(pageCount: number): number {
  // Each MDX page compiled to React components uses ~100-500KB
  // Conservative estimate: 300KB per page
  return pageCount * 0.3
}

/**
 * Chunk an array into batches of specified size
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Create a batched page iterator for memory-efficient prerendering
 *
 * @param pages - Array of pages to prerender
 * @param config - Batch configuration
 * @returns AsyncGenerator yielding page batches
 */
export async function* batchedPages<T>(
  pages: T[],
  config: Partial<BatchConfig> = {}
): AsyncGenerator<T[], void, unknown> {
  const cfg = { ...defaultConfig, ...config }
  const batches = chunk(pages, cfg.batchSize)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]

    if (cfg.verbose) {
      console.log(`[prerender] Processing batch ${i + 1}/${batches.length} (${batch.length} pages)`)
    }

    yield batch

    // Allow GC between batches
    if (cfg.gcBetweenBatches && i < batches.length - 1) {
      // Hint to V8 that we're done with the previous batch
      if (global.gc) {
        global.gc()
      }
      // Small delay to allow async cleanup
      if (cfg.batchDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, cfg.batchDelay))
      }
    }
  }
}

/**
 * Progress tracking for prerender builds
 */
export interface PrerenderProgress {
  total: number
  completed: number
  failed: number
  skipped: number
  collections: Map<CollectionName, { total: number; completed: number }>
}

/**
 * Create a progress tracker for prerendering
 */
export function createProgressTracker(totalPages: number): PrerenderProgress {
  return {
    total: totalPages,
    completed: 0,
    failed: 0,
    skipped: 0,
    collections: new Map(),
  }
}

/**
 * Log progress in a memory-efficient format
 */
export function logProgress(progress: PrerenderProgress): void {
  const pct = Math.round((progress.completed / progress.total) * 100)
  console.log(
    `[prerender] Progress: ${progress.completed}/${progress.total} (${pct}%) | ` +
      `Failed: ${progress.failed} | Skipped: ${progress.skipped}`
  )
}

/**
 * Memory usage report for debugging
 */
export function getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number } {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const { heapUsed, heapTotal, external } = process.memoryUsage()
    return {
      heapUsed: Math.round(heapUsed / 1024 / 1024),
      heapTotal: Math.round(heapTotal / 1024 / 1024),
      external: Math.round(external / 1024 / 1024),
    }
  }
  return { heapUsed: 0, heapTotal: 0, external: 0 }
}

/**
 * Log memory usage for debugging builds
 */
export function logMemoryUsage(label: string): void {
  const { heapUsed, heapTotal, external } = getMemoryUsage()
  console.log(`[prerender] ${label} - Heap: ${heapUsed}MB/${heapTotal}MB, External: ${external}MB`)
}

/**
 * Environment configuration for prerendering
 */
export function getPrerenderEnvConfig(): Partial<BatchConfig> {
  return {
    batchSize: parseInt(process.env.PRERENDER_BATCH_SIZE || '20', 10),
    batchDelay: parseInt(process.env.PRERENDER_BATCH_DELAY || '100', 10),
    gcBetweenBatches: process.env.PRERENDER_GC !== 'false',
    verbose: process.env.DEBUG_PRERENDER === 'true',
  }
}
