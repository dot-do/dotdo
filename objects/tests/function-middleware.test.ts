/**
 * Tests for FunctionMiddleware
 *
 * Tests pre-built middleware:
 * - Logging middleware
 * - Metrics middleware
 * - Auth middleware
 * - Validation middleware
 * - Rate limiting middleware
 * - Caching middleware
 * - Timeout middleware
 * - Tracing middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createLoggingMiddleware,
  createMetricsMiddleware,
  createMetricsCollector,
  createAuthMiddleware,
  createValidationMiddleware,
  createRateLimitMiddleware,
  createInMemoryRateLimitStore,
  createCachingMiddleware,
  createInMemoryCacheStore,
  createTimeoutMiddleware,
  createTracingMiddleware,
  composeMiddleware,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  type LogEntry,
  type MetricsEntry,
} from '../FunctionMiddleware'
import type { MiddlewareContext } from '../BaseFunctionExecutor'

function createTestContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    functionId: 'test-function',
    invocationId: 'test-invocation',
    functionType: 'code',
    input: { foo: 'bar' },
    startTime: Date.now(),
    metadata: {},
    ...overrides,
  }
}

describe('FunctionMiddleware', () => {
  describe('createLoggingMiddleware', () => {
    it('should log start and completion', async () => {
      const logs: LogEntry[] = []
      const middleware = createLoggingMiddleware({
        sink: (entry) => { logs.push(entry) },
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
      expect(logs).toHaveLength(2)
      expect(logs[0].message).toContain('started')
      expect(logs[1].message).toContain('completed')
      expect(logs[1].success).toBe(true)
    })

    it('should log errors', async () => {
      const logs: LogEntry[] = []
      const middleware = createLoggingMiddleware({
        sink: (entry) => { logs.push(entry) },
        logErrors: true,
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => { throw new Error('test error') })
      ).rejects.toThrow('test error')

      expect(logs).toHaveLength(2)
      expect(logs[1].level).toBe('error')
      expect(logs[1].error).toBe('test error')
      expect(logs[1].success).toBe(false)
    })

    it('should log input when enabled', async () => {
      const logs: LogEntry[] = []
      const middleware = createLoggingMiddleware({
        sink: (entry) => { logs.push(entry) },
        logInput: true,
      })

      const ctx = createTestContext({ input: { secret: 'data' } })
      await middleware(ctx, async () => 'result')

      expect(logs[0].metadata?.input).toEqual({ secret: 'data' })
    })

    it('should log output when enabled', async () => {
      const logs: LogEntry[] = []
      const middleware = createLoggingMiddleware({
        sink: (entry) => { logs.push(entry) },
        logOutput: true,
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => ({ result: 'data' }))

      expect(logs[1].metadata?.output).toEqual({ result: 'data' })
    })

    it('should include duration', async () => {
      const logs: LogEntry[] = []
      const middleware = createLoggingMiddleware({
        sink: (entry) => { logs.push(entry) },
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => {
        await new Promise(r => setTimeout(r, 10))
        return 'result'
      })

      expect(logs[1].duration).toBeGreaterThanOrEqual(10)
    })
  })

  describe('createMetricsMiddleware', () => {
    it('should track metrics for successful execution', async () => {
      const metrics: MetricsEntry[] = []
      const middleware = createMetricsMiddleware({
        sink: (entry) => { metrics.push(entry) },
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => 'result')

      expect(metrics).toHaveLength(1)
      expect(metrics[0].success).toBe(true)
      expect(metrics[0].functionId).toBe('test-function')
      expect(metrics[0].duration).toBeGreaterThanOrEqual(0)
    })

    it('should track metrics for failed execution', async () => {
      const metrics: MetricsEntry[] = []
      const middleware = createMetricsMiddleware({
        sink: (entry) => { metrics.push(entry) },
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => { throw new Error('fail') })
      ).rejects.toThrow()

      expect(metrics).toHaveLength(1)
      expect(metrics[0].success).toBe(false)
    })
  })

  describe('createMetricsCollector', () => {
    it('should collect and summarize metrics', async () => {
      const collector = createMetricsCollector()

      // Execute some functions
      const ctx1 = createTestContext({ functionId: 'fn1' })
      await collector.middleware(ctx1, async () => 'result1')

      const ctx2 = createTestContext({ functionId: 'fn1' })
      await collector.middleware(ctx2, async () => 'result2')

      const ctx3 = createTestContext({ functionId: 'fn2' })
      await expect(
        collector.middleware(ctx3, async () => { throw new Error('fail') })
      ).rejects.toThrow()

      const summary = collector.getSummary()

      expect(summary.total).toBe(3)
      expect(summary.succeeded).toBe(2)
      expect(summary.failed).toBe(1)
      expect(summary.byFunction['fn1'].count).toBe(2)
      expect(summary.byFunction['fn1'].successRate).toBe(1)
      expect(summary.byFunction['fn2'].successRate).toBe(0)
    })

    it('should clear metrics', async () => {
      const collector = createMetricsCollector()

      const ctx = createTestContext()
      await collector.middleware(ctx, async () => 'result')

      collector.clear()

      expect(collector.getMetrics()).toHaveLength(0)
      expect(collector.getSummary().total).toBe(0)
    })
  })

  describe('createAuthMiddleware', () => {
    it('should pass when auth is valid', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1' }),
        required: true,
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
      expect(ctx.metadata.auth).toEqual({ userId: 'user-1' })
    })

    it('should throw AuthenticationError when auth is missing and required', async () => {
      const middleware = createAuthMiddleware({
        provider: () => null,
        required: true,
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(AuthenticationError)
    })

    it('should pass when auth is missing but not required', async () => {
      const middleware = createAuthMiddleware({
        provider: () => null,
        required: false,
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
    })

    it('should validate required roles', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1', roles: ['user'] }),
        requiredRoles: ['admin'],
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(AuthorizationError)
    })

    it('should pass with correct roles', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1', roles: ['admin'] }),
        requiredRoles: ['admin'],
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
    })

    it('should validate required permissions', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1', permissions: ['read'] }),
        requiredPermissions: ['read', 'write'],
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(AuthorizationError)
    })

    it('should use custom validator', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1', customField: 'valid' }),
        validator: (ctx, auth) => auth.customField === 'valid',
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
    })

    it('should fail custom validator', async () => {
      const middleware = createAuthMiddleware({
        provider: () => ({ userId: 'user-1', customField: 'invalid' }),
        validator: (ctx, auth) => auth.customField === 'valid',
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(AuthorizationError)
    })
  })

  describe('createValidationMiddleware', () => {
    it('should pass valid input', async () => {
      const middleware = createValidationMiddleware({
        inputValidator: (input: unknown) => {
          const obj = input as { value: number }
          return obj.value > 0
        },
      })

      const ctx = createTestContext({ input: { value: 5 } })
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
    })

    it('should reject invalid input', async () => {
      const middleware = createValidationMiddleware({
        inputValidator: (input: unknown) => {
          const obj = input as { value: number }
          return obj.value > 0
        },
      })

      const ctx = createTestContext({ input: { value: -1 } })
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(ValidationError)
    })

    it('should reject with custom message', async () => {
      const middleware = createValidationMiddleware({
        inputValidator: () => 'Value must be positive',
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow('Value must be positive')
    })

    it('should validate output', async () => {
      const middleware = createValidationMiddleware({
        outputValidator: (output: unknown) => {
          const obj = output as { status: string }
          return obj.status === 'ok'
        },
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => ({ status: 'error' }))
      ).rejects.toThrow(ValidationError)
    })

    it('should pass valid output', async () => {
      const middleware = createValidationMiddleware({
        outputValidator: (output: unknown) => {
          const obj = output as { status: string }
          return obj.status === 'ok'
        },
      })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => ({ status: 'ok' }))

      expect(result).toEqual({ status: 'ok' })
    })
  })

  describe('createRateLimitMiddleware', () => {
    it('should allow requests within limit', async () => {
      const store = createInMemoryRateLimitStore(5, 60000)
      const middleware = createRateLimitMiddleware({ store })

      const ctx = createTestContext()

      for (let i = 0; i < 5; i++) {
        const result = await middleware(ctx, async () => 'result')
        expect(result).toBe('result')
      }
    })

    it('should reject requests over limit', async () => {
      const store = createInMemoryRateLimitStore(2, 60000)
      const middleware = createRateLimitMiddleware({ store })

      const ctx = createTestContext()

      await middleware(ctx, async () => 'result')
      await middleware(ctx, async () => 'result')

      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow(RateLimitError)
    })

    it('should use custom key generator', async () => {
      const store = createInMemoryRateLimitStore(1, 60000)
      const middleware = createRateLimitMiddleware({
        store,
        keyGenerator: (ctx) => ctx.metadata.userId as string,
      })

      const ctx1 = createTestContext({ metadata: { userId: 'user-1' } })
      const ctx2 = createTestContext({ metadata: { userId: 'user-2' } })

      await middleware(ctx1, async () => 'result')
      await middleware(ctx2, async () => 'result')

      // user-1 is now rate limited
      await expect(
        middleware(ctx1, async () => 'result')
      ).rejects.toThrow(RateLimitError)

      // user-2 can still make requests
      await expect(
        middleware(ctx2, async () => 'result')
      ).rejects.toThrow(RateLimitError)
    })

    it('should call onLimit callback', async () => {
      const store = createInMemoryRateLimitStore(1, 60000)
      const onLimit = vi.fn()
      const middleware = createRateLimitMiddleware({ store, onLimit })

      const ctx = createTestContext()

      await middleware(ctx, async () => 'result')

      await expect(
        middleware(ctx, async () => 'result')
      ).rejects.toThrow()

      expect(onLimit).toHaveBeenCalled()
    })
  })

  describe('createCachingMiddleware', () => {
    it('should cache results', async () => {
      const store = createInMemoryCacheStore()
      const middleware = createCachingMiddleware({
        store,
        ttl: 60000,
      })

      const fn = vi.fn().mockResolvedValue('result')
      const ctx = createTestContext({ input: { key: 'value' } })

      // First call - not cached
      const result1 = await middleware(ctx, fn)
      expect(result1).toBe('result')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(ctx.metadata.cacheHit).toBe(false)

      // Second call - cached
      const ctx2 = createTestContext({ input: { key: 'value' } })
      const result2 = await middleware(ctx2, fn)
      expect(result2).toBe('result')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(ctx2.metadata.cacheHit).toBe(true)
    })

    it('should use custom key generator', async () => {
      const store = createInMemoryCacheStore()
      const middleware = createCachingMiddleware({
        store,
        ttl: 60000,
        keyGenerator: (ctx) => `custom:${ctx.functionId}`,
      })

      const fn = vi.fn().mockResolvedValue('result')
      const ctx = createTestContext()

      await middleware(ctx, fn)

      const cached = await store.get('custom:test-function')
      expect(cached).toBeDefined()
      expect(cached?.value).toBe('result')
    })

    it('should respect shouldCache condition', async () => {
      const store = createInMemoryCacheStore()
      const middleware = createCachingMiddleware({
        store,
        ttl: 60000,
        shouldCache: (ctx, result) => result !== 'no-cache',
      })

      const fn = vi.fn().mockResolvedValue('no-cache')
      const ctx = createTestContext()

      await middleware(ctx, fn)
      await middleware(ctx, fn)

      // Should have called twice because caching was disabled
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should expire cache entries', async () => {
      const store = createInMemoryCacheStore()
      const middleware = createCachingMiddleware({
        store,
        ttl: 10, // 10ms TTL
      })

      const fn = vi.fn().mockResolvedValue('result')
      const ctx = createTestContext()

      await middleware(ctx, fn)
      expect(fn).toHaveBeenCalledTimes(1)

      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 20))

      await middleware(ctx, fn)
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('createTimeoutMiddleware', () => {
    it('should complete within timeout', async () => {
      const middleware = createTimeoutMiddleware({ timeout: 1000 })

      const ctx = createTestContext()
      const result = await middleware(ctx, async () => 'result')

      expect(result).toBe('result')
    })

    it('should throw TimeoutError when timeout exceeded', async () => {
      const middleware = createTimeoutMiddleware({ timeout: 10 })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => {
          await new Promise(r => setTimeout(r, 100))
          return 'result'
        })
      ).rejects.toThrow(TimeoutError)
    })

    it('should call onTimeout callback', async () => {
      const onTimeout = vi.fn()
      const middleware = createTimeoutMiddleware({ timeout: 10, onTimeout })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => {
          await new Promise(r => setTimeout(r, 100))
          return 'result'
        })
      ).rejects.toThrow()

      expect(onTimeout).toHaveBeenCalledWith(ctx)
    })
  })

  describe('createTracingMiddleware', () => {
    it('should create trace spans', async () => {
      const spans: any[] = []
      const middleware = createTracingMiddleware({
        sink: (span) => { spans.push(span) },
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => 'result')

      expect(spans).toHaveLength(1)
      expect(spans[0].traceId).toBeDefined()
      expect(spans[0].spanId).toBeDefined()
      expect(spans[0].operationName).toBe('test-function')
      expect(spans[0].tags.success).toBe(true)
      expect(spans[0].endTime).toBeGreaterThanOrEqual(spans[0].startTime)
    })

    it('should track errors in spans', async () => {
      const spans: any[] = []
      const middleware = createTracingMiddleware({
        sink: (span) => { spans.push(span) },
      })

      const ctx = createTestContext()
      await expect(
        middleware(ctx, async () => { throw new Error('test error') })
      ).rejects.toThrow()

      expect(spans[0].tags.success).toBe(false)
      expect(spans[0].tags.error).toBe(true)
      expect(spans[0].tags['error.message']).toBe('test error')
    })

    it('should extract trace context', async () => {
      const spans: any[] = []
      const middleware = createTracingMiddleware({
        sink: (span) => { spans.push(span) },
        extractTraceContext: (ctx) => ({
          traceId: 'parent-trace-id',
          parentSpanId: 'parent-span-id',
        }),
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => 'result')

      expect(spans[0].traceId).toBe('parent-trace-id')
      expect(spans[0].parentSpanId).toBe('parent-span-id')
    })

    it('should store trace info in metadata', async () => {
      const middleware = createTracingMiddleware({
        sink: () => {},
      })

      const ctx = createTestContext()
      await middleware(ctx, async () => 'result')

      expect(ctx.metadata.traceId).toBeDefined()
      expect(ctx.metadata.spanId).toBeDefined()
    })
  })

  describe('composeMiddleware', () => {
    it('should compose multiple middleware', async () => {
      const order: string[] = []

      const m1 = vi.fn(async (ctx: MiddlewareContext, next: () => Promise<unknown>) => {
        order.push('m1-before')
        const result = await next()
        order.push('m1-after')
        return result
      })

      const m2 = vi.fn(async (ctx: MiddlewareContext, next: () => Promise<unknown>) => {
        order.push('m2-before')
        const result = await next()
        order.push('m2-after')
        return result
      })

      const m3 = vi.fn(async (ctx: MiddlewareContext, next: () => Promise<unknown>) => {
        order.push('m3-before')
        const result = await next()
        order.push('m3-after')
        return result
      })

      const composed = composeMiddleware(m1, m2, m3)

      const ctx = createTestContext()
      const result = await composed(ctx, async () => {
        order.push('core')
        return 'result'
      })

      expect(result).toBe('result')
      expect(order).toEqual([
        'm1-before',
        'm2-before',
        'm3-before',
        'core',
        'm3-after',
        'm2-after',
        'm1-after',
      ])
    })

    it('should handle errors in composed middleware', async () => {
      const m1 = async (ctx: MiddlewareContext, next: () => Promise<unknown>) => {
        return next()
      }

      const m2 = async () => {
        throw new Error('middleware error')
      }

      const composed = composeMiddleware(m1, m2)

      const ctx = createTestContext()
      await expect(
        composed(ctx, async () => 'result')
      ).rejects.toThrow('middleware error')
    })
  })

  describe('real-world middleware composition', () => {
    it('should work with logging + metrics + auth + validation', async () => {
      const logs: LogEntry[] = []
      const collector = createMetricsCollector()

      const composed = composeMiddleware(
        createLoggingMiddleware({ sink: (e) => logs.push(e) }),
        collector.middleware,
        createAuthMiddleware({
          provider: () => ({ userId: 'user-1', roles: ['admin'] }),
          requiredRoles: ['admin'],
        }),
        createValidationMiddleware({
          inputValidator: (input: unknown) => {
            const obj = input as { amount: number }
            return obj.amount > 0
          },
        })
      )

      const ctx = createTestContext({ input: { amount: 100 } })
      const result = await composed(ctx, async () => ({ status: 'ok' }))

      expect(result).toEqual({ status: 'ok' })
      expect(logs).toHaveLength(2)
      expect(collector.getSummary().succeeded).toBe(1)
      expect(ctx.metadata.auth).toEqual({ userId: 'user-1', roles: ['admin'] })
    })

    it('should fail early on auth error', async () => {
      const logs: LogEntry[] = []

      const composed = composeMiddleware(
        createLoggingMiddleware({ sink: (e) => logs.push(e) }),
        createAuthMiddleware({
          provider: () => null,
          required: true,
        }),
        createValidationMiddleware({
          inputValidator: () => true,
        })
      )

      const ctx = createTestContext()
      await expect(
        composed(ctx, async () => 'result')
      ).rejects.toThrow(AuthenticationError)

      // Logging should still capture the error
      expect(logs.some(l => l.level === 'error')).toBe(true)
    })
  })
})
