/**
 * Calendly API Types
 *
 * Type definitions compatible with the Calendly API v2.
 * @see https://developer.calendly.com/api-docs
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/** Pagination cursor */
export interface Pagination {
  count: number
  next_page?: string
  previous_page?: string
  next_page_token?: string
  previous_page_token?: string
}

/** Standard collection response */
export interface Collection<T> {
  collection: T[]
  pagination: Pagination
}

/** URI format used by Calendly */
export type URI = string

// ============================================================================
// USER TYPES
// ============================================================================

export interface User {
  uri: URI
  name: string
  slug: string
  email: string
  scheduling_url: string
  timezone: string
  avatar_url?: string
  created_at: string
  updated_at: string
  current_organization?: URI
}

export interface CurrentUser {
  resource: User
}

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

export interface Organization {
  uri: URI
  name: string
  plan: 'basic' | 'essentials' | 'professional' | 'teams'
  created_at: string
  updated_at: string
}

export interface OrganizationMembership {
  uri: URI
  role: 'owner' | 'admin' | 'user'
  user: User
  organization: URI
  created_at: string
  updated_at: string
}

// ============================================================================
// EVENT TYPE TYPES
// ============================================================================

export type EventTypeKind = 'solo' | 'group'
export type EventTypePoolingType = 'round_robin' | 'collective'

export interface EventTypeCustomQuestion {
  uuid: string
  name: string
  type: 'text' | 'phone_number' | 'single_select' | 'multi_select'
  position: number
  required: boolean
  answer_choices?: string[]
  enabled: boolean
}

export interface EventType {
  uri: URI
  name: string
  active: boolean
  slug: string
  scheduling_url: string
  duration: number
  kind: EventTypeKind
  pooling_type?: EventTypePoolingType
  type: 'StandardEventType' | 'ManagedEventType'
  color: string
  created_at: string
  updated_at: string
  internal_note?: string
  description_plain?: string
  description_html?: string
  profile: {
    type: 'User' | 'Team'
    name: string
    owner: URI
  }
  secret: boolean
  booking_method: 'instant' | 'poll'
  custom_questions?: EventTypeCustomQuestion[]
}

export interface CreateEventTypeInput {
  name: string
  duration: number
  slug?: string
  kind?: EventTypeKind
  color?: string
  description_plain?: string
  internal_note?: string
  pooling_type?: EventTypePoolingType
  custom_questions?: Omit<EventTypeCustomQuestion, 'uuid'>[]
}

// ============================================================================
// SCHEDULED EVENT TYPES
// ============================================================================

export type ScheduledEventStatus = 'active' | 'canceled'

export interface ScheduledEventInviteeCounter {
  total: number
  active: number
  limit: number
}

export interface ScheduledEvent {
  uri: URI
  name: string
  status: ScheduledEventStatus
  start_time: string
  end_time: string
  event_type: URI
  location?: EventLocation
  invitees_counter: ScheduledEventInviteeCounter
  created_at: string
  updated_at: string
  event_memberships: Array<{
    user: URI
    user_email: string
    user_name?: string
  }>
  event_guests?: EventGuest[]
  cancellation?: ScheduledEventCancellation
  calendar_event?: {
    external_id: string
    kind: 'google' | 'outlook' | 'office365' | 'exchange' | 'icloud'
  }
}

export interface EventLocation {
  type: 'physical' | 'inbound_call' | 'outbound_call' | 'google_conference' | 'zoom' | 'microsoft_teams' | 'webex' | 'custom'
  location?: string
  join_url?: string
  data?: Record<string, unknown>
}

export interface EventGuest {
  email: string
  created_at: string
  updated_at: string
}

export interface ScheduledEventCancellation {
  canceled_by: string
  reason?: string
  canceler_type: 'host' | 'invitee'
}

// ============================================================================
// INVITEE TYPES
// ============================================================================

export interface Invitee {
  uri: URI
  email: string
  name: string
  first_name?: string
  last_name?: string
  status: 'active' | 'canceled'
  questions_and_answers?: QuestionAndAnswer[]
  timezone: string
  event: URI
  created_at: string
  updated_at: string
  tracking?: InviteeTracking
  cancel_url: string
  reschedule_url: string
  rescheduled: boolean
  old_invitee?: URI
  new_invitee?: URI
  cancellation?: InviteeCancellation
  payment?: InviteePayment
  no_show?: InviteeNoShow
  reconfirmation?: InviteeReconfirmation
  routing_form_submission?: URI
}

export interface QuestionAndAnswer {
  question: string
  answer: string
  position: number
}

export interface InviteeTracking {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  salesforce_uuid?: string
}

export interface InviteeCancellation {
  canceled_by: string
  reason?: string
  canceler_type: 'host' | 'invitee'
}

export interface InviteePayment {
  external_id: string
  provider: 'stripe' | 'paypal'
  amount: number
  currency: string
  terms?: string
  successful: boolean
}

export interface InviteeNoShow {
  uri: URI
  created_at: string
}

export interface InviteeReconfirmation {
  created_at: string
  confirmed_at?: string
}

// ============================================================================
// AVAILABILITY TYPES
// ============================================================================

export interface AvailabilityRule {
  type: 'wday' | 'date'
  wday?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
  date?: string
  intervals: Array<{
    from: string
    to: string
  }>
}

export interface AvailabilitySchedule {
  uri: URI
  name: string
  default: boolean
  timezone: string
  user: URI
  rules: AvailabilityRule[]
  created_at: string
  updated_at: string
}

export interface UserAvailabilitySchedule {
  uri: URI
  user: URI
  schedule?: AvailabilitySchedule
  timezone: string
  start_time: string
  end_time: string
  default: boolean
}

export interface UserBusyTime {
  type: 'calendly' | 'external'
  start_time: string
  end_time: string
  buffered_start_time?: string
  buffered_end_time?: string
  event?: {
    uri: URI
  }
  calendar_event?: {
    external_id: string
  }
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

export type WebhookEvent =
  | 'invitee.created'
  | 'invitee.canceled'
  | 'invitee_no_show.created'
  | 'routing_form_submission.created'

export type WebhookScope = 'user' | 'organization'

export interface WebhookSubscription {
  uri: URI
  callback_url: string
  created_at: string
  updated_at: string
  retry_started_at?: string
  state: 'active' | 'disabled'
  events: WebhookEvent[]
  scope: WebhookScope
  organization?: URI
  user?: URI
  creator?: URI
}

export interface CreateWebhookSubscriptionInput {
  url: string
  events: WebhookEvent[]
  organization?: URI
  user?: URI
  scope: WebhookScope
  signing_key?: string
}

export interface WebhookPayload<T = unknown> {
  event: WebhookEvent
  created_at: string
  created_by: URI
  payload: T
}

// ============================================================================
// ROUTING FORM TYPES
// ============================================================================

export interface RoutingFormQuestion {
  uuid: string
  name: string
  type: 'text' | 'phone_number' | 'single_select' | 'multi_select'
  required: boolean
  answer_choices?: string[]
}

export interface RoutingForm {
  uri: URI
  name: string
  status: 'published' | 'draft' | 'archived'
  questions: RoutingFormQuestion[]
  organization: URI
  created_at: string
  updated_at: string
}

export interface RoutingFormSubmission {
  uri: URI
  routing_form: URI
  questions_and_answers: QuestionAndAnswer[]
  tracking?: InviteeTracking
  result?: {
    type: 'event_type' | 'external_url' | 'custom_message'
    value: string
  }
  submitter?: URI
  submitter_type: 'Invitee'
  created_at: string
  updated_at: string
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface CalendlyError {
  type: string
  title: string
  message: string
  details?: Array<{
    parameter: string
    message: string
  }>
}
