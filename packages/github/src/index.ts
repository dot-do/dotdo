/**
 * @dotdo/github - Octokit-compatible GitHub SDK
 *
 * A lightweight, Octokit-compatible GitHub API client that works
 * in Cloudflare Workers and edge environments.
 *
 * @example
 * ```typescript
 * import { Octokit } from '@dotdo/github'
 *
 * const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
 *
 * // Get a repository
 * const { data: repo } = await octokit.rest.repos.get({
 *   owner: 'dotdo-dev',
 *   repo: 'dotdo',
 * })
 *
 * // Create an issue
 * const { data: issue } = await octokit.rest.issues.create({
 *   owner: 'dotdo-dev',
 *   repo: 'dotdo',
 *   title: 'Bug: Something is broken',
 *   body: 'Description of the bug',
 * })
 *
 * // Create a pull request
 * const { data: pr } = await octokit.rest.pulls.create({
 *   owner: 'dotdo-dev',
 *   repo: 'dotdo',
 *   title: 'Add new feature',
 *   head: 'feature-branch',
 *   base: 'main',
 * })
 * ```
 *
 * @see https://docs.github.com/en/rest
 */

// Client and base types
export { Octokit, GitHubError, RequestError } from './client'
export type { OctokitOptions, OctokitResponse, RequestOptions } from './client'

// Repos API
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

// Issues API
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

// Pulls API
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

// Actions API
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

// Users API
export { UsersAPI } from './users'
export type { User, PublicUser, SocialAccount } from './users'

// Webhooks
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
  WebhookPayloadBase,
  PushPayload,
  PullRequestPayload,
  IssuesPayload,
  IssueCommentPayload,
  WorkflowRunPayload,
  ReleasePayload,
  PingPayload,
  WebhookPayload,
  WebhookHandler,
  WebhookHandlers,
  WebhookEnv,
} from './webhooks'

// Response types for convenience
export type RepoResponse = import('./repos').Repository
export type IssueResponse = import('./issues').Issue
export type PullRequestResponse = import('./pulls').PullRequest
export type WorkflowDispatchResponse = void
