/**
 * @dotdo/freshdesk - Freshdesk API Type Definitions
 *
 * Type definitions for Freshdesk API compatibility layer.
 * Based on Freshdesk API v2
 *
 * @see https://developers.freshdesk.com/api/
 * @module @dotdo/freshdesk/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Freshdesk ticket status values
 */
export type TicketStatus = 2 | 3 | 4 | 5 | 6 | 7
// 2 = Open, 3 = Pending, 4 = Resolved, 5 = Closed, 6 = Waiting on Customer, 7 = Waiting on Third Party

/**
 * Freshdesk ticket priority values
 */
export type TicketPriority = 1 | 2 | 3 | 4
// 1 = Low, 2 = Medium, 3 = High, 4 = Urgent

/**
 * Freshdesk ticket source values
 */
export type TicketSource = 1 | 2 | 3 | 7 | 8 | 9 | 10
// 1 = Email, 2 = Portal, 3 = Phone, 7 = Chat, 8 = Mobihelp, 9 = Feedback Widget, 10 = Outbound Email

/**
 * Custom field value types
 */
export type CustomFieldValue = string | number | boolean | string[] | null

/**
 * Custom fields object
 */
export type CustomFields = Record<string, CustomFieldValue>

// =============================================================================
// Ticket Types
// =============================================================================

/**
 * Freshdesk Ticket object
 */
export interface Ticket {
  id: number
  subject: string
  description: string
  description_text: string
  status: TicketStatus
  priority: TicketPriority
  source: TicketSource
  type: string | null
  requester_id: number
  responder_id: number | null
  company_id: number | null
  group_id: number | null
  product_id: number | null
  email_config_id: number | null
  to_emails: string[] | null
  cc_emails: string[]
  fwd_emails: string[]
  reply_cc_emails: string[]
  fr_escalated: boolean
  spam: boolean
  is_escalated: boolean
  due_by: string
  fr_due_by: string
  tags: string[]
  attachments: Attachment[]
  custom_fields: CustomFields
  created_at: string
  updated_at: string
  ticket_cc_emails?: string[]
  nr_escalated?: boolean
  nr_due_by?: string
  stats?: TicketStats
}

/**
 * Ticket statistics
 */
export interface TicketStats {
  agent_responded_at: string | null
  requester_responded_at: string | null
  first_responded_at: string | null
  status_updated_at: string | null
  reopened_at: string | null
  resolved_at: string | null
  closed_at: string | null
  pending_since: string | null
}

/**
 * Parameters for creating a ticket
 */
export interface TicketCreateParams {
  subject?: string
  description?: string
  requester_id?: number
  email?: string
  name?: string
  phone?: string
  twitter_id?: string
  unique_external_id?: string
  facebook_id?: string
  status?: TicketStatus
  priority?: TicketPriority
  source?: TicketSource
  type?: string
  company_id?: number
  group_id?: number
  product_id?: number
  responder_id?: number
  cc_emails?: string[]
  tags?: string[]
  due_by?: string
  fr_due_by?: string
  email_config_id?: number
  custom_fields?: CustomFields
  parent_id?: number
}

/**
 * Parameters for updating a ticket
 */
export interface TicketUpdateParams {
  subject?: string
  description?: string
  status?: TicketStatus
  priority?: TicketPriority
  source?: TicketSource
  type?: string | null
  group_id?: number | null
  product_id?: number | null
  responder_id?: number | null
  company_id?: number | null
  due_by?: string
  fr_due_by?: string
  tags?: string[]
  custom_fields?: CustomFields
}

/**
 * Parameters for listing tickets
 */
export interface TicketListParams {
  filter?: string
  requester_id?: number
  email?: string
  company_id?: number
  updated_since?: string
  include?: 'requester' | 'stats' | 'company' | 'description'
  order_by?: 'created_at' | 'due_by' | 'updated_at' | 'status'
  order_type?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

/**
 * Parameters for searching tickets
 */
export interface TicketSearchParams {
  query: string
  page?: number
}

/**
 * Search results response
 */
export interface SearchResponse<T> {
  results: T[]
  total: number
}

// =============================================================================
// Conversation (Reply) Types
// =============================================================================

/**
 * Conversation/Reply object
 */
export interface Conversation {
  id: number
  ticket_id: number
  user_id: number
  body: string
  body_text: string
  incoming: boolean
  private: boolean
  source: number
  source_additional_info: Record<string, unknown> | null
  attachments: Attachment[]
  to_emails: string[]
  from_email: string
  cc_emails: string[]
  bcc_emails: string[]
  support_email: string | null
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a reply
 */
export interface ReplyCreateParams {
  body: string
  from_email?: string
  user_id?: number
  cc_emails?: string[]
  bcc_emails?: string[]
  attachments?: AttachmentUploadParams[]
}

/**
 * Parameters for creating a note
 */
export interface NoteCreateParams {
  body: string
  private?: boolean
  user_id?: number
  notify_emails?: string[]
  incoming?: boolean
  attachments?: AttachmentUploadParams[]
}

// =============================================================================
// Contact Types
// =============================================================================

/**
 * Freshdesk Contact object
 */
export interface Contact {
  id: number
  name: string
  email: string
  phone: string | null
  mobile: string | null
  twitter_id: string | null
  unique_external_id: string | null
  description: string | null
  address: string | null
  job_title: string | null
  language: string
  time_zone: string
  company_id: number | null
  view_all_tickets: boolean
  tags: string[]
  custom_fields: CustomFields
  active: boolean
  deleted: boolean
  created_at: string
  updated_at: string
  avatar?: ContactAvatar
  other_emails?: string[]
  other_companies?: ContactCompanyAssociation[]
  other_phone_numbers?: string[]
}

/**
 * Contact avatar
 */
export interface ContactAvatar {
  id: number
  content_type: string
  size: number
  name: string
  attachment_url: string
  thumb_url: string
}

/**
 * Contact-Company association
 */
export interface ContactCompanyAssociation {
  company_id: number
  view_all_tickets: boolean
}

/**
 * Parameters for creating a contact
 */
export interface ContactCreateParams {
  name: string
  email?: string
  phone?: string
  mobile?: string
  twitter_id?: string
  unique_external_id?: string
  description?: string
  address?: string
  job_title?: string
  language?: string
  time_zone?: string
  company_id?: number
  view_all_tickets?: boolean
  tags?: string[]
  custom_fields?: CustomFields
  other_emails?: string[]
  other_companies?: ContactCompanyAssociation[]
  other_phone_numbers?: string[]
}

/**
 * Parameters for updating a contact
 */
export interface ContactUpdateParams {
  name?: string
  email?: string
  phone?: string
  mobile?: string
  twitter_id?: string
  unique_external_id?: string
  description?: string
  address?: string
  job_title?: string
  language?: string
  time_zone?: string
  company_id?: number | null
  view_all_tickets?: boolean
  tags?: string[]
  custom_fields?: CustomFields
  other_emails?: string[]
  other_companies?: ContactCompanyAssociation[]
  other_phone_numbers?: string[]
}

/**
 * Parameters for listing contacts
 */
export interface ContactListParams {
  email?: string
  mobile?: string
  phone?: string
  company_id?: number
  state?: 'verified' | 'unverified' | 'blocked' | 'deleted'
  updated_since?: string
  per_page?: number
  page?: number
}

/**
 * Parameters for searching contacts
 */
export interface ContactSearchParams {
  query: string
  page?: number
}

// =============================================================================
// Company Types
// =============================================================================

/**
 * Freshdesk Company object
 */
export interface Company {
  id: number
  name: string
  description: string | null
  note: string | null
  domains: string[]
  health_score: string | null
  account_tier: string | null
  renewal_date: string | null
  industry: string | null
  custom_fields: CustomFields
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a company
 */
export interface CompanyCreateParams {
  name: string
  description?: string
  note?: string
  domains?: string[]
  health_score?: string
  account_tier?: string
  renewal_date?: string
  industry?: string
  custom_fields?: CustomFields
}

/**
 * Parameters for updating a company
 */
export interface CompanyUpdateParams {
  name?: string
  description?: string
  note?: string
  domains?: string[]
  health_score?: string
  account_tier?: string
  renewal_date?: string
  industry?: string
  custom_fields?: CustomFields
}

/**
 * Parameters for listing companies
 */
export interface CompanyListParams {
  per_page?: number
  page?: number
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Freshdesk Agent object
 */
export interface Agent {
  id: number
  contact: AgentContact
  type: 'support_agent' | 'field_agent' | 'collaborator'
  available: boolean
  occasional: boolean
  signature: string | null
  group_ids: number[]
  role_ids: number[]
  skill_ids: number[]
  ticket_scope: 1 | 2 | 3
  focus_mode: boolean
  available_since: string | null
  created_at: string
  updated_at: string
}

/**
 * Agent contact information
 */
export interface AgentContact {
  id: number
  name: string
  email: string
  mobile: string | null
  phone: string | null
  job_title: string | null
  active: boolean
}

/**
 * Parameters for creating an agent
 */
export interface AgentCreateParams {
  email: string
  name?: string
  phone?: string
  mobile?: string
  job_title?: string
  type?: 'support_agent' | 'field_agent' | 'collaborator'
  occasional?: boolean
  signature?: string
  group_ids?: number[]
  role_ids?: number[]
  skill_ids?: number[]
  ticket_scope?: 1 | 2 | 3
  focus_mode?: boolean
}

/**
 * Parameters for updating an agent
 */
export interface AgentUpdateParams {
  name?: string
  phone?: string
  mobile?: string
  job_title?: string
  occasional?: boolean
  signature?: string
  group_ids?: number[]
  role_ids?: number[]
  skill_ids?: number[]
  ticket_scope?: 1 | 2 | 3
  focus_mode?: boolean
}

/**
 * Parameters for listing agents
 */
export interface AgentListParams {
  email?: string
  mobile?: string
  phone?: string
  state?: 'fulltime' | 'occasional'
  per_page?: number
  page?: number
}

// =============================================================================
// Group Types
// =============================================================================

/**
 * Freshdesk Group object
 */
export interface Group {
  id: number
  name: string
  description: string | null
  escalate_to: number | null
  unassigned_for: string | null
  business_hour_id: number | null
  group_type: 'support_agent_group' | 'field_agent_group'
  agent_ids: number[]
  auto_ticket_assign: boolean
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a group
 */
export interface GroupCreateParams {
  name: string
  description?: string
  escalate_to?: number
  unassigned_for?: string
  business_hour_id?: number
  group_type?: 'support_agent_group' | 'field_agent_group'
  agent_ids?: number[]
  auto_ticket_assign?: boolean
}

/**
 * Parameters for updating a group
 */
export interface GroupUpdateParams {
  name?: string
  description?: string
  escalate_to?: number | null
  unassigned_for?: string | null
  business_hour_id?: number | null
  agent_ids?: number[]
  auto_ticket_assign?: boolean
}

// =============================================================================
// Canned Response (Macro) Types
// =============================================================================

/**
 * Freshdesk Canned Response object
 */
export interface CannedResponse {
  id: number
  title: string
  content: string
  content_html: string
  folder_id: number
  visibility: 0 | 1 | 2 | 3
  attachments: Attachment[]
  created_at: string
  updated_at: string
}

/**
 * Canned Response Folder object
 */
export interface CannedResponseFolder {
  id: number
  name: string
  responses_count: number
  created_at: string
  updated_at: string
}

// =============================================================================
// Automation Rule Types
// =============================================================================

/**
 * Freshdesk Automation Rule object
 */
export interface AutomationRule {
  id: number
  name: string
  description: string | null
  active: boolean
  position: number
  conditions: AutomationConditions
  actions: AutomationAction[]
  outdated: boolean
  created_at: string
  updated_at: string
}

/**
 * Automation conditions
 */
export interface AutomationConditions {
  properties: AutomationCondition[]
  events: AutomationCondition[]
}

/**
 * Single automation condition
 */
export interface AutomationCondition {
  field: string
  operator: string
  value: string | number | boolean | string[]
}

/**
 * Single automation action
 */
export interface AutomationAction {
  field: string
  value: string | number | boolean | string[]
}

// =============================================================================
// Solution (Knowledge Base) Types
// =============================================================================

/**
 * Solution Category object
 */
export interface SolutionCategory {
  id: number
  name: string
  description: string | null
  visible_in_portals: number[]
  folders_count: number
  created_at: string
  updated_at: string
}

/**
 * Solution Folder object
 */
export interface SolutionFolder {
  id: number
  category_id: number
  name: string
  description: string | null
  visibility: 1 | 2 | 3 | 4
  articles_count: number
  company_ids?: number[]
  contact_segment_ids?: number[]
  created_at: string
  updated_at: string
}

/**
 * Solution Article object
 */
export interface SolutionArticle {
  id: number
  folder_id: number
  category_id: number
  title: string
  description: string
  description_text: string
  type: 1 | 2
  status: 1 | 2
  seo_data: SeoData | null
  tags: string[]
  thumbs_up: number
  thumbs_down: number
  hits: number
  agent_id: number
  attachments: Attachment[]
  created_at: string
  updated_at: string
}

/**
 * SEO data for articles
 */
export interface SeoData {
  meta_title: string | null
  meta_description: string | null
}

/**
 * Parameters for creating a solution article
 */
export interface SolutionArticleCreateParams {
  title: string
  description: string
  folder_id: number
  type?: 1 | 2
  status?: 1 | 2
  tags?: string[]
  seo_data?: SeoData
  agent_id?: number
}

/**
 * Parameters for updating a solution article
 */
export interface SolutionArticleUpdateParams {
  title?: string
  description?: string
  type?: 1 | 2
  status?: 1 | 2
  tags?: string[]
  seo_data?: SeoData
  agent_id?: number
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Freshdesk Attachment object
 */
export interface Attachment {
  id: number
  name: string
  content_type: string
  size: number
  attachment_url: string
  thumb_url?: string
  created_at: string
  updated_at: string
}

/**
 * Parameters for uploading an attachment
 */
export interface AttachmentUploadParams {
  name: string
  content: Blob | Buffer | ArrayBuffer
  content_type?: string
}

// =============================================================================
// SLA Policy Types
// =============================================================================

/**
 * SLA Policy object
 */
export interface SLAPolicy {
  id: number
  name: string
  description: string | null
  position: number
  is_default: boolean
  active: boolean
  applicable_to: SLAApplicableTo
  sla_targets: SLATarget[]
  escalation: SLAEscalation | null
  created_at: string
  updated_at: string
}

/**
 * SLA applicability conditions
 */
export interface SLAApplicableTo {
  ticket_type: string[]
  product_id: number[]
  group_id: number[]
  source: number[]
  company_id: number[]
}

/**
 * SLA target times
 */
export interface SLATarget {
  priority: TicketPriority
  respond_within: number
  resolve_within: number
  business_hours: boolean
  escalation_enabled: boolean
}

/**
 * SLA escalation settings
 */
export interface SLAEscalation {
  response: SLAEscalationLevel[]
  resolution: SLAEscalationLevel[]
}

/**
 * SLA escalation level
 */
export interface SLAEscalationLevel {
  level: number
  notify_agent: boolean
  notify_group: boolean
  agent_ids: number[]
  group_ids: number[]
}

// =============================================================================
// Webhook/Automation Types
// =============================================================================

/**
 * Webhook object
 */
export interface Webhook {
  id: number
  name: string
  url: string
  authentication_method: 'none' | 'basic' | 'api_key' | 'bearer'
  request_type: 'GET' | 'POST' | 'PUT' | 'DELETE'
  content_type: 'application/json' | 'application/xml' | 'application/x-www-form-urlencoded'
  active: boolean
  created_at: string
  updated_at: string
}

// =============================================================================
// List Response Types
// =============================================================================

/**
 * Generic list response (Freshdesk returns arrays directly)
 */
export type ListResponse<T> = T[]

// =============================================================================
// Error Types
// =============================================================================

/**
 * Freshdesk API error detail
 */
export interface FreshdeskErrorDetail {
  field?: string
  message: string
  code: string
}

/**
 * Freshdesk API error response
 */
export interface FreshdeskErrorResponse {
  description: string
  errors: FreshdeskErrorDetail[]
}

// =============================================================================
// Client Configuration Types
// =============================================================================

/**
 * Fetch function type for custom fetch implementations
 */
export type FetchFunction = (
  url: string,
  options?: RequestInit
) => Promise<{
  ok: boolean
  status: number
  headers: Headers
  json: () => Promise<unknown>
}>

/**
 * Client configuration
 */
export interface ClientConfig {
  /** Freshdesk domain (e.g., 'mycompany' for mycompany.freshdesk.com) */
  domain: string
  /** API key for authentication */
  apiKey: string
  /** Custom fetch function for edge environments */
  fetch?: typeof fetch | FetchFunction
}

/**
 * Request options
 */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number
}
