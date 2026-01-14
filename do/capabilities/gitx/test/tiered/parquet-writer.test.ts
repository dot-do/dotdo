import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ParquetWriter,
  ParquetSchema,
  ParquetField,
  ParquetFieldType,
  ParquetCompression,
  ParquetWriteOptions,
  RowGroup,
  ParquetMetadata,
  createParquetWriter,
  defineSchema,
  writeParquetFile,
  closeWriter,
  addRowGroup,
  getMetadata,
  setCompression,
  ParquetError
} from '../../src/tiered/parquet-writer'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Sample analytics data for testing
 */
interface CommitAnalyticsRow {
  sha: string
  author_name: string
  author_email: string
  timestamp: number
  message_length: number
  file_count: number
  additions: number
  deletions: number
  is_merge: boolean
}

interface ObjectAnalyticsRow {
  sha: string
  type: string
  size: number
  pack_offset: number | null
  tier: string
  created_at: number
}

const sampleCommitRows: CommitAnalyticsRow[] = [
  {
    sha: 'a'.repeat(40),
    author_name: 'Alice',
    author_email: 'alice@example.com.ai',
    timestamp: 1704067200,
    message_length: 50,
    file_count: 3,
    additions: 100,
    deletions: 20,
    is_merge: false
  },
  {
    sha: 'b'.repeat(40),
    author_name: 'Bob',
    author_email: 'bob@example.com.ai',
    timestamp: 1704153600,
    message_length: 120,
    file_count: 1,
    additions: 10,
    deletions: 5,
    is_merge: false
  },
  {
    sha: 'c'.repeat(40),
    author_name: 'Charlie',
    author_email: 'charlie@example.com.ai',
    timestamp: 1704240000,
    message_length: 200,
    file_count: 15,
    additions: 500,
    deletions: 300,
    is_merge: true
  }
]

const sampleObjectRows: ObjectAnalyticsRow[] = [
  {
    sha: 'd'.repeat(40),
    type: 'blob',
    size: 1024,
    pack_offset: null,
    tier: 'hot',
    created_at: 1704067200
  },
  {
    sha: 'e'.repeat(40),
    type: 'tree',
    size: 256,
    pack_offset: 12345,
    tier: 'warm',
    created_at: 1704153600
  }
]

/**
 * Create a mock output stream for testing
 */
function createMockOutputStream() {
  const chunks: Uint8Array[] = []
  return {
    write(data: Uint8Array): void {
      chunks.push(data)
    },
    getBuffer(): Uint8Array {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return result
    },
    getChunks(): Uint8Array[] {
      return [...chunks]
    },
    clear(): void {
      chunks.length = 0
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Parquet Analytics Writer', () => {
  describe('Schema Definition', () => {
    describe('Basic field types', () => {
      it('should define a schema with string fields', () => {
        const schema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'author', type: ParquetFieldType.STRING, required: false }
        ])

        expect(schema).toBeDefined()
        expect(schema.fields.length).toBe(2)
        expect(schema.fields[0].name).toBe('sha')
        expect(schema.fields[0].type).toBe(ParquetFieldType.STRING)
        expect(schema.fields[0].required).toBe(true)
      })

      it('should define a schema with integer fields', () => {
        const schema = defineSchema([
          { name: 'size', type: ParquetFieldType.INT32, required: true },
          { name: 'offset', type: ParquetFieldType.INT64, required: false }
        ])

        expect(schema.fields.length).toBe(2)
        expect(schema.fields[0].type).toBe(ParquetFieldType.INT32)
        expect(schema.fields[1].type).toBe(ParquetFieldType.INT64)
      })

      it('should define a schema with boolean fields', () => {
        const schema = defineSchema([
          { name: 'is_merge', type: ParquetFieldType.BOOLEAN, required: true }
        ])

        expect(schema.fields[0].type).toBe(ParquetFieldType.BOOLEAN)
      })

      it('should define a schema with floating point fields', () => {
        const schema = defineSchema([
          { name: 'ratio', type: ParquetFieldType.FLOAT, required: true },
          { name: 'precise_value', type: ParquetFieldType.DOUBLE, required: true }
        ])

        expect(schema.fields[0].type).toBe(ParquetFieldType.FLOAT)
        expect(schema.fields[1].type).toBe(ParquetFieldType.DOUBLE)
      })

      it('should define a schema with binary fields', () => {
        const schema = defineSchema([
          { name: 'data', type: ParquetFieldType.BINARY, required: true }
        ])

        expect(schema.fields[0].type).toBe(ParquetFieldType.BINARY)
      })

      it('should define a schema with timestamp fields', () => {
        const schema = defineSchema([
          { name: 'created_at', type: ParquetFieldType.TIMESTAMP_MILLIS, required: true },
          { name: 'updated_at', type: ParquetFieldType.TIMESTAMP_MICROS, required: false }
        ])

        expect(schema.fields[0].type).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
        expect(schema.fields[1].type).toBe(ParquetFieldType.TIMESTAMP_MICROS)
      })
    })

    describe('Complex schema definitions', () => {
      it('should define a commit analytics schema', () => {
        const schema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'author_name', type: ParquetFieldType.STRING, required: true },
          { name: 'author_email', type: ParquetFieldType.STRING, required: true },
          { name: 'timestamp', type: ParquetFieldType.INT64, required: true },
          { name: 'message_length', type: ParquetFieldType.INT32, required: true },
          { name: 'file_count', type: ParquetFieldType.INT32, required: true },
          { name: 'additions', type: ParquetFieldType.INT64, required: true },
          { name: 'deletions', type: ParquetFieldType.INT64, required: true },
          { name: 'is_merge', type: ParquetFieldType.BOOLEAN, required: true }
        ])

        expect(schema.fields.length).toBe(9)
      })

      it('should define a schema with nullable fields', () => {
        const schema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'pack_offset', type: ParquetFieldType.INT64, required: false }
        ])

        expect(schema.fields[0].required).toBe(true)
        expect(schema.fields[1].required).toBe(false)
      })

      it('should reject schema with duplicate field names', () => {
        expect(() => defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'sha', type: ParquetFieldType.STRING, required: true }
        ])).toThrow(ParquetError)
      })

      it('should reject schema with empty field name', () => {
        expect(() => defineSchema([
          { name: '', type: ParquetFieldType.STRING, required: true }
        ])).toThrow(ParquetError)
      })

      it('should reject empty schema', () => {
        expect(() => defineSchema([])).toThrow(ParquetError)
      })
    })

    describe('Schema with metadata', () => {
      it('should support field-level metadata', () => {
        const schema = defineSchema([
          {
            name: 'sha',
            type: ParquetFieldType.STRING,
            required: true,
            metadata: { description: 'Git object SHA-1 hash' }
          }
        ])

        expect(schema.fields[0].metadata?.description).toBe('Git object SHA-1 hash')
      })

      it('should support schema-level metadata', () => {
        const schema = defineSchema(
          [{ name: 'sha', type: ParquetFieldType.STRING, required: true }],
          { createdBy: 'gitx.do', version: '1.0.0' }
        )

        expect(schema.metadata?.createdBy).toBe('gitx.do')
        expect(schema.metadata?.version).toBe('1.0.0')
      })
    })
  })

  describe('ParquetWriter Creation', () => {
    it('should create a writer with default options', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema)

      expect(writer).toBeDefined()
      expect(writer.schema).toBe(schema)
    })

    it('should create a writer with custom row group size', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { rowGroupSize: 10000 })

      expect(writer.options.rowGroupSize).toBe(10000)
    })

    it('should create a writer with compression option', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { compression: ParquetCompression.SNAPPY })

      expect(writer.options.compression).toBe(ParquetCompression.SNAPPY)
    })

    it('should create a writer with GZIP compression', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { compression: ParquetCompression.GZIP })

      expect(writer.options.compression).toBe(ParquetCompression.GZIP)
    })

    it('should create a writer with ZSTD compression', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { compression: ParquetCompression.ZSTD })

      expect(writer.options.compression).toBe(ParquetCompression.ZSTD)
    })

    it('should create a writer with LZ4 compression', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { compression: ParquetCompression.LZ4 })

      expect(writer.options.compression).toBe(ParquetCompression.LZ4)
    })

    it('should default to SNAPPY compression', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema)

      expect(writer.options.compression).toBe(ParquetCompression.SNAPPY)
    })

    it('should allow uncompressed option', () => {
      const schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema, { compression: ParquetCompression.UNCOMPRESSED })

      expect(writer.options.compression).toBe(ParquetCompression.UNCOMPRESSED)
    })
  })

  describe('Parquet File Generation', () => {
    let schema: ParquetSchema
    let writer: ParquetWriter

    beforeEach(() => {
      schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true },
        { name: 'author_name', type: ParquetFieldType.STRING, required: true },
        { name: 'timestamp', type: ParquetFieldType.INT64, required: true },
        { name: 'file_count', type: ParquetFieldType.INT32, required: true },
        { name: 'is_merge', type: ParquetFieldType.BOOLEAN, required: true }
      ])
      writer = createParquetWriter(schema)
    })

    describe('Writing rows', () => {
      it('should write a single row', async () => {
        const row = {
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        }

        await writer.writeRow(row)

        expect(writer.rowCount).toBe(1)
      })

      it('should write multiple rows', async () => {
        const rows = [
          { sha: 'a'.repeat(40), author_name: 'Alice', timestamp: 1704067200, file_count: 3, is_merge: false },
          { sha: 'b'.repeat(40), author_name: 'Bob', timestamp: 1704153600, file_count: 1, is_merge: false },
          { sha: 'c'.repeat(40), author_name: 'Charlie', timestamp: 1704240000, file_count: 15, is_merge: true }
        ]

        for (const row of rows) {
          await writer.writeRow(row)
        }

        expect(writer.rowCount).toBe(3)
      })

      it('should write batch of rows', async () => {
        const rows = [
          { sha: 'a'.repeat(40), author_name: 'Alice', timestamp: 1704067200, file_count: 3, is_merge: false },
          { sha: 'b'.repeat(40), author_name: 'Bob', timestamp: 1704153600, file_count: 1, is_merge: false }
        ]

        await writer.writeRows(rows)

        expect(writer.rowCount).toBe(2)
      })

      it('should reject row with missing required field', async () => {
        const invalidRow = {
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          // timestamp is missing
          file_count: 3,
          is_merge: false
        }

        await expect(writer.writeRow(invalidRow)).rejects.toThrow(ParquetError)
      })

      it('should reject row with wrong field type', async () => {
        const invalidRow = {
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 'not a number', // Should be number
          file_count: 3,
          is_merge: false
        }

        await expect(writer.writeRow(invalidRow)).rejects.toThrow(ParquetError)
      })

      it('should accept row with null for optional field', async () => {
        const optionalSchema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'pack_offset', type: ParquetFieldType.INT64, required: false }
        ])
        const optionalWriter = createParquetWriter(optionalSchema)

        await optionalWriter.writeRow({ sha: 'a'.repeat(40), pack_offset: null })

        expect(optionalWriter.rowCount).toBe(1)
      })

      it('should handle unicode strings', async () => {
        const row = {
          sha: 'a'.repeat(40),
          author_name: 'Contributor',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        }

        await writer.writeRow(row)

        expect(writer.rowCount).toBe(1)
      })

      it('should handle empty strings', async () => {
        const row = {
          sha: 'a'.repeat(40),
          author_name: '',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        }

        await writer.writeRow(row)

        expect(writer.rowCount).toBe(1)
      })
    })

    describe('File output', () => {
      it('should generate valid parquet file bytes', async () => {
        await writer.writeRow({
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        })

        const bytes = await writer.toBuffer()

        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBeGreaterThan(0)
      })

      it('should include PAR1 magic bytes at start', async () => {
        await writer.writeRow({
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        })

        const bytes = await writer.toBuffer()
        const magic = new TextDecoder().decode(bytes.slice(0, 4))

        expect(magic).toBe('PAR1')
      })

      it('should include PAR1 magic bytes at end', async () => {
        await writer.writeRow({
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        })

        const bytes = await writer.toBuffer()
        const magic = new TextDecoder().decode(bytes.slice(-4))

        expect(magic).toBe('PAR1')
      })

      it('should write to output stream', async () => {
        const output = createMockOutputStream()
        await writer.writeRow({
          sha: 'a'.repeat(40),
          author_name: 'Alice',
          timestamp: 1704067200,
          file_count: 3,
          is_merge: false
        })

        await writer.writeTo(output)

        const buffer = output.getBuffer()
        expect(buffer.length).toBeGreaterThan(0)
      })

      it('should use writeParquetFile helper function', async () => {
        const rows = [
          { sha: 'a'.repeat(40), author_name: 'Alice', timestamp: 1704067200, file_count: 3, is_merge: false }
        ]

        const bytes = await writeParquetFile(schema, rows)

        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Row Group Management', () => {
    let schema: ParquetSchema
    let writer: ParquetWriter

    beforeEach(() => {
      schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true },
        { name: 'size', type: ParquetFieldType.INT64, required: true }
      ])
    })

    it('should create row group when row count reaches threshold', async () => {
      writer = createParquetWriter(schema, { rowGroupSize: 3 })

      for (let i = 0; i < 5; i++) {
        await writer.writeRow({ sha: 'a'.repeat(40), size: i * 100 })
      }

      expect(writer.rowGroupCount).toBe(2) // 3 rows + 2 rows = 2 groups
    })

    it('should track row groups correctly', async () => {
      writer = createParquetWriter(schema, { rowGroupSize: 2 })

      for (let i = 0; i < 4; i++) {
        await writer.writeRow({ sha: 'a'.repeat(40), size: i * 100 })
      }

      expect(writer.rowGroupCount).toBe(2)
      expect(writer.rowCount).toBe(4)
    })

    it('should manually flush row group', async () => {
      writer = createParquetWriter(schema, { rowGroupSize: 1000 })

      await writer.writeRow({ sha: 'a'.repeat(40), size: 100 })
      await writer.writeRow({ sha: 'b'.repeat(40), size: 200 })

      await writer.flushRowGroup()

      expect(writer.rowGroupCount).toBe(1)
    })

    it('should preserve data across row groups', async () => {
      writer = createParquetWriter(schema, { rowGroupSize: 2 })

      for (let i = 0; i < 6; i++) {
        await writer.writeRow({ sha: String(i).repeat(40).slice(0, 40), size: i * 100 })
      }

      expect(writer.rowCount).toBe(6)
      expect(writer.rowGroupCount).toBe(3)
    })

    it('should get row group info', async () => {
      writer = createParquetWriter(schema, { rowGroupSize: 2 })

      await writer.writeRow({ sha: 'a'.repeat(40), size: 100 })
      await writer.writeRow({ sha: 'b'.repeat(40), size: 200 })
      await writer.flushRowGroup()

      const rowGroups = writer.getRowGroups()

      expect(rowGroups.length).toBe(1)
      expect(rowGroups[0].numRows).toBe(2)
    })

    it('should estimate row group memory size', async () => {
      writer = createParquetWriter(schema)

      await writer.writeRow({ sha: 'a'.repeat(40), size: 100 })
      await writer.writeRow({ sha: 'b'.repeat(40), size: 200 })

      const memorySize = writer.currentRowGroupMemorySize()

      expect(memorySize).toBeGreaterThan(0)
    })

    it('should create row group based on memory threshold', async () => {
      writer = createParquetWriter(schema, { rowGroupMemoryLimit: 100 }) // Very small limit

      for (let i = 0; i < 10; i++) {
        await writer.writeRow({ sha: 'a'.repeat(40), size: i * 100 })
      }

      expect(writer.rowGroupCount).toBeGreaterThan(1)
    })
  })

  describe('Compression Options', () => {
    let schema: ParquetSchema

    beforeEach(() => {
      schema = defineSchema([
        { name: 'data', type: ParquetFieldType.STRING, required: true }
      ])
    })

    it('should compress with SNAPPY', async () => {
      const writer = createParquetWriter(schema, { compression: ParquetCompression.SNAPPY })

      // Write highly compressible data
      for (let i = 0; i < 100; i++) {
        await writer.writeRow({ data: 'A'.repeat(1000) })
      }

      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.compression).toBe(ParquetCompression.SNAPPY)
    })

    it('should compress with GZIP', async () => {
      const writer = createParquetWriter(schema, { compression: ParquetCompression.GZIP })

      for (let i = 0; i < 100; i++) {
        await writer.writeRow({ data: 'A'.repeat(1000) })
      }

      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.compression).toBe(ParquetCompression.GZIP)
    })

    it('should compress with ZSTD', async () => {
      const writer = createParquetWriter(schema, { compression: ParquetCompression.ZSTD })

      for (let i = 0; i < 100; i++) {
        await writer.writeRow({ data: 'A'.repeat(1000) })
      }

      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.compression).toBe(ParquetCompression.ZSTD)
    })

    it('should produce smaller file with compression', async () => {
      const uncompressedWriter = createParquetWriter(schema, { compression: ParquetCompression.UNCOMPRESSED })
      const compressedWriter = createParquetWriter(schema, { compression: ParquetCompression.SNAPPY })

      const data = 'A'.repeat(1000)
      for (let i = 0; i < 100; i++) {
        await uncompressedWriter.writeRow({ data })
        await compressedWriter.writeRow({ data })
      }

      const uncompressedBytes = await uncompressedWriter.toBuffer()
      const compressedBytes = await compressedWriter.toBuffer()

      expect(compressedBytes.length).toBeLessThan(uncompressedBytes.length)
    })

    it('should change compression dynamically', async () => {
      const writer = createParquetWriter(schema)

      setCompression(writer, ParquetCompression.ZSTD)

      expect(writer.options.compression).toBe(ParquetCompression.ZSTD)
    })

    it('should use per-column compression', async () => {
      const multiSchema = defineSchema([
        { name: 'id', type: ParquetFieldType.INT64, required: true },
        { name: 'data', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(multiSchema, {
        columnCompression: {
          id: ParquetCompression.UNCOMPRESSED,
          data: ParquetCompression.ZSTD
        }
      })

      await writer.writeRow({ id: 1, data: 'test' })
      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.columnMetadata?.['id'].compression).toBe(ParquetCompression.UNCOMPRESSED)
      expect(metadata.columnMetadata?.['data'].compression).toBe(ParquetCompression.ZSTD)
    })
  })

  describe('Metadata Handling', () => {
    let schema: ParquetSchema
    let writer: ParquetWriter

    beforeEach(() => {
      schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      writer = createParquetWriter(schema)
    })

    it('should include schema metadata in file', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.schema).toBeDefined()
      expect(metadata.schema.fields.length).toBe(1)
    })

    it('should include row count in metadata', async () => {
      for (let i = 0; i < 10; i++) {
        await writer.writeRow({ sha: String(i).repeat(40).slice(0, 40) })
      }

      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.numRows).toBe(10)
    })

    it('should include row group metadata', async () => {
      const groupWriter = createParquetWriter(schema, { rowGroupSize: 5 })

      for (let i = 0; i < 12; i++) {
        await groupWriter.writeRow({ sha: String(i).repeat(40).slice(0, 40) })
      }

      const bytes = await groupWriter.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.rowGroups.length).toBe(3) // 5 + 5 + 2
    })

    it('should include column statistics', async () => {
      const numSchema = defineSchema([
        { name: 'value', type: ParquetFieldType.INT64, required: true }
      ])
      const numWriter = createParquetWriter(numSchema, { enableStatistics: true })

      await numWriter.writeRow({ value: 10 })
      await numWriter.writeRow({ value: 50 })
      await numWriter.writeRow({ value: 30 })

      const bytes = await numWriter.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.rowGroups[0].columns[0].statistics).toBeDefined()
      expect(metadata.rowGroups[0].columns[0].statistics?.min).toBe(10)
      expect(metadata.rowGroups[0].columns[0].statistics?.max).toBe(50)
    })

    it('should include null count in statistics', async () => {
      const optSchema = defineSchema([
        { name: 'value', type: ParquetFieldType.INT64, required: false }
      ])
      const optWriter = createParquetWriter(optSchema, { enableStatistics: true })

      await optWriter.writeRow({ value: 10 })
      await optWriter.writeRow({ value: null })
      await optWriter.writeRow({ value: 30 })

      const bytes = await optWriter.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.rowGroups[0].columns[0].statistics?.nullCount).toBe(1)
    })

    it('should add custom key-value metadata', async () => {
      writer.setMetadata('gitdo.version', '1.0.0')
      writer.setMetadata('gitdo.created_by', 'parquet-writer')

      await writer.writeRow({ sha: 'a'.repeat(40) })
      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.keyValueMetadata?.['gitdo.version']).toBe('1.0.0')
      expect(metadata.keyValueMetadata?.['gitdo.created_by']).toBe('parquet-writer')
    })

    it('should include creation timestamp', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.createdAt).toBeDefined()
      expect(typeof metadata.createdAt).toBe('number')
    })

    it('should include file size in metadata', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      const bytes = await writer.toBuffer()
      const metadata = getMetadata(bytes)

      expect(metadata.fileSize).toBe(bytes.length)
    })
  })

  describe('Writer Lifecycle', () => {
    let schema: ParquetSchema
    let writer: ParquetWriter

    beforeEach(() => {
      schema = defineSchema([
        { name: 'sha', type: ParquetFieldType.STRING, required: true }
      ])
      writer = createParquetWriter(schema)
    })

    it('should close writer properly', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      await closeWriter(writer)

      expect(writer.isClosed).toBe(true)
    })

    it('should reject writes after close', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      await closeWriter(writer)

      await expect(writer.writeRow({ sha: 'b'.repeat(40) })).rejects.toThrow(ParquetError)
    })

    it('should flush pending data on close', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      await writer.writeRow({ sha: 'b'.repeat(40) })

      const bytes = await closeWriter(writer)

      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should allow multiple toBuffer calls before close', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })

      const bytes1 = await writer.toBuffer()
      const bytes2 = await writer.toBuffer()

      expect(bytes1).toEqual(bytes2)
    })

    it('should handle empty file', async () => {
      const bytes = await writer.toBuffer()

      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0) // Should still have header/footer
    })

    it('should reset writer state', async () => {
      await writer.writeRow({ sha: 'a'.repeat(40) })
      expect(writer.rowCount).toBe(1)

      writer.reset()

      expect(writer.rowCount).toBe(0)
      expect(writer.rowGroupCount).toBe(0)
    })
  })

  describe('Analytics-Specific Features', () => {
    describe('Commit analytics', () => {
      it('should write commit analytics data', async () => {
        const schema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'author_name', type: ParquetFieldType.STRING, required: true },
          { name: 'author_email', type: ParquetFieldType.STRING, required: true },
          { name: 'timestamp', type: ParquetFieldType.INT64, required: true },
          { name: 'message_length', type: ParquetFieldType.INT32, required: true },
          { name: 'file_count', type: ParquetFieldType.INT32, required: true },
          { name: 'additions', type: ParquetFieldType.INT64, required: true },
          { name: 'deletions', type: ParquetFieldType.INT64, required: true },
          { name: 'is_merge', type: ParquetFieldType.BOOLEAN, required: true }
        ])

        const bytes = await writeParquetFile(schema, sampleCommitRows)

        expect(bytes).toBeInstanceOf(Uint8Array)
        const metadata = getMetadata(bytes)
        expect(metadata.numRows).toBe(3)
      })
    })

    describe('Object analytics', () => {
      it('should write object analytics data', async () => {
        const schema = defineSchema([
          { name: 'sha', type: ParquetFieldType.STRING, required: true },
          { name: 'type', type: ParquetFieldType.STRING, required: true },
          { name: 'size', type: ParquetFieldType.INT64, required: true },
          { name: 'pack_offset', type: ParquetFieldType.INT64, required: false },
          { name: 'tier', type: ParquetFieldType.STRING, required: true },
          { name: 'created_at', type: ParquetFieldType.INT64, required: true }
        ])

        const bytes = await writeParquetFile(schema, sampleObjectRows)

        expect(bytes).toBeInstanceOf(Uint8Array)
        const metadata = getMetadata(bytes)
        expect(metadata.numRows).toBe(2)
      })
    })

    describe('Sorted output for efficient queries', () => {
      it('should support sorted output by column', async () => {
        const schema = defineSchema([
          { name: 'timestamp', type: ParquetFieldType.INT64, required: true },
          { name: 'sha', type: ParquetFieldType.STRING, required: true }
        ])
        const writer = createParquetWriter(schema, { sortBy: ['timestamp'] })

        await writer.writeRow({ timestamp: 300, sha: 'c'.repeat(40) })
        await writer.writeRow({ timestamp: 100, sha: 'a'.repeat(40) })
        await writer.writeRow({ timestamp: 200, sha: 'b'.repeat(40) })

        const bytes = await writer.toBuffer()
        const metadata = getMetadata(bytes)

        expect(metadata.sortedBy).toEqual(['timestamp'])
      })
    })

    describe('Partitioning support', () => {
      it('should support partition hints in metadata', async () => {
        const schema = defineSchema([
          { name: 'date', type: ParquetFieldType.STRING, required: true },
          { name: 'sha', type: ParquetFieldType.STRING, required: true }
        ])
        const writer = createParquetWriter(schema, {
          partitionColumns: ['date']
        })

        await writer.writeRow({ date: '2024-01-01', sha: 'a'.repeat(40) })
        const bytes = await writer.toBuffer()
        const metadata = getMetadata(bytes)

        expect(metadata.partitionColumns).toEqual(['date'])
      })
    })
  })

  describe('Error Handling', () => {
    it('should throw ParquetError for invalid operations', () => {
      expect(() => defineSchema([])).toThrow(ParquetError)
    })

    it('should provide helpful error messages', () => {
      try {
        defineSchema([])
      } catch (e) {
        expect(e).toBeInstanceOf(ParquetError)
        expect((e as ParquetError).message).toContain('empty')
      }
    })

    it('should include error code', () => {
      try {
        defineSchema([])
      } catch (e) {
        expect((e as ParquetError).code).toBeDefined()
      }
    })

    it('should handle large row data gracefully', async () => {
      const schema = defineSchema([
        { name: 'data', type: ParquetFieldType.STRING, required: true }
      ])
      const writer = createParquetWriter(schema)

      // Write a very large string
      const largeData = 'x'.repeat(10 * 1024 * 1024) // 10MB

      await writer.writeRow({ data: largeData })

      expect(writer.rowCount).toBe(1)
    })

    it('should handle special float values', async () => {
      const schema = defineSchema([
        { name: 'value', type: ParquetFieldType.DOUBLE, required: true }
      ])
      const writer = createParquetWriter(schema)

      await writer.writeRow({ value: Number.POSITIVE_INFINITY })
      await writer.writeRow({ value: Number.NEGATIVE_INFINITY })
      await writer.writeRow({ value: Number.NaN })

      expect(writer.rowCount).toBe(3)
    })

    it('should handle int64 boundary values', async () => {
      const schema = defineSchema([
        { name: 'value', type: ParquetFieldType.INT64, required: true }
      ])
      const writer = createParquetWriter(schema)

      await writer.writeRow({ value: Number.MAX_SAFE_INTEGER })
      await writer.writeRow({ value: Number.MIN_SAFE_INTEGER })
      await writer.writeRow({ value: 0 })
      await writer.writeRow({ value: -1 })

      expect(writer.rowCount).toBe(4)
    })
  })
})
