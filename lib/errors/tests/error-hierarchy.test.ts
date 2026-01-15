/**
 * Error Class Hierarchy - TDD RED Phase Tests
 *
 * These tests define the expected behavior for a comprehensive error class hierarchy
 * that provides structured error handling with retryability discrimination.
 *
 * Issue: do-mdo4 (Error Class Hierarchy)
 *
 * The hierarchy should be:
 *
 * ```
 * DotdoError (base)
 * ├── TransientError (retryable = true)
 * │   ├── ShardError (shard-related failures)
 * │   └── NetworkError (network-related failures)
 * └── PermanentError (retryable = false)
 *     ├── AuthError (authentication/authorization failures)
 *     ├── ConfigError (configuration errors)
 *     │   └── BindingError (missing/invalid bindings)
 *     └── ValidationError (input validation errors)
 * ```
 *
 * Error codes follow POSIX-style naming: EAUTH, ECONFIG, ESHARD, EBIND
 *
 * All tests in this file should FAIL initially because the classes don't exist yet.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// These imports will fail because the module doesn't exist yet
// This is the TDD RED phase - we're defining the interface first
// The implementation will be created at: lib/errors/hierarchy.ts
import {
  DotdoError,
  TransientError,
  PermanentError,
  AuthError,
  ConfigError,
  ShardError,
  BindingError,
  // Error code constants
  EAUTH,
  ECONFIG,
  ESHARD,
  EBIND,
  ENETWORK,
  EVALIDATION,
  EINTERNAL,
  // Type guards
  isRetryable,
  isTransient,
  isPermanent,
  isDotdoError,
} from '../hierarchy'

// ============================================================================
// DotdoError Base Class Tests
// ============================================================================

describe('DotdoError base class', () => {
  describe('construction', () => {
    it('should extend Error', () => {
      const error = new DotdoError('ETEST', 'Test error')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should accept code and message', () => {
      const error = new DotdoError('ETEST', 'Test message')
      expect(error.code).toBe('ETEST')
      expect(error.message).toBe('Test message')
    })

    it('should accept optional cause', () => {
      const cause = new Error('Original error')
      const error = new DotdoError('EWRAP', 'Wrapped error', { cause })
      expect(error.cause).toBe(cause)
    })

    it('should auto-generate timestamp on creation', () => {
      const before = Date.now()
      const error = new DotdoError('ETIME', 'Timestamp test')
      const after = Date.now()

      expect(error.timestamp).toBeDefined()
      expect(error.timestamp).toBeGreaterThanOrEqual(before)
      expect(error.timestamp).toBeLessThanOrEqual(after)
    })

    it('should accept custom timestamp', () => {
      const customTime = 1704067200000 // 2024-01-01T00:00:00Z
      const error = new DotdoError('ETIME', 'Custom timestamp', {
        timestamp: customTime,
      })
      expect(error.timestamp).toBe(customTime)
    })

    it('should accept context metadata', () => {
      const error = new DotdoError('ECTX', 'Context test', {
        context: { userId: 'user-123', operation: 'create' },
      })
      expect(error.context).toEqual({ userId: 'user-123', operation: 'create' })
    })

    it('should have name property set to class name', () => {
      const error = new DotdoError('ENAME', 'Name test')
      expect(error.name).toBe('DotdoError')
    })

    it('should capture stack trace', () => {
      const error = new DotdoError('ESTACK', 'Stack test')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('DotdoError')
    })
  })

  describe('retryability', () => {
    it('should have isRetryable property defaulting to false', () => {
      const error = new DotdoError('ERETRY', 'Retry test')
      expect(error.isRetryable).toBe(false)
    })

    it('should allow explicit retryable setting', () => {
      const error = new DotdoError('ERETRY', 'Retry test', { isRetryable: true })
      expect(error.isRetryable).toBe(true)
    })
  })

  describe('serialization', () => {
    it('should serialize to JSON with required fields', () => {
      const error = new DotdoError('EJSON', 'JSON test')
      const json = error.toJSON()

      expect(json).toHaveProperty('name', 'DotdoError')
      expect(json).toHaveProperty('code', 'EJSON')
      expect(json).toHaveProperty('message', 'JSON test')
      expect(json).toHaveProperty('timestamp')
      expect(json).toHaveProperty('isRetryable', false)
    })

    it('should include context in JSON when present', () => {
      const error = new DotdoError('ECTX', 'Context test', {
        context: { key: 'value' },
      })
      const json = error.toJSON()

      expect(json.context).toEqual({ key: 'value' })
    })

    it('should serialize cause chain', () => {
      const cause = new Error('Original')
      const error = new DotdoError('EWRAP', 'Wrapped', { cause })
      const json = error.toJSON()

      expect(json.cause).toEqual({
        name: 'Error',
        message: 'Original',
      })
    })

    it('should serialize nested DotdoError cause', () => {
      const inner = new DotdoError('EINNER', 'Inner error')
      const outer = new DotdoError('EOUTER', 'Outer error', { cause: inner })
      const json = outer.toJSON()

      expect(json.cause).toHaveProperty('code', 'EINNER')
      expect(json.cause).toHaveProperty('timestamp')
    })

    it('should not include undefined optional fields', () => {
      const error = new DotdoError('ECLEAN', 'Clean JSON')
      const json = error.toJSON()

      expect(json).not.toHaveProperty('context')
      expect(json).not.toHaveProperty('cause')
    })

    it('should be JSON.stringify compatible', () => {
      const error = new DotdoError('ESTR', 'Stringify test', {
        context: { num: 42 },
      })
      const str = JSON.stringify(error)
      const parsed = JSON.parse(str)

      expect(parsed.code).toBe('ESTR')
      expect(parsed.context.num).toBe(42)
    })
  })

  describe('toString', () => {
    it('should return formatted string representation', () => {
      const error = new DotdoError('ESTR', 'String test')
      const str = error.toString()

      expect(str).toContain('DotdoError')
      expect(str).toContain('ESTR')
      expect(str).toContain('String test')
    })

    it('should include context in string when present', () => {
      const error = new DotdoError('ECTX', 'Context string', {
        context: { id: '123' },
      })
      const str = error.toString()

      expect(str).toContain('id')
      expect(str).toContain('123')
    })
  })
})

// ============================================================================
// TransientError Tests (Retryable Errors)
// ============================================================================

describe('TransientError (retryable errors)', () => {
  describe('construction', () => {
    it('should extend DotdoError', () => {
      const error = new TransientError('ETRANS', 'Transient error')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(TransientError)
    })

    it('should have isRetryable = true by default', () => {
      const error = new TransientError('ETRANS', 'Transient error')
      expect(error.isRetryable).toBe(true)
    })

    it('should have name = TransientError', () => {
      const error = new TransientError('ETRANS', 'Transient error')
      expect(error.name).toBe('TransientError')
    })

    it('should accept retryAfter hint', () => {
      const error = new TransientError('ETRANS', 'Retry later', {
        retryAfter: 5000,
      })
      expect(error.retryAfter).toBe(5000)
    })

    it('should accept maxRetries hint', () => {
      const error = new TransientError('ETRANS', 'Limited retries', {
        maxRetries: 3,
      })
      expect(error.maxRetries).toBe(3)
    })
  })

  describe('serialization', () => {
    it('should include retryAfter in JSON when set', () => {
      const error = new TransientError('ETRANS', 'Transient', {
        retryAfter: 1000,
      })
      const json = error.toJSON()

      expect(json.retryAfter).toBe(1000)
    })

    it('should include maxRetries in JSON when set', () => {
      const error = new TransientError('ETRANS', 'Transient', {
        maxRetries: 5,
      })
      const json = error.toJSON()

      expect(json.maxRetries).toBe(5)
    })
  })
})

// ============================================================================
// PermanentError Tests (Non-Retryable Errors)
// ============================================================================

describe('PermanentError (non-retryable errors)', () => {
  describe('construction', () => {
    it('should extend DotdoError', () => {
      const error = new PermanentError('EPERM', 'Permanent error')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(PermanentError)
    })

    it('should have isRetryable = false by default', () => {
      const error = new PermanentError('EPERM', 'Permanent error')
      expect(error.isRetryable).toBe(false)
    })

    it('should have name = PermanentError', () => {
      const error = new PermanentError('EPERM', 'Permanent error')
      expect(error.name).toBe('PermanentError')
    })

    it('should not allow override to retryable', () => {
      // PermanentError should enforce non-retryability
      const error = new PermanentError('EPERM', 'Permanent', {
        isRetryable: true, // This should be ignored or throw
      })
      expect(error.isRetryable).toBe(false)
    })
  })
})

// ============================================================================
// AuthError Tests
// ============================================================================

describe('AuthError (authentication/authorization errors)', () => {
  describe('construction', () => {
    it('should extend PermanentError', () => {
      const error = new AuthError('Unauthorized access')
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(AuthError)
    })

    it('should have code = EAUTH by default', () => {
      const error = new AuthError('Unauthorized')
      expect(error.code).toBe(EAUTH)
    })

    it('should have name = AuthError', () => {
      const error = new AuthError('Auth error')
      expect(error.name).toBe('AuthError')
    })

    it('should have isRetryable = false', () => {
      const error = new AuthError('Auth error')
      expect(error.isRetryable).toBe(false)
    })

    it('should have httpStatus = 401 for unauthorized', () => {
      const error = new AuthError('Unauthorized')
      expect(error.httpStatus).toBe(401)
    })

    it('should have httpStatus = 403 for forbidden', () => {
      const error = new AuthError('Forbidden', { forbidden: true })
      expect(error.httpStatus).toBe(403)
    })
  })

  describe('factory methods', () => {
    it('should have static unauthorized() method', () => {
      const error = AuthError.unauthorized()
      expect(error.message).toContain('unauthorized')
      expect(error.httpStatus).toBe(401)
    })

    it('should have static forbidden() method', () => {
      const error = AuthError.forbidden('admin resource')
      expect(error.message).toContain('admin resource')
      expect(error.httpStatus).toBe(403)
    })

    it('should have static tokenExpired() method', () => {
      const error = AuthError.tokenExpired()
      expect(error.message).toContain('expired')
    })

    it('should have static invalidCredentials() method', () => {
      const error = AuthError.invalidCredentials()
      expect(error.message).toContain('credentials')
    })
  })
})

// ============================================================================
// ConfigError Tests
// ============================================================================

describe('ConfigError (configuration errors)', () => {
  describe('construction', () => {
    it('should extend PermanentError', () => {
      const error = new ConfigError('Invalid configuration')
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(ConfigError)
    })

    it('should have code = ECONFIG by default', () => {
      const error = new ConfigError('Config error')
      expect(error.code).toBe(ECONFIG)
    })

    it('should have name = ConfigError', () => {
      const error = new ConfigError('Config error')
      expect(error.name).toBe('ConfigError')
    })

    it('should have isRetryable = false', () => {
      const error = new ConfigError('Config error')
      expect(error.isRetryable).toBe(false)
    })

    it('should accept configKey for context', () => {
      const error = new ConfigError('Missing value', { configKey: 'API_KEY' })
      expect(error.configKey).toBe('API_KEY')
    })
  })

  describe('factory methods', () => {
    it('should have static missingKey() method', () => {
      const error = ConfigError.missingKey('DATABASE_URL')
      expect(error.message).toContain('DATABASE_URL')
      expect(error.configKey).toBe('DATABASE_URL')
    })

    it('should have static invalidValue() method', () => {
      const error = ConfigError.invalidValue('PORT', '65536', 'number 1-65535')
      expect(error.message).toContain('PORT')
      expect(error.message).toContain('65536')
    })

    it('should have static fileNotFound() method', () => {
      const error = ConfigError.fileNotFound('.env.local')
      expect(error.message).toContain('.env.local')
    })
  })
})

// ============================================================================
// ShardError Tests
// ============================================================================

describe('ShardError (shard-related errors)', () => {
  describe('construction', () => {
    it('should extend TransientError', () => {
      const error = new ShardError('Shard unavailable')
      expect(error).toBeInstanceOf(TransientError)
      expect(error).toBeInstanceOf(ShardError)
    })

    it('should have code = ESHARD by default', () => {
      const error = new ShardError('Shard error')
      expect(error.code).toBe(ESHARD)
    })

    it('should have name = ShardError', () => {
      const error = new ShardError('Shard error')
      expect(error.name).toBe('ShardError')
    })

    it('should have isRetryable = true', () => {
      const error = new ShardError('Shard error')
      expect(error.isRetryable).toBe(true)
    })

    it('should accept shardId', () => {
      const error = new ShardError('Shard offline', { shardId: 42 })
      expect(error.shardId).toBe(42)
    })

    it('should accept shardKey', () => {
      const error = new ShardError('Routing failed', {
        shardKey: 'user:12345',
      })
      expect(error.shardKey).toBe('user:12345')
    })
  })

  describe('factory methods', () => {
    it('should have static unavailable() method', () => {
      const error = ShardError.unavailable(3)
      expect(error.shardId).toBe(3)
      expect(error.message).toContain('unavailable')
    })

    it('should have static routingFailed() method', () => {
      const error = ShardError.routingFailed('tenant:abc')
      expect(error.shardKey).toBe('tenant:abc')
      expect(error.message).toContain('routing')
    })

    it('should have static overloaded() method', () => {
      const error = ShardError.overloaded(7, { retryAfter: 2000 })
      expect(error.shardId).toBe(7)
      expect(error.retryAfter).toBe(2000)
    })
  })

  describe('serialization', () => {
    it('should include shardId in JSON', () => {
      const error = new ShardError('Shard error', { shardId: 5 })
      const json = error.toJSON()
      expect(json.shardId).toBe(5)
    })

    it('should include shardKey in JSON', () => {
      const error = new ShardError('Shard error', { shardKey: 'key123' })
      const json = error.toJSON()
      expect(json.shardKey).toBe('key123')
    })
  })
})

// ============================================================================
// BindingError Tests
// ============================================================================

describe('BindingError (binding-related errors)', () => {
  describe('construction', () => {
    it('should extend ConfigError', () => {
      const error = new BindingError('Missing binding')
      expect(error).toBeInstanceOf(ConfigError)
      expect(error).toBeInstanceOf(BindingError)
    })

    it('should have code = EBIND by default', () => {
      const error = new BindingError('Binding error')
      expect(error.code).toBe(EBIND)
    })

    it('should have name = BindingError', () => {
      const error = new BindingError('Binding error')
      expect(error.name).toBe('BindingError')
    })

    it('should have isRetryable = false', () => {
      const error = new BindingError('Binding error')
      expect(error.isRetryable).toBe(false)
    })

    it('should accept bindingName', () => {
      const error = new BindingError('Binding missing', {
        bindingName: 'DATABASE',
      })
      expect(error.bindingName).toBe('DATABASE')
    })

    it('should accept bindingType', () => {
      const error = new BindingError('Wrong type', {
        bindingName: 'CACHE',
        bindingType: 'KVNamespace',
      })
      expect(error.bindingType).toBe('KVNamespace')
    })
  })

  describe('factory methods', () => {
    it('should have static missing() method', () => {
      const error = BindingError.missing('DO_NAMESPACE')
      expect(error.bindingName).toBe('DO_NAMESPACE')
      expect(error.message).toContain('DO_NAMESPACE')
      expect(error.message).toContain('missing')
    })

    it('should have static wrongType() method', () => {
      const error = BindingError.wrongType('CACHE', 'R2Bucket', 'KVNamespace')
      expect(error.bindingName).toBe('CACHE')
      expect(error.message).toContain('R2Bucket')
      expect(error.message).toContain('KVNamespace')
    })

    it('should have static notConfigured() method', () => {
      const error = BindingError.notConfigured('AI')
      expect(error.bindingName).toBe('AI')
      expect(error.message).toContain('not configured')
    })
  })

  describe('serialization', () => {
    it('should include bindingName in JSON', () => {
      const error = new BindingError('Error', { bindingName: 'MY_BINDING' })
      const json = error.toJSON()
      expect(json.bindingName).toBe('MY_BINDING')
    })

    it('should include bindingType in JSON', () => {
      const error = new BindingError('Error', {
        bindingName: 'X',
        bindingType: 'DurableObjectNamespace',
      })
      const json = error.toJSON()
      expect(json.bindingType).toBe('DurableObjectNamespace')
    })
  })
})

// ============================================================================
// Error Code Constants Tests
// ============================================================================

describe('error code constants', () => {
  it('should export EAUTH constant', () => {
    expect(EAUTH).toBe('EAUTH')
  })

  it('should export ECONFIG constant', () => {
    expect(ECONFIG).toBe('ECONFIG')
  })

  it('should export ESHARD constant', () => {
    expect(ESHARD).toBe('ESHARD')
  })

  it('should export EBIND constant', () => {
    expect(EBIND).toBe('EBIND')
  })

  it('should export ENETWORK constant', () => {
    expect(ENETWORK).toBe('ENETWORK')
  })

  it('should export EVALIDATION constant', () => {
    expect(EVALIDATION).toBe('EVALIDATION')
  })

  it('should export EINTERNAL constant', () => {
    expect(EINTERNAL).toBe('EINTERNAL')
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('type guards', () => {
  describe('isDotdoError', () => {
    it('should return true for DotdoError instances', () => {
      const error = new DotdoError('ETEST', 'Test')
      expect(isDotdoError(error)).toBe(true)
    })

    it('should return true for subclass instances', () => {
      const errors = [
        new TransientError('E', 'test'),
        new PermanentError('E', 'test'),
        new AuthError('test'),
        new ConfigError('test'),
        new ShardError('test'),
        new BindingError('test'),
      ]
      for (const error of errors) {
        expect(isDotdoError(error)).toBe(true)
      }
    })

    it('should return false for plain Error', () => {
      const error = new Error('Plain error')
      expect(isDotdoError(error)).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(isDotdoError(null)).toBe(false)
      expect(isDotdoError(undefined)).toBe(false)
      expect(isDotdoError('error string')).toBe(false)
      expect(isDotdoError({ code: 'FAKE' })).toBe(false)
    })
  })

  describe('isRetryable', () => {
    it('should return true for TransientError', () => {
      const error = new TransientError('E', 'test')
      expect(isRetryable(error)).toBe(true)
    })

    it('should return true for ShardError', () => {
      const error = new ShardError('test')
      expect(isRetryable(error)).toBe(true)
    })

    it('should return false for PermanentError', () => {
      const error = new PermanentError('E', 'test')
      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for AuthError', () => {
      const error = new AuthError('test')
      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for ConfigError', () => {
      const error = new ConfigError('test')
      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for BindingError', () => {
      const error = new BindingError('test')
      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for plain Error', () => {
      const error = new Error('Plain error')
      expect(isRetryable(error)).toBe(false)
    })
  })

  describe('isTransient', () => {
    it('should return true for TransientError', () => {
      const error = new TransientError('E', 'test')
      expect(isTransient(error)).toBe(true)
    })

    it('should return true for ShardError', () => {
      const error = new ShardError('test')
      expect(isTransient(error)).toBe(true)
    })

    it('should return false for PermanentError', () => {
      const error = new PermanentError('E', 'test')
      expect(isTransient(error)).toBe(false)
    })

    it('should return false for AuthError', () => {
      const error = new AuthError('test')
      expect(isTransient(error)).toBe(false)
    })
  })

  describe('isPermanent', () => {
    it('should return true for PermanentError', () => {
      const error = new PermanentError('E', 'test')
      expect(isPermanent(error)).toBe(true)
    })

    it('should return true for AuthError', () => {
      const error = new AuthError('test')
      expect(isPermanent(error)).toBe(true)
    })

    it('should return true for ConfigError', () => {
      const error = new ConfigError('test')
      expect(isPermanent(error)).toBe(true)
    })

    it('should return true for BindingError', () => {
      const error = new BindingError('test')
      expect(isPermanent(error)).toBe(true)
    })

    it('should return false for TransientError', () => {
      const error = new TransientError('E', 'test')
      expect(isPermanent(error)).toBe(false)
    })

    it('should return false for ShardError', () => {
      const error = new ShardError('test')
      expect(isPermanent(error)).toBe(false)
    })
  })
})

// ============================================================================
// Error Hierarchy Relationships Tests
// ============================================================================

describe('error hierarchy relationships', () => {
  describe('inheritance chain', () => {
    it('TransientError extends DotdoError', () => {
      expect(new TransientError('E', 't')).toBeInstanceOf(DotdoError)
    })

    it('PermanentError extends DotdoError', () => {
      expect(new PermanentError('E', 't')).toBeInstanceOf(DotdoError)
    })

    it('AuthError extends PermanentError extends DotdoError', () => {
      const error = new AuthError('test')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(AuthError)
    })

    it('ConfigError extends PermanentError extends DotdoError', () => {
      const error = new ConfigError('test')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(ConfigError)
    })

    it('ShardError extends TransientError extends DotdoError', () => {
      const error = new ShardError('test')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(TransientError)
      expect(error).toBeInstanceOf(ShardError)
    })

    it('BindingError extends ConfigError extends PermanentError', () => {
      const error = new BindingError('test')
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(ConfigError)
      expect(error).toBeInstanceOf(BindingError)
    })
  })

  describe('polymorphism', () => {
    it('should handle mixed error types in catch', () => {
      const errors: DotdoError[] = [
        new TransientError('E', 'transient'),
        new PermanentError('E', 'permanent'),
        new AuthError('auth'),
        new ConfigError('config'),
        new ShardError('shard'),
        new BindingError('binding'),
      ]

      for (const error of errors) {
        expect(error.code).toBeDefined()
        expect(error.message).toBeDefined()
        expect(error.timestamp).toBeDefined()
        expect(typeof error.isRetryable).toBe('boolean')
        expect(typeof error.toJSON()).toBe('object')
      }
    })

    it('should discriminate errors by instanceof in catch block', () => {
      function handleError(error: DotdoError): string {
        if (error instanceof AuthError) return 'auth'
        if (error instanceof BindingError) return 'binding'
        if (error instanceof ConfigError) return 'config'
        if (error instanceof ShardError) return 'shard'
        if (error instanceof TransientError) return 'transient'
        if (error instanceof PermanentError) return 'permanent'
        return 'base'
      }

      expect(handleError(new AuthError('test'))).toBe('auth')
      expect(handleError(new BindingError('test'))).toBe('binding')
      expect(handleError(new ConfigError('test'))).toBe('config')
      expect(handleError(new ShardError('test'))).toBe('shard')
      expect(handleError(new TransientError('E', 'test'))).toBe('transient')
      expect(handleError(new PermanentError('E', 'test'))).toBe('permanent')
      expect(handleError(new DotdoError('E', 'test'))).toBe('base')
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('edge cases', () => {
  it('should handle empty message', () => {
    const error = new DotdoError('EEMPTY', '')
    expect(error.message).toBe('')
    expect(error.code).toBe('EEMPTY')
  })

  it('should handle special characters in message', () => {
    const msg = 'Error: "quotes" <brackets> & ampersand \n newline'
    const error = new DotdoError('ESPECIAL', msg)
    expect(error.message).toBe(msg)
    expect(error.toJSON().message).toBe(msg)
  })

  it('should handle unicode in message', () => {
    const msg = 'Error: 你好世界 emoji'
    const error = new DotdoError('EUNICODE', msg)
    expect(error.message).toBe(msg)
  })

  it('should handle circular context gracefully', () => {
    const context: Record<string, unknown> = { self: null }
    context.self = context // Create circular reference

    // Should not throw on construction
    const error = new DotdoError('ECIRC', 'Circular', { context })
    expect(error.context).toBe(context)

    // toJSON should handle circular references gracefully
    expect(() => error.toJSON()).not.toThrow()
  })

  it('should handle very long messages', () => {
    const longMsg = 'x'.repeat(10000)
    const error = new DotdoError('ELONG', longMsg)
    expect(error.message.length).toBe(10000)
  })

  it('should handle null cause gracefully', () => {
    const error = new DotdoError('ENULL', 'Null cause', { cause: null as any })
    expect(error.cause).toBeNull()
    // JSON should not include null cause
    expect(error.toJSON().cause).toBeUndefined()
  })

  it('should handle non-Error cause', () => {
    const error = new DotdoError('EOBJ', 'Object cause', {
      cause: { reason: 'something' } as any,
    })
    // Should still serialize the cause somehow
    const json = error.toJSON()
    expect(json.cause).toBeDefined()
  })
})

// ============================================================================
// Real-World Usage Pattern Tests
// ============================================================================

describe('real-world usage patterns', () => {
  describe('retry logic integration', () => {
    it('should support retry decision making', async () => {
      async function fetchWithRetry<T>(
        fn: () => Promise<T>,
        maxRetries = 3
      ): Promise<T> {
        let lastError: Error | undefined
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await fn()
          } catch (error) {
            lastError = error as Error
            if (!isRetryable(error)) {
              throw error // Don't retry permanent errors
            }
            // Get retry delay from error if available
            const delay =
              error instanceof TransientError ? (error.retryAfter ?? 1000) : 1000
            await new Promise((r) => setTimeout(r, delay))
          }
        }
        throw lastError
      }

      // Simulate a permanent error - should throw immediately
      let attempts = 0
      await expect(
        fetchWithRetry(async () => {
          attempts++
          throw new AuthError('Unauthorized')
        })
      ).rejects.toThrow(AuthError)
      expect(attempts).toBe(1) // Should not retry

      // Simulate a transient error that succeeds on retry
      attempts = 0
      const result = await fetchWithRetry(async () => {
        attempts++
        if (attempts < 2) {
          throw new ShardError('Shard busy', { retryAfter: 10 })
        }
        return 'success'
      })
      expect(result).toBe('success')
      expect(attempts).toBe(2)
    })
  })

  describe('error boundary pattern', () => {
    it('should support error categorization for UI', () => {
      function categorizeError(error: unknown): {
        type: 'auth' | 'config' | 'network' | 'unknown'
        userMessage: string
        shouldRetry: boolean
      } {
        if (error instanceof AuthError) {
          return {
            type: 'auth',
            userMessage: 'Please sign in again',
            shouldRetry: false,
          }
        }
        if (error instanceof ConfigError) {
          return {
            type: 'config',
            userMessage: 'Application configuration error',
            shouldRetry: false,
          }
        }
        if (error instanceof TransientError) {
          return {
            type: 'network',
            userMessage: 'Temporary error, please try again',
            shouldRetry: true,
          }
        }
        return {
          type: 'unknown',
          userMessage: 'An unexpected error occurred',
          shouldRetry: false,
        }
      }

      expect(categorizeError(new AuthError('x')).type).toBe('auth')
      expect(categorizeError(new ConfigError('x')).type).toBe('config')
      expect(categorizeError(new ShardError('x')).type).toBe('network')
      expect(categorizeError(new Error('x')).type).toBe('unknown')
    })
  })

  describe('logging integration', () => {
    it('should support structured logging', () => {
      function logError(error: unknown): Record<string, unknown> {
        if (isDotdoError(error)) {
          return {
            level: error.isRetryable ? 'warn' : 'error',
            ...error.toJSON(),
          }
        }
        return {
          level: 'error',
          name: error instanceof Error ? error.name : 'Unknown',
          message: String(error),
        }
      }

      const transientLog = logError(new ShardError('test', { shardId: 5 }))
      expect(transientLog.level).toBe('warn')
      expect(transientLog.shardId).toBe(5)

      const permanentLog = logError(new AuthError('unauthorized'))
      expect(permanentLog.level).toBe('error')
      expect(permanentLog.code).toBe(EAUTH)
    })
  })
})
