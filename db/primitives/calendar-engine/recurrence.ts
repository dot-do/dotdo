/**
 * RecurrenceRule - RFC 5545 RRULE parsing and expansion
 *
 * Implements iCalendar recurrence rule (RRULE) parsing and instance expansion.
 * Supports all RFC 5545 recurrence components including:
 * - FREQ, INTERVAL, UNTIL, COUNT
 * - BYDAY, BYMONTH, BYMONTHDAY, BYYEARDAY, BYWEEKNO
 * - BYHOUR, BYMINUTE, BYSECOND
 * - BYSETPOS, WKST
 *
 * @see https://tools.ietf.org/html/rfc5545#section-3.3.10
 * @module db/primitives/calendar-engine/recurrence
 */

import type {
  RecurrenceRule,
  RecurrenceFrequency,
  WeekDayNum,
  DayName,
  WeekStart,
  TimeZone,
} from './types'
import { TimeZoneHandler } from './timezone'

// ============================================================================
// CONSTANTS
// ============================================================================

const DAY_NAMES: DayName[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const DAY_NAME_TO_NUM: Record<DayName, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_WEEK = 7 * MS_PER_DAY

// Maximum instances to prevent infinite loops
const MAX_INSTANCES = 1000

// Maximum years to look ahead for UNTIL
const MAX_YEARS_AHEAD = 10

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse RRULE string to RecurrenceRule object
 */
export function parseRRule(rruleString: string): RecurrenceRule {
  // Remove "RRULE:" prefix if present
  const str = rruleString.replace(/^RRULE:/i, '').trim()

  const parts = str.split(';')
  const rule: Partial<RecurrenceRule> = {}

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (!key || !value) continue

    switch (key.toUpperCase()) {
      case 'FREQ':
        rule.freq = value.toUpperCase() as RecurrenceFrequency
        break

      case 'INTERVAL':
        rule.interval = parseInt(value, 10)
        break

      case 'UNTIL':
        rule.until = parseRRuleDate(value)
        break

      case 'COUNT':
        rule.count = parseInt(value, 10)
        break

      case 'BYSECOND':
        rule.bySecond = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYMINUTE':
        rule.byMinute = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYHOUR':
        rule.byHour = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYDAY':
        rule.byDay = value.split(',').map(parseWeekDayNum)
        break

      case 'BYMONTHDAY':
        rule.byMonthDay = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYYEARDAY':
        rule.byYearDay = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYWEEKNO':
        rule.byWeekNo = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYMONTH':
        rule.byMonth = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'BYSETPOS':
        rule.bySetPos = value.split(',').map((v) => parseInt(v, 10))
        break

      case 'WKST':
        rule.wkst = value.toUpperCase() as WeekStart
        break
    }
  }

  if (!rule.freq) {
    throw new Error('FREQ is required in RRULE')
  }

  return rule as RecurrenceRule
}

/**
 * Parse RRULE date string (YYYYMMDD or YYYYMMDDTHHMMSSZ)
 */
function parseRRuleDate(value: string): Date {
  if (value.length === 8) {
    // YYYYMMDD
    const year = parseInt(value.slice(0, 4), 10)
    const month = parseInt(value.slice(4, 6), 10) - 1
    const day = parseInt(value.slice(6, 8), 10)
    return new Date(Date.UTC(year, month, day))
  }

  // YYYYMMDDTHHMMSSZ
  const year = parseInt(value.slice(0, 4), 10)
  const month = parseInt(value.slice(4, 6), 10) - 1
  const day = parseInt(value.slice(6, 8), 10)
  const hour = parseInt(value.slice(9, 11), 10)
  const minute = parseInt(value.slice(11, 13), 10)
  const second = parseInt(value.slice(13, 15), 10)

  return new Date(Date.UTC(year, month, day, hour, minute, second))
}

/**
 * Parse weekday num (e.g., "MO", "+2MO", "-1FR")
 */
function parseWeekDayNum(value: string): WeekDayNum {
  const match = value.match(/^([+-]?\d+)?([A-Z]{2})$/i)
  if (!match) {
    throw new Error(`Invalid BYDAY value: ${value}`)
  }

  const [, numStr, dayStr] = match
  const day = dayStr.toUpperCase() as DayName

  if (!DAY_NAMES.includes(day)) {
    throw new Error(`Invalid day name: ${dayStr}`)
  }

  return numStr ? { day, n: parseInt(numStr, 10) } : { day }
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize RecurrenceRule to RRULE string
 */
export function serializeRRule(rule: RecurrenceRule): string {
  const parts: string[] = []

  parts.push(`FREQ=${rule.freq}`)

  if (rule.interval && rule.interval !== 1) {
    parts.push(`INTERVAL=${rule.interval}`)
  }

  if (rule.until) {
    parts.push(`UNTIL=${formatRRuleDate(rule.until)}`)
  }

  if (rule.count) {
    parts.push(`COUNT=${rule.count}`)
  }

  if (rule.bySecond?.length) {
    parts.push(`BYSECOND=${rule.bySecond.join(',')}`)
  }

  if (rule.byMinute?.length) {
    parts.push(`BYMINUTE=${rule.byMinute.join(',')}`)
  }

  if (rule.byHour?.length) {
    parts.push(`BYHOUR=${rule.byHour.join(',')}`)
  }

  if (rule.byDay?.length) {
    parts.push(`BYDAY=${rule.byDay.map(serializeWeekDayNum).join(',')}`)
  }

  if (rule.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  }

  if (rule.byYearDay?.length) {
    parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`)
  }

  if (rule.byWeekNo?.length) {
    parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`)
  }

  if (rule.byMonth?.length) {
    parts.push(`BYMONTH=${rule.byMonth.join(',')}`)
  }

  if (rule.bySetPos?.length) {
    parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`)
  }

  if (rule.wkst && rule.wkst !== 'MO') {
    parts.push(`WKST=${rule.wkst}`)
  }

  return parts.join(';')
}

/**
 * Format date for RRULE
 */
function formatRRuleDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  const hour = date.getUTCHours().toString().padStart(2, '0')
  const minute = date.getUTCMinutes().toString().padStart(2, '0')
  const second = date.getUTCSeconds().toString().padStart(2, '0')

  return `${year}${month}${day}T${hour}${minute}${second}Z`
}

/**
 * Serialize WeekDayNum to string
 */
function serializeWeekDayNum(wdn: WeekDayNum): string {
  return wdn.n ? `${wdn.n > 0 ? '+' : ''}${wdn.n}${wdn.day}` : wdn.day
}

// ============================================================================
// EXPANSION
// ============================================================================

export interface ExpandOptions {
  /** Start date for the event (DTSTART) */
  dtstart: Date
  /** Timezone for expansion */
  timezone?: TimeZone
  /** Range start (inclusive) */
  after?: Date
  /** Range end (exclusive) */
  before?: Date
  /** Maximum instances to return */
  maxInstances?: number
  /** Include DTSTART in results even if it doesn't match rule */
  includeDtstart?: boolean
}

/**
 * Expand a recurrence rule into individual occurrences
 */
export function expandRRule(rule: RecurrenceRule, options: ExpandOptions): Date[] {
  const {
    dtstart,
    timezone = 'UTC',
    after,
    before,
    maxInstances = MAX_INSTANCES,
    includeDtstart = true,
  } = options

  const tzHandler = new TimeZoneHandler({ defaultTimezone: timezone })
  const results: Date[] = []

  // Determine end boundary
  let endBoundary: Date
  if (rule.until) {
    endBoundary = before && before < rule.until ? before : rule.until
  } else if (before) {
    endBoundary = before
  } else {
    // Default: 10 years from start
    endBoundary = new Date(dtstart.getTime() + MAX_YEARS_AHEAD * 365 * MS_PER_DAY)
  }

  const interval = rule.interval || 1
  const wkst = rule.wkst || 'MO'
  const wkstNum = DAY_NAME_TO_NUM[wkst]

  // Track count for COUNT limit
  let instanceCount = 0
  const maxCount = rule.count || Infinity

  // Generator based on frequency
  let current = new Date(dtstart)

  // Include DTSTART if requested and within range
  if (includeDtstart) {
    if ((!after || dtstart >= after) && dtstart < endBoundary) {
      results.push(new Date(dtstart))
      instanceCount++
    }
  }

  // Main expansion loop
  while (
    current < endBoundary &&
    instanceCount < maxCount &&
    results.length < maxInstances
  ) {
    // Generate candidates for current interval period
    const candidates = generateCandidates(rule, current, tzHandler, wkstNum)

    // Filter and add matching candidates
    for (const candidate of candidates) {
      if (candidate <= dtstart) continue // Skip DTSTART (already handled)
      if (candidate >= endBoundary) continue
      if (after && candidate < after) continue
      if (instanceCount >= maxCount) break
      if (results.length >= maxInstances) break

      results.push(candidate)
      instanceCount++
    }

    // Advance to next interval period
    current = advanceByFrequency(current, rule.freq, interval, tzHandler)
  }

  return results.sort((a, b) => a.getTime() - b.getTime())
}

/**
 * Generate candidate dates for a single interval period
 */
function generateCandidates(
  rule: RecurrenceRule,
  periodStart: Date,
  tzHandler: TimeZoneHandler,
  wkstNum: number
): Date[] {
  let candidates: Date[] = [periodStart]

  // Apply BY* rules in order (RFC 5545 section 3.3.10)
  // The order affects how the set is expanded or limited

  // BYMONTH - limit by month
  if (rule.byMonth?.length) {
    candidates = candidates.filter((d) => {
      const month = tzHandler.getDateParts(d).month
      return rule.byMonth!.includes(month)
    })
  }

  // BYWEEKNO - expand/limit by week number
  if (rule.byWeekNo?.length && rule.freq === 'YEARLY') {
    candidates = expandByWeekNo(candidates, rule.byWeekNo, tzHandler, wkstNum)
  }

  // BYYEARDAY - expand/limit by day of year
  if (rule.byYearDay?.length) {
    candidates = expandByYearDay(candidates, rule.byYearDay, tzHandler)
  }

  // BYMONTHDAY - expand/limit by day of month
  if (rule.byMonthDay?.length) {
    candidates = expandByMonthDay(candidates, rule.byMonthDay, tzHandler)
  }

  // BYDAY - expand/limit by day of week
  if (rule.byDay?.length) {
    candidates = expandByDay(candidates, rule.byDay, rule.freq, tzHandler)
  }

  // BYHOUR - expand/limit by hour
  if (rule.byHour?.length) {
    candidates = expandByTime(candidates, 'hour', rule.byHour, tzHandler)
  }

  // BYMINUTE - expand/limit by minute
  if (rule.byMinute?.length) {
    candidates = expandByTime(candidates, 'minute', rule.byMinute, tzHandler)
  }

  // BYSECOND - expand/limit by second
  if (rule.bySecond?.length) {
    candidates = expandByTime(candidates, 'second', rule.bySecond, tzHandler)
  }

  // BYSETPOS - filter by position
  if (rule.bySetPos?.length) {
    candidates = filterBySetPos(candidates, rule.bySetPos)
  }

  return candidates
}

/**
 * Expand candidates by week number
 */
function expandByWeekNo(
  candidates: Date[],
  weekNums: number[],
  tzHandler: TimeZoneHandler,
  wkstNum: number
): Date[] {
  const results: Date[] = []

  for (const date of candidates) {
    const year = tzHandler.getDateParts(date).year

    for (const weekNo of weekNums) {
      const weekStart = getWeekOfYear(year, weekNo, wkstNum)
      if (weekStart) {
        results.push(weekStart)
      }
    }
  }

  return results
}

/**
 * Get the start of a specific week in a year
 */
function getWeekOfYear(year: number, weekNo: number, wkstNum: number): Date | null {
  // Find first week of year (week containing Jan 4)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay()

  // Adjust to week start
  const daysToSubtract = (jan4Day - wkstNum + 7) % 7
  const week1Start = new Date(jan4.getTime() - daysToSubtract * MS_PER_DAY)

  // Handle negative week numbers (from end of year)
  let targetWeek = weekNo
  if (weekNo < 0) {
    // Get last week of year
    const lastWeekNum = getISOWeekNumber(new Date(Date.UTC(year, 11, 28)))
    targetWeek = lastWeekNum + weekNo + 1
  }

  if (targetWeek < 1 || targetWeek > 53) {
    return null
  }

  return new Date(week1Start.getTime() + (targetWeek - 1) * MS_PER_WEEK)
}

/**
 * Get ISO week number
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7)
}

/**
 * Expand candidates by year day
 */
function expandByYearDay(
  candidates: Date[],
  yearDays: number[],
  tzHandler: TimeZoneHandler
): Date[] {
  const results: Date[] = []

  for (const date of candidates) {
    const year = tzHandler.getDateParts(date).year
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1))
    const daysInYear = Math.round((yearEnd.getTime() - yearStart.getTime()) / MS_PER_DAY)

    for (const yearDay of yearDays) {
      let dayNum = yearDay
      if (dayNum < 0) {
        dayNum = daysInYear + dayNum + 1
      }
      if (dayNum >= 1 && dayNum <= daysInYear) {
        results.push(new Date(yearStart.getTime() + (dayNum - 1) * MS_PER_DAY))
      }
    }
  }

  return results
}

/**
 * Expand candidates by month day
 */
function expandByMonthDay(
  candidates: Date[],
  monthDays: number[],
  tzHandler: TimeZoneHandler
): Date[] {
  const results: Date[] = []

  for (const date of candidates) {
    const parts = tzHandler.getDateParts(date)
    const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()

    for (const monthDay of monthDays) {
      let dayNum = monthDay
      if (dayNum < 0) {
        dayNum = daysInMonth + dayNum + 1
      }
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        const newDate = new Date(Date.UTC(parts.year, parts.month - 1, dayNum, parts.hour, parts.minute, parts.second))
        results.push(newDate)
      }
    }
  }

  return results
}

/**
 * Expand candidates by day of week
 */
function expandByDay(
  candidates: Date[],
  byDay: WeekDayNum[],
  freq: RecurrenceFrequency,
  tzHandler: TimeZoneHandler
): Date[] {
  const results: Date[] = []

  for (const date of candidates) {
    const parts = tzHandler.getDateParts(date)

    for (const { day, n } of byDay) {
      const targetDayNum = DAY_NAME_TO_NUM[day]

      if (n !== undefined && (freq === 'MONTHLY' || freq === 'YEARLY')) {
        // Nth weekday of month/year
        const nthDay = getNthWeekday(parts.year, parts.month, targetDayNum, n, freq === 'YEARLY')
        if (nthDay) {
          results.push(new Date(Date.UTC(
            nthDay.getUTCFullYear(),
            nthDay.getUTCMonth(),
            nthDay.getUTCDate(),
            parts.hour,
            parts.minute,
            parts.second
          )))
        }
      } else {
        // Match any occurrence of this weekday
        if (freq === 'WEEKLY') {
          // For weekly, just check if day matches
          if (parts.dayOfWeek === targetDayNum) {
            results.push(date)
          } else {
            // Add the right day in this week
            const diff = (targetDayNum - parts.dayOfWeek + 7) % 7
            const adjusted = new Date(date.getTime() + diff * MS_PER_DAY)
            results.push(adjusted)
          }
        } else if (freq === 'MONTHLY') {
          // Find all occurrences in month
          const monthStart = new Date(Date.UTC(parts.year, parts.month - 1, 1))
          const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()

          for (let d = 1; d <= daysInMonth; d++) {
            const checkDate = new Date(Date.UTC(parts.year, parts.month - 1, d))
            if (checkDate.getUTCDay() === targetDayNum) {
              results.push(new Date(Date.UTC(
                parts.year,
                parts.month - 1,
                d,
                parts.hour,
                parts.minute,
                parts.second
              )))
            }
          }
        } else {
          // For daily frequency, just check the day
          if (parts.dayOfWeek === targetDayNum) {
            results.push(date)
          }
        }
      }
    }
  }

  return results
}

/**
 * Get the Nth weekday of a month or year
 */
function getNthWeekday(
  year: number,
  month: number,
  dayOfWeek: number,
  n: number,
  yearScope: boolean
): Date | null {
  let startDate: Date
  let endDate: Date

  if (yearScope) {
    startDate = new Date(Date.UTC(year, 0, 1))
    endDate = new Date(Date.UTC(year + 1, 0, 1))
  } else {
    startDate = new Date(Date.UTC(year, month - 1, 1))
    endDate = new Date(Date.UTC(year, month, 1))
  }

  const occurrences: Date[] = []
  const current = new Date(startDate)

  while (current < endDate) {
    if (current.getUTCDay() === dayOfWeek) {
      occurrences.push(new Date(current))
    }
    current.setTime(current.getTime() + MS_PER_DAY)
  }

  if (n > 0) {
    return n <= occurrences.length ? occurrences[n - 1] : null
  } else {
    const index = occurrences.length + n
    return index >= 0 ? occurrences[index] : null
  }
}

/**
 * Expand candidates by time component
 */
function expandByTime(
  candidates: Date[],
  component: 'hour' | 'minute' | 'second',
  values: number[],
  tzHandler: TimeZoneHandler
): Date[] {
  const results: Date[] = []

  for (const date of candidates) {
    const parts = tzHandler.getDateParts(date)

    for (const value of values) {
      const newParts = { ...parts }
      newParts[component] = value

      results.push(new Date(Date.UTC(
        newParts.year,
        newParts.month - 1,
        newParts.day,
        newParts.hour,
        newParts.minute,
        newParts.second
      )))
    }
  }

  return results
}

/**
 * Filter candidates by set position
 */
function filterBySetPos(candidates: Date[], positions: number[]): Date[] {
  if (candidates.length === 0) return []

  // Sort candidates
  const sorted = [...candidates].sort((a, b) => a.getTime() - b.getTime())

  const results: Date[] = []

  for (const pos of positions) {
    let index: number
    if (pos > 0) {
      index = pos - 1
    } else {
      index = sorted.length + pos
    }

    if (index >= 0 && index < sorted.length) {
      results.push(sorted[index])
    }
  }

  return results
}

/**
 * Advance date by frequency interval
 */
function advanceByFrequency(
  date: Date,
  freq: RecurrenceFrequency,
  interval: number,
  tzHandler: TimeZoneHandler
): Date {
  const parts = tzHandler.getDateParts(date)

  switch (freq) {
    case 'SECONDLY':
      return new Date(date.getTime() + interval * MS_PER_SECOND)

    case 'MINUTELY':
      return new Date(date.getTime() + interval * MS_PER_MINUTE)

    case 'HOURLY':
      return new Date(date.getTime() + interval * MS_PER_HOUR)

    case 'DAILY':
      return tzHandler.addDays(date, interval)

    case 'WEEKLY':
      return new Date(date.getTime() + interval * MS_PER_WEEK)

    case 'MONTHLY': {
      const newMonth = parts.month + interval
      const targetYear = parts.year + Math.floor((newMonth - 1) / 12)
      const targetMonth = ((newMonth - 1) % 12) + 1
      const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
      const targetDay = Math.min(parts.day, daysInTarget)
      return new Date(Date.UTC(
        targetYear,
        targetMonth - 1,
        targetDay,
        parts.hour,
        parts.minute,
        parts.second
      ))
    }

    case 'YEARLY': {
      const targetYear = parts.year + interval
      // Handle Feb 29 -> Feb 28 for non-leap years
      const daysInTarget = new Date(Date.UTC(targetYear, parts.month, 0)).getUTCDate()
      const targetDay = Math.min(parts.day, daysInTarget)
      return new Date(Date.UTC(
        targetYear,
        parts.month - 1,
        targetDay,
        parts.hour,
        parts.minute,
        parts.second
      ))
    }

    default:
      throw new Error(`Unknown frequency: ${freq}`)
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Check if a date matches a recurrence rule
 */
export function matchesRRule(
  date: Date,
  rule: RecurrenceRule,
  dtstart: Date,
  timezone: TimeZone = 'UTC'
): boolean {
  const instances = expandRRule(rule, {
    dtstart,
    timezone,
    after: new Date(date.getTime() - MS_PER_MINUTE),
    before: new Date(date.getTime() + MS_PER_MINUTE),
    maxInstances: 1,
  })

  return instances.some((d) =>
    Math.abs(d.getTime() - date.getTime()) < MS_PER_MINUTE
  )
}

/**
 * Get the next occurrence after a given date
 */
export function getNextOccurrence(
  rule: RecurrenceRule,
  dtstart: Date,
  after: Date,
  timezone: TimeZone = 'UTC'
): Date | null {
  const instances = expandRRule(rule, {
    dtstart,
    timezone,
    after: new Date(after.getTime() + 1),
    maxInstances: 1,
  })

  return instances[0] || null
}

/**
 * Get the previous occurrence before a given date
 */
export function getPreviousOccurrence(
  rule: RecurrenceRule,
  dtstart: Date,
  before: Date,
  timezone: TimeZone = 'UTC'
): Date | null {
  const instances = expandRRule(rule, {
    dtstart,
    timezone,
    before,
    maxInstances: MAX_INSTANCES,
  })

  return instances.length > 0 ? instances[instances.length - 1] : null
}

/**
 * Count total occurrences of a rule
 */
export function countOccurrences(
  rule: RecurrenceRule,
  dtstart: Date,
  options: { until?: Date; timezone?: TimeZone } = {}
): number {
  const { until, timezone = 'UTC' } = options

  // If COUNT is specified, that's the answer
  if (rule.count) {
    return rule.count
  }

  // If no UNTIL and no explicit until, return -1 (infinite)
  if (!rule.until && !until) {
    return -1
  }

  const instances = expandRRule(rule, {
    dtstart,
    timezone,
    before: until || rule.until,
    maxInstances: MAX_INSTANCES,
  })

  return instances.length
}

/**
 * Create a human-readable description of a recurrence rule
 */
export function describeRRule(rule: RecurrenceRule): string {
  const parts: string[] = []

  const interval = rule.interval || 1
  const freq = rule.freq.toLowerCase()

  // Frequency with interval
  if (interval === 1) {
    parts.push(`Every ${freq.replace('ly', '')}`)
  } else {
    const unit = freq.replace('ly', '') + (interval > 1 ? 's' : '')
    parts.push(`Every ${interval} ${unit}`)
  }

  // Days
  if (rule.byDay?.length) {
    const days = rule.byDay.map((d) => {
      if (d.n) {
        const pos = d.n > 0 ? `${d.n}${getOrdinalSuffix(d.n)}` : `last${Math.abs(d.n) > 1 ? ` ${Math.abs(d.n)}` : ''}`
        return `${pos} ${d.day}`
      }
      return d.day
    })
    parts.push(`on ${days.join(', ')}`)
  }

  // Month days
  if (rule.byMonthDay?.length) {
    const days = rule.byMonthDay.map((d) => d < 0 ? `${d}th from end` : `${d}${getOrdinalSuffix(d)}`)
    parts.push(`on the ${days.join(', ')}`)
  }

  // Months
  if (rule.byMonth?.length) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const months = rule.byMonth.map((m) => monthNames[m - 1])
    parts.push(`in ${months.join(', ')}`)
  }

  // End condition
  if (rule.count) {
    parts.push(`for ${rule.count} times`)
  } else if (rule.until) {
    parts.push(`until ${rule.until.toISOString().split('T')[0]}`)
  }

  return parts.join(' ')
}

/**
 * Get ordinal suffix for a number
 */
function getOrdinalSuffix(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 11 && abs <= 13) return 'th'

  switch (abs % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create common recurrence rules
 */
export const RecurrencePresets = {
  daily: (interval = 1): RecurrenceRule => ({
    freq: 'DAILY',
    interval,
  }),

  weekdays: (): RecurrenceRule => ({
    freq: 'WEEKLY',
    byDay: [{ day: 'MO' }, { day: 'TU' }, { day: 'WE' }, { day: 'TH' }, { day: 'FR' }],
  }),

  weekly: (days: DayName[], interval = 1): RecurrenceRule => ({
    freq: 'WEEKLY',
    interval,
    byDay: days.map((day) => ({ day })),
  }),

  monthly: (dayOfMonth: number, interval = 1): RecurrenceRule => ({
    freq: 'MONTHLY',
    interval,
    byMonthDay: [dayOfMonth],
  }),

  monthlyByDay: (day: DayName, n: number, interval = 1): RecurrenceRule => ({
    freq: 'MONTHLY',
    interval,
    byDay: [{ day, n }],
  }),

  yearly: (month: number, dayOfMonth: number): RecurrenceRule => ({
    freq: 'YEARLY',
    byMonth: [month],
    byMonthDay: [dayOfMonth],
  }),
}
