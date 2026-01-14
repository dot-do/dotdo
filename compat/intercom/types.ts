/**
 * @dotdo/intercom - Intercom API Type Definitions
 *
 * Type definitions for Intercom API compatibility layer.
 * Based on Intercom API v2.11
 *
 * @module @dotdo/intercom/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Custom attributes stored on contacts
 */
export type CustomAttributes = Record<string, string | number | boolean | null>

/**
 * Pages object for paginated responses
 */
export interface Pages {
  type: 'pages'
  page: number
  per_page: number
  total_pages: number
  next?: {
    page: number
    starting_after?: string
  }
}

/**
 * List response wrapper for paginated resources
 */
export interface ListResponse<T> {
  type: 'list'
  data: T[]
  total_count: number
  pages: Pages
}

/**
 * Search response wrapper
 */
export interface SearchResponse<T> extends ListResponse<T> {}

/**
 * Deleted object response
 */
export interface DeletedObject {
  type: string
  id: string
  deleted: true
}

// =============================================================================
// Contact Types
// =============================================================================

/**
 * Contact location information
 */
export interface ContactLocation {
  type?: string
  country?: string | null
  region?: string | null
  city?: string | null
  country_code?: string | null
  continent_code?: string | null
  timezone?: string | null
}

/**
 * Social profile for a contact
 */
export interface SocialProfile {
  type: string
  name: string
  url: string
}

/**
 * Tag reference
 */
export interface TagRef {
  type: 'tag'
  id: string
  name?: string
}

/**
 * Note reference
 */
export interface NoteRef {
  type: 'note'
  id: string
}

/**
 * Company reference
 */
export interface CompanyRef {
  type: 'company'
  id: string
  name?: string
}

/**
 * Intercom Contact object
 */
export interface Contact {
  type: 'contact'
  id: string
  workspace_id: string
  external_id: string | null
  role: 'user' | 'lead'
  email: string | null
  name: string | null
  phone: string | null
  avatar: string | null
  signed_up_at: number | null
  last_seen_at: number | null
  created_at: number
  updated_at: number
  custom_attributes: CustomAttributes
  tags: {
    type: 'list'
    data: TagRef[]
  }
  notes: {
    type: 'list'
    data: NoteRef[]
  }
  companies: {
    type: 'list'
    data: CompanyRef[]
  }
  location: ContactLocation
  social_profiles: {
    type: 'list'
    data: SocialProfile[]
  }
  unsubscribed_from_emails: boolean
  owner_id?: string | null
  has_hard_bounced?: boolean
  marked_email_as_spam?: boolean
  last_contacted_at?: number | null
  last_email_opened_at?: number | null
  last_email_clicked_at?: number | null
  last_replied_at?: number | null
  browser?: string | null
  browser_version?: string | null
  browser_language?: string | null
  os?: string | null
  android_app_name?: string | null
  android_app_version?: string | null
  android_device?: string | null
  android_os_version?: string | null
  android_sdk_version?: string | null
  android_last_seen_at?: number | null
  ios_app_name?: string | null
  ios_app_version?: string | null
  ios_device?: string | null
  ios_os_version?: string | null
  ios_sdk_version?: string | null
  ios_last_seen_at?: number | null
}

/**
 * Parameters for creating a contact
 */
export interface ContactCreateParams {
  role: 'user' | 'lead'
  external_id?: string
  email?: string
  phone?: string
  name?: string
  avatar?: string
  signed_up_at?: number
  last_seen_at?: number
  owner_id?: string
  unsubscribed_from_emails?: boolean
  custom_attributes?: CustomAttributes
}

/**
 * Parameters for updating a contact
 */
export interface ContactUpdateParams {
  role?: 'user' | 'lead'
  external_id?: string
  email?: string
  phone?: string
  name?: string
  avatar?: string
  signed_up_at?: number
  last_seen_at?: number
  owner_id?: string
  unsubscribed_from_emails?: boolean
  custom_attributes?: CustomAttributes
}

/**
 * Parameters for listing contacts
 */
export interface ContactListParams {
  per_page?: number
  starting_after?: string
}

/**
 * Search query field condition
 */
export interface SearchQueryField {
  field: string
  operator: '=' | '!=' | '>' | '<' | '~' | '!~' | 'IN' | 'NIN' | 'contains' | 'starts_with'
  value: string | number | boolean | string[] | number[]
}

/**
 * Nested search query with AND/OR
 */
export interface SearchQueryNested {
  operator: 'AND' | 'OR'
  value: (SearchQueryField | SearchQueryNested)[]
}

/**
 * Search query parameter
 */
export type SearchQuery = SearchQueryField | SearchQueryNested

/**
 * Parameters for searching contacts
 */
export interface ContactSearchParams {
  query: SearchQuery
  pagination?: {
    per_page?: number
    starting_after?: string
  }
  sort?: {
    field: string
    order: 'ascending' | 'descending'
  }
}

/**
 * Parameters for merging contacts
 */
export interface ContactMergeParams {
  from: string
  into: string
}

/**
 * Deleted contact response
 */
export interface DeletedContact extends DeletedObject {
  type: 'contact'
}

/**
 * Parameters for archiving a contact
 */
export interface ContactArchiveParams {
  id: string
}

/**
 * Parameters for unarchiving a contact
 */
export interface ContactUnarchiveParams {
  id: string
}

/**
 * Archived contact response
 */
export interface ArchivedContact {
  type: 'contact'
  id: string
  archived: true
}

/**
 * Unarchived contact response
 */
export interface UnarchivedContact {
  type: 'contact'
  id: string
  archived: false
}

// =============================================================================
// Tag Types
// =============================================================================

/**
 * Intercom Tag object
 */
export interface Tag {
  type: 'tag'
  id: string
  name: string
  applied_at?: number
  applied_by?: {
    type: 'admin'
    id: string
  }
}

/**
 * Parameters for creating a tag
 */
export interface TagCreateParams {
  name: string
}

/**
 * Parameters for updating a tag
 */
export interface TagUpdateParams {
  name: string
}

/**
 * Deleted tag response
 */
export interface DeletedTag extends DeletedObject {
  type: 'tag'
}

/**
 * Parameters for tagging a contact
 */
export interface ContactTagParams {
  id: string
}

/**
 * Parameters for untagging a contact
 */
export interface ContactUntagParams {
  id: string
}

// =============================================================================
// Company Types
// =============================================================================

/**
 * Company plan
 */
export interface CompanyPlan {
  type: 'plan'
  id: string
  name: string
}

/**
 * Intercom Company object
 */
export interface Company {
  type: 'company'
  id: string
  company_id: string
  name: string
  created_at: number
  updated_at: number
  remote_created_at: number | null
  plan?: CompanyPlan
  size: number | null
  website: string | null
  industry: string | null
  monthly_spend: number | null
  session_count: number
  user_count: number
  custom_attributes: CustomAttributes
  tags: {
    type: 'list'
    data: TagRef[]
  }
  segments: {
    type: 'list'
    data: Array<{
      type: 'segment'
      id: string
    }>
  }
}

/**
 * Parameters for creating a company
 */
export interface CompanyCreateParams {
  company_id: string
  name?: string
  remote_created_at?: number
  plan?: string
  size?: number
  website?: string
  industry?: string
  monthly_spend?: number
  custom_attributes?: CustomAttributes
}

/**
 * Parameters for updating a company
 */
export interface CompanyUpdateParams {
  company_id?: string
  name?: string
  remote_created_at?: number
  plan?: string
  size?: number
  website?: string
  industry?: string
  monthly_spend?: number
  custom_attributes?: CustomAttributes
}

/**
 * Parameters for listing companies
 */
export interface CompanyListParams {
  per_page?: number
  page?: number
  order?: 'asc' | 'desc'
}

/**
 * Parameters for attaching a contact to a company
 */
export interface ContactCompanyAttachParams {
  id: string
}

/**
 * Parameters for detaching a contact from a company
 */
export interface ContactCompanyDetachParams {
  id: string
}

/**
 * Deleted company response
 */
export interface DeletedCompany extends DeletedObject {
  type: 'company'
}

/**
 * Scroll response for companies
 */
export interface CompanyScrollResponse {
  type: 'list'
  data: Company[]
  pages: Pages
  scroll_param?: string
}

// =============================================================================
// Note Types
// =============================================================================

/**
 * Intercom Note object
 */
export interface Note {
  type: 'note'
  id: string
  created_at: number
  body: string
  author: {
    type: 'admin'
    id: string
    name?: string
    email?: string
    away_mode_enabled?: boolean
    away_mode_reassign?: boolean
    avatar?: {
      type: 'avatar'
      image_url: string
    }
  }
  contact?: {
    type: 'contact'
    id: string
  }
}

/**
 * Parameters for creating a note on a contact
 */
export interface NoteCreateParams {
  body: string
  admin_id: string
}

// =============================================================================
// Segment Types
// =============================================================================

/**
 * Intercom Segment object
 */
export interface Segment {
  type: 'segment'
  id: string
  name: string
  created_at: number
  updated_at: number
  person_type: 'user' | 'lead' | 'contact'
  count?: number
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Subscription type object
 */
export interface SubscriptionType {
  type: 'subscription_type'
  id: string
  name: string
  description: string
  consent_type: 'opt_in' | 'opt_out'
  content_types: Array<'email' | 'sms_message'>
  default_translation?: {
    name: string
    description: string
    locale: string
  }
  translations?: Array<{
    name: string
    description: string
    locale: string
  }>
}

/**
 * Contact subscription preference
 */
export interface ContactSubscription {
  id: string
  consent_type: 'opt_in' | 'opt_out'
  status: 'subscribed' | 'unsubscribed'
}

/**
 * Parameters for updating contact subscriptions
 */
export interface ContactSubscriptionUpdateParams {
  consent_type: 'opt_in' | 'opt_out'
}

// =============================================================================
// Conversation Types
// =============================================================================

/**
 * Conversation source author
 */
export interface ConversationAuthor {
  type: 'admin' | 'user' | 'lead' | 'bot' | 'team'
  id: string
  name?: string | null
  email?: string | null
}

/**
 * Conversation source
 */
export interface ConversationSource {
  type: string
  id: string
  delivered_as: 'customer_initiated' | 'campaigns_initiated' | 'admin_initiated' | 'automated'
  subject?: string | null
  body: string
  author: ConversationAuthor
  attachments?: ConversationAttachment[]
  url?: string | null
  redacted?: boolean
}

/**
 * Conversation attachment
 */
export interface ConversationAttachment {
  type: 'upload'
  name: string
  url: string
  content_type: string
  filesize: number
  width?: number
  height?: number
}

/**
 * Conversation part (reply, note, assignment, etc.)
 */
export interface ConversationPart {
  type: 'conversation_part'
  id: string
  part_type: 'comment' | 'note' | 'assignment' | 'open' | 'close' | 'snoozed'
  body: string | null
  created_at: number
  updated_at: number
  notified_at: number
  assigned_to?: ConversationAuthor | null
  author: ConversationAuthor
  attachments?: ConversationAttachment[]
  external_id?: string | null
  redacted?: boolean
}

/**
 * Conversation contact reference
 */
export interface ConversationContactRef {
  type: 'contact'
  id: string
}

/**
 * Conversation admin reference
 */
export interface ConversationAdminRef {
  type: 'admin'
  id: string
}

/**
 * Conversation statistics
 */
export interface ConversationStatistics {
  type: 'conversation_statistics'
  time_to_assignment?: number | null
  time_to_admin_reply?: number | null
  time_to_first_close?: number | null
  time_to_last_close?: number | null
  median_time_to_reply?: number | null
  first_contact_reply_at?: number | null
  first_assignment_at?: number | null
  first_admin_reply_at?: number | null
  first_close_at?: number | null
  last_assignment_at?: number | null
  last_assignment_admin_reply_at?: number | null
  last_contact_reply_at?: number | null
  last_admin_reply_at?: number | null
  last_close_at?: number | null
  last_closed_by_id?: string | null
  count_reopens?: number
  count_assignments?: number
  count_conversation_parts?: number
}

/**
 * Conversation rating
 */
export interface ConversationRating {
  rating: number
  remark?: string | null
  created_at: number
  contact: ConversationContactRef
  teammate: ConversationAdminRef
}

/**
 * Conversation SLA applied
 */
export interface ConversationSLA {
  type: 'conversation_sla_summary'
  sla_name: string
  sla_status: 'hit' | 'missed' | 'active'
}

/**
 * Intercom Conversation object
 */
export interface Conversation {
  type: 'conversation'
  id: string
  created_at: number
  updated_at: number
  title: string | null
  admin_assignee_id: string | null
  team_assignee_id: string | null
  open: boolean
  state: 'open' | 'closed' | 'snoozed'
  read: boolean
  waiting_since: number | null
  snoozed_until: number | null
  source: ConversationSource
  contacts: {
    type: 'contact.list'
    contacts: ConversationContactRef[]
  }
  teammates: {
    type: 'admin.list'
    admins: ConversationAdminRef[]
  }
  conversation_parts: {
    type: 'conversation_part.list'
    conversation_parts: ConversationPart[]
    total_count: number
  }
  tags: {
    type: 'tag.list'
    tags: TagRef[]
  }
  first_contact_reply: {
    created_at: number
    type: string
    url?: string
  } | null
  priority: 'priority' | 'not_priority'
  sla_applied: ConversationSLA | null
  statistics: ConversationStatistics | null
  conversation_rating: ConversationRating | null
  custom_attributes: CustomAttributes
}

/**
 * Parameters for creating a conversation
 */
export interface ConversationCreateParams {
  from: {
    type: 'user' | 'lead' | 'contact'
    id?: string
    user_id?: string
    email?: string
  }
  body: string
}

/**
 * Conversation list response
 */
export interface ConversationListResponse {
  type: 'conversation.list'
  conversations: Conversation[]
  total_count: number
  pages: Pages
}

/**
 * Parameters for listing conversations
 */
export interface ConversationListParams {
  per_page?: number
  starting_after?: string
}

/**
 * Parameters for replying to a conversation
 */
export interface ConversationReplyParams {
  id: string
  type: 'admin' | 'user'
  message_type?: 'comment' | 'note'
  body: string
  admin_id?: string
  intercom_user_id?: string
  user_id?: string
  email?: string
  attachment_urls?: string[]
  attachment_files?: Array<{
    content_type: string
    data: string
    name: string
  }>
}

/**
 * Parameters for assigning a conversation
 */
export interface ConversationAssignParams {
  id: string
  admin_id: string
  assignee_id: string
  type: 'admin' | 'team'
  body?: string
}

/**
 * Parameters for closing a conversation
 */
export interface ConversationCloseParams {
  id: string
  admin_id: string
  body?: string
}

/**
 * Parameters for opening a conversation
 */
export interface ConversationOpenParams {
  id: string
  admin_id: string
}

/**
 * Parameters for snoozing a conversation
 */
export interface ConversationSnoozeParams {
  id: string
  admin_id: string
  snoozed_until: number
}

/**
 * Parameters for searching conversations
 */
export interface ConversationSearchParams {
  query: SearchQuery
  pagination?: {
    per_page?: number
    starting_after?: string
  }
  sort?: {
    field: string
    order: 'ascending' | 'descending'
  }
}

/**
 * Parameters for adding a tag to a conversation
 */
export interface ConversationTagParams {
  /** Conversation ID */
  id: string
  /** Admin ID performing the action */
  admin_id: string
  /** Tag ID to add */
  tag_id: string
}

/**
 * Parameters for removing a tag from a conversation
 */
export interface ConversationUntagParams {
  /** Conversation ID */
  id: string
  /** Admin ID performing the action */
  admin_id: string
  /** Tag ID to remove */
  tag_id: string
}

/**
 * Parameters for adding a note to a conversation
 */
export interface ConversationNoteParams {
  /** Conversation ID */
  id: string
  /** Admin ID adding the note */
  admin_id: string
  /** Note content (HTML supported) */
  body: string
}

/**
 * Parameters for redacting conversation content
 */
export interface ConversationRedactParams {
  /** Type of content to redact */
  type: 'conversation_part' | 'source'
  /** Conversation ID */
  conversation_id: string
  /** Conversation part ID (required when type is 'conversation_part') */
  conversation_part_id?: string
  /** Source ID (required when type is 'source') */
  source_id?: string
}

/**
 * Parameters for setting conversation priority
 */
export interface ConversationSetPriorityParams {
  /** Conversation ID */
  id: string
  /** Admin ID performing the action */
  admin_id: string
  /** Priority level */
  priority: 'priority' | 'not_priority'
}

/**
 * Parameters for attaching a contact to a conversation
 */
export interface ConversationAttachContactParams {
  /** Conversation ID */
  id: string
  /** Admin ID performing the action */
  admin_id: string
  /** Customer identification */
  customer: {
    intercom_user_id?: string
    user_id?: string
    email?: string
  }
}

/**
 * Parameters for detaching a contact from a conversation
 */
export interface ConversationDetachContactParams {
  /** Conversation ID */
  id: string
  /** Admin ID performing the action */
  admin_id: string
  /** Contact ID to detach */
  contact_id: string
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Intercom Message object
 */
export interface Message {
  type: 'user_message' | 'admin_message'
  id: string
  created_at: number
  body: string
  message_type: 'inapp' | 'email' | 'push'
  conversation_id?: string
  subject?: string | null
}

/**
 * Message recipient
 */
export interface MessageRecipient {
  type: 'user' | 'lead' | 'contact'
  id?: string
  user_id?: string
  email?: string
}

/**
 * Message sender
 */
export interface MessageSender {
  type: 'admin' | 'bot'
  id: string
}

/**
 * Parameters for creating a message
 */
export interface MessageCreateParams {
  message_type: 'inapp' | 'email'
  subject?: string
  body: string
  template?: 'plain' | 'personal'
  from: MessageSender
  to: MessageRecipient
  create_conversation_without_contact_reply?: boolean
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event metadata
 */
export type EventMetadata = Record<string, string | number | boolean | null>

/**
 * Intercom Event object
 */
export interface Event {
  type: 'event'
  id?: string
  event_name: string
  created_at: number
  user_id?: string
  intercom_user_id?: string
  email?: string
  metadata?: EventMetadata
}

/**
 * Parameters for creating an event
 */
export interface EventCreateParams {
  event_name: string
  created_at?: number
  user_id?: string
  id?: string
  email?: string
  metadata?: EventMetadata
}

/**
 * Event list response
 */
export interface EventListResponse {
  type: 'event.list'
  events: Event[]
  pages: {
    next?: string | null
    since?: string | null
  }
}

/**
 * Parameters for listing events
 */
export interface EventListParams {
  type: 'user'
  user_id?: string
  intercom_user_id?: string
  email?: string
  per_page?: number
  summary?: boolean
}

/**
 * Event summary item
 */
export interface EventSummaryItem {
  event_name: string
  count: number
  first?: number
  last?: number
}

/**
 * Event summary response
 */
export interface EventSummaryResponse {
  type: 'event.summary'
  events: EventSummaryItem[]
}

/**
 * Parameters for getting event summaries
 */
export interface EventSummaryParams {
  user_id?: string
  intercom_user_id?: string
  email?: string
}

// =============================================================================
// Article Types
// =============================================================================

/**
 * Article statistics
 */
export interface ArticleStatistics {
  type: 'article_statistics'
  views: number
  conversations: number
  reactions: number
  happy_reaction_percentage: number
  neutral_reaction_percentage: number
  sad_reaction_percentage: number
}

/**
 * Intercom Article object
 */
export interface Article {
  type: 'article'
  id: string
  workspace_id: string
  title: string
  description: string | null
  body: string
  author_id: string
  state: 'published' | 'draft'
  created_at: number
  updated_at: number
  url: string | null
  parent_id: string | null
  parent_type: 'collection' | 'section' | null
  default_locale: string
  statistics: ArticleStatistics | null
  translated_content?: Record<string, {
    type: 'article_translated_content'
    title: string
    description: string | null
    body: string
    author_id: string
    state: 'published' | 'draft'
    created_at: number
    updated_at: number
    url: string | null
  }>
}

/**
 * Parameters for creating an article
 */
export interface ArticleCreateParams {
  title: string
  author_id: string
  body?: string
  description?: string
  state?: 'published' | 'draft'
  parent_id?: string
  parent_type?: 'collection' | 'section'
  translated_content?: Record<string, {
    title: string
    description?: string
    body?: string
    author_id?: string
    state?: 'published' | 'draft'
  }>
}

/**
 * Parameters for updating an article
 */
export interface ArticleUpdateParams {
  title?: string
  author_id?: string
  body?: string
  description?: string
  state?: 'published' | 'draft'
  parent_id?: string
  parent_type?: 'collection' | 'section'
  translated_content?: Record<string, {
    title?: string
    description?: string
    body?: string
    author_id?: string
    state?: 'published' | 'draft'
  }>
}

/**
 * Parameters for listing articles
 */
export interface ArticleListParams {
  per_page?: number
  page?: number
}

/**
 * Article search response
 */
export interface ArticleSearchResponse {
  type: 'article.list'
  articles: {
    type: 'list'
    data: Article[]
    total_count: number
  }
  pages: Pages
}

/**
 * Parameters for searching articles
 */
export interface ArticleSearchParams {
  phrase: string
  state?: 'published' | 'draft'
  help_center_id?: string
}

/**
 * Deleted article response
 */
export interface DeletedArticle extends DeletedObject {
  type: 'article'
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Intercom error detail
 */
export interface IntercomErrorDetail {
  code: string
  message: string
  field?: string
}

/**
 * Intercom error response
 */
export interface IntercomErrorResponse {
  type: 'error.list'
  request_id?: string
  errors: IntercomErrorDetail[]
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Token authentication
 */
export interface TokenAuth {
  token: string
}

/**
 * Mock fetch function type for testing
 */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<{
  ok: boolean
  status: number
  headers: Headers
  json: () => Promise<unknown>
}>

/**
 * Client configuration options
 */
export interface ClientConfig {
  tokenAuth: TokenAuth
  apiVersion?: string
  fetch?: typeof fetch | FetchFunction
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  idempotencyKey?: string
}
