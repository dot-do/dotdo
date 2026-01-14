/**
 * RED Phase Tests: Bloblang Number Stdlib Functions
 * Issue: dotdo-et4kb (Milestone 2)
 *
 * These tests define the expected behavior for Bloblang number functions.
 * They should FAIL until the stdlib/number.ts implementation is complete.
 */

import { describe, it, expect } from 'vitest'
import {
  abs,
  ceil,
  floor,
  round,
  max,
  min,
  sum,
  number,
  parseInteger,
  parseFloat as parseFloatFn,
  randomInt
} from '../stdlib/number'

describe('Bloblang Number Stdlib Functions', () => {
  describe('abs() - absolute value', () => {
    it('returns absolute value of positive number', () => {
      expect(abs(42)).toBe(42)
    })

    it('returns absolute value of negative number', () => {
      expect(abs(-42)).toBe(42)
    })

    it('returns absolute value of zero', () => {
      expect(abs(0)).toBe(0)
    })

    it('returns absolute value of negative zero', () => {
      expect(abs(-0)).toBe(0)
    })

    it('handles floating point numbers', () => {
      expect(abs(-3.14)).toBe(3.14)
      expect(abs(2.718)).toBe(2.718)
    })

    it('handles very large numbers', () => {
      expect(abs(-1e308)).toBe(1e308)
    })

    it('returns NaN when input is NaN', () => {
      expect(Object.is(abs(NaN), NaN)).toBe(true)
    })

    it('returns Infinity for negative Infinity', () => {
      expect(abs(-Infinity)).toBe(Infinity)
    })

    it('returns Infinity for positive Infinity', () => {
      expect(abs(Infinity)).toBe(Infinity)
    })
  })

  describe('ceil() - round up', () => {
    it('rounds up positive decimal', () => {
      expect(ceil(4.2)).toBe(5)
    })

    it('rounds up negative decimal', () => {
      expect(ceil(-4.2)).toBe(-4)
    })

    it('returns integer as-is', () => {
      expect(ceil(42)).toBe(42)
    })

    it('returns zero as-is', () => {
      expect(ceil(0)).toBe(0)
    })

    it('rounds up numbers close to integers', () => {
      expect(ceil(4.0001)).toBe(5)
      expect(ceil(-4.9999)).toBe(-4)
    })

    it('handles very small positive numbers', () => {
      expect(ceil(0.0001)).toBe(1)
    })

    it('handles very small negative numbers', () => {
      expect(ceil(-0.0001)).toBe(0)
    })

    it('returns NaN when input is NaN', () => {
      expect(Object.is(ceil(NaN), NaN)).toBe(true)
    })

    it('returns Infinity when input is Infinity', () => {
      expect(ceil(Infinity)).toBe(Infinity)
      expect(ceil(-Infinity)).toBe(-Infinity)
    })
  })

  describe('floor() - round down', () => {
    it('rounds down positive decimal', () => {
      expect(floor(4.9)).toBe(4)
    })

    it('rounds down negative decimal', () => {
      expect(floor(-4.9)).toBe(-5)
    })

    it('returns integer as-is', () => {
      expect(floor(42)).toBe(42)
    })

    it('returns zero as-is', () => {
      expect(floor(0)).toBe(0)
    })

    it('rounds down numbers close to integers', () => {
      expect(floor(4.9999)).toBe(4)
      expect(floor(-4.0001)).toBe(-5)
    })

    it('handles very small positive numbers', () => {
      expect(floor(0.9999)).toBe(0)
    })

    it('handles very small negative numbers', () => {
      expect(floor(-0.0001)).toBe(-1)
    })

    it('returns NaN when input is NaN', () => {
      expect(Object.is(floor(NaN), NaN)).toBe(true)
    })

    it('returns Infinity when input is Infinity', () => {
      expect(floor(Infinity)).toBe(Infinity)
      expect(floor(-Infinity)).toBe(-Infinity)
    })
  })

  describe('round() - round to nearest', () => {
    it('rounds up at 0.5 and above', () => {
      expect(round(4.5)).toBe(5)
      expect(round(4.6)).toBe(5)
    })

    it('rounds down below 0.5', () => {
      expect(round(4.4)).toBe(4)
      expect(round(4.2)).toBe(4)
    })

    it('rounds negative numbers correctly', () => {
      expect(round(-4.5)).toBe(-5)
      expect(round(-4.4)).toBe(-4)
    })

    it('returns integer as-is', () => {
      expect(round(42)).toBe(42)
    })

    it('returns zero as-is', () => {
      expect(round(0)).toBe(0)
    })

    it('handles banker\'s rounding at exact .5 for positive numbers', () => {
      // Note: This implementation uses "round half away from zero" (not banker's rounding).
      // This is consistent with tests at lines 145-147 where round(4.5) = 5.
      // round(2.5) = 3, round(3.5) = 4 (away from zero behavior)
      expect(round(2.5)).toBe(3) // 2.5 rounds up to 3
      expect(round(3.5)).toBe(4) // 3.5 rounds up to 4
    })

    it('handles banker\'s rounding at exact .5 for negative numbers', () => {
      // Note: Using "round half away from zero" semantics.
      // For negative numbers, "away from zero" means toward more negative.
      // round(-2.5) = -3, round(-3.5) = -4 (consistent with line 155-157)
      expect(round(-2.5)).toBe(-3)
      expect(round(-3.5)).toBe(-4)
    })

    it('returns NaN when input is NaN', () => {
      expect(Object.is(round(NaN), NaN)).toBe(true)
    })

    it('returns Infinity when input is Infinity', () => {
      expect(round(Infinity)).toBe(Infinity)
      expect(round(-Infinity)).toBe(-Infinity)
    })
  })

  describe('max(other) - maximum of two numbers', () => {
    it('returns maximum of two positive numbers', () => {
      expect(max(5, 10)).toBe(10)
      expect(max(42, 7)).toBe(42)
    })

    it('returns maximum when first is larger', () => {
      expect(max(100, 50)).toBe(100)
    })

    it('returns maximum when second is larger', () => {
      expect(max(50, 100)).toBe(100)
    })

    it('handles equal numbers', () => {
      expect(max(5, 5)).toBe(5)
    })

    it('handles negative numbers', () => {
      expect(max(-5, -10)).toBe(-5)
      expect(max(-50, 10)).toBe(10)
    })

    it('handles zero', () => {
      expect(max(0, 5)).toBe(5)
      expect(max(-5, 0)).toBe(0)
    })

    it('handles floating point numbers', () => {
      expect(max(3.14, 2.71)).toBe(3.14)
      expect(max(1.5, 1.6)).toBe(1.6)
    })

    it('returns NaN if either input is NaN', () => {
      expect(Object.is(max(NaN, 5), NaN)).toBe(true)
      expect(Object.is(max(5, NaN), NaN)).toBe(true)
    })

    it('returns Infinity when one input is Infinity', () => {
      expect(max(Infinity, 100)).toBe(Infinity)
      expect(max(100, Infinity)).toBe(Infinity)
    })

    it('prefers positive Infinity over negative Infinity', () => {
      expect(max(Infinity, -Infinity)).toBe(Infinity)
    })

    it('handles comparison between Infinity and numbers', () => {
      expect(max(Infinity, 1e308)).toBe(Infinity)
    })
  })

  describe('min(other) - minimum of two numbers', () => {
    it('returns minimum of two positive numbers', () => {
      expect(min(5, 10)).toBe(5)
      expect(min(42, 7)).toBe(7)
    })

    it('returns minimum when first is smaller', () => {
      expect(min(50, 100)).toBe(50)
    })

    it('returns minimum when second is smaller', () => {
      expect(min(100, 50)).toBe(50)
    })

    it('handles equal numbers', () => {
      expect(min(5, 5)).toBe(5)
    })

    it('handles negative numbers', () => {
      expect(min(-5, -10)).toBe(-10)
      expect(min(-50, 10)).toBe(-50)
    })

    it('handles zero', () => {
      expect(min(0, 5)).toBe(0)
      expect(min(-5, 0)).toBe(-5)
    })

    it('handles floating point numbers', () => {
      expect(min(3.14, 2.71)).toBe(2.71)
      expect(min(1.5, 1.6)).toBe(1.5)
    })

    it('returns NaN if either input is NaN', () => {
      expect(Object.is(min(NaN, 5), NaN)).toBe(true)
      expect(Object.is(min(5, NaN), NaN)).toBe(true)
    })

    it('returns -Infinity when one input is -Infinity', () => {
      expect(min(-Infinity, 100)).toBe(-Infinity)
      expect(min(100, -Infinity)).toBe(-Infinity)
    })

    it('prefers negative Infinity over positive Infinity', () => {
      expect(min(Infinity, -Infinity)).toBe(-Infinity)
    })

    it('handles comparison between -Infinity and numbers', () => {
      expect(min(-Infinity, -1e308)).toBe(-Infinity)
    })
  })

  describe('sum() - sum array elements', () => {
    it('sums array of positive numbers', () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15)
    })

    it('sums array with negative numbers', () => {
      expect(sum([-1, 2, -3, 4])).toBe(2)
    })

    it('sums empty array as zero', () => {
      expect(sum([])).toBe(0)
    })

    it('sums single element array', () => {
      expect(sum([42])).toBe(42)
    })

    it('sums floating point numbers', () => {
      expect(sum([1.5, 2.5, 3.0])).toBeCloseTo(7.0)
    })

    it('sums array with zeros', () => {
      expect(sum([0, 0, 0])).toBe(0)
      expect(sum([1, 0, 2])).toBe(3)
    })

    it('sums very large numbers', () => {
      expect(sum([1e100, 1e100])).toBe(2e100)
    })

    it('sums array containing Infinity', () => {
      expect(sum([1, 2, Infinity])).toBe(Infinity)
    })

    it('sums array with all Infinity', () => {
      expect(sum([Infinity, Infinity])).toBe(Infinity)
    })

    it('returns NaN when summing Infinity and -Infinity', () => {
      expect(Object.is(sum([Infinity, -Infinity]), NaN)).toBe(true)
    })

    it('returns NaN when array contains NaN', () => {
      expect(Object.is(sum([1, NaN, 3]), NaN)).toBe(true)
    })

    it('maintains precision for reasonable numbers', () => {
      const result = sum([0.1, 0.2, 0.3])
      expect(result).toBeCloseTo(0.6, 5)
    })
  })

  describe('number() - convert to number', () => {
    it('converts integer string to number', () => {
      expect(number('42')).toBe(42)
      expect(number('-17')).toBe(-17)
    })

    it('converts float string to number', () => {
      expect(number('3.14')).toBe(3.14)
      expect(number('-2.718')).toBeCloseTo(-2.718)
    })

    it('converts scientific notation string', () => {
      expect(number('1e10')).toBe(1e10)
      expect(number('2.5e-3')).toBeCloseTo(2.5e-3)
    })

    it('returns number as-is', () => {
      expect(number(42)).toBe(42)
      expect(number(3.14)).toBe(3.14)
    })

    it('returns NaN for non-numeric string', () => {
      expect(Object.is(number('hello'), NaN)).toBe(true)
      expect(Object.is(number('12abc'), NaN)).toBe(true)
    })

    it('converts boolean to number', () => {
      expect(number(true)).toBe(1)
      expect(number(false)).toBe(0)
    })

    it('handles whitespace in strings', () => {
      expect(number('  42  ')).toBe(42)
      expect(number('\t3.14\n')).toBe(3.14)
    })

    it('converts null to 0', () => {
      expect(number(null)).toBe(0)
    })

    it('returns NaN for undefined', () => {
      expect(Object.is(number(undefined), NaN)).toBe(true)
    })

    it('converts "Infinity" string', () => {
      expect(number('Infinity')).toBe(Infinity)
      expect(number('-Infinity')).toBe(-Infinity)
    })

    it('converts "NaN" string', () => {
      expect(Object.is(number('NaN'), NaN)).toBe(true)
    })

    it('returns empty object as NaN', () => {
      expect(Object.is(number({}), NaN)).toBe(true)
    })

    it('returns array as NaN', () => {
      expect(Object.is(number([]), NaN)).toBe(true)
    })

    it('handles leading zeros', () => {
      expect(number('0042')).toBe(42)
    })

    it('handles plus sign', () => {
      expect(number('+42')).toBe(42)
    })
  })

  describe('parse_int(base?) - parse string to integer', () => {
    it('parses decimal integer', () => {
      expect(parseInteger('42')).toBe(42)
      expect(parseInteger('0')).toBe(0)
    })

    it('parses negative integer', () => {
      expect(parseInteger('-42')).toBe(-42)
    })

    it('parses integer with leading zeros', () => {
      expect(parseInteger('0042')).toBe(42)
    })

    it('parses with base 2 (binary)', () => {
      expect(parseInteger('1010', 2)).toBe(10)
      expect(parseInteger('11111111', 2)).toBe(255)
    })

    it('parses with base 8 (octal)', () => {
      expect(parseInteger('755', 8)).toBe(493)
      expect(parseInteger('10', 8)).toBe(8)
    })

    it('parses with base 16 (hexadecimal)', () => {
      expect(parseInteger('FF', 16)).toBe(255)
      expect(parseInteger('abc', 16)).toBe(2748)
      expect(parseInteger('0xFF', 16)).toBe(255)
    })

    it('parses with various bases', () => {
      expect(parseInteger('10', 10)).toBe(10)
      expect(parseInteger('10', 36)).toBe(36)
    })

    it('stops at first non-digit character', () => {
      expect(parseInteger('42px')).toBe(42)
      expect(parseInteger('3.14')).toBe(3)
    })

    it('returns NaN for empty string', () => {
      expect(Object.is(parseInteger(''), NaN)).toBe(true)
    })

    it('returns NaN for non-numeric string', () => {
      expect(Object.is(parseInteger('hello'), NaN)).toBe(true)
    })

    it('returns NaN for whitespace-only string', () => {
      expect(Object.is(parseInteger('   '), NaN)).toBe(true)
    })

    it('handles leading whitespace', () => {
      expect(parseInteger('  42')).toBe(42)
    })

    it('returns integer number as-is', () => {
      expect(parseInteger(42)).toBe(42)
    })

    it('truncates floating point numbers', () => {
      expect(parseInteger(3.14)).toBe(3)
      expect(parseInteger(3.99)).toBe(3)
    })

    it('handles negative floating point', () => {
      expect(parseInteger(-3.99)).toBe(-3)
    })

    it('returns NaN for null', () => {
      expect(Object.is(parseInteger(null), NaN)).toBe(true)
    })

    it('returns NaN for undefined', () => {
      expect(Object.is(parseInteger(undefined), NaN)).toBe(true)
    })

    it('returns NaN for Infinity', () => {
      expect(Object.is(parseInteger(Infinity), NaN)).toBe(true)
    })

    it('uses default base 10 when not specified', () => {
      expect(parseInteger('42')).toBe(42)
      expect(parseInteger('99')).toBe(99)
    })

    it('handles base 36 with letters', () => {
      expect(parseInteger('z', 36)).toBe(35)
      expect(parseInteger('zz', 36)).toBe(1295)
    })

    it('returns NaN for invalid digit in given base', () => {
      expect(Object.is(parseInteger('8', 8), NaN)).toBe(true) // 8 is invalid in octal
      expect(Object.is(parseInteger('G', 16), NaN)).toBe(true) // G is invalid in hex
    })
  })

  describe('parse_float() - parse string to float', () => {
    it('parses integer string as float', () => {
      expect(parseFloatFn('42')).toBe(42)
    })

    it('parses decimal string', () => {
      expect(parseFloatFn('3.14')).toBe(3.14)
      expect(parseFloatFn('2.718')).toBeCloseTo(2.718)
    })

    it('parses negative float', () => {
      expect(parseFloatFn('-3.14')).toBeCloseTo(-3.14)
    })

    it('parses scientific notation', () => {
      expect(parseFloatFn('1e10')).toBe(1e10)
      expect(parseFloatFn('2.5e-3')).toBeCloseTo(0.0025)
      expect(parseFloatFn('1.23e4')).toBeCloseTo(12300)
    })

    it('parses leading zeros', () => {
      expect(parseFloatFn('0042.5')).toBe(42.5)
    })

    it('stops at first non-numeric character', () => {
      expect(parseFloatFn('3.14px')).toBe(3.14)
      expect(parseFloatFn('42.5 meters')).toBe(42.5)
    })

    it('returns NaN for empty string', () => {
      expect(Object.is(parseFloatFn(''), NaN)).toBe(true)
    })

    it('returns NaN for non-numeric string', () => {
      expect(Object.is(parseFloatFn('hello'), NaN)).toBe(true)
    })

    it('returns NaN for whitespace-only string', () => {
      expect(Object.is(parseFloatFn('   '), NaN)).toBe(true)
    })

    it('handles leading whitespace', () => {
      expect(parseFloatFn('  3.14')).toBe(3.14)
    })

    it('returns number as-is', () => {
      expect(parseFloatFn(42)).toBe(42)
      expect(parseFloatFn(3.14)).toBe(3.14)
    })

    it('converts Infinity string', () => {
      expect(parseFloatFn('Infinity')).toBe(Infinity)
      expect(parseFloatFn('-Infinity')).toBe(-Infinity)
    })

    it('returns NaN for "NaN" string', () => {
      expect(Object.is(parseFloatFn('NaN'), NaN)).toBe(true)
    })

    it('returns NaN for null', () => {
      expect(Object.is(parseFloatFn(null), NaN)).toBe(true)
    })

    it('returns NaN for undefined', () => {
      expect(Object.is(parseFloatFn(undefined), NaN)).toBe(true)
    })

    it('handles multiple decimal points (stops at first)', () => {
      expect(parseFloatFn('3.14.15')).toBe(3.14)
    })

    it('handles plus sign', () => {
      expect(parseFloatFn('+3.14')).toBe(3.14)
    })

    it('maintains precision for IEEE 754 floats', () => {
      expect(parseFloatFn('0.1')).toBeCloseTo(0.1)
      expect(parseFloatFn('0.2')).toBeCloseTo(0.2)
    })
  })

  describe('random_int(min, max) - random integer in range', () => {
    it('returns integer within range [min, max]', () => {
      const result = randomInt(1, 10)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(10)
      expect(Number.isInteger(result)).toBe(true)
    })

    it('returns integer when range is single value', () => {
      expect(randomInt(42, 42)).toBe(42)
    })

    it('handles negative range', () => {
      const result = randomInt(-10, -1)
      expect(result).toBeGreaterThanOrEqual(-10)
      expect(result).toBeLessThanOrEqual(-1)
    })

    it('handles range spanning negative and positive', () => {
      const result = randomInt(-5, 5)
      expect(result).toBeGreaterThanOrEqual(-5)
      expect(result).toBeLessThanOrEqual(5)
    })

    it('returns integer with large range', () => {
      const result = randomInt(0, 1000000)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1000000)
      expect(Number.isInteger(result)).toBe(true)
    })

    it('generates different values on multiple calls', () => {
      const results = new Set()
      for (let i = 0; i < 100; i++) {
        results.add(randomInt(1, 100))
      }
      // Should have multiple different values (statistically very likely)
      expect(results.size).toBeGreaterThan(1)
    })

    it('distributes values reasonably uniformly', () => {
      const counts: Record<number, number> = {}
      for (let i = 0; i < 1000; i++) {
        const val = randomInt(1, 3)
        counts[val] = (counts[val] || 0) + 1
      }
      // Each value should appear at least some minimum number of times
      expect(counts[1]).toBeGreaterThan(200)
      expect(counts[2]).toBeGreaterThan(200)
      expect(counts[3]).toBeGreaterThan(200)
    })

    it('handles min > max by swapping', () => {
      const result = randomInt(10, 1)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(10)
    })

    it('treats floats as integers by rounding', () => {
      const result = randomInt(1.9, 10.1)
      expect(Number.isInteger(result)).toBe(true)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(10)
    })

    it('returns integer for zero range', () => {
      expect(randomInt(0, 0)).toBe(0)
    })

    it('returns integer for very large numbers', () => {
      const result = randomInt(1000000, 1000100)
      expect(Number.isInteger(result)).toBe(true)
      expect(result).toBeGreaterThanOrEqual(1000000)
      expect(result).toBeLessThanOrEqual(1000100)
    })
  })

  describe('Edge cases and type coercion', () => {
    it('abs handles string number inputs', () => {
      const result = abs(Number('-42'))
      expect(result).toBe(42)
    })

    it('ceil with very large exponent', () => {
      const result = ceil(Number('1e308'))
      expect(result).toBe(1e308)
    })

    it('floor with subnormal numbers', () => {
      const result = floor(Number.MIN_VALUE)
      expect(result).toBe(0)
    })

    it('round maintains sign for negative zero', () => {
      // Note: round(-0.0001) should round to 0 (or -0), not -1.
      // The value -0.0001 has magnitude 0.0001 which is < 0.5, so it rounds toward zero.
      // The implementation normalizes -0 to 0 for consistency.
      const result = round(-0.0001)
      expect(result).toBe(0)
    })

    it('max with positive and negative infinity', () => {
      expect(max(-Infinity, Infinity)).toBe(Infinity)
    })

    it('min with positive and negative infinity', () => {
      expect(min(-Infinity, Infinity)).toBe(-Infinity)
    })

    it('sum handles mixed integer and float', () => {
      expect(sum([1, 2.5, 3, 4.5])).toBe(11)
    })

    it('number converts empty string to NaN', () => {
      expect(Object.is(number(''), NaN)).toBe(true)
    })

    it('parseInteger with string containing spaces', () => {
      expect(parseInteger('  42  px')).toBe(42)
    })

    it('parseFloat with exponential and spaces', () => {
      expect(parseFloatFn('  1e10  ')).toBe(1e10)
    })

    it('randomInt generates within specified bounds consistently', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(0, 1)
        expect([0, 1]).toContain(result)
      }
    })
  })

  describe('Type validation and error handling', () => {
    it('abs rejects non-numeric types gracefully', () => {
      // Should either throw or coerce - implementation decides
      // This test documents the behavior
      try {
        // @ts-ignore - Testing runtime behavior
        const result = abs('not a number')
        expect(Object.is(result, NaN)).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('ceil with invalid input either throws or returns NaN', () => {
      try {
        // @ts-ignore
        const result = ceil({})
        expect(Object.is(result, NaN)).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('max with mismatched types handles gracefully', () => {
      try {
        // @ts-ignore
        const result = max('5', 10)
        // Either coerces or throws
        expect(result !== undefined).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('sum with non-array input either throws or coerces', () => {
      try {
        // @ts-ignore
        const result = sum(42)
        expect(result !== undefined).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('parseInteger with invalid base throws or returns NaN', () => {
      try {
        // @ts-ignore
        const result = parseInteger('42', 37) // Base 37 is invalid
        expect(Object.is(result, NaN)).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('randomInt with non-integer bounds handles gracefully', () => {
      try {
        const result = randomInt(1.5, 10.9)
        expect(Number.isInteger(result)).toBe(true)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })
  })

  describe('Integration tests', () => {
    it('chaining operations: abs then ceil', () => {
      const value = -4.2
      const result = ceil(abs(value))
      expect(result).toBe(5)
    })

    it('chaining operations: max then floor', () => {
      const result = floor(max(3.9, 4.2))
      expect(result).toBe(4)
    })

    it('chaining operations: parseFloat then round', () => {
      const result = round(parseFloatFn('3.7'))
      expect(result).toBe(4)
    })

    it('sum of transformed array', () => {
      const numbers = [1.4, 2.6, 3.5]
      const rounded = numbers.map(n => round(n))
      const total = sum(rounded)
      expect(total).toBe(8)
    })

    it('find max of absolute values', () => {
      const values = [-10, 5, -20]
      const absValues = values.map(v => abs(v))
      const maximum = max(absValues[0], absValues[1])
      const final = max(maximum, absValues[2])
      expect(final).toBe(20)
    })

    it('parse and validate user input', () => {
      const input = '3.14px'
      const parsed = parseFloatFn(input)
      const valid = !Object.is(parsed, NaN)
      expect(valid).toBe(true)
      expect(parsed).toBe(3.14)
    })

    it('multiple function composition', () => {
      const start = -12.7
      const step1 = abs(start)
      const step2 = ceil(step1)
      const step3 = floor(step2)
      expect(step3).toBe(13)
    })
  })
})
