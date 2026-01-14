/**
 * @dotdo/support - Unified Customer Support Abstractions
 *
 * Common interfaces for support compatibility layers (Zendesk, Intercom, Freshdesk, Help Scout).
 * Provides a unified API for tickets, conversations, agents, customers, and SLA management.
 *
 * This module enables:
 * - Multi-provider routing for failover and load balancing
 * - Unified ticket interface across all support platforms
 * - SLA tracking with breach detection and alerts
 * - Customer context aggregation across providers
 *
 * @module @dotdo/support
 */

// =============================================================================
// Base Entity Types
// =============================================================================

/**
 * Base support entity with common fields
 */
export interface SupportEntity {
  id: string
  createdAt: string
  updatedAt: string
  provider: SupportProvider
  externalId?: string
  customFields?: Record<string, unknown>
}

/**
 * Supported provider identifiers
 */
export type SupportProvider = 'zendesk' | 'intercom' | 'freshdesk' | 'helpscout'

// =============================================================================
// Ticket Types
// =============================================================================

/**
 * Unified ticket status across all platforms
 *
 * Maps to:
 * - Zendesk: new | open | pending | hold | solved | closed
 * - Intercom: open | closed | snoozed (via conversation state)
 * - Freshdesk: 2 (Open) | 3 (Pending) | 4 (Resolved) | 5 (Closed) | 6 (Waiting on Customer) | 7 (Waiting on Third Party)
 * - Help Scout: active | pending | closed | spam
 */
export type TicketStatus =
  | 'new'
  | 'open'
  | 'pending'
  | 'waiting_customer'
  | 'waiting_third_party'
  | 'on_hold'
  | 'resolved'
  | 'closed'
  | 'spam'

/**
 * Unified ticket priority
 *
 * Maps to:
 * - Zendesk: urgent | high | normal | low
 * - Intercom: priority | not_priority
 * - Freshdesk: 1 (Low) | 2 (Medium) | 3 (High) | 4 (Urgent)
 * - Help Scout: (no native priority - uses tags)
 */
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Unified ticket type
 */
export type TicketType = 'question' | 'incident' | 'problem' | 'task' | 'feature_request'

/**
 * Channel through which ticket was created
 */
export type TicketChannel =
  | 'email'
  | 'web'
  | 'phone'
  | 'chat'
  | 'social'
  | 'api'
  | 'mobile'
  | 'messenger'
  | 'sms'

/**
 * Unified ticket interface across all support platforms
 *
 * Maps to:
 * - Zendesk: Ticket
 * - Intercom: Conversation
 * - Freshdesk: Ticket
 * - Help Scout: Conversation
 */
export interface Ticket extends SupportEntity {
  /** Ticket number for customer reference */
  number?: number
  /** Short subject/title */
  subject: string
  /** Initial message/description */
  description: string
  /** Plain text version of description */
  descriptionText?: string
  /** Current status */
  status: TicketStatus
  /** Priority level */
  priority: TicketPriority
  /** Ticket type classification */
  type?: TicketType
  /** Channel the ticket came through */
  channel: TicketChannel
  /** Customer who submitted the ticket */
  customerId: string
  /** Customer email for quick reference */
  customerEmail?: string
  /** Customer name for quick reference */
  customerName?: string
  /** Assigned agent */
  assigneeId?: string
  /** Assigned team/group */
  groupId?: string
  /** Associated organization/company */
  organizationId?: string
  /** Tags for categorization */
  tags: string[]
  /** CC'd email addresses */
  ccEmails: string[]
  /** Whether ticket is public or internal */
  isPublic: boolean
  /** Due date for resolution */
  dueAt?: string
  /** SLA breach time for first response */
  firstResponseDueAt?: string
  /** SLA breach time for resolution */
  resolutionDueAt?: string
  /** Time of first agent response */
  firstResponseAt?: string
  /** Time ticket was resolved */
  resolvedAt?: string
  /** Time ticket was closed */
  closedAt?: string
  /** Thread/comment count */
  threadCount: number
  /** Number of times reopened */
  reopenCount: number
  /** Current SLA status */
  slaStatus?: SLATicketStatus
  /** Satisfaction rating if provided */
  satisfaction?: SatisfactionRating
  /** Attachments on the ticket */
  attachments: Attachment[]
  /** Linked tickets (related, child, etc.) */
  linkedTicketIds?: string[]
}

/**
 * Parameters for creating a ticket
 */
export interface TicketCreateInput {
  subject: string
  description: string
  status?: TicketStatus
  priority?: TicketPriority
  type?: TicketType
  channel?: TicketChannel
  customerId?: string
  customerEmail?: string
  customerName?: string
  assigneeId?: string
  groupId?: string
  organizationId?: string
  tags?: string[]
  ccEmails?: string[]
  isPublic?: boolean
  dueAt?: string
  customFields?: Record<string, unknown>
  attachments?: AttachmentInput[]
}

/**
 * Parameters for updating a ticket
 */
export interface TicketUpdateInput {
  subject?: string
  status?: TicketStatus
  priority?: TicketPriority
  type?: TicketType
  assigneeId?: string | null
  groupId?: string | null
  organizationId?: string | null
  tags?: string[]
  ccEmails?: string[]
  dueAt?: string | null
  customFields?: Record<string, unknown>
}

/**
 * Parameters for listing tickets
 */
export interface TicketListOptions {
  status?: TicketStatus | TicketStatus[]
  priority?: TicketPriority | TicketPriority[]
  assigneeId?: string
  groupId?: string
  customerId?: string
  organizationId?: string
  tags?: string[]
  channel?: TicketChannel
  createdAfter?: string
  createdBefore?: string
  updatedAfter?: string
  sortBy?: 'created_at' | 'updated_at' | 'priority' | 'status' | 'due_at'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

/**
 * Parameters for searching tickets
 */
export interface TicketSearchOptions extends TicketListOptions {
  query: string
}

// =============================================================================
// Thread/Message Types
// =============================================================================

/**
 * Type of thread/message
 */
export type ThreadType =
  | 'message'      // Customer message
  | 'reply'        // Agent reply
  | 'note'         // Internal note
  | 'system'       // System generated
  | 'assignment'   // Assignment change
  | 'status_change'// Status change

/**
 * A thread/message within a ticket
 */
export interface Thread extends SupportEntity {
  ticketId: string
  type: ThreadType
  body: string
  bodyText?: string
  /** Author of this thread */
  authorId: string
  /** Author type */
  authorType: 'customer' | 'agent' | 'system' | 'bot'
  /** Author name for display */
  authorName?: string
  /** Author email */
  authorEmail?: string
  /** Whether visible to customer */
  isPublic: boolean
  /** Incoming (from customer) vs outgoing (to customer) */
  direction: 'incoming' | 'outgoing' | 'internal'
  /** Attachments on this thread */
  attachments: Attachment[]
  /** Email recipients (to, cc, bcc) */
  recipients?: {
    to?: string[]
    cc?: string[]
    bcc?: string[]
  }
}

/**
 * Parameters for creating a thread (reply/note)
 */
export interface ThreadCreateInput {
  ticketId: string
  type: 'reply' | 'note'
  body: string
  authorId?: string
  isPublic?: boolean
  attachments?: AttachmentInput[]
  recipients?: {
    to?: string[]
    cc?: string[]
    bcc?: string[]
  }
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Unified customer interface for support platforms
 *
 * Maps to:
 * - Zendesk: User (end-user role)
 * - Intercom: Contact
 * - Freshdesk: Contact
 * - Help Scout: Customer
 */
export interface Customer extends SupportEntity {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  photoUrl?: string
  organizationId?: string
  organizationName?: string
  /** Customer timezone */
  timezone?: string
  /** Customer locale/language */
  locale?: string
  /** Customer location */
  location?: CustomerLocation
  /** Social profiles */
  socialProfiles?: SocialProfile[]
  /** Tags for segmentation */
  tags: string[]
  /** Whether verified */
  isVerified: boolean
  /** Whether unsubscribed from emails */
  isUnsubscribed: boolean
  /** Last time customer was seen/active */
  lastSeenAt?: string
  /** Number of open tickets */
  openTicketCount?: number
  /** Lifetime ticket count */
  totalTicketCount?: number
  /** Notes about this customer */
  notes?: string
}

/**
 * Customer location information
 */
export interface CustomerLocation {
  city?: string
  region?: string
  country?: string
  countryCode?: string
  timezone?: string
}

/**
 * Social profile reference
 */
export interface SocialProfile {
  type: 'twitter' | 'facebook' | 'linkedin' | 'instagram' | 'other'
  id?: string
  url?: string
  username?: string
}

/**
 * Parameters for creating a customer
 */
export interface CustomerCreateInput {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  photoUrl?: string
  organizationId?: string
  timezone?: string
  locale?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

/**
 * Parameters for updating a customer
 */
export interface CustomerUpdateInput {
  email?: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  photoUrl?: string
  organizationId?: string | null
  timezone?: string
  locale?: string
  tags?: string[]
  customFields?: Record<string, unknown>
}

/**
 * Parameters for listing customers
 */
export interface CustomerListOptions {
  email?: string
  organizationId?: string
  tags?: string[]
  updatedAfter?: string
  sortBy?: 'created_at' | 'updated_at' | 'name' | 'email'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Agent role in the support system
 */
export type AgentRole = 'agent' | 'admin' | 'owner' | 'limited'

/**
 * Unified agent interface
 */
export interface Agent extends SupportEntity {
  email: string
  name: string
  firstName?: string
  lastName?: string
  role: AgentRole
  photoUrl?: string
  /** Teams/groups the agent belongs to */
  groupIds: string[]
  /** Whether agent is active */
  isActive: boolean
  /** Whether agent is available for assignment */
  isAvailable: boolean
  /** Agent's timezone */
  timezone?: string
  /** Agent's signature for replies */
  signature?: string
  /** Skills/specializations */
  skills?: string[]
}

/**
 * Parameters for listing agents
 */
export interface AgentListOptions {
  groupId?: string
  role?: AgentRole
  isActive?: boolean
  limit?: number
  cursor?: string
}

// =============================================================================
// Organization Types
// =============================================================================

/**
 * Unified organization/company interface
 */
export interface Organization extends SupportEntity {
  name: string
  domains: string[]
  description?: string
  notes?: string
  /** Whether all org members can see each other's tickets */
  sharedTickets?: boolean
  tags: string[]
  /** Number of customers in org */
  customerCount?: number
  /** Number of open tickets */
  openTicketCount?: number
}

/**
 * Parameters for creating an organization
 */
export interface OrganizationCreateInput {
  name: string
  domains?: string[]
  description?: string
  notes?: string
  sharedTickets?: boolean
  tags?: string[]
  customFields?: Record<string, unknown>
}

/**
 * Parameters for updating an organization
 */
export interface OrganizationUpdateInput {
  name?: string
  domains?: string[]
  description?: string
  notes?: string
  sharedTickets?: boolean
  tags?: string[]
  customFields?: Record<string, unknown>
}

// =============================================================================
// Group/Team Types
// =============================================================================

/**
 * Unified group/team interface
 */
export interface Group extends SupportEntity {
  name: string
  description?: string
  /** Agent IDs in this group */
  agentIds: string[]
  /** Whether this is the default group */
  isDefault: boolean
  /** Business hours for this group */
  businessHoursId?: string
  /** Auto-assignment settings */
  autoAssign?: boolean
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Attachment on a ticket or thread
 */
export interface Attachment {
  id: string
  fileName: string
  contentType: string
  size: number
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
}

/**
 * Input for adding an attachment
 */
export interface AttachmentInput {
  fileName: string
  contentType: string
  data: string | ArrayBuffer | Blob
}

// =============================================================================
// Satisfaction Rating Types
// =============================================================================

/**
 * Customer satisfaction rating
 */
export interface SatisfactionRating {
  score: 'good' | 'bad' | 'neutral' | 'offered'
  comment?: string
  reason?: string
  createdAt: string
}

// =============================================================================
// SLA Types
// =============================================================================

/**
 * SLA policy definition
 */
export interface SLAPolicy extends SupportEntity {
  name: string
  description?: string
  /** Position/priority of this policy */
  position: number
  /** Whether this policy is active */
  isActive: boolean
  /** Conditions that trigger this SLA */
  conditions: SLAConditions
  /** Target times for each metric by priority */
  targets: SLATargets
}

/**
 * Conditions that trigger an SLA policy
 */
export interface SLAConditions {
  /** All conditions must match */
  all: SLACondition[]
  /** Any condition must match */
  any: SLACondition[]
}

/**
 * Single SLA condition
 */
export interface SLACondition {
  field: string
  operator: 'is' | 'is_not' | 'greater_than' | 'less_than' | 'contains' | 'not_contains'
  value: string | number | string[]
}

/**
 * SLA targets by priority level
 */
export interface SLATargets {
  urgent?: SLAMetricTargets
  high?: SLAMetricTargets
  normal?: SLAMetricTargets
  low?: SLAMetricTargets
}

/**
 * Target times for SLA metrics (in minutes)
 */
export interface SLAMetricTargets {
  /** Target time for first response */
  firstResponseTime?: number
  /** Target time between responses */
  nextResponseTime?: number
  /** Target time for resolution */
  resolutionTime?: number
  /** Whether to use business hours */
  useBusinessHours: boolean
}

/**
 * SLA status on a specific ticket
 */
export interface SLATicketStatus {
  policyId: string
  policyName: string
  metrics: SLAMetricStatus[]
}

/**
 * Status of a specific SLA metric on a ticket
 */
export interface SLAMetricStatus {
  metric: 'first_response' | 'next_response' | 'resolution'
  targetMinutes: number
  /** When the SLA will breach if not met */
  breachAt?: string
  /** When the SLA was fulfilled */
  fulfilledAt?: string
  /** When the SLA was breached */
  breachedAt?: string
  /** Current status */
  status: 'active' | 'fulfilled' | 'breached' | 'paused'
  /** Minutes remaining before breach */
  remainingMinutes?: number
  /** Whether using business hours */
  useBusinessHours: boolean
}

/**
 * SLA breach record
 */
export interface SLABreach {
  ticketId: string
  policyId: string
  metric: 'first_response' | 'next_response' | 'resolution'
  breachedAt: string
  targetMinutes: number
  actualMinutes: number
}

/**
 * At-risk ticket (nearing SLA breach)
 */
export interface SLAAtRisk {
  ticketId: string
  policyId: string
  metric: 'first_response' | 'next_response' | 'resolution'
  breachAt: string
  remainingMinutes: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Parameters for querying SLA breaches
 */
export interface SLABreachQueryOptions {
  metric?: 'first_response' | 'next_response' | 'resolution'
  policyId?: string
  groupId?: string
  assigneeId?: string
  startDate?: string
  endDate?: string
  limit?: number
  cursor?: string
}

/**
 * Parameters for querying at-risk tickets
 */
export interface SLAAtRiskQueryOptions {
  thresholdMinutes?: number
  metric?: 'first_response' | 'next_response' | 'resolution'
  groupId?: string
  limit?: number
  cursor?: string
}

// =============================================================================
// Macro/Canned Response Types
// =============================================================================

/**
 * Reusable response template
 */
export interface Macro extends SupportEntity {
  name: string
  description?: string
  /** Template content (may contain variables) */
  content: string
  /** Actions to apply when using this macro */
  actions: MacroAction[]
  /** Whether this macro is active */
  isActive: boolean
  /** Restriction to specific groups/agents */
  restriction?: {
    type: 'group' | 'agent'
    ids: string[]
  }
}

/**
 * Action performed when applying a macro
 */
export interface MacroAction {
  field: string
  value: string | number | string[] | null
}

// =============================================================================
// Knowledge Base Types
// =============================================================================

/**
 * Knowledge base article
 */
export interface Article extends SupportEntity {
  title: string
  body: string
  bodyText?: string
  /** Article state */
  status: 'published' | 'draft'
  /** Category/collection ID */
  categoryId?: string
  /** Section/folder ID */
  sectionId?: string
  /** URL slug */
  slug?: string
  /** Full URL */
  url?: string
  /** Author agent ID */
  authorId: string
  /** Locale/language */
  locale: string
  /** View count */
  viewCount: number
  /** Positive feedback count */
  helpfulCount: number
  /** Negative feedback count */
  notHelpfulCount: number
  /** Tags for categorization */
  tags: string[]
}

// =============================================================================
// Automation/Trigger Types
// =============================================================================

/**
 * Automation rule definition
 */
export interface Automation extends SupportEntity {
  name: string
  description?: string
  /** Whether automation is active */
  isActive: boolean
  /** Execution order/priority */
  position: number
  /** Trigger conditions */
  conditions: AutomationConditions
  /** Actions to perform */
  actions: AutomationAction[]
}

/**
 * Automation conditions
 */
export interface AutomationConditions {
  all: AutomationCondition[]
  any: AutomationCondition[]
}

/**
 * Single automation condition
 */
export interface AutomationCondition {
  field: string
  operator: string
  value: string | number | boolean | string[] | null
}

/**
 * Single automation action
 */
export interface AutomationAction {
  field: string
  value: string | number | boolean | string[] | null
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook configuration
 */
export interface Webhook extends SupportEntity {
  name: string
  url: string
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  /** Events that trigger this webhook */
  events: string[]
  /** Whether webhook is active */
  isActive: boolean
  /** Secret for signing payloads */
  secret?: string
  /** Custom headers */
  headers?: Record<string, string>
  /** Authentication configuration */
  authentication?: WebhookAuthentication
}

/**
 * Webhook authentication config
 */
export interface WebhookAuthentication {
  type: 'basic' | 'bearer' | 'api_key'
  credentials: {
    username?: string
    password?: string
    token?: string
    headerName?: string
    headerValue?: string
  }
}

// =============================================================================
// List/Search Response Types
// =============================================================================

/**
 * Generic list response
 */
export interface ListResult<T> {
  results: T[]
  total?: number
  hasMore: boolean
  nextCursor?: string
}

/**
 * Search result with relevance
 */
export interface SearchResult<T> extends ListResult<T> {
  total: number
}

// =============================================================================
// Customer Context Types
// =============================================================================

/**
 * Aggregated customer context from support interactions
 *
 * Combines data from multiple support providers to provide
 * a complete view of customer support history
 */
export interface CustomerContext {
  customerId: string
  email: string
  name?: string
  /** Identifiers across different providers */
  providerIds: Record<SupportProvider, string>
  /** Organization affiliation */
  organization?: {
    id: string
    name: string
    provider: SupportProvider
  }
  /** Recent tickets across all providers */
  recentTickets: TicketSummary[]
  /** Open ticket count per provider */
  openTicketsByProvider: Record<SupportProvider, number>
  /** Total ticket count */
  totalTicketCount: number
  /** Average satisfaction score */
  averageSatisfaction?: number
  /** Tags aggregated from all providers */
  allTags: string[]
  /** First interaction date */
  firstContactAt?: string
  /** Most recent interaction date */
  lastContactAt?: string
  /** Customer health score (calculated) */
  healthScore?: CustomerHealthScore
}

/**
 * Summary of a ticket for context view
 */
export interface TicketSummary {
  id: string
  provider: SupportProvider
  subject: string
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  updatedAt: string
}

/**
 * Calculated customer health score
 */
export interface CustomerHealthScore {
  score: number // 0-100
  factors: {
    recentTicketVolume: number
    avgResolutionTime: number
    satisfactionTrend: number
    escalationRate: number
  }
  riskLevel: 'low' | 'medium' | 'high'
  calculatedAt: string
}

// =============================================================================
// Multi-Provider Routing Types
// =============================================================================

/**
 * Provider configuration for multi-provider routing
 */
export interface ProviderConfig {
  provider: SupportProvider
  /** Whether this provider is enabled */
  enabled: boolean
  /** Priority for routing (lower = higher priority) */
  priority: number
  /** Weight for load balancing (0-100) */
  weight: number
  /** Health check endpoint */
  healthCheckUrl?: string
  /** Last known status */
  status: ProviderStatus
  /** Provider-specific configuration */
  config: Record<string, unknown>
}

/**
 * Provider health status
 */
export interface ProviderStatus {
  isHealthy: boolean
  lastCheckedAt: string
  lastErrorAt?: string
  lastError?: string
  latencyMs?: number
  successRate?: number
}

/**
 * Routing decision for a ticket
 */
export interface RoutingDecision {
  targetProvider: SupportProvider
  reason: RoutingReason
  alternativeProviders: SupportProvider[]
  metadata?: Record<string, unknown>
}

/**
 * Reason for routing decision
 */
export type RoutingReason =
  | 'priority_based'       // Based on provider priority
  | 'load_balanced'        // Based on weight distribution
  | 'failover'            // Primary provider unavailable
  | 'customer_preference' // Customer's preferred provider
  | 'skill_based'         // Based on agent skills
  | 'geography_based'     // Based on customer location
  | 'channel_based'       // Based on ticket channel

/**
 * Routing configuration
 */
export interface RoutingConfig {
  /** Strategy for selecting provider */
  strategy: 'priority' | 'round_robin' | 'weighted' | 'skill_based'
  /** Failover configuration */
  failover: {
    enabled: boolean
    maxRetries: number
    retryDelayMs: number
  }
  /** Provider configurations */
  providers: ProviderConfig[]
}

// =============================================================================
// Support Client Interface
// =============================================================================

/**
 * Unified support client interface that all compat layers implement
 */
export interface SupportClient {
  /** Provider identifier */
  provider: SupportProvider

  // Tickets
  tickets: {
    create(input: TicketCreateInput): Promise<Ticket>
    get(id: string): Promise<Ticket | null>
    update(id: string, input: TicketUpdateInput): Promise<Ticket>
    delete(id: string): Promise<void>
    list(options?: TicketListOptions): Promise<ListResult<Ticket>>
    search(options: TicketSearchOptions): Promise<SearchResult<Ticket>>
    addThread(input: ThreadCreateInput): Promise<Thread>
    getThreads(ticketId: string): Promise<ListResult<Thread>>
    merge(sourceId: string, targetId: string): Promise<Ticket>
  }

  // Customers
  customers: {
    create(input: CustomerCreateInput): Promise<Customer>
    get(id: string): Promise<Customer | null>
    getByEmail(email: string): Promise<Customer | null>
    update(id: string, input: CustomerUpdateInput): Promise<Customer>
    delete(id: string): Promise<void>
    list(options?: CustomerListOptions): Promise<ListResult<Customer>>
    merge(sourceId: string, targetId: string): Promise<Customer>
  }

  // Agents
  agents: {
    get(id: string): Promise<Agent | null>
    list(options?: AgentListOptions): Promise<ListResult<Agent>>
    getAvailable(groupId?: string): Promise<ListResult<Agent>>
  }

  // Organizations
  organizations: {
    create(input: OrganizationCreateInput): Promise<Organization>
    get(id: string): Promise<Organization | null>
    update(id: string, input: OrganizationUpdateInput): Promise<Organization>
    delete(id: string): Promise<void>
    list(options?: { limit?: number; cursor?: string }): Promise<ListResult<Organization>>
  }

  // Groups
  groups: {
    get(id: string): Promise<Group | null>
    list(): Promise<ListResult<Group>>
  }

  // SLA
  sla: {
    getPolicies(): Promise<ListResult<SLAPolicy>>
    getPolicy(id: string): Promise<SLAPolicy | null>
    getTicketStatus(ticketId: string): Promise<SLATicketStatus | null>
    getBreaches(options?: SLABreachQueryOptions): Promise<ListResult<SLABreach>>
    getAtRisk(options?: SLAAtRiskQueryOptions): Promise<ListResult<SLAAtRisk>>
  }

  // Macros
  macros: {
    get(id: string): Promise<Macro | null>
    list(): Promise<ListResult<Macro>>
    apply(macroId: string, ticketId: string): Promise<Ticket>
  }

  // Knowledge Base
  articles: {
    get(id: string): Promise<Article | null>
    list(options?: { categoryId?: string; status?: 'published' | 'draft'; limit?: number }): Promise<ListResult<Article>>
    search(query: string): Promise<SearchResult<Article>>
  }
}

// =============================================================================
// Multi-Provider Router Interface
// =============================================================================

/**
 * Multi-provider router for failover and load balancing
 */
export interface SupportRouter {
  /** Configured providers */
  providers: Map<SupportProvider, SupportClient>

  /** Current routing configuration */
  config: RoutingConfig

  /**
   * Route a ticket creation to the appropriate provider
   */
  routeCreate(input: TicketCreateInput): Promise<RoutingDecision>

  /**
   * Get a ticket from any provider
   */
  getTicket(id: string, provider?: SupportProvider): Promise<Ticket | null>

  /**
   * Get aggregated customer context
   */
  getCustomerContext(email: string): Promise<CustomerContext>

  /**
   * Get provider health status
   */
  getProviderStatus(provider: SupportProvider): Promise<ProviderStatus>

  /**
   * Check all provider health
   */
  healthCheck(): Promise<Map<SupportProvider, ProviderStatus>>

  /**
   * Update provider configuration
   */
  updateProviderConfig(provider: SupportProvider, config: Partial<ProviderConfig>): Promise<void>
}

// =============================================================================
// Error Types
// =============================================================================

export class SupportError extends Error {
  code: string
  provider: SupportProvider
  statusCode: number
  details?: Record<string, unknown>

  constructor(
    message: string,
    code: string,
    provider: SupportProvider,
    statusCode: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SupportError'
    this.code = code
    this.provider = provider
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * Common error codes
 */
export const SupportErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  SLA_BREACH: 'SLA_BREACH',
  ROUTING_ERROR: 'ROUTING_ERROR',
} as const

// =============================================================================
// Event Types (for webhooks and real-time updates)
// =============================================================================

/**
 * Support event for webhook/streaming
 */
export interface SupportEvent {
  id: string
  type: SupportEventType
  provider: SupportProvider
  timestamp: string
  data: Record<string, unknown>
}

export type SupportEventType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.status_changed'
  | 'ticket.assigned'
  | 'ticket.closed'
  | 'ticket.reopened'
  | 'thread.created'
  | 'customer.created'
  | 'customer.updated'
  | 'sla.breach'
  | 'sla.at_risk'
  | 'satisfaction.rated'
