import { describe, expect, it } from 'vitest'
import {
  Duration,
  ParsedDuration,
  DurationObject,
  parseDuration,
  toMillis,
  formatDuration,
  hours,
  minutes,
  seconds,
  milliseconds,
  days,
  weeks,
  duration,
} from '../duration'

describe('Duration utilities', () => {
  describe('parseDuration', () => {
    it('should parse number as milliseconds', () => {
      expect(parseDuration(1000)).toEqual({ milliseconds: 1000 })
      expect(parseDuration(0)).toEqual({ milliseconds: 0 })
      expect(parseDuration(500)).toEqual({ milliseconds: 500 })
    })

    it('should parse milliseconds string', () => {
      expect(parseDuration('1000ms')).toEqual({ milliseconds: 1000 })
      expect(parseDuration('500ms')).toEqual({ milliseconds: 500 })
      expect(parseDuration('0ms')).toEqual({ milliseconds: 0 })
    })

    it('should parse seconds string', () => {
      expect(parseDuration('1s')).toEqual({ milliseconds: 1000 })
      expect(parseDuration('30s')).toEqual({ milliseconds: 30000 })
      expect(parseDuration('0.5s')).toEqual({ milliseconds: 500 })
    })

    it('should parse minutes string', () => {
      expect(parseDuration('1m')).toEqual({ milliseconds: 60000 })
      expect(parseDuration('5m')).toEqual({ milliseconds: 300000 })
      expect(parseDuration('30m')).toEqual({ milliseconds: 1800000 })
    })

    it('should parse hours string', () => {
      expect(parseDuration('1h')).toEqual({ milliseconds: 3600000 })
      expect(parseDuration('24h')).toEqual({ milliseconds: 86400000 })
      expect(parseDuration('2.5h')).toEqual({ milliseconds: 9000000 })
    })

    it('should parse days string', () => {
      expect(parseDuration('1d')).toEqual({ milliseconds: 86400000 })
      expect(parseDuration('7d')).toEqual({ milliseconds: 604800000 })
    })

    it('should parse weeks string', () => {
      expect(parseDuration('1w')).toEqual({ milliseconds: 604800000 })
      expect(parseDuration('2w')).toEqual({ milliseconds: 1209600000 })
    })

    it('should be case-insensitive', () => {
      expect(parseDuration('1H')).toEqual({ milliseconds: 3600000 })
      expect(parseDuration('1D')).toEqual({ milliseconds: 86400000 })
      expect(parseDuration('1MS')).toEqual({ milliseconds: 1 })
    })

    it('should allow whitespace between number and unit', () => {
      expect(parseDuration('1 h')).toEqual({ milliseconds: 3600000 })
      expect(parseDuration('30 m')).toEqual({ milliseconds: 1800000 })
    })

    it('should throw on invalid format', () => {
      expect(() => parseDuration('invalid')).toThrow('Invalid duration format')
      expect(() => parseDuration('1x')).toThrow('Invalid duration format')
      expect(() => parseDuration('abc')).toThrow('Invalid duration format')
      expect(() => parseDuration('')).toThrow('Invalid duration format')
    })
  })

  describe('toMillis', () => {
    it('should return milliseconds from number', () => {
      expect(toMillis(1000)).toBe(1000)
      expect(toMillis(0)).toBe(0)
    })

    it('should return milliseconds from string', () => {
      expect(toMillis('1s')).toBe(1000)
      expect(toMillis('5m')).toBe(300000)
      expect(toMillis('1h')).toBe(3600000)
    })
  })

  describe('formatDuration', () => {
    it('should format weeks', () => {
      expect(formatDuration(604800000)).toBe('1w')
      expect(formatDuration(1209600000)).toBe('2w')
    })

    it('should format days', () => {
      expect(formatDuration(86400000)).toBe('1d')
      expect(formatDuration(172800000)).toBe('2d')
    })

    it('should format hours', () => {
      expect(formatDuration(3600000)).toBe('1h')
      expect(formatDuration(7200000)).toBe('2h')
    })

    it('should format minutes', () => {
      expect(formatDuration(60000)).toBe('1m')
      expect(formatDuration(300000)).toBe('5m')
    })

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s')
      expect(formatDuration(30000)).toBe('30s')
    })

    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
      expect(formatDuration(1)).toBe('1ms')
    })

    it('should format zero', () => {
      expect(formatDuration(0)).toBe('0ms')
    })

    it('should use largest whole unit', () => {
      // 1 day = 86400000ms, should format as 1d not 24h
      expect(formatDuration(86400000)).toBe('1d')
      // 7 days = 604800000ms, should format as 1w not 7d
      expect(formatDuration(604800000)).toBe('1w')
    })

    it('should fall back to smaller units when not evenly divisible', () => {
      // 1 day + 1 hour = 90000000ms, not evenly divisible by day
      // But it is evenly divisible by hour (25 hours)
      expect(formatDuration(90000000)).toBe('25h')
      // Something not evenly divisible by any unit falls back to ms
      expect(formatDuration(90000001)).toBe('90000001ms')
    })
  })

  describe('DurationObject factory functions', () => {
    describe('hours()', () => {
      it('should create duration from hours', () => {
        expect(hours(1).toMillis()).toBe(3600000)
        expect(hours(2).toMillis()).toBe(7200000)
        expect(hours(0.5).toMillis()).toBe(1800000)
      })
    })

    describe('minutes()', () => {
      it('should create duration from minutes', () => {
        expect(minutes(1).toMillis()).toBe(60000)
        expect(minutes(30).toMillis()).toBe(1800000)
        expect(minutes(0.5).toMillis()).toBe(30000)
      })
    })

    describe('seconds()', () => {
      it('should create duration from seconds', () => {
        expect(seconds(1).toMillis()).toBe(1000)
        expect(seconds(30).toMillis()).toBe(30000)
        expect(seconds(0.5).toMillis()).toBe(500)
      })
    })

    describe('milliseconds()', () => {
      it('should create duration from milliseconds', () => {
        expect(milliseconds(1).toMillis()).toBe(1)
        expect(milliseconds(500).toMillis()).toBe(500)
        expect(milliseconds(1000).toMillis()).toBe(1000)
      })
    })

    describe('days()', () => {
      it('should create duration from days', () => {
        expect(days(1).toMillis()).toBe(86400000)
        expect(days(7).toMillis()).toBe(604800000)
      })
    })

    describe('weeks()', () => {
      it('should create duration from weeks', () => {
        expect(weeks(1).toMillis()).toBe(604800000)
        expect(weeks(2).toMillis()).toBe(1209600000)
      })
    })

    describe('duration()', () => {
      it('should create DurationObject from string', () => {
        expect(duration('1h').toMillis()).toBe(3600000)
        expect(duration('30m').toMillis()).toBe(1800000)
      })

      it('should create DurationObject from number', () => {
        expect(duration(1000).toMillis()).toBe(1000)
        expect(duration(3600000).toMillis()).toBe(3600000)
      })
    })
  })

  describe('type exports', () => {
    it('should export Duration type', () => {
      // Type check - these should compile
      const d1: Duration = 1000
      const d2: Duration = '1h'
      expect(d1).toBe(1000)
      expect(d2).toBe('1h')
    })

    it('should export ParsedDuration type', () => {
      const pd: ParsedDuration = { milliseconds: 1000 }
      expect(pd.milliseconds).toBe(1000)
    })

    it('should export DurationObject type', () => {
      const dobj: DurationObject = hours(1)
      expect(dobj.toMillis()).toBe(3600000)
    })
  })

  describe('edge cases', () => {
    it('should handle very large numbers', () => {
      const largeMs = 365 * 24 * 60 * 60 * 1000 // 1 year in ms
      expect(parseDuration(largeMs).milliseconds).toBe(largeMs)
    })

    it('should handle decimal values in strings', () => {
      expect(parseDuration('1.5h').milliseconds).toBe(5400000)
      expect(parseDuration('2.5d').milliseconds).toBe(216000000)
    })

    it('should handle zero values', () => {
      expect(parseDuration(0).milliseconds).toBe(0)
      expect(parseDuration('0s').milliseconds).toBe(0)
      expect(hours(0).toMillis()).toBe(0)
    })
  })
})
