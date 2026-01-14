/**
 * RED Phase Tests: Processors
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for message processors (mapping, filter, split, etc.)
 */

import { describe, it, expect } from 'vitest'
import {
  MappingProcessor,
  FilterProcessor,
  createProcessor,
  createMessage,
  createBatch,
  type ProcessorContext,
  type BenthosMessage,
} from '../src'

/**
 * Create a minimal processor context for testing
 */
function createContext(): ProcessorContext {
  return {
    id: 'test',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    metrics: {
      increment: () => {},
      gauge: () => {},
      histogram: () => {},
    },
  }
}

describe('MappingProcessor', () => {
  const ctx = createContext()

  describe('construction', () => {
    it('should create with valid expression', () => {
      const proc = new MappingProcessor({ expression: 'root.value' })
      expect(proc.name).toBe('mapping')
    })

    it('should throw on empty expression', () => {
      expect(() => new MappingProcessor({ expression: '' })).toThrow()
    })

    it('should throw on invalid expression', () => {
      expect(() => new MappingProcessor({ expression: 'root.value +' })).toThrow()
    })
  })

  describe('simple mappings', () => {
    it('should extract field', () => {
      const proc = new MappingProcessor({ expression: 'root.name' })
      const msg = createMessage({ name: 'Alice', age: 30 })
      const result = proc.process(msg, ctx)

      expect(result).not.toBeNull()
      expect((result as BenthosMessage).json()).toBe('Alice')
    })

    it('should transform with arithmetic', () => {
      const proc = new MappingProcessor({ expression: 'root.value * 2' })
      const msg = createMessage({ value: 5 })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toBe(10)
    })

    it('should apply string methods', () => {
      const proc = new MappingProcessor({ expression: 'root.text.uppercase()' })
      const msg = createMessage({ text: 'hello' })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toBe('HELLO')
    })
  })

  describe('assignment mappings', () => {
    it('should assign to root', () => {
      const proc = new MappingProcessor({ expression: 'root = "new value"' })
      const msg = createMessage({ old: 'data' })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toBe('new value')
    })

    it('should assign to field', () => {
      const proc = new MappingProcessor({ expression: 'root.newField = "added"' })
      const msg = createMessage({ existing: 'value' })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toEqual({ existing: 'value', newField: 'added' })
    })

    it('should delete field with deleted()', () => {
      const proc = new MappingProcessor({ expression: 'root.remove = deleted()' })
      const msg = createMessage({ keep: 'yes', remove: 'no' })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toEqual({ keep: 'yes' })
    })
  })

  describe('metadata mappings', () => {
    it('should read metadata with meta()', () => {
      const proc = new MappingProcessor({ expression: 'meta("source")' })
      const msg = createMessage({ data: 'test' }, { source: 'api' })
      const result = proc.process(msg, ctx)

      expect((result as BenthosMessage).json()).toBe('api')
    })
  })

  describe('error handling', () => {
    it('should propagate error by default', () => {
      const proc = new MappingProcessor({ expression: 'root.missing.nested.field' })
      const msg = createMessage({ data: 'test' })

      // Should not throw, returns message with undefined/null path result
      const result = proc.process(msg, ctx)
      expect(result).not.toBeNull()
    })

    it('should skip on error when configured', () => {
      const proc = new MappingProcessor({
        expression: 'throw("error")',
        skip_on_error: true
      })
      const msg = createMessage({ data: 'test' })
      const result = proc.process(msg, ctx)

      expect(result).toBeNull()
    })
  })

  describe('batch processing', () => {
    it('should process batch', () => {
      const proc = new MappingProcessor({ expression: 'root.value * 2' })
      const batch = createBatch([{ value: 1 }, { value: 2 }, { value: 3 }])
      const result = proc.processBatch(batch, ctx)

      expect(result).not.toBeNull()
      expect(result!.length).toBe(3)
      const values = [...result!].map(m => m.json())
      expect(values).toEqual([2, 4, 6])
    })
  })
})

describe('FilterProcessor', () => {
  const ctx = createContext()

  describe('construction', () => {
    it('should create with valid condition', () => {
      const proc = new FilterProcessor({ condition: 'root.value > 10' })
      expect(proc.name).toBe('filter')
    })

    it('should throw on empty condition', () => {
      expect(() => new FilterProcessor({ condition: '' })).toThrow()
    })
  })

  describe('filtering', () => {
    it('should pass truthy messages', () => {
      const proc = new FilterProcessor({ condition: 'root.active' })
      const msg = createMessage({ active: true })
      const result = proc.process(msg, ctx)

      expect(result).not.toBeNull()
    })

    it('should drop falsy messages', () => {
      const proc = new FilterProcessor({ condition: 'root.active' })
      const msg = createMessage({ active: false })
      const result = proc.process(msg, ctx)

      expect(result).toBeNull()
    })

    it('should filter by comparison', () => {
      const proc = new FilterProcessor({ condition: 'root.score >= 50' })

      const pass = createMessage({ score: 75 })
      const fail = createMessage({ score: 25 })

      expect(proc.process(pass, ctx)).not.toBeNull()
      expect(proc.process(fail, ctx)).toBeNull()
    })

    it('should filter by string contains', () => {
      const proc = new FilterProcessor({ condition: 'root.text.contains("error")' })

      const pass = createMessage({ text: 'An error occurred' })
      const fail = createMessage({ text: 'All good' })

      expect(proc.process(pass, ctx)).not.toBeNull()
      expect(proc.process(fail, ctx)).toBeNull()
    })

    it('should filter with logical operators', () => {
      const proc = new FilterProcessor({ condition: 'root.a && root.b' })

      expect(proc.process(createMessage({ a: true, b: true }), ctx)).not.toBeNull()
      expect(proc.process(createMessage({ a: true, b: false }), ctx)).toBeNull()
      expect(proc.process(createMessage({ a: false, b: true }), ctx)).toBeNull()
    })
  })

  describe('batch filtering', () => {
    it('should filter batch', () => {
      const proc = new FilterProcessor({ condition: 'root.keep' })
      const batch = createBatch([
        { keep: true },
        { keep: false },
        { keep: true }
      ])
      const result = proc.processBatch(batch, ctx)

      expect(result).not.toBeNull()
      expect(result!.length).toBe(2)
    })
  })
})

describe('createProcessor factory', () => {
  it('should create identity processor', () => {
    const proc = createProcessor('identity', {})
    const ctx = createContext()
    const msg = createMessage({ data: 'test' })
    const result = proc.process(msg, ctx)

    expect(result).toBe(msg)
  })

  it('should create mapping processor', () => {
    const proc = createProcessor('mapping', { expression: 'root.value' })
    expect(proc.name).toBe('mapping')
  })

  it('should create filter processor', () => {
    const proc = createProcessor('filter', { condition: 'true' })
    expect(proc.name).toBe('filter')
  })

  it('should create split processor', () => {
    const proc = createProcessor('split', {})
    expect(proc.name).toBe('split')
  })

  it('should throw for unknown processor type', () => {
    expect(() => createProcessor('unknown', {})).toThrow()
  })

  it('should throw for mapping without expression', () => {
    expect(() => createProcessor('mapping', {})).toThrow()
  })

  it('should throw for filter without condition', () => {
    expect(() => createProcessor('filter', {})).toThrow()
  })
})

describe('SplitProcessor', () => {
  const ctx = createContext()

  it('should split array into messages', () => {
    const proc = createProcessor('split', {})
    const msg = createMessage([1, 2, 3])
    const result = proc.process(msg, ctx)

    expect(Array.isArray(result)).toBe(true)
    expect((result as BenthosMessage[]).length).toBe(3)
    expect((result as BenthosMessage[])[0].json()).toBe(1)
    expect((result as BenthosMessage[])[1].json()).toBe(2)
    expect((result as BenthosMessage[])[2].json()).toBe(3)
  })

  it('should split items field', () => {
    const proc = createProcessor('split', {})
    const msg = createMessage({ items: ['a', 'b'] })
    const result = proc.process(msg, ctx)

    expect(Array.isArray(result)).toBe(true)
    expect((result as BenthosMessage[]).length).toBe(2)
  })

  it('should return single-item array for non-array', () => {
    const proc = createProcessor('split', {})
    const msg = createMessage({ single: 'value' })
    const result = proc.process(msg, ctx)

    expect(Array.isArray(result)).toBe(true)
    expect((result as BenthosMessage[]).length).toBe(1)
  })

  it('should preserve metadata on split', () => {
    const proc = createProcessor('split', {})
    const msg = createMessage([1, 2], { source: 'test' })
    const result = proc.process(msg, ctx) as BenthosMessage[]

    expect(result[0].metadata.get('source')).toBe('test')
    expect(result[1].metadata.get('source')).toBe('test')
  })
})
