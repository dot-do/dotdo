/**
 * CalendarEngine - Scheduling, availability, and calendar sync
 *
 * A comprehensive calendar and scheduling primitive providing:
 *
 * 1. TimeZoneHandler - Timezone-aware date/time operations with DST support
 * 2. RecurrenceRule - RFC 5545 RRULE parsing and expansion
 * 3. AvailabilityStore - Availability windows and time slots
 * 4. BookingEngine - Booking with conflict detection
 * 5. CalendarSync - Bi-directional sync (Google, Outlook, iCal, CalDAV)
 *
 * @module db/primitives/calendar-engine
 */

// Types
export type {
  // Core types
  DateString,
  DateTimeString,
  TimeZone,
  DayOfWeek,
  DayName,
  TimeString,

  // Recurrence types
  RecurrenceFrequency,
  WeekStart,
  WeekDayNum,
  RecurrenceRule,
  RecurrenceException,

  // Event types
  EventStatus,
  EventTransparency,
  AttendeeStatus,
  AttendeeRole,
  EventAttendee,
  EventReminder,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,

  // Availability types
  TimeSlot,
  AvailabilityRule,
  AvailabilityOverride,
  BufferConfig,
  AvailabilitySchedule,
  AvailableSlot,

  // Booking types
  BookingStatus,
  BookingParticipant,
  Booking,
  CreateBookingInput,
  UpdateBookingInput,

  // Calendar types
  CalendarRole,
  CalendarPermission,
  Calendar,

  // Sync types
  SyncProvider,
  SyncDirection,
  SyncStatus,
  CalendarSyncConfig,
  SyncResult,
  SyncConflict,

  // Conflict types
  EventConflict,
  ConflictCheckResult,

  // Query types
  EventQueryOptions,
  AvailabilityQueryOptions,
} from './types'

// TimeZoneHandler
export {
  TimeZoneHandler,
  createTimeZoneHandler,
  type TimeZoneInfo,
  type DSTTransition,
  type TimeZoneHandlerConfig,
  // Helper functions
  parseTimeString,
  formatTimeString,
  parseDateString,
  formatDateString,
  resolveTimezone,
  getTimezoneOffset,
  getTimezoneAbbreviation,
  isDST,
} from './timezone'

// RecurrenceRule
export {
  parseRRule,
  serializeRRule,
  expandRRule,
  matchesRRule,
  getNextOccurrence,
  getPreviousOccurrence,
  countOccurrences,
  describeRRule,
  RecurrencePresets,
  type ExpandOptions,
} from './recurrence'

// AvailabilityStore
export {
  AvailabilityStore,
  createAvailabilityStore,
  type AvailabilityStoreConfig,
  type AvailabilityWindow,
  type BusyPeriod,
} from './availability'

// BookingEngine
export {
  BookingEngine,
  createBookingEngine,
  type BookingEngineConfig,
  type BookingResult,
  type RescheduleResult,
  type CancellationResult,
  type AssignmentStrategy,
} from './booking'

// CalendarSync
export {
  CalendarSyncEngine,
  createCalendarSyncEngine,
  createSyncAdapter,
  ICalSyncAdapter,
  GoogleCalendarSyncAdapter,
  OutlookCalendarSyncAdapter,
  CalDAVSyncAdapter,
  parseICalendar,
  generateICalendar,
  type CalendarSyncEngineConfig,
  type SyncAdapter,
  type SyncAdapterConfig,
  type RemoteEvent,
  type PushResult,
} from './sync'
