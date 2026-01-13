/**
 * Human Graph Types
 *
 * Type definitions for Users, Organizations, Roles, Sessions, and human-in-the-loop
 * approval workflows in the graph model.
 *
 * @module db/graph/humans/types
 */

import { HUMAN_TYPE_IDS as CENTRALIZED_HUMAN_TYPE_IDS } from '../constants'

// ============================================================================
// CONSTANTS (from centralized db/graph/constants.ts)
// ============================================================================

/**
 * Type IDs for human-related Things in the graph
 *
 * Re-exported from db/graph/constants.ts for backward compatibility.
 * New code should import directly from db/graph/constants or db/graph.
 *
 * @see db/graph/constants.ts for the canonical definitions
 */
export const HUMAN_TYPE_IDS = CENTRALIZED_HUMAN_TYPE_IDS

/**
 * Type names for human-related Things
 */
export const HUMAN_TYPE_NAMES = {
  User: 'User',
  Organization: 'Org',
  Role: 'Role',
  Session: 'Session',
  Account: 'Account',
  Invitation: 'Invitation',
  ApprovalRequest: 'ApprovalRequest',
  TaskRequest: 'TaskRequest',
  DecisionRequest: 'DecisionRequest',
  ReviewRequest: 'ReviewRequest',
  Team: 'Team',
  ApiKey: 'ApiKey',
  Verification: 'Verification',
} as const

/**
 * Relationship verbs for human graph edges
 */
export const HUMAN_VERBS = {
  // Membership relationships
  MEMBER_OF: 'memberOf',
  BELONGS_TO: 'belongsTo',
  MANAGES: 'manages',
  OWNS: 'owns',

  // Role relationships
  HAS_ROLE: 'hasRole',

  // Session relationships
  AUTHENTICATED_BY: 'authenticatedBy',

  // Account/OAuth relationships
  LINKED_TO: 'linkedTo',

  // Social relationships
  FOLLOWS: 'follows',
  INVITED_BY: 'invitedBy',

  // =========================================================================
  // Human-in-the-Loop Verb Form State Encoding
  // =========================================================================
  //
  // Verb forms encode state directly:
  // - Action form (request/approve/etc.) = intent/pending
  // - Activity form (-ing) = in-progress
  // - Event form (-ed) = completed
  //
  // =========================================================================

  // Request verbs (for initial submission)
  REQUEST: 'request',
  REQUESTING: 'requesting',
  REQUESTED: 'requested',

  // Approval workflow verbs
  APPROVE: 'approve',
  APPROVING: 'approving',
  APPROVED: 'approved',

  REJECT: 'reject',
  REJECTING: 'rejecting',
  REJECTED: 'rejected',

  // Review workflow verbs
  REVIEW: 'review',
  REVIEWING: 'reviewing',
  REVIEWED: 'reviewed',

  // Assignment verbs
  ASSIGN: 'assign',
  ASSIGNING: 'assigning',
  ASSIGNED: 'assigned',

  // Escalation verbs
  ESCALATE: 'escalate',
  ESCALATING: 'escalating',
  ESCALATED: 'escalated',

  // Decision verbs
  DECIDE: 'decide',
  DECIDING: 'deciding',
  DECIDED: 'decided',

  // Completion verbs (for task completion)
  COMPLETE: 'complete',
  COMPLETING: 'completing',
  COMPLETED: 'completed',

  // Response verbs (for human responding)
  RESPOND: 'respond',
  RESPONDING: 'responding',
  RESPONDED: 'responded',

  // Notification relationships
  NOTIFIED_VIA: 'notifiedVia',
  DELIVERED_TO: 'deliveredTo',
} as const

// ============================================================================
// STATUS TYPES
// ============================================================================

/**
 * User status
 */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending' | 'deleted'

/**
 * Organization status
 */
export type OrgStatus = 'active' | 'suspended' | 'archived'

/**
 * Invitation status
 */
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'

/**
 * Approval request status (via verb form encoding)
 */
export type ApprovalStatus = 'pending' | 'approving' | 'approved' | 'rejected' | 'expired' | 'cancelled'

/**
 * Notification priority
 */
export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low'

/**
 * Notification channel type
 */
export type NotificationChannelType = 'slack' | 'discord' | 'email' | 'sms' | 'webhook'

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * User Thing data structure
 */
export interface UserThingData {
  /** Primary email address (unique identifier) */
  email: string
  /** Display name */
  name?: string | null
  /** Full display name */
  displayName?: string | null
  /** First name */
  firstName?: string | null
  /** Last name */
  lastName?: string | null
  /** User status */
  status: UserStatus
  /** Email verified flag */
  emailVerified?: boolean
  /** Profile image URL */
  avatarUrl?: string | null
  /** User bio/description */
  bio?: string | null
  /** Timezone (IANA format) */
  timezone?: string | null
  /** Locale (e.g., 'en-US') */
  locale?: string | null
  /** Phone number */
  phone?: string | null
  /** Phone verified flag */
  phoneVerified?: boolean
  /** External provider ID (for OAuth) */
  externalId?: string | null
  /** External provider name */
  externalProvider?: string | null
  /** Last sign-in timestamp (ms) */
  lastSignInAt?: number | null
  /** Last active timestamp (ms) */
  lastActiveAt?: number | null
  /** Notification preferences */
  notificationPreferences?: NotificationPreferences
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Notification preferences for a user
 */
export interface NotificationPreferences {
  /** Preferred channels in order */
  preferredChannels?: NotificationChannelType[]
  /** Channels for urgent notifications */
  urgentChannels?: NotificationChannelType[]
  /** Disabled channels */
  disabledChannels?: NotificationChannelType[]
  /** Time-based routing */
  schedule?: {
    businessHours?: NotificationChannelType[]
    afterHours?: NotificationChannelType[]
    timezone?: string
  }
  /** Per-type settings */
  byType?: Record<string, {
    channels?: NotificationChannelType[]
    enabled?: boolean
  }>
}

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

/**
 * Organization Thing data structure
 */
export interface OrgThingData {
  /** Organization name */
  name: string
  /** Unique slug for URL */
  slug: string
  /** Organization status */
  status: OrgStatus
  /** Logo URL */
  logoUrl?: string | null
  /** Description */
  description?: string | null
  /** DO namespace for routing */
  tenantNs?: string | null
  /** Settings */
  settings?: OrgSettings
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Organization settings
 */
export interface OrgSettings {
  /** Default role for new members */
  defaultRole?: string
  /** Allowed domains for auto-join */
  allowedDomains?: string[]
  /** Whether invitations require admin approval */
  requireInviteApproval?: boolean
  /** SSO configuration */
  sso?: {
    enabled?: boolean
    provider?: string
    config?: Record<string, unknown>
  }
  /** Notification defaults */
  notifications?: {
    channels?: NotificationChannelType[]
    escalationPolicy?: string
  }
}

/**
 * Organization membership data stored in relationship
 */
export interface OrgMembershipData {
  /** Role within the organization (owner, admin, member, viewer) */
  role: string
  /** Joined timestamp */
  joinedAt: number
  /** Invited by user ID */
  invitedBy?: string
  /** Title/position in org */
  title?: string
  /** Department */
  department?: string
  /** Custom membership metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// ROLE TYPES
// ============================================================================

/**
 * Permission string format: "action:resource" or "action:*" for wildcards
 */
export type PermissionString = string

/**
 * Hierarchy level (0-100, higher = more access)
 */
export type HierarchyLevel = number

/**
 * Role Thing data structure
 */
export interface RoleThingData {
  /** Role name */
  name: string
  /** Permissions granted by this role */
  permissions: PermissionString[]
  /** Description */
  description?: string
  /** Hierarchy level for authorization */
  hierarchyLevel?: HierarchyLevel
  /** Whether this is a system role (cannot be deleted) */
  isSystem?: boolean
  /** Organization this role belongs to (null = global) */
  orgId?: string | null
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

/**
 * Role assignment data stored in hasRole relationship
 */
export interface RoleAssignmentData {
  /** Organization context (for org-scoped roles) */
  orgId?: string
  /** When the role was assigned */
  assignedAt: number
  /** Who assigned the role */
  assignedBy?: string
  /** Expiration timestamp (for temporary roles) */
  expiresAt?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Session Thing data structure
 */
export interface SessionThingData {
  /** Session token */
  token: string
  /** User ID this session belongs to */
  userId: string
  /** Expiration timestamp */
  expiresAt: number
  /** User agent string */
  userAgent?: string | null
  /** IP address */
  ipAddress?: string | null
  /** Device fingerprint */
  deviceFingerprint?: string | null
  /** Whether this is a fresh session */
  isFresh?: boolean
  /** Last activity timestamp */
  lastActivityAt?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// ACCOUNT (OAUTH) TYPES
// ============================================================================

/**
 * Account (OAuth provider) Thing data structure
 */
export interface AccountThingData {
  /** OAuth provider name */
  provider: string
  /** Provider's account ID */
  providerAccountId: string
  /** User ID this account is linked to */
  userId: string
  /** Access token */
  accessToken?: string | null
  /** Refresh token */
  refreshToken?: string | null
  /** Access token expiration */
  accessTokenExpiresAt?: number | null
  /** Refresh token expiration */
  refreshTokenExpiresAt?: number | null
  /** OAuth scopes */
  scope?: string | null
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// INVITATION TYPES
// ============================================================================

/**
 * Invitation Thing data structure
 */
export interface InvitationThingData {
  /** Email address of invitee */
  email: string
  /** Organization ID */
  orgId: string
  /** Role to assign on acceptance */
  role: string
  /** Invitation status */
  status: InvitationStatus
  /** Invited by user ID */
  invitedBy: string
  /** Expiration timestamp */
  expiresAt: number
  /** Message to include */
  message?: string
  /** Invitation token */
  token: string
  /** When invitation was sent */
  sentAt?: number
  /** When invitation was accepted */
  acceptedAt?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// APPROVAL REQUEST TYPES
// ============================================================================

/**
 * Approval request Thing data structure
 *
 * Status is encoded via verb form in the relationship:
 * - approve (intent) -> approving (in-progress) -> approved/rejected (completed)
 */
export interface ApprovalRequestThingData {
  /** Request title/subject */
  title: string
  /** Detailed message */
  message: string
  /** Request type */
  type: 'approval' | 'review' | 'question' | 'task'
  /** Priority */
  priority: NotificationPriority
  /** SLA in milliseconds */
  sla?: number
  /** Deadline timestamp */
  deadline?: number
  /** Requester ID (user or agent) */
  requesterId: string
  /** Target role (e.g., 'ceo', 'legal') */
  targetRole?: string
  /** Target user ID (if specific user) */
  targetUserId?: string
  /** Notification channel preference */
  channel?: NotificationChannelType
  /** Context data */
  context?: Record<string, unknown>
  /** Response data (when resolved) */
  response?: ApprovalResponse
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

/**
 * Approval response data
 */
export interface ApprovalResponse {
  /** Whether approved */
  approved: boolean
  /** User who responded */
  responderId: string
  /** Response timestamp */
  respondedAt: number
  /** Reason/comment */
  reason?: string
  /** Additional response data */
  data?: Record<string, unknown>
}

// ============================================================================
// TASK REQUEST TYPES
// ============================================================================

/**
 * Task request Thing data structure
 *
 * Status is encoded via verb form in the relationship:
 * - assign (intent) -> assigning (in-progress) -> assigned (completed)
 * - complete (intent) -> completing (in-progress) -> completed (finished)
 */
export interface TaskRequestThingData {
  /** Task title */
  title: string
  /** Detailed instructions */
  instructions: string
  /** Tools available for the task */
  tools?: string[]
  /** Estimated effort (in minutes) */
  estimatedEffort?: number
  /** Priority */
  priority: NotificationPriority
  /** SLA in milliseconds */
  sla?: number
  /** Deadline timestamp */
  deadline?: number
  /** Requester ID (user or agent) */
  requesterId: string
  /** Target role */
  targetRole?: string
  /** Target user ID */
  targetUserId?: string
  /** Notification channel preference */
  channel?: NotificationChannelType
  /** Task state */
  state: TaskState
  /** Timestamps for SLA tracking */
  timestamps: TaskTimestamps
  /** Context data */
  context?: Record<string, unknown>
  /** Response data (when completed) */
  response?: TaskResponse
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

/**
 * Task state type
 */
export type TaskState = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'

/**
 * Task timestamps for SLA tracking
 */
export interface TaskTimestamps {
  /** When the task was created */
  createdAt: number
  /** When the task was assigned */
  assignedAt?: number
  /** When work started on the task */
  startedAt?: number
  /** When the task was completed */
  completedAt?: number
  /** When first response was received */
  firstResponseAt?: number
  /** Escalation history */
  escalations?: Array<{
    level: number
    escalatedAt: number
    target: string
  }>
}

/**
 * Task response data
 */
export interface TaskResponse {
  /** User who completed the task */
  completedBy: string
  /** Completion timestamp */
  completedAt: number
  /** Result/output */
  result?: unknown
  /** Notes */
  notes?: string
}

// ============================================================================
// DECISION REQUEST TYPES
// ============================================================================

/**
 * Decision request Thing data structure
 *
 * Status is encoded via verb form in the relationship:
 * - decide (intent) -> deciding (in-progress) -> decided (completed)
 */
export interface DecisionRequestThingData {
  /** Decision title */
  title: string
  /** Question being decided */
  question: string
  /** Available options */
  options: DecisionOption[]
  /** Criteria for making the decision */
  criteria?: string[]
  /** Priority */
  priority: NotificationPriority
  /** SLA in milliseconds */
  sla?: number
  /** Deadline timestamp */
  deadline?: number
  /** Requester ID */
  requesterId: string
  /** Target role */
  targetRole?: string
  /** Target user ID */
  targetUserId?: string
  /** Notification channel preference */
  channel?: NotificationChannelType
  /** Timestamps for SLA tracking */
  timestamps: DecisionTimestamps
  /** Context data */
  context?: Record<string, unknown>
  /** Decision result */
  decision?: DecisionResult
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

/**
 * Decision option
 */
export interface DecisionOption {
  /** Option ID */
  id: string
  /** Option label */
  label: string
  /** Option description */
  description?: string
  /** Optional data associated with the option */
  data?: Record<string, unknown>
}

/**
 * Decision timestamps for SLA tracking
 */
export interface DecisionTimestamps {
  /** When the decision request was created */
  createdAt: number
  /** When the decision was assigned */
  assignedAt?: number
  /** When the decision was made */
  decidedAt?: number
  /** First response timestamp */
  firstResponseAt?: number
  /** Escalation history */
  escalations?: Array<{
    level: number
    escalatedAt: number
    target: string
  }>
}

/**
 * Decision result
 */
export interface DecisionResult {
  /** Selected option ID */
  selectedOptionId: string
  /** User who made the decision */
  decidedBy: string
  /** Decision timestamp */
  decidedAt: number
  /** Reasoning */
  reasoning?: string
  /** Confidence level (0-1) */
  confidence?: number
}

// ============================================================================
// REVIEW REQUEST TYPES
// ============================================================================

/**
 * Review request Thing data structure
 *
 * Status is encoded via verb form in the relationship:
 * - review (intent) -> reviewing (in-progress) -> reviewed (completed)
 */
export interface ReviewRequestThingData {
  /** Review title */
  title: string
  /** Content to be reviewed */
  content: string
  /** Review criteria */
  criteria?: string[]
  /** Type of review */
  reviewType: ReviewType
  /** Priority */
  priority: NotificationPriority
  /** SLA in milliseconds */
  sla?: number
  /** Deadline timestamp */
  deadline?: number
  /** Requester ID */
  requesterId: string
  /** Target role */
  targetRole?: string
  /** Target user ID */
  targetUserId?: string
  /** Notification channel preference */
  channel?: NotificationChannelType
  /** Timestamps for SLA tracking */
  timestamps: ReviewTimestamps
  /** Context data */
  context?: Record<string, unknown>
  /** Review result */
  review?: ReviewResult
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

/**
 * Review type
 */
export type ReviewType = 'code' | 'content' | 'design' | 'legal' | 'security' | 'quality' | 'other'

/**
 * Review timestamps for SLA tracking
 */
export interface ReviewTimestamps {
  /** When the review request was created */
  createdAt: number
  /** When the review was assigned */
  assignedAt?: number
  /** When review started */
  startedAt?: number
  /** When the review was completed */
  completedAt?: number
  /** First response timestamp */
  firstResponseAt?: number
  /** Escalation history */
  escalations?: Array<{
    level: number
    escalatedAt: number
    target: string
  }>
}

/**
 * Review result
 */
export interface ReviewResult {
  /** User who reviewed */
  reviewedBy: string
  /** Review timestamp */
  reviewedAt: number
  /** Approval status */
  approved: boolean
  /** Review score (optional, 0-100) */
  score?: number
  /** Feedback */
  feedback?: string
  /** Issues found */
  issues?: ReviewIssue[]
}

/**
 * Review issue
 */
export interface ReviewIssue {
  /** Issue type */
  type: 'error' | 'warning' | 'suggestion' | 'nitpick'
  /** Issue description */
  description: string
  /** Location reference */
  location?: string
  /** Severity (1-5) */
  severity?: number
}

// ============================================================================
// SLA CONFIGURATION TYPES
// ============================================================================

/**
 * SLA configuration for different priorities
 */
export interface SLAConfiguration {
  /** SLA by priority (in milliseconds) */
  byPriority: Record<NotificationPriority, number>
  /** Warning threshold (percentage of SLA, e.g., 0.75 = 75%) */
  warningThreshold: number
  /** Default SLA if not specified */
  default: number
}

/**
 * Default SLA configuration
 */
export const DEFAULT_SLA_CONFIG: SLAConfiguration = {
  byPriority: {
    urgent: 30 * 60 * 1000, // 30 minutes
    high: 2 * 60 * 60 * 1000, // 2 hours
    normal: 8 * 60 * 60 * 1000, // 8 hours
    low: 24 * 60 * 60 * 1000, // 24 hours
  },
  warningThreshold: 0.75, // Warn at 75% of SLA
  default: 8 * 60 * 60 * 1000, // 8 hours default
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * Notification delivery data stored in relationship
 */
export interface NotificationDeliveryData {
  /** Channel used */
  channel: NotificationChannelType
  /** Delivery timestamp */
  deliveredAt: number
  /** Message ID from channel */
  messageId?: string
  /** Delivery status */
  status: 'pending' | 'delivered' | 'failed' | 'read'
  /** Error message if failed */
  error?: string
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// ESCALATION TYPES
// ============================================================================

/**
 * Escalation data stored in escalatedTo relationship
 */
export interface EscalationData {
  /** Original request ID */
  requestId: string
  /** Escalation level */
  level: number
  /** Reason for escalation */
  reason?: string
  /** Escalated at timestamp */
  escalatedAt: number
  /** Escalated by (user/system) */
  escalatedBy?: string
  /** SLA for this escalation level */
  sla?: number
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// TEAM TYPES
// ============================================================================

/**
 * Team Thing data structure
 */
export interface TeamThingData {
  /** Team name */
  name: string
  /** Team slug */
  slug: string
  /** Organization ID */
  orgId: string
  /** Description */
  description?: string
  /** Team lead user ID */
  leadId?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Index signature */
  [key: string]: unknown
}

// ============================================================================
// URL SCHEMES
// ============================================================================

/**
 * URL scheme helpers for human graph entities
 */
export const HumanUrls = {
  user: (id: string) => `auth://users/${id}`,
  org: (id: string) => `auth://orgs/${id}`,
  role: (id: string) => `auth://roles/${id}`,
  session: (id: string) => `auth://sessions/${id}`,
  account: (id: string) => `auth://accounts/${id}`,
  invitation: (id: string) => `auth://invitations/${id}`,
  team: (orgId: string, id: string) => `auth://orgs/${orgId}/teams/${id}`,

  // Human request URLs
  approval: (id: string) => `requests://approvals/${id}`,
  task: (id: string) => `requests://tasks/${id}`,
  decision: (id: string) => `requests://decisions/${id}`,
  review: (id: string) => `requests://reviews/${id}`,

  // Generic request URL (detects type from ID prefix or context)
  request: (type: 'approval' | 'task' | 'decision' | 'review', id: string) => `requests://${type}s/${id}`,

  /** Extract ID from URL */
  extractId: (url: string): string => {
    const parts = url.split('/')
    return parts[parts.length - 1]!
  },

  /** Extract entity type from URL */
  extractType: (url: string): string | null => {
    if (url.startsWith('auth://users/')) return 'User'
    if (url.startsWith('auth://orgs/')) return 'Org'
    if (url.startsWith('auth://roles/')) return 'Role'
    if (url.startsWith('auth://sessions/')) return 'Session'
    if (url.startsWith('auth://accounts/')) return 'Account'
    if (url.startsWith('auth://invitations/')) return 'Invitation'
    if (url.startsWith('requests://approvals/')) return 'ApprovalRequest'
    if (url.startsWith('requests://tasks/')) return 'TaskRequest'
    if (url.startsWith('requests://decisions/')) return 'DecisionRequest'
    if (url.startsWith('requests://reviews/')) return 'ReviewRequest'
    return null
  },
} as const

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for UserThingData
 */
export function isUserThingData(data: unknown): data is UserThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.email === 'string' && typeof d.status === 'string'
}

/**
 * Type guard for OrgThingData
 */
export function isOrgThingData(data: unknown): data is OrgThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.name === 'string' && typeof d.slug === 'string'
}

/**
 * Type guard for RoleThingData
 */
export function isRoleThingData(data: unknown): data is RoleThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.name === 'string' && Array.isArray(d.permissions)
}

/**
 * Type guard for ApprovalRequestThingData
 */
export function isApprovalRequestThingData(data: unknown): data is ApprovalRequestThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.title === 'string' && typeof d.message === 'string' && typeof d.type === 'string'
}

/**
 * Type guard for TaskRequestThingData
 */
export function isTaskRequestThingData(data: unknown): data is TaskRequestThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.title === 'string' && typeof d.instructions === 'string' && typeof d.timestamps === 'object'
}

/**
 * Type guard for DecisionRequestThingData
 */
export function isDecisionRequestThingData(data: unknown): data is DecisionRequestThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.title === 'string' && typeof d.question === 'string' && Array.isArray(d.options)
}

/**
 * Type guard for ReviewRequestThingData
 */
export function isReviewRequestThingData(data: unknown): data is ReviewRequestThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.title === 'string' && typeof d.content === 'string' && typeof d.reviewType === 'string'
}

/**
 * Union type for all human request data types
 */
export type HumanRequestThingData =
  | ApprovalRequestThingData
  | TaskRequestThingData
  | DecisionRequestThingData
  | ReviewRequestThingData

/**
 * Type guard for any human request data
 */
export function isHumanRequestThingData(data: unknown): data is HumanRequestThingData {
  return (
    isApprovalRequestThingData(data) ||
    isTaskRequestThingData(data) ||
    isDecisionRequestThingData(data) ||
    isReviewRequestThingData(data)
  )
}
