/**
 * @dotdo/zendesk - Zendesk API Type Definitions
 *
 * Type definitions for Zendesk API compatibility layer.
 * Based on Zendesk Support API v2
 *
 * @module @dotdo/zendesk/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Custom fields stored on tickets
 */
export interface CustomField {
  id: number
  value: string | number | boolean | string[] | null
}

/**
 * Via object showing how a ticket/comment was created
 */
export interface Via {
  channel: string
  source: {
    from: Record<string, unknown>
    to: Record<string, unknown>
    rel: string | null
  }
}

/**
 * Satisfaction rating
 */
export interface SatisfactionRating {
  id: number
  score: 'offered' | 'unoffered' | 'good' | 'bad'
  comment?: string
  reason?: string
  created_at: string
  updated_at: string
}

/**
 * Thumbnail for attachments
 */
export interface Thumbnail {
  id: number
  file_name: string
  content_url: string
  content_type: string
  size: number
  width: number
  height: number
}

// =============================================================================
// Ticket Types
// =============================================================================

/**
 * Zendesk Ticket object
 */
export interface Ticket {
  id: number
  url: string
  external_id: string | null
  type: 'problem' | 'incident' | 'question' | 'task' | null
  subject: string
  raw_subject: string
  description: string
  priority: 'urgent' | 'high' | 'normal' | 'low' | null
  status: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed'
  recipient: string | null
  requester_id: number
  submitter_id: number
  assignee_id: number | null
  organization_id: number | null
  group_id: number | null
  collaborator_ids: number[]
  follower_ids: number[]
  email_cc_ids: number[]
  forum_topic_id: number | null
  problem_id: number | null
  has_incidents: boolean
  is_public: boolean
  due_at: string | null
  tags: string[]
  custom_fields: CustomField[]
  satisfaction_rating: SatisfactionRating | null
  sharing_agreement_ids: number[]
  fields: CustomField[]
  followup_ids: number[]
  brand_id: number | null
  allow_channelback: boolean
  allow_attachments: boolean
  created_at: string
  updated_at: string
  via?: Via
}

/**
 * Requester info when creating a ticket
 */
export interface TicketRequester {
  name?: string
  email?: string
  locale_id?: number
}

/**
 * Comment when creating/updating a ticket
 */
export interface TicketComment {
  body?: string
  html_body?: string
  public?: boolean
  author_id?: number
  uploads?: string[]
}

/**
 * Parameters for creating a ticket
 */
export interface TicketCreateParams {
  subject?: string
  description?: string
  comment?: TicketComment
  type?: 'problem' | 'incident' | 'question' | 'task'
  priority?: 'urgent' | 'high' | 'normal' | 'low'
  status?: 'new' | 'open' | 'pending' | 'hold' | 'solved'
  requester?: TicketRequester
  requester_id?: number
  submitter_id?: number
  assignee_id?: number
  organization_id?: number
  group_id?: number
  collaborator_ids?: number[]
  collaborators?: Array<string | number | { name?: string; email: string }>
  follower_ids?: number[]
  email_ccs?: Array<{ user_id: number; action: 'put' | 'delete' }>
  tags?: string[]
  external_id?: string
  problem_id?: number
  due_at?: string
  custom_fields?: CustomField[]
  brand_id?: number
}

/**
 * Parameters for updating a ticket
 */
export interface TicketUpdateParams {
  subject?: string
  comment?: TicketComment
  type?: 'problem' | 'incident' | 'question' | 'task'
  priority?: 'urgent' | 'high' | 'normal' | 'low'
  status?: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed'
  requester_id?: number
  assignee_id?: number | null
  organization_id?: number | null
  group_id?: number | null
  collaborator_ids?: number[]
  collaborators?: Array<string | number | { name?: string; email: string }>
  follower_ids?: number[]
  email_ccs?: Array<{ user_id: number; action: 'put' | 'delete' }>
  tags?: string[]
  external_id?: string
  problem_id?: number | null
  due_at?: string | null
  custom_fields?: CustomField[]
  additional_tags?: string[]
  remove_tags?: string[]
  safe_update?: boolean
  updated_stamp?: string
}

/**
 * Parameters for listing tickets
 */
export interface TicketListParams {
  external_id?: string
  sort_by?: 'assignee' | 'assignee.name' | 'created_at' | 'group' | 'id' | 'locale' | 'requester' | 'requester.name' | 'status' | 'subject' | 'updated_at'
  sort_order?: 'asc' | 'desc'
  per_page?: number
  page?: number
  status?: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed'
}

/**
 * Tickets list response
 */
export interface TicketListResponse {
  tickets: Ticket[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Search results response
 */
export interface SearchResponse<T = Ticket> {
  results: T[]
  count: number
  next_page: string | null
  previous_page: string | null
  facets: Record<string, unknown> | null
}

// =============================================================================
// User Types
// =============================================================================

/**
 * Photo/avatar for user
 */
export interface UserPhoto {
  id: number
  file_name: string
  content_url: string
  content_type: string
  size: number
  thumbnails?: Thumbnail[]
}

/**
 * Zendesk User object
 */
export interface User {
  id: number
  url: string
  name: string
  email: string
  created_at: string
  updated_at: string
  time_zone: string
  iana_time_zone: string
  phone: string | null
  shared_phone_number: boolean | null
  photo: UserPhoto | null
  locale_id: number
  locale: string
  organization_id: number | null
  role: 'end-user' | 'agent' | 'admin'
  verified: boolean
  external_id: string | null
  tags: string[]
  alias: string | null
  active: boolean
  shared: boolean
  shared_agent: boolean
  last_login_at: string | null
  two_factor_auth_enabled: boolean | null
  signature: string | null
  details: string | null
  notes: string | null
  role_type: number | null
  custom_role_id: number | null
  moderator: boolean
  ticket_restriction: 'organization' | 'groups' | 'assigned' | 'requested' | null
  only_private_comments: boolean
  restricted_agent: boolean
  suspended: boolean
  default_group_id: number | null
  report_csv: boolean
  user_fields: Record<string, unknown>
}

/**
 * Parameters for creating a user
 */
export interface UserCreateParams {
  name: string
  email: string
  role?: 'end-user' | 'agent' | 'admin'
  verified?: boolean
  external_id?: string
  tags?: string[]
  alias?: string
  details?: string
  notes?: string
  phone?: string
  time_zone?: string
  locale?: string
  locale_id?: number
  organization_id?: number
  custom_role_id?: number
  moderator?: boolean
  ticket_restriction?: 'organization' | 'groups' | 'assigned' | 'requested'
  only_private_comments?: boolean
  restricted_agent?: boolean
  signature?: string
  default_group_id?: number
  user_fields?: Record<string, unknown>
}

/**
 * Parameters for updating a user
 */
export interface UserUpdateParams {
  name?: string
  email?: string
  role?: 'end-user' | 'agent' | 'admin'
  verified?: boolean
  external_id?: string
  tags?: string[]
  alias?: string
  details?: string
  notes?: string
  phone?: string
  time_zone?: string
  locale?: string
  locale_id?: number
  organization_id?: number | null
  custom_role_id?: number | null
  moderator?: boolean
  ticket_restriction?: 'organization' | 'groups' | 'assigned' | 'requested' | null
  only_private_comments?: boolean
  restricted_agent?: boolean
  signature?: string
  suspended?: boolean
  default_group_id?: number | null
  user_fields?: Record<string, unknown>
}

/**
 * Parameters for searching users
 */
export interface UserSearchParams {
  query?: string
  external_id?: string
  per_page?: number
  page?: number
}

/**
 * Parameters for listing users
 */
export interface UserListParams {
  role?: 'end-user' | 'agent' | 'admin' | 'end-user,agent' | 'end-user,admin' | 'agent,admin'
  permission_set?: number
  external_id?: string
  per_page?: number
  page?: number
}

/**
 * Users list response
 */
export interface UserListResponse {
  users: User[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Organization Types
// =============================================================================

/**
 * Zendesk Organization object
 */
export interface Organization {
  id: number
  url: string
  name: string
  shared_tickets: boolean
  shared_comments: boolean
  external_id: string | null
  created_at: string
  updated_at: string
  domain_names: string[]
  details: string | null
  notes: string | null
  group_id: number | null
  tags: string[]
  organization_fields: Record<string, unknown>
}

/**
 * Parameters for creating an organization
 */
export interface OrganizationCreateParams {
  name: string
  external_id?: string
  domain_names?: string[]
  details?: string
  notes?: string
  group_id?: number
  shared_tickets?: boolean
  shared_comments?: boolean
  tags?: string[]
  organization_fields?: Record<string, unknown>
}

/**
 * Parameters for updating an organization
 */
export interface OrganizationUpdateParams {
  name?: string
  external_id?: string
  domain_names?: string[]
  details?: string
  notes?: string
  group_id?: number | null
  shared_tickets?: boolean
  shared_comments?: boolean
  tags?: string[]
  organization_fields?: Record<string, unknown>
}

/**
 * Parameters for listing organizations
 */
export interface OrganizationListParams {
  per_page?: number
  page?: number
}

/**
 * Organizations list response
 */
export interface OrganizationListResponse {
  organizations: Organization[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Comment Types
// =============================================================================

/**
 * Zendesk Comment object
 */
export interface Comment {
  id: number
  type: 'Comment' | 'VoiceComment'
  body: string
  html_body: string
  plain_body: string
  public: boolean
  author_id: number
  attachments: Attachment[]
  audit_id: number
  via: Via
  created_at: string
  metadata?: Record<string, unknown>
}

/**
 * Parameters for creating a comment
 */
export interface CommentCreateParams {
  body: string
  html_body?: string
  public?: boolean
  author_id?: number
  uploads?: string[]
}

/**
 * Parameters for listing comments
 */
export interface CommentListParams {
  sort_order?: 'asc' | 'desc'
  include_inline_images?: boolean
  per_page?: number
  page?: number
}

/**
 * Comments list response
 */
export interface CommentListResponse {
  comments: Comment[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Zendesk Attachment object
 */
export interface Attachment {
  id: number
  url: string
  file_name: string
  content_url: string
  content_type: string
  size: number
  thumbnails: Thumbnail[]
  inline: boolean
  deleted?: boolean
  malware_access_override?: boolean
  malware_scan_result?: 'malware_found' | 'malware_not_found' | 'failed_to_scan' | 'not_scanned'
}

/**
 * Parameters for uploading an attachment
 */
export interface AttachmentUploadParams {
  filename: string
  contentType: string
  data: Uint8Array | ArrayBuffer | string
  token?: string
}

/**
 * Upload response
 */
export interface UploadResponse {
  token: string
  attachment: Attachment
  attachments?: Attachment[]
}

// =============================================================================
// Trigger Types
// =============================================================================

/**
 * Trigger condition
 */
export interface TriggerCondition {
  field: string
  operator: string
  value: string | number | boolean | string[] | null
}

/**
 * Trigger conditions
 */
export interface TriggerConditions {
  all: TriggerCondition[]
  any: TriggerCondition[]
}

/**
 * Trigger action
 */
export interface TriggerAction {
  field: string
  value: string | string[] | number | boolean | null
}

/**
 * Zendesk Trigger object
 */
export interface Trigger {
  id: number
  url: string
  title: string
  active: boolean
  position: number
  conditions: TriggerConditions
  actions: TriggerAction[]
  description: string | null
  created_at: string
  updated_at: string
  category_id?: string | null
  default?: boolean
  raw_title?: string
}

/**
 * Parameters for creating a trigger
 */
export interface TriggerCreateParams {
  title: string
  conditions: TriggerConditions
  actions: TriggerAction[]
  active?: boolean
  position?: number
  description?: string
  category_id?: string
}

/**
 * Parameters for updating a trigger
 */
export interface TriggerUpdateParams {
  title?: string
  conditions?: TriggerConditions
  actions?: TriggerAction[]
  active?: boolean
  position?: number
  description?: string
  category_id?: string
}

/**
 * Parameters for listing triggers
 */
export interface TriggerListParams {
  active?: boolean
  sort_by?: 'position' | 'created_at' | 'updated_at' | 'alphabetical'
  sort_order?: 'asc' | 'desc'
  category_id?: string
  per_page?: number
  page?: number
}

/**
 * Triggers list response
 */
export interface TriggerListResponse {
  triggers: Trigger[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Automation Types
// =============================================================================

/**
 * Zendesk Automation object
 */
export interface Automation {
  id: number
  url: string
  title: string
  active: boolean
  position: number
  conditions: TriggerConditions
  actions: TriggerAction[]
  created_at: string
  updated_at: string
  default?: boolean
  raw_title?: string
}

/**
 * Parameters for creating an automation
 */
export interface AutomationCreateParams {
  title: string
  conditions: TriggerConditions
  actions: TriggerAction[]
  active?: boolean
  position?: number
}

/**
 * Parameters for updating an automation
 */
export interface AutomationUpdateParams {
  title?: string
  conditions?: TriggerConditions
  actions?: TriggerAction[]
  active?: boolean
  position?: number
}

/**
 * Parameters for listing automations
 */
export interface AutomationListParams {
  active?: boolean
  sort_by?: 'position' | 'created_at' | 'updated_at' | 'alphabetical'
  sort_order?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

/**
 * Automations list response
 */
export interface AutomationListResponse {
  automations: Automation[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Custom Field Types
// =============================================================================

/**
 * Custom field definition
 */
export interface TicketField {
  id: number
  url: string
  type: 'text' | 'textarea' | 'checkbox' | 'date' | 'integer' | 'decimal' | 'regexp' | 'tagger' | 'multiselect' | 'lookup'
  title: string
  raw_title: string
  description: string | null
  raw_description: string | null
  position: number
  active: boolean
  required: boolean
  collapsed_for_agents: boolean
  regexp_for_validation: string | null
  title_in_portal: string
  raw_title_in_portal: string
  visible_in_portal: boolean
  editable_in_portal: boolean
  required_in_portal: boolean
  tag: string | null
  created_at: string
  updated_at: string
  removable: boolean
  agent_description: string | null
  custom_field_options?: TicketFieldOption[]
  custom_statuses?: number[]
  sub_type_id?: number
  relationship_filter?: Record<string, unknown>
  relationship_target_type?: string
}

/**
 * Custom field option for dropdown/tagger fields
 */
export interface TicketFieldOption {
  id: number
  name: string
  raw_name: string
  value: string
  default?: boolean
  position?: number
}

/**
 * Parameters for creating a ticket field
 */
export interface TicketFieldCreateParams {
  type: 'text' | 'textarea' | 'checkbox' | 'date' | 'integer' | 'decimal' | 'regexp' | 'tagger' | 'multiselect' | 'lookup'
  title: string
  description?: string
  position?: number
  active?: boolean
  required?: boolean
  collapsed_for_agents?: boolean
  regexp_for_validation?: string
  title_in_portal?: string
  visible_in_portal?: boolean
  editable_in_portal?: boolean
  required_in_portal?: boolean
  tag?: string
  custom_field_options?: Array<{ name: string; value: string }>
  agent_description?: string
  relationship_target_type?: string
}

/**
 * Parameters for updating a ticket field
 */
export interface TicketFieldUpdateParams {
  title?: string
  description?: string
  position?: number
  active?: boolean
  required?: boolean
  collapsed_for_agents?: boolean
  regexp_for_validation?: string
  title_in_portal?: string
  visible_in_portal?: boolean
  editable_in_portal?: boolean
  required_in_portal?: boolean
  tag?: string
  custom_field_options?: Array<{ id?: number; name: string; value: string }>
  agent_description?: string
}

/**
 * Parameters for listing ticket fields
 */
export interface TicketFieldListParams {
  locale?: string
}

/**
 * Ticket fields list response
 */
export interface TicketFieldListResponse {
  ticket_fields: TicketField[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Ticket Form Types
// =============================================================================

/**
 * Ticket form object
 */
export interface TicketForm {
  id: number
  url: string
  name: string
  raw_name: string
  display_name: string
  raw_display_name: string
  end_user_visible: boolean
  position: number
  ticket_field_ids: number[]
  active: boolean
  default: boolean
  created_at: string
  updated_at: string
  in_all_brands: boolean
  restricted_brand_ids: number[]
  agent_conditions: TicketFormCondition[]
  end_user_conditions: TicketFormCondition[]
}

/**
 * Ticket form condition
 */
export interface TicketFormCondition {
  parent_field_id: number
  value: string
  child_fields: Array<{
    id: number
    is_required: boolean
  }>
}

/**
 * Parameters for creating a ticket form
 */
export interface TicketFormCreateParams {
  name: string
  end_user_visible?: boolean
  position?: number
  ticket_field_ids?: number[]
  active?: boolean
  default?: boolean
  in_all_brands?: boolean
  restricted_brand_ids?: number[]
  agent_conditions?: TicketFormCondition[]
  end_user_conditions?: TicketFormCondition[]
}

/**
 * Parameters for updating a ticket form
 */
export interface TicketFormUpdateParams {
  name?: string
  end_user_visible?: boolean
  position?: number
  ticket_field_ids?: number[]
  active?: boolean
  default?: boolean
  in_all_brands?: boolean
  restricted_brand_ids?: number[]
  agent_conditions?: TicketFormCondition[]
  end_user_conditions?: TicketFormCondition[]
}

/**
 * Ticket forms list response
 */
export interface TicketFormListResponse {
  ticket_forms: TicketForm[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// View Types
// =============================================================================

/**
 * View object
 */
export interface View {
  id: number
  url: string
  title: string
  active: boolean
  position: number
  created_at: string
  updated_at: string
  restriction: ViewRestriction | null
  execution: ViewExecution
  conditions: ViewConditions
  output: ViewOutput
  default?: boolean
  raw_title?: string
}

/**
 * View restriction (who can access)
 */
export interface ViewRestriction {
  type: 'Group' | 'User'
  id: number
  ids?: number[]
}

/**
 * View execution settings
 */
export interface ViewExecution {
  group_by: string | null
  group_order: 'asc' | 'desc'
  sort_by: string
  sort_order: 'asc' | 'desc'
  group?: {
    id: string
    title: string
    order: 'asc' | 'desc'
  }
  sort?: {
    id: string
    title: string
    order: 'asc' | 'desc'
  }
  columns?: ViewColumn[]
}

/**
 * View column
 */
export interface ViewColumn {
  id: string
  title: string
  type?: string
  filterable?: boolean
  sortable?: boolean
}

/**
 * View conditions
 */
export interface ViewConditions {
  all: ViewCondition[]
  any: ViewCondition[]
}

/**
 * View condition
 */
export interface ViewCondition {
  field: string
  operator: string
  value: string | string[] | number | boolean | null
}

/**
 * View output settings
 */
export interface ViewOutput {
  columns: string[]
  group_by: string | null
  group_order: 'asc' | 'desc'
  sort_by: string
  sort_order: 'asc' | 'desc'
}

/**
 * Parameters for creating a view
 */
export interface ViewCreateParams {
  title: string
  active?: boolean
  restriction?: ViewRestriction
  conditions: ViewConditions
  output?: Partial<ViewOutput>
}

/**
 * Parameters for updating a view
 */
export interface ViewUpdateParams {
  title?: string
  active?: boolean
  restriction?: ViewRestriction | null
  conditions?: ViewConditions
  output?: Partial<ViewOutput>
}

/**
 * Parameters for listing views
 */
export interface ViewListParams {
  active?: boolean
  group_id?: number
  sort_by?: 'alphabetical' | 'created_at' | 'updated_at' | 'position'
  sort_order?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

/**
 * Views list response
 */
export interface ViewListResponse {
  views: View[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * View count response
 */
export interface ViewCountResponse {
  view_count: {
    view_id: number
    url: string
    value: number
    pretty: string
    fresh: boolean
  }
}

/**
 * View tickets response
 */
export interface ViewTicketsResponse {
  tickets: Ticket[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Macro Types
// =============================================================================

/**
 * Macro object
 */
export interface Macro {
  id: number
  url: string
  title: string
  active: boolean
  position: number
  created_at: string
  updated_at: string
  description: string | null
  actions: MacroAction[]
  restriction: MacroRestriction | null
  default?: boolean
  raw_title?: string
}

/**
 * Macro action
 */
export interface MacroAction {
  field: string
  value: string | string[] | number | boolean | null
}

/**
 * Macro restriction
 */
export interface MacroRestriction {
  type: 'Group' | 'User'
  id: number
  ids?: number[]
}

/**
 * Parameters for creating a macro
 */
export interface MacroCreateParams {
  title: string
  actions: MacroAction[]
  active?: boolean
  description?: string
  restriction?: MacroRestriction
}

/**
 * Parameters for updating a macro
 */
export interface MacroUpdateParams {
  title?: string
  actions?: MacroAction[]
  active?: boolean
  description?: string
  restriction?: MacroRestriction | null
}

/**
 * Parameters for listing macros
 */
export interface MacroListParams {
  active?: boolean
  category?: number
  group_id?: number
  only_viewable?: boolean
  sort_by?: 'alphabetical' | 'created_at' | 'updated_at' | 'position' | 'usage_1h' | 'usage_24h' | 'usage_7d' | 'usage_30d'
  sort_order?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

/**
 * Macros list response
 */
export interface MacroListResponse {
  macros: Macro[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Macro apply result
 */
export interface MacroApplyResult {
  result: {
    ticket: Partial<Ticket>
    comment?: {
      body: string
      html_body: string
      scoped_body?: Array<{ scope: string; body: string }>
      public: boolean
    }
  }
}

// =============================================================================
// Group Types
// =============================================================================

/**
 * Group object
 */
export interface Group {
  id: number
  url: string
  name: string
  description: string | null
  default: boolean
  deleted: boolean
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a group
 */
export interface GroupCreateParams {
  name: string
  description?: string
}

/**
 * Parameters for updating a group
 */
export interface GroupUpdateParams {
  name?: string
  description?: string
}

/**
 * Groups list response
 */
export interface GroupListResponse {
  groups: Group[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Group membership
 */
export interface GroupMembership {
  id: number
  url: string
  user_id: number
  group_id: number
  default: boolean
  created_at: string
  updated_at: string
}

/**
 * Group memberships list response
 */
export interface GroupMembershipListResponse {
  group_memberships: GroupMembership[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Webhook/Target Types
// =============================================================================

/**
 * Webhook object
 */
export interface Webhook {
  id: string
  name: string
  status: 'active' | 'inactive'
  endpoint: string
  http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  request_format: 'json' | 'xml' | 'form_encoded'
  subscriptions: string[]
  signing_secret?: {
    algorithm: string
    secret: string
  }
  authentication?: WebhookAuthentication
  custom_headers?: Record<string, string>
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

/**
 * Webhook authentication
 */
export interface WebhookAuthentication {
  type: 'basic_auth' | 'bearer_token' | 'api_key'
  data: {
    username?: string
    password?: string
    token?: string
    name?: string
    value?: string
    add_position?: 'header' | 'query_string'
  }
}

/**
 * Parameters for creating a webhook
 */
export interface WebhookCreateParams {
  name: string
  endpoint: string
  http_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  request_format?: 'json' | 'xml' | 'form_encoded'
  status?: 'active' | 'inactive'
  subscriptions?: string[]
  authentication?: WebhookAuthentication
  custom_headers?: Record<string, string>
}

/**
 * Parameters for updating a webhook
 */
export interface WebhookUpdateParams {
  name?: string
  endpoint?: string
  http_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  request_format?: 'json' | 'xml' | 'form_encoded'
  status?: 'active' | 'inactive'
  subscriptions?: string[]
  authentication?: WebhookAuthentication
  custom_headers?: Record<string, string>
}

/**
 * Webhooks list response
 */
export interface WebhookListResponse {
  webhooks: Webhook[]
  meta: {
    has_more: boolean
    after_cursor: string | null
    before_cursor: string | null
  }
  links: {
    prev: string | null
    next: string | null
  }
}

/**
 * Legacy Target object (being replaced by Webhooks)
 */
export interface Target {
  id: number
  url: string
  title: string
  type: string
  active: boolean
  created_at: string
  target_url?: string
  method?: string
  content_type?: string
  username?: string
  password?: string
}

/**
 * Parameters for creating a target
 */
export interface TargetCreateParams {
  title: string
  type: 'url_target' | 'email_target' | 'http_target'
  target_url?: string
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete'
  content_type?: string
  username?: string
  password?: string
  email?: string
  subject?: string
}

/**
 * Parameters for updating a target
 */
export interface TargetUpdateParams {
  title?: string
  active?: boolean
  target_url?: string
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete'
  content_type?: string
  username?: string
  password?: string
}

/**
 * Targets list response
 */
export interface TargetListResponse {
  targets: Target[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Brand Types
// =============================================================================

/**
 * Brand object
 */
export interface Brand {
  id: number
  url: string
  name: string
  brand_url: string
  subdomain: string
  host_mapping: string | null
  has_help_center: boolean
  help_center_state: 'enabled' | 'disabled' | 'restricted'
  active: boolean
  default: boolean
  is_deleted: boolean
  logo: Attachment | null
  ticket_form_ids: number[]
  signature_template: string
  created_at: string
  updated_at: string
}

/**
 * Brands list response
 */
export interface BrandListResponse {
  brands: Brand[]
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// SLA Policy Types
// =============================================================================

/**
 * SLA Policy object
 */
export interface SLAPolicy {
  id: number
  url: string
  title: string
  description: string | null
  position: number
  filter: {
    all: SLAPolicyCondition[]
    any: SLAPolicyCondition[]
  }
  policy_metrics: SLAPolicyMetric[]
  created_at: string
  updated_at: string
}

/**
 * SLA policy condition
 */
export interface SLAPolicyCondition {
  field: string
  operator: string
  value: string | string[] | number | null
}

/**
 * SLA policy metric
 */
export interface SLAPolicyMetric {
  priority: 'low' | 'normal' | 'high' | 'urgent'
  metric: 'first_reply_time' | 'next_reply_time' | 'periodic_update_time' | 'requester_wait_time' | 'agent_work_time' | 'pausable_update_time'
  target: number
  business_hours: boolean
}

/**
 * SLA policies list response
 */
export interface SLAPolicyListResponse {
  sla_policies: SLAPolicy[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Parameters for creating an SLA policy
 */
export interface SLAPolicyCreateParams {
  title: string
  description?: string
  position?: number
  filter: {
    all: SLAPolicyCondition[]
    any: SLAPolicyCondition[]
  }
  policy_metrics: SLAPolicyMetric[]
}

/**
 * Parameters for updating an SLA policy
 */
export interface SLAPolicyUpdateParams {
  title?: string
  description?: string
  position?: number
  filter?: {
    all: SLAPolicyCondition[]
    any: SLAPolicyCondition[]
  }
  policy_metrics?: SLAPolicyMetric[]
}

/**
 * SLA status for a ticket
 */
export interface SLAStatus {
  policy_id: number
  policy_title: string
  metrics: SLATicketMetric[]
}

/**
 * SLA metric status on a ticket
 */
export interface SLATicketMetric {
  metric: SLAPolicyMetric['metric']
  target: number
  breached_at: string | null
  fulfilled_at: string | null
  status: 'active' | 'fulfilled' | 'breached'
  stage: 'pending' | 'in_progress' | 'completed'
  remaining_minutes?: number
}

/**
 * SLA breach record
 */
export interface SLABreach {
  ticket_id: number
  policy_id: number
  metric: SLAPolicyMetric['metric']
  breached_at: string
  target_minutes: number
  actual_minutes: number
}

/**
 * SLA breaches list response
 */
export interface SLABreachesResponse {
  breaches: SLABreach[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Parameters for filtering SLA breaches
 */
export interface SLABreachesParams {
  metric?: SLAPolicyMetric['metric']
  per_page?: number
  page?: number
}

/**
 * SLA at-risk ticket record
 */
export interface SLAAtRisk {
  ticket_id: number
  policy_id: number
  metric: SLAPolicyMetric['metric']
  deadline: string
  remaining_minutes: number
  risk_level: 'low' | 'medium' | 'high'
}

/**
 * SLA at-risk tickets list response
 */
export interface SLAAtRiskResponse {
  at_risk: SLAAtRisk[]
  count: number
  next_page: string | null
  previous_page: string | null
}

/**
 * Parameters for filtering at-risk tickets
 */
export interface SLAAtRiskParams {
  threshold_minutes?: number
  per_page?: number
  page?: number
}

// =============================================================================
// Generic List Response
// =============================================================================

/**
 * Generic list response
 */
export interface ListResponse<T> {
  count: number
  next_page: string | null
  previous_page: string | null
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Zendesk error detail
 */
export interface ZendeskErrorDetail {
  error: string
  description?: string
  message?: string
  details?: Record<string, Array<{ description: string; error: string }>>
}

/**
 * Zendesk error response
 */
export interface ZendeskErrorResponse {
  error: string
  description?: string
  message?: string
  details?: Record<string, unknown>
}

// =============================================================================
// Client Configuration Types
// =============================================================================

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
  subdomain: string
  email?: string
  token?: string
  password?: string
  oauthToken?: string
  fetch?: typeof fetch | FetchFunction
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  idempotencyKey?: string
}
