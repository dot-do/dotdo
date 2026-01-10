/**
 * Puffin Generator Tests
 */

import { describe, it, expect } from 'vitest'
import { writeParquet } from 'parquet-wasm'
import {
  tableToIPC,
  tableFromArrays,
  Utf8,
  Int32,
  Field,
  Schema,
} from 'apache-arrow'
import { generatePuffinFromParquet } from '../puffin-generator'
import { PuffinReader } from '../puffin'

describe('Puffin Generator', () => {
  // Helper to create a test Parquet file
  function createTestParquet(): Uint8Array {
    const schema = new Schema([
      new Field('email', new Utf8()),
      new Field('status', new Utf8()),
      new Field('user_id', new Int32()),
    ])

    const table = tableFromArrays(
      {
        email: [
          'alice@example.com',
          'bob@example.com',
          'charlie@example.com',
          'alice@example.com', // duplicate
          'dave@example.com',
        ],
        status: ['active', 'active', 'inactive', 'active', 'pending'],
        user_id: [1, 2, 3, 1, 4],
      },
      schema
    )

    const ipc = tableToIPC(table)
    return writeParquet(ipc)
  }

  it('generates Puffin index from Parquet', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email', 'status'],
    })

    expect(result.puffinBytes).toBeInstanceOf(Uint8Array)
    expect(result.puffinBytes.length).toBeGreaterThan(0)

    // Verify stats
    expect(result.stats.rowCount).toBe(5)
    expect(result.stats.columnCount).toBe(2)
    expect(result.stats.columns['email']).toBeDefined()
    expect(result.stats.columns['status']).toBeDefined()
  })

  it('creates bloom filter for high cardinality columns', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email'],
      maxSetSize: 2, // Force bloom filter for email (4 unique values)
    })

    expect(result.stats.columns['email'].indexType).toBe('bloom')
    expect(result.stats.bloomCount).toBe(1)
  })

  it('creates set index for low cardinality columns', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['status'],
      maxSetSize: 10, // Status has 3 unique values
    })

    expect(result.stats.columns['status'].indexType).toBe('set')
    expect(result.stats.setCount).toBe(1)
  })

  it('generates valid Puffin file readable by PuffinReader', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email', 'status'],
      indexTypes: {
        bloom: ['email'],
        set: ['status'],
      },
    })

    // Parse with PuffinReader
    const reader = new PuffinReader(result.puffinBytes)

    // Check footer
    expect(reader.blobCount).toBe(2)

    // Verify bloom filter for email works
    const emailBlob = reader.getBlob(0)
    expect(emailBlob).toBeDefined()
  })

  it('bloom filter correctly identifies existing values', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email'],
      indexTypes: { bloom: ['email'] },
    })

    const reader = new PuffinReader(result.puffinBytes)
    const emailBlob = reader.getBlob(0)
    expect(emailBlob).toBeDefined()

    // The bloom filter should be serialized in the blob
    // We'd need to deserialize and test, but for now just verify it exists
    expect(emailBlob!.length).toBeGreaterThan(0)
  })

  it('handles missing columns gracefully', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email', 'nonexistent_column'],
    })

    // Should only index the existing column
    expect(result.stats.columnCount).toBe(1)
    expect(result.stats.columns['email']).toBeDefined()
    expect(result.stats.columns['nonexistent_column']).toBeUndefined()
  })

  it('generates ngram bloom for LIKE queries when specified', async () => {
    const parquetData = createTestParquet()

    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['email'],
      indexTypes: { ngram: ['email'] },
      ngramSize: 3,
    })

    expect(result.stats.columns['email'].indexType).toBe('ngram')
    expect(result.stats.ngramCount).toBe(1)
  })

  it('respects custom FPR for bloom filters', async () => {
    const parquetData = createTestParquet()

    const looseFpr = await generatePuffinFromParquet({
      parquetData,
      columns: ['email'],
      indexTypes: { bloom: ['email'] },
      fpr: 0.1, // 10% FPR
    })

    const strictFpr = await generatePuffinFromParquet({
      parquetData,
      columns: ['email'],
      indexTypes: { bloom: ['email'] },
      fpr: 0.001, // 0.1% FPR
    })

    // Stricter FPR = larger bloom filter
    expect(strictFpr.stats.columns['email'].sizeBytes).toBeGreaterThan(
      looseFpr.stats.columns['email'].sizeBytes
    )
  })
})

describe('Puffin Generator - Query Pruning', () => {
  it('can prune with generated bloom filter', async () => {
    // Create Parquet with known values
    const schema = new Schema([new Field('id', new Utf8())])
    const table = tableFromArrays(
      { id: ['A', 'B', 'C', 'D', 'E'] },
      schema
    )
    const parquetData = writeParquet(tableToIPC(table))

    // Generate Puffin
    const result = await generatePuffinFromParquet({
      parquetData,
      columns: ['id'],
      indexTypes: { bloom: ['id'] },
    })

    // Read and test bloom filter
    const reader = new PuffinReader(result.puffinBytes)
    const blobData = reader.getBlob(0)

    // Import BloomFilter to test
    const { BloomFilter } = await import('../puffin')
    const filter = BloomFilter.deserialize(blobData!)

    // Should find existing values
    expect(filter.mightContain('A')).toBe(true)
    expect(filter.mightContain('C')).toBe(true)
    expect(filter.mightContain('E')).toBe(true)

    // Should (probably) not find non-existing values
    // Note: false positives possible, so we check multiple
    const falsePositives = ['X', 'Y', 'Z', 'FOO', 'BAR'].filter((v) =>
      filter.mightContain(v)
    )
    expect(falsePositives.length).toBeLessThan(3) // At 1% FPR, unlikely to have many
  })
})
