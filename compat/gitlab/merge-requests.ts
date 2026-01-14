/**
 * @dotdo/gitlab - Merge Requests API
 *
 * Implements GitLab Merge Requests API endpoints.
 * @see https://docs.gitlab.com/ee/api/merge_requests.html
 */

import type { GitLab, GitLabResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface MergeRequest {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string | null
  state: 'opened' | 'closed' | 'merged' | 'locked'
  merged_by?: {
    id: number
    username: string
    name: string
    avatar_url?: string
  } | null
  merged_at?: string | null
  closed_by?: {
    id: number
    username: string
    name: string
  } | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  target_branch: string
  source_branch: string
  user_notes_count?: number
  upvotes?: number
  downvotes?: number
  author: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
  assignees?: Array<{
    id: number
    username: string
    name: string
    avatar_url?: string
  }>
  assignee?: {
    id: number
    username: string
    name: string
    avatar_url?: string
  } | null
  reviewers?: Array<{
    id: number
    username: string
    name: string
    avatar_url?: string
  }>
  source_project_id: number
  target_project_id: number
  labels: string[]
  draft?: boolean
  work_in_progress?: boolean
  milestone?: {
    id: number
    iid: number
    title: string
    state: string
    due_date?: string | null
  } | null
  merge_when_pipeline_succeeds?: boolean
  merge_status: 'unchecked' | 'checking' | 'can_be_merged' | 'cannot_be_merged' | 'cannot_be_merged_recheck'
  sha: string
  merge_commit_sha?: string | null
  squash_commit_sha?: string | null
  diff_refs?: {
    base_sha: string
    head_sha: string
    start_sha: string
  }
  web_url: string
  references?: {
    short: string
    relative: string
    full: string
  }
  should_remove_source_branch?: boolean | null
  force_remove_source_branch?: boolean
  squash?: boolean
  has_conflicts?: boolean
  blocking_discussions_resolved?: boolean
  changes_count?: string
  approvals_before_merge?: number | null
}

export interface MergeRequestChange {
  old_path: string
  new_path: string
  a_mode: string
  b_mode: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

export interface MergeRequestDiff {
  id: number
  head_commit_sha: string
  base_commit_sha: string
  start_commit_sha: string
  created_at: string
  merge_request_id: number
  state: string
  real_size: string
}

export interface MergeResult {
  id: number
  iid: number
  state: string
  merged_by?: {
    id: number
    username: string
    name: string
  }
  merged_at?: string
  merge_commit_sha?: string
}

export interface ProjectMRParams {
  id: string | number
}

export interface CreateMergeRequestParams extends ProjectMRParams {
  source_branch: string
  target_branch: string
  title: string
  assignee_id?: number
  assignee_ids?: number[]
  reviewer_ids?: number[]
  description?: string
  target_project_id?: number
  labels?: string
  milestone_id?: number
  remove_source_branch?: boolean
  allow_collaboration?: boolean
  allow_maintainer_to_push?: boolean
  squash?: boolean
}

export interface GetMergeRequestParams extends ProjectMRParams {
  merge_request_iid: number
}

export interface UpdateMergeRequestParams extends GetMergeRequestParams {
  title?: string
  description?: string
  target_branch?: string
  assignee_id?: number
  assignee_ids?: number[]
  reviewer_ids?: number[]
  labels?: string
  add_labels?: string
  remove_labels?: string
  milestone_id?: number
  state_event?: 'close' | 'reopen'
  remove_source_branch?: boolean
  squash?: boolean
  discussion_locked?: boolean
  allow_collaboration?: boolean
  allow_maintainer_to_push?: boolean
}

export interface ListMergeRequestsParams extends ProjectMRParams {
  iids?: number[]
  state?: 'opened' | 'closed' | 'merged' | 'locked' | 'all'
  order_by?: 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  milestone?: string
  view?: 'simple'
  labels?: string
  with_labels_details?: boolean
  with_merge_status_recheck?: boolean
  created_after?: string
  created_before?: string
  updated_after?: string
  updated_before?: string
  scope?: 'created_by_me' | 'assigned_to_me' | 'all'
  author_id?: number
  author_username?: string
  assignee_id?: number | 'None' | 'Any'
  reviewer_id?: number | 'None' | 'Any'
  reviewer_username?: string
  my_reaction_emoji?: string
  source_branch?: string
  target_branch?: string
  search?: string
  wip?: 'yes' | 'no'
  per_page?: number
  page?: number
}

export interface MergeMergeRequestParams extends GetMergeRequestParams {
  merge_commit_message?: string
  squash_commit_message?: string
  squash?: boolean
  should_remove_source_branch?: boolean
  merge_when_pipeline_succeeds?: boolean
  sha?: string
}

export interface ApproveMergeRequestParams extends GetMergeRequestParams {
  sha?: string
  approval_password?: string
}

// ============================================================================
// Merge Requests API
// ============================================================================

export class MergeRequestsAPI {
  constructor(private gitlab: GitLab) {}

  /**
   * List all merge requests
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#list-merge-requests
   */
  async listAll(params?: Omit<ListMergeRequestsParams, 'id'>): Promise<GitLabResponse<MergeRequest[]>> {
    const query = buildQueryString(params || {})
    return this.gitlab.request<MergeRequest[]>(`/merge_requests${query}`)
  }

  /**
   * List project merge requests
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#list-project-merge-requests
   */
  async list(params: ListMergeRequestsParams): Promise<GitLabResponse<MergeRequest[]>> {
    const { id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<MergeRequest[]>(`/projects/${encodedId}/merge_requests${query}`)
  }

  /**
   * Get a single merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#get-single-mr
   */
  async get(params: GetMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}`)
  }

  /**
   * Create a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#create-mr
   */
  async create(params: CreateMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Update a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#update-mr
   */
  async update(params: UpdateMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}`, {
      method: 'PUT',
      body,
    })
  }

  /**
   * Delete a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#delete-a-merge-request
   */
  async delete(params: GetMergeRequestParams): Promise<GitLabResponse<void>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}/merge_requests/${merge_request_iid}`, {
      method: 'DELETE',
    })
  }

  /**
   * Merge a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#merge-a-merge-request
   */
  async merge(params: MergeMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/merge`, {
      method: 'PUT',
      body: Object.keys(body).length > 0 ? body : undefined,
    })
  }

  /**
   * Cancel merge when pipeline succeeds
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#cancel-merge-when-pipeline-succeeds
   */
  async cancelMergeWhenPipelineSucceeds(params: GetMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/cancel_merge_when_pipeline_succeeds`, {
      method: 'POST',
    })
  }

  /**
   * Rebase a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#rebase-a-merge-request
   */
  async rebase(params: GetMergeRequestParams & { skip_ci?: boolean }): Promise<GitLabResponse<{ rebase_in_progress: boolean }>> {
    const { id, merge_request_iid, skip_ci } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<{ rebase_in_progress: boolean }>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/rebase`, {
      method: 'PUT',
      body: skip_ci ? { skip_ci } : undefined,
    })
  }

  /**
   * Get merge request changes
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#get-single-mr-changes
   */
  async getChanges(params: GetMergeRequestParams): Promise<GitLabResponse<MergeRequest & { changes: MergeRequestChange[] }>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request(`/projects/${encodedId}/merge_requests/${merge_request_iid}/changes`)
  }

  /**
   * List merge request diffs
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#list-mr-diffs
   */
  async listDiffs(params: GetMergeRequestParams & { per_page?: number; page?: number }): Promise<GitLabResponse<MergeRequestDiff[]>> {
    const { id, merge_request_iid, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<MergeRequestDiff[]>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/diffs${query}`)
  }

  /**
   * List merge request commits
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#get-single-mr-commits
   */
  async listCommits(params: GetMergeRequestParams): Promise<GitLabResponse<Array<{
    id: string
    short_id: string
    title: string
    message: string
    author_name: string
    author_email: string
    authored_date: string
    created_at: string
  }>>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request(`/projects/${encodedId}/merge_requests/${merge_request_iid}/commits`)
  }

  /**
   * Subscribe to a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#subscribe-to-a-merge-request
   */
  async subscribe(params: GetMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/subscribe`, {
      method: 'POST',
    })
  }

  /**
   * Unsubscribe from a merge request
   * @see https://docs.gitlab.com/ee/api/merge_requests.html#unsubscribe-from-a-merge-request
   */
  async unsubscribe(params: GetMergeRequestParams): Promise<GitLabResponse<MergeRequest>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<MergeRequest>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/unsubscribe`, {
      method: 'POST',
    })
  }

  /**
   * Approve a merge request
   * @see https://docs.gitlab.com/ee/api/merge_request_approvals.html#approve-merge-request
   */
  async approve(params: ApproveMergeRequestParams): Promise<GitLabResponse<{ id: number; iid: number; approved_by?: Array<{ user: { id: number; username: string } }> }>> {
    const { id, merge_request_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request(`/projects/${encodedId}/merge_requests/${merge_request_iid}/approve`, {
      method: 'POST',
      body: Object.keys(body).length > 0 ? body : undefined,
    })
  }

  /**
   * Unapprove a merge request
   * @see https://docs.gitlab.com/ee/api/merge_request_approvals.html#unapprove-merge-request
   */
  async unapprove(params: GetMergeRequestParams): Promise<GitLabResponse<void>> {
    const { id, merge_request_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}/merge_requests/${merge_request_iid}/unapprove`, {
      method: 'POST',
    })
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
    if (Array.isArray(value)) {
      searchParams.set(key, value.join(','))
    } else {
      searchParams.set(key, String(value))
    }
  }
  return `?${searchParams.toString()}`
}
