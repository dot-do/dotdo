/**
 * Error Context System Tests (TDD RED Phase)
 *
 * These tests define the expected behavior for an error context system that:
 * - Tracks correlation IDs through async operations
 * - Attaches context to errors automatically
 * - Propagates context across async boundaries
 * - Serializes context in error.toJSON()
 *
 * The implementation files do NOT exist yet. These tests should FAIL.
 *
 * @see do-vwb9
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// These imports should FAIL - the module does not exist yet
import {
  ErrorContextManager,
  withErrorContext,
  getErrorContext,
  wrapError,
  type ErrorContext,
} from '../context'

import { DotdoError } from '../DotdoError'

describe('ErrorContextManager', () => {
  beforeEach(() => {
    // Reset context state before each test
    ErrorContextManager.reset?.()
  })

  afterEach(() => {
    ErrorContextManager.reset?.()
  })

  describe('ErrorContext interface', () => {
    it('should define required context fields', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-abc123',
        requestId: 'req-xyz789',
      }

      expect(ctx.correlationId).toBe('corr-abc123')
      expect(ctx.requestId).toBe('req-xyz789')
    })

    it('should support optional context fields', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-abc123',
        requestId: 'req-xyz789',
        userId: 'user-456',
        namespace: 'tenant-acme',
        operation: 'createCustomer',
        shardId: 3,
        metadata: { source: 'api', version: '2.0' },
      }

      expect(ctx.userId).toBe('user-456')
      expect(ctx.namespace).toBe('tenant-acme')
      expect(ctx.operation).toBe('createCustomer')
      expect(ctx.shardId).toBe(3)
      expect(ctx.metadata).toEqual({ source: 'api', version: '2.0' })
    })
  })

  describe('withErrorContext()', () => {
    it('should run a synchronous function with context attached', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-sync-test',
        requestId: 'req-sync-001',
      }

      let capturedContext: ErrorContext | undefined

      withErrorContext(ctx, () => {
        capturedContext = getErrorContext()
      })

      expect(capturedContext).toBeDefined()
      expect(capturedContext?.correlationId).toBe('corr-sync-test')
      expect(capturedContext?.requestId).toBe('req-sync-001')
    })

    it('should run an async function with context attached', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-async-test',
        requestId: 'req-async-001',
      }

      let capturedContext: ErrorContext | undefined

      await withErrorContext(ctx, async () => {
        await Promise.resolve()
        capturedContext = getErrorContext()
      })

      expect(capturedContext).toBeDefined()
      expect(capturedContext?.correlationId).toBe('corr-async-test')
    })

    it('should return the result of the function', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-return-test',
        requestId: 'req-return-001',
      }

      const result = withErrorContext(ctx, () => {
        return 42
      })

      expect(result).toBe(42)
    })

    it('should return the result of an async function', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-async-return',
        requestId: 'req-async-return',
      }

      const result = await withErrorContext(ctx, async () => {
        await Promise.resolve()
        return 'async-result'
      })

      expect(result).toBe('async-result')
    })

    it('should propagate errors with context attached', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-error-test',
        requestId: 'req-error-001',
      }

      expect(() => {
        withErrorContext(ctx, () => {
          throw new Error('Test error')
        })
      }).toThrow('Test error')
    })

    it('should propagate async errors with context attached', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-async-error',
        requestId: 'req-async-error',
      }

      await expect(
        withErrorContext(ctx, async () => {
          await Promise.resolve()
          throw new Error('Async test error')
        })
      ).rejects.toThrow('Async test error')
    })
  })

  describe('getErrorContext()', () => {
    it('should return undefined when no context is set', () => {
      const ctx = getErrorContext()
      expect(ctx).toBeUndefined()
    })

    it('should return current context inside withErrorContext', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-get-test',
        requestId: 'req-get-001',
        userId: 'user-get',
      }

      withErrorContext(ctx, () => {
        const retrieved = getErrorContext()
        expect(retrieved).toBeDefined()
        expect(retrieved?.correlationId).toBe('corr-get-test')
        expect(retrieved?.requestId).toBe('req-get-001')
        expect(retrieved?.userId).toBe('user-get')
      })
    })

    it('should return undefined after withErrorContext completes', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-after-test',
        requestId: 'req-after-001',
      }

      withErrorContext(ctx, () => {
        // Inside context
      })

      const afterCtx = getErrorContext()
      expect(afterCtx).toBeUndefined()
    })
  })

  describe('Context propagation across async boundaries', () => {
    it('should propagate context through setTimeout', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-timeout',
        requestId: 'req-timeout-001',
      }

      let capturedContext: ErrorContext | undefined

      await withErrorContext(ctx, async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            capturedContext = getErrorContext()
            resolve()
          }, 0)
        })
      })

      expect(capturedContext).toBeDefined()
      expect(capturedContext?.correlationId).toBe('corr-timeout')
    })

    it('should propagate context through Promise.all', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-promise-all',
        requestId: 'req-promise-all',
      }

      const capturedContexts: (ErrorContext | undefined)[] = []

      await withErrorContext(ctx, async () => {
        await Promise.all([
          Promise.resolve().then(() => {
            capturedContexts.push(getErrorContext())
          }),
          Promise.resolve().then(() => {
            capturedContexts.push(getErrorContext())
          }),
          Promise.resolve().then(() => {
            capturedContexts.push(getErrorContext())
          }),
        ])
      })

      expect(capturedContexts).toHaveLength(3)
      for (const captured of capturedContexts) {
        expect(captured?.correlationId).toBe('corr-promise-all')
      }
    })

    it('should propagate context through nested async functions', async () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-nested',
        requestId: 'req-nested-001',
      }

      async function level1(): Promise<ErrorContext | undefined> {
        await Promise.resolve()
        return level2()
      }

      async function level2(): Promise<ErrorContext | undefined> {
        await Promise.resolve()
        return level3()
      }

      async function level3(): Promise<ErrorContext | undefined> {
        await Promise.resolve()
        return getErrorContext()
      }

      const capturedContext = await withErrorContext(ctx, level1)

      expect(capturedContext).toBeDefined()
      expect(capturedContext?.correlationId).toBe('corr-nested')
    })
  })

  describe('Nested context handling', () => {
    it('should allow nested contexts that merge with parent', () => {
      const outerCtx: ErrorContext = {
        correlationId: 'corr-outer',
        requestId: 'req-outer',
        userId: 'user-outer',
      }

      const innerCtx: ErrorContext = {
        correlationId: 'corr-outer', // Same correlation
        requestId: 'req-inner', // Different request
        operation: 'innerOperation',
      }

      let capturedInner: ErrorContext | undefined
      let capturedOuter: ErrorContext | undefined

      withErrorContext(outerCtx, () => {
        capturedOuter = getErrorContext()

        withErrorContext(innerCtx, () => {
          capturedInner = getErrorContext()
        })
      })

      expect(capturedOuter?.userId).toBe('user-outer')
      expect(capturedOuter?.operation).toBeUndefined()

      expect(capturedInner?.correlationId).toBe('corr-outer')
      expect(capturedInner?.requestId).toBe('req-inner')
      expect(capturedInner?.userId).toBe('user-outer') // Inherited from parent
      expect(capturedInner?.operation).toBe('innerOperation')
    })

    it('should restore parent context after nested context completes', () => {
      const outerCtx: ErrorContext = {
        correlationId: 'corr-restore',
        requestId: 'req-outer',
      }

      const innerCtx: ErrorContext = {
        correlationId: 'corr-restore',
        requestId: 'req-inner',
      }

      let afterInnerCtx: ErrorContext | undefined

      withErrorContext(outerCtx, () => {
        withErrorContext(innerCtx, () => {
          // Inside inner context
        })

        afterInnerCtx = getErrorContext()
      })

      expect(afterInnerCtx?.requestId).toBe('req-outer')
    })
  })

  describe('ErrorContextManager static methods', () => {
    it('should expose run() for running functions with context', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-run',
        requestId: 'req-run',
      }

      let captured: ErrorContext | undefined

      ErrorContextManager.run(ctx, () => {
        captured = ErrorContextManager.get()
      })

      expect(captured?.correlationId).toBe('corr-run')
    })

    it('should expose get() to retrieve current context', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-get',
        requestId: 'req-get',
      }

      ErrorContextManager.run(ctx, () => {
        const retrieved = ErrorContextManager.get()
        expect(retrieved).toBeDefined()
        expect(retrieved?.correlationId).toBe('corr-get')
      })
    })

    it('should expose with() to merge partial context', () => {
      const baseCtx: ErrorContext = {
        correlationId: 'corr-with',
        requestId: 'req-with',
        userId: 'user-with',
      }

      let captured: ErrorContext | undefined

      ErrorContextManager.run(baseCtx, () => {
        const merged = ErrorContextManager.with({ operation: 'testOp', shardId: 5 })

        expect(merged.correlationId).toBe('corr-with')
        expect(merged.operation).toBe('testOp')
        expect(merged.shardId).toBe(5)
        expect(merged.userId).toBe('user-with')
      })
    })

    it('should expose reset() to clear context', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-reset',
        requestId: 'req-reset',
      }

      ErrorContextManager.run(ctx, () => {
        expect(ErrorContextManager.get()).toBeDefined()
      })

      ErrorContextManager.reset?.()

      const afterReset = ErrorContextManager.get()
      expect(afterReset).toBeUndefined()
    })
  })
})

describe('wrapError()', () => {
  beforeEach(() => {
    ErrorContextManager.reset?.()
  })

  describe('Basic error wrapping', () => {
    it('should wrap a plain Error as DotdoError', () => {
      const original = new Error('Original error')
      const wrapped = wrapError(original)

      expect(wrapped).toBeInstanceOf(DotdoError)
      expect(wrapped.message).toBe('Original error')
      expect(wrapped.cause).toBe(original)
    })

    it('should preserve DotdoError instances', () => {
      const original = new DotdoError('STORAGE_WRITE_FAILED', 'Write failed')
      const wrapped = wrapError(original)

      expect(wrapped).toBe(original)
    })

    it('should wrap string errors', () => {
      const wrapped = wrapError('string error')

      expect(wrapped).toBeInstanceOf(DotdoError)
      expect(wrapped.message).toBe('string error')
    })

    it('should wrap unknown error types', () => {
      const wrapped = wrapError({ custom: 'object' })

      expect(wrapped).toBeInstanceOf(DotdoError)
    })
  })

  describe('Context attachment', () => {
    it('should attach current context to wrapped error', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-wrap-ctx',
        requestId: 'req-wrap-ctx',
        userId: 'user-wrap',
      }

      let wrapped: DotdoError | undefined

      withErrorContext(ctx, () => {
        wrapped = wrapError(new Error('Error with context'))
      })

      expect(wrapped).toBeDefined()
      expect(wrapped?.context?.correlationId).toBe('corr-wrap-ctx')
      expect(wrapped?.context?.requestId).toBe('req-wrap-ctx')
      expect(wrapped?.context?.userId).toBe('user-wrap')
    })

    it('should allow explicit context override', () => {
      const currentCtx: ErrorContext = {
        correlationId: 'corr-current',
        requestId: 'req-current',
      }

      const overrideCtx: Partial<ErrorContext> = {
        operation: 'overrideOp',
        shardId: 7,
      }

      let wrapped: DotdoError | undefined

      withErrorContext(currentCtx, () => {
        wrapped = wrapError(new Error('With override'), overrideCtx)
      })

      expect(wrapped?.context?.correlationId).toBe('corr-current')
      expect(wrapped?.context?.operation).toBe('overrideOp')
      expect(wrapped?.context?.shardId).toBe(7)
    })

    it('should not modify original DotdoError context', () => {
      const ctx: ErrorContext = {
        correlationId: 'corr-no-modify',
        requestId: 'req-no-modify',
      }

      const original = new DotdoError('INTERNAL_ERROR', 'Original', {
        context: { customKey: 'customValue' },
      })

      withErrorContext(ctx, () => {
        const wrapped = wrapError(original)
        // Should return original unchanged
        expect(wrapped.context).toEqual({ customKey: 'customValue' })
      })
    })
  })

  describe('Error code handling', () => {
    it('should use default error code when wrapping plain Error', () => {
      const wrapped = wrapError(new Error('Plain error'))
      expect(wrapped.code).toBe('INTERNAL_ERROR')
    })

    it('should allow specifying error code', () => {
      const wrapped = wrapError(new Error('Storage error'), { errorCode: 'STORAGE_WRITE_FAILED' } as any)
      // Note: errorCode might be passed differently - adjust based on implementation
      // This test documents the expected behavior
    })
  })
})

describe('Error serialization with context', () => {
  beforeEach(() => {
    ErrorContextManager.reset?.()
  })

  it('should include correlationId in error.toJSON()', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-json-test',
      requestId: 'req-json-test',
    }

    let error: DotdoError | undefined

    withErrorContext(ctx, () => {
      error = wrapError(new Error('JSON test error'))
    })

    const json = error!.toJSON()

    expect(json.context).toBeDefined()
    expect(json.context?.correlationId).toBe('corr-json-test')
    expect(json.context?.requestId).toBe('req-json-test')
  })

  it('should serialize full context to JSON', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-full-json',
      requestId: 'req-full-json',
      userId: 'user-json',
      namespace: 'tenant-json',
      operation: 'jsonOperation',
      shardId: 42,
      metadata: { extra: 'data' },
    }

    let error: DotdoError | undefined

    withErrorContext(ctx, () => {
      error = wrapError(new Error('Full context error'))
    })

    const json = error!.toJSON()

    expect(json.context?.correlationId).toBe('corr-full-json')
    expect(json.context?.requestId).toBe('req-full-json')
    expect(json.context?.userId).toBe('user-json')
    expect(json.context?.namespace).toBe('tenant-json')
    expect(json.context?.operation).toBe('jsonOperation')
    expect(json.context?.shardId).toBe(42)
    expect(json.context?.metadata).toEqual({ extra: 'data' })
  })

  it('should be parseable for logging', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-log-test',
      requestId: 'req-log-test',
    }

    let error: DotdoError | undefined

    withErrorContext(ctx, () => {
      error = wrapError(new Error('Log test error'))
    })

    // Should be JSON-stringifiable
    const jsonString = JSON.stringify(error!.toJSON())
    const parsed = JSON.parse(jsonString)

    expect(parsed.context.correlationId).toBe('corr-log-test')
  })
})

describe('Integration with DotdoError', () => {
  beforeEach(() => {
    ErrorContextManager.reset?.()
  })

  it('should allow DotdoError.wrap() to pick up context', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-dotdo-wrap',
      requestId: 'req-dotdo-wrap',
    }

    let wrapped: DotdoError | undefined

    withErrorContext(ctx, () => {
      // This tests that DotdoError.wrap integrates with context system
      wrapped = DotdoError.wrap(new Error('Integration test'))
    })

    // This may require modifying DotdoError.wrap to check for context
    // For now, document the expected behavior
    expect(wrapped?.context?.correlationId).toBe('corr-dotdo-wrap')
  })

  it('should allow static factory methods to pick up context', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-factory',
      requestId: 'req-factory',
    }

    let error: DotdoError | undefined

    withErrorContext(ctx, () => {
      error = DotdoError.notFound('Customer', 'cust-123')
    })

    // Factory methods should include context
    expect(error?.context?.correlationId).toBe('corr-factory')
    expect(error?.context?.resource).toBe('Customer') // Existing behavior
    expect(error?.context?.id).toBe('cust-123') // Existing behavior
  })
})

describe('Edge cases', () => {
  beforeEach(() => {
    ErrorContextManager.reset?.()
  })

  it('should handle empty context gracefully', () => {
    const ctx: ErrorContext = {
      correlationId: '',
      requestId: '',
    }

    withErrorContext(ctx, () => {
      const retrieved = getErrorContext()
      expect(retrieved).toBeDefined()
      expect(retrieved?.correlationId).toBe('')
    })
  })

  it('should handle undefined metadata in context', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-undefined',
      requestId: 'req-undefined',
      metadata: undefined,
    }

    withErrorContext(ctx, () => {
      const retrieved = getErrorContext()
      expect(retrieved?.metadata).toBeUndefined()
    })
  })

  it('should handle context with only required fields', () => {
    const ctx: ErrorContext = {
      correlationId: 'corr-minimal',
      requestId: 'req-minimal',
    }

    withErrorContext(ctx, () => {
      const retrieved = getErrorContext()
      expect(retrieved?.userId).toBeUndefined()
      expect(retrieved?.namespace).toBeUndefined()
      expect(retrieved?.operation).toBeUndefined()
      expect(retrieved?.shardId).toBeUndefined()
      expect(retrieved?.metadata).toBeUndefined()
    })
  })

  it('should handle rapid context switching', () => {
    const contexts: ErrorContext[] = Array.from({ length: 100 }, (_, i) => ({
      correlationId: `corr-${i}`,
      requestId: `req-${i}`,
    }))

    const capturedIds: string[] = []

    for (const ctx of contexts) {
      withErrorContext(ctx, () => {
        const retrieved = getErrorContext()
        capturedIds.push(retrieved?.correlationId ?? 'undefined')
      })
    }

    expect(capturedIds).toHaveLength(100)
    for (let i = 0; i < 100; i++) {
      expect(capturedIds[i]).toBe(`corr-${i}`)
    }
  })

  it('should not leak context between unrelated async operations', async () => {
    const ctx1: ErrorContext = {
      correlationId: 'corr-leak-1',
      requestId: 'req-leak-1',
    }

    const ctx2: ErrorContext = {
      correlationId: 'corr-leak-2',
      requestId: 'req-leak-2',
    }

    let captured1: ErrorContext | undefined
    let captured2: ErrorContext | undefined

    const promise1 = withErrorContext(ctx1, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      captured1 = getErrorContext()
    })

    const promise2 = withErrorContext(ctx2, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      captured2 = getErrorContext()
    })

    await Promise.all([promise1, promise2])

    expect(captured1?.correlationId).toBe('corr-leak-1')
    expect(captured2?.correlationId).toBe('corr-leak-2')
  })
})
