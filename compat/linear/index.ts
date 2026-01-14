/**
 * @dotdo/linear - Linear SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Linear SDK that runs entirely locally.
 * Uses dotdo primitives:
 * - TemporalStore for issue/project state with time-travel queries
 * - WindowManager for cycle/sprint management
 *
 * Perfect for:
 * - Testing without network calls
 * - Edge deployment (Cloudflare Workers)
 * - Development environments
 *
 * @example Basic Usage
 * ```typescript
 * import { LinearClient } from '@dotdo/linear'
 *
 * // Create client (uses local implementation by default)
 * const linear = new LinearClient({ apiKey: 'test' })
 *
 * // Create a team
 * const { team } = await linear.teamCreate({
 *   name: 'Engineering',
 *   key: 'ENG',
 * })
 *
 * // Create issues
 * const { issue } = await linear.issueCreate({
 *   teamId: team.id,
 *   title: 'Implement authentication',
 *   priority: 1,
 * })
 *
 * // Update issue
 * await linear.issueUpdate(issue.id, {
 *   description: 'Add OAuth2 and SAML support',
 * })
 * ```
 *
 * @example Local Development
 * ```typescript
 * import { LinearLocal } from '@dotdo/linear'
 *
 * const linear = new LinearLocal({
 *   webhooks: true,
 *   onWebhookEvent: (event) => {
 *     console.log('Webhook:', event.type, event.action)
 *   },
 * })
 *
 * // Create team and issues
 * const { team } = await linear.teamCreate({ name: 'Product', key: 'PROD' })
 * const { issue } = await linear.issueCreate({
 *   teamId: team.id,
 *   title: 'Ship MVP',
 * })
 *
 * // Time-travel query (dotdo extension)
 * const issueYesterday = await linear.issueAsOf(issue.id, Date.now() - 86400000)
 * ```
 *
 * @example Projects and Cycles
 * ```typescript
 * import { LinearLocal } from '@dotdo/linear'
 *
 * const linear = new LinearLocal()
 *
 * // Create team
 * const { team } = await linear.teamCreate({ name: 'Engineering', key: 'ENG' })
 *
 * // Create project
 * const { project } = await linear.projectCreate({
 *   name: 'Q1 Launch',
 *   teamIds: [team.id],
 *   targetDate: '2025-03-31',
 * })
 *
 * // Create sprint/cycle
 * const { cycle } = await linear.cycleCreate({
 *   teamId: team.id,
 *   name: 'Sprint 1',
 *   startsAt: new Date().toISOString(),
 *   endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
 * })
 *
 * // Add issues to project and sprint
 * await linear.issueCreate({
 *   teamId: team.id,
 *   title: 'User story 1',
 *   projectId: project.id,
 *   cycleId: cycle.id,
 * })
 * ```
 *
 * @example Webhook Signature Verification
 * ```typescript
 * import { LinearLocal } from '@dotdo/linear'
 *
 * // Verify webhook signature
 * const isValid = await LinearLocal.webhooks.verifyRequest(
 *   req.body,
 *   {
 *     'linear-signature': req.headers['linear-signature'],
 *     'linear-timestamp': req.headers['linear-timestamp'],
 *   },
 *   process.env.LINEAR_WEBHOOK_SECRET
 * )
 *
 * if (!isValid) {
 *   return new Response('Invalid signature', { status: 401 })
 * }
 * ```
 *
 * @see https://linear.app/developers
 */

// =============================================================================
// Core Exports
// =============================================================================

export {
  // Main clients
  LinearLocal,
  LinearClient,
} from './client'

// Default export
export { default } from './client'

// =============================================================================
// Resource Exports
// =============================================================================

export { LocalIssuesResource } from './issues'
export { LocalProjectsResource } from './projects'
export { LocalCyclesResource } from './cycles'
export { LocalWebhooksResource, WebhookUtils } from './webhooks'

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core
  ID,
  DateTime,
  JSONObject,
  Connection,
  PageInfo,
  PaginationArgs,
  SuccessPayload,

  // Comparators
  NumberComparator,
  StringComparator,
  DateComparator,

  // Teams
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamPayload,

  // Issues
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssuePayload,
  IssueArchivePayload,
  IssueBatchPayload,
  IssueFilterArgs,
  IssueFilter,
  IssuePriority,
  IssueSortOption,
  IssueHistory,
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
  ProjectCreateInput,
  ProjectUpdateInput,
  ProjectPayload,
  ProjectFilterArgs,
  ProjectFilter,
  ProjectSortOption,
  ProjectMilestone,
  ProjectMilestoneCreateInput,
  ProjectMilestoneUpdateInput,
  ProjectMilestonePayload,
  ProjectUpdate,
  ProjectUpdateHealth,
  ProjectUpdateCreateInput,
  ProjectUpdatePayload,
  ProjectLink,

  // Cycles
  Cycle,
  CycleCreateInput,
  CycleUpdateInput,
  CyclePayload,
  CycleFilterArgs,
  CycleFilter,
  CycleSortOption,

  // Comments
  Comment,
  CommentCreateInput,
  CommentUpdateInput,
  CommentPayload,
  CommentFilterArgs,
  CommentFilter,

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

  // Organization
  Organization,

  // Webhooks
  Webhook,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookPayload,
  WebhookResourceType,
  WebhookAction,
  WebhookDeliveryPayload,

  // Reactions
  Reaction,
  ReactionCreateInput,
  ReactionPayload,

  // Attachments
  Attachment,
  AttachmentCreateInput,
  AttachmentPayload,

  // Integrations
  Integration,

  // Search
  IssueSearchResult,
  ProjectSearchResult,

  // Config
  LinearClientConfig,
  LinearLocalConfig,
} from './types'
