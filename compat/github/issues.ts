/**
 * @dotdo/github - Issues API
 *
 * Implements GitHub Issues API endpoints.
 * @see https://docs.github.com/en/rest/issues
 */

import type { Octokit, OctokitResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Issue {
  id: number
  node_id?: string
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null
  user: {
    login: string
    id: number
    avatar_url?: string
    type?: string
  }
  labels: Array<{
    id?: number
    name: string
    color?: string
    description?: string | null
  }>
  assignees: Array<{
    login: string
    id?: number
  }>
  assignee?: {
    login: string
    id?: number
  } | null
  milestone?: {
    number: number
    title: string
    state?: string
  } | null
  locked?: boolean
  comments?: number
  pull_request?: {
    url: string
  }
  created_at: string
  updated_at: string
  closed_at?: string | null
  html_url: string
  url?: string
}

export interface IssueComment {
  id: number
  node_id?: string
  body: string
  user: {
    login: string
    id: number
    avatar_url?: string
  }
  created_at: string
  updated_at: string
  html_url: string
  issue_url?: string
}

export interface CreateIssueParams {
  owner: string
  repo: string
  title: string
  body?: string
  assignees?: string[]
  labels?: string[]
  milestone?: number
}

export interface GetIssueParams {
  owner: string
  repo: string
  issue_number: number
}

export interface UpdateIssueParams extends GetIssueParams {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  state_reason?: 'completed' | 'not_planned' | 'reopened'
  labels?: string[]
  assignees?: string[]
  milestone?: number | null
}

export interface ListIssuesParams {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
  labels?: string
  assignee?: string
  creator?: string
  mentioned?: string
  milestone?: string
  sort?: 'created' | 'updated' | 'comments'
  direction?: 'asc' | 'desc'
  since?: string
  per_page?: number
  page?: number
}

export interface CreateCommentParams extends GetIssueParams {
  body: string
}

export interface ListCommentsParams extends GetIssueParams {
  since?: string
  per_page?: number
  page?: number
}

export interface UpdateCommentParams {
  owner: string
  repo: string
  comment_id: number
  body: string
}

export interface DeleteCommentParams {
  owner: string
  repo: string
  comment_id: number
}

export interface AddLabelsParams extends GetIssueParams {
  labels: string[]
}

export interface RemoveLabelParams extends GetIssueParams {
  name: string
}

export interface AddAssigneesParams extends GetIssueParams {
  assignees: string[]
}

export interface RemoveAssigneesParams extends GetIssueParams {
  assignees: string[]
}

// ============================================================================
// Issues API
// ============================================================================

export class IssuesAPI {
  constructor(private octokit: Octokit) {}

  /**
   * Create an issue
   * @see https://docs.github.com/en/rest/issues/issues#create-an-issue
   */
  async create(params: CreateIssueParams): Promise<OctokitResponse<Issue>> {
    const { owner, repo, ...body } = params
    return this.octokit.request<Issue>(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Get an issue
   * @see https://docs.github.com/en/rest/issues/issues#get-an-issue
   */
  async get(params: GetIssueParams): Promise<OctokitResponse<Issue>> {
    const { owner, repo, issue_number } = params
    return this.octokit.request<Issue>(
      `/repos/${owner}/${repo}/issues/${issue_number}`
    )
  }

  /**
   * Update an issue
   * @see https://docs.github.com/en/rest/issues/issues#update-an-issue
   */
  async update(params: UpdateIssueParams): Promise<OctokitResponse<Issue>> {
    const { owner, repo, issue_number, ...body } = params
    return this.octokit.request<Issue>(
      `/repos/${owner}/${repo}/issues/${issue_number}`,
      {
        method: 'PATCH',
        body,
      }
    )
  }

  /**
   * List repository issues
   * @see https://docs.github.com/en/rest/issues/issues#list-repository-issues
   */
  async listForRepo(params: ListIssuesParams): Promise<OctokitResponse<Issue[]>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Issue[]>(`/repos/${owner}/${repo}/issues${query}`)
  }

  /**
   * List issues assigned to the authenticated user
   * @see https://docs.github.com/en/rest/issues/issues#list-issues-assigned-to-the-authenticated-user
   */
  async list(
    params?: Omit<ListIssuesParams, 'owner' | 'repo'>
  ): Promise<OctokitResponse<Issue[]>> {
    const query = buildQueryString(params || {})
    return this.octokit.request<Issue[]>(`/issues${query}`)
  }

  /**
   * Lock an issue
   * @see https://docs.github.com/en/rest/issues/issues#lock-an-issue
   */
  async lock(
    params: GetIssueParams & { lock_reason?: 'off-topic' | 'too heated' | 'resolved' | 'spam' }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, issue_number, lock_reason } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/issues/${issue_number}/lock`,
      {
        method: 'PUT',
        body: lock_reason ? { lock_reason } : undefined,
      }
    )
  }

  /**
   * Unlock an issue
   * @see https://docs.github.com/en/rest/issues/issues#unlock-an-issue
   */
  async unlock(params: GetIssueParams): Promise<OctokitResponse<void>> {
    const { owner, repo, issue_number } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/issues/${issue_number}/lock`,
      {
        method: 'DELETE',
      }
    )
  }

  // ==========================================================================
  // Comments
  // ==========================================================================

  /**
   * Create an issue comment
   * @see https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
   */
  async createComment(
    params: CreateCommentParams
  ): Promise<OctokitResponse<IssueComment>> {
    const { owner, repo, issue_number, body } = params
    return this.octokit.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
      {
        method: 'POST',
        body: { body },
      }
    )
  }

  /**
   * List issue comments
   * @see https://docs.github.com/en/rest/issues/comments#list-issue-comments
   */
  async listComments(
    params: ListCommentsParams
  ): Promise<OctokitResponse<IssueComment[]>> {
    const { owner, repo, issue_number, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<IssueComment[]>(
      `/repos/${owner}/${repo}/issues/${issue_number}/comments${query}`
    )
  }

  /**
   * Get an issue comment
   * @see https://docs.github.com/en/rest/issues/comments#get-an-issue-comment
   */
  async getComment(
    params: Omit<DeleteCommentParams, 'body'>
  ): Promise<OctokitResponse<IssueComment>> {
    const { owner, repo, comment_id } = params
    return this.octokit.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/comments/${comment_id}`
    )
  }

  /**
   * Update an issue comment
   * @see https://docs.github.com/en/rest/issues/comments#update-an-issue-comment
   */
  async updateComment(
    params: UpdateCommentParams
  ): Promise<OctokitResponse<IssueComment>> {
    const { owner, repo, comment_id, body } = params
    return this.octokit.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/comments/${comment_id}`,
      {
        method: 'PATCH',
        body: { body },
      }
    )
  }

  /**
   * Delete an issue comment
   * @see https://docs.github.com/en/rest/issues/comments#delete-an-issue-comment
   */
  async deleteComment(params: DeleteCommentParams): Promise<OctokitResponse<void>> {
    const { owner, repo, comment_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/issues/comments/${comment_id}`,
      {
        method: 'DELETE',
      }
    )
  }

  // ==========================================================================
  // Labels
  // ==========================================================================

  /**
   * Add labels to an issue
   * @see https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue
   */
  async addLabels(
    params: AddLabelsParams
  ): Promise<OctokitResponse<Array<{ name: string; color: string }>>> {
    const { owner, repo, issue_number, labels } = params
    return this.octokit.request<Array<{ name: string; color: string }>>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels`,
      {
        method: 'POST',
        body: { labels },
      }
    )
  }

  /**
   * Set labels for an issue
   * @see https://docs.github.com/en/rest/issues/labels#set-labels-for-an-issue
   */
  async setLabels(
    params: AddLabelsParams
  ): Promise<OctokitResponse<Array<{ name: string; color: string }>>> {
    const { owner, repo, issue_number, labels } = params
    return this.octokit.request<Array<{ name: string; color: string }>>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels`,
      {
        method: 'PUT',
        body: { labels },
      }
    )
  }

  /**
   * Remove a label from an issue
   * @see https://docs.github.com/en/rest/issues/labels#remove-a-label-from-an-issue
   */
  async removeLabel(
    params: RemoveLabelParams
  ): Promise<OctokitResponse<Array<{ name: string; color: string }>>> {
    const { owner, repo, issue_number, name } = params
    return this.octokit.request<Array<{ name: string; color: string }>>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
      }
    )
  }

  /**
   * Remove all labels from an issue
   * @see https://docs.github.com/en/rest/issues/labels#remove-all-labels-from-an-issue
   */
  async removeAllLabels(params: GetIssueParams): Promise<OctokitResponse<void>> {
    const { owner, repo, issue_number } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/issues/${issue_number}/labels`,
      {
        method: 'DELETE',
      }
    )
  }

  // ==========================================================================
  // Assignees
  // ==========================================================================

  /**
   * Add assignees to an issue
   * @see https://docs.github.com/en/rest/issues/assignees#add-assignees-to-an-issue
   */
  async addAssignees(params: AddAssigneesParams): Promise<OctokitResponse<Issue>> {
    const { owner, repo, issue_number, assignees } = params
    return this.octokit.request<Issue>(
      `/repos/${owner}/${repo}/issues/${issue_number}/assignees`,
      {
        method: 'POST',
        body: { assignees },
      }
    )
  }

  /**
   * Remove assignees from an issue
   * @see https://docs.github.com/en/rest/issues/assignees#remove-assignees-from-an-issue
   */
  async removeAssignees(
    params: RemoveAssigneesParams
  ): Promise<OctokitResponse<Issue>> {
    const { owner, repo, issue_number, assignees } = params
    return this.octokit.request<Issue>(
      `/repos/${owner}/${repo}/issues/${issue_number}/assignees`,
      {
        method: 'DELETE',
        body: { assignees },
      }
    )
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildQueryString(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null
  )
  if (entries.length === 0) return ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of entries) {
    searchParams.set(key, String(value))
  }
  return `?${searchParams.toString()}`
}
