/**
 * @dotdo/gitlab - Projects API
 *
 * Implements GitLab Projects API endpoints.
 * @see https://docs.gitlab.com/ee/api/projects.html
 */

import type { GitLab, GitLabResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Project {
  id: number
  name: string
  name_with_namespace: string
  path: string
  path_with_namespace: string
  description?: string | null
  default_branch?: string
  visibility: 'private' | 'internal' | 'public'
  ssh_url_to_repo: string
  http_url_to_repo: string
  web_url: string
  readme_url?: string | null
  avatar_url?: string | null
  star_count: number
  forks_count: number
  created_at: string
  last_activity_at: string
  namespace?: {
    id: number
    name: string
    path: string
    kind: string
    full_path: string
  }
  archived?: boolean
  issues_enabled?: boolean
  merge_requests_enabled?: boolean
  wiki_enabled?: boolean
  jobs_enabled?: boolean
  snippets_enabled?: boolean
  container_registry_enabled?: boolean
  open_issues_count?: number
  ci_config_path?: string | null
  owner?: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
}

export interface Branch {
  name: string
  merged: boolean
  protected: boolean
  default: boolean
  developers_can_push?: boolean
  developers_can_merge?: boolean
  can_push?: boolean
  web_url?: string
  commit?: {
    id: string
    short_id: string
    title: string
    message?: string
    author_name?: string
    author_email?: string
    authored_date?: string
    committed_date?: string
    parent_ids?: string[]
  }
}

export interface Commit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  authored_date: string
  committer_name?: string
  committer_email?: string
  committed_date: string
  created_at?: string
  parent_ids?: string[]
  web_url?: string
  stats?: {
    additions: number
    deletions: number
    total: number
  }
}

export interface GetProjectParams {
  id: string | number
}

export interface ListProjectsParams {
  archived?: boolean
  visibility?: 'private' | 'internal' | 'public'
  order_by?: 'id' | 'name' | 'path' | 'created_at' | 'updated_at' | 'last_activity_at'
  sort?: 'asc' | 'desc'
  search?: string
  simple?: boolean
  owned?: boolean
  membership?: boolean
  starred?: boolean
  statistics?: boolean
  with_issues_enabled?: boolean
  with_merge_requests_enabled?: boolean
  per_page?: number
  page?: number
}

export interface CreateProjectParams {
  name: string
  path?: string
  namespace_id?: number
  default_branch?: string
  description?: string
  issues_enabled?: boolean
  merge_requests_enabled?: boolean
  jobs_enabled?: boolean
  wiki_enabled?: boolean
  snippets_enabled?: boolean
  container_registry_enabled?: boolean
  visibility?: 'private' | 'internal' | 'public'
  initialize_with_readme?: boolean
  auto_devops_enabled?: boolean
}

export interface UpdateProjectParams extends GetProjectParams {
  name?: string
  path?: string
  description?: string
  default_branch?: string
  visibility?: 'private' | 'internal' | 'public'
  issues_enabled?: boolean
  merge_requests_enabled?: boolean
  jobs_enabled?: boolean
  wiki_enabled?: boolean
  archived?: boolean
}

export interface ListBranchesParams extends GetProjectParams {
  search?: string
  per_page?: number
  page?: number
}

export interface GetBranchParams extends GetProjectParams {
  branch: string
}

export interface CreateBranchParams extends GetProjectParams {
  branch: string
  ref: string
}

export interface DeleteBranchParams extends GetProjectParams {
  branch: string
}

export interface ListCommitsParams extends GetProjectParams {
  ref_name?: string
  since?: string
  until?: string
  path?: string
  all?: boolean
  with_stats?: boolean
  first_parent?: boolean
  per_page?: number
  page?: number
}

export interface GetCommitParams extends GetProjectParams {
  sha: string
  stats?: boolean
}

// ============================================================================
// Projects API
// ============================================================================

export class ProjectsAPI {
  constructor(private gitlab: GitLab) {}

  /**
   * Get a project
   * @see https://docs.gitlab.com/ee/api/projects.html#get-single-project
   */
  async get(params: GetProjectParams): Promise<GitLabResponse<Project>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}`)
  }

  /**
   * List projects
   * @see https://docs.gitlab.com/ee/api/projects.html#list-all-projects
   */
  async list(params: ListProjectsParams = {}): Promise<GitLabResponse<Project[]>> {
    const query = buildQueryString(params)
    return this.gitlab.request<Project[]>(`/projects${query}`)
  }

  /**
   * List projects for a user
   * @see https://docs.gitlab.com/ee/api/projects.html#list-user-projects
   */
  async listForUser(params: { user_id: number | string } & ListProjectsParams): Promise<GitLabResponse<Project[]>> {
    const { user_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.gitlab.request<Project[]>(`/users/${user_id}/projects${query}`)
  }

  /**
   * Create a project
   * @see https://docs.gitlab.com/ee/api/projects.html#create-project
   */
  async create(params: CreateProjectParams): Promise<GitLabResponse<Project>> {
    return this.gitlab.request<Project>('/projects', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Update a project
   * @see https://docs.gitlab.com/ee/api/projects.html#edit-project
   */
  async update(params: UpdateProjectParams): Promise<GitLabResponse<Project>> {
    const { id, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}`, {
      method: 'PUT',
      body,
    })
  }

  /**
   * Delete a project
   * @see https://docs.gitlab.com/ee/api/projects.html#delete-project
   */
  async delete(params: GetProjectParams): Promise<GitLabResponse<void>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}`, {
      method: 'DELETE',
    })
  }

  /**
   * Fork a project
   * @see https://docs.gitlab.com/ee/api/projects.html#fork-project
   */
  async fork(params: GetProjectParams & { namespace?: string | number; name?: string; path?: string }): Promise<GitLabResponse<Project>> {
    const { id, ...body } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}/fork`, {
      method: 'POST',
      body: Object.keys(body).length > 0 ? body : undefined,
    })
  }

  /**
   * Star a project
   * @see https://docs.gitlab.com/ee/api/projects.html#star-a-project
   */
  async star(params: GetProjectParams): Promise<GitLabResponse<Project>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}/star`, {
      method: 'POST',
    })
  }

  /**
   * Unstar a project
   * @see https://docs.gitlab.com/ee/api/projects.html#unstar-a-project
   */
  async unstar(params: GetProjectParams): Promise<GitLabResponse<Project>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}/unstar`, {
      method: 'POST',
    })
  }

  /**
   * Archive a project
   * @see https://docs.gitlab.com/ee/api/projects.html#archive-a-project
   */
  async archive(params: GetProjectParams): Promise<GitLabResponse<Project>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}/archive`, {
      method: 'POST',
    })
  }

  /**
   * Unarchive a project
   * @see https://docs.gitlab.com/ee/api/projects.html#unarchive-a-project
   */
  async unarchive(params: GetProjectParams): Promise<GitLabResponse<Project>> {
    const { id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Project>(`/projects/${encodedId}/unarchive`, {
      method: 'POST',
    })
  }

  // ==========================================================================
  // Branches
  // ==========================================================================

  /**
   * List branches
   * @see https://docs.gitlab.com/ee/api/branches.html#list-repository-branches
   */
  async listBranches(params: ListBranchesParams): Promise<GitLabResponse<Branch[]>> {
    const { id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<Branch[]>(`/projects/${encodedId}/repository/branches${query}`)
  }

  /**
   * Get a branch
   * @see https://docs.gitlab.com/ee/api/branches.html#get-single-repository-branch
   */
  async getBranch(params: GetBranchParams): Promise<GitLabResponse<Branch>> {
    const { id, branch } = params
    const encodedId = encodeURIComponent(String(id))
    const encodedBranch = encodeURIComponent(branch)
    return this.gitlab.request<Branch>(`/projects/${encodedId}/repository/branches/${encodedBranch}`)
  }

  /**
   * Create a branch
   * @see https://docs.gitlab.com/ee/api/branches.html#create-repository-branch
   */
  async createBranch(params: CreateBranchParams): Promise<GitLabResponse<Branch>> {
    const { id, branch, ref } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Branch>(`/projects/${encodedId}/repository/branches`, {
      method: 'POST',
      body: { branch, ref },
    })
  }

  /**
   * Delete a branch
   * @see https://docs.gitlab.com/ee/api/branches.html#delete-repository-branch
   */
  async deleteBranch(params: DeleteBranchParams): Promise<GitLabResponse<void>> {
    const { id, branch } = params
    const encodedId = encodeURIComponent(String(id))
    const encodedBranch = encodeURIComponent(branch)
    return this.gitlab.request<void>(`/projects/${encodedId}/repository/branches/${encodedBranch}`, {
      method: 'DELETE',
    })
  }

  // ==========================================================================
  // Commits
  // ==========================================================================

  /**
   * List commits
   * @see https://docs.gitlab.com/ee/api/commits.html#list-repository-commits
   */
  async listCommits(params: ListCommitsParams): Promise<GitLabResponse<Commit[]>> {
    const { id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<Commit[]>(`/projects/${encodedId}/repository/commits${query}`)
  }

  /**
   * Get a commit
   * @see https://docs.gitlab.com/ee/api/commits.html#get-a-single-commit
   */
  async getCommit(params: GetCommitParams): Promise<GitLabResponse<Commit>> {
    const { id, sha, stats } = params
    const encodedId = encodeURIComponent(String(id))
    const query = stats ? '?stats=true' : ''
    return this.gitlab.request<Commit>(`/projects/${encodedId}/repository/commits/${sha}${query}`)
  }

  /**
   * Get commit diff
   * @see https://docs.gitlab.com/ee/api/commits.html#get-the-diff-of-a-commit
   */
  async getCommitDiff(params: GetCommitParams & { per_page?: number; page?: number }): Promise<GitLabResponse<Array<{
    old_path: string
    new_path: string
    a_mode: string
    b_mode: string
    new_file: boolean
    renamed_file: boolean
    deleted_file: boolean
    diff: string
  }>>> {
    const { id, sha, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request(`/projects/${encodedId}/repository/commits/${sha}/diff${query}`)
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
