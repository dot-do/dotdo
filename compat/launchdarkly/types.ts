/**
 * @dotdo/launchdarkly - LaunchDarkly Server SDK Types
 *
 * Extended type definitions for full LaunchDarkly Server SDK compatibility
 * including projects, environments, segments, audit logs, and SDK endpoints.
 */

// Re-export base types from flags layer
export type {
  LDFlagValue,
  LDFlagSet,
  LDUser,
  LDUserBuiltIn,
  LDContext,
  LDSingleKindContext,
  LDMultiKindContext,
  LDEvaluationDetail,
  LDEvaluationReason,
  LDEvaluationReasonKind,
  LDErrorKind,
  FeatureFlag,
  FlagVariation,
  FlagRule,
  Clause,
  ClauseOperator,
  Target,
  Prerequisite,
  VariationOrRollout,
  RolloutConfig,
  WeightedVariation,
  ClientSideAvailability,
  Experiment,
  ExperimentVariant,
  ExperimentResult,
  FeatureEvent,
  CustomEvent,
  IdentifyEvent,
  SummaryEvent,
  FeatureSummary,
  FeatureCounter,
  LDEvent,
  LDOptions,
  LDAllFlagsStateOptions,
  LDFlagsState,
  FlagMetadata,
  LDClientEvent,
  LDEventCallback,
  UpdateEvent,
  ErrorEvent,
  EvaluationStats,
  EvaluationRecord,
  TestClientOptions,
} from '../flags/types'

// =============================================================================
// Project Types
// =============================================================================

/**
 * LaunchDarkly Project
 */
export interface Project {
  key: string
  name: string
  tags?: string[]
  environments: Environment[]
  defaultClientSideAvailability?: ClientSideAvailability
  includeInSnippetByDefault?: boolean
}

/**
 * Create project request
 */
export interface CreateProjectRequest {
  key: string
  name: string
  tags?: string[]
  defaultClientSideAvailability?: ClientSideAvailability
  includeInSnippetByDefault?: boolean
  environments?: CreateEnvironmentRequest[]
}

// =============================================================================
// Environment Types
// =============================================================================

/**
 * LaunchDarkly Environment
 */
export interface Environment {
  key: string
  name: string
  color: string
  apiKey: string
  mobileKey: string
  defaultTtl: number
  secureMode: boolean
  defaultTrackEvents: boolean
  requireComments: boolean
  confirmChanges: boolean
  tags?: string[]
}

/**
 * Create environment request
 */
export interface CreateEnvironmentRequest {
  key: string
  name: string
  color: string
  defaultTtl?: number
  secureMode?: boolean
  defaultTrackEvents?: boolean
  requireComments?: boolean
  confirmChanges?: boolean
}

/**
 * Update environment request
 */
export interface UpdateEnvironmentRequest {
  name?: string
  color?: string
  defaultTtl?: number
  secureMode?: boolean
  defaultTrackEvents?: boolean
  requireComments?: boolean
  confirmChanges?: boolean
}

// =============================================================================
// Segment Types
// =============================================================================

/**
 * User segment
 */
export interface Segment {
  key: string
  name: string
  description?: string
  tags?: string[]
  included: string[]
  excluded: string[]
  rules: SegmentRule[]
  version: number
  salt: string
  unbounded?: boolean
  unboundedContextKind?: string
  generation?: number
}

/**
 * Segment targeting rule
 */
export interface SegmentRule {
  id?: string
  clauses: SegmentClause[]
  weight?: number
  rolloutContextKind?: string
  bucketBy?: string
}

/**
 * Segment clause
 */
export interface SegmentClause {
  attribute: string
  op: SegmentOperator
  values: unknown[]
  negate?: boolean
  contextKind?: string
}

/**
 * Segment operators
 */
export type SegmentOperator =
  | 'in'
  | 'endsWith'
  | 'startsWith'
  | 'matches'
  | 'contains'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'before'
  | 'after'
  | 'semVerEqual'
  | 'semVerLessThan'
  | 'semVerGreaterThan'

/**
 * Create segment request
 */
export interface CreateSegmentRequest {
  key: string
  name: string
  description?: string
  tags?: string[]
  included?: string[]
  excluded?: string[]
  rules?: SegmentRule[]
  unbounded?: boolean
  unboundedContextKind?: string
}

/**
 * Update segment request
 */
export interface UpdateSegmentRequest {
  name?: string
  description?: string
  tags?: string[]
  included?: string[]
  excluded?: string[]
  rules?: SegmentRule[]
}

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string
  date: number
  accesses: AuditLogAccess[]
  kind: AuditLogKind
  name: string
  description: string
  shortDescription: string
  comment?: string
  subject?: AuditLogSubject
  member?: AuditLogMember
  target?: AuditLogTarget
}

/**
 * Audit log access details
 */
export interface AuditLogAccess {
  action: AuditLogAction
  resource: string
}

/**
 * Audit log action types
 */
export type AuditLogAction =
  | 'createFlag'
  | 'updateFlag'
  | 'deleteFlag'
  | 'copyFlagConfigFrom'
  | 'copyFlagConfigTo'
  | 'createSegment'
  | 'updateSegment'
  | 'deleteSegment'
  | 'createProject'
  | 'updateProject'
  | 'deleteProject'
  | 'createEnvironment'
  | 'updateEnvironment'
  | 'deleteEnvironment'
  | 'updateGlobalRelay'
  | 'createWebhook'
  | 'updateWebhook'
  | 'deleteWebhook'

/**
 * Audit log kind
 */
export type AuditLogKind =
  | 'flag'
  | 'segment'
  | 'project'
  | 'environment'
  | 'webhook'
  | 'relay'
  | 'member'
  | 'role'
  | 'team'

/**
 * Audit log subject
 */
export interface AuditLogSubject {
  _links?: Record<string, { href: string }>
  name?: string
  avatarUrl?: string
}

/**
 * Audit log member who performed action
 */
export interface AuditLogMember {
  _links?: Record<string, { href: string }>
  _id: string
  firstName?: string
  lastName?: string
  email?: string
}

/**
 * Audit log target (what was affected)
 */
export interface AuditLogTarget {
  _links?: Record<string, { href: string }>
  name?: string
  resources?: string[]
}

/**
 * Audit log query options
 */
export interface AuditLogQueryOptions {
  before?: number
  after?: number
  limit?: number
  spec?: string
}

// =============================================================================
// SDK Endpoints Types
// =============================================================================

/**
 * SDK endpoint for flag delivery
 */
export interface SDKEndpoint {
  version: number
  timestamp: number
  flags: Record<string, SDKFlag>
  segments: Record<string, Segment>
}

/**
 * SDK flag format (optimized for evaluation)
 */
export interface SDKFlag {
  key: string
  version: number
  on: boolean
  prerequisites?: {
    key: string
    variation: number
  }[]
  targets?: {
    values: string[]
    variation: number
    contextKind?: string
  }[]
  contextTargets?: {
    values: string[]
    variation: number
    contextKind: string
  }[]
  rules?: SDKRule[]
  fallthrough: {
    variation?: number
    rollout?: SDKRollout
  }
  offVariation?: number
  variations: unknown[]
  clientSideAvailability?: ClientSideAvailability
  salt: string
  trackEvents: boolean
  trackEventsFallthrough?: boolean
  debugEventsUntilDate?: number
}

/**
 * SDK rule format
 */
export interface SDKRule {
  id?: string
  variation?: number
  rollout?: SDKRollout
  clauses: SDKClause[]
  trackEvents?: boolean
}

/**
 * SDK rollout format
 */
export interface SDKRollout {
  variations: {
    variation: number
    weight: number
    untracked?: boolean
  }[]
  bucketBy?: string
  contextKind?: string
  kind?: 'rollout' | 'experiment'
  seed?: number
}

/**
 * SDK clause format
 */
export interface SDKClause {
  attribute: string
  op: string
  values: unknown[]
  negate?: boolean
  contextKind?: string
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook configuration
 */
export interface Webhook {
  id: string
  name: string
  url: string
  secret?: string
  sign: boolean
  on: boolean
  tags?: string[]
  statements?: WebhookStatement[]
}

/**
 * Webhook statement for filtering
 */
export interface WebhookStatement {
  effect: 'allow' | 'deny'
  resources?: string[]
  notResources?: string[]
  actions?: AuditLogAction[]
  notActions?: AuditLogAction[]
}

/**
 * Create webhook request
 */
export interface CreateWebhookRequest {
  name: string
  url: string
  secret?: string
  sign?: boolean
  on?: boolean
  tags?: string[]
  statements?: WebhookStatement[]
}

// =============================================================================
// Flag Scheduler Types
// =============================================================================

/**
 * Scheduled flag change
 */
export interface ScheduledChange {
  id: string
  creationDate: number
  maintainerId: string
  executionDate: number
  instructions: FlagInstruction[]
  conflicts?: ScheduledChangeConflict[]
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
}

/**
 * Flag instruction for scheduled changes
 */
export interface FlagInstruction {
  kind: FlagInstructionKind
  variationId?: number
  ruleId?: string
  userKeys?: string[]
  clauses?: Clause[]
  weight?: number
}

/**
 * Instruction kinds
 */
export type FlagInstructionKind =
  | 'turnFlagOn'
  | 'turnFlagOff'
  | 'addUserTargets'
  | 'removeUserTargets'
  | 'addRule'
  | 'removeRule'
  | 'updateRuleVariationOrRollout'
  | 'updateFallthroughVariationOrRollout'
  | 'updateOffVariation'

/**
 * Conflict with other scheduled changes
 */
export interface ScheduledChangeConflict {
  instructionIndex: number
  reason: string
}

// =============================================================================
// Data Export Types
// =============================================================================

/**
 * Data export destination configuration
 */
export interface DataExportDestination {
  id: string
  name: string
  kind: DataExportKind
  config: Record<string, unknown>
  on: boolean
  version: number
}

/**
 * Supported export destinations
 */
export type DataExportKind =
  | 'kinesis'
  | 'google-pubsub'
  | 'mparticle'
  | 'segment'
  | 's3'
  | 'azure-event-hubs'

// =============================================================================
// Relay Proxy Types
// =============================================================================

/**
 * Relay proxy configuration
 */
export interface RelayProxyConfig {
  id: string
  name: string
  creationDate: number
  lastModified: number
  policy: RelayProxyPolicy[]
}

/**
 * Relay proxy policy
 */
export interface RelayProxyPolicy {
  resources: string[]
  actions: string[]
  effect: 'allow' | 'deny'
}

// =============================================================================
// Big Segment Types
// =============================================================================

/**
 * Big segment store status
 */
export interface BigSegmentStoreStatus {
  available: boolean
  stale: boolean
}

/**
 * Big segment membership
 */
export interface BigSegmentMembership {
  [segmentRef: string]: boolean | undefined
}
