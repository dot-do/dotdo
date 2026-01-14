/**
 * @dotdo/jira - Jira REST API Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Jira REST API that runs entirely locally.
 * Uses dotdo primitives:
 * - TemporalStore for issue state with history tracking
 * - Entity for project/sprint management
 *
 * Compatible with Jira Cloud REST API v3:
 * - /rest/api/3/issue
 * - /rest/api/3/project
 * - /rest/api/3/search
 *
 * @example Basic Usage
 * ```typescript
 * import { JiraClient } from '@dotdo/jira'
 *
 * const jira = new JiraClient({
 *   host: 'your-domain.atlassian.net',
 *   email: 'you@example.com',
 *   apiToken: 'your-api-token',
 * })
 *
 * // Create an issue
 * const issue = await jira.issues.create({
 *   fields: {
 *     project: { key: 'PROJ' },
 *     summary: 'Fix login bug',
 *     issuetype: { name: 'Bug' },
 *   },
 * })
 *
 * // Transition issue
 * await jira.issues.transition(issue.key, {
 *   transition: { id: '21' }, // In Progress
 * })
 * ```
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

// =============================================================================
// Core Exports
// =============================================================================

export { JiraLocal, JiraClient } from './client'

// Default export
export { default } from './client'

// =============================================================================
// Resource Exports
// =============================================================================

export { LocalIssuesResource } from './issues'
export { LocalProjectsResource } from './projects'
export { LocalWebhooksResource } from './webhooks'

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core
  JiraClientConfig,
  JiraLocalConfig,

  // Issues
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssueTransitionInput,
  IssueFields,
  IssueType,
  IssuePriority,
  IssueStatus,
  IssueResolution,
  IssueLink,
  IssueLinkType,
  IssueComment,
  IssueWorklog,
  IssueAttachment,
  IssueChangelog,
  IssueChangelogItem,
  IssueHistory,

  // Projects
  Project,
  ProjectCategory,
  ProjectComponent,
  ProjectVersion,

  // Users
  User,
  AccountId,

  // Search
  JqlSearchResult,
  JqlSearchOptions,

  // Sprints (Agile)
  Sprint,
  Board,

  // Webhooks
  Webhook,
  WebhookEvent,
  WebhookPayload,

  // Pagination
  PageBean,
  SearchResults,
} from './types'
