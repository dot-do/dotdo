/**
 * OpenFeature Provider Tests
 *
 * TDD RED Phase: These tests define the expected behavior
 * for the OpenFeature Provider interface implementation.
 *
 * Test Coverage:
 * - Provider metadata and interface compliance
 * - Boolean/String/Number/Object evaluation methods
 * - Evaluation details (value, variant, reason)
 * - Error handling (FLAG_NOT_FOUND, TYPE_MISMATCH, GENERAL)
 * - Context transformation (OpenFeature -> internal format)
 * - Hook support (before, after, error, finally)
 * - Lifecycle (initialize, shutdown)
 *
 * OpenFeature Specification: https://openfeature.dev/specification/sections/providers
 *
 * @module @dotdo/compat/flags/openfeature.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FlagsClient,
  type FlagsConfig,
  type EvaluationContext,
  type EvaluationDetails,
  type ResolutionDetails,
  type Hook,
  type HookContext,
  ErrorCode,
  ResolutionReason,
} from './openfeature'

// ============================================================================
// TEST SETUP
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

const defaultConfig: FlagsConfig = {
  storage: {} as any, // Mock DO storage
}

// ============================================================================
// PROVIDER METADATA TESTS
// ============================================================================

describe('OpenFeature Provider Interface', () => {
  describe('metadata', () => {
    it('should have provider metadata with name', () => {
      const client = new FlagsClient(defaultConfig)
      expect(client.metadata).toBeDefined()
      expect(client.metadata.name).toBe('dotdo-flags')
    })

    it('should expose metadata as readonly property', () => {
      const client = new FlagsClient(defaultConfig)
      expect(() => {
        // @ts-expect-error - should be readonly
        client.metadata = { name: 'other' }
      }).toThrow()
    })
  })

  // ============================================================================
  // BOOLEAN EVALUATION TESTS
  // ============================================================================

  describe('resolveBooleanEvaluation', () => {
    it('should resolve boolean flag with value', async () => {
      const client = new FlagsClient(defaultConfig)

      // Mock flag storage
      client.registerFlag({
        key: 'feature-enabled',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation(
        'feature-enabled',
        false, // defaultValue
        {} // context
      )

      expect(result).toBeDefined()
      expect(result.value).toBe(true)
    })

    it('should return variant name when available', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'feature-toggle',
        type: 'boolean',
        variations: [
          { name: 'on', value: true },
          { name: 'off', value: false },
        ],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation(
        'feature-toggle',
        false,
        {}
      )

      expect(result.variant).toBe('on')
    })

    it('should return evaluation reason', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'static-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('static-flag', false, {})

      expect(result.reason).toBe(ResolutionReason.STATIC)
    })

    it('should return TARGETING_MATCH reason when context matches', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'user-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 1,
        targets: [
          {
            variation: 0,
            values: ['user-123'],
          },
        ],
      })

      const result = await client.resolveBooleanEvaluation(
        'user-flag',
        false,
        { targetingKey: 'user-123' }
      )

      expect(result.value).toBe(true)
      expect(result.reason).toBe(ResolutionReason.TARGETING_MATCH)
    })

    it('should return error when flag not found', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveBooleanEvaluation(
        'nonexistent-flag',
        false,
        {}
      )

      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
      expect(result.errorMessage).toContain('nonexistent-flag')
    })

    it('should use defaultValue when flag not found', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveBooleanEvaluation(
        'missing-flag',
        true, // defaultValue
        {}
      )

      expect(result.value).toBe(true)
      expect(result.reason).toBe(ResolutionReason.DEFAULT)
    })

    it('should return TYPE_MISMATCH error when flag type is wrong', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'string-flag',
        type: 'string',
        variations: ['value1', 'value2'],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('string-flag', false, {})

      expect(result.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
      expect(result.value).toBe(false) // defaultValue
    })
  })

  // ============================================================================
  // STRING EVALUATION TESTS
  // ============================================================================

  describe('resolveStringEvaluation', () => {
    it('should resolve string flag with value', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'api-endpoint',
        type: 'string',
        variations: ['https://api.prod.com', 'https://api.dev.com'],
        defaultVariation: 0,
      })

      const result = await client.resolveStringEvaluation(
        'api-endpoint',
        'https://default.com',
        {}
      )

      expect(result.value).toBe('https://api.prod.com')
    })

    it('should handle empty string values', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'empty-string',
        type: 'string',
        variations: ['', 'not-empty'],
        defaultVariation: 0,
      })

      const result = await client.resolveStringEvaluation('empty-string', 'default', {})

      expect(result.value).toBe('')
    })

    it('should return error when flag not found', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveStringEvaluation('missing', 'default', {})

      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
      expect(result.value).toBe('default')
    })

    it('should return TYPE_MISMATCH for non-string flag', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'bool-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveStringEvaluation('bool-flag', 'default', {})

      expect(result.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
    })
  })

  // ============================================================================
  // NUMBER EVALUATION TESTS
  // ============================================================================

  describe('resolveNumberEvaluation', () => {
    it('should resolve number flag with value', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'max-connections',
        type: 'number',
        variations: [100, 50, 10],
        defaultVariation: 0,
      })

      const result = await client.resolveNumberEvaluation('max-connections', 5, {})

      expect(result.value).toBe(100)
    })

    it('should handle integer values', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'count',
        type: 'number',
        variations: [42, 0, -1],
        defaultVariation: 0,
      })

      const result = await client.resolveNumberEvaluation('count', 0, {})

      expect(result.value).toBe(42)
      expect(Number.isInteger(result.value)).toBe(true)
    })

    it('should handle float values', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'rate-limit',
        type: 'number',
        variations: [0.75, 0.5, 0.25],
        defaultVariation: 0,
      })

      const result = await client.resolveNumberEvaluation('rate-limit', 1.0, {})

      expect(result.value).toBe(0.75)
    })

    it('should handle zero and negative numbers', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'offset',
        type: 'number',
        variations: [0, -10, 10],
        defaultVariation: 0,
      })

      const result = await client.resolveNumberEvaluation('offset', 5, {})

      expect(result.value).toBe(0)
    })

    it('should return error when flag not found', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveNumberEvaluation('missing', 42, {})

      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
      expect(result.value).toBe(42)
    })

    it('should return TYPE_MISMATCH for non-number flag', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'string-flag',
        type: 'string',
        variations: ['100', '200'],
        defaultVariation: 0,
      })

      const result = await client.resolveNumberEvaluation('string-flag', 0, {})

      expect(result.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
    })
  })

  // ============================================================================
  // OBJECT EVALUATION TESTS
  // ============================================================================

  describe('resolveObjectEvaluation', () => {
    it('should resolve object flag with value', async () => {
      const client = new FlagsClient(defaultConfig)

      const config1 = { theme: 'dark', lang: 'en' }
      const config2 = { theme: 'light', lang: 'es' }

      client.registerFlag({
        key: 'ui-config',
        type: 'object',
        variations: [config1, config2],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('ui-config', {}, {})

      expect(result.value).toEqual(config1)
    })

    it('should handle nested objects', async () => {
      const client = new FlagsClient(defaultConfig)

      const complexConfig = {
        api: {
          endpoint: 'https://api.com',
          timeout: 5000,
          headers: { 'X-Custom': 'value' },
        },
        features: {
          analytics: true,
          beta: false,
        },
      }

      client.registerFlag({
        key: 'app-config',
        type: 'object',
        variations: [complexConfig, {}],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('app-config', {}, {})

      expect(result.value).toEqual(complexConfig)
    })

    it('should handle arrays as object values', async () => {
      const client = new FlagsClient(defaultConfig)

      const arrayValue = { items: [1, 2, 3], names: ['a', 'b', 'c'] }

      client.registerFlag({
        key: 'list-config',
        type: 'object',
        variations: [arrayValue, { items: [], names: [] }],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('list-config', {}, {})

      expect(result.value).toEqual(arrayValue)
    })

    it('should handle empty objects', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'empty-obj',
        type: 'object',
        variations: [{}, { key: 'value' }],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('empty-obj', { default: true }, {})

      expect(result.value).toEqual({})
    })

    it('should return error when flag not found', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveObjectEvaluation('missing', {}, {})

      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
      expect(result.value).toEqual({})
    })

    it('should return TYPE_MISMATCH for non-object flag', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'bool-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('bool-flag', {}, {})

      expect(result.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
    })

    it('should preserve object immutability', async () => {
      const client = new FlagsClient(defaultConfig)

      const original = { count: 10 }

      client.registerFlag({
        key: 'mutable-test',
        type: 'object',
        variations: [original, {}],
        defaultVariation: 0,
      })

      const result = await client.resolveObjectEvaluation('mutable-test', {}, {})

      // Mutate returned value
      result.value.count = 999

      // Re-evaluate - should return original value
      const result2 = await client.resolveObjectEvaluation('mutable-test', {}, {})

      expect(result2.value.count).toBe(10)
    })
  })

  // ============================================================================
  // CONTEXT TRANSFORMATION TESTS
  // ============================================================================

  describe('context transformation', () => {
    it('should transform OpenFeature context to internal format', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'context-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
        rules: [
          {
            clauses: [{ attribute: 'email', op: 'endsWith', values: ['@example.com'] }],
            variation: 0,
          },
        ],
      })

      const openFeatureContext: EvaluationContext = {
        targetingKey: 'user-123',
        email: 'test@example.com',
        customAttr: 'custom-value',
      }

      const result = await client.resolveBooleanEvaluation(
        'context-flag',
        false,
        openFeatureContext
      )

      expect(result.value).toBe(true)
    })

    it('should use targetingKey as primary identifier', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'user-specific',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 1,
        targets: [
          {
            variation: 0,
            values: ['special-user-123'],
          },
        ],
      })

      const result = await client.resolveBooleanEvaluation(
        'user-specific',
        false,
        { targetingKey: 'special-user-123' }
      )

      expect(result.value).toBe(true)
    })

    it('should handle context with no targetingKey', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'no-targeting',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation(
        'no-targeting',
        false,
        { customAttr: 'value' }
      )

      expect(result.value).toBe(true)
    })

    it('should handle empty context', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'empty-context',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('empty-context', false, {})

      expect(result.value).toBe(true)
    })
  })

  // ============================================================================
  // HOOK SUPPORT TESTS
  // ============================================================================

  describe('hooks', () => {
    it('should call before hook before evaluation', async () => {
      const client = new FlagsClient(defaultConfig)
      const beforeHook = vi.fn()

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({
        before: beforeHook,
      })

      await client.resolveBooleanEvaluation('hook-flag', false, {})

      expect(beforeHook).toHaveBeenCalledTimes(1)
      expect(beforeHook).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'hook-flag',
          defaultValue: false,
          flagValueType: 'boolean',
        }),
        expect.anything() // hints
      )
    })

    it('should call after hook after successful evaluation', async () => {
      const client = new FlagsClient(defaultConfig)
      const afterHook = vi.fn()

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({
        after: afterHook,
      })

      await client.resolveBooleanEvaluation('hook-flag', false, {})

      expect(afterHook).toHaveBeenCalledTimes(1)
      expect(afterHook).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'hook-flag',
        }),
        expect.objectContaining({
          value: true,
          variant: expect.any(String),
          reason: expect.any(String),
        }),
        expect.objectContaining({
          providerName: 'dotdo-flags',
          evaluationStartTime: expect.any(Number),
        })
      )
    })

    it('should call error hook when evaluation fails', async () => {
      const client = new FlagsClient(defaultConfig)
      const errorHook = vi.fn()

      client.addHook({
        error: errorHook,
      })

      await client.resolveBooleanEvaluation('nonexistent', false, {})

      expect(errorHook).toHaveBeenCalledTimes(1)
      expect(errorHook).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'nonexistent',
        }),
        expect.objectContaining({
          errorCode: ErrorCode.FLAG_NOT_FOUND,
        }),
        expect.objectContaining({
          providerName: 'dotdo-flags',
          evaluationStartTime: expect.any(Number),
        })
      )
    })

    it('should call finally hook after evaluation completes', async () => {
      const client = new FlagsClient(defaultConfig)
      const finallyHook = vi.fn()

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({
        finally: finallyHook,
      })

      await client.resolveBooleanEvaluation('hook-flag', false, {})

      expect(finallyHook).toHaveBeenCalledTimes(1)
    })

    it('should call finally hook even when evaluation fails', async () => {
      const client = new FlagsClient(defaultConfig)
      const finallyHook = vi.fn()

      client.addHook({
        finally: finallyHook,
      })

      await client.resolveBooleanEvaluation('nonexistent', false, {})

      expect(finallyHook).toHaveBeenCalledTimes(1)
    })

    it('should call hooks in correct order: before -> after -> finally', async () => {
      const client = new FlagsClient(defaultConfig)
      const callOrder: string[] = []

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({
        before: () => callOrder.push('before'),
        after: () => callOrder.push('after'),
        finally: () => callOrder.push('finally'),
      })

      await client.resolveBooleanEvaluation('hook-flag', false, {})

      expect(callOrder).toEqual(['before', 'after', 'finally'])
    })

    it('should call hooks in error case: before -> error -> finally', async () => {
      const client = new FlagsClient(defaultConfig)
      const callOrder: string[] = []

      client.addHook({
        before: () => callOrder.push('before'),
        after: () => callOrder.push('after'),
        error: () => callOrder.push('error'),
        finally: () => callOrder.push('finally'),
      })

      await client.resolveBooleanEvaluation('nonexistent', false, {})

      expect(callOrder).toEqual(['before', 'error', 'finally'])
    })

    it('should support multiple hooks', async () => {
      const client = new FlagsClient(defaultConfig)
      const hook1 = vi.fn()
      const hook2 = vi.fn()

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({ after: hook1 })
      client.addHook({ after: hook2 })

      await client.resolveBooleanEvaluation('hook-flag', false, {})

      expect(hook1).toHaveBeenCalledTimes(1)
      expect(hook2).toHaveBeenCalledTimes(1)
    })

    it('should continue evaluation if hook throws', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'hook-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      client.addHook({
        before: () => {
          throw new Error('Hook error')
        },
      })

      const result = await client.resolveBooleanEvaluation('hook-flag', false, {})

      // Evaluation should still succeed despite hook error
      expect(result.value).toBe(true)
    })
  })

  // ============================================================================
  // LIFECYCLE TESTS
  // ============================================================================

  describe('lifecycle', () => {
    it('should implement initialize method', async () => {
      const client = new FlagsClient(defaultConfig)

      await expect(client.initialize({})).resolves.not.toThrow()
    })

    it('should accept initialization context', async () => {
      const client = new FlagsClient(defaultConfig)

      const initContext: EvaluationContext = {
        targetingKey: 'init-key',
        environment: 'production',
      }

      await expect(client.initialize(initContext)).resolves.not.toThrow()
    })

    it('should load flags during initialization', async () => {
      const client = new FlagsClient(defaultConfig)

      await client.initialize({})

      // After init, flags should be available
      client.registerFlag({
        key: 'post-init-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('post-init-flag', false, {})
      expect(result.value).toBe(true)
    })

    it('should implement onClose method', async () => {
      const client = new FlagsClient(defaultConfig)

      await expect(client.onClose()).resolves.not.toThrow()
    })

    it('should cleanup resources on close', async () => {
      const client = new FlagsClient(defaultConfig)
      const cleanupSpy = vi.fn()

      // Register cleanup handler
      client.onCleanup(cleanupSpy)

      await client.onClose()

      expect(cleanupSpy).toHaveBeenCalledTimes(1)
    })

    it('should prevent evaluation after close', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'test-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      await client.onClose()

      const result = await client.resolveBooleanEvaluation('test-flag', false, {})

      expect(result.errorCode).toBe(ErrorCode.GENERAL)
      expect(result.errorMessage).toContain('closed')
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('should return PARSE_ERROR for invalid flag definition', async () => {
      const client = new FlagsClient(defaultConfig)

      // Register a malformed flag (this should be caught)
      client.registerFlag({
        key: 'invalid-flag',
        type: 'boolean',
        variations: [], // No variations!
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('invalid-flag', false, {})

      expect(result.errorCode).toBe(ErrorCode.PARSE_ERROR)
    })

    it('should return GENERAL error for unexpected failures', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'error-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
      })

      // Mock an internal error during evaluation
      vi.spyOn(client as any, 'evaluate').mockImplementation(() => {
        throw new Error('Internal error')
      })

      const result = await client.resolveBooleanEvaluation('error-flag', false, {})

      expect(result.errorCode).toBe(ErrorCode.GENERAL)
      expect(result.value).toBe(false) // defaultValue
    })

    it('should include error message with details', async () => {
      const client = new FlagsClient(defaultConfig)

      const result = await client.resolveBooleanEvaluation('missing-flag', false, {})

      expect(result.errorMessage).toBeDefined()
      expect(result.errorMessage).toContain('missing-flag')
    })

    it('should return default value with error', async () => {
      const client = new FlagsClient(defaultConfig)

      const defaultValue = 'default-string'
      const result = await client.resolveStringEvaluation(
        'nonexistent',
        defaultValue,
        {}
      )

      expect(result.value).toBe(defaultValue)
      expect(result.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
    })
  })

  // ============================================================================
  // RESOLUTION DETAILS TESTS
  // ============================================================================

  describe('resolution details', () => {
    it('should include all required fields in resolution', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'complete-flag',
        type: 'boolean',
        variations: [{ name: 'on', value: true }, { name: 'off', value: false }],
        defaultVariation: 0,
      })

      const result = await client.resolveBooleanEvaluation('complete-flag', false, {})

      expect(result).toHaveProperty('value')
      expect(result).toHaveProperty('variant')
      expect(result).toHaveProperty('reason')
      expect(result).not.toHaveProperty('errorCode')
      expect(result).not.toHaveProperty('errorMessage')
    })

    it('should include variant even without explicit names', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'unnamed-variations',
        type: 'string',
        variations: ['value1', 'value2', 'value3'],
        defaultVariation: 1,
      })

      const result = await client.resolveStringEvaluation('unnamed-variations', 'default', {})

      expect(result.variant).toBeDefined()
      expect(typeof result.variant).toBe('string')
    })

    it('should return different reasons for different evaluation paths', async () => {
      const client = new FlagsClient(defaultConfig)

      client.registerFlag({
        key: 'multi-reason-flag',
        type: 'boolean',
        variations: [true, false],
        defaultVariation: 0,
        targets: [
          {
            variation: 0,
            values: ['user-123'],
          },
        ],
      })

      // Static evaluation (no context match)
      const result1 = await client.resolveBooleanEvaluation(
        'multi-reason-flag',
        false,
        { targetingKey: 'user-999' }
      )
      expect(result1.reason).toBe(ResolutionReason.STATIC)

      // Targeting match
      const result2 = await client.resolveBooleanEvaluation(
        'multi-reason-flag',
        false,
        { targetingKey: 'user-123' }
      )
      expect(result2.reason).toBe(ResolutionReason.TARGETING_MATCH)

      // Default (flag not found)
      const result3 = await client.resolveBooleanEvaluation(
        'nonexistent',
        false,
        {}
      )
      expect(result3.reason).toBe(ResolutionReason.DEFAULT)
    })
  })
})
