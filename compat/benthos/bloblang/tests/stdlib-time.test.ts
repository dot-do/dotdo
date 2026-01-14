/**
 * RED Phase Tests: Bloblang Date/Time Stdlib Functions
 * Issue: dotdo-dovwd
 *
 * These tests define the expected behavior for Bloblang date/time functions.
 * Following Go's time format layout (reference time: 2006-01-02 15:04:05).
 */

import { describe, it, expect } from 'vitest'
import {
  parse_duration,
  ts_parse,
  ts_format,
  ts_unix,
  ts_unix_milli,
  ts_unix_nano,
  ts_add,
  ts_sub,
  goFormatToJS,
  jsFormatToGo,
} from '../stdlib/time'

describe('Bloblang Date/Time Stdlib Functions', () => {
  describe('parse_duration(string) - parse duration string', () => {
    it('parses hours', () => {
      expect(parse_duration('1h')).toBe(3600000000000) // 1 hour in nanoseconds
    })

    it('parses minutes', () => {
      expect(parse_duration('30m')).toBe(1800000000000) // 30 minutes in nanoseconds
    })

    it('parses seconds', () => {
      expect(parse_duration('45s')).toBe(45000000000) // 45 seconds in nanoseconds
    })

    it('parses milliseconds', () => {
      expect(parse_duration('500ms')).toBe(500000000) // 500ms in nanoseconds
    })

    it('parses microseconds', () => {
      expect(parse_duration('100us')).toBe(100000) // 100 microseconds in nanoseconds
      expect(parse_duration('100\u00b5s')).toBe(100000) // Unicode micro sign
    })

    it('parses nanoseconds', () => {
      expect(parse_duration('1000ns')).toBe(1000)
    })

    it('parses combined duration string', () => {
      expect(parse_duration('1h30m')).toBe(5400000000000) // 1h30m in nanoseconds
    })

    it('parses complex duration string', () => {
      expect(parse_duration('2h45m30s')).toBe(9930000000000) // 2h + 45m + 30s
    })

    it('parses duration with milliseconds', () => {
      expect(parse_duration('1m30s500ms')).toBe(90500000000) // 1m30s + 500ms
    })

    it('parses negative duration', () => {
      expect(parse_duration('-1h')).toBe(-3600000000000)
    })

    it('parses days (Go extension)', () => {
      expect(parse_duration('1d')).toBe(86400000000000) // 24 hours
    })

    it('parses fractional values', () => {
      expect(parse_duration('1.5h')).toBe(5400000000000) // 1.5 hours = 90 minutes
      expect(parse_duration('2.5s')).toBe(2500000000) // 2.5 seconds
    })

    it('throws on invalid duration string', () => {
      expect(() => parse_duration('invalid')).toThrow()
      expect(() => parse_duration('1x')).toThrow()
      expect(() => parse_duration('')).toThrow()
    })

    it('handles zero duration', () => {
      expect(parse_duration('0s')).toBe(0)
      expect(parse_duration('0h0m0s')).toBe(0)
    })
  })

  describe('ts_parse(format, string) - parse timestamp with format', () => {
    // Go reference time: Mon Jan 2 15:04:05 MST 2006
    // Which corresponds to: 2006-01-02T15:04:05Z

    it('parses ISO 8601 format', () => {
      const result = ts_parse('2006-01-02T15:04:05Z07:00', '2024-03-15T10:30:00Z')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).toISOString()).toBe('2024-03-15T10:30:00.000Z')
    })

    it('parses date only format', () => {
      const result = ts_parse('2006-01-02', '2024-03-15')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getUTCFullYear()).toBe(2024)
      expect((result as Date).getUTCMonth()).toBe(2) // March is month 2 (0-indexed)
      expect((result as Date).getUTCDate()).toBe(15)
    })

    it('parses time with timezone offset', () => {
      const result = ts_parse('2006-01-02T15:04:05-07:00', '2024-03-15T10:30:00-05:00')
      expect(result).toBeInstanceOf(Date)
      // 10:30 -05:00 = 15:30 UTC
      expect((result as Date).getUTCHours()).toBe(15)
      expect((result as Date).getUTCMinutes()).toBe(30)
    })

    it('parses RFC3339 format', () => {
      const result = ts_parse('2006-01-02T15:04:05Z07:00', '2024-03-15T10:30:00+02:00')
      expect(result).toBeInstanceOf(Date)
    })

    it('parses US date format', () => {
      const result = ts_parse('01/02/2006', '03/15/2024')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getUTCFullYear()).toBe(2024)
      expect((result as Date).getUTCMonth()).toBe(2) // March
      expect((result as Date).getUTCDate()).toBe(15)
    })

    it('parses time with 12-hour clock', () => {
      const result = ts_parse('03:04 PM', '10:30 AM')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getUTCHours()).toBe(10)
    })

    it('parses with day of week', () => {
      const result = ts_parse('Mon, 02 Jan 2006', 'Fri, 15 Mar 2024')
      expect(result).toBeInstanceOf(Date)
    })

    it('throws on invalid format', () => {
      expect(() => ts_parse('invalid', '2024-03-15')).toThrow()
    })

    it('throws on value that does not match format', () => {
      expect(() => ts_parse('2006-01-02', 'not-a-date')).toThrow()
    })

    it('parses Unix timestamp string', () => {
      const result = ts_parse('unix', '1710500000')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getTime()).toBe(1710500000000)
    })

    it('parses Unix milliseconds timestamp string', () => {
      const result = ts_parse('unix_milli', '1710500000000')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getTime()).toBe(1710500000000)
    })
  })

  describe('ts_format(format) - format timestamp', () => {
    const testDate = new Date('2024-03-15T10:30:45.123Z')

    it('formats to ISO 8601', () => {
      const result = ts_format(testDate, '2006-01-02T15:04:05Z07:00')
      expect(result).toBe('2024-03-15T10:30:45Z')
    })

    it('formats date only', () => {
      const result = ts_format(testDate, '2006-01-02')
      expect(result).toBe('2024-03-15')
    })

    it('formats time only', () => {
      const result = ts_format(testDate, '15:04:05')
      expect(result).toBe('10:30:45')
    })

    it('formats with milliseconds', () => {
      const result = ts_format(testDate, '2006-01-02T15:04:05.000')
      expect(result).toBe('2024-03-15T10:30:45.123')
    })

    it('formats US date', () => {
      const result = ts_format(testDate, '01/02/2006')
      expect(result).toBe('03/15/2024')
    })

    it('formats 12-hour time', () => {
      const result = ts_format(testDate, '03:04 PM')
      expect(result).toBe('10:30 AM')
    })

    it('formats with day of week', () => {
      const result = ts_format(testDate, 'Mon, 02 Jan 2006')
      expect(result).toBe('Fri, 15 Mar 2024')
    })

    it('formats with full month name', () => {
      const result = ts_format(testDate, 'January 02, 2006')
      expect(result).toBe('March 15, 2024')
    })

    it('formats Unix timestamp', () => {
      const result = ts_format(testDate, 'unix')
      expect(result).toBe('1710498645')
    })

    it('formats Unix milliseconds', () => {
      const result = ts_format(testDate, 'unix_milli')
      expect(result).toBe('1710498645123')
    })

    it('handles number input (milliseconds)', () => {
      const result = ts_format(1710498645123, '2006-01-02')
      expect(result).toBe('2024-03-15')
    })

    it('handles string input (ISO format)', () => {
      const result = ts_format('2024-03-15T10:30:45.123Z', '2006-01-02')
      expect(result).toBe('2024-03-15')
    })
  })

  describe('ts_unix() - convert to Unix timestamp (seconds)', () => {
    it('converts Date to Unix seconds', () => {
      const date = new Date('2024-03-15T10:30:45.123Z')
      expect(ts_unix(date)).toBe(1710498645)
    })

    it('converts timestamp number to Unix seconds', () => {
      expect(ts_unix(1710498645123)).toBe(1710498645)
    })

    it('converts ISO string to Unix seconds', () => {
      expect(ts_unix('2024-03-15T10:30:45.123Z')).toBe(1710498645)
    })

    it('truncates milliseconds', () => {
      const date = new Date('2024-03-15T10:30:45.999Z')
      expect(ts_unix(date)).toBe(1710498645)
    })

    it('handles epoch', () => {
      const date = new Date('1970-01-01T00:00:00Z')
      expect(ts_unix(date)).toBe(0)
    })

    it('handles negative timestamps (before epoch)', () => {
      const date = new Date('1969-12-31T23:59:59Z')
      expect(ts_unix(date)).toBe(-1)
    })
  })

  describe('ts_unix_milli() - convert to Unix timestamp (milliseconds)', () => {
    it('converts Date to Unix milliseconds', () => {
      const date = new Date('2024-03-15T10:30:45.123Z')
      expect(ts_unix_milli(date)).toBe(1710498645123)
    })

    it('converts timestamp number (milliseconds) to same', () => {
      expect(ts_unix_milli(1710498645123)).toBe(1710498645123)
    })

    it('converts ISO string to Unix milliseconds', () => {
      expect(ts_unix_milli('2024-03-15T10:30:45.123Z')).toBe(1710498645123)
    })

    it('handles epoch', () => {
      const date = new Date('1970-01-01T00:00:00.000Z')
      expect(ts_unix_milli(date)).toBe(0)
    })
  })

  describe('ts_unix_nano() - convert to Unix timestamp (nanoseconds)', () => {
    it('converts Date to Unix nanoseconds', () => {
      const date = new Date('2024-03-15T10:30:45.123Z')
      // JavaScript Date only has millisecond precision, so we expect 123ms in nanos
      expect(ts_unix_nano(date)).toBe(1710498645123000000n)
    })

    it('converts timestamp number to Unix nanoseconds', () => {
      expect(ts_unix_nano(1710498645123)).toBe(1710498645123000000n)
    })

    it('converts ISO string to Unix nanoseconds', () => {
      expect(ts_unix_nano('2024-03-15T10:30:45.123Z')).toBe(1710498645123000000n)
    })

    it('returns bigint for precision', () => {
      const result = ts_unix_nano(new Date())
      expect(typeof result).toBe('bigint')
    })

    it('handles epoch', () => {
      const date = new Date('1970-01-01T00:00:00.000Z')
      expect(ts_unix_nano(date)).toBe(0n)
    })
  })

  describe('ts_add(duration) - add duration to timestamp', () => {
    it('adds hours to timestamp', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '2h')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).toISOString()).toBe('2024-03-15T12:00:00.000Z')
    })

    it('adds minutes to timestamp', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '30m')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:30:00.000Z')
    })

    it('adds seconds to timestamp', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '45s')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:45.000Z')
    })

    it('adds milliseconds to timestamp', () => {
      const date = new Date('2024-03-15T10:00:00.000Z')
      const result = ts_add(date, '500ms')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:00.500Z')
    })

    it('adds complex duration to timestamp', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '1h30m45s')
      expect((result as Date).toISOString()).toBe('2024-03-15T11:30:45.000Z')
    })

    it('adds 24 hours (1 day)', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '24h')
      expect((result as Date).toISOString()).toBe('2024-03-16T10:00:00.000Z')
    })

    it('handles negative duration (subtracts)', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, '-1h')
      expect((result as Date).toISOString()).toBe('2024-03-15T09:00:00.000Z')
    })

    it('accepts duration in nanoseconds (number)', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date, 3600000000000) // 1 hour in nanoseconds
      expect((result as Date).toISOString()).toBe('2024-03-15T11:00:00.000Z')
    })

    it('handles string timestamp input', () => {
      const result = ts_add('2024-03-15T10:00:00Z', '1h')
      expect((result as Date).toISOString()).toBe('2024-03-15T11:00:00.000Z')
    })

    it('handles number timestamp input (milliseconds)', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_add(date.getTime(), '1h')
      expect((result as Date).toISOString()).toBe('2024-03-15T11:00:00.000Z')
    })
  })

  describe('ts_sub(duration) - subtract duration from timestamp', () => {
    it('subtracts hours from timestamp', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_sub(date, '2h')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).toISOString()).toBe('2024-03-15T08:00:00.000Z')
    })

    it('subtracts minutes from timestamp', () => {
      const date = new Date('2024-03-15T10:30:00Z')
      const result = ts_sub(date, '30m')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:00.000Z')
    })

    it('subtracts complex duration from timestamp', () => {
      const date = new Date('2024-03-15T11:30:45Z')
      const result = ts_sub(date, '1h30m45s')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:00.000Z')
    })

    it('subtracts 24 hours (1 day)', () => {
      const date = new Date('2024-03-16T10:00:00Z')
      const result = ts_sub(date, '24h')
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:00.000Z')
    })

    it('handles negative duration (adds)', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      const result = ts_sub(date, '-1h')
      expect((result as Date).toISOString()).toBe('2024-03-15T11:00:00.000Z')
    })

    it('accepts duration in nanoseconds (number)', () => {
      const date = new Date('2024-03-15T11:00:00Z')
      const result = ts_sub(date, 3600000000000) // 1 hour in nanoseconds
      expect((result as Date).toISOString()).toBe('2024-03-15T10:00:00.000Z')
    })
  })

  describe('Go time format conversion utilities', () => {
    describe('goFormatToJS() - convert Go format to JS', () => {
      it('converts year formats', () => {
        expect(goFormatToJS('2006')).toBe('yyyy')
        expect(goFormatToJS('06')).toBe('yy')
      })

      it('converts month formats', () => {
        expect(goFormatToJS('01')).toBe('MM')
        expect(goFormatToJS('1')).toBe('M')
        expect(goFormatToJS('Jan')).toBe('MMM')
        expect(goFormatToJS('January')).toBe('MMMM')
      })

      it('converts day formats', () => {
        expect(goFormatToJS('02')).toBe('dd')
        expect(goFormatToJS('2')).toBe('d')
        expect(goFormatToJS('Mon')).toBe('EEE')
        expect(goFormatToJS('Monday')).toBe('EEEE')
      })

      it('converts hour formats', () => {
        expect(goFormatToJS('15')).toBe('HH') // 24-hour
        expect(goFormatToJS('03')).toBe('hh') // 12-hour padded
        expect(goFormatToJS('3')).toBe('h')   // 12-hour
      })

      it('converts minute and second formats', () => {
        expect(goFormatToJS('04')).toBe('mm')
        expect(goFormatToJS('05')).toBe('ss')
      })

      it('converts AM/PM formats', () => {
        expect(goFormatToJS('PM')).toBe('a')
        expect(goFormatToJS('pm')).toBe('a')
      })

      it('converts timezone formats', () => {
        expect(goFormatToJS('Z07:00')).toBe('XXX')
        expect(goFormatToJS('-07:00')).toBe('xxx')
        expect(goFormatToJS('MST')).toBe('zzz')
      })

      it('converts complete ISO format', () => {
        const result = goFormatToJS('2006-01-02T15:04:05Z07:00')
        expect(result).toBe('yyyy-MM-ddTHH:mm:ssXXX')
      })

      it('converts US date format', () => {
        const result = goFormatToJS('01/02/2006')
        expect(result).toBe('MM/dd/yyyy')
      })
    })

    describe('jsFormatToGo() - convert JS format to Go', () => {
      it('converts year formats', () => {
        expect(jsFormatToGo('yyyy')).toBe('2006')
        expect(jsFormatToGo('yy')).toBe('06')
      })

      it('converts month formats', () => {
        expect(jsFormatToGo('MM')).toBe('01')
        expect(jsFormatToGo('M')).toBe('1')
        expect(jsFormatToGo('MMM')).toBe('Jan')
        expect(jsFormatToGo('MMMM')).toBe('January')
      })

      it('converts complete ISO format', () => {
        const result = jsFormatToGo('yyyy-MM-ddTHH:mm:ssXXX')
        expect(result).toBe('2006-01-02T15:04:05Z07:00')
      })
    })
  })

  describe('Edge cases and error handling', () => {
    it('parse_duration with whitespace', () => {
      expect(() => parse_duration(' 1h ')).toThrow()
    })

    it('ts_parse with null value', () => {
      expect(() => ts_parse('2006-01-02', null as unknown as string)).toThrow()
    })

    it('ts_format with invalid date', () => {
      expect(() => ts_format(new Date('invalid'), '2006-01-02')).toThrow()
    })

    it('ts_unix with invalid input', () => {
      expect(() => ts_unix('not a date')).toThrow()
    })

    it('ts_add with invalid duration', () => {
      const date = new Date('2024-03-15T10:00:00Z')
      expect(() => ts_add(date, 'invalid')).toThrow()
    })

    it('handles leap years', () => {
      const result = ts_parse('2006-01-02', '2024-02-29')
      expect(result).toBeInstanceOf(Date)
      // Use getUTCDate() since ts_parse creates UTC dates
      expect((result as Date).getUTCDate()).toBe(29)
    })

    it('handles DST transitions', () => {
      // This is more about documenting behavior than strict testing
      const result = ts_add(new Date('2024-03-10T01:00:00-05:00'), '2h')
      expect(result).toBeInstanceOf(Date)
    })
  })

  describe('Integration with Bloblang usage patterns', () => {
    it('duration to milliseconds conversion', () => {
      // root.duration_ms = parse_duration("1h30m") / 1000000
      const nanos = parse_duration('1h30m')
      const ms = nanos / 1000000
      expect(ms).toBe(5400000) // 1.5 hours in milliseconds
    })

    it('parse and reformat timestamp', () => {
      // root.formatted = this.date_str.ts_parse("2006-01-02").ts_format("01/02/2006")
      const parsed = ts_parse('2006-01-02', '2024-03-15')
      const formatted = ts_format(parsed, '01/02/2006')
      expect(formatted).toBe('03/15/2024')
    })

    it('get Unix timestamp from date string', () => {
      // root.unix = this.date_str.ts_parse("2006-01-02T15:04:05Z07:00").ts_unix()
      const parsed = ts_parse('2006-01-02T15:04:05Z07:00', '2024-03-15T10:30:45Z')
      const unix = ts_unix(parsed)
      expect(unix).toBe(1710498645)
    })

    it('add day to timestamp', () => {
      // root.next_day = this.ts.ts_add("24h")
      const date = new Date('2024-03-15T10:00:00Z')
      const nextDay = ts_add(date, '24h')
      expect((nextDay as Date).getDate()).toBe(16)
    })
  })
})
