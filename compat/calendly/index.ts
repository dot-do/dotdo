/**
 * Calendly Compat Layer
 *
 * API-compatible implementation of the Calendly API v2 backed by CalendarEngine.
 * Provides drop-in replacement for Calendly SDK with local scheduling capabilities.
 *
 * @module compat/calendly
 */

import {
  BookingEngine,
  createBookingEngine,
  AvailabilityStore,
  createAvailabilityStore,
  TimeZoneHandler,
  createTimeZoneHandler,
  type BookingResult,
  type AvailableSlot,
  type DayOfWeek,
} from '../../db/primitives/calendar-engine'

import { createChannel, type Channel } from '../../primitives/channel'
import { InMemoryResource, type Entity } from '../../primitives/resource'

import type {
  User,
  CurrentUser,
  Organization,
  OrganizationMembership,
  EventType,
  CreateEventTypeInput,
  ScheduledEvent,
  ScheduledEventStatus,
  Invitee,
  QuestionAndAnswer,
  AvailabilitySchedule,
  AvailabilityRule,
  UserBusyTime,
  WebhookSubscription,
  CreateWebhookSubscriptionInput,
  WebhookEvent,
  WebhookPayload,
  Collection,
  Pagination,
  URI,
} from './types'

export * from './types'

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface CalendlyConfig {
  apiKey: string
  baseUrl?: string
  webhookSigningKey?: string
}

interface StoredUser extends Entity {
  name: string
  slug: string
  email: string
  timezone: string
  avatar_url?: string
  current_organization?: string
  scheduling_url: string
  created_at: Date
  updated_at: Date
}

interface StoredEventType extends Entity {
  name: string
  slug: string
  duration: number
  active: boolean
  kind: 'solo' | 'group'
  pooling_type?: 'round_robin' | 'collective'
  color: string
  description_plain?: string
  internal_note?: string
  owner_uri: string
  custom_questions: Array<{
    uuid: string
    name: string
    type: string
    position: number
    required: boolean
    answer_choices?: string[]
    enabled: boolean
  }>
  created_at: Date
  updated_at: Date
}

interface StoredScheduledEvent extends Entity {
  event_type_uri: string
  name: string
  status: ScheduledEventStatus
  start_time: Date
  end_time: Date
  location?: {
    type: string
    location?: string
    join_url?: string
  }
  invitees: string[]
  host_uri: string
  calendar_id: string
  created_at: Date
  updated_at: Date
  cancellation?: {
    canceled_by: string
    reason?: string
    canceler_type: 'host' | 'invitee'
  }
}

interface StoredInvitee extends Entity {
  email: string
  name: string
  first_name?: string
  last_name?: string
  status: 'active' | 'canceled'
  event_uri: string
  timezone: string
  questions_and_answers: QuestionAndAnswer[]
  tracking?: Record<string, string>
  created_at: Date
  updated_at: Date
  cancellation?: {
    canceled_by: string
    reason?: string
    canceler_type: 'host' | 'invitee'
  }
}

interface StoredWebhook extends Entity {
  callback_url: string
  events: WebhookEvent[]
  scope: 'user' | 'organization'
  user_uri?: string
  organization_uri?: string
  state: 'active' | 'disabled'
  signing_key?: string
  created_at: Date
  updated_at: Date
}

// ============================================================================
// HELPERS
// ============================================================================

function generateId(prefix: string = ''): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 22; i++) {
    id += hex[Math.floor(Math.random() * 16)]
  }
  return prefix ? `${prefix}_${id}` : id
}

function makeUri(type: string, id: string, baseUrl: string = 'https://api.calendly.com'): URI {
  return `${baseUrl}/${type}/${id}`
}

function extractIdFromUri(uri: URI): string {
  const parts = uri.split('/')
  return parts[parts.length - 1]
}

function dayNameToNumber(day: string): DayOfWeek {
  const map: Record<string, DayOfWeek> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }
  return map[day.toLowerCase()] ?? 0
}

// ============================================================================
// CALENDLY SDK CLASS
// ============================================================================

export class Calendly {
  private readonly config: CalendlyConfig
  private readonly baseUrl: string
  private readonly bookingEngine: BookingEngine
  private readonly availabilityStore: AvailabilityStore
  private readonly tzHandler: TimeZoneHandler
  private readonly webhookChannel: Channel<WebhookPayload>

  // Resource stores
  private readonly users: InMemoryResource<StoredUser>
  private readonly eventTypes: InMemoryResource<StoredEventType>
  private readonly scheduledEvents: InMemoryResource<StoredScheduledEvent>
  private readonly invitees: InMemoryResource<StoredInvitee>
  private readonly webhooks: InMemoryResource<StoredWebhook>

  // API namespaces
  readonly users_api: UsersResource
  readonly eventTypes_api: EventTypesResource
  readonly scheduledEvents_api: ScheduledEventsResource
  readonly invitees_api: InviteesResource
  readonly availability_api: AvailabilityResource
  readonly webhooks_api: WebhooksResource

  constructor(config: CalendlyConfig) {
    if (!config.apiKey) {
      throw new Error('Calendly API key is required')
    }

    this.config = config
    this.baseUrl = config.baseUrl || 'https://api.calendly.com'

    // Initialize calendar engine
    this.availabilityStore = createAvailabilityStore({ timezone: 'UTC' })
    this.bookingEngine = createBookingEngine({
      timezone: 'UTC',
      availabilityStore: this.availabilityStore,
      createEventOnBooking: true,
    })
    this.tzHandler = createTimeZoneHandler({ defaultTimezone: 'UTC' })
    this.webhookChannel = createChannel<WebhookPayload>('calendly_webhooks')

    // Initialize stores
    this.users = new InMemoryResource<StoredUser>()
    this.eventTypes = new InMemoryResource<StoredEventType>()
    this.scheduledEvents = new InMemoryResource<StoredScheduledEvent>()
    this.invitees = new InMemoryResource<StoredInvitee>()
    this.webhooks = new InMemoryResource<StoredWebhook>()

    // Initialize API namespaces
    this.users_api = new UsersResource(this)
    this.eventTypes_api = new EventTypesResource(this)
    this.scheduledEvents_api = new ScheduledEventsResource(this)
    this.invitees_api = new InviteesResource(this)
    this.availability_api = new AvailabilityResource(this)
    this.webhooks_api = new WebhooksResource(this)
  }

  // Internal accessors for resources
  get _users() { return this.users }
  get _eventTypes() { return this.eventTypes }
  get _scheduledEvents() { return this.scheduledEvents }
  get _invitees() { return this.invitees }
  get _webhooks() { return this.webhooks }
  get _bookingEngine() { return this.bookingEngine }
  get _availabilityStore() { return this.availabilityStore }
  get _webhookChannel() { return this.webhookChannel }
  get _baseUrl() { return this.baseUrl }
  get _tzHandler() { return this.tzHandler }

  // Emit webhook events
  async emitWebhook(event: WebhookEvent, payload: unknown, createdBy: URI): Promise<void> {
    const webhookPayload: WebhookPayload = {
      event,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      payload,
    }

    await this.webhookChannel.publish(event, webhookPayload)

    // Trigger registered webhooks
    for await (const webhook of this.webhooks.find({ state: 'active' })) {
      if (webhook.events.includes(event)) {
        // In real implementation, this would make HTTP call to callback_url
        // For testing, we just publish to channel
        await this.webhookChannel.publish(`callback:${webhook.id}`, webhookPayload)
      }
    }
  }
}

// ============================================================================
// USERS RESOURCE
// ============================================================================

class UsersResource {
  constructor(private calendly: Calendly) {}

  async me(): Promise<CurrentUser> {
    // Get or create default user
    let user = await this.calendly._users.findOne({})

    if (!user) {
      const now = new Date()
      user = await this.calendly._users.create({
        name: 'Default User',
        slug: 'default-user',
        email: 'user@example.com',
        timezone: 'America/New_York',
        scheduling_url: `${this.calendly._baseUrl}/default-user`,
        created_at: now,
        updated_at: now,
      })
    }

    return {
      resource: this.toApiUser(user),
    }
  }

  async get(uri: URI): Promise<User | null> {
    const id = extractIdFromUri(uri)
    const user = await this.calendly._users.get(id)
    return user ? this.toApiUser(user) : null
  }

  async create(input: { name: string; email: string; timezone?: string }): Promise<User> {
    const now = new Date()
    const slug = input.name.toLowerCase().replace(/\s+/g, '-')
    const user = await this.calendly._users.create({
      name: input.name,
      slug,
      email: input.email,
      timezone: input.timezone || 'America/New_York',
      scheduling_url: `${this.calendly._baseUrl}/${slug}`,
      created_at: now,
      updated_at: now,
    })

    return this.toApiUser(user)
  }

  private toApiUser(user: StoredUser): User {
    return {
      uri: makeUri('users', user.id, this.calendly._baseUrl),
      name: user.name,
      slug: user.slug,
      email: user.email,
      timezone: user.timezone,
      scheduling_url: user.scheduling_url,
      avatar_url: user.avatar_url,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
      current_organization: user.current_organization,
    }
  }
}

// ============================================================================
// EVENT TYPES RESOURCE
// ============================================================================

class EventTypesResource {
  constructor(private calendly: Calendly) {}

  async create(userUri: URI, input: CreateEventTypeInput): Promise<EventType> {
    const now = new Date()
    const slug = input.slug || input.name.toLowerCase().replace(/\s+/g, '-')

    const eventType = await this.calendly._eventTypes.create({
      name: input.name,
      slug,
      duration: input.duration,
      active: true,
      kind: input.kind || 'solo',
      pooling_type: input.pooling_type,
      color: input.color || '#006BFF',
      description_plain: input.description_plain,
      internal_note: input.internal_note,
      owner_uri: userUri,
      custom_questions: (input.custom_questions || []).map((q, i) => ({
        uuid: generateId('question'),
        name: q.name,
        type: q.type,
        position: i,
        required: q.required,
        answer_choices: q.answer_choices,
        enabled: true,
      })),
      created_at: now,
      updated_at: now,
    })

    return this.toApiEventType(eventType)
  }

  async get(uri: URI): Promise<EventType | null> {
    const id = extractIdFromUri(uri)
    const eventType = await this.calendly._eventTypes.get(id)
    return eventType ? this.toApiEventType(eventType) : null
  }

  async list(options: { user?: URI; active?: boolean; count?: number } = {}): Promise<Collection<EventType>> {
    const collection: EventType[] = []
    const query: Record<string, unknown> = {}

    if (options.user) {
      query.owner_uri = options.user
    }
    if (options.active !== undefined) {
      query.active = options.active
    }

    for await (const et of this.calendly._eventTypes.find(query as never)) {
      collection.push(this.toApiEventType(et))
      if (options.count && collection.length >= options.count) break
    }

    return {
      collection,
      pagination: { count: collection.length },
    }
  }

  async update(uri: URI, updates: Partial<CreateEventTypeInput>): Promise<EventType> {
    const id = extractIdFromUri(uri)
    const eventType = await this.calendly._eventTypes.update(id, {
      ...updates,
      updated_at: new Date(),
    } as Partial<StoredEventType>)

    return this.toApiEventType(eventType)
  }

  async delete(uri: URI): Promise<void> {
    const id = extractIdFromUri(uri)
    await this.calendly._eventTypes.update(id, { active: false, updated_at: new Date() })
  }

  private toApiEventType(et: StoredEventType): EventType {
    const userParts = et.owner_uri.split('/')
    const userId = userParts[userParts.length - 1]

    return {
      uri: makeUri('event_types', et.id, this.calendly._baseUrl),
      name: et.name,
      slug: et.slug,
      duration: et.duration,
      active: et.active,
      kind: et.kind,
      pooling_type: et.pooling_type,
      type: 'StandardEventType',
      color: et.color,
      description_plain: et.description_plain,
      internal_note: et.internal_note,
      scheduling_url: `${this.calendly._baseUrl}/${et.slug}`,
      profile: {
        type: 'User',
        name: '',
        owner: et.owner_uri,
      },
      secret: false,
      booking_method: 'instant',
      custom_questions: et.custom_questions,
      created_at: et.created_at.toISOString(),
      updated_at: et.updated_at.toISOString(),
    }
  }
}

// ============================================================================
// SCHEDULED EVENTS RESOURCE
// ============================================================================

class ScheduledEventsResource {
  constructor(private calendly: Calendly) {}

  async create(input: {
    event_type: URI
    start_time: string
    end_time: string
    invitee: { email: string; name: string; timezone?: string; questions_and_answers?: QuestionAndAnswer[] }
    location?: { type: string; location?: string }
  }): Promise<{ event: ScheduledEvent; invitee: Invitee }> {
    const eventTypeId = extractIdFromUri(input.event_type)
    const eventType = await this.calendly._eventTypes.get(eventTypeId)

    if (!eventType) {
      throw new Error('Event type not found')
    }

    const now = new Date()
    const calendarId = `cal_${generateId()}`

    // Create booking via engine
    const bookingResult = this.calendly._bookingEngine.createBooking({
      calendarId,
      title: eventType.name,
      start: new Date(input.start_time),
      end: new Date(input.end_time),
      timezone: input.invitee.timezone || 'America/New_York',
      host: { email: 'host@example.com', name: 'Host' },
      guest: { email: input.invitee.email, name: input.invitee.name },
    })

    if (!bookingResult.success) {
      throw new Error(bookingResult.error || 'Booking failed')
    }

    // Create scheduled event
    const scheduledEvent = await this.calendly._scheduledEvents.create({
      event_type_uri: input.event_type,
      name: eventType.name,
      status: 'active',
      start_time: new Date(input.start_time),
      end_time: new Date(input.end_time),
      location: input.location,
      invitees: [],
      host_uri: eventType.owner_uri,
      calendar_id: calendarId,
      created_at: now,
      updated_at: now,
    })

    // Create invitee
    const invitee = await this.calendly._invitees.create({
      email: input.invitee.email,
      name: input.invitee.name,
      first_name: input.invitee.name.split(' ')[0],
      last_name: input.invitee.name.split(' ').slice(1).join(' ') || undefined,
      status: 'active',
      event_uri: makeUri('scheduled_events', scheduledEvent.id, this.calendly._baseUrl),
      timezone: input.invitee.timezone || 'America/New_York',
      questions_and_answers: input.invitee.questions_and_answers || [],
      created_at: now,
      updated_at: now,
    })

    // Update event with invitee
    await this.calendly._scheduledEvents.update(scheduledEvent.id, {
      invitees: [invitee.id],
    })

    // Emit webhook
    const eventApi = this.toApiScheduledEvent(scheduledEvent, [invitee])
    const inviteeApi = this.toApiInvitee(invitee)
    await this.calendly.emitWebhook('invitee.created', inviteeApi, eventType.owner_uri)

    return {
      event: eventApi,
      invitee: inviteeApi,
    }
  }

  async get(uri: URI): Promise<ScheduledEvent | null> {
    const id = extractIdFromUri(uri)
    const event = await this.calendly._scheduledEvents.get(id)
    if (!event) return null

    const inviteesList: StoredInvitee[] = []
    for (const invId of event.invitees) {
      const inv = await this.calendly._invitees.get(invId)
      if (inv) inviteesList.push(inv)
    }

    return this.toApiScheduledEvent(event, inviteesList)
  }

  async list(options: {
    user?: URI
    organization?: URI
    status?: ScheduledEventStatus
    min_start_time?: string
    max_start_time?: string
    count?: number
  } = {}): Promise<Collection<ScheduledEvent>> {
    const collection: ScheduledEvent[] = []

    for await (const event of this.calendly._scheduledEvents.find({})) {
      // Apply filters
      if (options.user && event.host_uri !== options.user) continue
      if (options.status && event.status !== options.status) continue
      if (options.min_start_time && event.start_time < new Date(options.min_start_time)) continue
      if (options.max_start_time && event.start_time > new Date(options.max_start_time)) continue

      const inviteesList: StoredInvitee[] = []
      for (const invId of event.invitees) {
        const inv = await this.calendly._invitees.get(invId)
        if (inv) inviteesList.push(inv)
      }

      collection.push(this.toApiScheduledEvent(event, inviteesList))
      if (options.count && collection.length >= options.count) break
    }

    return {
      collection,
      pagination: { count: collection.length },
    }
  }

  async cancel(uri: URI, options: { reason?: string; canceler_type?: 'host' | 'invitee' } = {}): Promise<ScheduledEvent> {
    const id = extractIdFromUri(uri)
    const event = await this.calendly._scheduledEvents.get(id)

    if (!event) {
      throw new Error('Scheduled event not found')
    }

    if (event.status === 'canceled') {
      throw new Error('Event is already canceled')
    }

    // Cancel associated booking
    const bookings = this.calendly._bookingEngine.listBookings({ calendarId: event.calendar_id })
    for (const booking of bookings) {
      this.calendly._bookingEngine.cancelBooking(booking.id, options.reason)
    }

    // Update event
    const updatedEvent = await this.calendly._scheduledEvents.update(id, {
      status: 'canceled',
      cancellation: {
        canceled_by: options.canceler_type === 'invitee' ? 'invitee' : 'host',
        reason: options.reason,
        canceler_type: options.canceler_type || 'host',
      },
      updated_at: new Date(),
    })

    // Cancel invitees
    for (const invId of event.invitees) {
      await this.calendly._invitees.update(invId, {
        status: 'canceled',
        cancellation: {
          canceled_by: options.canceler_type === 'invitee' ? 'invitee' : 'host',
          reason: options.reason,
          canceler_type: options.canceler_type || 'host',
        },
        updated_at: new Date(),
      })

      const invitee = await this.calendly._invitees.get(invId)
      if (invitee) {
        await this.calendly.emitWebhook('invitee.canceled', this.toApiInvitee(invitee), event.host_uri)
      }
    }

    const inviteesList: StoredInvitee[] = []
    for (const invId of updatedEvent.invitees) {
      const inv = await this.calendly._invitees.get(invId)
      if (inv) inviteesList.push(inv)
    }

    return this.toApiScheduledEvent(updatedEvent, inviteesList)
  }

  private toApiScheduledEvent(event: StoredScheduledEvent, invitees: StoredInvitee[]): ScheduledEvent {
    return {
      uri: makeUri('scheduled_events', event.id, this.calendly._baseUrl),
      name: event.name,
      status: event.status,
      start_time: event.start_time.toISOString(),
      end_time: event.end_time.toISOString(),
      event_type: event.event_type_uri,
      location: event.location as ScheduledEvent['location'],
      invitees_counter: {
        total: invitees.length,
        active: invitees.filter(i => i.status === 'active').length,
        limit: 1,
      },
      event_memberships: [{
        user: event.host_uri,
        user_email: 'host@example.com',
      }],
      cancellation: event.cancellation,
      created_at: event.created_at.toISOString(),
      updated_at: event.updated_at.toISOString(),
    }
  }

  private toApiInvitee(inv: StoredInvitee): Invitee {
    return {
      uri: makeUri('invitees', inv.id, this.calendly._baseUrl),
      email: inv.email,
      name: inv.name,
      first_name: inv.first_name,
      last_name: inv.last_name,
      status: inv.status,
      timezone: inv.timezone,
      event: inv.event_uri,
      questions_and_answers: inv.questions_and_answers,
      cancel_url: `${this.calendly._baseUrl}/cancellations/${inv.id}`,
      reschedule_url: `${this.calendly._baseUrl}/reschedulings/${inv.id}`,
      rescheduled: false,
      cancellation: inv.cancellation,
      created_at: inv.created_at.toISOString(),
      updated_at: inv.updated_at.toISOString(),
    }
  }
}

// ============================================================================
// INVITEES RESOURCE
// ============================================================================

class InviteesResource {
  constructor(private calendly: Calendly) {}

  async get(uri: URI): Promise<Invitee | null> {
    const id = extractIdFromUri(uri)
    const invitee = await this.calendly._invitees.get(id)
    return invitee ? this.toApiInvitee(invitee) : null
  }

  async list(eventUri: URI, options: { status?: 'active' | 'canceled'; count?: number } = {}): Promise<Collection<Invitee>> {
    const collection: Invitee[] = []

    for await (const inv of this.calendly._invitees.find({ event_uri: eventUri })) {
      if (options.status && inv.status !== options.status) continue
      collection.push(this.toApiInvitee(inv))
      if (options.count && collection.length >= options.count) break
    }

    return {
      collection,
      pagination: { count: collection.length },
    }
  }

  async markNoShow(uri: URI): Promise<Invitee> {
    const id = extractIdFromUri(uri)
    const invitee = await this.calendly._invitees.get(id)

    if (!invitee) {
      throw new Error('Invitee not found')
    }

    // In real API, this creates a no_show record
    // For our compat layer, we track it as metadata
    const updated = await this.calendly._invitees.update(id, {
      updated_at: new Date(),
    })

    const event = await this.calendly._scheduledEvents.findOne({ invitees: { $contains: id } } as never)
    if (event) {
      await this.calendly.emitWebhook('invitee_no_show.created', this.toApiInvitee(updated), event.host_uri)
    }

    return this.toApiInvitee(updated)
  }

  private toApiInvitee(inv: StoredInvitee): Invitee {
    return {
      uri: makeUri('invitees', inv.id, this.calendly._baseUrl),
      email: inv.email,
      name: inv.name,
      first_name: inv.first_name,
      last_name: inv.last_name,
      status: inv.status,
      timezone: inv.timezone,
      event: inv.event_uri,
      questions_and_answers: inv.questions_and_answers,
      cancel_url: `${this.calendly._baseUrl}/cancellations/${inv.id}`,
      reschedule_url: `${this.calendly._baseUrl}/reschedulings/${inv.id}`,
      rescheduled: false,
      cancellation: inv.cancellation,
      created_at: inv.created_at.toISOString(),
      updated_at: inv.updated_at.toISOString(),
    }
  }
}

// ============================================================================
// AVAILABILITY RESOURCE
// ============================================================================

class AvailabilityResource {
  constructor(private calendly: Calendly) {}

  async createSchedule(userUri: URI, input: {
    name: string
    timezone: string
    rules: AvailabilityRule[]
    default?: boolean
  }): Promise<AvailabilitySchedule> {
    const now = new Date()

    // Convert Calendly rules to CalendarEngine format
    const engineRules = input.rules.map((rule, idx) => ({
      id: `rule_${generateId()}`,
      days: rule.type === 'wday' && rule.wday
        ? [dayNameToNumber(rule.wday)]
        : [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[],
      slots: rule.intervals.map(int => ({
        start: int.from,
        end: int.to,
      })),
      effectiveFrom: rule.type === 'date' ? rule.date : undefined,
      effectiveUntil: rule.type === 'date' ? rule.date : undefined,
    }))

    const schedule = this.calendly._availabilityStore.createSchedule({
      name: input.name,
      timezone: input.timezone,
      rules: engineRules,
    })

    return {
      uri: makeUri('availability_schedules', schedule.id, this.calendly._baseUrl),
      name: input.name,
      timezone: input.timezone,
      default: input.default ?? false,
      user: userUri,
      rules: input.rules,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }
  }

  async getSchedule(uri: URI): Promise<AvailabilitySchedule | null> {
    const id = extractIdFromUri(uri)
    const schedule = this.calendly._availabilityStore.getSchedule(id)

    if (!schedule) return null

    return {
      uri: makeUri('availability_schedules', schedule.id, this.calendly._baseUrl),
      name: schedule.name,
      timezone: schedule.timezone,
      default: false,
      user: '', // Would be stored in real implementation
      rules: this.convertEngineRules(schedule.rules),
      created_at: schedule.createdAt.toISOString(),
      updated_at: schedule.updatedAt.toISOString(),
    }
  }

  async listSchedules(userUri: URI): Promise<Collection<AvailabilitySchedule>> {
    const schedules = this.calendly._availabilityStore.listSchedules()

    return {
      collection: schedules.map(s => ({
        uri: makeUri('availability_schedules', s.id, this.calendly._baseUrl),
        name: s.name,
        timezone: s.timezone,
        default: false,
        user: userUri,
        rules: this.convertEngineRules(s.rules),
        created_at: s.createdAt.toISOString(),
        updated_at: s.updatedAt.toISOString(),
      })),
      pagination: { count: schedules.length },
    }
  }

  async getUserBusyTimes(userUri: URI, options: {
    start_time: string
    end_time: string
  }): Promise<Collection<UserBusyTime>> {
    // Get busy periods from booking engine
    const calendarId = `user_${extractIdFromUri(userUri)}`
    const busyPeriods = this.calendly._bookingEngine.getBusyPeriods(
      calendarId,
      new Date(options.start_time),
      new Date(options.end_time)
    )

    return {
      collection: busyPeriods.map(bp => ({
        type: 'calendly' as const,
        start_time: bp.start.toISOString(),
        end_time: bp.end.toISOString(),
        event: bp.eventId ? { uri: makeUri('scheduled_events', bp.eventId, this.calendly._baseUrl) } : undefined,
      })),
      pagination: { count: busyPeriods.length },
    }
  }

  async getAvailableTimes(eventTypeUri: URI, options: {
    start_time: string
    end_time: string
  }): Promise<{ collection: Array<{ start_time: string; status: 'available' }> }> {
    const eventTypeId = extractIdFromUri(eventTypeUri)
    const eventType = await this.calendly._eventTypes.get(eventTypeId)

    if (!eventType) {
      return { collection: [] }
    }

    // Get available slots from availability store
    const schedules = this.calendly._availabilityStore.listSchedules()
    if (schedules.length === 0) {
      return { collection: [] }
    }

    const slots = this.calendly._availabilityStore.getAvailableSlots({
      scheduleId: schedules[0].id,
      start: new Date(options.start_time),
      end: new Date(options.end_time),
      duration: eventType.duration,
    })

    return {
      collection: slots.map(slot => ({
        start_time: slot.start.toISOString(),
        status: 'available' as const,
      })),
    }
  }

  private convertEngineRules(rules: Array<{ id: string; days: DayOfWeek[]; slots: Array<{ start: string; end: string }> }>): AvailabilityRule[] {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

    const result: AvailabilityRule[] = []

    for (const rule of rules) {
      for (const day of rule.days) {
        result.push({
          type: 'wday',
          wday: dayNames[day],
          intervals: rule.slots.map(s => ({ from: s.start, to: s.end })),
        })
      }
    }

    return result
  }
}

// ============================================================================
// WEBHOOKS RESOURCE
// ============================================================================

class WebhooksResource {
  constructor(private calendly: Calendly) {}

  async create(input: CreateWebhookSubscriptionInput): Promise<WebhookSubscription> {
    const now = new Date()

    const webhook = await this.calendly._webhooks.create({
      callback_url: input.url,
      events: input.events,
      scope: input.scope,
      user_uri: input.user,
      organization_uri: input.organization,
      state: 'active',
      signing_key: input.signing_key,
      created_at: now,
      updated_at: now,
    })

    return this.toApiWebhook(webhook)
  }

  async get(uri: URI): Promise<WebhookSubscription | null> {
    const id = extractIdFromUri(uri)
    const webhook = await this.calendly._webhooks.get(id)
    return webhook ? this.toApiWebhook(webhook) : null
  }

  async list(options: { user?: URI; organization?: URI; scope?: 'user' | 'organization' } = {}): Promise<Collection<WebhookSubscription>> {
    const collection: WebhookSubscription[] = []

    for await (const wh of this.calendly._webhooks.find({})) {
      if (options.user && wh.user_uri !== options.user) continue
      if (options.organization && wh.organization_uri !== options.organization) continue
      if (options.scope && wh.scope !== options.scope) continue
      collection.push(this.toApiWebhook(wh))
    }

    return {
      collection,
      pagination: { count: collection.length },
    }
  }

  async delete(uri: URI): Promise<void> {
    const id = extractIdFromUri(uri)
    await this.calendly._webhooks.delete(id)
  }

  onEvent(event: WebhookEvent, handler: (payload: WebhookPayload) => void): () => void {
    const sub = this.calendly._webhookChannel.subscribe(event, handler)
    return () => sub.unsubscribe()
  }

  private toApiWebhook(wh: StoredWebhook): WebhookSubscription {
    return {
      uri: makeUri('webhook_subscriptions', wh.id, this.calendly._baseUrl),
      callback_url: wh.callback_url,
      events: wh.events,
      scope: wh.scope,
      state: wh.state,
      user: wh.user_uri,
      organization: wh.organization_uri,
      created_at: wh.created_at.toISOString(),
      updated_at: wh.updated_at.toISOString(),
    }
  }
}

export default Calendly
