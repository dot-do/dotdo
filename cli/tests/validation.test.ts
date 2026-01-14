/**
 * Validation Tests - TDD for validation utilities
 */

import { describe, it, expect } from 'vitest'
import { parsePort, validatePhoneNumber, validateEmail, parseJSON } from '../utils/validation'
import { ValidationError, ErrorCode, ExitCode } from '../utils/errors'

describe('parsePort', () => {
  describe('valid ports', () => {
    it('should parse "4000" and return 4000', () => {
      expect(parsePort('4000')).toBe(4000)
    })

    it('should parse "65535" and return 65535 (max valid port)', () => {
      expect(parsePort('65535')).toBe(65535)
    })

    it('should parse "1" and return 1 (min valid port)', () => {
      expect(parsePort('1')).toBe(1)
    })

    it('should parse "8787" and return 8787', () => {
      expect(parsePort('8787')).toBe(8787)
    })
  })

  describe('invalid ports - non-numeric', () => {
    it('should throw ValidationError for "8787abc"', () => {
      expect(() => parsePort('8787abc')).toThrow(ValidationError)
      expect(() => parsePort('8787abc')).toThrow('Invalid port')
    })

    it('should throw ValidationError for "abc"', () => {
      expect(() => parsePort('abc')).toThrow(ValidationError)
      expect(() => parsePort('abc')).toThrow('Invalid port')
    })

    it('should throw ValidationError for empty string', () => {
      expect(() => parsePort('')).toThrow(ValidationError)
      expect(() => parsePort('')).toThrow('Invalid port')
    })
  })

  describe('invalid ports - out of range', () => {
    it('should throw ValidationError for "-1" (negative)', () => {
      expect(() => parsePort('-1')).toThrow(ValidationError)
      expect(() => parsePort('-1')).toThrow('Invalid port')
    })

    it('should throw ValidationError for "0" (below minimum)', () => {
      expect(() => parsePort('0')).toThrow(ValidationError)
      expect(() => parsePort('0')).toThrow('Invalid port')
    })

    it('should throw ValidationError for "65536" (above maximum)', () => {
      expect(() => parsePort('65536')).toThrow(ValidationError)
      expect(() => parsePort('65536')).toThrow('Invalid port')
    })

    it('should throw ValidationError for "100000" (way above maximum)', () => {
      expect(() => parsePort('100000')).toThrow(ValidationError)
    })
  })

  describe('error properties', () => {
    it('should have correct error code', () => {
      try {
        parsePort('abc')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const validationError = error as ValidationError
        expect(validationError.code).toBe(ErrorCode.INVALID_FORMAT)
        expect(validationError.exitCode).toBe(ExitCode.MISUSE)
      }
    })

    it('should include value in details', () => {
      try {
        parsePort('xyz')
      } catch (error) {
        const validationError = error as ValidationError
        expect(validationError.details?.received).toBe('xyz')
        expect(validationError.details?.expected).toContain('65535')
      }
    })
  })
})

describe('validatePhoneNumber', () => {
  describe('valid phone numbers', () => {
    it('accepts valid E.164 format', () => {
      expect(validatePhoneNumber('+15551234567')).toBe('+15551234567')
    })

    it('accepts international numbers', () => {
      expect(validatePhoneNumber('+442071234567')).toBe('+442071234567')
    })
  })

  describe('invalid phone numbers', () => {
    it('rejects numbers without +', () => {
      expect(() => validatePhoneNumber('15551234567')).toThrow(ValidationError)
    })

    it('rejects numbers starting with +0', () => {
      expect(() => validatePhoneNumber('+05551234567')).toThrow(ValidationError)
    })

    it('rejects empty string', () => {
      expect(() => validatePhoneNumber('')).toThrow(ValidationError)
    })

    it('rejects formatted numbers', () => {
      expect(() => validatePhoneNumber('+1 (555) 123-4567')).toThrow(ValidationError)
    })
  })
})

describe('validateEmail', () => {
  describe('valid emails', () => {
    it('accepts standard email', () => {
      expect(validateEmail('user@example.com')).toBe('user@example.com')
    })

    it('accepts subdomain email', () => {
      expect(validateEmail('user@mail.example.com')).toBe('user@mail.example.com')
    })

    it('accepts email with dots', () => {
      expect(validateEmail('first.last@example.com')).toBe('first.last@example.com')
    })
  })

  describe('invalid emails', () => {
    it('rejects email without @', () => {
      expect(() => validateEmail('userexample.com')).toThrow(ValidationError)
    })

    it('rejects email without domain', () => {
      expect(() => validateEmail('user@')).toThrow(ValidationError)
    })

    it('rejects email without TLD', () => {
      expect(() => validateEmail('user@example')).toThrow(ValidationError)
    })

    it('rejects empty string', () => {
      expect(() => validateEmail('')).toThrow(ValidationError)
    })
  })
})

describe('parseJSON', () => {
  describe('valid JSON', () => {
    it('parses object', () => {
      expect(parseJSON('{"key": "value"}', 'config')).toEqual({ key: 'value' })
    })

    it('parses array', () => {
      expect(parseJSON('[1, 2, 3]', 'data')).toEqual([1, 2, 3])
    })

    it('parses primitive', () => {
      expect(parseJSON('42', 'number')).toBe(42)
    })
  })

  describe('invalid JSON', () => {
    it('rejects invalid JSON', () => {
      expect(() => parseJSON('{invalid}', 'config')).toThrow(ValidationError)
    })

    it('includes field name in error', () => {
      try {
        parseJSON('{bad}', 'metadata')
      } catch (error) {
        expect((error as Error).message).toContain('metadata')
      }
    })
  })
})
