/**
 * Validation Tests - TDD for port validation utility
 */

import { describe, it, expect } from 'vitest'
import { parsePort } from '../utils/validation'

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
    it('should throw "Invalid port" for "8787abc"', () => {
      expect(() => parsePort('8787abc')).toThrow('Invalid port')
    })

    it('should throw "Invalid port" for "abc"', () => {
      expect(() => parsePort('abc')).toThrow('Invalid port')
    })

    it('should throw "Invalid port" for empty string', () => {
      expect(() => parsePort('')).toThrow('Invalid port')
    })
  })

  describe('invalid ports - out of range', () => {
    it('should throw "Invalid port" for "-1" (negative)', () => {
      expect(() => parsePort('-1')).toThrow('Invalid port')
    })

    it('should throw "Invalid port" for "0" (below minimum)', () => {
      expect(() => parsePort('0')).toThrow('Invalid port')
    })

    it('should throw "Invalid port" for "65536" (above maximum)', () => {
      expect(() => parsePort('65536')).toThrow('Invalid port')
    })

    it('should throw "Invalid port" for "100000" (way above maximum)', () => {
      expect(() => parsePort('100000')).toThrow('Invalid port')
    })
  })

  describe('error message format', () => {
    it('should include the invalid value in the error message', () => {
      expect(() => parsePort('abc')).toThrow('"abc"')
    })

    it('should include the valid range in the error message', () => {
      expect(() => parsePort('0')).toThrow('between 1 and 65535')
    })
  })
})
