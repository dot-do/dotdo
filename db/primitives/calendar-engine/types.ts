/**
 * CalendarEngine Types
 *
 * Core type definitions for the calendar and scheduling engine.
 * Follows RFC 5545 (iCalendar) conventions where applicable.
 *
 * @module db/primitives/calendar-engine/types
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/** ISO 8601 date string (YYYY-MM-DD) */
export type DateString = string

/** ISO 8601 datetime string with timezone */
export type DateTimeString = string

/** IANA timezone identifier (e.g., 'America/New_York') */
export type TimeZone = string

/** Day of week (0 = Sunday, 6 = Saturday) */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Named days for convenience */
export type DayName = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA'

/** Time in HH:MM format (24-hour) */
export type TimeString = string

// ============================================================================
// RECURRENCE TYPES (RFC 5545)
// ============================================================================

/** Recurrence frequency */
export type RecurrenceFrequency =
  | 'SECONDLY'
  | 'MINUTELY'
  | 'HOURLY'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'YEARLY'

/** Week start day */
export type WeekStart = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA'

/** Day with optional position (e.g., +2MO for second Monday) */
export interface WeekDayNum {
  day: DayName
  n?: number // -53 to +53 (excluding 0)
}

/**
 * Recurrence Rule (RFC 5545 RRULE)
 * @see https://tools.ietf.org/html/rfc5545#section-3.3.10
 */
export interface RecurrenceRule {
  /** Frequency of recurrence */
  freq: RecurrenceFrequency
  /** Interval between occurrences (default: 1) */
  interval?: number
  /** End date for recurrence */
  until?: Date
  /** Maximum number of occurrences */
  count?: number
  /** Seconds (0-59) */
  bySecond?: number[]
  /** Minutes (0-59) */
  byMinute?: number[]
  /** Hours (0-23) */
  byHour?: number[]
  /** Days of week with optional position */
  byDay?: WeekDayNum[]
  /** Days of month (-31 to +31, excluding 0) */
  byMonthDay?: number[]
  /** Days of year (-366 to +366, excluding 0) */
  byYearDay?: number[]
  /** Weeks of year (-53 to +53, excluding 0) */
  byWeekNo?: number[]
  /** Months (1-12) */
  byMonth?: number[]
  /** Set positions for filtering (-366 to +366, excluding 0) */
  bySetPos?: number[]
  /** Week start day (default: MO) */
  wkst?: WeekStart
}

/**
 * Exception dates for recurring events
 */
export interface RecurrenceException {
  /** Original occurrence date */
  originalDate: Date
  /** If true, this occurrence is deleted */
  isDeleted?: boolean
  /** Modified event data for this occurrence */
  modification?: Partial<CalendarEvent>
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/** Event status */
export type EventStatus = 'tentative' | 'confirmed' | 'cancelled'

/** Event transparency (busy/free) */
export type EventTransparency = 'opaque' | 'transparent'

/** Attendee participation status */
export type AttendeeStatus =
  | 'needs-action'
  | 'accepted'
  | 'declined'
  | 'tentative'
  | 'delegated'

/** Attendee role */
export type AttendeeRole =
  | 'chair'
  | 'required'
  | 'optional'
  | 'non-participant'

/**
 * Event attendee
 */
export interface EventAttendee {
  /** Attendee email */
  email: string
  /** Display name */
  name?: string
  /** Participation status */
  status: AttendeeStatus
  /** Role in the event */
  role: AttendeeRole
  /** RSVP required */
  rsvp?: boolean
  /** Response comment */
  comment?: string
}

/**
 * Event reminder/alarm
 */
export interface EventReminder {
  /** Unique reminder ID */
  id: string
  /** Minutes before event start (negative for after) */
  minutesBefore: number
  /** Reminder method */
  method: 'email' | 'popup' | 'sms' | 'webhook'
  /** Whether reminder was triggered */
  triggered?: boolean
}

/**
 * Calendar event
 */
export interface CalendarEvent {
  /** Unique event ID */
  id: string
  /** Calendar ID this event belongs to */
  calendarId: string
  /** Event title */
  title: string
  /** Event description */
  description?: string
  /** Location (physical or virtual) */
  location?: string
  /** Event start */
  start: Date
  /** Event end */
  end: Date
  /** Timezone for the event */
  timezone: TimeZone
  /** All-day event flag */
  allDay?: boolean
  /** Event status */
  status: EventStatus
  /** Busy/free transparency */
  transparency: EventTransparency
  /** Recurrence rule */
  rrule?: RecurrenceRule
  /** Exception dates */
  exdates?: Date[]
  /** Recurrence exceptions (modifications) */
  exceptions?: RecurrenceException[]
  /** For recurring event instances, the master event ID */
  recurringEventId?: string
  /** For recurring event instances, the original start time */
  originalStartTime?: Date
  /** Attendees */
  attendees?: EventAttendee[]
  /** Organizer email */
  organizer?: string
  /** Reminders */
  reminders?: EventReminder[]
  /** External calendar ID for synced events */
  externalId?: string
  /** External calendar source */
  externalSource?: 'google' | 'outlook' | 'ical' | 'caldav'
  /** Event color */
  color?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Created timestamp */
  createdAt: Date
  /** Updated timestamp */
  updatedAt: Date
  /** ETag for sync conflict detection */
  etag?: string
}

/** Event creation input */
export type CreateEventInput = Omit<
  CalendarEvent,
  'id' | 'createdAt' | 'updatedAt' | 'etag'
>

/** Event update input */
export type UpdateEventInput = Partial<
  Omit<CalendarEvent, 'id' | 'calendarId' | 'createdAt'>
>

// ============================================================================
// AVAILABILITY TYPES
// ============================================================================

/**
 * Time slot within a day
 */
export interface TimeSlot {
  /** Start time (HH:MM) */
  start: TimeString
  /** End time (HH:MM) */
  end: TimeString
}

/**
 * Availability rule for specific days
 */
export interface AvailabilityRule {
  /** Unique rule ID */
  id: string
  /** Days of week this rule applies to */
  days: DayOfWeek[]
  /** Available time slots */
  slots: TimeSlot[]
  /** Effective start date (inclusive) */
  effectiveFrom?: DateString
  /** Effective end date (inclusive) */
  effectiveUntil?: DateString
  /** Priority (higher = takes precedence) */
  priority?: number
}

/**
 * Date-specific availability override
 */
export interface AvailabilityOverride {
  /** Specific date */
  date: DateString
  /** Available slots (empty = unavailable all day) */
  slots: TimeSlot[]
  /** Reason for override */
  reason?: string
}

/**
 * Buffer time configuration
 */
export interface BufferConfig {
  /** Minutes before events */
  before?: number
  /** Minutes after events */
  after?: number
}

/**
 * Availability schedule configuration
 */
export interface AvailabilitySchedule {
  /** Unique schedule ID */
  id: string
  /** Schedule name */
  name: string
  /** Timezone for this schedule */
  timezone: TimeZone
  /** Default availability rules */
  rules: AvailabilityRule[]
  /** Date-specific overrides */
  overrides?: AvailabilityOverride[]
  /** Buffer time between bookings */
  buffer?: BufferConfig
  /** Minimum notice time in minutes */
  minimumNotice?: number
  /** Maximum days ahead that can be booked */
  maxDaysAhead?: number
  /** Slot duration in minutes */
  slotDuration?: number
  /** Slot increment in minutes (for staggered slots) */
  slotIncrement?: number
  /** Created timestamp */
  createdAt: Date
  /** Updated timestamp */
  updatedAt: Date
}

/**
 * Available time slot result
 */
export interface AvailableSlot {
  /** Slot start */
  start: Date
  /** Slot end */
  end: Date
  /** Duration in minutes */
  duration: number
  /** Whether this slot is at capacity */
  atCapacity?: boolean
  /** Remaining capacity if limited */
  remainingCapacity?: number
}

// ============================================================================
// BOOKING TYPES
// ============================================================================

/** Booking status */
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no-show'
  | 'rescheduled'

/**
 * Booking participant
 */
export interface BookingParticipant {
  /** Participant email */
  email: string
  /** Display name */
  name?: string
  /** Phone number */
  phone?: string
  /** Additional fields */
  fields?: Record<string, unknown>
}

/**
 * Booking record
 */
export interface Booking {
  /** Unique booking ID */
  id: string
  /** Calendar ID */
  calendarId: string
  /** Associated event ID */
  eventId?: string
  /** Booking title */
  title: string
  /** Booking description */
  description?: string
  /** Booking start */
  start: Date
  /** Booking end */
  end: Date
  /** Timezone */
  timezone: TimeZone
  /** Booking status */
  status: BookingStatus
  /** Host (calendar owner) */
  host: BookingParticipant
  /** Guest (booker) */
  guest: BookingParticipant
  /** Additional attendees */
  additionalAttendees?: BookingParticipant[]
  /** Meeting location */
  location?: string
  /** Video conferencing link */
  conferenceLink?: string
  /** Cancellation reason */
  cancellationReason?: string
  /** If rescheduled, original booking ID */
  rescheduledFrom?: string
  /** If rescheduled, new booking ID */
  rescheduledTo?: string
  /** Reminder sent flag */
  reminderSent?: boolean
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Created timestamp */
  createdAt: Date
  /** Updated timestamp */
  updatedAt: Date
}

/** Booking creation input */
export type CreateBookingInput = Omit<
  Booking,
  'id' | 'eventId' | 'status' | 'createdAt' | 'updatedAt'
> & {
  status?: BookingStatus
}

/** Booking update input */
export type UpdateBookingInput = Partial<
  Omit<Booking, 'id' | 'calendarId' | 'createdAt'>
>

// ============================================================================
// CALENDAR TYPES
// ============================================================================

/**
 * Calendar access role
 */
export type CalendarRole =
  | 'owner'
  | 'writer'
  | 'reader'
  | 'freeBusyReader'

/**
 * Calendar sharing permission
 */
export interface CalendarPermission {
  /** User or group ID */
  principalId: string
  /** Principal type */
  principalType: 'user' | 'group' | 'domain' | 'public'
  /** Access role */
  role: CalendarRole
}

/**
 * Calendar configuration
 */
export interface Calendar {
  /** Unique calendar ID */
  id: string
  /** Owner ID */
  ownerId: string
  /** Calendar name */
  name: string
  /** Description */
  description?: string
  /** Default timezone */
  timezone: TimeZone
  /** Calendar color */
  color?: string
  /** Is primary calendar */
  isPrimary?: boolean
  /** Visibility */
  visibility: 'public' | 'private'
  /** Sharing permissions */
  permissions?: CalendarPermission[]
  /** Associated availability schedule */
  availabilityScheduleId?: string
  /** External sync configuration */
  syncConfig?: CalendarSyncConfig
  /** Created timestamp */
  createdAt: Date
  /** Updated timestamp */
  updatedAt: Date
}

// ============================================================================
// SYNC TYPES
// ============================================================================

/** Sync provider */
export type SyncProvider = 'google' | 'outlook' | 'ical' | 'caldav'

/** Sync direction */
export type SyncDirection = 'inbound' | 'outbound' | 'bidirectional'

/** Sync status */
export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'error'
  | 'conflict'

/**
 * Calendar sync configuration
 */
export interface CalendarSyncConfig {
  /** Sync provider */
  provider: SyncProvider
  /** External calendar ID */
  externalCalendarId: string
  /** Sync direction */
  direction: SyncDirection
  /** OAuth access token */
  accessToken?: string
  /** OAuth refresh token */
  refreshToken?: string
  /** Token expiry */
  tokenExpiry?: Date
  /** iCal URL for read-only sync */
  icalUrl?: string
  /** CalDAV server URL */
  caldavUrl?: string
  /** Last sync token (for incremental sync) */
  syncToken?: string
  /** Last successful sync */
  lastSyncAt?: Date
  /** Sync status */
  status: SyncStatus
  /** Last error message */
  lastError?: string
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Whether sync was successful */
  success: boolean
  /** Number of events created */
  created: number
  /** Number of events updated */
  updated: number
  /** Number of events deleted */
  deleted: number
  /** Conflicts encountered */
  conflicts: SyncConflict[]
  /** Error message if failed */
  error?: string
  /** New sync token */
  syncToken?: string
  /** Timestamp */
  timestamp: Date
}

/**
 * Sync conflict
 */
export interface SyncConflict {
  /** Event ID */
  eventId: string
  /** External event ID */
  externalId: string
  /** Conflict type */
  type: 'update' | 'delete' | 'both-modified'
  /** Local event data */
  localEvent: CalendarEvent
  /** Remote event data */
  remoteEvent: CalendarEvent
  /** Resolution (if applied) */
  resolution?: 'local-wins' | 'remote-wins' | 'merged'
}

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Event conflict
 */
export interface EventConflict {
  /** Conflicting event */
  event: CalendarEvent
  /** Overlap start */
  overlapStart: Date
  /** Overlap end */
  overlapEnd: Date
  /** Overlap duration in minutes */
  overlapMinutes: number
}

/**
 * Conflict check result
 */
export interface ConflictCheckResult {
  /** Whether there are conflicts */
  hasConflicts: boolean
  /** List of conflicts */
  conflicts: EventConflict[]
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Event query options
 */
export interface EventQueryOptions {
  /** Start of time range */
  start?: Date
  /** End of time range */
  end?: Date
  /** Calendar IDs to include */
  calendarIds?: string[]
  /** Event status filter */
  status?: EventStatus[]
  /** Search query */
  query?: string
  /** Include recurring event instances */
  expandRecurring?: boolean
  /** Maximum results */
  limit?: number
  /** Pagination offset */
  offset?: number
  /** Order by field */
  orderBy?: 'start' | 'end' | 'createdAt' | 'updatedAt'
  /** Order direction */
  orderDirection?: 'asc' | 'desc'
}

/**
 * Availability query options
 */
export interface AvailabilityQueryOptions {
  /** Start of time range */
  start: Date
  /** End of time range */
  end: Date
  /** Schedule ID */
  scheduleId: string
  /** Calendar IDs to check for conflicts */
  calendarIds?: string[]
  /** Slot duration in minutes (overrides schedule default) */
  duration?: number
  /** Timezone for results */
  timezone?: TimeZone
}
