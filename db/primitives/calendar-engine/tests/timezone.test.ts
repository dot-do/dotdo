/**
 * TimeZoneHandler Tests
 *
 * Tests for timezone-aware date/time operations including:
 * - Timezone conversions
 * - DST handling
 * - Date component extraction
 * - Cross-timezone scheduling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TimeZoneHandler,
  createTimeZoneHandler,
  parseTimeString,
  formatTimeString,
  parseDateString,
  formatDateString,
  resolveTimezone,
  getTimezoneOffset,
  getTimezoneAbbreviation,
  isDST,
} from '../timezone'

describe('TimeZoneHandler', () => {
  let handler: TimeZoneHandler

  beforeEach(() => {
    handler = createTimeZoneHandler({ defaultTimezone: 'UTC' })
  })

  describe('parseTimeString', () => {
    it('should parse HH:MM format', () => {
      expect(parseTimeString('09:00')).toBe(540) // 9 * 60
      expect(parseTimeString('00:00')).toBe(0)
      expect(parseTimeString('23:59')).toBe(1439) // 23 * 60 + 59
      expect(parseTimeString('12:30')).toBe(750) // 12 * 60 + 30
    })

    it('should handle midnight and noon', () => {
      expect(parseTimeString('00:00')).toBe(0)
      expect(parseTimeString('12:00')).toBe(720)
    })
  })

  describe('formatTimeString', () => {
    it('should format minutes to HH:MM', () => {
      expect(formatTimeString(540)).toBe('09:00')
      expect(formatTimeString(0)).toBe('00:00')
      expect(formatTimeString(1439)).toBe('23:59')
      expect(formatTimeString(750)).toBe('12:30')
    })

    it('should handle overflow', () => {
      expect(formatTimeString(1440)).toBe('00:00') // Wrap around
      expect(formatTimeString(1500)).toBe('01:00') // 1440 + 60
    })

    it('should handle negative values', () => {
      expect(formatTimeString(-60)).toBe('23:00') // Wrap backwards
    })
  })

  describe('parseDateString', () => {
    it('should parse YYYY-MM-DD format', () => {
      const date = parseDateString('2024-01-15')
      expect(date.getUTCFullYear()).toBe(2024)
      expect(date.getUTCMonth()).toBe(0) // January
      expect(date.getUTCDate()).toBe(15)
    })

    it('should parse end of year', () => {
      const date = parseDateString('2024-12-31')
      expect(date.getUTCFullYear()).toBe(2024)
      expect(date.getUTCMonth()).toBe(11) // December
      expect(date.getUTCDate()).toBe(31)
    })
  })

  describe('formatDateString', () => {
    it('should format Date to YYYY-MM-DD', () => {
      const date = new Date(Date.UTC(2024, 0, 15))
      expect(formatDateString(date)).toBe('2024-01-15')
    })

    it('should pad single digit months and days', () => {
      const date = new Date(Date.UTC(2024, 5, 5))
      expect(formatDateString(date)).toBe('2024-06-05')
    })
  })

  describe('resolveTimezone', () => {
    it('should resolve common aliases', () => {
      expect(resolveTimezone('EST')).toBe('America/New_York')
      expect(resolveTimezone('PST')).toBe('America/Los_Angeles')
      expect(resolveTimezone('GMT')).toBe('Etc/GMT')
      expect(resolveTimezone('JST')).toBe('Asia/Tokyo')
    })

    it('should pass through IANA identifiers', () => {
      expect(resolveTimezone('America/New_York')).toBe('America/New_York')
      expect(resolveTimezone('Europe/London')).toBe('Europe/London')
    })
  })

  describe('getTimezoneOffset', () => {
    it('should return offset in minutes', () => {
      // UTC always has 0 offset
      const utcOffset = getTimezoneOffset('UTC')
      expect(utcOffset).toBe(0)
    })

    it('should handle fixed offset timezones', () => {
      // IST (India) is always +5:30
      const date = new Date('2024-01-15T12:00:00Z')
      const istOffset = getTimezoneOffset('Asia/Kolkata', date)
      expect(istOffset).toBe(330) // 5 hours 30 minutes
    })
  })

  describe('getTimezoneAbbreviation', () => {
    it('should return timezone abbreviation', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const abbr = getTimezoneAbbreviation('UTC', date)
      expect(abbr).toMatch(/UTC|GMT/)
    })
  })

  describe('isDST', () => {
    it('should detect DST in summer for northern hemisphere', () => {
      const summer = new Date('2024-07-15T12:00:00Z')
      const dstInNY = isDST('America/New_York', summer)
      expect(dstInNY).toBe(true)
    })

    it('should detect no DST in winter for northern hemisphere', () => {
      const winter = new Date('2024-01-15T12:00:00Z')
      const dstInNY = isDST('America/New_York', winter)
      expect(dstInNY).toBe(false)
    })

    it('should return false for timezones without DST', () => {
      const date = new Date('2024-07-15T12:00:00Z')
      const dstInPhoenix = isDST('America/Phoenix', date)
      expect(dstInPhoenix).toBe(false)
    })
  })

  describe('TimeZoneHandler.getInfo', () => {
    it('should return timezone information', () => {
      const info = handler.getInfo('America/New_York')
      expect(info.id).toBe('America/New_York')
      expect(typeof info.offsetMinutes).toBe('number')
      expect(info.offsetString).toMatch(/^[+-]\d{2}:\d{2}$/)
      expect(typeof info.isDST).toBe('boolean')
      expect(typeof info.abbreviation).toBe('string')
    })

    it('should use default timezone when not specified', () => {
      const info = handler.getInfo()
      expect(info.id).toBe('UTC')
      expect(info.offsetMinutes).toBe(0)
    })
  })

  describe('TimeZoneHandler.convert', () => {
    it('should convert between timezones', () => {
      const utcDate = new Date('2024-01-15T12:00:00Z')
      const tokyoTime = handler.convert(utcDate, 'UTC', 'Asia/Tokyo')

      // Tokyo is UTC+9
      const expectedOffset = 9 * 60 * 60 * 1000
      expect(tokyoTime.getTime() - utcDate.getTime()).toBe(expectedOffset)
    })

    it('should handle same timezone', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = handler.convert(date, 'UTC', 'UTC')
      expect(result.getTime()).toBe(date.getTime())
    })
  })

  describe('TimeZoneHandler.toUTC', () => {
    it('should convert local time to UTC', () => {
      const handler = createTimeZoneHandler({ defaultTimezone: 'America/New_York' })
      const localDate = new Date('2024-01-15T12:00:00Z') // Treating as local time
      const utcDate = handler.toUTC(localDate)

      // In winter, NY is UTC-5
      expect(utcDate.getTime()).toBeLessThan(localDate.getTime())
    })
  })

  describe('TimeZoneHandler.fromUTC', () => {
    it('should convert UTC to local time', () => {
      const utcDate = new Date('2024-01-15T12:00:00Z')
      const localDate = handler.fromUTC(utcDate, 'Asia/Tokyo')

      // Tokyo is UTC+9
      expect(localDate.getTime()).toBeGreaterThan(utcDate.getTime())
    })
  })

  describe('TimeZoneHandler.createDate', () => {
    it('should create date in specific timezone', () => {
      const date = handler.createDate(2024, 1, 15, 9, 0, 0, 'America/New_York')

      // 9 AM in New York (EST) should be 2 PM UTC in winter
      expect(date.getUTCHours()).toBe(14) // 9 + 5
    })

    it('should handle DST correctly', () => {
      const summer = handler.createDate(2024, 7, 15, 9, 0, 0, 'America/New_York')

      // 9 AM in New York (EDT) should be 1 PM UTC in summer
      expect(summer.getUTCHours()).toBe(13) // 9 + 4
    })
  })

  describe('TimeZoneHandler.createFromStrings', () => {
    it('should create date from date and time strings', () => {
      const date = handler.createFromStrings('2024-01-15', '09:30', 'UTC')
      expect(date.getUTCFullYear()).toBe(2024)
      expect(date.getUTCMonth()).toBe(0)
      expect(date.getUTCDate()).toBe(15)
      expect(date.getUTCHours()).toBe(9)
      expect(date.getUTCMinutes()).toBe(30)
    })
  })

  describe('TimeZoneHandler.getDayOfWeek', () => {
    it('should return day of week in timezone', () => {
      // Sunday in UTC
      const sunday = new Date('2024-01-14T12:00:00Z')
      expect(handler.getDayOfWeek(sunday, 'UTC')).toBe(0)

      // Monday in UTC
      const monday = new Date('2024-01-15T12:00:00Z')
      expect(handler.getDayOfWeek(monday, 'UTC')).toBe(1)
    })

    it('should handle timezone boundary', () => {
      // Just before midnight UTC on Sunday
      const lateUTC = new Date('2024-01-14T23:00:00Z')

      // In UTC it's still Sunday
      expect(handler.getDayOfWeek(lateUTC, 'UTC')).toBe(0)

      // In Tokyo (UTC+9) it's already Monday
      expect(handler.getDayOfWeek(lateUTC, 'Asia/Tokyo')).toBe(1)
    })
  })

  describe('TimeZoneHandler.getDateParts', () => {
    it('should return date components in timezone', () => {
      const date = new Date('2024-01-15T14:30:45Z')
      const parts = handler.getDateParts(date, 'UTC')

      expect(parts.year).toBe(2024)
      expect(parts.month).toBe(1)
      expect(parts.day).toBe(15)
      expect(parts.hour).toBe(14)
      expect(parts.minute).toBe(30)
      expect(parts.second).toBe(45)
      expect(parts.dayOfWeek).toBe(1) // Monday
    })
  })

  describe('TimeZoneHandler.startOfDay', () => {
    it('should return start of day in timezone', () => {
      const date = new Date('2024-01-15T14:30:00Z')
      const startUTC = handler.startOfDay(date, 'UTC')

      expect(startUTC.getUTCHours()).toBe(0)
      expect(startUTC.getUTCMinutes()).toBe(0)
      expect(startUTC.getUTCSeconds()).toBe(0)
      expect(startUTC.getUTCDate()).toBe(15)
    })
  })

  describe('TimeZoneHandler.endOfDay', () => {
    it('should return end of day in timezone', () => {
      const date = new Date('2024-01-15T14:30:00Z')
      const endUTC = handler.endOfDay(date, 'UTC')

      expect(endUTC.getUTCHours()).toBe(23)
      expect(endUTC.getUTCMinutes()).toBe(59)
      expect(endUTC.getUTCSeconds()).toBe(59)
      expect(endUTC.getUTCDate()).toBe(15)
    })
  })

  describe('TimeZoneHandler.startOfWeek', () => {
    it('should return start of week (Sunday by default)', () => {
      const wednesday = new Date('2024-01-17T12:00:00Z')
      const startOfWeek = handler.startOfWeek(wednesday, 'UTC', 0)

      expect(startOfWeek.getUTCDate()).toBe(14) // Previous Sunday
      expect(startOfWeek.getUTCHours()).toBe(0)
    })

    it('should support Monday as week start', () => {
      const wednesday = new Date('2024-01-17T12:00:00Z')
      const startOfWeek = handler.startOfWeek(wednesday, 'UTC', 1)

      expect(startOfWeek.getUTCDate()).toBe(15) // Previous Monday
    })
  })

  describe('TimeZoneHandler.addDays', () => {
    it('should add days to date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = handler.addDays(date, 5, 'UTC')

      expect(result.getUTCDate()).toBe(20)
    })

    it('should handle month boundary', () => {
      const date = new Date('2024-01-30T12:00:00Z')
      const result = handler.addDays(date, 5, 'UTC')

      expect(result.getUTCMonth()).toBe(1) // February
      expect(result.getUTCDate()).toBe(4)
    })

    it('should handle negative days', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = handler.addDays(date, -10, 'UTC')

      expect(result.getUTCDate()).toBe(5)
    })
  })

  describe('TimeZoneHandler.addHours', () => {
    it('should add hours to date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = handler.addHours(date, 5)

      expect(result.getUTCHours()).toBe(17)
    })
  })

  describe('TimeZoneHandler.addMinutes', () => {
    it('should add minutes to date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const result = handler.addMinutes(date, 45)

      expect(result.getUTCMinutes()).toBe(45)
    })
  })

  describe('TimeZoneHandler.isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date('2024-01-15T09:00:00Z')
      const date2 = new Date('2024-01-15T18:00:00Z')

      expect(handler.isSameDay(date1, date2, 'UTC')).toBe(true)
    })

    it('should return false for different days', () => {
      const date1 = new Date('2024-01-15T09:00:00Z')
      const date2 = new Date('2024-01-16T09:00:00Z')

      expect(handler.isSameDay(date1, date2, 'UTC')).toBe(false)
    })

    it('should handle timezone boundaries', () => {
      // 11 PM in NY is still same day
      // But in UTC it's already next day
      const date1 = new Date('2024-01-15T04:00:00Z') // 11 PM Jan 14 in NY
      const date2 = new Date('2024-01-15T05:00:00Z') // 12 AM Jan 15 in NY

      expect(handler.isSameDay(date1, date2, 'America/New_York')).toBe(false)
    })
  })

  describe('TimeZoneHandler.findDSTTransitions', () => {
    it('should find DST transitions in a year', () => {
      const transitions = handler.findDSTTransitions(2024, 'America/New_York')

      // Should find spring forward and fall back
      expect(transitions.length).toBeGreaterThanOrEqual(2)

      const spring = transitions.find((t) => t.direction === 'forward')
      const fall = transitions.find((t) => t.direction === 'backward')

      expect(spring).toBeDefined()
      expect(fall).toBeDefined()
    })

    it('should return empty for timezones without DST', () => {
      const transitions = handler.findDSTTransitions(2024, 'Asia/Kolkata')
      expect(transitions.length).toBe(0)
    })
  })

  describe('TimeZoneHandler.isValidTimezone', () => {
    it('should validate IANA timezone identifiers', () => {
      expect(handler.isValidTimezone('America/New_York')).toBe(true)
      expect(handler.isValidTimezone('Europe/London')).toBe(true)
      expect(handler.isValidTimezone('UTC')).toBe(true)
    })

    it('should reject invalid timezones', () => {
      expect(handler.isValidTimezone('Invalid/Timezone')).toBe(false)
      expect(handler.isValidTimezone('foo')).toBe(false)
    })

    it('should validate common aliases', () => {
      expect(handler.isValidTimezone('EST')).toBe(true)
      expect(handler.isValidTimezone('PST')).toBe(true)
    })
  })

  describe('TimeZoneHandler.getCommonTimezones', () => {
    it('should return list of common timezones', () => {
      const timezones = handler.getCommonTimezones()

      expect(timezones).toContain('America/New_York')
      expect(timezones).toContain('Europe/London')
      expect(timezones).toContain('Asia/Tokyo')
      expect(timezones).toContain('UTC')
    })
  })
})
