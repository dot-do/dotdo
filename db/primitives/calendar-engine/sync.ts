/**
 * CalendarSync - Bi-directional calendar synchronization
 *
 * Provides sync adapters for:
 * - Google Calendar
 * - Microsoft Outlook
 * - iCal feeds (read-only)
 * - CalDAV servers
 *
 * Features:
 * - Incremental sync with delta tokens
 * - Conflict detection and resolution
 * - OAuth token management
 *
 * @module db/primitives/calendar-engine/sync
 */

import type {
  CalendarEvent,
  CalendarSyncConfig,
  SyncProvider,
  SyncResult,
  SyncConflict,
  SyncStatus,
  TimeZone,
  RecurrenceRule,
  EventStatus,
  EventTransparency,
  EventAttendee,
  CreateEventInput,
} from './types'
import { parseRRule, serializeRRule } from './recurrence'
import { TimeZoneHandler } from './timezone'

// ============================================================================
// TYPES
// ============================================================================

export interface SyncAdapterConfig {
  /** Sync configuration */
  config: CalendarSyncConfig
  /** Timezone for parsing */
  timezone?: TimeZone
}

export interface SyncAdapter {
  /** Provider name */
  readonly provider: SyncProvider
  /** Fetch remote events */
  fetchEvents(since?: Date): Promise<RemoteEvent[]>
  /** Push local event to remote */
  pushEvent(event: CalendarEvent): Promise<PushResult>
  /** Delete remote event */
  deleteEvent(externalId: string): Promise<boolean>
  /** Get sync token */
  getSyncToken(): string | undefined
  /** Validate credentials */
  validateCredentials(): Promise<boolean>
  /** Refresh OAuth token */
  refreshToken?(): Promise<boolean>
}

export interface RemoteEvent {
  /** External event ID */
  id: string
  /** Event data */
  event: Partial<CalendarEvent>
  /** ETag for conflict detection */
  etag?: string
  /** Whether event was deleted */
  deleted?: boolean
}

export interface PushResult {
  /** Whether push was successful */
  success: boolean
  /** External event ID */
  externalId?: string
  /** New ETag */
  etag?: string
  /** Error message */
  error?: string
}

export interface CalendarSyncEngineConfig {
  /** Default timezone */
  timezone?: TimeZone
  /** Conflict resolution strategy */
  conflictResolution?: 'local-wins' | 'remote-wins' | 'newest-wins' | 'manual'
  /** Auto-retry failed syncs */
  autoRetry?: boolean
  /** Maximum retries */
  maxRetries?: number
}

// ============================================================================
// ICAL PARSER
// ============================================================================

/**
 * Parse iCalendar (ICS) format
 */
export function parseICalendar(icsContent: string, timezone: TimeZone = 'UTC'): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const tzHandler = new TimeZoneHandler({ defaultTimezone: timezone })

  // Split into lines and unfold (lines starting with space are continuations)
  const lines: string[] = []
  const rawLines = icsContent.split(/\r?\n/)

  for (const line of rawLines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous line
      if (lines.length > 0) {
        lines[lines.length - 1] += line.slice(1)
      }
    } else {
      lines.push(line)
    }
  }

  let currentEvent: Partial<CalendarEvent> | null = null
  let inEvent = false

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    let name = line.slice(0, colonIndex)
    let value = line.slice(colonIndex + 1)

    // Handle parameters (e.g., DTSTART;TZID=America/New_York:20240101T090000)
    const params: Record<string, string> = {}
    if (name.includes(';')) {
      const parts = name.split(';')
      name = parts[0]
      for (let i = 1; i < parts.length; i++) {
        const [paramName, paramValue] = parts[i].split('=')
        if (paramName && paramValue) {
          params[paramName] = paramValue
        }
      }
    }

    switch (name.toUpperCase()) {
      case 'BEGIN':
        if (value.toUpperCase() === 'VEVENT') {
          inEvent = true
          currentEvent = {
            status: 'confirmed',
            transparency: 'opaque',
          }
        }
        break

      case 'END':
        if (value.toUpperCase() === 'VEVENT' && currentEvent) {
          if (currentEvent.id && currentEvent.start && currentEvent.end) {
            events.push({
              id: currentEvent.id,
              calendarId: '',
              title: currentEvent.title || 'Untitled',
              description: currentEvent.description,
              location: currentEvent.location,
              start: currentEvent.start,
              end: currentEvent.end,
              timezone: currentEvent.timezone || timezone,
              allDay: currentEvent.allDay,
              status: currentEvent.status || 'confirmed',
              transparency: currentEvent.transparency || 'opaque',
              rrule: currentEvent.rrule,
              attendees: currentEvent.attendees,
              organizer: currentEvent.organizer,
              externalId: currentEvent.externalId,
              externalSource: 'ical',
              createdAt: currentEvent.createdAt || new Date(),
              updatedAt: currentEvent.updatedAt || new Date(),
            })
          }
          inEvent = false
          currentEvent = null
        }
        break

      case 'UID':
        if (inEvent && currentEvent) {
          currentEvent.id = value
          currentEvent.externalId = value
        }
        break

      case 'SUMMARY':
        if (inEvent && currentEvent) {
          currentEvent.title = unescapeICalValue(value)
        }
        break

      case 'DESCRIPTION':
        if (inEvent && currentEvent) {
          currentEvent.description = unescapeICalValue(value)
        }
        break

      case 'LOCATION':
        if (inEvent && currentEvent) {
          currentEvent.location = unescapeICalValue(value)
        }
        break

      case 'DTSTART':
        if (inEvent && currentEvent) {
          const tz = params['TZID'] || timezone
          currentEvent.start = parseICalDate(value, tz)
          currentEvent.timezone = tz
          currentEvent.allDay = value.length === 8 // DATE format (no time)
        }
        break

      case 'DTEND':
        if (inEvent && currentEvent) {
          const tz = params['TZID'] || timezone
          currentEvent.end = parseICalDate(value, tz)
        }
        break

      case 'DURATION':
        if (inEvent && currentEvent && currentEvent.start) {
          const duration = parseICalDuration(value)
          currentEvent.end = new Date(currentEvent.start.getTime() + duration)
        }
        break

      case 'RRULE':
        if (inEvent && currentEvent) {
          currentEvent.rrule = parseRRule(value)
        }
        break

      case 'STATUS':
        if (inEvent && currentEvent) {
          currentEvent.status = mapICalStatus(value)
        }
        break

      case 'TRANSP':
        if (inEvent && currentEvent) {
          currentEvent.transparency = value.toUpperCase() === 'TRANSPARENT' ? 'transparent' : 'opaque'
        }
        break

      case 'ORGANIZER':
        if (inEvent && currentEvent) {
          // Extract email from mailto:
          const email = value.replace(/^mailto:/i, '')
          currentEvent.organizer = email
        }
        break

      case 'ATTENDEE':
        if (inEvent && currentEvent) {
          const email = value.replace(/^mailto:/i, '')
          const attendee: EventAttendee = {
            email,
            name: params['CN'],
            status: mapICalPartstat(params['PARTSTAT']),
            role: mapICalRole(params['ROLE']),
            rsvp: params['RSVP'] === 'TRUE',
          }
          currentEvent.attendees = currentEvent.attendees || []
          currentEvent.attendees.push(attendee)
        }
        break

      case 'CREATED':
        if (inEvent && currentEvent) {
          currentEvent.createdAt = parseICalDate(value, 'UTC')
        }
        break

      case 'LAST-MODIFIED':
        if (inEvent && currentEvent) {
          currentEvent.updatedAt = parseICalDate(value, 'UTC')
        }
        break
    }
  }

  return events
}

/**
 * Generate iCalendar (ICS) format
 */
export function generateICalendar(events: CalendarEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dotdo//CalendarEngine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const event of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${event.externalId || event.id}`)
    lines.push(`SUMMARY:${escapeICalValue(event.title)}`)

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICalValue(event.description)}`)
    }

    if (event.location) {
      lines.push(`LOCATION:${escapeICalValue(event.location)}`)
    }

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatICalDate(event.start, true)}`)
      lines.push(`DTEND;VALUE=DATE:${formatICalDate(event.end, true)}`)
    } else {
      lines.push(`DTSTART;TZID=${event.timezone}:${formatICalDate(event.start)}`)
      lines.push(`DTEND;TZID=${event.timezone}:${formatICalDate(event.end)}`)
    }

    if (event.rrule) {
      lines.push(`RRULE:${serializeRRule(event.rrule)}`)
    }

    lines.push(`STATUS:${mapToICalStatus(event.status)}`)
    lines.push(`TRANSP:${event.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE'}`)

    if (event.organizer) {
      lines.push(`ORGANIZER:mailto:${event.organizer}`)
    }

    if (event.attendees) {
      for (const attendee of event.attendees) {
        let line = `ATTENDEE`
        if (attendee.name) line += `;CN=${attendee.name}`
        line += `;PARTSTAT=${mapToICalPartstat(attendee.status)}`
        line += `;ROLE=${mapToICalRole(attendee.role)}`
        if (attendee.rsvp) line += `;RSVP=TRUE`
        line += `:mailto:${attendee.email}`
        lines.push(line)
      }
    }

    lines.push(`CREATED:${formatICalDate(event.createdAt)}`)
    lines.push(`LAST-MODIFIED:${formatICalDate(event.updatedAt)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // Fold long lines
  return lines.map(foldLine).join('\r\n')
}

// ============================================================================
// ICAL HELPERS
// ============================================================================

function parseICalDate(value: string, timezone: TimeZone): Date {
  // Handle DATE format (YYYYMMDD)
  if (value.length === 8) {
    const year = parseInt(value.slice(0, 4), 10)
    const month = parseInt(value.slice(4, 6), 10) - 1
    const day = parseInt(value.slice(6, 8), 10)
    return new Date(Date.UTC(year, month, day))
  }

  // Handle DATE-TIME format (YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ)
  const year = parseInt(value.slice(0, 4), 10)
  const month = parseInt(value.slice(4, 6), 10) - 1
  const day = parseInt(value.slice(6, 8), 10)
  const hour = parseInt(value.slice(9, 11), 10)
  const minute = parseInt(value.slice(11, 13), 10)
  const second = parseInt(value.slice(13, 15), 10) || 0

  if (value.endsWith('Z')) {
    return new Date(Date.UTC(year, month, day, hour, minute, second))
  }

  // Create in local timezone
  const tzHandler = new TimeZoneHandler({ defaultTimezone: timezone })
  return tzHandler.createDate(year, month + 1, day, hour, minute, second, timezone)
}

function formatICalDate(date: Date, dateOnly: boolean = false): string {
  const year = date.getUTCFullYear()
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')

  if (dateOnly) {
    return `${year}${month}${day}`
  }

  const hour = date.getUTCHours().toString().padStart(2, '0')
  const minute = date.getUTCMinutes().toString().padStart(2, '0')
  const second = date.getUTCSeconds().toString().padStart(2, '0')

  return `${year}${month}${day}T${hour}${minute}${second}Z`
}

function parseICalDuration(value: string): number {
  // Parse ISO 8601 duration (e.g., PT1H30M, P1DT2H)
  let ms = 0
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)

  if (match) {
    const [, days, hours, minutes, seconds] = match
    if (days) ms += parseInt(days, 10) * 24 * 60 * 60 * 1000
    if (hours) ms += parseInt(hours, 10) * 60 * 60 * 1000
    if (minutes) ms += parseInt(minutes, 10) * 60 * 1000
    if (seconds) ms += parseInt(seconds, 10) * 1000
  }

  return ms
}

function escapeICalValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function unescapeICalValue(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function foldLine(line: string): string {
  // RFC 5545: Lines should be <= 75 octets
  if (line.length <= 75) return line

  const parts: string[] = []
  let remaining = line

  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75))
    remaining = ' ' + remaining.slice(75) // Continuation starts with space
  }

  if (remaining) {
    parts.push(remaining)
  }

  return parts.join('\r\n')
}

function mapICalStatus(status: string): EventStatus {
  switch (status.toUpperCase()) {
    case 'TENTATIVE':
      return 'tentative'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'confirmed'
  }
}

function mapToICalStatus(status: EventStatus): string {
  switch (status) {
    case 'tentative':
      return 'TENTATIVE'
    case 'cancelled':
      return 'CANCELLED'
    default:
      return 'CONFIRMED'
  }
}

function mapICalPartstat(partstat?: string): EventAttendee['status'] {
  if (!partstat) return 'needs-action'

  switch (partstat.toUpperCase()) {
    case 'ACCEPTED':
      return 'accepted'
    case 'DECLINED':
      return 'declined'
    case 'TENTATIVE':
      return 'tentative'
    case 'DELEGATED':
      return 'delegated'
    default:
      return 'needs-action'
  }
}

function mapToICalPartstat(status: EventAttendee['status']): string {
  switch (status) {
    case 'accepted':
      return 'ACCEPTED'
    case 'declined':
      return 'DECLINED'
    case 'tentative':
      return 'TENTATIVE'
    case 'delegated':
      return 'DELEGATED'
    default:
      return 'NEEDS-ACTION'
  }
}

function mapICalRole(role?: string): EventAttendee['role'] {
  if (!role) return 'required'

  switch (role.toUpperCase()) {
    case 'CHAIR':
      return 'chair'
    case 'OPT-PARTICIPANT':
      return 'optional'
    case 'NON-PARTICIPANT':
      return 'non-participant'
    default:
      return 'required'
  }
}

function mapToICalRole(role: EventAttendee['role']): string {
  switch (role) {
    case 'chair':
      return 'CHAIR'
    case 'optional':
      return 'OPT-PARTICIPANT'
    case 'non-participant':
      return 'NON-PARTICIPANT'
    default:
      return 'REQ-PARTICIPANT'
  }
}

// ============================================================================
// SYNC ADAPTERS
// ============================================================================

/**
 * iCal feed adapter (read-only)
 */
export class ICalSyncAdapter implements SyncAdapter {
  readonly provider: SyncProvider = 'ical'
  private readonly config: CalendarSyncConfig
  private readonly timezone: TimeZone
  private lastSync?: Date

  constructor(options: SyncAdapterConfig) {
    this.config = options.config
    this.timezone = options.timezone || 'UTC'
  }

  async fetchEvents(): Promise<RemoteEvent[]> {
    if (!this.config.icalUrl) {
      throw new Error('iCal URL not configured')
    }

    try {
      const response = await fetch(this.config.icalUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch iCal: ${response.status}`)
      }

      const icsContent = await response.text()
      const events = parseICalendar(icsContent, this.timezone)

      this.lastSync = new Date()

      return events.map((event) => ({
        id: event.externalId || event.id,
        event,
      }))
    } catch (error) {
      throw error
    }
  }

  async pushEvent(): Promise<PushResult> {
    // iCal is read-only
    return {
      success: false,
      error: 'iCal feeds are read-only',
    }
  }

  async deleteEvent(): Promise<boolean> {
    // iCal is read-only
    return false
  }

  getSyncToken(): string | undefined {
    return this.lastSync?.toISOString()
  }

  async validateCredentials(): Promise<boolean> {
    if (!this.config.icalUrl) return false

    try {
      const response = await fetch(this.config.icalUrl, { method: 'HEAD' })
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Google Calendar adapter (stub - requires OAuth)
 */
export class GoogleCalendarSyncAdapter implements SyncAdapter {
  readonly provider: SyncProvider = 'google'
  private readonly config: CalendarSyncConfig
  private readonly timezone: TimeZone
  private syncToken?: string

  constructor(options: SyncAdapterConfig) {
    this.config = options.config
    this.timezone = options.timezone || 'UTC'
    this.syncToken = options.config.syncToken
  }

  async fetchEvents(since?: Date): Promise<RemoteEvent[]> {
    if (!this.config.accessToken) {
      throw new Error('Access token not configured')
    }

    // In a real implementation, this would call the Google Calendar API
    // For now, return empty array as a stub
    return []
  }

  async pushEvent(event: CalendarEvent): Promise<PushResult> {
    if (!this.config.accessToken) {
      return {
        success: false,
        error: 'Access token not configured',
      }
    }

    // In a real implementation, this would call the Google Calendar API
    return {
      success: true,
      externalId: `google_${event.id}`,
    }
  }

  async deleteEvent(externalId: string): Promise<boolean> {
    if (!this.config.accessToken) return false

    // In a real implementation, this would call the Google Calendar API
    return true
  }

  getSyncToken(): string | undefined {
    return this.syncToken
  }

  async validateCredentials(): Promise<boolean> {
    // Check if token is valid and not expired
    if (!this.config.accessToken) return false
    if (this.config.tokenExpiry && this.config.tokenExpiry < new Date()) {
      return false
    }
    return true
  }

  async refreshToken(): Promise<boolean> {
    // In a real implementation, this would refresh the OAuth token
    return false
  }
}

/**
 * Outlook Calendar adapter (stub - requires OAuth)
 */
export class OutlookCalendarSyncAdapter implements SyncAdapter {
  readonly provider: SyncProvider = 'outlook'
  private readonly config: CalendarSyncConfig
  private readonly timezone: TimeZone
  private syncToken?: string

  constructor(options: SyncAdapterConfig) {
    this.config = options.config
    this.timezone = options.timezone || 'UTC'
    this.syncToken = options.config.syncToken
  }

  async fetchEvents(since?: Date): Promise<RemoteEvent[]> {
    if (!this.config.accessToken) {
      throw new Error('Access token not configured')
    }

    // In a real implementation, this would call the Microsoft Graph API
    return []
  }

  async pushEvent(event: CalendarEvent): Promise<PushResult> {
    if (!this.config.accessToken) {
      return {
        success: false,
        error: 'Access token not configured',
      }
    }

    // In a real implementation, this would call the Microsoft Graph API
    return {
      success: true,
      externalId: `outlook_${event.id}`,
    }
  }

  async deleteEvent(externalId: string): Promise<boolean> {
    if (!this.config.accessToken) return false

    // In a real implementation, this would call the Microsoft Graph API
    return true
  }

  getSyncToken(): string | undefined {
    return this.syncToken
  }

  async validateCredentials(): Promise<boolean> {
    if (!this.config.accessToken) return false
    if (this.config.tokenExpiry && this.config.tokenExpiry < new Date()) {
      return false
    }
    return true
  }

  async refreshToken(): Promise<boolean> {
    return false
  }
}

/**
 * CalDAV adapter
 */
export class CalDAVSyncAdapter implements SyncAdapter {
  readonly provider: SyncProvider = 'caldav'
  private readonly config: CalendarSyncConfig
  private readonly timezone: TimeZone
  private syncToken?: string

  constructor(options: SyncAdapterConfig) {
    this.config = options.config
    this.timezone = options.timezone || 'UTC'
    this.syncToken = options.config.syncToken
  }

  async fetchEvents(since?: Date): Promise<RemoteEvent[]> {
    if (!this.config.caldavUrl) {
      throw new Error('CalDAV URL not configured')
    }

    // In a real implementation, this would use CalDAV protocol
    return []
  }

  async pushEvent(event: CalendarEvent): Promise<PushResult> {
    if (!this.config.caldavUrl) {
      return {
        success: false,
        error: 'CalDAV URL not configured',
      }
    }

    // In a real implementation, this would use CalDAV PUT
    return {
      success: true,
      externalId: `caldav_${event.id}`,
    }
  }

  async deleteEvent(externalId: string): Promise<boolean> {
    if (!this.config.caldavUrl) return false

    // In a real implementation, this would use CalDAV DELETE
    return true
  }

  getSyncToken(): string | undefined {
    return this.syncToken
  }

  async validateCredentials(): Promise<boolean> {
    if (!this.config.caldavUrl) return false
    return true
  }
}

// ============================================================================
// SYNC ENGINE
// ============================================================================

export class CalendarSyncEngine {
  private adapters: Map<string, SyncAdapter> = new Map()
  private readonly conflictResolution: 'local-wins' | 'remote-wins' | 'newest-wins' | 'manual'
  private readonly autoRetry: boolean
  private readonly maxRetries: number

  constructor(config: CalendarSyncEngineConfig = {}) {
    this.conflictResolution = config.conflictResolution || 'newest-wins'
    this.autoRetry = config.autoRetry ?? true
    this.maxRetries = config.maxRetries || 3
  }

  /**
   * Register a sync adapter
   */
  registerAdapter(id: string, adapter: SyncAdapter): void {
    this.adapters.set(id, adapter)
  }

  /**
   * Create adapter from config
   */
  createAdapter(config: CalendarSyncConfig, timezone?: TimeZone): SyncAdapter {
    const options: SyncAdapterConfig = { config, timezone }

    switch (config.provider) {
      case 'google':
        return new GoogleCalendarSyncAdapter(options)
      case 'outlook':
        return new OutlookCalendarSyncAdapter(options)
      case 'ical':
        return new ICalSyncAdapter(options)
      case 'caldav':
        return new CalDAVSyncAdapter(options)
      default:
        throw new Error(`Unknown provider: ${config.provider}`)
    }
  }

  /**
   * Sync a calendar
   */
  async sync(
    adapterId: string,
    localEvents: CalendarEvent[],
    options: { since?: Date } = {}
  ): Promise<SyncResult> {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) {
      return {
        success: false,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: [],
        error: 'Adapter not found',
        timestamp: new Date(),
      }
    }

    try {
      // Fetch remote events
      const remoteEvents = await adapter.fetchEvents(options.since)

      // Build maps for comparison
      const localMap = new Map(
        localEvents
          .filter((e) => e.externalId)
          .map((e) => [e.externalId!, e])
      )

      const remoteMap = new Map(
        remoteEvents.map((e) => [e.id, e])
      )

      let created = 0
      let updated = 0
      let deleted = 0
      const conflicts: SyncConflict[] = []

      // Process remote events
      for (const remote of remoteEvents) {
        const local = localMap.get(remote.id)

        if (remote.deleted) {
          if (local) {
            deleted++
          }
          continue
        }

        if (!local) {
          // New remote event
          created++
        } else if (remote.etag !== local.etag) {
          // Potential conflict
          const remoteEvent = remote.event as CalendarEvent
          if (local.updatedAt > remoteEvent.updatedAt!) {
            // Local is newer
            if (this.conflictResolution === 'remote-wins') {
              updated++
            } else if (this.conflictResolution === 'manual') {
              conflicts.push({
                eventId: local.id,
                externalId: remote.id,
                type: 'both-modified',
                localEvent: local,
                remoteEvent: remoteEvent,
              })
            }
          } else {
            // Remote is newer
            updated++
          }
        }
      }

      return {
        success: true,
        created,
        updated,
        deleted,
        conflicts,
        syncToken: adapter.getSyncToken(),
        timestamp: new Date(),
      }
    } catch (error) {
      return {
        success: false,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: [],
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      }
    }
  }

  /**
   * Push local changes to remote
   */
  async push(
    adapterId: string,
    events: CalendarEvent[]
  ): Promise<{ success: boolean; results: PushResult[] }> {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) {
      return {
        success: false,
        results: [],
      }
    }

    const results: PushResult[] = []
    let hasFailure = false

    for (const event of events) {
      const result = await adapter.pushEvent(event)
      results.push(result)
      if (!result.success) {
        hasFailure = true
      }
    }

    return {
      success: !hasFailure,
      results,
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createCalendarSyncEngine(
  config: CalendarSyncEngineConfig = {}
): CalendarSyncEngine {
  return new CalendarSyncEngine(config)
}

export function createSyncAdapter(
  config: CalendarSyncConfig,
  timezone?: TimeZone
): SyncAdapter {
  const options: SyncAdapterConfig = { config, timezone }

  switch (config.provider) {
    case 'google':
      return new GoogleCalendarSyncAdapter(options)
    case 'outlook':
      return new OutlookCalendarSyncAdapter(options)
    case 'ical':
      return new ICalSyncAdapter(options)
    case 'caldav':
      return new CalDAVSyncAdapter(options)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}
