/**
 * RecurrenceRule Tests
 *
 * Tests for RFC 5545 RRULE parsing and expansion including:
 * - RRULE string parsing and serialization
 * - Instance expansion for all frequencies
 * - BYDAY, BYMONTH, BYMONTHDAY handling
 * - BYSETPOS filtering
 * - COUNT and UNTIL limits
 */

import { describe, it, expect } from 'vitest'
import {
  parseRRule,
  serializeRRule,
  expandRRule,
  matchesRRule,
  getNextOccurrence,
  getPreviousOccurrence,
  countOccurrences,
  describeRRule,
  RecurrencePresets,
} from '../recurrence'
import type { RecurrenceRule } from '../types'

describe('RecurrenceRule', () => {
  describe('parseRRule', () => {
    it('should parse daily rule', () => {
      const rule = parseRRule('FREQ=DAILY')
      expect(rule.freq).toBe('DAILY')
      expect(rule.interval).toBeUndefined()
    })

    it('should parse weekly rule with interval', () => {
      const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2')
      expect(rule.freq).toBe('WEEKLY')
      expect(rule.interval).toBe(2)
    })

    it('should parse rule with COUNT', () => {
      const rule = parseRRule('FREQ=DAILY;COUNT=10')
      expect(rule.count).toBe(10)
    })

    it('should parse rule with UNTIL', () => {
      const rule = parseRRule('FREQ=DAILY;UNTIL=20240331T235959Z')
      expect(rule.until).toBeDefined()
      expect(rule.until!.getUTCFullYear()).toBe(2024)
      expect(rule.until!.getUTCMonth()).toBe(2) // March
      expect(rule.until!.getUTCDate()).toBe(31)
    })

    it('should parse BYDAY', () => {
      const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')
      expect(rule.byDay).toHaveLength(3)
      expect(rule.byDay![0].day).toBe('MO')
      expect(rule.byDay![1].day).toBe('WE')
      expect(rule.byDay![2].day).toBe('FR')
    })

    it('should parse BYDAY with position', () => {
      const rule = parseRRule('FREQ=MONTHLY;BYDAY=2MO')
      expect(rule.byDay).toHaveLength(1)
      expect(rule.byDay![0].day).toBe('MO')
      expect(rule.byDay![0].n).toBe(2)
    })

    it('should parse BYDAY with negative position', () => {
      const rule = parseRRule('FREQ=MONTHLY;BYDAY=-1FR')
      expect(rule.byDay![0].day).toBe('FR')
      expect(rule.byDay![0].n).toBe(-1)
    })

    it('should parse BYMONTHDAY', () => {
      const rule = parseRRule('FREQ=MONTHLY;BYMONTHDAY=15,-1')
      expect(rule.byMonthDay).toEqual([15, -1])
    })

    it('should parse BYMONTH', () => {
      const rule = parseRRule('FREQ=YEARLY;BYMONTH=1,6,12')
      expect(rule.byMonth).toEqual([1, 6, 12])
    })

    it('should parse BYSETPOS', () => {
      const rule = parseRRule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1')
      expect(rule.bySetPos).toEqual([-1])
    })

    it('should parse WKST', () => {
      const rule = parseRRule('FREQ=WEEKLY;WKST=SU')
      expect(rule.wkst).toBe('SU')
    })

    it('should parse BYHOUR, BYMINUTE, BYSECOND', () => {
      const rule = parseRRule('FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0,30')
      expect(rule.byHour).toEqual([9, 17])
      expect(rule.byMinute).toEqual([0, 30])
    })

    it('should strip RRULE: prefix', () => {
      const rule = parseRRule('RRULE:FREQ=DAILY')
      expect(rule.freq).toBe('DAILY')
    })

    it('should throw on missing FREQ', () => {
      expect(() => parseRRule('INTERVAL=2')).toThrow('FREQ is required')
    })
  })

  describe('serializeRRule', () => {
    it('should serialize simple rule', () => {
      const rule: RecurrenceRule = { freq: 'DAILY' }
      expect(serializeRRule(rule)).toBe('FREQ=DAILY')
    })

    it('should serialize rule with interval', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 2 }
      expect(serializeRRule(rule)).toBe('FREQ=WEEKLY;INTERVAL=2')
    })

    it('should serialize rule with COUNT', () => {
      const rule: RecurrenceRule = { freq: 'DAILY', count: 10 }
      expect(serializeRRule(rule)).toBe('FREQ=DAILY;COUNT=10')
    })

    it('should serialize rule with UNTIL', () => {
      const rule: RecurrenceRule = {
        freq: 'DAILY',
        until: new Date(Date.UTC(2024, 2, 31, 23, 59, 59)),
      }
      expect(serializeRRule(rule)).toContain('UNTIL=20240331T235959Z')
    })

    it('should serialize rule with BYDAY', () => {
      const rule: RecurrenceRule = {
        freq: 'WEEKLY',
        byDay: [{ day: 'MO' }, { day: 'WE' }, { day: 'FR' }],
      }
      expect(serializeRRule(rule)).toContain('BYDAY=MO,WE,FR')
    })

    it('should serialize BYDAY with position', () => {
      const rule: RecurrenceRule = {
        freq: 'MONTHLY',
        byDay: [{ day: 'MO', n: 2 }],
      }
      expect(serializeRRule(rule)).toContain('BYDAY=+2MO')
    })

    it('should roundtrip parse and serialize', () => {
      const original = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10'
      const rule = parseRRule(original)
      const serialized = serializeRRule(rule)
      const reparsed = parseRRule(serialized)

      expect(reparsed.freq).toBe(rule.freq)
      expect(reparsed.interval).toBe(rule.interval)
      expect(reparsed.count).toBe(rule.count)
      expect(reparsed.byDay?.length).toBe(rule.byDay?.length)
    })
  })

  describe('expandRRule', () => {
    it('should expand daily rule', () => {
      const rule: RecurrenceRule = { freq: 'DAILY', count: 5 }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(5)
      expect(instances[0].getTime()).toBe(dtstart.getTime())
      expect(instances[1].getUTCDate()).toBe(2)
      expect(instances[4].getUTCDate()).toBe(5)
    })

    it('should expand weekly rule', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY', count: 4 }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(4)
      // Each instance should be 7 days apart
      expect(instances[1].getTime() - instances[0].getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('should expand with interval', () => {
      const rule: RecurrenceRule = { freq: 'DAILY', interval: 3, count: 4 }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(4)
      expect(instances[0].getUTCDate()).toBe(1)
      expect(instances[1].getUTCDate()).toBe(4) // +3 days
      expect(instances[2].getUTCDate()).toBe(7) // +6 days
    })

    it('should respect UNTIL limit', () => {
      const rule: RecurrenceRule = {
        freq: 'DAILY',
        until: new Date('2024-01-05T23:59:59Z'),
      }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(5)
      expect(instances[instances.length - 1].getUTCDate()).toBe(5)
    })

    it('should expand BYDAY for weekly', () => {
      const rule: RecurrenceRule = {
        freq: 'WEEKLY',
        byDay: [{ day: 'MO' }, { day: 'WE' }, { day: 'FR' }],
        count: 6,
      }
      const dtstart = new Date('2024-01-01T09:00:00Z') // Monday

      const instances = expandRRule(rule, { dtstart })

      // Should get Mon, Wed, Fri of first week, then Mon, Wed, Fri of second
      expect(instances.length).toBeGreaterThanOrEqual(3)
    })

    it('should expand monthly on specific day', () => {
      const rule: RecurrenceRule = {
        freq: 'MONTHLY',
        byMonthDay: [15],
        count: 3,
      }
      const dtstart = new Date('2024-01-15T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(3)
      expect(instances[0].getUTCDate()).toBe(15)
      expect(instances[1].getUTCMonth()).toBe(1) // February
      expect(instances[1].getUTCDate()).toBe(15)
    })

    it('should expand monthly on Nth weekday', () => {
      const rule: RecurrenceRule = {
        freq: 'MONTHLY',
        byDay: [{ day: 'MO', n: 2 }], // Second Monday
        count: 3,
      }
      const dtstart = new Date('2024-01-08T09:00:00Z') // First second Monday

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(3)
      // Each should be the second Monday of the month
      for (const instance of instances) {
        const dayOfWeek = instance.getUTCDay()
        expect(dayOfWeek).toBe(1) // Monday
      }
    })

    it('should expand with BYSETPOS', () => {
      const rule: RecurrenceRule = {
        freq: 'MONTHLY',
        byDay: [
          { day: 'MO' },
          { day: 'TU' },
          { day: 'WE' },
          { day: 'TH' },
          { day: 'FR' },
        ],
        bySetPos: [-1], // Last weekday of month
        count: 3,
      }
      const dtstart = new Date('2024-01-31T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances.length).toBeGreaterThan(0)
    })

    it('should expand yearly rule', () => {
      const rule: RecurrenceRule = {
        freq: 'YEARLY',
        byMonth: [1],
        byMonthDay: [1],
        count: 3,
      }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(3)
      expect(instances[0].getUTCFullYear()).toBe(2024)
      expect(instances[1].getUTCFullYear()).toBe(2025)
      expect(instances[2].getUTCFullYear()).toBe(2026)
    })

    it('should respect date range', () => {
      const rule: RecurrenceRule = { freq: 'DAILY' }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const instances = expandRRule(rule, {
        dtstart,
        after: new Date('2024-01-05T00:00:00Z'),
        before: new Date('2024-01-10T00:00:00Z'),
      })

      expect(instances.length).toBe(5) // Jan 5-9
      expect(instances[0].getUTCDate()).toBe(5)
      expect(instances[instances.length - 1].getUTCDate()).toBe(9)
    })

    it('should handle negative BYMONTHDAY', () => {
      const rule: RecurrenceRule = {
        freq: 'MONTHLY',
        byMonthDay: [-1], // Last day of month
        count: 3,
      }
      const dtstart = new Date('2024-01-31T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances).toHaveLength(3)
      expect(instances[0].getUTCDate()).toBe(31) // Jan 31
      expect(instances[1].getUTCDate()).toBe(29) // Feb 29 (leap year)
      expect(instances[2].getUTCDate()).toBe(31) // Mar 31
    })

    it('should handle leap year', () => {
      const rule: RecurrenceRule = {
        freq: 'YEARLY',
        byMonth: [2],
        byMonthDay: [29],
        count: 2,
      }
      const dtstart = new Date('2024-02-29T09:00:00Z')

      const instances = expandRRule(rule, { dtstart })

      expect(instances[0].getUTCMonth()).toBe(1)
      expect(instances[0].getUTCDate()).toBe(29)
    })
  })

  describe('matchesRRule', () => {
    it('should match date that is an occurrence', () => {
      const rule: RecurrenceRule = { freq: 'DAILY' }
      const dtstart = new Date('2024-01-01T09:00:00Z')
      const checkDate = new Date('2024-01-05T09:00:00Z')

      expect(matchesRRule(checkDate, rule, dtstart)).toBe(true)
    })

    it('should not match date that is not an occurrence', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY' }
      const dtstart = new Date('2024-01-01T09:00:00Z') // Monday
      const checkDate = new Date('2024-01-03T09:00:00Z') // Wednesday

      expect(matchesRRule(checkDate, rule, dtstart)).toBe(false)
    })
  })

  describe('getNextOccurrence', () => {
    it('should get next occurrence after date', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY' }
      const dtstart = new Date('2024-01-01T09:00:00Z')
      const after = new Date('2024-01-05T09:00:00Z')

      const next = getNextOccurrence(rule, dtstart, after)

      expect(next).toBeDefined()
      expect(next!.getTime()).toBeGreaterThan(after.getTime())
      expect(next!.getUTCDate()).toBe(8) // Next Monday
    })

    it('should return null if no more occurrences', () => {
      const rule: RecurrenceRule = {
        freq: 'DAILY',
        until: new Date('2024-01-05T23:59:59Z'),
      }
      const dtstart = new Date('2024-01-01T09:00:00Z')
      const after = new Date('2024-01-10T09:00:00Z')

      const next = getNextOccurrence(rule, dtstart, after)

      expect(next).toBeNull()
    })
  })

  describe('getPreviousOccurrence', () => {
    it('should get previous occurrence before date', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY' }
      const dtstart = new Date('2024-01-01T09:00:00Z')
      const before = new Date('2024-01-20T09:00:00Z')

      const prev = getPreviousOccurrence(rule, dtstart, before)

      expect(prev).toBeDefined()
      expect(prev!.getTime()).toBeLessThan(before.getTime())
      expect(prev!.getUTCDate()).toBe(15) // Previous Monday
    })
  })

  describe('countOccurrences', () => {
    it('should return COUNT value if specified', () => {
      const rule: RecurrenceRule = { freq: 'DAILY', count: 10 }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      expect(countOccurrences(rule, dtstart)).toBe(10)
    })

    it('should count occurrences until UNTIL', () => {
      const rule: RecurrenceRule = {
        freq: 'DAILY',
        until: new Date('2024-01-10T23:59:59Z'),
      }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      const count = countOccurrences(rule, dtstart)
      expect(count).toBe(10)
    })

    it('should return -1 for infinite recurrence', () => {
      const rule: RecurrenceRule = { freq: 'DAILY' }
      const dtstart = new Date('2024-01-01T09:00:00Z')

      expect(countOccurrences(rule, dtstart)).toBe(-1)
    })
  })

  describe('describeRRule', () => {
    it('should describe daily rule', () => {
      const rule: RecurrenceRule = { freq: 'DAILY' }
      const description = describeRRule(rule)

      expect(description).toContain('dai')
    })

    it('should describe weekly rule with days', () => {
      const rule: RecurrenceRule = {
        freq: 'WEEKLY',
        byDay: [{ day: 'MO' }, { day: 'WE' }, { day: 'FR' }],
      }
      const description = describeRRule(rule)

      expect(description).toContain('MO')
      expect(description).toContain('WE')
      expect(description).toContain('FR')
    })

    it('should describe rule with interval', () => {
      const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 2 }
      const description = describeRRule(rule)

      expect(description).toContain('2')
    })

    it('should describe rule with COUNT', () => {
      const rule: RecurrenceRule = { freq: 'DAILY', count: 10 }
      const description = describeRRule(rule)

      expect(description).toContain('10')
      expect(description).toContain('times')
    })
  })

  describe('RecurrencePresets', () => {
    it('should create daily preset', () => {
      const rule = RecurrencePresets.daily()
      expect(rule.freq).toBe('DAILY')
      expect(rule.interval).toBe(1)
    })

    it('should create weekdays preset', () => {
      const rule = RecurrencePresets.weekdays()
      expect(rule.freq).toBe('WEEKLY')
      expect(rule.byDay).toHaveLength(5)
    })

    it('should create weekly preset', () => {
      const rule = RecurrencePresets.weekly(['MO', 'WE', 'FR'])
      expect(rule.freq).toBe('WEEKLY')
      expect(rule.byDay).toHaveLength(3)
    })

    it('should create monthly preset', () => {
      const rule = RecurrencePresets.monthly(15)
      expect(rule.freq).toBe('MONTHLY')
      expect(rule.byMonthDay).toEqual([15])
    })

    it('should create monthly by day preset', () => {
      const rule = RecurrencePresets.monthlyByDay('MO', 2)
      expect(rule.freq).toBe('MONTHLY')
      expect(rule.byDay![0].day).toBe('MO')
      expect(rule.byDay![0].n).toBe(2)
    })

    it('should create yearly preset', () => {
      const rule = RecurrencePresets.yearly(12, 25)
      expect(rule.freq).toBe('YEARLY')
      expect(rule.byMonth).toEqual([12])
      expect(rule.byMonthDay).toEqual([25])
    })
  })
})
