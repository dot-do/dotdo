/**
 * @dotdo/linear - Linear SDK compatible client for Cloudflare Workers
 *
 * Provides a drop-in replacement for the Linear SDK with:
 * - In-memory backend for testing and edge deployment
 * - Full API compatibility with Linear SDK
 * - Time-travel queries (dotdo extension)
 * - Webhook signature verification
 *
 * @example
 * ```typescript
 * import { LinearLocal } from '@dotdo/linear'
 *
 * const linear = new LinearLocal()
 *
 * // Create a team
 * const team = await linear.teamCreate({ name: 'Engineering', key: 'ENG' })
 *
 * // Create an issue
 * const issue = await linear.issueCreate({
 *   teamId: team.team!.id,
 *   title: 'Implement feature X',
 *   priority: 2,
 * })
 *
 * // List issues
 * const issues = await linear.issues({ first: 10 })
 * ```
 *
 * @module @dotdo/linear
 */

// Main client exports
export { LinearLocal, LinearClient, WebhookUtils } from './client'
export type { LinearLocalConfig, LinearClientConfig } from './types'

// Re-export all types
export type {
  // Core types
  ID,
  DateTime,
  JSONObject,
  Connection,
  PageInfo,
  PaginationArgs,
  NumberComparator,
  StringComparator,
  DateComparator,
  SuccessPayload,
  // Teams
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamPayload,
  // Issues
  Issue,
  IssuePriority,
  IssueSortOption,
  IssueCreateInput,
  IssueUpdateInput,
  IssuePayload,
  IssueArchivePayload,
  IssueBatchPayload,
  IssueFilterArgs,
  IssueFilter,
  IssueHistory,
  // Issue Relations
  IssueRelation,
  IssueRelationType,
  IssueRelationCreateInput,
  IssueRelationPayload,
  // Workflow States
  WorkflowState,
  WorkflowStateType,
  WorkflowStateCreateInput,
  WorkflowStateUpdateInput,
  WorkflowStatePayload,
  // Projects
  Project,
  ProjectState,
  ProjectSortOption,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectPayload,
  ProjectFilterArgs,
  ProjectFilter,
  // Project Milestones
  ProjectMilestone,
  ProjectMilestoneCreateInput,
  ProjectMilestoneUpdateInput,
  ProjectMilestonePayload,
  // Project Updates
  ProjectUpdate,
  ProjectUpdateHealth,
  ProjectUpdateCreateInput,
  ProjectUpdatePayload,
  // Project Links
  ProjectLink,
  // Cycles
  Cycle,
  CycleSortOption,
  CycleCreateInput,
  CycleUpdateInput,
  CyclePayload,
  CycleFilterArgs,
  CycleFilter,
  // Comments
  Comment,
  CommentCreateInput,
  CommentUpdateInput,
  CommentPayload,
  CommentFilterArgs,
  CommentFilter,
  // Reactions
  Reaction,
  ReactionCreateInput,
  ReactionPayload,
  // Labels
  IssueLabel,
  IssueLabelCreateInput,
  IssueLabelUpdateInput,
  IssueLabelPayload,
  LabelFilterArgs,
  LabelFilter,
  // Users
  User,
  UserUpdateInput,
  UserPayload,
  // Organizations
  Organization,
  // Attachments
  Attachment,
  AttachmentCreateInput,
  AttachmentPayload,
  // Webhooks
  Webhook,
  WebhookResourceType,
  WebhookAction,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookPayload,
  WebhookDeliveryPayload,
  // Integrations
  Integration,
  // Search
  IssueSearchResult,
  ProjectSearchResult,
} from './types'

// Backend exports
export { MemoryTemporalStore, createTemporalStore, SimpleEventEmitter } from './backends/memory'

// Default export
export { LinearLocal as default } from './client'
