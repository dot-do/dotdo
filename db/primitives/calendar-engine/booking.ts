/**
 * BookingEngine - Booking management with conflict detection
 *
 * Handles:
 * - Booking creation, modification, and cancellation
 * - Conflict detection
 * - Round-robin and load-balanced assignment
 * - Rescheduling with original booking tracking
 *
 * @module db/primitives/calendar-engine/booking
 */

import type {
  Booking,
  CreateBookingInput,
  UpdateBookingInput,
  BookingStatus,
  CalendarEvent,
  EventConflict,
  ConflictCheckResult,
  TimeZone,
  EventStatus,
  EventTransparency,
  CreateEventInput,
} from './types'
import { TimeZoneHandler } from './timezone'
import { AvailabilityStore, type BusyPeriod } from './availability'
import { expandRRule } from './recurrence'

// ============================================================================
// TYPES
// ============================================================================

export interface BookingEngineConfig {
  /** Default timezone */
  timezone?: TimeZone
  /** Availability store for checking availability */
  availabilityStore?: AvailabilityStore
  /** Allow overbooking (for soft conflicts) */
  allowOverbooking?: boolean
  /** Create calendar event for booking */
  createEventOnBooking?: boolean
}

export interface BookingResult {
  /** Whether booking was successful */
  success: boolean
  /** Created/updated booking */
  booking?: Booking
  /** Associated event (if created) */
  event?: CalendarEvent
  /** Conflict information (if booking failed) */
  conflicts?: EventConflict[]
  /** Error message */
  error?: string
}

export interface RescheduleResult {
  /** Whether reschedule was successful */
  success: boolean
  /** New booking */
  newBooking?: Booking
  /** Original booking (now marked as rescheduled) */
  originalBooking?: Booking
  /** Error message */
  error?: string
}

export interface CancellationResult {
  /** Whether cancellation was successful */
  success: boolean
  /** Cancelled booking */
  booking?: Booking
  /** Error message */
  error?: string
}

export interface AssignmentStrategy {
  /** Strategy type */
  type: 'round-robin' | 'load-balanced' | 'random' | 'least-busy'
  /** Assignee pool (user/calendar IDs) */
  assignees: string[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MS_PER_MINUTE = 60 * 1000

// ============================================================================
// HELPERS
// ============================================================================

function generateId(prefix: string = 'booking'): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 16; i++) {
    id += hex[Math.floor(Math.random() * 16)]
  }
  return `${prefix}_${id}`
}

function rangesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && end1 > start2
}

// ============================================================================
// BOOKING ENGINE CLASS
// ============================================================================

export class BookingEngine {
  private bookings: Map<string, Booking> = new Map()
  private events: Map<string, CalendarEvent> = new Map()
  private readonly tzHandler: TimeZoneHandler
  private readonly availabilityStore?: AvailabilityStore
  private readonly allowOverbooking: boolean
  private readonly createEventOnBooking: boolean
  private roundRobinIndex: Map<string, number> = new Map()

  constructor(config: BookingEngineConfig = {}) {
    this.tzHandler = new TimeZoneHandler({ defaultTimezone: config.timezone || 'UTC' })
    this.availabilityStore = config.availabilityStore
    this.allowOverbooking = config.allowOverbooking || false
    this.createEventOnBooking = config.createEventOnBooking ?? true
  }

  // ============================================================================
  // CONFLICT DETECTION
  // ============================================================================

  /**
   * Check for conflicts with existing events
   */
  checkConflicts(
    calendarId: string,
    start: Date,
    end: Date,
    excludeEventId?: string
  ): ConflictCheckResult {
    const conflicts: EventConflict[] = []

    for (const event of this.events.values()) {
      if (event.calendarId !== calendarId) continue
      if (event.id === excludeEventId) continue
      if (event.status === 'cancelled') continue
      if (event.transparency === 'transparent') continue

      // Get all instances for recurring events
      const instances = this.getEventInstances(event, start, end)

      for (const instance of instances) {
        if (rangesOverlap(start, end, instance.start, instance.end)) {
          const overlapStart = start > instance.start ? start : instance.start
          const overlapEnd = end < instance.end ? end : instance.end
          const overlapMinutes = (overlapEnd.getTime() - overlapStart.getTime()) / MS_PER_MINUTE

          conflicts.push({
            event: instance,
            overlapStart,
            overlapEnd,
            overlapMinutes,
          })
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    }
  }

  /**
   * Get all instances of an event in a date range
   */
  private getEventInstances(
    event: CalendarEvent,
    rangeStart: Date,
    rangeEnd: Date
  ): CalendarEvent[] {
    if (!event.rrule) {
      // Non-recurring event
      if (rangesOverlap(event.start, event.end, rangeStart, rangeEnd)) {
        return [event]
      }
      return []
    }

    // Expand recurring event
    const duration = event.end.getTime() - event.start.getTime()
    const occurrences = expandRRule(event.rrule, {
      dtstart: event.start,
      timezone: event.timezone,
      after: new Date(rangeStart.getTime() - duration),
      before: rangeEnd,
    })

    // Filter out exception dates
    const exdateSet = new Set(
      (event.exdates || []).map((d) => d.getTime())
    )

    return occurrences
      .filter((date) => !exdateSet.has(date.getTime()))
      .map((date) => ({
        ...event,
        id: `${event.id}_${date.getTime()}`,
        recurringEventId: event.id,
        originalStartTime: date,
        start: date,
        end: new Date(date.getTime() + duration),
      }))
  }

  /**
   * Check if a slot is available
   */
  isSlotAvailable(
    calendarId: string,
    start: Date,
    end: Date,
    scheduleId?: string
  ): boolean {
    // Check for conflicts with existing events
    const { hasConflicts } = this.checkConflicts(calendarId, start, end)
    if (hasConflicts && !this.allowOverbooking) {
      return false
    }

    // Check availability schedule if provided
    if (scheduleId && this.availabilityStore) {
      const busyPeriods = this.getBusyPeriods(calendarId, start, end)
      return this.availabilityStore.isAvailable(scheduleId, start, end, busyPeriods)
    }

    return true
  }

  /**
   * Get busy periods from events
   */
  getBusyPeriods(calendarId: string, start: Date, end: Date): BusyPeriod[] {
    const periods: BusyPeriod[] = []

    for (const event of this.events.values()) {
      if (event.calendarId !== calendarId) continue
      if (event.status === 'cancelled') continue
      if (event.transparency === 'transparent') continue

      const instances = this.getEventInstances(event, start, end)
      for (const instance of instances) {
        periods.push({
          start: instance.start,
          end: instance.end,
          eventId: instance.id,
        })
      }
    }

    return periods
  }

  // ============================================================================
  // BOOKING OPERATIONS
  // ============================================================================

  /**
   * Create a booking
   */
  createBooking(input: CreateBookingInput): BookingResult {
    // Check for conflicts
    const { hasConflicts, conflicts } = this.checkConflicts(
      input.calendarId,
      input.start,
      input.end
    )

    if (hasConflicts && !this.allowOverbooking) {
      return {
        success: false,
        conflicts,
        error: 'Time slot is not available',
      }
    }

    // Create booking
    const now = new Date()
    const booking: Booking = {
      id: generateId('booking'),
      status: input.status || 'confirmed',
      createdAt: now,
      updatedAt: now,
      ...input,
    }

    this.bookings.set(booking.id, booking)

    // Create associated event
    let event: CalendarEvent | undefined
    if (this.createEventOnBooking) {
      event = this.createEventForBooking(booking)
      booking.eventId = event.id
    }

    return {
      success: true,
      booking,
      event,
    }
  }

  /**
   * Create a calendar event for a booking
   */
  private createEventForBooking(booking: Booking): CalendarEvent {
    const now = new Date()
    const event: CalendarEvent = {
      id: generateId('event'),
      calendarId: booking.calendarId,
      title: booking.title,
      description: booking.description,
      location: booking.location,
      start: booking.start,
      end: booking.end,
      timezone: booking.timezone,
      status: booking.status === 'confirmed' ? 'confirmed' : 'tentative',
      transparency: 'opaque',
      attendees: [
        {
          email: booking.host.email,
          name: booking.host.name,
          status: 'accepted',
          role: 'chair',
        },
        {
          email: booking.guest.email,
          name: booking.guest.name,
          status: 'accepted',
          role: 'required',
        },
        ...(booking.additionalAttendees || []).map((a) => ({
          email: a.email,
          name: a.name,
          status: 'needs-action' as const,
          role: 'optional' as const,
        })),
      ],
      organizer: booking.host.email,
      createdAt: now,
      updatedAt: now,
    }

    this.events.set(event.id, event)
    return event
  }

  /**
   * Get a booking by ID
   */
  getBooking(id: string): Booking | undefined {
    return this.bookings.get(id)
  }

  /**
   * Update a booking
   */
  updateBooking(id: string, updates: UpdateBookingInput): BookingResult {
    const booking = this.bookings.get(id)
    if (!booking) {
      return {
        success: false,
        error: 'Booking not found',
      }
    }

    // If time is changing, check for conflicts
    const newStart = updates.start || booking.start
    const newEnd = updates.end || booking.end

    if (updates.start || updates.end) {
      const { hasConflicts, conflicts } = this.checkConflicts(
        booking.calendarId,
        newStart,
        newEnd,
        booking.eventId
      )

      if (hasConflicts && !this.allowOverbooking) {
        return {
          success: false,
          conflicts,
          error: 'New time slot is not available',
        }
      }
    }

    // Update booking
    const updatedBooking: Booking = {
      ...booking,
      ...updates,
      updatedAt: new Date(),
    }

    this.bookings.set(id, updatedBooking)

    // Update associated event
    if (booking.eventId && this.events.has(booking.eventId)) {
      const event = this.events.get(booking.eventId)!
      const updatedEvent: CalendarEvent = {
        ...event,
        title: updatedBooking.title,
        description: updatedBooking.description,
        location: updatedBooking.location,
        start: updatedBooking.start,
        end: updatedBooking.end,
        status: updatedBooking.status === 'confirmed' ? 'confirmed' : 'tentative',
        updatedAt: new Date(),
      }
      this.events.set(event.id, updatedEvent)
    }

    return {
      success: true,
      booking: updatedBooking,
    }
  }

  /**
   * Cancel a booking
   */
  cancelBooking(id: string, reason?: string): CancellationResult {
    const booking = this.bookings.get(id)
    if (!booking) {
      return {
        success: false,
        error: 'Booking not found',
      }
    }

    if (booking.status === 'cancelled') {
      return {
        success: false,
        error: 'Booking is already cancelled',
      }
    }

    // Update booking status
    const updatedBooking: Booking = {
      ...booking,
      status: 'cancelled',
      cancellationReason: reason,
      updatedAt: new Date(),
    }

    this.bookings.set(id, updatedBooking)

    // Cancel associated event
    if (booking.eventId && this.events.has(booking.eventId)) {
      const event = this.events.get(booking.eventId)!
      const updatedEvent: CalendarEvent = {
        ...event,
        status: 'cancelled',
        updatedAt: new Date(),
      }
      this.events.set(event.id, updatedEvent)
    }

    return {
      success: true,
      booking: updatedBooking,
    }
  }

  /**
   * Reschedule a booking
   */
  rescheduleBooking(
    id: string,
    newStart: Date,
    newEnd: Date,
    reason?: string
  ): RescheduleResult {
    const originalBooking = this.bookings.get(id)
    if (!originalBooking) {
      return {
        success: false,
        error: 'Booking not found',
      }
    }

    if (originalBooking.status === 'cancelled') {
      return {
        success: false,
        error: 'Cannot reschedule cancelled booking',
      }
    }

    // Check for conflicts at new time
    const { hasConflicts, conflicts } = this.checkConflicts(
      originalBooking.calendarId,
      newStart,
      newEnd,
      originalBooking.eventId
    )

    if (hasConflicts && !this.allowOverbooking) {
      return {
        success: false,
        error: 'New time slot is not available',
      }
    }

    // Create new booking
    const newBookingResult = this.createBooking({
      ...originalBooking,
      start: newStart,
      end: newEnd,
      rescheduledFrom: id,
    })

    if (!newBookingResult.success) {
      return {
        success: false,
        error: newBookingResult.error,
      }
    }

    // Update original booking
    const updatedOriginal: Booking = {
      ...originalBooking,
      status: 'rescheduled',
      rescheduledTo: newBookingResult.booking!.id,
      updatedAt: new Date(),
    }

    this.bookings.set(id, updatedOriginal)

    // Cancel original event
    if (originalBooking.eventId && this.events.has(originalBooking.eventId)) {
      const event = this.events.get(originalBooking.eventId)!
      const updatedEvent: CalendarEvent = {
        ...event,
        status: 'cancelled',
        updatedAt: new Date(),
      }
      this.events.set(event.id, updatedEvent)
    }

    return {
      success: true,
      newBooking: newBookingResult.booking,
      originalBooking: updatedOriginal,
    }
  }

  /**
   * List bookings
   */
  listBookings(options: {
    calendarId?: string
    status?: BookingStatus[]
    start?: Date
    end?: Date
    hostEmail?: string
    guestEmail?: string
    limit?: number
    offset?: number
  } = {}): Booking[] {
    let bookings = Array.from(this.bookings.values())

    // Apply filters
    if (options.calendarId) {
      bookings = bookings.filter((b) => b.calendarId === options.calendarId)
    }

    if (options.status?.length) {
      bookings = bookings.filter((b) => options.status!.includes(b.status))
    }

    if (options.start) {
      bookings = bookings.filter((b) => b.end > options.start!)
    }

    if (options.end) {
      bookings = bookings.filter((b) => b.start < options.end!)
    }

    if (options.hostEmail) {
      bookings = bookings.filter((b) => b.host.email === options.hostEmail)
    }

    if (options.guestEmail) {
      bookings = bookings.filter((b) => b.guest.email === options.guestEmail)
    }

    // Sort by start time
    bookings.sort((a, b) => a.start.getTime() - b.start.getTime())

    // Apply pagination
    const offset = options.offset || 0
    const limit = options.limit || 100

    return bookings.slice(offset, offset + limit)
  }

  // ============================================================================
  // ASSIGNMENT STRATEGIES
  // ============================================================================

  /**
   * Select assignee using strategy
   */
  selectAssignee(
    strategy: AssignmentStrategy,
    start: Date,
    end: Date
  ): string | null {
    if (strategy.assignees.length === 0) return null

    switch (strategy.type) {
      case 'round-robin':
        return this.roundRobinAssign(strategy.assignees)

      case 'random':
        return this.randomAssign(strategy.assignees)

      case 'load-balanced':
        return this.loadBalancedAssign(strategy.assignees, start, end)

      case 'least-busy':
        return this.leastBusyAssign(strategy.assignees, start, end)

      default:
        return strategy.assignees[0]
    }
  }

  private roundRobinAssign(assignees: string[]): string {
    const key = assignees.join(',')
    let index = this.roundRobinIndex.get(key) || 0
    const selected = assignees[index % assignees.length]
    this.roundRobinIndex.set(key, index + 1)
    return selected
  }

  private randomAssign(assignees: string[]): string {
    const index = Math.floor(Math.random() * assignees.length)
    return assignees[index]
  }

  private loadBalancedAssign(
    assignees: string[],
    start: Date,
    end: Date
  ): string {
    // Count bookings per assignee in time range
    const counts = new Map<string, number>()

    for (const assignee of assignees) {
      counts.set(assignee, 0)
    }

    for (const booking of this.bookings.values()) {
      if (booking.status === 'cancelled') continue
      if (!rangesOverlap(booking.start, booking.end, start, end)) continue

      const assignee = booking.host.email
      if (counts.has(assignee)) {
        counts.set(assignee, (counts.get(assignee) || 0) + 1)
      }
    }

    // Select assignee with fewest bookings
    let minCount = Infinity
    let selected = assignees[0]

    for (const [assignee, count] of counts) {
      if (count < minCount) {
        minCount = count
        selected = assignee
      }
    }

    return selected
  }

  private leastBusyAssign(
    assignees: string[],
    start: Date,
    end: Date
  ): string {
    // Calculate busy time per assignee
    const busyMinutes = new Map<string, number>()

    for (const assignee of assignees) {
      busyMinutes.set(assignee, 0)
    }

    for (const event of this.events.values()) {
      if (event.status === 'cancelled') continue
      if (event.transparency === 'transparent') continue

      const organizer = event.organizer
      if (!organizer || !busyMinutes.has(organizer)) continue

      const instances = this.getEventInstances(event, start, end)
      for (const instance of instances) {
        const duration = (instance.end.getTime() - instance.start.getTime()) / MS_PER_MINUTE
        busyMinutes.set(organizer, (busyMinutes.get(organizer) || 0) + duration)
      }
    }

    // Select least busy assignee
    let minBusy = Infinity
    let selected = assignees[0]

    for (const [assignee, minutes] of busyMinutes) {
      if (minutes < minBusy) {
        minBusy = minutes
        selected = assignee
      }
    }

    return selected
  }

  // ============================================================================
  // EVENT MANAGEMENT
  // ============================================================================

  /**
   * Create an event directly (without booking)
   */
  createEvent(input: CreateEventInput): CalendarEvent {
    const now = new Date()
    const event: CalendarEvent = {
      id: generateId('event'),
      createdAt: now,
      updatedAt: now,
      ...input,
    }

    this.events.set(event.id, event)
    return event
  }

  /**
   * Get an event by ID
   */
  getEvent(id: string): CalendarEvent | undefined {
    return this.events.get(id)
  }

  /**
   * Update an event
   */
  updateEvent(
    id: string,
    updates: Partial<Omit<CalendarEvent, 'id' | 'calendarId' | 'createdAt'>>
  ): CalendarEvent | undefined {
    const event = this.events.get(id)
    if (!event) return undefined

    const updated: CalendarEvent = {
      ...event,
      ...updates,
      updatedAt: new Date(),
    }

    this.events.set(id, updated)
    return updated
  }

  /**
   * Delete an event
   */
  deleteEvent(id: string): boolean {
    return this.events.delete(id)
  }

  /**
   * List events
   */
  listEvents(options: {
    calendarId?: string
    start?: Date
    end?: Date
    status?: EventStatus[]
    expandRecurring?: boolean
  } = {}): CalendarEvent[] {
    let events = Array.from(this.events.values())

    if (options.calendarId) {
      events = events.filter((e) => e.calendarId === options.calendarId)
    }

    if (options.status?.length) {
      events = events.filter((e) => options.status!.includes(e.status))
    }

    const start = options.start || new Date(0)
    const end = options.end || new Date(8640000000000000)

    if (options.expandRecurring) {
      const expanded: CalendarEvent[] = []
      for (const event of events) {
        expanded.push(...this.getEventInstances(event, start, end))
      }
      events = expanded
    } else {
      events = events.filter((e) =>
        rangesOverlap(e.start, e.end, start, end)
      )
    }

    return events.sort((a, b) => a.start.getTime() - b.start.getTime())
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createBookingEngine(
  config: BookingEngineConfig = {}
): BookingEngine {
  return new BookingEngine(config)
}
