/**
 * @dotdo/gitlab - Issues API
 *
 * Implements GitLab Issues API endpoints.
 * @see https://docs.gitlab.com/ee/api/issues.html
 */

import type { GitLab, GitLabResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Issue {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string | null
  state: 'opened' | 'closed'
  created_at: string
  updated_at: string
  closed_at?: string | null
  closed_by?: {
    id: number
    username: string
    name: string
  } | null
  labels: string[]
  milestone?: {
    id: number
    iid: number
    title: string
    state: string
    due_date?: string | null
  } | null
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
  author: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
  type?: 'issue' | 'incident'
  user_notes_count?: number
  merge_requests_count?: number
  upvotes?: number
  downvotes?: number
  due_date?: string | null
  confidential?: boolean
  discussion_locked?: boolean | null
  issue_type?: string
  web_url: string
  time_stats?: {
    time_estimate: number
    total_time_spent: number
    human_time_estimate?: string | null
    human_total_time_spent?: string | null
  }
  weight?: number | null
  has_tasks?: boolean
  task_status?: string
}

export interface IssueNote {
  id: number
  type?: string | null
  body: string
  attachment?: string | null
  author: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
  created_at: string
  updated_at: string
  system: boolean
  noteable_id?: number
  noteable_type?: string
  resolvable?: boolean
  confidential?: boolean
  noteable_iid?: number
}

export interface ProjectIssueParams {
  id: string | number
}

export interface CreateIssueParams extends ProjectIssueParams {
  title: string
  description?: string
  confidential?: boolean
  assignee_ids?: number[]
  milestone_id?: number
  labels?: string
  due_date?: string
  weight?: number
  issue_type?: 'issue' | 'incident'
}

export interface GetIssueParams extends ProjectIssueParams {
  issue_iid: number
}

export interface UpdateIssueParams extends GetIssueParams {
  title?: string
  description?: string
  confidential?: boolean
  assignee_ids?: number[]
  milestone_id?: number
  labels?: string
  add_labels?: string
  remove_labels?: string
  state_event?: 'close' | 'reopen'
  due_date?: string
  weight?: number
  discussion_locked?: boolean
}

export interface ListIssuesParams extends ProjectIssueParams {
  iids?: number[]
  state?: 'opened' | 'closed' | 'all'
  labels?: string
  with_labels_details?: boolean
  milestone?: string
  scope?: 'created_by_me' | 'assigned_to_me' | 'all'
  author_id?: number
  author_username?: string
  assignee_id?: number | 'None' | 'Any'
  assignee_username?: string
  my_reaction_emoji?: string
  search?: string
  order_by?: 'created_at' | 'updated_at' | 'priority' | 'due_date' | 'relative_position' | 'label_priority' | 'milestone_due' | 'popularity' | 'weight'
  sort?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface CreateNoteParams extends GetIssueParams {
  body: string
  confidential?: boolean
}

export interface ListNotesParams extends GetIssueParams {
  sort?: 'asc' | 'desc'
  order_by?: 'created_at' | 'updated_at'
  per_page?: number
  page?: number
}

export interface UpdateNoteParams extends GetIssueParams {
  note_id: number
  body: string
}

export interface DeleteNoteParams extends GetIssueParams {
  note_id: number
}

// ============================================================================
// Issues API
// ============================================================================

export class IssuesAPI {
  constructor(private gitlab: GitLab) {}

  /**
   * List all issues
   * @see https://docs.gitlab.com/ee/api/issues.html#list-issues
   */
  async listAll(params?: Omit<ListIssuesParams, 'id'>): Promise<GitLabResponse<Issue[]>> {
    const query = buildQueryString(params || {})
    return this.gitlab.request<Issue[]>(`/issues${query}`)
  }

  /**
   * List project issues
   * @see https://docs.gitlab.com/ee/api/issues.html#list-project-issues
   */
  async listForProject(params: ListIssuesParams): Promise<GitLabResponse<Issue[]>> {
    const { id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<Issue[]>(`/projects/${encodedId}/issues${query}`)
  }

  /**
   * Get a single issue
   * @see https://docs.gitlab.com/ee/api/issues.html#single-issue
   */
  async get(params: GetIssueParams): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}`)
  }

  /**
   * Create an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#new-issue
   */
  async create(params: CreateIssueParams): Promise<GitLabResponse<Issue>> {
    const { id, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Update an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#edit-issue
   */
  async update(params: UpdateIssueParams): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}`, {
      method: 'PUT',
      body,
    })
  }

  /**
   * Delete an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#delete-an-issue
   */
  async delete(params: GetIssueParams): Promise<GitLabResponse<void>> {
    const { id, issue_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}/issues/${issue_iid}`, {
      method: 'DELETE',
    })
  }

  /**
   * Reorder an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#reorder-an-issue
   */
  async reorder(params: GetIssueParams & { move_after_id?: number; move_before_id?: number }): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}/reorder`, {
      method: 'PUT',
      body,
    })
  }

  /**
   * Move an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#move-an-issue
   */
  async move(params: GetIssueParams & { to_project_id: number }): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid, to_project_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}/move`, {
      method: 'POST',
      body: { to_project_id },
    })
  }

  /**
   * Subscribe to an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#subscribe-to-an-issue
   */
  async subscribe(params: GetIssueParams): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}/subscribe`, {
      method: 'POST',
    })
  }

  /**
   * Unsubscribe from an issue
   * @see https://docs.gitlab.com/ee/api/issues.html#unsubscribe-from-an-issue
   */
  async unsubscribe(params: GetIssueParams): Promise<GitLabResponse<Issue>> {
    const { id, issue_iid } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Issue>(`/projects/${encodedId}/issues/${issue_iid}/unsubscribe`, {
      method: 'POST',
    })
  }

  // ==========================================================================
  // Notes (Comments)
  // ==========================================================================

  /**
   * List issue notes
   * @see https://docs.gitlab.com/ee/api/notes.html#list-project-issue-notes
   */
  async listNotes(params: ListNotesParams): Promise<GitLabResponse<IssueNote[]>> {
    const { id, issue_iid, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<IssueNote[]>(`/projects/${encodedId}/issues/${issue_iid}/notes${query}`)
  }

  /**
   * Get a single issue note
   * @see https://docs.gitlab.com/ee/api/notes.html#get-single-issue-note
   */
  async getNote(params: DeleteNoteParams): Promise<GitLabResponse<IssueNote>> {
    const { id, issue_iid, note_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<IssueNote>(`/projects/${encodedId}/issues/${issue_iid}/notes/${note_id}`)
  }

  /**
   * Create an issue note
   * @see https://docs.gitlab.com/ee/api/notes.html#create-new-issue-note
   */
  async createNote(params: CreateNoteParams): Promise<GitLabResponse<IssueNote>> {
    const { id, issue_iid, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<IssueNote>(`/projects/${encodedId}/issues/${issue_iid}/notes`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Update an issue note
   * @see https://docs.gitlab.com/ee/api/notes.html#modify-existing-issue-note
   */
  async updateNote(params: UpdateNoteParams): Promise<GitLabResponse<IssueNote>> {
    const { id, issue_iid, note_id, body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<IssueNote>(`/projects/${encodedId}/issues/${issue_iid}/notes/${note_id}`, {
      method: 'PUT',
      body: { body },
    })
  }

  /**
   * Delete an issue note
   * @see https://docs.gitlab.com/ee/api/notes.html#delete-an-issue-note
   */
  async deleteNote(params: DeleteNoteParams): Promise<GitLabResponse<void>> {
    const { id, issue_iid, note_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}/issues/${issue_iid}/notes/${note_id}`, {
      method: 'DELETE',
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
