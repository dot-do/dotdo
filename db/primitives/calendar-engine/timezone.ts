/**
 * TimeZoneHandler - Timezone-aware date/time operations
 *
 * Provides comprehensive timezone handling including:
 * - Timezone conversions
 * - DST-aware calculations
 * - Cross-timezone scheduling
 * - UTC normalization
 *
 * Uses Temporal API concepts but works with native Date for compatibility.
 *
 * @module db/primitives/calendar-engine/timezone
 */

import type { TimeZone, TimeString, DateString, DayOfWeek } from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface TimeZoneInfo {
  /** IANA timezone ID */
  id: TimeZone
  /** Current UTC offset in minutes */
  offsetMinutes: number
  /** Human-readable offset (e.g., "+05:30") */
  offsetString: string
  /** Whether currently in DST */
  isDST: boolean
  /** Timezone abbreviation (e.g., "EST", "PDT") */
  abbreviation: string
}

export interface DSTTransition {
  /** Transition date */
  date: Date
  /** Offset before transition (minutes) */
  offsetBefore: number
  /** Offset after transition (minutes) */
  offsetAfter: number
  /** Direction: 'forward' (spring) or 'backward' (fall) */
  direction: 'forward' | 'backward'
}

export interface TimeZoneHandlerConfig {
  /** Default timezone */
  defaultTimezone?: TimeZone
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY
const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE

// Common timezone aliases
const TIMEZONE_ALIASES: Record<string, TimeZone> = {
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  GMT: 'Etc/GMT',
  BST: 'Europe/London',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  IST: 'Asia/Kolkata',
  JST: 'Asia/Tokyo',
  AEST: 'Australia/Sydney',
  AEDT: 'Australia/Sydney',
  NZST: 'Pacific/Auckland',
  NZDT: 'Pacific/Auckland',
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
export function parseTimeString(time: TimeString): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * MINUTES_PER_HOUR + minutes
}

/**
 * Format minutes since midnight to time string (HH:MM)
 */
export function formatTimeString(minutes: number): TimeString {
  const normalizedMinutes = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours = Math.floor(normalizedMinutes / MINUTES_PER_HOUR)
  const mins = normalizedMinutes % MINUTES_PER_HOUR
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

/**
 * Parse date string (YYYY-MM-DD) to Date (at midnight UTC)
 */
export function parseDateString(date: DateString): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Format Date to date string (YYYY-MM-DD)
 */
export function formatDateString(date: Date): DateString {
  const year = date.getUTCFullYear()
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Resolve timezone alias to IANA timezone
 */
export function resolveTimezone(tz: string): TimeZone {
  return TIMEZONE_ALIASES[tz.toUpperCase()] || tz
}

/**
 * Get UTC offset in minutes for a timezone at a specific date
 */
export function getTimezoneOffset(timezone: TimeZone, date: Date = new Date()): number {
  const resolvedTz = resolveTimezone(timezone)

  // Use Intl.DateTimeFormat to get the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTz,
    timeZoneName: 'longOffset',
  })

  const parts = formatter.formatToParts(date)
  const tzPart = parts.find((p) => p.type === 'timeZoneName')

  if (!tzPart) {
    return 0
  }

  // Parse offset like "GMT+05:30" or "GMT-08:00"
  const match = tzPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/)
  if (!match) {
    return 0
  }

  const sign = match[1] === '+' ? 1 : -1
  const hours = parseInt(match[2], 10)
  const minutes = match[3] ? parseInt(match[3], 10) : 0

  return sign * (hours * MINUTES_PER_HOUR + minutes)
}

/**
 * Get timezone abbreviation at a specific date
 */
export function getTimezoneAbbreviation(timezone: TimeZone, date: Date = new Date()): string {
  const resolvedTz = resolveTimezone(timezone)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTz,
    timeZoneName: 'short',
  })

  const parts = formatter.formatToParts(date)
  const tzPart = parts.find((p) => p.type === 'timeZoneName')

  return tzPart?.value || 'UTC'
}

/**
 * Check if a timezone is currently observing DST
 */
export function isDST(timezone: TimeZone, date: Date = new Date()): boolean {
  const resolvedTz = resolveTimezone(timezone)

  // Compare offsets in January and July to determine DST
  const january = new Date(date.getFullYear(), 0, 1)
  const july = new Date(date.getFullYear(), 6, 1)

  const januaryOffset = getTimezoneOffset(resolvedTz, january)
  const julyOffset = getTimezoneOffset(resolvedTz, july)
  const currentOffset = getTimezoneOffset(resolvedTz, date)

  // If offsets are the same, no DST
  if (januaryOffset === julyOffset) {
    return false
  }

  // The larger offset (less negative / more positive) is DST
  const standardOffset = Math.min(januaryOffset, julyOffset)
  return currentOffset !== standardOffset
}

/**
 * Format offset minutes to string (e.g., "+05:30", "-08:00")
 */
function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const hours = Math.floor(absOffset / MINUTES_PER_HOUR)
  const minutes = absOffset % MINUTES_PER_HOUR
  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

// ============================================================================
// TIMEZONE HANDLER CLASS
// ============================================================================

export class TimeZoneHandler {
  private readonly defaultTimezone: TimeZone

  constructor(config: TimeZoneHandlerConfig = {}) {
    this.defaultTimezone = config.defaultTimezone || 'UTC'
  }

  /**
   * Get timezone information for a specific date
   */
  getInfo(timezone: TimeZone = this.defaultTimezone, date: Date = new Date()): TimeZoneInfo {
    const resolvedTz = resolveTimezone(timezone)
    const offsetMinutes = getTimezoneOffset(resolvedTz, date)

    return {
      id: resolvedTz,
      offsetMinutes,
      offsetString: formatOffset(offsetMinutes),
      isDST: isDST(resolvedTz, date),
      abbreviation: getTimezoneAbbreviation(resolvedTz, date),
    }
  }

  /**
   * Convert a date from one timezone to another
   */
  convert(date: Date, fromTz: TimeZone, toTz: TimeZone): Date {
    const fromOffset = getTimezoneOffset(fromTz, date)
    const toOffset = getTimezoneOffset(toTz, date)
    const offsetDiff = toOffset - fromOffset

    return new Date(date.getTime() + offsetDiff * MS_PER_MINUTE)
  }

  /**
   * Convert local time to UTC
   */
  toUTC(date: Date, timezone: TimeZone = this.defaultTimezone): Date {
    const offset = getTimezoneOffset(timezone, date)
    return new Date(date.getTime() - offset * MS_PER_MINUTE)
  }

  /**
   * Convert UTC to local time
   */
  fromUTC(date: Date, timezone: TimeZone = this.defaultTimezone): Date {
    const offset = getTimezoneOffset(timezone, date)
    return new Date(date.getTime() + offset * MS_PER_MINUTE)
  }

  /**
   * Create a date in a specific timezone
   */
  createDate(
    year: number,
    month: number, // 1-12
    day: number,
    hour: number = 0,
    minute: number = 0,
    second: number = 0,
    timezone: TimeZone = this.defaultTimezone
  ): Date {
    // Create date as if it were UTC
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

    // Adjust for timezone offset
    const offset = getTimezoneOffset(timezone, utcDate)
    return new Date(utcDate.getTime() - offset * MS_PER_MINUTE)
  }

  /**
   * Create a date from date and time strings in a timezone
   */
  createFromStrings(
    dateStr: DateString,
    timeStr: TimeString,
    timezone: TimeZone = this.defaultTimezone
  ): Date {
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hours, minutes] = timeStr.split(':').map(Number)
    return this.createDate(year, month, day, hours, minutes, 0, timezone)
  }

  /**
   * Get the day of week in a specific timezone
   */
  getDayOfWeek(date: Date, timezone: TimeZone = this.defaultTimezone): DayOfWeek {
    // Get local date parts in the timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolveTimezone(timezone),
      weekday: 'narrow',
    })

    const parts = formatter.formatToParts(date)
    const weekdayPart = parts.find((p) => p.type === 'weekday')

    // Map weekday narrow format to day number
    const dayMap: Record<string, DayOfWeek> = {
      S: 0, // Sunday
      M: 1, // Monday
      T: 2, // Tuesday
      W: 3, // Wednesday
      F: 5, // Friday
    }

    // Handle Thursday (T) and Saturday (S) ambiguity
    if (weekdayPart?.value === 'T') {
      // Check if it's Thursday or Tuesday by looking at the date
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimezone(timezone),
        weekday: 'long',
      })
      const fullDay = dayFormatter.format(date)
      return fullDay.startsWith('Th') ? 4 : 2
    }

    if (weekdayPart?.value === 'S') {
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTimezone(timezone),
        weekday: 'long',
      })
      const fullDay = dayFormatter.format(date)
      return fullDay.startsWith('Sa') ? 6 : 0
    }

    return dayMap[weekdayPart?.value || 'S'] || 0
  }

  /**
   * Get date components in a specific timezone
   */
  getDateParts(
    date: Date,
    timezone: TimeZone = this.defaultTimezone
  ): {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
    dayOfWeek: DayOfWeek
  } {
    const resolvedTz = resolveTimezone(timezone)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const parts = formatter.formatToParts(date)
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || '0', 10)

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') === 24 ? 0 : get('hour'), // Normalize midnight
      minute: get('minute'),
      second: get('second'),
      dayOfWeek: this.getDayOfWeek(date, timezone),
    }
  }

  /**
   * Get start of day in a specific timezone
   */
  startOfDay(date: Date, timezone: TimeZone = this.defaultTimezone): Date {
    const parts = this.getDateParts(date, timezone)
    return this.createDate(parts.year, parts.month, parts.day, 0, 0, 0, timezone)
  }

  /**
   * Get end of day in a specific timezone
   */
  endOfDay(date: Date, timezone: TimeZone = this.defaultTimezone): Date {
    const parts = this.getDateParts(date, timezone)
    return this.createDate(parts.year, parts.month, parts.day, 23, 59, 59, timezone)
  }

  /**
   * Get start of week in a specific timezone
   */
  startOfWeek(
    date: Date,
    timezone: TimeZone = this.defaultTimezone,
    weekStartsOn: DayOfWeek = 0
  ): Date {
    const start = this.startOfDay(date, timezone)
    const dayOfWeek = this.getDayOfWeek(start, timezone)
    const diff = (dayOfWeek - weekStartsOn + 7) % 7
    return new Date(start.getTime() - diff * MS_PER_DAY)
  }

  /**
   * Get end of week in a specific timezone
   */
  endOfWeek(
    date: Date,
    timezone: TimeZone = this.defaultTimezone,
    weekStartsOn: DayOfWeek = 0
  ): Date {
    const start = this.startOfWeek(date, timezone, weekStartsOn)
    return new Date(start.getTime() + 7 * MS_PER_DAY - 1)
  }

  /**
   * Add days to a date (timezone-aware)
   */
  addDays(date: Date, days: number, timezone: TimeZone = this.defaultTimezone): Date {
    // Get current time in timezone
    const parts = this.getDateParts(date, timezone)

    // Add days and create new date
    const newDate = new Date(Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + days,
      parts.hour,
      parts.minute,
      parts.second
    ))

    // Convert back from "local" to actual time
    const offset = getTimezoneOffset(timezone, newDate)
    return new Date(newDate.getTime() - offset * MS_PER_MINUTE)
  }

  /**
   * Add hours to a date
   */
  addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * MS_PER_HOUR)
  }

  /**
   * Add minutes to a date
   */
  addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * MS_PER_MINUTE)
  }

  /**
   * Check if two dates are on the same day in a timezone
   */
  isSameDay(date1: Date, date2: Date, timezone: TimeZone = this.defaultTimezone): boolean {
    const parts1 = this.getDateParts(date1, timezone)
    const parts2 = this.getDateParts(date2, timezone)

    return (
      parts1.year === parts2.year &&
      parts1.month === parts2.month &&
      parts1.day === parts2.day
    )
  }

  /**
   * Find DST transitions in a year
   */
  findDSTTransitions(year: number, timezone: TimeZone = this.defaultTimezone): DSTTransition[] {
    const transitions: DSTTransition[] = []
    const resolvedTz = resolveTimezone(timezone)

    // Check each day of the year for offset changes
    let prevOffset = getTimezoneOffset(resolvedTz, new Date(year, 0, 1))

    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(year, month + 1, 0).getDate()

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day, 3, 0, 0) // Check at 3 AM to avoid midnight issues
        const offset = getTimezoneOffset(resolvedTz, date)

        if (offset !== prevOffset) {
          transitions.push({
            date: new Date(year, month, day),
            offsetBefore: prevOffset,
            offsetAfter: offset,
            direction: offset > prevOffset ? 'forward' : 'backward',
          })
        }

        prevOffset = offset
      }
    }

    return transitions
  }

  /**
   * Check if a date falls on a DST transition day
   */
  isDSTTransitionDay(date: Date, timezone: TimeZone = this.defaultTimezone): boolean {
    const transitions = this.findDSTTransitions(date.getFullYear(), timezone)
    return transitions.some((t) => this.isSameDay(t.date, date, timezone))
  }

  /**
   * Validate a timezone string
   */
  isValidTimezone(timezone: string): boolean {
    try {
      const resolved = resolveTimezone(timezone)
      new Intl.DateTimeFormat('en-US', { timeZone: resolved })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get common timezones
   */
  getCommonTimezones(): TimeZone[] {
    return [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Moscow',
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Singapore',
      'Asia/Hong_Kong',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Pacific/Auckland',
      'UTC',
    ]
  }

  /**
   * Get default timezone
   */
  getDefaultTimezone(): TimeZone {
    return this.defaultTimezone
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createTimeZoneHandler(
  config: TimeZoneHandlerConfig = {}
): TimeZoneHandler {
  return new TimeZoneHandler(config)
}
