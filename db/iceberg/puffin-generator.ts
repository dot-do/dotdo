/**
 * Puffin Index Generator
 *
 * Scans Parquet files and generates Puffin sidecar indexes with bloom filters.
 * Can run as a Worker or as a build-time script.
 *
 * @example
 * ```typescript
 * import { generatePuffinFromParquet } from 'dotdo/db/iceberg/puffin-generator'
 *
 * // Generate Puffin index for a Parquet file
 * const puffinBytes = await generatePuffinFromParquet({
 *   parquetData: await r2.get('data.parquet'),
 *   columns: ['email', 'user_id', 'status'],
 *   snapshotId: 1,
 * })
 *
 * await r2.put('data.puffin', puffinBytes)
 * ```
 */

import { readParquet } from 'parquet-wasm'
import { tableFromIPC } from 'apache-arrow'
import {
  PuffinWriter,
  createBloomFilterFromValues,
  createNgramBloomFromValues,
  createSetIndexFromValues,
} from './puffin'

// ============================================================================
// Types
// ============================================================================

export interface PuffinGeneratorOptions {
  /** Parquet file data as ArrayBuffer or Uint8Array */
  parquetData: ArrayBuffer | Uint8Array

  /** Columns to index (field names) */
  columns: string[]

  /** Snapshot ID for versioning */
  snapshotId?: number

  /** Sequence number for ordering */
  sequenceNumber?: number

  /** Index types to generate per column */
  indexTypes?: {
    /** Columns that should use bloom filter (default: all) */
    bloom?: string[]
    /** Columns that should use n-gram bloom (for LIKE queries) */
    ngram?: string[]
    /** Columns that should use set index (low cardinality) */
    set?: string[]
  }

  /** False positive rate for bloom filters (default: 0.01) */
  fpr?: number

  /** N-gram size for substring indexes (default: 3) */
  ngramSize?: number

  /** Max unique values for set index (default: 1000) */
  maxSetSize?: number
}

export interface PuffinGeneratorResult {
  /** The generated Puffin file as bytes */
  puffinBytes: Uint8Array

  /** Statistics about the generated index */
  stats: {
    /** Number of rows scanned */
    rowCount: number
    /** Number of columns indexed */
    columnCount: number
    /** Number of bloom filters created */
    bloomCount: number
    /** Number of ngram filters created */
    ngramCount: number
    /** Number of set indexes created */
    setCount: number
    /** Total size of Puffin file in bytes */
    totalBytes: number
    /** Per-column statistics */
    columns: Record<
      string,
      {
        uniqueValues: number
        indexType: 'bloom' | 'ngram' | 'set'
        sizeBytes: number
      }
    >
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract unique string values from an Arrow column
 */
function extractColumnValues(column: unknown): string[] {
  const values = new Set<string>()

  // Handle different Arrow column types
  const col = column as { length: number; get: (i: number) => unknown; toArray?: () => unknown[] }

  if (col.toArray) {
    // Fast path: use toArray if available
    for (const val of col.toArray()) {
      if (val !== null && val !== undefined) {
        values.add(String(val))
      }
    }
  } else {
    // Fallback: iterate with get()
    for (let i = 0; i < col.length; i++) {
      const val = col.get(i)
      if (val !== null && val !== undefined) {
        values.add(String(val))
      }
    }
  }

  return Array.from(values)
}

/**
 * Determine the best index type for a column based on cardinality
 */
function selectIndexType(
  columnName: string,
  uniqueCount: number,
  options: PuffinGeneratorOptions
): 'bloom' | 'ngram' | 'set' {
  const { indexTypes, maxSetSize = 1000 } = options

  // Check explicit type assignments
  if (indexTypes?.ngram?.includes(columnName)) return 'ngram'
  if (indexTypes?.set?.includes(columnName)) return 'set'
  if (indexTypes?.bloom?.includes(columnName)) return 'bloom'

  // Auto-select based on cardinality
  if (uniqueCount <= maxSetSize) {
    return 'set' // Low cardinality: use exact set
  }

  return 'bloom' // High cardinality: use bloom filter
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a Puffin index file from a Parquet file
 */
export async function generatePuffinFromParquet(
  options: PuffinGeneratorOptions
): Promise<PuffinGeneratorResult> {
  const {
    parquetData,
    columns,
    snapshotId = 1,
    sequenceNumber = 1,
    fpr = 0.01,
    ngramSize = 3,
  } = options

  // Read Parquet file
  const parquetBytes =
    parquetData instanceof ArrayBuffer ? new Uint8Array(parquetData) : parquetData

  // Use parquet-wasm to read the file
  const arrowIPC = readParquet(parquetBytes)
  const table = tableFromIPC(arrowIPC)

  // Initialize Puffin writer
  const writer = new PuffinWriter({ snapshotId, sequenceNumber })

  // Track statistics
  const stats: PuffinGeneratorResult['stats'] = {
    rowCount: table.numRows,
    columnCount: 0,
    bloomCount: 0,
    ngramCount: 0,
    setCount: 0,
    totalBytes: 0,
    columns: {},
  }

  // Process each requested column
  for (const columnName of columns) {
    const column = table.getChild(columnName)
    if (!column) {
      console.warn(`Column "${columnName}" not found in Parquet file`)
      continue
    }

    // Extract unique values
    const values = extractColumnValues(column)
    const uniqueCount = values.length

    // Determine index type
    const indexType = selectIndexType(columnName, uniqueCount, options)

    // Get field ID (use column index as field ID)
    const fieldId = table.schema.fields.findIndex((f) => f.name === columnName)
    if (fieldId === -1) continue

    // Create the appropriate index
    let sizeBytes = 0

    switch (indexType) {
      case 'bloom': {
        const filter = createBloomFilterFromValues(values, fpr)
        const serialized = filter.serialize()
        sizeBytes = serialized.length
        writer.addBloomFilter(fieldId, filter)
        stats.bloomCount++
        break
      }

      case 'ngram': {
        const filter = createNgramBloomFromValues(values, ngramSize, fpr)
        const serialized = filter.serialize()
        sizeBytes = serialized.length
        writer.addNgramBloomFilter(fieldId, filter)
        stats.ngramCount++
        break
      }

      case 'set': {
        const index = createSetIndexFromValues(values)
        const serialized = index.serialize()
        sizeBytes = serialized.length
        writer.addSetIndex(fieldId, index)
        stats.setCount++
        break
      }
    }

    stats.columns[columnName] = {
      uniqueValues: uniqueCount,
      indexType,
      sizeBytes,
    }
    stats.columnCount++
  }

  // Finalize Puffin file
  const puffinBytes = writer.finish()
  stats.totalBytes = puffinBytes.length

  return { puffinBytes, stats }
}

/**
 * Generate Puffin index from R2 object
 * Convenience wrapper for use in Workers
 */
export async function generatePuffinFromR2(
  r2: R2Bucket,
  parquetKey: string,
  options: Omit<PuffinGeneratorOptions, 'parquetData'>
): Promise<PuffinGeneratorResult & { puffinKey: string }> {
  // Fetch Parquet from R2
  const parquetObject = await r2.get(parquetKey)
  if (!parquetObject) {
    throw new Error(`Parquet file not found: ${parquetKey}`)
  }

  const parquetData = await parquetObject.arrayBuffer()

  // Generate Puffin index
  const result = await generatePuffinFromParquet({
    ...options,
    parquetData,
  })

  // Determine Puffin key (same path, different extension)
  const puffinKey = parquetKey.replace(/\.parquet$/, '.puffin')

  // Upload Puffin to R2
  await r2.put(puffinKey, result.puffinBytes, {
    httpMetadata: {
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000', // Cache for 1 year
    },
  })

  return { ...result, puffinKey }
}

// ============================================================================
// CLI / Script Entry Point
// ============================================================================

/**
 * Generate Puffin indexes for all Parquet files in an R2 prefix
 */
export async function generatePuffinForPrefix(
  r2: R2Bucket,
  prefix: string,
  options: Omit<PuffinGeneratorOptions, 'parquetData'>
): Promise<{ generated: string[]; errors: Array<{ key: string; error: string }> }> {
  const generated: string[] = []
  const errors: Array<{ key: string; error: string }> = []

  // List all Parquet files
  let cursor: string | undefined
  do {
    const list = await r2.list({ prefix, cursor })

    for (const obj of list.objects) {
      if (!obj.key.endsWith('.parquet')) continue

      // Check if Puffin already exists
      const puffinKey = obj.key.replace(/\.parquet$/, '.puffin')
      const existingPuffin = await r2.head(puffinKey)
      if (existingPuffin) {
        // Skip if Puffin is newer than Parquet
        if (existingPuffin.uploaded > obj.uploaded) continue
      }

      try {
        await generatePuffinFromR2(r2, obj.key, options)
        generated.push(puffinKey)
      } catch (e) {
        errors.push({
          key: obj.key,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)

  return { generated, errors }
}
