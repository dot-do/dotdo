/**
 * @dotdo/linear - Linear API Type Definitions
 *
 * Type definitions for Linear API compatibility layer.
 * Based on Linear GraphQL API.
 *
 * @module @dotdo/linear/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Unique identifier (UUID format)
 */
export type ID = string

/**
 * ISO 8601 date string
 */
export type DateTime = string

/**
 * JSON scalar type
 */
export type JSONObject = Record<string, unknown>

/**
 * Connection/pagination wrapper for list queries
 */
export interface Connection<T> {
  nodes: T[]
  pageInfo: PageInfo
}

/**
 * Pagination info for connections
 */
export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string
  endCursor?: string
}

/**
 * Common pagination arguments
 */
export interface PaginationArgs {
  first?: number
  after?: string
  last?: number
  before?: string
  includeArchived?: boolean
}

/**
 * Common filter for number comparisons
 */
export interface NumberComparator {
  eq?: number
  neq?: number
  lt?: number
  lte?: number
  gt?: number
  gte?: number
  in?: number[]
  nin?: number[]
}

/**
 * Common filter for string comparisons
 */
export interface StringComparator {
  eq?: string
  neq?: string
  in?: string[]
  nin?: string[]
  contains?: string
  notContains?: string
  startsWith?: string
  endsWith?: string
  containsIgnoreCase?: string
}

/**
 * Common filter for date comparisons
 */
export interface DateComparator {
  eq?: DateTime
  neq?: DateTime
  lt?: DateTime
  lte?: DateTime
  gt?: DateTime
  gte?: DateTime
}

/**
 * Success payload for mutations
 */
export interface SuccessPayload {
  success: boolean
  lastSyncId?: number
}

// =============================================================================
// Team Types
// =============================================================================

/**
 * Linear Team object
 */
export interface Team {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  key: string
  description?: string | null
  icon?: string | null
  color?: string | null
  private: boolean
  timezone: string
  issueCount: number
  inviteHash?: string | null

  // Relationships (implemented as async methods in runtime)
  organization?: Organization
  issues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  projects?: (args?: ProjectFilterArgs) => Promise<Connection<Project>>
  cycles?: (args?: CycleFilterArgs) => Promise<Connection<Cycle>>
  states?: (args?: PaginationArgs) => Promise<Connection<WorkflowState>>
  labels?: (args?: PaginationArgs) => Promise<Connection<IssueLabel>>
  members?: (args?: PaginationArgs) => Promise<Connection<User>>
  activeCycle?: Cycle | null
  defaultIssueState?: WorkflowState | null
}

/**
 * Input for creating a team
 */
export interface TeamCreateInput {
  name: string
  key: string
  description?: string
  icon?: string
  color?: string
  private?: boolean
  timezone?: string
}

/**
 * Input for updating a team
 */
export interface TeamUpdateInput {
  name?: string
  key?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  private?: boolean
  timezone?: string
}

/**
 * Team mutation payload
 */
export interface TeamPayload extends SuccessPayload {
  team?: Team | null
}

// =============================================================================
// Issue Types
// =============================================================================

/**
 * Issue priority levels (0-4, where 0 = no priority, 1 = urgent, 4 = low)
 */
export type IssuePriority = 0 | 1 | 2 | 3 | 4

/**
 * Issue sort options
 */
export type IssueSortOption =
  | 'createdAt'
  | 'updatedAt'
  | 'priority'
  | 'estimate'
  | 'completedAt'
  | 'startedAt'
  | 'title'

/**
 * Linear Issue object
 */
export interface Issue {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  number: number
  identifier: string
  title: string
  description?: string | null
  descriptionData?: JSONObject | null
  priority: IssuePriority
  priorityLabel: string
  estimate?: number | null
  sortOrder: number
  startedAt?: DateTime | null
  completedAt?: DateTime | null
  startedTriageAt?: DateTime | null
  triagedAt?: DateTime | null
  canceledAt?: DateTime | null
  autoClosedAt?: DateTime | null
  autoArchivedAt?: DateTime | null
  dueDate?: DateTime | null
  slaStartedAt?: DateTime | null
  slaBreachesAt?: DateTime | null
  url: string
  branchName?: string | null

  // Relationships
  team: Team
  state: WorkflowState
  assignee?: User | null
  creator?: User | null
  parent?: Issue | null
  project?: Project | null
  cycle?: Cycle | null
  snoozedBy?: User | null

  // Relationship methods
  labels?: (args?: PaginationArgs) => Promise<Connection<IssueLabel>>
  children?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  comments?: (args?: CommentFilterArgs) => Promise<Connection<Comment>>
  subscribers?: (args?: PaginationArgs) => Promise<Connection<User>>
  history?: (args?: PaginationArgs) => Promise<Connection<IssueHistory>>
  attachments?: (args?: PaginationArgs) => Promise<Connection<Attachment>>
  relations?: (args?: PaginationArgs) => Promise<Connection<IssueRelation>>
  inverseRelations?: (args?: PaginationArgs) => Promise<Connection<IssueRelation>>
  blockedBy?: (args?: PaginationArgs) => Promise<Connection<Issue>>
  blocks?: (args?: PaginationArgs) => Promise<Connection<Issue>>
}

/**
 * Issue history entry
 */
export interface IssueHistory {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  issue: Issue
  actor?: User | null
  fromAssignee?: User | null
  toAssignee?: User | null
  fromState?: WorkflowState | null
  toState?: WorkflowState | null
  fromPriority?: number | null
  toPriority?: number | null
  fromEstimate?: number | null
  toEstimate?: number | null
  fromCycle?: Cycle | null
  toCycle?: Cycle | null
  fromProject?: Project | null
  toProject?: Project | null
  addedLabels?: IssueLabel[]
  removedLabels?: IssueLabel[]
  changes?: JSONObject
}

/**
 * Issue filter arguments
 */
export interface IssueFilterArgs extends PaginationArgs {
  filter?: IssueFilter
  orderBy?: IssueSortOption
}

/**
 * Issue filter type
 */
export interface IssueFilter {
  id?: StringComparator
  title?: StringComparator
  description?: StringComparator
  priority?: NumberComparator
  estimate?: NumberComparator
  createdAt?: DateComparator
  updatedAt?: DateComparator
  completedAt?: DateComparator
  startedAt?: DateComparator
  canceledAt?: DateComparator
  dueDate?: DateComparator
  number?: NumberComparator
  team?: { id?: StringComparator }
  project?: { id?: StringComparator; null?: boolean }
  cycle?: { id?: StringComparator; null?: boolean }
  state?: { id?: StringComparator; name?: StringComparator; type?: StringComparator }
  assignee?: { id?: StringComparator; null?: boolean }
  creator?: { id?: StringComparator }
  parent?: { id?: StringComparator; null?: boolean }
  labels?: { id?: StringComparator; name?: StringComparator }
  and?: IssueFilter[]
  or?: IssueFilter[]
}

/**
 * Input for creating an issue
 */
export interface IssueCreateInput {
  teamId: ID
  title: string
  description?: string
  descriptionData?: JSONObject
  priority?: IssuePriority
  estimate?: number
  stateId?: ID
  assigneeId?: ID
  parentId?: ID
  projectId?: ID
  cycleId?: ID
  labelIds?: ID[]
  subscriberIds?: ID[]
  dueDate?: DateTime
  sortOrder?: number
}

/**
 * Input for updating an issue
 */
export interface IssueUpdateInput {
  title?: string
  description?: string | null
  descriptionData?: JSONObject | null
  priority?: IssuePriority
  estimate?: number | null
  stateId?: ID
  assigneeId?: ID | null
  parentId?: ID | null
  projectId?: ID | null
  cycleId?: ID | null
  labelIds?: ID[]
  subscriberIds?: ID[]
  dueDate?: DateTime | null
  sortOrder?: number
  snoozedById?: ID | null
  snoozedUntilAt?: DateTime | null
}

/**
 * Issue mutation payload
 */
export interface IssuePayload extends SuccessPayload {
  issue?: Issue | null
}

/**
 * Issue archive/unarchive payload
 */
export interface IssueArchivePayload extends SuccessPayload {
  entity?: Issue | null
}

/**
 * Issue batch payload
 */
export interface IssueBatchPayload extends SuccessPayload {
  issues?: Issue[]
}

// =============================================================================
// Issue Relation Types
// =============================================================================

/**
 * Issue relation types
 */
export type IssueRelationType = 'blocks' | 'duplicate' | 'related'

/**
 * Issue relation
 */
export interface IssueRelation {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  type: IssueRelationType
  issue: Issue
  relatedIssue: Issue
}

/**
 * Input for creating an issue relation
 */
export interface IssueRelationCreateInput {
  issueId: ID
  relatedIssueId: ID
  type: IssueRelationType
}

/**
 * Issue relation payload
 */
export interface IssueRelationPayload extends SuccessPayload {
  issueRelation?: IssueRelation | null
}

// =============================================================================
// Workflow State Types
// =============================================================================

/**
 * Workflow state types
 */
export type WorkflowStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

/**
 * Workflow state
 */
export interface WorkflowState {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  color: string
  type: WorkflowStateType
  position: number
  team: Team
}

/**
 * Input for creating a workflow state
 */
export interface WorkflowStateCreateInput {
  teamId: ID
  name: string
  type: WorkflowStateType
  color: string
  description?: string
  position?: number
}

/**
 * Input for updating a workflow state
 */
export interface WorkflowStateUpdateInput {
  name?: string
  type?: WorkflowStateType
  color?: string
  description?: string | null
  position?: number
}

/**
 * Workflow state payload
 */
export interface WorkflowStatePayload extends SuccessPayload {
  workflowState?: WorkflowState | null
}

// =============================================================================
// Project Types
// =============================================================================

/**
 * Project state
 */
export type ProjectState = 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled'

/**
 * Project sort options
 */
export type ProjectSortOption =
  | 'createdAt'
  | 'updatedAt'
  | 'name'
  | 'startDate'
  | 'targetDate'
  | 'progress'

/**
 * Linear Project object
 */
export interface Project {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  state: ProjectState
  slugId: string
  url: string
  progress: number
  startDate?: DateTime | null
  targetDate?: DateTime | null
  startedAt?: DateTime | null
  completedAt?: DateTime | null
  canceledAt?: DateTime | null
  autoArchivedAt?: DateTime | null
  sortOrder: number

  // Relationships
  creator?: User | null
  lead?: User | null

  // Relationship methods
  teams?: (args?: PaginationArgs) => Promise<Connection<Team>>
  members?: (args?: PaginationArgs) => Promise<Connection<User>>
  issues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  projectMilestones?: (args?: PaginationArgs) => Promise<Connection<ProjectMilestone>>
  projectUpdates?: (args?: PaginationArgs) => Promise<Connection<ProjectUpdate>>
  links?: (args?: PaginationArgs) => Promise<Connection<ProjectLink>>
}

/**
 * Project filter arguments
 */
export interface ProjectFilterArgs extends PaginationArgs {
  filter?: ProjectFilter
  orderBy?: ProjectSortOption
}

/**
 * Project filter type
 */
export interface ProjectFilter {
  id?: StringComparator
  name?: StringComparator
  state?: { eq?: ProjectState; in?: ProjectState[] }
  createdAt?: DateComparator
  updatedAt?: DateComparator
  startDate?: DateComparator
  targetDate?: DateComparator
  creator?: { id?: StringComparator }
  lead?: { id?: StringComparator; null?: boolean }
  and?: ProjectFilter[]
  or?: ProjectFilter[]
}

/**
 * Input for creating a project
 */
export interface ProjectCreateInput {
  name: string
  teamIds: ID[]
  description?: string
  icon?: string
  color?: string
  state?: ProjectState
  startDate?: DateTime
  targetDate?: DateTime
  leadId?: ID
  memberIds?: ID[]
  sortOrder?: number
}

/**
 * Input for updating a project
 */
export interface ProjectUpdateInput {
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  state?: ProjectState
  startDate?: DateTime | null
  targetDate?: DateTime | null
  leadId?: ID | null
  memberIds?: ID[]
  sortOrder?: number
}

/**
 * Project mutation payload
 */
export interface ProjectPayload extends SuccessPayload {
  project?: Project | null
}

// =============================================================================
// Project Milestone Types
// =============================================================================

/**
 * Project milestone
 */
export interface ProjectMilestone {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  targetDate?: DateTime | null
  sortOrder: number
  project: Project
}

/**
 * Input for creating a project milestone
 */
export interface ProjectMilestoneCreateInput {
  projectId: ID
  name: string
  description?: string
  targetDate?: DateTime
  sortOrder?: number
}

/**
 * Input for updating a project milestone
 */
export interface ProjectMilestoneUpdateInput {
  name?: string
  description?: string | null
  targetDate?: DateTime | null
  sortOrder?: number
}

/**
 * Project milestone payload
 */
export interface ProjectMilestonePayload extends SuccessPayload {
  projectMilestone?: ProjectMilestone | null
}

// =============================================================================
// Project Update Types
// =============================================================================

/**
 * Project update health status
 */
export type ProjectUpdateHealth = 'onTrack' | 'atRisk' | 'offTrack'

/**
 * Project update
 */
export interface ProjectUpdate {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  body: string
  health: ProjectUpdateHealth
  project: Project
  user: User
  editedAt?: DateTime | null
}

/**
 * Input for creating a project update
 */
export interface ProjectUpdateCreateInput {
  projectId: ID
  body: string
  health?: ProjectUpdateHealth
}

/**
 * Project update payload
 */
export interface ProjectUpdatePayload extends SuccessPayload {
  projectUpdate?: ProjectUpdate | null
}

// =============================================================================
// Project Link Types
// =============================================================================

/**
 * Project link
 */
export interface ProjectLink {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  url: string
  label: string
  project: Project
  creator: User
}

// =============================================================================
// Cycle Types
// =============================================================================

/**
 * Cycle sort options
 */
export type CycleSortOption = 'createdAt' | 'startsAt' | 'endsAt' | 'number'

/**
 * Linear Cycle object (Sprint)
 */
export interface Cycle {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  number: number
  name?: string | null
  description?: string | null
  startsAt: DateTime
  endsAt: DateTime
  completedAt?: DateTime | null
  autoArchivedAt?: DateTime | null
  progress: number
  scopeHistory: number[]
  completedScopeHistory: number[]
  issueCountHistory: number[]
  completedIssueCountHistory: number[]

  // Relationships
  team: Team

  // Relationship methods
  issues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  uncompletedIssuesUponClose?: (args?: PaginationArgs) => Promise<Connection<Issue>>
}

/**
 * Cycle filter arguments
 */
export interface CycleFilterArgs extends PaginationArgs {
  filter?: CycleFilter
  orderBy?: CycleSortOption
}

/**
 * Cycle filter type
 */
export interface CycleFilter {
  id?: StringComparator
  number?: NumberComparator
  name?: StringComparator
  startsAt?: DateComparator
  endsAt?: DateComparator
  completedAt?: DateComparator
  team?: { id?: StringComparator }
  isActive?: { eq?: boolean }
  and?: CycleFilter[]
  or?: CycleFilter[]
}

/**
 * Input for creating a cycle
 */
export interface CycleCreateInput {
  teamId: ID
  name?: string
  description?: string
  startsAt: DateTime
  endsAt: DateTime
}

/**
 * Input for updating a cycle
 */
export interface CycleUpdateInput {
  name?: string | null
  description?: string | null
  startsAt?: DateTime
  endsAt?: DateTime
  completedAt?: DateTime | null
}

/**
 * Cycle mutation payload
 */
export interface CyclePayload extends SuccessPayload {
  cycle?: Cycle | null
}

// =============================================================================
// Comment Types
// =============================================================================

/**
 * Comment filter arguments
 */
export interface CommentFilterArgs extends PaginationArgs {
  filter?: CommentFilter
}

/**
 * Comment filter type
 */
export interface CommentFilter {
  id?: StringComparator
  body?: StringComparator
  createdAt?: DateComparator
  updatedAt?: DateComparator
  issue?: { id?: StringComparator }
  user?: { id?: StringComparator }
  and?: CommentFilter[]
  or?: CommentFilter[]
}

/**
 * Linear Comment object
 */
export interface Comment {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  body: string
  bodyData?: string | null
  editedAt?: DateTime | null
  url: string

  // Relationships
  issue: Issue
  user: User
  parent?: Comment | null
  resolvingUser?: User | null
  resolvingComment?: Comment | null

  // Relationship methods
  children?: (args?: PaginationArgs) => Promise<Connection<Comment>>
  reactions?: (args?: PaginationArgs) => Promise<Connection<Reaction>>
}

/**
 * Input for creating a comment
 */
export interface CommentCreateInput {
  issueId: ID
  body: string
  bodyData?: string
  parentId?: ID
}

/**
 * Input for updating a comment
 */
export interface CommentUpdateInput {
  body?: string
  bodyData?: string
}

/**
 * Comment mutation payload
 */
export interface CommentPayload extends SuccessPayload {
  comment?: Comment | null
}

// =============================================================================
// Reaction Types
// =============================================================================

/**
 * Emoji reaction
 */
export interface Reaction {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  emoji: string
  user: User
  comment?: Comment | null
  projectUpdate?: ProjectUpdate | null
}

/**
 * Input for creating a reaction
 */
export interface ReactionCreateInput {
  emoji: string
  commentId?: ID
  projectUpdateId?: ID
}

/**
 * Reaction mutation payload
 */
export interface ReactionPayload extends SuccessPayload {
  reaction?: Reaction | null
}

// =============================================================================
// Label Types
// =============================================================================

/**
 * Issue label
 */
export interface IssueLabel {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  description?: string | null
  color: string
  isGroup: boolean

  // Relationships
  team?: Team | null
  parent?: IssueLabel | null
  creator?: User | null

  // Relationship methods
  children?: (args?: PaginationArgs) => Promise<Connection<IssueLabel>>
  issues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
}

/**
 * Label filter arguments
 */
export interface LabelFilterArgs extends PaginationArgs {
  filter?: LabelFilter
}

/**
 * Label filter type
 */
export interface LabelFilter {
  id?: StringComparator
  name?: StringComparator
  team?: { id?: StringComparator }
  and?: LabelFilter[]
  or?: LabelFilter[]
}

/**
 * Input for creating a label
 */
export interface IssueLabelCreateInput {
  teamId?: ID
  name: string
  color: string
  description?: string
  parentId?: ID
}

/**
 * Input for updating a label
 */
export interface IssueLabelUpdateInput {
  name?: string
  color?: string
  description?: string | null
  parentId?: ID | null
}

/**
 * Label mutation payload
 */
export interface IssueLabelPayload extends SuccessPayload {
  issueLabel?: IssueLabel | null
}

// =============================================================================
// User Types
// =============================================================================

/**
 * Linear User object
 */
export interface User {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  displayName: string
  email: string
  avatarUrl?: string | null
  admin: boolean
  active: boolean
  guest: boolean
  url: string
  description?: string | null
  timezone?: string | null
  lastSeen?: DateTime | null
  statusEmoji?: string | null
  statusLabel?: string | null
  statusUntilAt?: DateTime | null

  // Relationships
  organization?: Organization

  // Relationship methods
  assignedIssues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  createdIssues?: (args?: IssueFilterArgs) => Promise<Connection<Issue>>
  teams?: (args?: PaginationArgs) => Promise<Connection<Team>>
}

/**
 * Input for updating a user
 */
export interface UserUpdateInput {
  name?: string
  displayName?: string
  avatarUrl?: string | null
  description?: string | null
  timezone?: string | null
  statusEmoji?: string | null
  statusLabel?: string | null
  statusUntilAt?: DateTime | null
}

/**
 * User mutation payload
 */
export interface UserPayload extends SuccessPayload {
  user?: User | null
}

// =============================================================================
// Organization Types
// =============================================================================

/**
 * Linear Organization object
 */
export interface Organization {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  name: string
  urlKey: string
  logoUrl?: string | null
  samlEnabled: boolean
  scimEnabled: boolean
  allowedAuthServices: string[]
  userCount: number
  periodUploadVolume: number
  gitBranchFormat?: string | null
  gitLinkbackMessagesEnabled: boolean
  gitPublicLinkbackMessagesEnabled: boolean
  roadmapEnabled: boolean
  createdIssueCount: number

  // Relationship methods
  teams?: (args?: PaginationArgs) => Promise<Connection<Team>>
  users?: (args?: PaginationArgs) => Promise<Connection<User>>
  integrations?: (args?: PaginationArgs) => Promise<Connection<Integration>>
  labels?: (args?: LabelFilterArgs) => Promise<Connection<IssueLabel>>
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Issue attachment
 */
export interface Attachment {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  title: string
  subtitle?: string | null
  url: string
  iconUrl?: string | null
  metadata?: JSONObject | null
  sourceType?: string | null
  source?: JSONObject | null
  groupBySource: boolean
  creator?: User | null
  issue: Issue
}

/**
 * Input for creating an attachment
 */
export interface AttachmentCreateInput {
  issueId: ID
  title: string
  subtitle?: string
  url: string
  iconUrl?: string
  metadata?: JSONObject
}

/**
 * Attachment payload
 */
export interface AttachmentPayload extends SuccessPayload {
  attachment?: Attachment | null
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook resource types
 */
export type WebhookResourceType =
  | 'Issue'
  | 'IssueLabel'
  | 'Comment'
  | 'Cycle'
  | 'Project'
  | 'ProjectUpdate'
  | 'Reaction'

/**
 * Webhook action types
 */
export type WebhookAction = 'create' | 'update' | 'remove'

/**
 * Webhook configuration
 */
export interface Webhook {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  url: string
  label?: string | null
  enabled: boolean
  secret?: string | null
  resourceTypes: WebhookResourceType[]
  allPublicTeams: boolean

  // Relationships
  team?: Team | null
  creator?: User | null
}

/**
 * Input for creating a webhook
 */
export interface WebhookCreateInput {
  url: string
  teamId?: ID
  allPublicTeams?: boolean
  label?: string
  enabled?: boolean
  resourceTypes: WebhookResourceType[]
  secret?: string
}

/**
 * Input for updating a webhook
 */
export interface WebhookUpdateInput {
  url?: string
  label?: string | null
  enabled?: boolean
  resourceTypes?: WebhookResourceType[]
  secret?: string | null
}

/**
 * Webhook mutation payload
 */
export interface WebhookPayload extends SuccessPayload {
  webhook?: Webhook | null
}

/**
 * Webhook event payload delivered to endpoints
 */
export interface WebhookDeliveryPayload {
  action: WebhookAction
  type: WebhookResourceType
  createdAt: DateTime
  url: string
  webhookTimestamp: number
  webhookId: ID
  organizationId: ID
  data: Record<string, unknown>
  updatedFrom?: Record<string, unknown>
}

// =============================================================================
// Integration Types
// =============================================================================

/**
 * Third-party integration
 */
export interface Integration {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  service: string
  organization: Organization
  team?: Team | null
  creator: User
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * Search result types
 */
export interface IssueSearchResult {
  nodes: Issue[]
  pageInfo: PageInfo
}

export interface ProjectSearchResult {
  nodes: Project[]
  pageInfo: PageInfo
}

// =============================================================================
// Client Configuration
// =============================================================================

/**
 * Linear client configuration
 */
export interface LinearClientConfig {
  apiKey?: string
  accessToken?: string
  apiUrl?: string
}

/**
 * LinearLocal configuration
 */
export interface LinearLocalConfig {
  webhooks?: boolean
  onWebhookEvent?: (event: WebhookDeliveryPayload) => void | Promise<void>
}
