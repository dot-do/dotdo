/**
 * Jira REST API v3 Compatible Types
 *
 * Based on: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

// =============================================================================
// Core Types
// =============================================================================

export type AccountId = string
export type IssueId = string
export type IssueKey = string
export type ProjectId = string
export type ProjectKey = string
export type DateTime = string // ISO 8601 format

// =============================================================================
// Configuration
// =============================================================================

export interface JiraClientConfig {
  /** Jira Cloud host (e.g., 'your-domain.atlassian.net') */
  host: string
  /** User email for authentication */
  email: string
  /** API token for authentication */
  apiToken: string
  /** Optional: API version (default: 3) */
  apiVersion?: number
}

export interface JiraLocalConfig {
  /** Enable webhook event emission */
  webhooks?: boolean
  /** Webhook event callback */
  onWebhookEvent?: (event: WebhookPayload) => void
  /** Default project key prefix */
  defaultProjectKey?: string
}

// =============================================================================
// Users
// =============================================================================

export interface User {
  /** Account ID (Atlassian account identifier) */
  accountId: AccountId
  /** Email address */
  emailAddress?: string
  /** Display name */
  displayName: string
  /** Whether the account is active */
  active: boolean
  /** Avatar URLs */
  avatarUrls?: {
    '16x16'?: string
    '24x24'?: string
    '32x32'?: string
    '48x48'?: string
  }
  /** Account type */
  accountType?: 'atlassian' | 'app' | 'customer'
  /** Self URL */
  self?: string
  /** Time zone */
  timeZone?: string
}

// =============================================================================
// Projects
// =============================================================================

export interface Project {
  /** Project ID */
  id: ProjectId
  /** Project key (e.g., 'PROJ') */
  key: ProjectKey
  /** Project name */
  name: string
  /** Project description */
  description?: string
  /** Project lead */
  lead?: User
  /** Project category */
  projectCategory?: ProjectCategory
  /** Project type key */
  projectTypeKey?: 'software' | 'service_desk' | 'business'
  /** Whether the project is simplified (next-gen) */
  simplified?: boolean
  /** Avatar URLs */
  avatarUrls?: {
    '16x16'?: string
    '24x24'?: string
    '32x32'?: string
    '48x48'?: string
  }
  /** Self URL */
  self?: string
  /** Project components */
  components?: ProjectComponent[]
  /** Project versions */
  versions?: ProjectVersion[]
  /** Issue types available in project */
  issueTypes?: IssueType[]
}

export interface ProjectCategory {
  /** Category ID */
  id: string
  /** Category name */
  name: string
  /** Category description */
  description?: string
  /** Self URL */
  self?: string
}

export interface ProjectComponent {
  /** Component ID */
  id: string
  /** Component name */
  name: string
  /** Component description */
  description?: string
  /** Component lead */
  lead?: User
  /** Self URL */
  self?: string
  /** Project key */
  project?: string
  /** Assignee type */
  assigneeType?: 'PROJECT_DEFAULT' | 'COMPONENT_LEAD' | 'PROJECT_LEAD' | 'UNASSIGNED'
}

export interface ProjectVersion {
  /** Version ID */
  id: string
  /** Version name */
  name: string
  /** Version description */
  description?: string
  /** Whether the version is archived */
  archived?: boolean
  /** Whether the version is released */
  released?: boolean
  /** Release date */
  releaseDate?: DateTime
  /** Start date */
  startDate?: DateTime
  /** Project ID */
  projectId?: number
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Types
// =============================================================================

export interface IssueType {
  /** Issue type ID */
  id: string
  /** Issue type name */
  name: string
  /** Issue type description */
  description?: string
  /** Icon URL */
  iconUrl?: string
  /** Whether this is a subtask type */
  subtask: boolean
  /** Avatar ID */
  avatarId?: number
  /** Hierarchy level */
  hierarchyLevel?: number
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Priority
// =============================================================================

export interface IssuePriority {
  /** Priority ID */
  id: string
  /** Priority name (e.g., 'Highest', 'High', 'Medium', 'Low', 'Lowest') */
  name: string
  /** Priority description */
  description?: string
  /** Icon URL */
  iconUrl?: string
  /** Status color */
  statusColor?: string
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Status
// =============================================================================

export interface IssueStatus {
  /** Status ID */
  id: string
  /** Status name */
  name: string
  /** Status description */
  description?: string
  /** Icon URL */
  iconUrl?: string
  /** Status category */
  statusCategory: StatusCategory
  /** Self URL */
  self?: string
}

export interface StatusCategory {
  /** Category ID */
  id: number
  /** Category key */
  key: 'new' | 'indeterminate' | 'done'
  /** Category name */
  name: string
  /** Category color name */
  colorName: string
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Resolution
// =============================================================================

export interface IssueResolution {
  /** Resolution ID */
  id: string
  /** Resolution name */
  name: string
  /** Resolution description */
  description?: string
  /** Self URL */
  self?: string
}

// =============================================================================
// Issues
// =============================================================================

export interface Issue {
  /** Issue ID */
  id: IssueId
  /** Issue key (e.g., 'PROJ-123') */
  key: IssueKey
  /** Self URL */
  self?: string
  /** Issue fields */
  fields: IssueFields
  /** Changelog (if expanded) */
  changelog?: IssueChangelog
  /** Rendered fields (if expanded) */
  renderedFields?: Partial<IssueFields>
  /** Transitions available (if expanded) */
  transitions?: IssueTransition[]
  /** Names (field name mappings) */
  names?: Record<string, string>
  /** Schema (field schemas) */
  schema?: Record<string, unknown>
}

export interface IssueFields {
  /** Summary (title) */
  summary: string
  /** Description (Atlassian Document Format or string) */
  description?: AtlassianDocumentFormat | string | null
  /** Issue type */
  issuetype: IssueType
  /** Project */
  project: Pick<Project, 'id' | 'key' | 'name' | 'self'>
  /** Status */
  status: IssueStatus
  /** Priority */
  priority?: IssuePriority
  /** Resolution */
  resolution?: IssueResolution | null
  /** Assignee */
  assignee?: User | null
  /** Reporter */
  reporter?: User
  /** Creator */
  creator?: User
  /** Created timestamp */
  created: DateTime
  /** Updated timestamp */
  updated: DateTime
  /** Resolution date */
  resolutiondate?: DateTime | null
  /** Due date */
  duedate?: DateTime | null
  /** Labels */
  labels?: string[]
  /** Components */
  components?: ProjectComponent[]
  /** Fix versions */
  fixVersions?: ProjectVersion[]
  /** Affects versions */
  versions?: ProjectVersion[]
  /** Parent issue (for subtasks) */
  parent?: Pick<Issue, 'id' | 'key' | 'fields'> & { fields: Pick<IssueFields, 'summary' | 'status' | 'issuetype'> }
  /** Subtasks */
  subtasks?: Pick<Issue, 'id' | 'key' | 'fields'>[]
  /** Issue links */
  issuelinks?: IssueLink[]
  /** Comments */
  comment?: {
    comments: IssueComment[]
    total: number
    maxResults: number
    startAt: number
  }
  /** Worklogs */
  worklog?: {
    worklogs: IssueWorklog[]
    total: number
    maxResults: number
    startAt: number
  }
  /** Attachments */
  attachment?: IssueAttachment[]
  /** Time tracking */
  timetracking?: {
    originalEstimate?: string
    remainingEstimate?: string
    timeSpent?: string
    originalEstimateSeconds?: number
    remainingEstimateSeconds?: number
    timeSpentSeconds?: number
  }
  /** Story points (custom field - commonly 'customfield_10016') */
  storyPoints?: number
  /** Sprint (custom field - commonly 'customfield_10020') */
  sprint?: Sprint | null
  /** Epic link (custom field - commonly 'customfield_10014') */
  epicLink?: string | null
  /** Custom fields */
  [key: `customfield_${number}`]: unknown
}

// =============================================================================
// Atlassian Document Format (ADF)
// =============================================================================

export interface AtlassianDocumentFormat {
  type: 'doc'
  version: 1
  content: AtlassianDocumentNode[]
}

export interface AtlassianDocumentNode {
  type: string
  content?: AtlassianDocumentNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
}

// =============================================================================
// Issue Links
// =============================================================================

export interface IssueLink {
  /** Link ID */
  id: string
  /** Link type */
  type: IssueLinkType
  /** Inward issue (this issue blocks/is blocked by) */
  inwardIssue?: Pick<Issue, 'id' | 'key' | 'fields'> & { fields: Pick<IssueFields, 'summary' | 'status' | 'issuetype'> }
  /** Outward issue (this issue blocks/is blocked by) */
  outwardIssue?: Pick<Issue, 'id' | 'key' | 'fields'> & { fields: Pick<IssueFields, 'summary' | 'status' | 'issuetype'> }
  /** Self URL */
  self?: string
}

export interface IssueLinkType {
  /** Link type ID */
  id: string
  /** Link type name */
  name: string
  /** Inward description (e.g., 'is blocked by') */
  inward: string
  /** Outward description (e.g., 'blocks') */
  outward: string
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Transitions
// =============================================================================

export interface IssueTransition {
  /** Transition ID */
  id: string
  /** Transition name */
  name: string
  /** Target status */
  to: IssueStatus
  /** Whether the transition has a screen */
  hasScreen?: boolean
  /** Whether the transition is global */
  isGlobal?: boolean
  /** Whether the transition is initial */
  isInitial?: boolean
  /** Whether the transition is conditional */
  isConditional?: boolean
  /** Fields available during transition */
  fields?: Record<string, TransitionField>
}

export interface TransitionField {
  /** Whether the field is required */
  required: boolean
  /** Field schema */
  schema: {
    type: string
    items?: string
    system?: string
    custom?: string
    customId?: number
  }
  /** Field name */
  name: string
  /** Field key */
  key?: string
  /** Allowed values */
  allowedValues?: unknown[]
  /** Default value */
  defaultValue?: unknown
}

// =============================================================================
// Issue Comments
// =============================================================================

export interface IssueComment {
  /** Comment ID */
  id: string
  /** Author */
  author: User
  /** Body (ADF or string) */
  body: AtlassianDocumentFormat | string
  /** Update author */
  updateAuthor?: User
  /** Created timestamp */
  created: DateTime
  /** Updated timestamp */
  updated: DateTime
  /** Visibility restrictions */
  visibility?: {
    type: 'group' | 'role'
    value: string
  }
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Worklogs
// =============================================================================

export interface IssueWorklog {
  /** Worklog ID */
  id: string
  /** Author */
  author: User
  /** Update author */
  updateAuthor?: User
  /** Comment */
  comment?: AtlassianDocumentFormat | string
  /** Created timestamp */
  created: DateTime
  /** Updated timestamp */
  updated: DateTime
  /** Started timestamp */
  started: DateTime
  /** Time spent */
  timeSpent: string
  /** Time spent in seconds */
  timeSpentSeconds: number
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Attachments
// =============================================================================

export interface IssueAttachment {
  /** Attachment ID */
  id: string
  /** Filename */
  filename: string
  /** Author */
  author: User
  /** Created timestamp */
  created: DateTime
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Content URL */
  content: string
  /** Thumbnail URL */
  thumbnail?: string
  /** Self URL */
  self?: string
}

// =============================================================================
// Issue Changelog
// =============================================================================

export interface IssueChangelog {
  /** Start index */
  startAt: number
  /** Max results */
  maxResults: number
  /** Total count */
  total: number
  /** History entries */
  histories: IssueHistory[]
}

export interface IssueHistory {
  /** History entry ID */
  id: string
  /** Author of the change */
  author: User
  /** Created timestamp */
  created: DateTime
  /** Changed items */
  items: IssueChangelogItem[]
}

export interface IssueChangelogItem {
  /** Field name */
  field: string
  /** Field type */
  fieldtype: string
  /** Field ID */
  fieldId?: string
  /** Previous value (string representation) */
  fromString?: string | null
  /** Previous value (ID) */
  from?: string | null
  /** New value (string representation) */
  toString?: string | null
  /** New value (ID) */
  to?: string | null
}

// =============================================================================
// Agile (Sprints & Boards)
// =============================================================================

export interface Sprint {
  /** Sprint ID */
  id: number
  /** Sprint name */
  name: string
  /** Sprint state */
  state: 'future' | 'active' | 'closed'
  /** Start date */
  startDate?: DateTime
  /** End date */
  endDate?: DateTime
  /** Complete date */
  completeDate?: DateTime
  /** Origin board ID */
  originBoardId?: number
  /** Sprint goal */
  goal?: string
  /** Self URL */
  self?: string
}

export interface Board {
  /** Board ID */
  id: number
  /** Board name */
  name: string
  /** Board type */
  type: 'scrum' | 'kanban' | 'simple'
  /** Project location */
  location?: {
    projectId: number
    projectKey: string
    projectName: string
    displayName: string
    projectTypeKey: string
  }
  /** Self URL */
  self?: string
}

// =============================================================================
// Input Types
// =============================================================================

export interface IssueCreateInput {
  /** Issue fields */
  fields: {
    /** Project (required) */
    project: { id?: string; key?: string }
    /** Issue type (required) */
    issuetype: { id?: string; name?: string }
    /** Summary (required) */
    summary: string
    /** Description */
    description?: AtlassianDocumentFormat | string
    /** Priority */
    priority?: { id?: string; name?: string }
    /** Assignee */
    assignee?: { accountId: string } | null
    /** Reporter */
    reporter?: { accountId: string }
    /** Labels */
    labels?: string[]
    /** Components */
    components?: Array<{ id?: string; name?: string }>
    /** Fix versions */
    fixVersions?: Array<{ id?: string; name?: string }>
    /** Due date */
    duedate?: DateTime
    /** Parent (for subtasks) */
    parent?: { id?: string; key?: string }
    /** Time tracking */
    timetracking?: {
      originalEstimate?: string
      remainingEstimate?: string
    }
    /** Custom fields */
    [key: `customfield_${number}`]: unknown
  }
  /** Update operations (add/remove/set) */
  update?: Record<string, Array<{ add?: unknown; remove?: unknown; set?: unknown }>>
  /** History metadata */
  historyMetadata?: {
    type?: string
    description?: string
    actor?: User
  }
}

export interface IssueUpdateInput {
  /** Fields to update */
  fields?: Partial<IssueCreateInput['fields']>
  /** Update operations */
  update?: Record<string, Array<{ add?: unknown; remove?: unknown; set?: unknown }>>
  /** History metadata */
  historyMetadata?: {
    type?: string
    description?: string
    actor?: User
  }
  /** Properties to set */
  properties?: Array<{ key: string; value: unknown }>
}

export interface IssueTransitionInput {
  /** Transition to perform */
  transition: { id: string; name?: string }
  /** Fields to update during transition */
  fields?: Partial<IssueCreateInput['fields']>
  /** Update operations */
  update?: Record<string, Array<{ add?: unknown; remove?: unknown; set?: unknown }>>
  /** History metadata */
  historyMetadata?: {
    type?: string
    description?: string
  }
}

// =============================================================================
// Search / JQL
// =============================================================================

export interface JqlSearchOptions {
  /** JQL query string */
  jql?: string
  /** Start index */
  startAt?: number
  /** Max results */
  maxResults?: number
  /** Fields to include */
  fields?: string[]
  /** Expand options */
  expand?: string[]
  /** Validate query */
  validateQuery?: 'strict' | 'warn' | 'none'
}

export interface JqlSearchResult {
  /** Expand parameter value */
  expand?: string
  /** Start index */
  startAt: number
  /** Max results */
  maxResults: number
  /** Total count */
  total: number
  /** Issues */
  issues: Issue[]
  /** Warning messages */
  warningMessages?: string[]
  /** Field name mappings */
  names?: Record<string, string>
  /** Field schemas */
  schema?: Record<string, unknown>
}

export interface SearchResults<T> {
  /** Start index */
  startAt: number
  /** Max results */
  maxResults: number
  /** Total count */
  total: number
  /** Whether this is the last page */
  isLast: boolean
  /** Values */
  values: T[]
}

export interface PageBean<T> {
  /** Self URL */
  self?: string
  /** Next page URL */
  nextPage?: string
  /** Max results */
  maxResults: number
  /** Start index */
  startAt: number
  /** Total count */
  total: number
  /** Whether this is the last page */
  isLast: boolean
  /** Values */
  values: T[]
}

// =============================================================================
// Webhooks
// =============================================================================

export interface Webhook {
  /** Webhook ID */
  id: string
  /** Webhook URL */
  url: string
  /** Events to trigger on */
  events: WebhookEventType[]
  /** JQL filter */
  jqlFilter?: string
  /** Whether the webhook is enabled */
  enabled: boolean
  /** Self URL */
  self?: string
}

export type WebhookEventType =
  | 'jira:issue_created'
  | 'jira:issue_updated'
  | 'jira:issue_deleted'
  | 'comment_created'
  | 'comment_updated'
  | 'comment_deleted'
  | 'attachment_created'
  | 'attachment_deleted'
  | 'worklog_created'
  | 'worklog_updated'
  | 'worklog_deleted'
  | 'sprint_created'
  | 'sprint_updated'
  | 'sprint_deleted'
  | 'sprint_started'
  | 'sprint_closed'
  | 'board_created'
  | 'board_updated'
  | 'board_deleted'
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'

export interface WebhookEvent {
  /** Webhook event type */
  webhookEvent: WebhookEventType
  /** Timestamp */
  timestamp: number
  /** User who triggered the event */
  user?: User
}

export interface WebhookPayload extends WebhookEvent {
  /** Issue (for issue events) */
  issue?: Issue
  /** Comment (for comment events) */
  comment?: IssueComment
  /** Changelog (for update events) */
  changelog?: IssueChangelog
  /** Sprint (for sprint events) */
  sprint?: Sprint
  /** Project (for project events) */
  project?: Project
}

// =============================================================================
// API Response Types
// =============================================================================

export interface CreateIssueResponse {
  /** Issue ID */
  id: string
  /** Issue key */
  key: string
  /** Self URL */
  self: string
}

export interface BulkCreateIssueResponse {
  /** Created issues */
  issues: CreateIssueResponse[]
  /** Errors */
  errors: Array<{
    status: number
    elementErrors: {
      errorMessages: string[]
      errors: Record<string, string>
    }
    failedElementNumber: number
  }>
}

export interface ErrorResponse {
  /** Error messages */
  errorMessages: string[]
  /** Field-specific errors */
  errors: Record<string, string>
}
