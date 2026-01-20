import { describe, it, expect } from 'vitest'
import {
  validateSecretPresent,
  validateSecretLength,
  validateSecret,
  getRequiredSecret,
  isSecretConfigured,
  MissingSecretError,
  SecretLengthError,
} from '../validation'

describe('validation', () => {
  describe('validateSecretPresent', () => {
    it('should pass for valid string', () => {
      expect(() => validateSecretPresent('secret', 'TEST_SECRET')).not.toThrow()
    })

    it('should pass for valid Uint8Array', () => {
      const secret = new TextEncoder().encode('my-secret')
      expect(() => validateSecretPresent(secret, 'TEST_SECRET')).not.toThrow()
    })

    it('should throw MissingSecretError for undefined', () => {
      expect(() => validateSecretPresent(undefined, 'TEST_SECRET')).toThrow(MissingSecretError)
      expect(() => validateSecretPresent(undefined, 'TEST_SECRET')).toThrow('TEST_SECRET is required')
    })

    it('should throw MissingSecretError for null', () => {
      expect(() => validateSecretPresent(null, 'TEST_SECRET')).toThrow(MissingSecretError)
    })

    it('should throw MissingSecretError for empty string', () => {
      expect(() => validateSecretPresent('', 'TEST_SECRET')).toThrow(MissingSecretError)
    })

    it('should throw MissingSecretError for empty Uint8Array', () => {
      expect(() => validateSecretPresent(new Uint8Array(0), 'TEST_SECRET')).toThrow(MissingSecretError)
    })

    it('should include context in error message', () => {
      expect(() => validateSecretPresent(undefined, 'JWT_SECRET', 'JWT validation')).toThrow(
        'JWT_SECRET is required for JWT validation'
      )
    })
  })

  describe('validateSecretLength', () => {
    it('should pass when secret meets minimum length', () => {
      expect(() => validateSecretLength('12345678901234567890123456789012', 32, 'TEST_SECRET')).not.toThrow()
    })

    it('should pass when secret exceeds minimum length', () => {
      expect(() => validateSecretLength('a'.repeat(64), 32, 'TEST_SECRET')).not.toThrow()
    })

    it('should throw SecretLengthError when secret is too short', () => {
      expect(() => validateSecretLength('short', 32, 'TEST_SECRET')).toThrow(SecretLengthError)
      expect(() => validateSecretLength('short', 32, 'TEST_SECRET')).toThrow(
        'TEST_SECRET must be at least 32 characters (got 5)'
      )
    })

    it('should handle zero length minimum', () => {
      expect(() => validateSecretLength('', 0, 'TEST_SECRET')).not.toThrow()
    })
  })

  describe('validateSecret', () => {
    it('should pass for valid secret meeting length requirement', () => {
      expect(() => validateSecret('12345678901234567890123456789012', 32, 'TEST_SECRET')).not.toThrow()
    })

    it('should throw MissingSecretError for undefined', () => {
      expect(() => validateSecret(undefined, 32, 'TEST_SECRET')).toThrow(MissingSecretError)
    })

    it('should throw SecretLengthError for short secret', () => {
      expect(() => validateSecret('short', 32, 'TEST_SECRET')).toThrow(SecretLengthError)
    })

    it('should include context in error message for missing secret', () => {
      expect(() => validateSecret(undefined, 32, 'DO_INTERNAL_SECRET', 'DO-to-DO signing')).toThrow(
        'DO_INTERNAL_SECRET is required for DO-to-DO signing'
      )
    })
  })

  describe('getRequiredSecret', () => {
    it('should return secret when present', () => {
      const env = { JWT_SECRET: 'my-secret' }
      expect(getRequiredSecret(env, 'JWT_SECRET')).toBe('my-secret')
    })

    it('should throw MissingSecretError when key is missing', () => {
      const env = {}
      expect(() => getRequiredSecret(env, 'JWT_SECRET')).toThrow(MissingSecretError)
      expect(() => getRequiredSecret(env, 'JWT_SECRET')).toThrow('JWT_SECRET is required')
    })

    it('should throw MissingSecretError when value is empty', () => {
      const env = { JWT_SECRET: '' }
      expect(() => getRequiredSecret(env, 'JWT_SECRET')).toThrow(MissingSecretError)
    })

    it('should throw MissingSecretError when value is not a string', () => {
      const env = { JWT_SECRET: 123 }
      expect(() => getRequiredSecret(env, 'JWT_SECRET')).toThrow(MissingSecretError)
    })

    it('should include context in error message', () => {
      const env = {}
      expect(() => getRequiredSecret(env, 'JWT_SECRET', 'authentication')).toThrow(
        'JWT_SECRET is required for authentication'
      )
    })
  })

  describe('isSecretConfigured', () => {
    it('should return true for valid string', () => {
      expect(isSecretConfigured('secret')).toBe(true)
    })

    it('should return false for undefined', () => {
      expect(isSecretConfigured(undefined)).toBe(false)
    })

    it('should return false for null', () => {
      expect(isSecretConfigured(null)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isSecretConfigured('')).toBe(false)
    })

    it('should return true when secret meets minimum length', () => {
      expect(isSecretConfigured('12345678901234567890123456789012', 32)).toBe(true)
    })

    it('should return false when secret is too short', () => {
      expect(isSecretConfigured('short', 32)).toBe(false)
    })

    it('should return true without minLength check', () => {
      expect(isSecretConfigured('s')).toBe(true)
    })
  })

  describe('MissingSecretError', () => {
    it('should have correct name', () => {
      const error = new MissingSecretError('TEST')
      expect(error.name).toBe('MissingSecretError')
    })

    it('should format message without context', () => {
      const error = new MissingSecretError('TEST_SECRET')
      expect(error.message).toBe('TEST_SECRET is required')
    })

    it('should format message with context', () => {
      const error = new MissingSecretError('TEST_SECRET', 'some operation')
      expect(error.message).toBe('TEST_SECRET is required for some operation')
    })
  })

  describe('SecretLengthError', () => {
    it('should have correct name', () => {
      const error = new SecretLengthError('TEST', 32, 16)
      expect(error.name).toBe('SecretLengthError')
    })

    it('should format message with lengths', () => {
      const error = new SecretLengthError('TEST_SECRET', 32, 16)
      expect(error.message).toBe('TEST_SECRET must be at least 32 characters (got 16)')
    })
  })
})
