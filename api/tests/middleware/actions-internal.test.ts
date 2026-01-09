import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

/**
 * Actions Middleware Internal Tests
 *
 * Tests for new internal functionality added during refactoring:
 * - Function type handler registry
 * - Action result caching
 * - Automatic retry with exponential backoff
 * - Execution metrics
 * - Strong typing
 */

import {
  actions,
  type ActionsConfig,
  type ActionFunction,
  type CodeFunction,
  type ExecutionMetrics,
  type MetricsCollector,
  type RetryConfig,
  ActionCache,
  ActionExecutionEngine,
  handlerRegistry,
  registerFunctionTypeHandler,
} from '../../middleware/actions'

// ============================================================================
// Test Helpers
// ============================================================================

const mockAI = {
  generate: vi.fn(),
  stream: vi.fn(),
}

const mockAgentRunner = {
  run: vi.fn(),
}

const mockNotificationChannel = {
  send: vi.fn(),
  waitForResponse: vi.fn(),
}

function createAuthenticatedApp(config?: ActionsConfig): Hono {
  const app = new Hono()

  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-123', role: 'user', permissions: ['actions:*'] })
    c.set('ai', mockAI)
    c.set('agentRunner', mockAgentRunner)
    c.set('notifications', mockNotificationChannel)
    await next()
  })

  app.use('/api/actions/*', actions(config))
  return app
}

async function invokeAction(
  app: Hono,
  action: string,
  input?: unknown
): Promise<Response> {
  return app.request(`/api/actions/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  })
}

// ============================================================================
// 1. Function Type Handler Registry Tests
// ============================================================================

describe('Function Type Handler Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has all default handlers registered', () => {
    expect(handlerRegistry.has('code')).toBe(true)
    expect(handlerRegistry.has('generative')).toBe(true)
    expect(handlerRegistry.has('agentic')).toBe(true)
    expect(handlerRegistry.has('human')).toBe(true)
  })

  it('returns undefined for unknown handler types', () => {
    expect(handlerRegistry.get('unknown-type')).toBeUndefined()
  })

  it('returns handler entry with canRetry flag', () => {
    const codeEntry = handlerRegistry.get('code')
    expect(codeEntry).toBeDefined()
    expect(codeEntry?.canRetry).toBe(true)

    const humanEntry = handlerRegistry.get('human')
    expect(humanEntry).toBeDefined()
    expect(humanEntry?.canRetry).toBe(false)
  })

  it('allows registering custom function type handlers', () => {
    // Save original handler
    const originalEntry = handlerRegistry.get('code')

    // Register a custom handler (this will override)
    registerFunctionTypeHandler(
      'code',
      async (config, input, c) => {
        return { custom: true }
      },
      { canRetry: false }
    )

    // Verify it was registered
    const entry = handlerRegistry.get('code')
    expect(entry).toBeDefined()

    // Restore original handler for other tests
    if (originalEntry) {
      registerFunctionTypeHandler(
        'code',
        originalEntry.handler,
        { canRetry: originalEntry.canRetry }
      )
    }
  })
})

// ============================================================================
// 2. Action Cache Tests
// ============================================================================

describe('ActionCache', () => {
  let cache: ActionCache

  beforeEach(() => {
    cache = new ActionCache()
  })

  it('returns undefined for missing cache entries', () => {
    const result = cache.get('action', { input: 'test' })
    expect(result).toBeUndefined()
  })

  it('stores and retrieves cache entries', () => {
    cache.set('action', { input: 'test' }, { result: 'cached' }, 60000)
    const result = cache.get('action', { input: 'test' })
    expect(result).toEqual({ result: 'cached' })
  })

  it('returns undefined for expired entries', async () => {
    cache.set('action', { input: 'test' }, { result: 'cached' }, 10) // 10ms TTL

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 20))

    const result = cache.get('action', { input: 'test' })
    expect(result).toBeUndefined()
  })

  it('generates unique keys based on action and input', () => {
    cache.set('action1', { a: 1 }, 'result1', 60000)
    cache.set('action2', { a: 1 }, 'result2', 60000)
    cache.set('action1', { a: 2 }, 'result3', 60000)

    expect(cache.get('action1', { a: 1 })).toBe('result1')
    expect(cache.get('action2', { a: 1 })).toBe('result2')
    expect(cache.get('action1', { a: 2 })).toBe('result3')
  })

  it('clears all entries', () => {
    cache.set('action1', {}, 'result1', 60000)
    cache.set('action2', {}, 'result2', 60000)

    cache.clear()

    expect(cache.get('action1', {})).toBeUndefined()
    expect(cache.get('action2', {})).toBeUndefined()
  })

  it('respects max entries limit', () => {
    const smallCache = new ActionCache({ maxEntries: 2 })

    smallCache.set('action1', {}, 'result1', 60000)
    smallCache.set('action2', {}, 'result2', 60000)
    smallCache.set('action3', {}, 'result3', 60000)

    // First entry should be evicted
    expect(smallCache.get('action1', {})).toBeUndefined()
    expect(smallCache.get('action2', {})).toBe('result2')
    expect(smallCache.get('action3', {})).toBe('result3')
  })
})

// ============================================================================
// 3. Caching Integration Tests
// ============================================================================

describe('Actions Middleware - Caching', () => {
  let callCount: number

  beforeEach(() => {
    vi.clearAllMocks()
    callCount = 0
  })

  it('caches results when cacheable is true', async () => {
    // Use a handler that tracks calls via closure
    const app = createAuthenticatedApp({
      actions: {
        'cached-action': {
          type: 'code',
          handler: async () => {
            callCount++
            return { success: true, count: callCount }
          },
          cacheable: true,
          cacheTTL: 60000,
        },
      },
    })

    // First call
    const res1 = await invokeAction(app, 'cached-action', { key: 'value' })
    expect(res1.status).toBe(200)
    const body1 = await res1.json() as { result: { count: number } }
    expect(body1.result.count).toBe(1)

    // Second call with same input - should hit cache
    const res2 = await invokeAction(app, 'cached-action', { key: 'value' })
    expect(res2.status).toBe(200)
    const body2 = await res2.json() as { result: { count: number } }
    expect(body2.result.count).toBe(1) // Same count means cache hit
  })

  it('does not cache when cacheable is false', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'non-cached-action': {
          type: 'code',
          handler: async () => {
            callCount++
            return { success: true, count: callCount }
          },
          cacheable: false,
        },
      },
    })

    const res1 = await invokeAction(app, 'non-cached-action', { key: 'value' })
    const body1 = await res1.json() as { result: { count: number } }

    const res2 = await invokeAction(app, 'non-cached-action', { key: 'value' })
    const body2 = await res2.json() as { result: { count: number } }

    // Different counts means handler was called twice
    expect(body1.result.count).toBe(1)
    expect(body2.result.count).toBe(2)
  })

  it('caches based on input - different inputs not cached together', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'cached-action': {
          type: 'code',
          handler: async (input: { key: string }) => {
            callCount++
            return { key: input.key, count: callCount }
          },
          cacheable: true,
          cacheTTL: 60000,
        },
      },
    })

    const res1 = await invokeAction(app, 'cached-action', { key: 'value1' })
    const body1 = await res1.json() as { result: { count: number } }

    const res2 = await invokeAction(app, 'cached-action', { key: 'value2' })
    const body2 = await res2.json() as { result: { count: number } }

    // Different inputs should both call handler
    expect(body1.result.count).toBe(1)
    expect(body2.result.count).toBe(2)
  })

  it('uses default cacheTTL when not specified', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'cached-action': {
          type: 'code',
          handler: async () => ({ success: true }),
          cacheable: true,
          // No cacheTTL specified - should use default
        },
      },
    })

    const res = await invokeAction(app, 'cached-action')
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// 4. Retry Logic Tests
// ============================================================================

describe('Actions Middleware - Retry with Exponential Backoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries on retryable errors', async () => {
    let attempts = 0

    const app = createAuthenticatedApp({
      actions: {
        'retry-action': {
          type: 'code',
          handler: async () => {
            attempts++
            if (attempts === 1) {
              throw new Error('ECONNRESET')
            }
            return { success: true, attempts }
          },
          retry: {
            maxAttempts: 3,
            initialDelay: 1,
            maxDelay: 10,
            backoffMultiplier: 2,
            retryableErrors: ['ECONNRESET'],
          },
        },
      },
    })

    const res = await invokeAction(app, 'retry-action')

    expect(res.status).toBe(200)
    const body = await res.json() as { result: { attempts: number } }
    expect(body.result.attempts).toBe(2) // Second attempt succeeded
  })

  it('does not retry on non-retryable errors', async () => {
    let attempts = 0

    const app = createAuthenticatedApp({
      actions: {
        'no-retry-action': {
          type: 'code',
          handler: async () => {
            attempts++
            throw new Error('Some random error')
          },
          retry: {
            maxAttempts: 3,
            retryableErrors: ['ECONNRESET', 'ETIMEDOUT'],
          },
        },
      },
    })

    const res = await invokeAction(app, 'no-retry-action')

    expect(res.status).toBe(500)
    expect(attempts).toBe(1) // Only one attempt
  })

  it('respects maxAttempts limit', async () => {
    let attempts = 0

    const app = createAuthenticatedApp({
      actions: {
        'max-retry-action': {
          type: 'code',
          handler: async () => {
            attempts++
            throw new Error('Service unavailable')
          },
          retry: {
            maxAttempts: 2,
            initialDelay: 1,
            retryableErrors: ['Service unavailable'],
          },
        },
      },
    })

    const res = await invokeAction(app, 'max-retry-action')

    expect(res.status).toBe(500)
    // Initial attempt + 2 retries = 3 total calls
    expect(attempts).toBe(3)
  })

  it('does not retry human actions', async () => {
    mockNotificationChannel.send.mockRejectedValue(new Error('Service unavailable'))

    const app = createAuthenticatedApp({
      actions: {
        'human-action': {
          type: 'human',
          channel: 'slack',
          timeout: 1000,
        },
      },
    })

    const res = await invokeAction(app, 'human-action')

    // Human actions should not retry
    expect(mockNotificationChannel.send).toHaveBeenCalledTimes(1)
  })

  it('uses global defaultRetry config', async () => {
    let attempts = 0

    const app = createAuthenticatedApp({
      actions: {
        'global-retry-action': {
          type: 'code',
          handler: async () => {
            attempts++
            if (attempts === 1) {
              throw new Error('rate limit exceeded')
            }
            return { success: true, attempts }
          },
        },
      },
      defaultRetry: {
        maxAttempts: 2,
        initialDelay: 1,
        retryableErrors: ['rate limit'],
      },
    })

    const res = await invokeAction(app, 'global-retry-action')

    expect(res.status).toBe(200)
    expect(attempts).toBe(2)
  })
})

// ============================================================================
// 5. Execution Metrics Tests
// ============================================================================

describe('Actions Middleware - Execution Metrics', () => {
  let metricsCollector: MetricsCollector
  let recordedMetrics: ExecutionMetrics[]

  beforeEach(() => {
    vi.clearAllMocks()
    recordedMetrics = []
    metricsCollector = {
      record: (metrics) => recordedMetrics.push(metrics),
    }
  })

  it('exports ExecutionMetrics type', () => {
    const metrics: ExecutionMetrics = {
      actionName: 'test',
      actionType: 'code',
      startTime: Date.now(),
      endTime: Date.now(),
      duration: 100,
      success: true,
      retryCount: 0,
      cacheHit: false,
    }
    expect(metrics.actionName).toBe('test')
  })

  it('exports MetricsCollector interface', () => {
    const collector: MetricsCollector = {
      record: vi.fn(),
    }
    expect(collector.record).toBeDefined()
  })

  it('ActionExecutionEngine can set metrics collector', () => {
    const engine = new ActionExecutionEngine({ enableMetrics: true })
    expect(() => engine.setMetricsCollector(metricsCollector)).not.toThrow()
  })
})

// ============================================================================
// 6. Strong Typing Tests
// ============================================================================

describe('Actions Middleware - Strong Typing', () => {
  it('CodeFunction supports generic input/output types', () => {
    interface MyInput {
      name: string
      count: number
    }

    interface MyOutput {
      result: string
      processed: boolean
    }

    // This should compile without errors
    const typedAction: CodeFunction<MyInput, MyOutput> = {
      type: 'code',
      handler: async (input) => {
        // TypeScript should know input has name and count
        return {
          result: input.name,
          processed: input.count > 0,
        }
      },
    }

    expect(typedAction.type).toBe('code')
  })

  it('exports all necessary types', async () => {
    // Verify types are exported
    const config: ActionsConfig = {
      actions: {
        test: {
          type: 'code',
          handler: async () => ({}),
        },
      },
      defaultRetry: {
        maxAttempts: 3,
      },
      cache: {
        defaultTTL: 60000,
      },
      enableMetrics: true,
    }

    expect(config.actions).toBeDefined()
  })

  it('RetryConfig has all expected properties', () => {
    const retry: RetryConfig = {
      maxAttempts: 3,
      initialDelay: 100,
      maxDelay: 5000,
      backoffMultiplier: 2,
      retryableErrors: ['ECONNRESET'],
    }

    expect(retry.maxAttempts).toBe(3)
    expect(retry.initialDelay).toBe(100)
    expect(retry.maxDelay).toBe(5000)
    expect(retry.backoffMultiplier).toBe(2)
  })
})

// ============================================================================
// 7. Extended Configuration Tests
// ============================================================================

describe('Actions Middleware - Extended Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('supports cache configuration in ActionsConfig', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'test': {
          type: 'code',
          handler: async () => ({ success: true }),
          cacheable: true,
        },
      },
      cache: {
        defaultTTL: 30000,
        maxEntries: 100,
      },
    })

    const res = await invokeAction(app, 'test')
    expect(res.status).toBe(200)
  })

  it('supports enableMetrics in ActionsConfig', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'test': {
          type: 'code',
          handler: async () => ({ success: true }),
        },
      },
      enableMetrics: true,
    })

    const res = await invokeAction(app, 'test')
    expect(res.status).toBe(200)
  })

  it('supports retry configuration per action', async () => {
    const app = createAuthenticatedApp({
      actions: {
        'test': {
          type: 'code',
          handler: async () => ({ success: true }),
          retry: {
            maxAttempts: 5,
            initialDelay: 50,
          },
        },
      },
    })

    const res = await invokeAction(app, 'test')
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// 8. Backward Compatibility Tests
// ============================================================================

describe('Actions Middleware - Backward Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAI.generate.mockResolvedValue({ text: 'AI response' })
    mockAgentRunner.run.mockResolvedValue({ result: 'done' })
    mockNotificationChannel.send.mockResolvedValue({ messageId: 'msg-1' })
    mockNotificationChannel.waitForResponse.mockResolvedValue({ approved: true })
  })

  it('maintains backward compatibility with existing action configs', async () => {
    // Old-style config without new options
    const app = createAuthenticatedApp({
      actions: {
        'code-action': {
          type: 'code',
          description: 'Test',
          handler: async () => ({ done: true }),
          timeout: 5000,
          // Note: we have 'actions:*' permission so this will pass
        },
        'generative-action': {
          type: 'generative',
          model: 'claude-3-sonnet',
          prompt: 'Test {{input}}',
          stream: false,
        },
        'agentic-action': {
          type: 'agentic',
          agent: 'test-agent',
          maxIterations: 5,
        },
        'human-action': {
          type: 'human',
          channel: 'slack',
          prompt: 'Approve?',
          timeout: 60000,
        },
      },
    })

    // All should work with actions:* permission
    const codeRes = await invokeAction(app, 'code-action')
    expect(codeRes.status).toBe(200)

    const genRes = await invokeAction(app, 'generative-action')
    expect(genRes.status).toBe(200)

    const agentRes = await invokeAction(app, 'agentic-action')
    expect(agentRes.status).toBe(200)

    const humanRes = await invokeAction(app, 'human-action')
    expect(humanRes.status).toBe(200)
  })

  it('respects requiredPermission for actions', async () => {
    // Create app with limited permissions
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('user', { id: 'user-123', role: 'user', permissions: ['basic:read'] }) // Limited
      await next()
    })
    app.use('/api/actions/*', actions({
      actions: {
        'protected-action': {
          type: 'code',
          handler: async () => ({ done: true }),
          requiredPermission: 'admin:execute',
        },
      },
    }))

    const res = await invokeAction(app, 'protected-action')
    expect(res.status).toBe(403)
  })

  it('works with minimal configuration', async () => {
    const app = createAuthenticatedApp() // No config

    const listRes = await app.request('/api/actions', { method: 'GET' })
    expect(listRes.status).toBe(200)

    const body = await listRes.json() as { actions: unknown[] }
    expect(body.actions).toEqual([])
  })
})
