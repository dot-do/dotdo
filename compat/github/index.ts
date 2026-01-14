/**
 * @dotdo/github - Octokit-compatible GitHub SDK
 *
 * A lightweight, Octokit-compatible GitHub API client designed for
 * Cloudflare Workers and edge environments.
 *
 * @example
 * ```typescript
 * import { Octokit } from '@dotdo/github'
 *
 * const octokit = new Octokit({ auth: 'ghp_xxx' })
 *
 * // Get a repository
 * const { data: repo } = await octokit.rest.repos.get({
 *   owner: 'octocat',
 *   repo: 'hello-world',
 * })
 *
 * // Create an issue
 * const { data: issue } = await octokit.rest.issues.create({
 *   owner: 'octocat',
 *   repo: 'hello-world',
 *   title: 'Bug report',
 *   body: 'Something is broken',
 * })
 *
 * // Create a pull request
 * const { data: pr } = await octokit.rest.pulls.create({
 *   owner: 'octocat',
 *   repo: 'hello-world',
 *   title: 'Add new feature',
 *   head: 'feature-branch',
 *   base: 'main',
 * })
 *
 * // Trigger a workflow
 * await octokit.rest.actions.createWorkflowDispatch({
 *   owner: 'octocat',
 *   repo: 'hello-world',
 *   workflow_id: 'deploy.yml',
 *   ref: 'main',
 *   inputs: { environment: 'production' },
 * })
 * ```
 *
 * @see https://docs.github.com/en/rest
 */

// ============================================================================
// Client & Errors
// ============================================================================

export { Octokit, GitHubError, RequestError } from './client'
export type { OctokitOptions, RequestOptions, OctokitResponse } from './client'

// ============================================================================
// Repos API
// ============================================================================

export { ReposAPI } from './repos'
export type {
  Repository,
  Branch,
  GetRepoParams,
  ListForOrgParams,
  ListForAuthenticatedUserParams,
  CreateRepoParams,
  UpdateRepoParams,
  ListBranchesParams,
  GetBranchParams,
} from './repos'

// ============================================================================
// Issues API
// ============================================================================

export { IssuesAPI } from './issues'
export type {
  Issue,
  IssueComment,
  CreateIssueParams,
  GetIssueParams,
  UpdateIssueParams,
  ListIssuesParams,
  CreateCommentParams,
  ListCommentsParams,
  UpdateCommentParams,
  DeleteCommentParams,
  AddLabelsParams,
  RemoveLabelParams,
  AddAssigneesParams,
  RemoveAssigneesParams,
} from './issues'

// ============================================================================
// Pulls API
// ============================================================================

export { PullsAPI } from './pulls'
export type {
  PullRequest,
  PullRequestFile,
  MergeResult,
  Review,
  CreatePullParams,
  GetPullParams,
  UpdatePullParams,
  ListPullsParams,
  MergePullParams,
  ListFilesParams,
  RequestReviewersParams,
  ListReviewsParams,
  CreateReviewParams,
} from './pulls'

// ============================================================================
// Actions API
// ============================================================================

export { ActionsAPI } from './actions'
export type {
  Workflow,
  WorkflowRun,
  WorkflowJob,
  Artifact,
  WorkflowDispatchParams,
  ListWorkflowRunsParams,
  GetWorkflowRunParams,
  ListJobsParams,
  ListArtifactsParams,
  DownloadArtifactParams,
} from './actions'

// ============================================================================
// Users API
// ============================================================================

export { UsersAPI } from './users'
export type { User, PublicUser, SocialAccount } from './users'

// ============================================================================
// Webhooks
// ============================================================================

export {
  verifyWebhookSignature,
  parseWebhookPayload,
  getDeliveryId,
  getEventName,
  getSignature,
  createWebhookHandler,
  createWebhookRouter,
} from './webhooks'

export type {
  WebhookEventName,
  WebhookPayload,
  WebhookPayloadBase,
  PushPayload,
  PullRequestPayload,
  IssuesPayload,
  IssueCommentPayload,
  WorkflowRunPayload,
  ReleasePayload,
  PingPayload,
  WebhookHandler,
  WebhookHandlers,
  WebhookEnv,
} from './webhooks'

// ============================================================================
// Response Types (for Octokit compatibility)
// ============================================================================

export type RepoResponse = OctokitResponse<Repository>
export type IssueResponse = OctokitResponse<Issue>
export type PullRequestResponse = OctokitResponse<PullRequest>
export type WorkflowDispatchResponse = OctokitResponse<void>

// Re-export for convenience
import type { OctokitResponse } from './client'
import type { Repository } from './repos'
import type { Issue } from './issues'
import type { PullRequest } from './pulls'
