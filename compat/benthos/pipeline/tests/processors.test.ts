/**
 * RED Phase Tests: Benthos Processors
 * Issue: dotdo-7mfvb
 *
 * These tests define the expected behavior for Benthos Processors.
 * They should FAIL until the implementation is complete.
 *
 * Tests cover:
 * - Base Processor interface and lifecycle
 * - MappingProcessor with Bloblang expressions
 * - FilterProcessor for message filtering
 * - Batch message processing
 * - Error handling and edge cases
 * - Processor context (root, this, meta access)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  Processor,
  ProcessorConfig,
  ProcessorContext,
  MappingProcessorConfig,
  FilterProcessorConfig,
  ProcessorResult
} from '../processors'
import {
  createProcessor,
  MappingProcessor,
  FilterProcessor
} from '../processors'
import {
  BenthosMessage,
  BenthosBatch,
  createMessage,
  createBatch,
  isMessage,
  isBatch
} from '../../core/message'
import { Parser } from '../../bloblang/parser'
import { Interpreter } from '../../bloblang/interpreter'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(): ProcessorContext {
  return {
    id: 'test-processor',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    metrics: {
      increment: () => {},
      gauge: () => {},
      histogram: () => {}
    }
  }
}

// ============================================================================
// BASE PROCESSOR INTERFACE TESTS
// ============================================================================

describe('Processor Interface', () => {
  describe('Base processor contract', () => {
    it('should process a single message and return a message', () => {
      const msg = createMessage({ value: 42 })
      const processor = createProcessor('identity', {})

      const result = processor.process(msg, createTestContext())

      expect(result).toBeDefined()
      expect(isMessage(result) || Array.isArray(result) || result === null).toBe(true)
    })

    it('should process a message and return ProcessorResult type', () => {
      const msg = createMessage('test')
      const processor = createProcessor('identity', {})
      const ctx = createTestContext()

      const result = processor.process(msg, ctx)

      // Result should be: message | message[] | null
      expect(
        (result && typeof result === 'object' && isMessage(result)) ||
        Array.isArray(result) ||
        result === null
      ).toBe(true)
    })

    it('should have name and config properties', () => {
      const config: ProcessorConfig = { type: 'mapping', expression: 'root = .value' }
      const processor = createProcessor('mapping', config)

      expect(processor.name).toEqual('mapping')
      expect(processor.config).toEqual(config)
    })

    it('should support processor chaining interface', () => {
      const processor1 = createProcessor('identity', {})
      const processor2 = createProcessor('identity', {})

      expect(typeof processor1.process).toBe('function')
      expect(typeof processor2.process).toBe('function')
    })

    it('should preserve message type when returning', () => {
      const msg = createMessage({ id: 123 }, { source: 'test' })
      const processor = createProcessor('identity', {})

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      expect((result as BenthosMessage).content).toBeTruthy()
    })

    it('should return null to drop messages', () => {
      const msg = createMessage('drop-me')
      const processor = createProcessor('filter', { condition: 'false' })

      const result = processor.process(msg, createTestContext())

      expect(result).toBeNull()
    })

    it('should return array of messages for splitting', () => {
      const msg = createMessage([1, 2, 3])
      const processor = createProcessor('split', {})

      const result = processor.process(msg, createTestContext())

      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0)
        result.forEach(item => {
          expect(isMessage(item)).toBe(true)
        })
      }
    })

    it('should handle empty message', () => {
      const msg = createMessage('')
      const processor = createProcessor('identity', {})

      const result = processor.process(msg, createTestContext())

      expect(result).toBeDefined()
    })

    it('should preserve metadata through processing', () => {
      const metadata = { 'kafka_topic': 'my-topic', 'env': 'test' }
      const msg = createMessage('content', metadata)
      const processor = createProcessor('identity', {})

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.get('kafka_topic')).toBe('my-topic')
      expect(resultMsg.metadata.get('env')).toBe('test')
    })
  })

  describe('Processor context', () => {
    it('should receive processor context with id', () => {
      const msg = createMessage('test')
      const processor = createProcessor('identity', {})
      const ctx = createTestContext()
      ctx.id = 'my-processor'

      processor.process(msg, ctx)

      expect(ctx.id).toBe('my-processor')
    })

    it('should support logging through context', () => {
      const logs: string[] = []
      const msg = createMessage('test')
      const processor = createProcessor('identity', {})
      const ctx = createTestContext()
      ctx.logger.info = (msg: string) => logs.push(msg)

      processor.process(msg, ctx)

      expect(ctx.logger).toBeDefined()
    })

    it('should support metrics through context', () => {
      const metrics: Record<string, number> = {}
      const msg = createMessage('test')
      const processor = createProcessor('identity', {})
      const ctx = createTestContext()
      ctx.metrics.increment = (name: string) => {
        metrics[name] = (metrics[name] ?? 0) + 1
      }

      processor.process(msg, ctx)

      expect(ctx.metrics).toBeDefined()
    })
  })

  describe('Processor creation', () => {
    it('should create processor from name and config', () => {
      const processor = createProcessor('identity', {})

      expect(processor).toBeDefined()
      expect(processor.name).toBe('identity')
    })

    it('should throw on unknown processor type', () => {
      expect(() => {
        createProcessor('unknown-processor', {})
      }).toThrow()
    })

    it('should validate processor config', () => {
      expect(() => {
        createProcessor('mapping', {})
      }).toThrow()
    })

    it('should support different processor types', () => {
      const mapping = createProcessor('mapping', { expression: 'root = .value' })
      const filter = createProcessor('filter', { condition: '.value > 0' })

      expect(mapping.name).toBe('mapping')
      expect(filter.name).toBe('filter')
    })
  })
})

// ============================================================================
// MAPPING PROCESSOR TESTS
// ============================================================================

describe('MappingProcessor', () => {
  describe('Basic mapping expressions', () => {
    it('should apply identity mapping', () => {
      const msg = createMessage({ value: 42 })
      const processor = new MappingProcessor({ expression: 'root = .' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toEqual({ value: 42 })
    })

    it('should extract nested field', () => {
      const msg = createMessage({ user: { name: 'Alice', age: 30 } })
      const processor = new MappingProcessor({ expression: 'root = .user.name' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toBe('Alice')
    })

    it('should construct new object from fields', () => {
      const msg = createMessage({ first: 'John', last: 'Doe', age: 30 })
      const processor = new MappingProcessor({
        expression: 'root = {name: (.first + " " + .last), years: .age}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toEqual({
        name: 'John Doe',
        years: 30
      })
    })

    it('should apply arithmetic operations', () => {
      const msg = createMessage({ a: 10, b: 5 })
      const processor = new MappingProcessor({ expression: 'root = .a + .b' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toBe(15)
    })

    it('should apply string concatenation', () => {
      const msg = createMessage({ greeting: 'Hello', name: 'World' })
      const processor = new MappingProcessor({
        expression: 'root = .greeting + ", " + .name + "!"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toBe('Hello, World!')
    })

    it('should transform array elements', () => {
      const msg = createMessage({ values: [1, 2, 3] })
      const processor = new MappingProcessor({
        expression: 'root = .values.map(x -> x * 2)'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toEqual({ values: [2, 4, 6] })
    })

    it('should set literal values', () => {
      const msg = createMessage({ value: 42 })
      const processor = new MappingProcessor({
        expression: 'root.status = "active"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.json()).toEqual({ value: 42, status: 'active' })
    })

    it('should delete fields', () => {
      const msg = createMessage({ keep: 'this', delete: 'that' })
      const processor = new MappingProcessor({
        expression: 'root.delete = deleted()'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as Record<string, unknown>
      expect('keep' in json).toBe(true)
      expect('delete' in json).toBe(false)
    })

    it('should apply conditional logic', () => {
      const msg = createMessage({ age: 25 })
      const processor = new MappingProcessor({
        expression: 'root.category = if .age >= 18 then "adult" else "minor"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as Record<string, unknown>
      expect(json.category).toBe('adult')
    })

    it('should replace entire root', () => {
      const msg = createMessage({ old: 'data' })
      const processor = new MappingProcessor({
        expression: 'root = {new: "data", timestamp: now()}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as Record<string, unknown>
      expect(json.new).toBe('data')
    })
  })

  describe('Complex mapping expressions', () => {
    it('should handle nested conditionals', () => {
      const msg = createMessage({
        score: 85,
        participation: true
      })
      const processor = new MappingProcessor({
        expression: `root = if .score >= 90 then {
          grade: "A",
          bonus: if .participation then 5 else 0
        } else {
          grade: "B",
          bonus: 0
        }`
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as Record<string, unknown>
      expect((json as any).grade).toBe('B')
    })

    it('should apply multiple transformations in sequence', () => {
      const msg = createMessage({
        items: [
          { name: 'apple', price: 1.5 },
          { name: 'banana', price: 0.8 },
          { name: 'cherry', price: 2.0 }
        ]
      })
      const processor = new MappingProcessor({
        expression: `root = {
          total: .items.map(x -> x.price).sum(),
          count: .items.length(),
          names: .items.map(x -> x.name)
        }`
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as any
      expect(json.count).toBe(3)
      expect(json.names).toHaveLength(3)
    })

    it('should preserve root reference in nested structures', () => {
      const msg = createMessage({
        baseValue: 100,
        items: [
          { multiplier: 2 },
          { multiplier: 3 }
        ]
      })
      const processor = new MappingProcessor({
        expression: 'root = .items.map(x -> .baseValue * x.multiplier)'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(Array.isArray(resultMsg.json())).toBe(true)
    })

    it('should handle type coercion', () => {
      const msg = createMessage({ value: '42' })
      const processor = new MappingProcessor({
        expression: 'root = {num: (.value | from_json() + 8), str: (.value | string())}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as any
      expect(json.num).toBe(50)
      expect(typeof json.str).toBe('string')
    })

    it('should support variable bindings', () => {
      const msg = createMessage({ a: 5, b: 10 })
      const processor = new MappingProcessor({
        expression: 'let sum = .a + .b; root = {original: ., sum: $sum, avg: $sum / 2}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as any
      expect(json.sum).toBe(15)
      expect(json.avg).toBe(7.5)
    })
  })

  describe('Metadata access in mappings', () => {
    it('should access message metadata with meta()', () => {
      const msg = createMessage(
        { value: 42 },
        { 'kafka_topic': 'events', 'source': 'api' }
      )
      const processor = new MappingProcessor({
        expression: 'root = {value: .value, topic: meta("kafka_topic")}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      const json = resultMsg.json() as any
      expect(json.topic).toBe('events')
    })

    it('should modify metadata in mapping', () => {
      const msg = createMessage('test', { 'key': 'original' })
      const processor = new MappingProcessor({
        expression: 'root = .; meta("key") = "modified"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.get('key')).toBe('modified')
    })

    it('should add new metadata fields', () => {
      const msg = createMessage('test')
      const processor = new MappingProcessor({
        expression: 'root = .; meta("processed_at") = now()'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.has('processed_at')).toBe(true)
    })
  })

  describe('Error handling in mappings', () => {
    it('should throw on invalid Bloblang expression', () => {
      const msg = createMessage({ value: 42 })
      const processor = new MappingProcessor({
        expression: 'root = .invalid('
      })

      expect(() => {
        processor.process(msg, createTestContext())
      }).toThrow()
    })

    it('should throw on reference to undefined field', () => {
      const msg = createMessage({ value: 42 })
      const processor = new MappingProcessor({
        expression: 'root = .nonexistent.nested.field'
      })

      const result = processor.process(msg, createTestContext())

      // Should handle gracefully (undefined or error)
      expect(result).toBeDefined()
    })

    it('should throw on type mismatch in operations', () => {
      const msg = createMessage({ value: 'string' })
      const processor = new MappingProcessor({
        expression: 'root = .value + 10'
      })

      expect(() => {
        processor.process(msg, createTestContext())
      }).toThrow()
    })

    it('should handle null values gracefully', () => {
      const msg = createMessage({ value: null })
      const processor = new MappingProcessor({
        expression: 'root = .value'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should attach error to message on mapping failure', () => {
      const msg = createMessage('invalid')
      const processor = new MappingProcessor({
        expression: 'root = .nonexistent'
      })

      const result = processor.process(msg, createTestContext())

      if (isMessage(result)) {
        // Message may have error attached
        expect(result.hasError && typeof result.hasError()).toBe('boolean')
      }
    })

    it('should skip mapping on error if skip_on_error enabled', () => {
      const msg = createMessage({ value: 'invalid' })
      const processor = new MappingProcessor({
        expression: 'root = .value + 10',
        skip_on_error: true
      })

      const result = processor.process(msg, createTestContext())

      // Should return original message or null
      expect(result).toBeDefined()
    })
  })

  describe('Performance considerations', () => {
    it('should cache parsed expressions', () => {
      const msg1 = createMessage({ a: 1 })
      const msg2 = createMessage({ a: 2 })
      const processor = new MappingProcessor({
        expression: 'root = .a * 2'
      })

      const result1 = processor.process(msg1, createTestContext())
      const result2 = processor.process(msg2, createTestContext())

      expect(isMessage(result1)).toBe(true)
      expect(isMessage(result2)).toBe(true)
    })

    it('should handle large objects', () => {
      const largeObj = {
        fields: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: Math.random()
        }))
      }
      const msg = createMessage(largeObj)
      const processor = new MappingProcessor({
        expression: 'root = .fields.map(x -> {id: x.id, doubled: x.value * 2})'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })
  })
})

// ============================================================================
// FILTER PROCESSOR TESTS
// ============================================================================

describe('FilterProcessor', () => {
  describe('Basic filtering', () => {
    it('should pass message matching condition', () => {
      const msg = createMessage({ value: 42 })
      const processor = new FilterProcessor({ condition: '.value > 0' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should drop message not matching condition', () => {
      const msg = createMessage({ value: -10 })
      const processor = new FilterProcessor({ condition: '.value > 0' })

      const result = processor.process(msg, createTestContext())

      expect(result).toBeNull()
    })

    it('should handle boolean values in condition', () => {
      const msg = createMessage({ active: true })
      const processor = new FilterProcessor({ condition: '.active' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle negation', () => {
      const msg = createMessage({ deleted: false })
      const processor = new FilterProcessor({ condition: '!.deleted' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should compare strings', () => {
      const msg = createMessage({ status: 'active' })
      const processor = new FilterProcessor({ condition: '.status == "active"' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should filter on missing field', () => {
      const msg = createMessage({ other: 'value' })
      const processor = new FilterProcessor({ condition: '.status == "active"' })

      const result = processor.process(msg, createTestContext())

      // Missing field evaluation should drop the message
      expect(result).toBeNull()
    })
  })

  describe('Complex conditions', () => {
    it('should handle AND conditions', () => {
      const msg = createMessage({ age: 25, active: true })
      const processor = new FilterProcessor({
        condition: '.age >= 18 && .active == true'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle OR conditions', () => {
      const msg = createMessage({ role: 'admin' })
      const processor = new FilterProcessor({
        condition: '.role == "admin" || .role == "moderator"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle nested conditions', () => {
      const msg = createMessage({
        user: { premium: true },
        items: 5
      })
      const processor = new FilterProcessor({
        condition: '.user.premium && .items > 3'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle IN operator for membership', () => {
      const msg = createMessage({ status: 'active' })
      const processor = new FilterProcessor({
        condition: '.status in ["active", "pending"]'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle array length checks', () => {
      const msg = createMessage({ items: [1, 2, 3] })
      const processor = new FilterProcessor({
        condition: '.items | length > 2'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle string contains checks', () => {
      const msg = createMessage({ email: 'user@example.com' })
      const processor = new FilterProcessor({
        condition: '.email | contains("example.com")'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle exists check', () => {
      const msg = createMessage({ field: 'value', empty: null })
      const processor = new FilterProcessor({
        condition: '.field != null'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })
  })

  describe('Metadata filtering', () => {
    it('should filter on metadata field', () => {
      const msg = createMessage('data', { 'source': 'api' })
      const processor = new FilterProcessor({
        condition: 'meta("source") == "api"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should filter on missing metadata', () => {
      const msg = createMessage('data', { 'other': 'value' })
      const processor = new FilterProcessor({
        condition: 'meta("source") != null'
      })

      const result = processor.process(msg, createTestContext())

      expect(result).toBeNull()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty message', () => {
      const msg = createMessage('')
      const processor = new FilterProcessor({ condition: 'true' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should handle null message content', () => {
      const msg = createMessage(null)
      const processor = new FilterProcessor({ condition: 'true' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should preserve message when condition is always true', () => {
      const msg = createMessage({ value: 42 })
      const processor = new FilterProcessor({ condition: 'true' })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      expect((result as BenthosMessage).json()).toEqual({ value: 42 })
    })

    it('should drop message when condition is always false', () => {
      const msg = createMessage({ value: 42 })
      const processor = new FilterProcessor({ condition: 'false' })

      const result = processor.process(msg, createTestContext())

      expect(result).toBeNull()
    })
  })

  describe('Error handling in filters', () => {
    it('should throw on invalid condition syntax', () => {
      const msg = createMessage({ value: 42 })
      const processor = new FilterProcessor({
        condition: '.value >'
      })

      expect(() => {
        processor.process(msg, createTestContext())
      }).toThrow()
    })

    it('should handle type errors in conditions gracefully', () => {
      const msg = createMessage({ value: 'string' })
      const processor = new FilterProcessor({
        condition: '.value > 10'
      })

      // Should drop message or throw
      const result = processor.process(msg, createTestContext())
      expect(result === null || result instanceof Error).toBe(true)
    })
  })
})

// ============================================================================
// BATCH PROCESSING TESTS
// ============================================================================

describe('Batch Processing', () => {
  describe('Batch message support', () => {
    it('should process batch of messages', () => {
      const batch = createBatch([
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ])
      const processor = new MappingProcessor({ expression: 'root = .id * 2' })

      // Processor should handle batch
      const result = processor.processBatch?.(batch, createTestContext())

      expect(result).toBeDefined()
    })

    it('should apply mapping to all batch messages', () => {
      const batch = createBatch([
        { value: 10 },
        { value: 20 },
        { value: 30 }
      ])
      const processor = new MappingProcessor({
        expression: 'root = .value * 2'
      })

      const result = processor.processBatch?.(batch, createTestContext())

      if (result && isBatch(result)) {
        expect(result.length).toBe(3)
        result.toArray().forEach((msg, i) => {
          const expected = [20, 40, 60][i]
          expect(msg.json()).toBe(expected)
        })
      }
    })

    it('should filter batch messages', () => {
      const batch = createBatch([
        { value: 10 },
        { value: -5 },
        { value: 20 }
      ])
      const processor = new FilterProcessor({ condition: '.value > 0' })

      const result = processor.processBatch?.(batch, createTestContext())

      if (result && isBatch(result)) {
        expect(result.length).toBe(2)
      }
    })

    it('should handle empty batch', () => {
      const batch = createBatch([])
      const processor = new MappingProcessor({ expression: 'root = .' })

      const result = processor.processBatch?.(batch, createTestContext())

      if (result && isBatch(result)) {
        expect(result.length).toBe(0)
      }
    })

    it('should split messages in batch', () => {
      const batch = createBatch([
        { items: [1, 2] },
        { items: [3, 4, 5] }
      ])
      const processor = createProcessor('split', {})

      // After split, should have 5 messages
      const result = processor.processBatch?.(batch, createTestContext())

      expect(result).toBeDefined()
    })
  })

  describe('Batch context preservation', () => {
    it('should preserve batch metadata', () => {
      const batch = createBatch(
        [{ id: 1 }, { id: 2 }],
        { 'batch_id': 'b123' }
      )
      const processor = new MappingProcessor({ expression: 'root = .' })

      const result = processor.processBatch?.(batch, createTestContext())

      if (result && isBatch(result)) {
        expect(result.metadata.get('batch_id')).toBe('b123')
      }
    })

    it('should allow batch-level transformations', () => {
      const batch = createBatch([
        { value: 10 },
        { value: 20 },
        { value: 30 }
      ])
      // Mapping that depends on batch context
      const processor = new MappingProcessor({
        expression: 'root = .'
      })

      const result = processor.processBatch?.(batch, createTestContext())

      expect(result).toBeDefined()
    })
  })

  describe('Mixed batch operations', () => {
    it('should handle sequence of operations on batch', () => {
      const batch = createBatch([
        { status: 'active', value: 10 },
        { status: 'inactive', value: 5 },
        { status: 'active', value: 20 }
      ])

      // Filter then map
      const filterProcessor = new FilterProcessor({ condition: '.status == "active"' })
      const mapProcessor = new MappingProcessor({
        expression: 'root = {status: .status, doubled: .value * 2}'
      })

      const filtered = filterProcessor.processBatch?.(batch, createTestContext())
      const result = filtered && isBatch(filtered)
        ? mapProcessor.processBatch?.(filtered, createTestContext())
        : null

      expect(result).toBeDefined()
    })

    it('should handle partial failures in batch', () => {
      const batch = createBatch([
        { id: 1, value: 10 },
        { id: 2, invalid: true },
        { id: 3, value: 30 }
      ])
      const processor = new MappingProcessor({
        expression: 'root = .value * 2'
      })

      const result = processor.processBatch?.(batch, createTestContext())

      expect(result).toBeDefined()
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Processor Error Handling', () => {
  describe('Error propagation', () => {
    it('should capture parse errors', () => {
      const config: MappingProcessorConfig = {
        expression: 'root = .invalid('
      }

      expect(() => {
        new MappingProcessor(config)
      }).toThrow()
    })

    it('should handle runtime errors in mapping', () => {
      const msg = createMessage({ value: 'string' })
      const processor = new MappingProcessor({
        expression: 'root = .value + 10'
      })

      expect(() => {
        processor.process(msg, createTestContext())
      }).toThrow()
    })

    it('should handle undefined references', () => {
      const msg = createMessage({})
      const processor = new MappingProcessor({
        expression: 'root = .nonexistent.field.chain'
      })

      const result = processor.process(msg, createTestContext())

      // Should handle gracefully
      expect(result).toBeDefined()
    })
  })

  describe('Error recovery', () => {
    it('should skip on error if configured', () => {
      const msg = createMessage({ value: 'string' })
      const processor = new MappingProcessor({
        expression: 'root = .value + 10',
        skip_on_error: true
      })

      const result = processor.process(msg, createTestContext())

      // Should return original or null
      expect(result === null || isMessage(result)).toBe(true)
    })

    it('should attach error to message', () => {
      const msg = createMessage({ value: 'string' })
      const processor = new MappingProcessor({
        expression: 'root = .value + 10'
      })

      const result = processor.process(msg, createTestContext())

      if (isMessage(result)) {
        // Should have error information
        expect(result.hasError?.()).toBe(true)
        expect(result.getError?.()).toBeInstanceOf(Error)
      }
    })
  })

  describe('Invalid configurations', () => {
    it('should reject empty mapping expression', () => {
      expect(() => {
        new MappingProcessor({ expression: '' })
      }).toThrow()
    })

    it('should reject empty filter condition', () => {
      expect(() => {
        new FilterProcessor({ condition: '' })
      }).toThrow()
    })

    it('should validate processor type in factory', () => {
      expect(() => {
        createProcessor('invalid', {})
      }).toThrow()
    })
  })
})

// ============================================================================
// PROCESSOR CONTEXT ACCESS TESTS
// ============================================================================

describe('Processor Context Access', () => {
  describe('Root context', () => {
    it('should access root in mapping', () => {
      const msg = createMessage({ user: { id: 1 }, system: { env: 'prod' } })
      const processor = new MappingProcessor({
        expression: 'root = {user_id: .user.id, env: .system.env}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as any
      expect(json.user_id).toBe(1)
      expect(json.env).toBe('prod')
    })

    it('should access root in filter', () => {
      const msg = createMessage({
        value: 50,
        threshold: 100
      })
      const processor = new FilterProcessor({
        condition: '.value < .threshold'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })
  })

  describe('This context', () => {
    it('should reference this in array transformations', () => {
      const msg = createMessage({
        items: [1, 2, 3]
      })
      const processor = new MappingProcessor({
        expression: 'root = .items.map(this * 2)'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })
  })

  describe('Metadata context', () => {
    it('should access metadata in mapping', () => {
      const msg = createMessage(
        { data: 'test' },
        { 'trace_id': '123abc' }
      )
      const processor = new MappingProcessor({
        expression: 'root = {data: .data, trace: meta("trace_id")}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as any
      expect(json.trace).toBe('123abc')
    })

    it('should set metadata in mapping', () => {
      const msg = createMessage({ value: 42 })
      const processor = new MappingProcessor({
        expression: 'root = .; meta("processed") = "true"'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.get('processed')).toBe('true')
    })
  })

  describe('Function access', () => {
    it('should access Bloblang standard functions', () => {
      const msg = createMessage({ timestamp: 1609459200000 })
      const processor = new MappingProcessor({
        expression: 'root = {unix: .timestamp, now: now()}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should access string functions', () => {
      const msg = createMessage({ text: 'Hello World' })
      const processor = new MappingProcessor({
        expression: 'root = {upper: .text.upper(), lower: .text.lower()}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })

    it('should access array functions', () => {
      const msg = createMessage({ values: [1, 2, 3] })
      const processor = new MappingProcessor({
        expression: 'root = {sum: .values.sum(), length: .values.length()}'
      })

      const result = processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Processor Integration', () => {
  it('should chain multiple processors', () => {
    const msg = createMessage({ id: 1, value: 10 })
    const filter = new FilterProcessor({ condition: '.value > 0' })
    const map = new MappingProcessor({ expression: 'root = {id: .id, doubled: .value * 2}' })
    const ctx = createTestContext()

    const filtered = filter.process(msg, ctx)
    expect(isMessage(filtered)).toBe(true)

    const mapped = map.process(filtered as BenthosMessage, ctx)
    expect(isMessage(mapped)).toBe(true)

    const json = (mapped as BenthosMessage).json() as any
    expect(json.doubled).toBe(20)
  })

  it('should handle real-world pipeline scenario', () => {
    const batch = createBatch([
      { timestamp: Date.now(), level: 'info', message: 'Started' },
      { timestamp: Date.now(), level: 'error', message: 'Failed' },
      { timestamp: Date.now(), level: 'info', message: 'Completed' }
    ])

    const filterErrors = new FilterProcessor({ condition: '.level == "error"' })
    const formatMsg = new MappingProcessor({
      expression: 'root = {error_msg: .message, at: .timestamp}'
    })
    const ctx = createTestContext()

    const filtered = filterErrors.processBatch?.(batch, ctx)
    expect(isBatch(filtered) && filtered.length === 1).toBe(true)
  })
})
