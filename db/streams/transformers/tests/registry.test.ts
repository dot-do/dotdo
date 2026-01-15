/**
 * Transformer Registry Tests
 *
 * Tests for the centralized transformer registry.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  TransformerRegistry,
  registry,
  TRANSFORMER_NAMES,
  type TransformerFn,
  type TransformerMeta,
} from '../registry'
import type { UnifiedEvent } from '../../../../types/unified-event'
import { createUnifiedEvent } from '../../../../types/unified-event'

describe('TransformerRegistry', () => {
  let testRegistry: TransformerRegistry

  beforeEach(() => {
    testRegistry = new TransformerRegistry()
  })

  // Helper to create a simple transformer
  const createTestTransformer = (prefix: string): TransformerFn => {
    return (input: unknown) =>
      createUnifiedEvent({
        id: `${prefix}-${Date.now()}`,
        event_type: 'track',
        event_name: `${prefix}.test`,
        ns: 'test',
        data: input as Record<string, unknown>,
      })
  }

  // Helper to create transformer metadata
  const createTestMeta = (name: string): TransformerMeta => ({
    name,
    description: `Test transformer for ${name}`,
    source: 'test',
    eventType: 'track',
    multipleOutputs: false,
  })

  describe('register', () => {
    it('registers a transformer successfully', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)

      expect(testRegistry.has('test')).toBe(true)
    })

    it('throws error when registering duplicate name', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)

      expect(() => {
        testRegistry.register('test', fn, meta)
      }).toThrow("Transformer 'test' is already registered")
    })
  })

  describe('unregister', () => {
    it('removes a registered transformer', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)
      expect(testRegistry.has('test')).toBe(true)

      const result = testRegistry.unregister('test')

      expect(result).toBe(true)
      expect(testRegistry.has('test')).toBe(false)
    })

    it('returns false for non-existent transformer', () => {
      const result = testRegistry.unregister('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('has', () => {
    it('returns true for registered transformer', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)

      expect(testRegistry.has('test')).toBe(true)
    })

    it('returns false for non-existent transformer', () => {
      expect(testRegistry.has('non-existent')).toBe(false)
    })
  })

  describe('get', () => {
    it('returns registered transformer with metadata', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)
      const result = testRegistry.get('test')

      expect(result).toBeDefined()
      expect(result!.fn).toBe(fn)
      expect(result!.meta).toEqual(meta)
    })

    it('returns undefined for non-existent transformer', () => {
      const result = testRegistry.get('non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('getFunction', () => {
    it('returns just the transformer function', () => {
      const fn = createTestTransformer('test')
      const meta = createTestMeta('Test')

      testRegistry.register('test', fn, meta)
      const result = testRegistry.getFunction('test')

      expect(result).toBe(fn)
    })

    it('returns undefined for non-existent transformer', () => {
      const result = testRegistry.getFunction('non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('list', () => {
    it('returns empty array when no transformers registered', () => {
      expect(testRegistry.list()).toEqual([])
    })

    it('returns all registered transformer names', () => {
      testRegistry.register('alpha', createTestTransformer('alpha'), createTestMeta('Alpha'))
      testRegistry.register('beta', createTestTransformer('beta'), createTestMeta('Beta'))
      testRegistry.register('gamma', createTestTransformer('gamma'), createTestMeta('Gamma'))

      const names = testRegistry.list()

      expect(names).toContain('alpha')
      expect(names).toContain('beta')
      expect(names).toContain('gamma')
      expect(names).toHaveLength(3)
    })
  })

  describe('listWithMeta', () => {
    it('returns names with metadata', () => {
      const metaAlpha = createTestMeta('Alpha')
      const metaBeta = createTestMeta('Beta')

      testRegistry.register('alpha', createTestTransformer('alpha'), metaAlpha)
      testRegistry.register('beta', createTestTransformer('beta'), metaBeta)

      const result = testRegistry.listWithMeta()

      expect(result).toHaveLength(2)
      expect(result).toContainEqual(['alpha', metaAlpha])
      expect(result).toContainEqual(['beta', metaBeta])
    })
  })

  describe('listBySource', () => {
    it('filters transformers by source', () => {
      testRegistry.register('otel-1', createTestTransformer('otel-1'), {
        name: 'OTEL 1',
        description: '',
        source: 'otel',
        eventType: 'trace',
        multipleOutputs: false,
      })
      testRegistry.register('otel-2', createTestTransformer('otel-2'), {
        name: 'OTEL 2',
        description: '',
        source: 'otel',
        eventType: 'log',
        multipleOutputs: false,
      })
      testRegistry.register('segment-1', createTestTransformer('segment-1'), {
        name: 'Segment 1',
        description: '',
        source: 'segment',
        eventType: 'track',
        multipleOutputs: false,
      })

      const otelTransformers = testRegistry.listBySource('otel')
      const segmentTransformers = testRegistry.listBySource('segment')

      expect(otelTransformers).toEqual(['otel-1', 'otel-2'])
      expect(segmentTransformers).toEqual(['segment-1'])
    })

    it('returns empty array for unknown source', () => {
      testRegistry.register('test', createTestTransformer('test'), createTestMeta('Test'))

      const result = testRegistry.listBySource('unknown')

      expect(result).toEqual([])
    })
  })

  describe('listByEventType', () => {
    it('filters transformers by event type', () => {
      testRegistry.register('trace-1', createTestTransformer('trace-1'), {
        name: 'Trace 1',
        description: '',
        source: 'otel',
        eventType: 'trace',
        multipleOutputs: false,
      })
      testRegistry.register('track-1', createTestTransformer('track-1'), {
        name: 'Track 1',
        description: '',
        source: 'segment',
        eventType: 'track',
        multipleOutputs: false,
      })
      testRegistry.register('track-2', createTestTransformer('track-2'), {
        name: 'Track 2',
        description: '',
        source: 'custom',
        eventType: 'track',
        multipleOutputs: false,
      })

      const traceTransformers = testRegistry.listByEventType('trace')
      const trackTransformers = testRegistry.listByEventType('track')

      expect(traceTransformers).toEqual(['trace-1'])
      expect(trackTransformers).toEqual(['track-1', 'track-2'])
    })
  })

  describe('transform', () => {
    it('transforms input using named transformer', () => {
      const fn: TransformerFn = (input) =>
        createUnifiedEvent({
          id: 'test-id',
          event_type: 'track',
          event_name: 'test.event',
          ns: 'test',
          data: input as Record<string, unknown>,
        })

      testRegistry.register('test', fn, createTestMeta('Test'))

      const result = testRegistry.transform('test', { foo: 'bar' })

      expect(result).toBeDefined()
      expect((result as UnifiedEvent).event_name).toBe('test.event')
      expect((result as UnifiedEvent).data).toEqual({ foo: 'bar' })
    })

    it('throws error for unknown transformer', () => {
      expect(() => {
        testRegistry.transform('unknown', {})
      }).toThrow('Unknown transformer: unknown')
    })

    it('passes context to transformer', () => {
      const fn: TransformerFn = (input, ctx) =>
        createUnifiedEvent({
          id: 'test-id',
          event_type: 'track',
          event_name: 'test.event',
          ns: ctx as string,
          data: input as Record<string, unknown>,
        })

      testRegistry.register('test', fn, createTestMeta('Test'))

      const result = testRegistry.transform('test', { foo: 'bar' }, 'custom-ns')

      expect((result as UnifiedEvent).ns).toBe('custom-ns')
    })
  })

  describe('transformToArray', () => {
    it('wraps single event in array', () => {
      const fn: TransformerFn = () =>
        createUnifiedEvent({
          id: 'test-id',
          event_type: 'track',
          event_name: 'test.event',
          ns: 'test',
        })

      testRegistry.register('test', fn, createTestMeta('Test'))

      const result = testRegistry.transformToArray('test', {})

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
    })

    it('returns array unchanged when transformer returns array', () => {
      const fn: TransformerFn = () => [
        createUnifiedEvent({
          id: 'test-1',
          event_type: 'track',
          event_name: 'test.event1',
          ns: 'test',
        }),
        createUnifiedEvent({
          id: 'test-2',
          event_type: 'track',
          event_name: 'test.event2',
          ns: 'test',
        }),
      ]

      testRegistry.register('test', fn, {
        ...createTestMeta('Test'),
        multipleOutputs: true,
      })

      const result = testRegistry.transformToArray('test', {})

      expect(result).toHaveLength(2)
      expect(result[0].event_name).toBe('test.event1')
      expect(result[1].event_name).toBe('test.event2')
    })
  })

  describe('size', () => {
    it('returns 0 for empty registry', () => {
      expect(testRegistry.size).toBe(0)
    })

    it('returns count of registered transformers', () => {
      testRegistry.register('a', createTestTransformer('a'), createTestMeta('A'))
      testRegistry.register('b', createTestTransformer('b'), createTestMeta('B'))
      testRegistry.register('c', createTestTransformer('c'), createTestMeta('C'))

      expect(testRegistry.size).toBe(3)
    })
  })

  describe('clear', () => {
    it('removes all registered transformers', () => {
      testRegistry.register('a', createTestTransformer('a'), createTestMeta('A'))
      testRegistry.register('b', createTestTransformer('b'), createTestMeta('B'))

      expect(testRegistry.size).toBe(2)

      testRegistry.clear()

      expect(testRegistry.size).toBe(0)
      expect(testRegistry.list()).toEqual([])
    })
  })
})

describe('Global registry', () => {
  it('exports a singleton registry instance', () => {
    expect(registry).toBeInstanceOf(TransformerRegistry)
  })

  describe('built-in transformers', () => {
    it('has all expected transformers registered', () => {
      for (const name of TRANSFORMER_NAMES) {
        expect(registry.has(name)).toBe(true)
      }
    })

    it('registers otel-span transformer', () => {
      const transformer = registry.get('otel-span')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('otel')
      expect(transformer!.meta.eventType).toBe('trace')
    })

    it('registers otel-log transformer', () => {
      const transformer = registry.get('otel-log')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('otel')
      expect(transformer!.meta.eventType).toBe('log')
    })

    it('registers otel-metric transformer', () => {
      const transformer = registry.get('otel-metric')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('otel')
      expect(transformer!.meta.eventType).toBe('metric')
      expect(transformer!.meta.multipleOutputs).toBe(true)
    })

    it('registers segment-track transformer', () => {
      const transformer = registry.get('segment-track')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('segment')
      expect(transformer!.meta.eventType).toBe('track')
    })

    it('registers segment-identify transformer', () => {
      const transformer = registry.get('segment-identify')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('segment')
    })

    it('registers segment-page transformer', () => {
      const transformer = registry.get('segment-page')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('segment')
      expect(transformer!.meta.eventType).toBe('page')
    })

    it('registers cdc transformer', () => {
      const transformer = registry.get('cdc')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('cdc')
      expect(transformer!.meta.eventType).toBe('cdc')
    })

    it('registers do-event transformer', () => {
      const transformer = registry.get('do-event')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('durable-object')
    })

    it('registers do-action transformer', () => {
      const transformer = registry.get('do-action')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('durable-object')
    })

    it('registers web-vital transformer', () => {
      const transformer = registry.get('web-vital')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('web-vitals')
      expect(transformer!.meta.eventType).toBe('vital')
    })

    it('registers session-replay transformer', () => {
      const transformer = registry.get('session-replay')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('rrweb')
      expect(transformer!.meta.eventType).toBe('replay')
    })

    it('registers snippet transformer', () => {
      const transformer = registry.get('snippet')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('snippet')
      expect(transformer!.meta.eventType).toBe('snippet')
    })

    it('registers tail transformer', () => {
      const transformer = registry.get('tail')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('workers')
      expect(transformer!.meta.eventType).toBe('tail')
    })

    it('registers epcis transformer', () => {
      const transformer = registry.get('epcis')

      expect(transformer).toBeDefined()
      expect(transformer!.meta.source).toBe('epcis')
      expect(transformer!.meta.eventType).toBe('track')
    })
  })

  describe('TRANSFORMER_NAMES constant', () => {
    it('contains all built-in transformer names', () => {
      expect(TRANSFORMER_NAMES).toContain('otel-span')
      expect(TRANSFORMER_NAMES).toContain('otel-log')
      expect(TRANSFORMER_NAMES).toContain('otel-metric')
      expect(TRANSFORMER_NAMES).toContain('segment-track')
      expect(TRANSFORMER_NAMES).toContain('segment-identify')
      expect(TRANSFORMER_NAMES).toContain('segment-page')
      expect(TRANSFORMER_NAMES).toContain('cdc')
      expect(TRANSFORMER_NAMES).toContain('do-event')
      expect(TRANSFORMER_NAMES).toContain('do-action')
      expect(TRANSFORMER_NAMES).toContain('web-vital')
      expect(TRANSFORMER_NAMES).toContain('session-replay')
      expect(TRANSFORMER_NAMES).toContain('snippet')
      expect(TRANSFORMER_NAMES).toContain('tail')
      expect(TRANSFORMER_NAMES).toContain('epcis')
    })

    it('has 14 built-in transformers', () => {
      expect(TRANSFORMER_NAMES).toHaveLength(14)
    })
  })
})
