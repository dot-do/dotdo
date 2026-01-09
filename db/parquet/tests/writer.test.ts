/**
 * Tests for Parquet Writer
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ParquetBuilder,
  createVectorSchema,
  validateVectorRecord,
  generateParquetPath,
  VECTOR_SCHEMA_1536,
  type VectorRecord,
} from '../index'

describe('ParquetBuilder', () => {
  let builder: ParquetBuilder

  beforeEach(() => {
    builder = new ParquetBuilder({
      schema: VECTOR_SCHEMA_1536,
      compression: 'ZSTD',
      rowGroupSize: 100,
    })
  })

  describe('constructor', () => {
    it('should create builder with schema options', () => {
      const b = new ParquetBuilder({
        schema: { dimension: 512 },
        compression: 'SNAPPY',
      })
      expect(b.isEmpty()).toBe(true)
      expect(b.getRowCount()).toBe(0)
    })

    it('should create builder with Arrow schema', () => {
      const schema = createVectorSchema({ dimension: 1024 })
      const b = new ParquetBuilder({
        schema,
        compression: 'NONE',
      })
      expect(b.isEmpty()).toBe(true)
    })
  })

  describe('addRow', () => {
    it('should add a valid vector record', () => {
      const record: VectorRecord = {
        ns: 'test.do',
        type: 'Document',
        visibility: 'public',
        id: 'vec_001',
        embedding: new Float32Array(1536).fill(0.1),
        metadata: '{"title": "Test"}',
        created_at: Date.now(),
      }

      builder.addRow(record)
      expect(builder.getRowCount()).toBe(1)
      expect(builder.isEmpty()).toBe(false)
    })

    it('should add multiple records', () => {
      for (let i = 0; i < 5; i++) {
        builder.addRow({
          ns: 'test.do',
          type: 'Chunk',
          visibility: 'org',
          id: `vec_${i}`,
          embedding: new Float32Array(1536),
          metadata: null,
          created_at: Date.now(),
        })
      }
      expect(builder.getRowCount()).toBe(5)
    })

    it('should accept number[] for embedding', () => {
      builder.addRow({
        ns: 'test.do',
        type: 'Message',
        visibility: null,
        id: 'vec_array',
        embedding: Array(1536).fill(0.5),
        metadata: null,
        created_at: Date.now(),
      })
      expect(builder.getRowCount()).toBe(1)
    })

    it('should reject invalid dimension', () => {
      expect(() => {
        builder.addRow({
          ns: 'test.do',
          type: 'Doc',
          visibility: 'public',
          id: 'bad_vec',
          embedding: new Float32Array(512), // Wrong dimension
          metadata: null,
          created_at: Date.now(),
        })
      }).toThrow('Embedding dimension mismatch')
    })

    it('should reject empty namespace', () => {
      expect(() => {
        builder.addRow({
          ns: '',
          type: 'Doc',
          visibility: 'public',
          id: 'vec_001',
          embedding: new Float32Array(1536),
          metadata: null,
          created_at: Date.now(),
        })
      }).toThrow('non-empty ns')
    })

    it('should reject empty id', () => {
      expect(() => {
        builder.addRow({
          ns: 'test.do',
          type: 'Doc',
          visibility: 'public',
          id: '',
          embedding: new Float32Array(1536),
          metadata: null,
          created_at: Date.now(),
        })
      }).toThrow('non-empty id')
    })
  })

  describe('addRows', () => {
    it('should add multiple rows at once', () => {
      const records: VectorRecord[] = [
        {
          ns: 'batch.do',
          type: 'Article',
          visibility: 'public',
          id: 'art_1',
          embedding: new Float32Array(1536),
          metadata: null,
          created_at: Date.now(),
        },
        {
          ns: 'batch.do',
          type: 'Article',
          visibility: 'public',
          id: 'art_2',
          embedding: new Float32Array(1536),
          metadata: null,
          created_at: Date.now(),
        },
      ]

      builder.addRows(records)
      expect(builder.getRowCount()).toBe(2)
    })
  })

  describe('reset', () => {
    it('should reset builder state', () => {
      builder.addRow({
        ns: 'test.do',
        type: 'Doc',
        visibility: 'public',
        id: 'vec_001',
        embedding: new Float32Array(1536),
        metadata: null,
        created_at: Date.now(),
      })

      expect(builder.getRowCount()).toBe(1)

      builder.reset()

      expect(builder.getRowCount()).toBe(0)
      expect(builder.isEmpty()).toBe(true)
    })
  })
})

describe('validateVectorRecord', () => {
  it('should validate correct record', () => {
    const record: VectorRecord = {
      ns: 'valid.do',
      type: 'Test',
      visibility: 'public',
      id: 'test_001',
      embedding: new Float32Array(1536),
      metadata: '{}',
      created_at: Date.now(),
    }

    expect(validateVectorRecord(record)).toBe(true)
  })

  it('should validate with custom dimension', () => {
    const record: VectorRecord = {
      ns: 'valid.do',
      type: 'Test',
      visibility: 'user',
      id: 'test_001',
      embedding: new Float32Array(512),
      metadata: null,
      created_at: Date.now(),
    }

    expect(validateVectorRecord(record, 512)).toBe(true)
  })

  it('should reject mismatched dimension', () => {
    const record: VectorRecord = {
      ns: 'valid.do',
      type: 'Test',
      visibility: 'public',
      id: 'test_001',
      embedding: new Float32Array(512),
      metadata: null,
      created_at: Date.now(),
    }

    expect(() => validateVectorRecord(record, 1536)).toThrow('dimension mismatch')
  })
})

describe('createVectorSchema', () => {
  it('should create schema with default options', () => {
    const schema = createVectorSchema()
    expect(schema.fields.length).toBeGreaterThan(0)

    const embeddingField = schema.fields.find((f) => f.name === 'embedding')
    expect(embeddingField).toBeDefined()
  })

  it('should create schema with custom dimension', () => {
    const schema = createVectorSchema({ dimension: 3072 })
    const embeddingField = schema.fields.find((f) => f.name === 'embedding')

    expect(embeddingField).toBeDefined()
    // Check the list size through the type
    expect(embeddingField?.type).toBeDefined()
  })

  it('should exclude metadata when configured', () => {
    const schema = createVectorSchema({ includeMetadata: false })
    const metadataField = schema.fields.find((f) => f.name === 'metadata')
    expect(metadataField).toBeUndefined()
  })

  it('should exclude visibility when configured', () => {
    const schema = createVectorSchema({ includeVisibility: false })
    const visibilityField = schema.fields.find((f) => f.name === 'visibility')
    expect(visibilityField).toBeUndefined()
  })
})

describe('generateParquetPath', () => {
  it('should generate correct path format', () => {
    const path = generateParquetPath('tenant.do', '2026-01-09', 1736438400000)
    expect(path).toBe('vectors/ns=tenant.do/dt=2026-01-09/vectors_1736438400000.parquet')
  })

  it('should use current timestamp if not provided', () => {
    const path = generateParquetPath('test.do', '2026-01-09')
    expect(path).toMatch(/^vectors\/ns=test\.do\/dt=2026-01-09\/vectors_\d+\.parquet$/)
  })

  it('should handle namespace with dots', () => {
    const path = generateParquetPath('my.company.do', '2026-01-09', 123)
    expect(path).toBe('vectors/ns=my.company.do/dt=2026-01-09/vectors_123.parquet')
  })
})
