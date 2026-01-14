/**
 * AvailabilityStore - Availability window management
 *
 * Manages availability schedules including:
 * - Working hours per day of week
 * - Date-specific overrides
 * - Buffer times between bookings
 * - Minimum notice and max days ahead
 * - Available slot calculation
 *
 * @module db/primitives/calendar-engine/availability
 */

import type {
  TimeZone,
  DayOfWeek,
  TimeSlot,
  AvailabilityRule,
  AvailabilityOverride,
  AvailabilitySchedule,
  AvailableSlot,
  BufferConfig,
  AvailabilityQueryOptions,
  CalendarEvent,
  DateString,
  TimeString,
} from './types'
import { TimeZoneHandler, parseTimeString, formatTimeString, formatDateString } from './timezone'

// ============================================================================
// TYPES
// ============================================================================

export interface AvailabilityStoreConfig {
  /** Default timezone */
  timezone?: TimeZone
  /** Default slot duration in minutes */
  defaultSlotDuration?: number
  /** Default buffer between bookings */
  defaultBuffer?: BufferConfig
}

export interface AvailabilityWindow {
  /** Window start */
  start: Date
  /** Window end */
  end: Date
  /** Duration in minutes */
  duration: number
}

export interface BusyPeriod {
  /** Period start */
  start: Date
  /** Period end */
  end: Date
  /** Optional event reference */
  eventId?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MINUTES_PER_DAY = 24 * 60
const MS_PER_MINUTE = 60 * 1000
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 16; i++) {
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

/**
 * Check if two time ranges overlap
 */
function rangesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && end1 > start2
}

/**
 * Merge overlapping time slots
 */
function mergeSlots(slots: TimeSlot[]): TimeSlot[] {
  if (slots.length <= 1) return slots

  // Sort by start time
  const sorted = [...slots].sort((a, b) => {
    return parseTimeString(a.start) - parseTimeString(b.start)
  })

  const merged: TimeSlot[] = []
  let current = { ...sorted[0] }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const currentEnd = parseTimeString(current.end)
    const nextStart = parseTimeString(next.start)

    if (nextStart <= currentEnd) {
      // Overlapping or adjacent - merge
      const nextEnd = parseTimeString(next.end)
      if (nextEnd > currentEnd) {
        current.end = next.end
      }
    } else {
      // Gap - push current and start new
      merged.push(current)
      current = { ...next }
    }
  }

  merged.push(current)
  return merged
}

/**
 * Subtract busy periods from available windows
 */
function subtractBusyPeriods(
  windows: AvailabilityWindow[],
  busyPeriods: BusyPeriod[],
  buffer: BufferConfig = {}
): AvailabilityWindow[] {
  const { before = 0, after = 0 } = buffer
  const bufferBefore = before * MS_PER_MINUTE
  const bufferAfter = after * MS_PER_MINUTE

  let result = [...windows]

  for (const busy of busyPeriods) {
    // Expand busy period with buffer
    const busyStart = new Date(busy.start.getTime() - bufferBefore)
    const busyEnd = new Date(busy.end.getTime() + bufferAfter)

    const newResult: AvailabilityWindow[] = []

    for (const window of result) {
      if (!rangesOverlap(window.start, window.end, busyStart, busyEnd)) {
        // No overlap - keep entire window
        newResult.push(window)
      } else if (busyStart <= window.start && busyEnd >= window.end) {
        // Busy period completely covers window - remove it
        continue
      } else if (busyStart > window.start && busyEnd < window.end) {
        // Busy period splits window into two
        newResult.push({
          start: window.start,
          end: busyStart,
          duration: (busyStart.getTime() - window.start.getTime()) / MS_PER_MINUTE,
        })
        newResult.push({
          start: busyEnd,
          end: window.end,
          duration: (window.end.getTime() - busyEnd.getTime()) / MS_PER_MINUTE,
        })
      } else if (busyStart <= window.start) {
        // Busy period overlaps start of window
        if (busyEnd < window.end) {
          newResult.push({
            start: busyEnd,
            end: window.end,
            duration: (window.end.getTime() - busyEnd.getTime()) / MS_PER_MINUTE,
          })
        }
      } else {
        // Busy period overlaps end of window
        if (busyStart > window.start) {
          newResult.push({
            start: window.start,
            end: busyStart,
            duration: (busyStart.getTime() - window.start.getTime()) / MS_PER_MINUTE,
          })
        }
      }
    }

    result = newResult
  }

  return result
}

// ============================================================================
// AVAILABILITY STORE CLASS
// ============================================================================

export class AvailabilityStore {
  private schedules: Map<string, AvailabilitySchedule> = new Map()
  private readonly tzHandler: TimeZoneHandler
  private readonly defaultSlotDuration: number
  private readonly defaultBuffer: BufferConfig

  constructor(config: AvailabilityStoreConfig = {}) {
    this.tzHandler = new TimeZoneHandler({ defaultTimezone: config.timezone || 'UTC' })
    this.defaultSlotDuration = config.defaultSlotDuration || 30
    this.defaultBuffer = config.defaultBuffer || {}
  }

  // ============================================================================
  // SCHEDULE MANAGEMENT
  // ============================================================================

  /**
   * Create a new availability schedule
   */
  createSchedule(input: Omit<AvailabilitySchedule, 'id' | 'createdAt' | 'updatedAt'>): AvailabilitySchedule {
    const now = new Date()
    const schedule: AvailabilitySchedule = {
      id: `sched_${generateId()}`,
      createdAt: now,
      updatedAt: now,
      ...input,
    }

    this.schedules.set(schedule.id, schedule)
    return schedule
  }

  /**
   * Get a schedule by ID
   */
  getSchedule(id: string): AvailabilitySchedule | undefined {
    return this.schedules.get(id)
  }

  /**
   * Update a schedule
   */
  updateSchedule(id: string, updates: Partial<Omit<AvailabilitySchedule, 'id' | 'createdAt'>>): AvailabilitySchedule | undefined {
    const schedule = this.schedules.get(id)
    if (!schedule) return undefined

    const updated: AvailabilitySchedule = {
      ...schedule,
      ...updates,
      updatedAt: new Date(),
    }

    this.schedules.set(id, updated)
    return updated
  }

  /**
   * Delete a schedule
   */
  deleteSchedule(id: string): boolean {
    return this.schedules.delete(id)
  }

  /**
   * List all schedules
   */
  listSchedules(): AvailabilitySchedule[] {
    return Array.from(this.schedules.values())
  }

  // ============================================================================
  // AVAILABILITY RULES
  // ============================================================================

  /**
   * Add an availability rule to a schedule
   */
  addRule(scheduleId: string, rule: Omit<AvailabilityRule, 'id'>): AvailabilityRule | undefined {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return undefined

    const newRule: AvailabilityRule = {
      id: `rule_${generateId()}`,
      ...rule,
    }

    schedule.rules.push(newRule)
    schedule.updatedAt = new Date()

    return newRule
  }

  /**
   * Update an availability rule
   */
  updateRule(scheduleId: string, ruleId: string, updates: Partial<Omit<AvailabilityRule, 'id'>>): AvailabilityRule | undefined {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return undefined

    const ruleIndex = schedule.rules.findIndex((r) => r.id === ruleId)
    if (ruleIndex === -1) return undefined

    schedule.rules[ruleIndex] = {
      ...schedule.rules[ruleIndex],
      ...updates,
    }
    schedule.updatedAt = new Date()

    return schedule.rules[ruleIndex]
  }

  /**
   * Remove an availability rule
   */
  removeRule(scheduleId: string, ruleId: string): boolean {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return false

    const initialLength = schedule.rules.length
    schedule.rules = schedule.rules.filter((r) => r.id !== ruleId)

    if (schedule.rules.length < initialLength) {
      schedule.updatedAt = new Date()
      return true
    }

    return false
  }

  // ============================================================================
  // OVERRIDES
  // ============================================================================

  /**
   * Add a date-specific override
   */
  addOverride(scheduleId: string, override: AvailabilityOverride): boolean {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return false

    schedule.overrides = schedule.overrides || []

    // Remove existing override for same date
    schedule.overrides = schedule.overrides.filter((o) => o.date !== override.date)
    schedule.overrides.push(override)
    schedule.updatedAt = new Date()

    return true
  }

  /**
   * Remove a date-specific override
   */
  removeOverride(scheduleId: string, date: DateString): boolean {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule || !schedule.overrides) return false

    const initialLength = schedule.overrides.length
    schedule.overrides = schedule.overrides.filter((o) => o.date !== date)

    if (schedule.overrides.length < initialLength) {
      schedule.updatedAt = new Date()
      return true
    }

    return false
  }

  /**
   * Get override for a specific date
   */
  getOverride(scheduleId: string, date: DateString): AvailabilityOverride | undefined {
    const schedule = this.schedules.get(scheduleId)
    return schedule?.overrides?.find((o) => o.date === date)
  }

  // ============================================================================
  // AVAILABILITY CALCULATION
  // ============================================================================

  /**
   * Get applicable rules for a specific date
   */
  getRulesForDate(schedule: AvailabilitySchedule, date: Date): AvailabilityRule[] {
    const dayOfWeek = this.tzHandler.getDayOfWeek(date, schedule.timezone)
    const dateStr = formatDateString(date)

    return schedule.rules.filter((rule) => {
      // Check day of week
      if (!rule.days.includes(dayOfWeek)) return false

      // Check effective date range
      if (rule.effectiveFrom && dateStr < rule.effectiveFrom) return false
      if (rule.effectiveUntil && dateStr > rule.effectiveUntil) return false

      return true
    })
  }

  /**
   * Get merged time slots for a specific date
   */
  getSlotsForDate(schedule: AvailabilitySchedule, date: Date): TimeSlot[] {
    const dateStr = formatDateString(date)

    // Check for override first
    const override = schedule.overrides?.find((o) => o.date === dateStr)
    if (override) {
      return override.slots
    }

    // Get applicable rules
    const rules = this.getRulesForDate(schedule, date)
    if (rules.length === 0) return []

    // Sort by priority (higher = takes precedence)
    const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0))

    // If highest priority rule exists, use its slots
    // For overlapping rules with same priority, merge slots
    const topPriority = sortedRules[0].priority || 0
    const topRules = sortedRules.filter((r) => (r.priority || 0) === topPriority)

    const allSlots = topRules.flatMap((r) => r.slots)
    return mergeSlots(allSlots)
  }

  /**
   * Get availability windows for a date range
   */
  getAvailabilityWindows(
    schedule: AvailabilitySchedule,
    start: Date,
    end: Date
  ): AvailabilityWindow[] {
    const windows: AvailabilityWindow[] = []
    const current = this.tzHandler.startOfDay(start, schedule.timezone)
    const endDate = this.tzHandler.endOfDay(end, schedule.timezone)

    while (current <= endDate) {
      const slots = this.getSlotsForDate(schedule, current)

      for (const slot of slots) {
        const windowStart = this.tzHandler.createFromStrings(
          formatDateString(current),
          slot.start,
          schedule.timezone
        )
        const windowEnd = this.tzHandler.createFromStrings(
          formatDateString(current),
          slot.end,
          schedule.timezone
        )

        // Only include windows that overlap with the query range
        if (windowEnd > start && windowStart < end) {
          const effectiveStart = windowStart < start ? start : windowStart
          const effectiveEnd = windowEnd > end ? end : windowEnd

          windows.push({
            start: effectiveStart,
            end: effectiveEnd,
            duration: (effectiveEnd.getTime() - effectiveStart.getTime()) / MS_PER_MINUTE,
          })
        }
      }

      // Move to next day
      current.setTime(current.getTime() + MS_PER_DAY)
    }

    return windows
  }

  /**
   * Get available slots for booking
   */
  getAvailableSlots(
    options: AvailabilityQueryOptions,
    busyPeriods: BusyPeriod[] = []
  ): AvailableSlot[] {
    const schedule = this.schedules.get(options.scheduleId)
    if (!schedule) return []

    const { start, end, duration, timezone } = options
    const slotDuration = duration || schedule.slotDuration || this.defaultSlotDuration
    const slotIncrement = schedule.slotIncrement || slotDuration
    const buffer = schedule.buffer || this.defaultBuffer
    const tz = timezone || schedule.timezone

    // Apply minimum notice
    let effectiveStart = start
    if (schedule.minimumNotice) {
      const minNoticeTime = new Date(Date.now() + schedule.minimumNotice * MS_PER_MINUTE)
      if (minNoticeTime > effectiveStart) {
        effectiveStart = minNoticeTime
      }
    }

    // Apply max days ahead
    let effectiveEnd = end
    if (schedule.maxDaysAhead) {
      const maxDate = new Date(Date.now() + schedule.maxDaysAhead * MS_PER_DAY)
      if (maxDate < effectiveEnd) {
        effectiveEnd = maxDate
      }
    }

    // Get availability windows
    let windows = this.getAvailabilityWindows(schedule, effectiveStart, effectiveEnd)

    // Subtract busy periods
    windows = subtractBusyPeriods(windows, busyPeriods, buffer)

    // Generate slots from windows
    const slots: AvailableSlot[] = []

    for (const window of windows) {
      if (window.duration < slotDuration) continue

      let slotStart = window.start
      const incrementMs = slotIncrement * MS_PER_MINUTE
      const durationMs = slotDuration * MS_PER_MINUTE

      while (slotStart.getTime() + durationMs <= window.end.getTime()) {
        slots.push({
          start: new Date(slotStart),
          end: new Date(slotStart.getTime() + durationMs),
          duration: slotDuration,
        })

        slotStart = new Date(slotStart.getTime() + incrementMs)
      }
    }

    return slots
  }

  /**
   * Check if a time range is available
   */
  isAvailable(
    scheduleId: string,
    start: Date,
    end: Date,
    busyPeriods: BusyPeriod[] = []
  ): boolean {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return false

    // Check minimum notice
    if (schedule.minimumNotice) {
      const minNoticeTime = new Date(Date.now() + schedule.minimumNotice * MS_PER_MINUTE)
      if (start < minNoticeTime) return false
    }

    // Check max days ahead
    if (schedule.maxDaysAhead) {
      const maxDate = new Date(Date.now() + schedule.maxDaysAhead * MS_PER_DAY)
      if (start > maxDate) return false
    }

    // Get availability windows
    let windows = this.getAvailabilityWindows(schedule, start, end)

    // Subtract busy periods
    const buffer = schedule.buffer || this.defaultBuffer
    windows = subtractBusyPeriods(windows, busyPeriods, buffer)

    // Check if requested range is covered
    const requestedDuration = (end.getTime() - start.getTime()) / MS_PER_MINUTE

    for (const window of windows) {
      if (window.start <= start && window.end >= end) {
        return true
      }
    }

    return false
  }

  /**
   * Find next available slot
   */
  findNextAvailableSlot(
    scheduleId: string,
    after: Date,
    duration: number,
    busyPeriods: BusyPeriod[] = []
  ): AvailableSlot | null {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return null

    // Look ahead up to maxDaysAhead or 30 days
    const maxDays = schedule.maxDaysAhead || 30
    const end = new Date(after.getTime() + maxDays * MS_PER_DAY)

    const slots = this.getAvailableSlots(
      {
        scheduleId,
        start: after,
        end,
        duration,
      },
      busyPeriods
    )

    return slots.length > 0 ? slots[0] : null
  }

  // ============================================================================
  // PRESETS
  // ============================================================================

  /**
   * Create a schedule with standard business hours
   */
  createBusinessHoursSchedule(
    name: string,
    timezone: TimeZone,
    options: {
      startTime?: TimeString
      endTime?: TimeString
      includeSaturday?: boolean
    } = {}
  ): AvailabilitySchedule {
    const { startTime = '09:00', endTime = '17:00', includeSaturday = false } = options

    const days: DayOfWeek[] = [1, 2, 3, 4, 5] // Mon-Fri
    if (includeSaturday) {
      days.push(6)
    }

    return this.createSchedule({
      name,
      timezone,
      rules: [
        {
          id: `rule_${generateId()}`,
          days,
          slots: [{ start: startTime, end: endTime }],
        },
      ],
    })
  }

  /**
   * Create a 24/7 availability schedule
   */
  create24x7Schedule(name: string, timezone: TimeZone): AvailabilitySchedule {
    return this.createSchedule({
      name,
      timezone,
      rules: [
        {
          id: `rule_${generateId()}`,
          days: [0, 1, 2, 3, 4, 5, 6],
          slots: [{ start: '00:00', end: '23:59' }],
        },
      ],
    })
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAvailabilityStore(
  config: AvailabilityStoreConfig = {}
): AvailabilityStore {
  return new AvailabilityStore(config)
}
