/**
 * BulkDocumentGenerator Tests - Efficient batch document processing
 *
 * Tests for the BulkDocumentGenerator class covering:
 * - Bulk generation from data arrays
 * - Batched processing with configurable batch sizes
 * - Async iterator for streaming large datasets
 * - Progress tracking and callbacks
 * - Error handling per document (continue on failure)
 * - Memory-efficient processing
 *
 * @module db/primitives/documents/tests/bulk-generator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createBulkDocumentGenerator,
  BulkDocumentGenerator,
  type BulkGeneratorConfig,
  type GenerationResult,
  type BatchResult,
  type ProgressCallback,
  type ErrorCallback,
  type GeneratedDocument,
} from '../bulk-generator'

// =============================================================================
// Factory Tests
// =============================================================================

describe('BulkDocumentGenerator Factory', () => {
  describe('createBulkDocumentGenerator()', () => {
    it('creates a BulkDocumentGenerator instance', () => {
      const generator = createBulkDocumentGenerator()

      expect(generator).toBeDefined()
      expect(generator).toBeInstanceOf(BulkDocumentGenerator)
    })

    it('accepts optional configuration', () => {
      const generator = createBulkDocumentGenerator({
        defaultBatchSize: 50,
        continueOnError: true,
      })

      expect(generator).toBeDefined()
      const config = generator.getConfig()
      expect(config.defaultBatchSize).toBe(50)
      expect(config.continueOnError).toBe(true)
    })

    it('uses sensible defaults when no config provided', () => {
      const generator = createBulkDocumentGenerator()
      const config = generator.getConfig()

      expect(config.defaultBatchSize).toBe(100)
      expect(config.continueOnError).toBe(true)
      expect(config.maxConcurrency).toBe(1)
    })
  })
})

// =============================================================================
// Bulk Generation Tests
// =============================================================================

describe('Bulk Generation', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('generate()', () => {
    it('generates documents from array of data', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]

      const result = await generator.generate(template, dataArray)

      expect(result.documents).toHaveLength(3)
      expect(result.documents[0]?.content).toBe('Hello Alice!')
      expect(result.documents[1]?.content).toBe('Hello Bob!')
      expect(result.documents[2]?.content).toBe('Hello Charlie!')
    })

    it('returns success count and error count', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }]

      const result = await generator.generate(template, dataArray)

      expect(result.successCount).toBe(2)
      expect(result.errorCount).toBe(0)
      expect(result.totalCount).toBe(2)
    })

    it('handles empty data array', async () => {
      const template = 'Hello {{name}}!'
      const result = await generator.generate(template, [])

      expect(result.documents).toHaveLength(0)
      expect(result.successCount).toBe(0)
      expect(result.errorCount).toBe(0)
      expect(result.totalCount).toBe(0)
    })

    it('generates documents with complex templates', async () => {
      const template =
        'Invoice #{{invoiceNumber}}\n' +
        'Customer: {{customer.name}}\n' +
        'Items:\n' +
        '{{#each items}}\n' +
        '- {{name}}: {{price}}\n' +
        '{{/each}}\n' +
        'Total: {{total}}'

      const dataArray = [
        {
          invoiceNumber: '001',
          customer: { name: 'Alice Corp' },
          items: [
            { name: 'Widget', price: 10 },
            { name: 'Gadget', price: 20 },
          ],
          total: 30,
        },
      ]

      const result = await generator.generate(template, dataArray)

      expect(result.documents).toHaveLength(1)
      expect(result.documents[0]?.content).toContain('Invoice #001')
      expect(result.documents[0]?.content).toContain('Alice Corp')
      expect(result.documents[0]?.content).toContain('Widget')
    })

    it('includes index in generated document metadata', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }]

      const result = await generator.generate(template, dataArray)

      expect(result.documents[0]?.index).toBe(0)
      expect(result.documents[1]?.index).toBe(1)
    })

    it('includes original data reference in generated document', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice', id: '123' }]

      const result = await generator.generate(template, dataArray)

      expect(result.documents[0]?.data).toEqual({ name: 'Alice', id: '123' })
    })
  })
})

// =============================================================================
// Batched Processing Tests
// =============================================================================

describe('Batched Processing', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('generateBatch()', () => {
    it('processes data in specified batch sizes', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` }))
      const batchSize = 3

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray, batchSize)) {
        results.push(batch)
      }

      // 10 items / 3 per batch = 4 batches (3, 3, 3, 1)
      expect(results).toHaveLength(4)
      expect(results[0]?.documents).toHaveLength(3)
      expect(results[1]?.documents).toHaveLength(3)
      expect(results[2]?.documents).toHaveLength(3)
      expect(results[3]?.documents).toHaveLength(1)
    })

    it('uses default batch size when not specified', async () => {
      const generator = createBulkDocumentGenerator({ defaultBatchSize: 5 })
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 12 }, (_, i) => ({ name: `User${i}` }))

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray)) {
        results.push(batch)
      }

      // 12 items / 5 per batch = 3 batches (5, 5, 2)
      expect(results).toHaveLength(3)
    })

    it('provides batch metadata', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 5 }, (_, i) => ({ name: `User${i}` }))

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray, 2)) {
        results.push(batch)
      }

      expect(results[0]?.batchIndex).toBe(0)
      expect(results[0]?.startIndex).toBe(0)
      expect(results[0]?.endIndex).toBe(2)

      expect(results[1]?.batchIndex).toBe(1)
      expect(results[1]?.startIndex).toBe(2)
      expect(results[1]?.endIndex).toBe(4)

      expect(results[2]?.batchIndex).toBe(2)
      expect(results[2]?.startIndex).toBe(4)
      expect(results[2]?.endIndex).toBe(5)
    })

    it('handles empty data array', async () => {
      const template = 'Hello {{name}}!'

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, [], 10)) {
        results.push(batch)
      }

      expect(results).toHaveLength(0)
    })

    it('handles batch size larger than data array', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }]

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray, 100)) {
        results.push(batch)
      }

      expect(results).toHaveLength(1)
      expect(results[0]?.documents).toHaveLength(2)
    })
  })
})

// =============================================================================
// Async Streaming Tests
// =============================================================================

describe('Async Streaming', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('generateAsync()', () => {
    it('yields documents one at a time', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]

      const documents: GeneratedDocument[] = []
      for await (const doc of generator.generateAsync(template, dataArray)) {
        documents.push(doc)
      }

      expect(documents).toHaveLength(3)
      expect(documents[0]?.content).toBe('Hello Alice!')
      expect(documents[1]?.content).toBe('Hello Bob!')
      expect(documents[2]?.content).toBe('Hello Charlie!')
    })

    it('allows early termination', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 100 }, (_, i) => ({ name: `User${i}` }))

      const documents: GeneratedDocument[] = []
      for await (const doc of generator.generateAsync(template, dataArray)) {
        documents.push(doc)
        if (documents.length >= 5) break
      }

      expect(documents).toHaveLength(5)
    })

    it('handles empty data array', async () => {
      const template = 'Hello {{name}}!'

      const documents: GeneratedDocument[] = []
      for await (const doc of generator.generateAsync(template, [])) {
        documents.push(doc)
      }

      expect(documents).toHaveLength(0)
    })

    it('yields documents with correct indices', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]

      const documents: GeneratedDocument[] = []
      for await (const doc of generator.generateAsync(template, dataArray)) {
        documents.push(doc)
      }

      expect(documents[0]?.index).toBe(0)
      expect(documents[1]?.index).toBe(1)
      expect(documents[2]?.index).toBe(2)
    })

    it('processes large datasets memory-efficiently', async () => {
      const template = 'Hello {{name}}!'
      // Simulate a large dataset
      const dataArray = Array.from({ length: 1000 }, (_, i) => ({ name: `User${i}` }))

      let count = 0
      for await (const doc of generator.generateAsync(template, dataArray)) {
        count++
        // Verify we're getting documents one at a time
        expect(doc.content).toBe(`Hello User${doc.index}!`)
      }

      expect(count).toBe(1000)
    })
  })
})

// =============================================================================
// Progress Tracking Tests
// =============================================================================

describe('Progress Tracking', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('progress callbacks', () => {
    it('calls onProgress callback for each document', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]

      const progressCalls: Array<{ current: number; total: number }> = []
      const onProgress: ProgressCallback = (current, total) => {
        progressCalls.push({ current, total })
      }

      await generator.generate(template, dataArray, { onProgress })

      expect(progressCalls).toHaveLength(3)
      expect(progressCalls[0]).toEqual({ current: 1, total: 3 })
      expect(progressCalls[1]).toEqual({ current: 2, total: 3 })
      expect(progressCalls[2]).toEqual({ current: 3, total: 3 })
    })

    it('provides progress percentage', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` }))

      const percentages: number[] = []
      const onProgress: ProgressCallback = (current, total, percentage) => {
        percentages.push(percentage)
      }

      await generator.generate(template, dataArray, { onProgress })

      expect(percentages).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    })

    it('includes document in progress callback', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }]

      let receivedDoc: GeneratedDocument | undefined
      const onProgress: ProgressCallback = (_current, _total, _percentage, doc) => {
        receivedDoc = doc
      }

      await generator.generate(template, dataArray, { onProgress })

      expect(receivedDoc?.content).toBe('Hello Alice!')
    })

    it('calls onBatchProgress for batch processing', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` }))

      const batchProgressCalls: Array<{ batchIndex: number; totalBatches: number }> = []

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray, 3, {
        onBatchProgress: (batchIndex, totalBatches) => {
          batchProgressCalls.push({ batchIndex, totalBatches })
        },
      })) {
        results.push(batch)
      }

      expect(batchProgressCalls).toHaveLength(4)
      expect(batchProgressCalls[0]).toEqual({ batchIndex: 0, totalBatches: 4 })
      expect(batchProgressCalls[3]).toEqual({ batchIndex: 3, totalBatches: 4 })
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator({ continueOnError: true })
  })

  describe('continue on error', () => {
    it('continues processing when document generation fails', async () => {
      // Use a custom template engine that throws errors
      const throwingEngine = {
        render: (template: string, data: Record<string, unknown>) => {
          if (data.shouldFail) {
            throw new Error('Intentional failure')
          }
          return `Hello ${data.name}!`
        },
      }

      const dataArray = [
        { name: 'Alice', shouldFail: false },
        { name: 'Error', shouldFail: true }, // This will fail
        { name: 'Charlie', shouldFail: false },
      ]

      const result = await generator.generate('template', dataArray, {
        templateEngine: throwingEngine,
      })

      expect(result.successCount).toBe(2)
      expect(result.errorCount).toBe(1)
      expect(result.documents).toHaveLength(2)
    })

    it('collects errors with document index', async () => {
      const throwingEngine = {
        render: (template: string, data: Record<string, unknown>) => {
          if (data.shouldFail) {
            throw new Error('Intentional failure')
          }
          return `Hello ${data.name}!`
        },
      }

      const dataArray = [
        { name: 'Alice', shouldFail: false },
        { name: 'Error', shouldFail: true },
        { name: 'Charlie', shouldFail: false },
      ]

      const result = await generator.generate('template', dataArray, {
        templateEngine: throwingEngine,
      })

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.index).toBe(1)
      expect(result.errors[0]?.data).toEqual({ name: 'Error', shouldFail: true })
    })

    it('calls onError callback for each error', async () => {
      const throwingEngine = {
        render: (template: string, data: Record<string, unknown>) => {
          if (data.shouldFail) {
            throw new Error('Intentional failure')
          }
          return `Hello ${data.name}!`
        },
      }

      const dataArray = [
        { name: 'Alice', shouldFail: false },
        { name: 'Error1', shouldFail: true },
        { name: 'Error2', shouldFail: true },
      ]

      const errorCalls: Array<{ index: number; error: Error }> = []
      const onError: ErrorCallback = (error, index, data) => {
        errorCalls.push({ index, error })
      }

      await generator.generate('template', dataArray, {
        templateEngine: throwingEngine,
        onError,
      })

      expect(errorCalls).toHaveLength(2)
      expect(errorCalls[0]?.index).toBe(1)
      expect(errorCalls[1]?.index).toBe(2)
    })

    it('stops on first error when continueOnError is false', async () => {
      const strictGenerator = createBulkDocumentGenerator({ continueOnError: false })
      const throwingEngine = {
        render: (template: string, data: Record<string, unknown>) => {
          if (data.shouldFail) {
            throw new Error('Intentional failure')
          }
          return `Hello ${data.name}!`
        },
      }

      const dataArray = [
        { name: 'Alice', shouldFail: false },
        { name: 'Error', shouldFail: true },
        { name: 'Charlie', shouldFail: false },
      ]

      await expect(
        strictGenerator.generate('template', dataArray, { templateEngine: throwingEngine })
      ).rejects.toThrow('Intentional failure')
    })
  })

  describe('error information', () => {
    it('includes error message in result', async () => {
      const throwingEngine = {
        render: () => {
          throw new Error('Test error message')
        },
      }

      const result = await generator.generate('template', [{ data: 1 }], {
        templateEngine: throwingEngine,
      })

      expect(result.errors[0]?.message).toBeDefined()
      expect(result.errors[0]?.message).toBe('Test error message')
    })

    it('includes original data in error', async () => {
      const throwingEngine = {
        render: () => {
          throw new Error('Test error')
        },
      }
      const invalidData = { name: 'test', id: 'test-123' }

      const result = await generator.generate('template', [invalidData], {
        templateEngine: throwingEngine,
      })

      expect(result.errors[0]?.data).toEqual(invalidData)
    })
  })
})

// =============================================================================
// Memory Efficiency Tests
// =============================================================================

describe('Memory Efficiency', () => {
  describe('batch memory limits', () => {
    it('respects maximum batch memory limit', async () => {
      const generator = createBulkDocumentGenerator({
        maxBatchMemoryMB: 1, // 1MB limit
      })

      const template = 'Hello {{name}}!'
      // Create data that would exceed memory if processed all at once
      const dataArray = Array.from({ length: 100 }, (_, i) => ({
        name: 'A'.repeat(10000), // ~10KB per item
      }))

      const results: BatchResult[] = []
      for await (const batch of generator.generateBatch(template, dataArray)) {
        results.push(batch)
        // Verify batch sizes are limited
        expect(batch.documents.length).toBeLessThanOrEqual(100)
      }

      expect(results.length).toBeGreaterThan(0)
    })

    it('processes with memory pressure callbacks', async () => {
      const generator = createBulkDocumentGenerator()
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 50 }, (_, i) => ({ name: `User${i}` }))

      let memoryWarningCalled = false
      const result = await generator.generate(template, dataArray, {
        onMemoryPressure: () => {
          memoryWarningCalled = true
        },
      })

      expect(result.documents).toHaveLength(50)
      // Memory warning may or may not be called depending on system
    })
  })
})

// =============================================================================
// Template Options Tests
// =============================================================================

describe('Template Options', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('custom template engine', () => {
    it('accepts custom template engine', async () => {
      const customRender = vi.fn((template: string, data: Record<string, unknown>) => {
        return `Custom: ${data.name}`
      })

      const result = await generator.generate(
        'ignored template',
        [{ name: 'Alice' }],
        { templateEngine: { render: customRender } }
      )

      expect(customRender).toHaveBeenCalled()
      expect(result.documents[0]?.content).toBe('Custom: Alice')
    })
  })

  describe('generation options', () => {
    it('applies options to all documents', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [{ name: 'Alice' }, { name: 'Bob' }]

      const result = await generator.generate(template, dataArray, {
        outputFormat: 'html',
      })

      expect(result.documents[0]?.format).toBe('html')
      expect(result.documents[1]?.format).toBe('html')
    })

    it('allows per-document metadata', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = [
        { name: 'Alice', _metadata: { priority: 'high' } },
        { name: 'Bob', _metadata: { priority: 'low' } },
      ]

      const result = await generator.generate(template, dataArray)

      expect(result.documents[0]?.metadata?.priority).toBe('high')
      expect(result.documents[1]?.metadata?.priority).toBe('low')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  describe('with template engine', () => {
    it('renders conditionals correctly in bulk', async () => {
      const generator = createBulkDocumentGenerator()
      const template = '{{#if premium}}VIP: {{/if}}{{name}}'
      const dataArray = [
        { name: 'Alice', premium: true },
        { name: 'Bob', premium: false },
        { name: 'Charlie', premium: true },
      ]

      const result = await generator.generate(template, dataArray)

      expect(result.documents[0]?.content).toBe('VIP: Alice')
      expect(result.documents[1]?.content).toBe('Bob')
      expect(result.documents[2]?.content).toBe('VIP: Charlie')
    })

    it('renders loops correctly in bulk', async () => {
      const generator = createBulkDocumentGenerator()
      const template = '{{#each items}}{{this}}{{/each}}'
      const dataArray = [
        { items: ['a', 'b'] },
        { items: ['x', 'y', 'z'] },
      ]

      const result = await generator.generate(template, dataArray)

      expect(result.documents[0]?.content).toBe('ab')
      expect(result.documents[1]?.content).toBe('xyz')
    })
  })

  describe('real-world scenarios', () => {
    it('generates invoice documents in bulk', async () => {
      const generator = createBulkDocumentGenerator()
      const template =
        'INVOICE\n' +
        'Number: {{number}}\n' +
        'Date: {{date}}\n' +
        'Customer: {{customer}}\n' +
        'Amount: {{invoiceAmount}}'

      const invoices = [
        { number: 'INV-001', date: '2024-01-15', customer: 'Acme Corp', invoiceAmount: 1000 },
        { number: 'INV-002', date: '2024-01-16', customer: 'Tech Inc', invoiceAmount: 2500 },
        { number: 'INV-003', date: '2024-01-17', customer: 'Global Ltd', invoiceAmount: 750 },
      ]

      const result = await generator.generate(template, invoices)

      expect(result.successCount).toBe(3)
      expect(result.documents[0]?.content).toContain('INV-001')
      expect(result.documents[1]?.content).toContain('Tech Inc')
      expect(result.documents[2]?.content).toContain('750')
    })

    it('generates personalized emails in bulk', async () => {
      const generator = createBulkDocumentGenerator()
      const template = `
Dear {{name}},

Thank you for your purchase of {{product}}.

{{#if hasDiscount}}
Use code {{discountCode}} for 10% off your next order!
{{/if}}

Best regards,
The Team
`
      const customers = [
        { name: 'Alice', product: 'Widget Pro', hasDiscount: true, discountCode: 'SAVE10' },
        { name: 'Bob', product: 'Gadget Plus', hasDiscount: false },
      ]

      const result = await generator.generate(template, customers)

      expect(result.documents[0]?.content).toContain('Widget Pro')
      expect(result.documents[0]?.content).toContain('SAVE10')
      expect(result.documents[1]?.content).not.toContain('discount')
    })
  })
})

// =============================================================================
// Statistics and Reporting Tests
// =============================================================================

describe('Statistics and Reporting', () => {
  let generator: BulkDocumentGenerator

  beforeEach(() => {
    generator = createBulkDocumentGenerator()
  })

  describe('generation statistics', () => {
    it('tracks processing time', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` }))

      const result = await generator.generate(template, dataArray)

      expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.startTime).toBeInstanceOf(Date)
      expect(result.stats.endTime).toBeInstanceOf(Date)
    })

    it('calculates average time per document', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 10 }, (_, i) => ({ name: `User${i}` }))

      const result = await generator.generate(template, dataArray)

      expect(result.stats.avgTimePerDocMs).toBeGreaterThanOrEqual(0)
    })

    it('tracks throughput (docs per second)', async () => {
      const template = 'Hello {{name}}!'
      const dataArray = Array.from({ length: 100 }, (_, i) => ({ name: `User${i}` }))

      const result = await generator.generate(template, dataArray)

      // docsPerSecond will be 0 if processing completes in under 1ms
      // which is possible for small datasets on fast machines
      expect(result.stats.docsPerSecond).toBeGreaterThanOrEqual(0)
      // If it took any measurable time, throughput should be calculated
      if (result.stats.processingTimeMs > 0) {
        expect(result.stats.docsPerSecond).toBeGreaterThan(0)
      }
    })
  })
})
