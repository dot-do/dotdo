/**
 * Environment Binding Safety Tests (TDD RED Phase)
 *
 * Tests for safe environment binding resolution.
 *
 * PROBLEM: Code review found unsafe env binding resolution at api/index.ts:410, 461, 479.
 * When bindings don't exist, the code silently returns undefined causing runtime crashes
 * instead of throwing descriptive errors.
 *
 * These tests document the expected behavior for safe binding resolution.
 * They should FAIL until the implementation is complete.
 *
 * @see https://github.com/dot-do/dotdo/issues/do-mb1f
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the types we'll need
// These imports will fail until implementation exists
import {
  getBinding,
  getBindingOrThrow,
  validateBindings,
  BindingError,
  type BindingValidationResult,
} from '../bindings'

// ============================================================================
// Mock Environment Types
// ============================================================================

interface MockEnv {
  DO?: DurableObjectNamespace
  REPLICA_DO?: DurableObjectNamespace
  KV?: KVNamespace
  R2?: R2Bucket
  PIPELINE?: Pipeline
  AI?: Ai
}

// Mock implementations for testing
const mockDO = {
  idFromName: () => ({ toString: () => 'mock-id' }),
  idFromString: () => ({ toString: () => 'mock-id' }),
  newUniqueId: () => ({ toString: () => 'mock-id' }),
  get: () => ({}),
  jurisdiction: () => ({}),
} as unknown as DurableObjectNamespace

const mockKV = {
  get: () => Promise.resolve(null),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true }),
} as unknown as KVNamespace

const mockR2 = {
  get: () => Promise.resolve(null),
  put: () => Promise.resolve({}),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ objects: [], truncated: false }),
  head: () => Promise.resolve(null),
} as unknown as R2Bucket

const mockPipeline = {
  send: () => Promise.resolve(),
} as unknown as Pipeline

// ============================================================================
// BindingError Tests
// ============================================================================

describe('BindingError', () => {
  it('should be a custom error class', () => {
    const error = new BindingError('DO', 'Binding not found')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(BindingError)
    expect(error.name).toBe('BindingError')
  })

  it('should include binding name in error', () => {
    const error = new BindingError('MY_CUSTOM_DO', 'Binding not found')

    expect(error.bindingName).toBe('MY_CUSTOM_DO')
    expect(error.message).toContain('MY_CUSTOM_DO')
  })

  it('should include available bindings in error for discoverability', () => {
    const error = new BindingError('INVALID_BINDING', 'Binding not found', {
      availableBindings: ['DO', 'KV', 'R2'],
    })

    expect(error.availableBindings).toEqual(['DO', 'KV', 'R2'])
    expect(error.message).toContain('DO')
    expect(error.message).toContain('KV')
    expect(error.message).toContain('R2')
  })

  it('should have descriptive error message', () => {
    const error = new BindingError('REPLICA_DO', 'Binding not found', {
      availableBindings: ['DO', 'KV'],
    })

    // Message should help developer understand what went wrong
    expect(error.message).toMatch(/REPLICA_DO/)
    expect(error.message).toMatch(/not found|unavailable|missing/i)
    expect(error.message).toMatch(/available.*(DO|KV)/i)
  })

  it('should have error code for programmatic handling', () => {
    const error = new BindingError('DO', 'Binding not found')

    expect(error.code).toBe('BINDING_NOT_FOUND')
  })

  it('should support different error codes', () => {
    const notFoundError = new BindingError('DO', 'Binding not found', {
      code: 'BINDING_NOT_FOUND',
    })
    const invalidTypeError = new BindingError('DO', 'Invalid binding type', {
      code: 'BINDING_TYPE_INVALID',
    })

    expect(notFoundError.code).toBe('BINDING_NOT_FOUND')
    expect(invalidTypeError.code).toBe('BINDING_TYPE_INVALID')
  })

  it('should be serializable to JSON for logging', () => {
    const error = new BindingError('DO', 'Binding not found', {
      availableBindings: ['KV', 'R2'],
    })

    const json = error.toJSON()

    expect(json).toEqual({
      name: 'BindingError',
      code: 'BINDING_NOT_FOUND',
      message: expect.stringContaining('DO'),
      bindingName: 'DO',
      availableBindings: ['KV', 'R2'],
    })
  })
})

// ============================================================================
// getBinding() Tests - Graceful Error on Missing
// ============================================================================

describe('getBinding()', () => {
  describe('when binding exists', () => {
    it('should return DO binding when available', () => {
      const env: MockEnv = { DO: mockDO }

      const result = getBinding(env, 'DO')

      expect(result).toBe(mockDO)
    })

    it('should return KV binding when available', () => {
      const env: MockEnv = { KV: mockKV }

      const result = getBinding(env, 'KV')

      expect(result).toBe(mockKV)
    })

    it('should return R2 binding when available', () => {
      const env: MockEnv = { R2: mockR2 }

      const result = getBinding(env, 'R2')

      expect(result).toBe(mockR2)
    })

    it('should return Pipeline binding when available', () => {
      const env: MockEnv = { PIPELINE: mockPipeline }

      const result = getBinding(env, 'PIPELINE')

      expect(result).toBe(mockPipeline)
    })
  })

  describe('when binding is missing', () => {
    it('should return undefined for missing DO binding (not throw)', () => {
      const env: MockEnv = { KV: mockKV }

      // getBinding should NOT throw - it returns undefined for graceful handling
      const result = getBinding(env, 'DO')

      expect(result).toBeUndefined()
    })

    it('should return undefined for missing KV binding', () => {
      const env: MockEnv = { DO: mockDO }

      const result = getBinding(env, 'KV')

      expect(result).toBeUndefined()
    })

    it('should return undefined for missing R2 binding', () => {
      const env: MockEnv = {}

      const result = getBinding(env, 'R2')

      expect(result).toBeUndefined()
    })

    it('should return undefined for missing Pipeline binding', () => {
      const env: MockEnv = {}

      const result = getBinding(env, 'PIPELINE')

      expect(result).toBeUndefined()
    })
  })

  describe('type safety', () => {
    it('should return typed result for DO binding', () => {
      const env: MockEnv = { DO: mockDO }

      const result = getBinding<DurableObjectNamespace>(env, 'DO')

      // TypeScript should infer this as DurableObjectNamespace | undefined
      expect(result?.idFromName).toBeDefined()
    })

    it('should return typed result for KV binding', () => {
      const env: MockEnv = { KV: mockKV }

      const result = getBinding<KVNamespace>(env, 'KV')

      expect(result?.get).toBeDefined()
    })
  })
})

// ============================================================================
// getBindingOrThrow() Tests - Throws BindingError on Missing
// ============================================================================

describe('getBindingOrThrow()', () => {
  describe('when binding exists', () => {
    it('should return DO binding without throwing', () => {
      const env: MockEnv = { DO: mockDO }

      const result = getBindingOrThrow(env, 'DO')

      expect(result).toBe(mockDO)
    })

    it('should return KV binding without throwing', () => {
      const env: MockEnv = { KV: mockKV }

      const result = getBindingOrThrow(env, 'KV')

      expect(result).toBe(mockKV)
    })
  })

  describe('when binding is missing', () => {
    it('should throw BindingError for missing DO binding', () => {
      const env: MockEnv = { KV: mockKV }

      expect(() => getBindingOrThrow(env, 'DO')).toThrow(BindingError)
    })

    it('should throw BindingError for missing KV binding', () => {
      const env: MockEnv = { DO: mockDO }

      expect(() => getBindingOrThrow(env, 'KV')).toThrow(BindingError)
    })

    it('should throw BindingError for missing R2 binding', () => {
      const env: MockEnv = {}

      expect(() => getBindingOrThrow(env, 'R2')).toThrow(BindingError)
    })

    it('should throw BindingError for missing Pipeline binding', () => {
      const env: MockEnv = {}

      expect(() => getBindingOrThrow(env, 'PIPELINE')).toThrow(BindingError)
    })

    it('should include available bindings in thrown error', () => {
      const env: MockEnv = { DO: mockDO, KV: mockKV }

      try {
        getBindingOrThrow(env, 'INVALID_BINDING')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BindingError)
        const error = e as BindingError
        expect(error.availableBindings).toContain('DO')
        expect(error.availableBindings).toContain('KV')
      }
    })

    it('should include binding name in thrown error', () => {
      const env: MockEnv = {}

      try {
        getBindingOrThrow(env, 'REPLICA_DO')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BindingError)
        const error = e as BindingError
        expect(error.bindingName).toBe('REPLICA_DO')
      }
    })
  })

  describe('type safety', () => {
    it('should return non-nullable typed result', () => {
      const env: MockEnv = { DO: mockDO }

      // Result should be DurableObjectNamespace, NOT DurableObjectNamespace | undefined
      const result = getBindingOrThrow<DurableObjectNamespace>(env, 'DO')

      // This should compile without optional chaining because it throws on missing
      expect(result.idFromName).toBeDefined()
    })
  })
})

// ============================================================================
// validateBindings() Tests - Startup Validation
// ============================================================================

describe('validateBindings()', () => {
  describe('validation at startup', () => {
    it('should validate all required bindings are present', () => {
      const env: MockEnv = { DO: mockDO, KV: mockKV }

      const result = validateBindings(env, ['DO', 'KV'])

      expect(result.valid).toBe(true)
      expect(result.missingBindings).toEqual([])
    })

    it('should detect missing required bindings', () => {
      const env: MockEnv = { DO: mockDO }

      const result = validateBindings(env, ['DO', 'KV', 'R2'])

      expect(result.valid).toBe(false)
      expect(result.missingBindings).toContain('KV')
      expect(result.missingBindings).toContain('R2')
      expect(result.missingBindings).not.toContain('DO')
    })

    it('should return available bindings for diagnostics', () => {
      const env: MockEnv = { DO: mockDO, PIPELINE: mockPipeline }

      const result = validateBindings(env, ['DO', 'KV'])

      expect(result.availableBindings).toContain('DO')
      expect(result.availableBindings).toContain('PIPELINE')
    })

    it('should return detailed validation result', () => {
      const env: MockEnv = { DO: mockDO }

      const result: BindingValidationResult = validateBindings(env, ['DO', 'KV', 'R2'])

      expect(result).toEqual({
        valid: false,
        missingBindings: expect.arrayContaining(['KV', 'R2']),
        availableBindings: expect.arrayContaining(['DO']),
        requiredBindings: ['DO', 'KV', 'R2'],
      })
    })
  })

  describe('validation with optional bindings', () => {
    it('should support optional bindings specification', () => {
      const env: MockEnv = { DO: mockDO }

      const result = validateBindings(env, {
        required: ['DO'],
        optional: ['KV', 'R2'],
      })

      expect(result.valid).toBe(true)
      expect(result.missingOptional).toContain('KV')
      expect(result.missingOptional).toContain('R2')
    })

    it('should fail only on missing required bindings', () => {
      const env: MockEnv = { KV: mockKV }

      const result = validateBindings(env, {
        required: ['DO'],
        optional: ['KV', 'R2'],
      })

      expect(result.valid).toBe(false)
      expect(result.missingBindings).toContain('DO')
      expect(result.missingOptional).toContain('R2')
      expect(result.missingOptional).not.toContain('KV')
    })
  })
})

// ============================================================================
// Lazy vs Eager Validation Tests
// ============================================================================

describe('Validation Timing', () => {
  describe('lazy validation (default)', () => {
    it('getBinding should not throw even for invalid binding names', () => {
      const env: MockEnv = { DO: mockDO }

      // Lazy validation - just returns undefined
      expect(() => getBinding(env, 'DEFINITELY_NOT_A_BINDING')).not.toThrow()
    })

    it('getBindingOrThrow should throw at access time, not at import time', () => {
      const env: MockEnv = {}

      // The throw happens when we call the function, not before
      // This tests lazy validation behavior
      let threw = false
      try {
        getBindingOrThrow(env, 'DO')
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })
  })

  describe('eager validation (startup)', () => {
    it('validateBindings should check all bindings at once', () => {
      const env: MockEnv = {}

      // Eager validation - checks everything upfront
      const result = validateBindings(env, ['DO', 'KV', 'R2', 'PIPELINE'])

      expect(result.missingBindings).toHaveLength(4)
      expect(result.missingBindings).toEqual(
        expect.arrayContaining(['DO', 'KV', 'R2', 'PIPELINE'])
      )
    })

    it('validateBindings should enable fail-fast on startup', () => {
      const env: MockEnv = { DO: mockDO }

      // Use case: validate at worker startup
      const result = validateBindings(env, ['DO', 'KV'])

      if (!result.valid) {
        // In production, this would throw/exit before handling requests
        expect(result.missingBindings).toContain('KV')
      }
    })
  })
})

// ============================================================================
// Integration with Existing Code Patterns
// ============================================================================

describe('Integration Patterns', () => {
  it('should work with dynamic binding name from config', () => {
    // Pattern from api/index.ts:410
    // const binding = config.doClass ? (env[config.doClass as keyof Env] as ...) : env.DO
    const env: MockEnv = { DO: mockDO, REPLICA_DO: mockDO }
    const config = { doClass: 'REPLICA_DO' }

    const binding = getBinding(env, config.doClass as string)

    expect(binding).toBe(mockDO)
  })

  it('should handle dynamic binding name that does not exist', () => {
    const env: MockEnv = { DO: mockDO }
    const config = { doClass: 'SHARD_DO' }

    const binding = getBinding(env, config.doClass as string)

    expect(binding).toBeUndefined()
  })

  it('should throw descriptive error when dynamic binding missing', () => {
    const env: MockEnv = { DO: mockDO, KV: mockKV }
    const config = { doClass: 'SHARD_DO' }

    expect(() => getBindingOrThrow(env, config.doClass as string)).toThrow(BindingError)

    try {
      getBindingOrThrow(env, config.doClass as string)
    } catch (e) {
      const error = e as BindingError
      expect(error.message).toContain('SHARD_DO')
      expect(error.availableBindings).toContain('DO')
      expect(error.availableBindings).toContain('KV')
    }
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty env object', () => {
    const env = {}

    const result = getBinding(env, 'DO')

    expect(result).toBeUndefined()
  })

  it('should handle null binding value', () => {
    const env = { DO: null }

    const result = getBinding(env, 'DO')

    // null should be treated as missing
    expect(result).toBeUndefined()
  })

  it('should handle undefined binding value', () => {
    const env = { DO: undefined }

    const result = getBinding(env, 'DO')

    expect(result).toBeUndefined()
  })

  it('should handle empty string binding name', () => {
    const env: MockEnv = { DO: mockDO }

    expect(() => getBindingOrThrow(env, '')).toThrow(BindingError)
  })

  it('should filter out non-binding properties from availableBindings', () => {
    // env might have things like toString, constructor, etc.
    const env: MockEnv = { DO: mockDO }

    const result = validateBindings(env, ['KV'])

    // Should only list actual bindings, not prototype properties
    expect(result.availableBindings).not.toContain('toString')
    expect(result.availableBindings).not.toContain('constructor')
    expect(result.availableBindings).toContain('DO')
  })
})
