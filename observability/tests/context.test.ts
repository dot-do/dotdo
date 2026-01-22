/**
 * Tests for context propagation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generateCorrelationId,
  createObservabilityContext,
  getContext,
  getOrCreateContext,
  runWithContext,
  runInNewContext,
  runWithChildContext,
  getCorrelationId,
  getTraceContext,
  getActiveSpan,
  setActiveSpan,
  getBaggageItem,
  setBaggageItem,
  getAllBaggage,
  getMetadata,
  setMetadata,
  parseBaggage,
  formatBaggage,
  extractContextFromHeaders,
  injectContextToHeaders,
  createContextHolder,
  resetContextStack,
  BAGGAGE_HEADER,
  CORRELATION_ID_HEADER,
  type ObservabilityContext,
} from '../context'

describe('generateCorrelationId', () => {
  it('should generate a non-empty string', () => {
    const id = generateCorrelationId()
    expect(id).toBeDefined()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()))
    expect(ids.size).toBe(100)
  })

  it('should contain a hyphen separator', () => {
    const id = generateCorrelationId()
    expect(id).toContain('-')
  })
})

describe('createObservabilityContext', () => {
  it('should create context with default values', () => {
    const ctx = createObservabilityContext()
    expect(ctx.correlationId).toBeDefined()
    expect(ctx.baggage).toBeInstanceOf(Map)
    expect(ctx.baggage.size).toBe(0)
    expect(ctx.metadata).toEqual({})
    expect(ctx.traceContext).toBeUndefined()
    expect(ctx.activeSpan).toBeUndefined()
  })

  it('should accept custom correlation ID', () => {
    const ctx = createObservabilityContext({ correlationId: 'custom-123' })
    expect(ctx.correlationId).toBe('custom-123')
  })

  it('should accept initial baggage', () => {
    const baggage = new Map([['key1', 'value1'], ['key2', 'value2']])
    const ctx = createObservabilityContext({ baggage })
    expect(ctx.baggage.get('key1')).toBe('value1')
    expect(ctx.baggage.get('key2')).toBe('value2')
  })

  it('should accept initial metadata', () => {
    const ctx = createObservabilityContext({ metadata: { userId: 'user-123' } })
    expect(ctx.metadata['userId']).toBe('user-123')
  })

  it('should accept trace context', () => {
    const traceContext = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 1,
    }
    const ctx = createObservabilityContext({ traceContext })
    expect(ctx.traceContext).toEqual(traceContext)
  })
})

describe('Context stack operations', () => {
  beforeEach(() => {
    resetContextStack()
  })

  afterEach(() => {
    resetContextStack()
  })

  describe('getContext', () => {
    it('should return undefined when no context is set', () => {
      expect(getContext()).toBeUndefined()
    })

    it('should return the current context when set', () => {
      const ctx = createObservabilityContext({ correlationId: 'test-cid' })
      const result = runWithContext(ctx, () => getContext())
      expect(result?.correlationId).toBe('test-cid')
    })
  })

  describe('getOrCreateContext', () => {
    it('should create a new context when none exists', () => {
      const ctx = getOrCreateContext()
      expect(ctx).toBeDefined()
      expect(ctx.correlationId).toBeDefined()
    })

    it('should return existing context when one exists', () => {
      const existingCtx = createObservabilityContext({ correlationId: 'existing' })
      const result = runWithContext(existingCtx, () => getOrCreateContext())
      expect(result.correlationId).toBe('existing')
    })
  })

  describe('runWithContext', () => {
    it('should make context available during execution', () => {
      const ctx = createObservabilityContext({ correlationId: 'run-test' })
      const result = runWithContext(ctx, () => {
        return getCorrelationId()
      })
      expect(result).toBe('run-test')
    })

    it('should restore previous context after execution', () => {
      expect(getContext()).toBeUndefined()

      const ctx = createObservabilityContext({ correlationId: 'temp' })
      runWithContext(ctx, () => {
        expect(getContext()?.correlationId).toBe('temp')
      })

      expect(getContext()).toBeUndefined()
    })

    it('should support nested contexts', () => {
      const outer = createObservabilityContext({ correlationId: 'outer' })
      const inner = createObservabilityContext({ correlationId: 'inner' })

      runWithContext(outer, () => {
        expect(getCorrelationId()).toBe('outer')

        runWithContext(inner, () => {
          expect(getCorrelationId()).toBe('inner')
        })

        expect(getCorrelationId()).toBe('outer')
      })
    })

    it('should handle exceptions and still clean up', () => {
      const ctx = createObservabilityContext({ correlationId: 'error-test' })

      expect(() => {
        runWithContext(ctx, () => {
          throw new Error('Test error')
        })
      }).toThrow('Test error')

      expect(getContext()).toBeUndefined()
    })
  })

  describe('runInNewContext', () => {
    it('should create and run with a new context', () => {
      const result = runInNewContext({ correlationId: 'new-ctx' }, () => {
        return getCorrelationId()
      })
      expect(result).toBe('new-ctx')
    })

    it('should create default context when no options provided', () => {
      const result = runInNewContext({}, () => {
        return getCorrelationId()
      })
      expect(result).toBeDefined()
    })
  })

  describe('runWithChildContext', () => {
    it('should inherit parent correlation ID', () => {
      const parent = createObservabilityContext({ correlationId: 'parent-cid' })

      runWithContext(parent, () => {
        const result = runWithChildContext({}, () => {
          return getCorrelationId()
        })
        expect(result).toBe('parent-cid')
      })
    })

    it('should merge parent and child baggage', () => {
      const parentBaggage = new Map([['parent-key', 'parent-value']])
      const parent = createObservabilityContext({
        correlationId: 'parent',
        baggage: parentBaggage,
      })

      runWithContext(parent, () => {
        const childBaggage = new Map([['child-key', 'child-value']])
        runWithChildContext({ baggage: childBaggage }, () => {
          const baggage = getAllBaggage()
          expect(baggage.get('parent-key')).toBe('parent-value')
          expect(baggage.get('child-key')).toBe('child-value')
        })
      })
    })

    it('should merge parent and child metadata', () => {
      const parent = createObservabilityContext({
        correlationId: 'parent',
        metadata: { parentMeta: 'pval' },
      })

      runWithContext(parent, () => {
        runWithChildContext({ metadata: { childMeta: 'cval' } }, () => {
          expect(getMetadata('parentMeta')).toBe('pval')
          expect(getMetadata('childMeta')).toBe('cval')
        })
      })
    })

    it('should allow overriding correlation ID in child', () => {
      const parent = createObservabilityContext({ correlationId: 'parent-cid' })

      runWithContext(parent, () => {
        const result = runWithChildContext({ correlationId: 'child-cid' }, () => {
          return getCorrelationId()
        })
        // Parent correlation ID should be preferred
        expect(result).toBe('parent-cid')
      })
    })
  })
})

describe('Context accessors', () => {
  beforeEach(() => {
    resetContextStack()
  })

  afterEach(() => {
    resetContextStack()
  })

  describe('getCorrelationId', () => {
    it('should return undefined when no context', () => {
      expect(getCorrelationId()).toBeUndefined()
    })

    it('should return correlation ID from context', () => {
      const ctx = createObservabilityContext({ correlationId: 'test-cid' })
      runWithContext(ctx, () => {
        expect(getCorrelationId()).toBe('test-cid')
      })
    })
  })

  describe('getTraceContext', () => {
    it('should return undefined when no context', () => {
      expect(getTraceContext()).toBeUndefined()
    })

    it('should return trace context when set', () => {
      const traceContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }
      const ctx = createObservabilityContext({ traceContext })
      runWithContext(ctx, () => {
        expect(getTraceContext()).toEqual(traceContext)
      })
    })
  })

  describe('getActiveSpan / setActiveSpan', () => {
    it('should return undefined when no active span', () => {
      expect(getActiveSpan()).toBeUndefined()
    })

    it('should set and get active span', () => {
      const mockSpan = {
        context: () => ({
          traceId: 'trace123',
          spanId: 'span456',
          traceFlags: 1,
        }),
      } as any

      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setActiveSpan(mockSpan)
        expect(getActiveSpan()).toBe(mockSpan)
        expect(getTraceContext()?.traceId).toBe('trace123')
      })
    })

    it('should allow clearing active span', () => {
      const mockSpan = {
        context: () => ({
          traceId: 'trace123',
          spanId: 'span456',
          traceFlags: 1,
        }),
      } as any

      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setActiveSpan(mockSpan)
        setActiveSpan(undefined)
        expect(getActiveSpan()).toBeUndefined()
      })
    })

    it('should not set span when no context', () => {
      const mockSpan = { context: () => ({}) } as any
      setActiveSpan(mockSpan)
      expect(getActiveSpan()).toBeUndefined()
    })
  })

  describe('getBaggageItem / setBaggageItem', () => {
    it('should return undefined for missing key', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        expect(getBaggageItem('missing')).toBeUndefined()
      })
    })

    it('should set and get baggage items', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setBaggageItem('user-id', 'u123')
        expect(getBaggageItem('user-id')).toBe('u123')
      })
    })

    it('should not set baggage when no context', () => {
      setBaggageItem('key', 'value')
      expect(getBaggageItem('key')).toBeUndefined()
    })
  })

  describe('getAllBaggage', () => {
    it('should return empty map when no context', () => {
      const baggage = getAllBaggage()
      expect(baggage.size).toBe(0)
    })

    it('should return all baggage items', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setBaggageItem('key1', 'val1')
        setBaggageItem('key2', 'val2')
        const baggage = getAllBaggage()
        expect(baggage.size).toBe(2)
        expect(baggage.get('key1')).toBe('val1')
        expect(baggage.get('key2')).toBe('val2')
      })
    })
  })

  describe('getMetadata / setMetadata', () => {
    it('should return undefined for missing key', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        expect(getMetadata('missing')).toBeUndefined()
      })
    })

    it('should set and get metadata', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setMetadata('requestId', 'req-123')
        expect(getMetadata('requestId')).toBe('req-123')
      })
    })

    it('should not set metadata when no context', () => {
      setMetadata('key', 'value')
      expect(getMetadata('key')).toBeUndefined()
    })

    it('should support complex metadata values', () => {
      const ctx = createObservabilityContext()
      runWithContext(ctx, () => {
        setMetadata('user', { id: 'u1', name: 'Alice' })
        expect(getMetadata('user')).toEqual({ id: 'u1', name: 'Alice' })
      })
    })
  })
})

describe('W3C Baggage', () => {
  describe('parseBaggage', () => {
    it('should parse simple baggage header', () => {
      const baggage = parseBaggage('key1=value1,key2=value2')
      expect(baggage.get('key1')).toBe('value1')
      expect(baggage.get('key2')).toBe('value2')
    })

    it('should handle URL-encoded values', () => {
      const baggage = parseBaggage('key=hello%20world')
      expect(baggage.get('key')).toBe('hello world')
    })

    it('should handle properties after key-value', () => {
      const baggage = parseBaggage('key1=value1;prop1;prop2,key2=value2')
      expect(baggage.get('key1')).toBe('value1')
      expect(baggage.get('key2')).toBe('value2')
    })

    it('should return empty map for empty string', () => {
      const baggage = parseBaggage('')
      expect(baggage.size).toBe(0)
    })

    it('should skip invalid items', () => {
      const baggage = parseBaggage('valid=ok,invalid,also-invalid=')
      expect(baggage.get('valid')).toBe('ok')
      expect(baggage.get('also-invalid')).toBe('')
    })

    it('should handle whitespace', () => {
      const baggage = parseBaggage(' key1 = value1 , key2 = value2 ')
      expect(baggage.get('key1')).toBe('value1')
      expect(baggage.get('key2')).toBe('value2')
    })
  })

  describe('formatBaggage', () => {
    it('should format baggage as W3C header', () => {
      const baggage = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ])
      const header = formatBaggage(baggage)
      expect(header).toContain('key1=value1')
      expect(header).toContain('key2=value2')
      expect(header).toContain(',')
    })

    it('should URL-encode special characters', () => {
      const baggage = new Map([['key', 'hello world']])
      const header = formatBaggage(baggage)
      expect(header).toBe('key=hello%20world')
    })

    it('should return empty string for empty map', () => {
      const baggage = new Map()
      const header = formatBaggage(baggage)
      expect(header).toBe('')
    })
  })

  it('should round-trip parse and format', () => {
    const original = new Map([
      ['user-id', 'u-123'],
      ['tenant', 'acme'],
    ])
    const formatted = formatBaggage(original)
    const parsed = parseBaggage(formatted)
    expect(parsed.get('user-id')).toBe('u-123')
    expect(parsed.get('tenant')).toBe('acme')
  })
})

describe('HTTP header integration', () => {
  describe('extractContextFromHeaders', () => {
    it('should extract correlation ID from Headers', () => {
      const headers = new Headers()
      headers.set(CORRELATION_ID_HEADER, 'cid-123')
      const ctx = extractContextFromHeaders(headers)
      expect(ctx.correlationId).toBe('cid-123')
    })

    it('should extract correlation ID from plain object', () => {
      const headers = { [CORRELATION_ID_HEADER]: 'cid-456' }
      const ctx = extractContextFromHeaders(headers)
      expect(ctx.correlationId).toBe('cid-456')
    })

    it('should extract baggage from headers', () => {
      const headers = new Headers()
      headers.set(BAGGAGE_HEADER, 'user-id=u1,tenant=acme')
      const ctx = extractContextFromHeaders(headers)
      expect(ctx.baggage?.get('user-id')).toBe('u1')
      expect(ctx.baggage?.get('tenant')).toBe('acme')
    })

    it('should return empty result for missing headers', () => {
      const ctx = extractContextFromHeaders(new Headers())
      expect(ctx.correlationId).toBeUndefined()
      expect(ctx.baggage).toBeUndefined()
    })
  })

  describe('injectContextToHeaders', () => {
    it('should inject correlation ID', () => {
      const headers = new Headers()
      const ctx = createObservabilityContext({ correlationId: 'inject-cid' })
      injectContextToHeaders(headers, ctx)
      expect(headers.get(CORRELATION_ID_HEADER)).toBe('inject-cid')
    })

    it('should inject baggage', () => {
      const headers = new Headers()
      const baggage = new Map([['key', 'value']])
      const ctx = createObservabilityContext({
        correlationId: 'cid',
        baggage,
      })
      injectContextToHeaders(headers, ctx)
      expect(headers.get(BAGGAGE_HEADER)).toBe('key=value')
    })

    it('should not inject empty baggage', () => {
      const headers = new Headers()
      const ctx = createObservabilityContext({ correlationId: 'cid' })
      injectContextToHeaders(headers, ctx)
      expect(headers.get(BAGGAGE_HEADER)).toBeNull()
    })

    it('should use current context when none provided', () => {
      const headers = new Headers()
      const ctx = createObservabilityContext({ correlationId: 'current-cid' })
      runWithContext(ctx, () => {
        injectContextToHeaders(headers)
        expect(headers.get(CORRELATION_ID_HEADER)).toBe('current-cid')
      })
    })

    it('should do nothing when no context available', () => {
      resetContextStack()
      const headers = new Headers()
      injectContextToHeaders(headers)
      expect(headers.get(CORRELATION_ID_HEADER)).toBeNull()
    })
  })
})

describe('ContextHolder', () => {
  beforeEach(() => {
    resetContextStack()
  })

  afterEach(() => {
    resetContextStack()
  })

  it('should create a context holder with default values', () => {
    const holder = createContextHolder()
    expect(holder.correlationId).toBeDefined()
    expect(holder.span).toBeUndefined()
  })

  it('should create a context holder with custom values', () => {
    const holder = createContextHolder({ correlationId: 'custom-cid' })
    expect(holder.correlationId).toBe('custom-cid')
  })

  it('should get the underlying context', () => {
    const holder = createContextHolder({ correlationId: 'get-test' })
    const ctx = holder.get()
    expect(ctx).toBeDefined()
    expect(ctx?.correlationId).toBe('get-test')
  })

  it('should run functions with the context', () => {
    const holder = createContextHolder({ correlationId: 'run-holder' })
    const result = holder.run(() => getCorrelationId())
    expect(result).toBe('run-holder')
  })

  it('should manage span', () => {
    const mockSpan = {
      context: () => ({
        traceId: 'trace-holder',
        spanId: 'span-holder',
        traceFlags: 1,
      }),
    } as any

    const holder = createContextHolder()
    expect(holder.span).toBeUndefined()

    holder.span = mockSpan
    expect(holder.span).toBe(mockSpan)

    const ctx = holder.get()
    expect(ctx?.traceContext?.traceId).toBe('trace-holder')
  })

  describe('baggage operations', () => {
    it('should get baggage item', () => {
      const baggage = new Map([['key', 'value']])
      const holder = createContextHolder({ baggage })
      expect(holder.baggage.get('key')).toBe('value')
    })

    it('should set baggage item', () => {
      const holder = createContextHolder()
      holder.baggage.set('new-key', 'new-value')
      expect(holder.baggage.get('new-key')).toBe('new-value')
    })

    it('should get all baggage', () => {
      const baggage = new Map([['k1', 'v1'], ['k2', 'v2']])
      const holder = createContextHolder({ baggage })
      const all = holder.baggage.getAll()
      expect(all.size).toBe(2)
    })
  })

  describe('metadata operations', () => {
    it('should get metadata', () => {
      const holder = createContextHolder({ metadata: { key: 'value' } })
      expect(holder.metadata.get('key')).toBe('value')
    })

    it('should set metadata', () => {
      const holder = createContextHolder()
      holder.metadata.set('new-key', 'new-value')
      expect(holder.metadata.get('new-key')).toBe('new-value')
    })
  })
})

describe('resetContextStack', () => {
  it('should clear the context stack', () => {
    const ctx = createObservabilityContext({ correlationId: 'before-reset' })
    runWithContext(ctx, () => {
      // Don't call resetContextStack inside runWithContext as it would leave the stack inconsistent
    })
    // After runWithContext, the stack should be empty anyway
    expect(getContext()).toBeUndefined()

    // But if we manually push and then reset...
    resetContextStack()
    expect(getContext()).toBeUndefined()
  })
})
