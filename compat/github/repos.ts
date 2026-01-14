/**
 * @dotdo/github - Repositories API
 *
 * Implements GitHub Repositories API endpoints.
 * @see https://docs.github.com/en/rest/repos
 */

import type { Octokit, OctokitResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Repository {
  id: number
  node_id: string
  name: string
  full_name: string
  private: boolean
  owner: {
    login: string
    id: number
    type: string
    avatar_url?: string
  }
  description?: string | null
  fork: boolean
  url: string
  html_url: string
  created_at: string
  updated_at: string
  pushed_at: string
  default_branch: string
  stargazers_count: number
  watchers_count: number
  forks_count: number
  open_issues_count: number
  language?: string | null
  archived?: boolean
  disabled?: boolean
  visibility?: string
  topics?: string[]
}

export interface Branch {
  name: string
  protected: boolean
  commit?: {
    sha: string
    url: string
  }
  protection?: {
    enabled: boolean
    required_status_checks?: {
      strict: boolean
      contexts?: string[]
    }
  }
}

export interface GetRepoParams {
  owner: string
  repo: string
}

export interface ListForOrgParams {
  org: string
  type?: 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member'
  sort?: 'created' | 'updated' | 'pushed' | 'full_name'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface ListForAuthenticatedUserParams {
  visibility?: 'all' | 'public' | 'private'
  affiliation?: string
  type?: 'all' | 'owner' | 'public' | 'private' | 'member'
  sort?: 'created' | 'updated' | 'pushed' | 'full_name'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface CreateRepoParams {
  name: string
  description?: string
  homepage?: string
  private?: boolean
  visibility?: 'public' | 'private' | 'internal'
  has_issues?: boolean
  has_projects?: boolean
  has_wiki?: boolean
  has_discussions?: boolean
  team_id?: number
  auto_init?: boolean
  gitignore_template?: string
  license_template?: string
  allow_squash_merge?: boolean
  allow_merge_commit?: boolean
  allow_rebase_merge?: boolean
  allow_auto_merge?: boolean
  delete_branch_on_merge?: boolean
  is_template?: boolean
}

export interface UpdateRepoParams extends GetRepoParams {
  name?: string
  description?: string
  homepage?: string
  private?: boolean
  visibility?: 'public' | 'private' | 'internal'
  has_issues?: boolean
  has_projects?: boolean
  has_wiki?: boolean
  default_branch?: string
  allow_squash_merge?: boolean
  allow_merge_commit?: boolean
  allow_rebase_merge?: boolean
  archived?: boolean
}

export interface ListBranchesParams extends GetRepoParams {
  protected?: boolean
  per_page?: number
  page?: number
}

export interface GetBranchParams extends GetRepoParams {
  branch: string
}

// ============================================================================
// Repos API
// ============================================================================

export class ReposAPI {
  constructor(private octokit: Octokit) {}

  /**
   * Get a repository
   * @see https://docs.github.com/en/rest/repos/repos#get-a-repository
   */
  async get(params: GetRepoParams): Promise<OctokitResponse<Repository>> {
    const { owner, repo } = params
    return this.octokit.request<Repository>(`/repos/${owner}/${repo}`)
  }

  /**
   * List organization repositories
   * @see https://docs.github.com/en/rest/repos/repos#list-organization-repositories
   */
  async listForOrg(params: ListForOrgParams): Promise<OctokitResponse<Repository[]>> {
    const { org, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Repository[]>(`/orgs/${org}/repos${query}`)
  }

  /**
   * List repositories for the authenticated user
   * @see https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user
   */
  async listForAuthenticatedUser(
    params: ListForAuthenticatedUserParams = {}
  ): Promise<OctokitResponse<Repository[]>> {
    const query = buildQueryString(params)
    return this.octokit.request<Repository[]>(`/user/repos${query}`)
  }

  /**
   * Create a repository for the authenticated user
   * @see https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user
   */
  async createForAuthenticatedUser(
    params: CreateRepoParams
  ): Promise<OctokitResponse<Repository>> {
    return this.octokit.request<Repository>('/user/repos', {
      method: 'POST',
      body: params,
    })
  }

  /**
   * Update a repository
   * @see https://docs.github.com/en/rest/repos/repos#update-a-repository
   */
  async update(params: UpdateRepoParams): Promise<OctokitResponse<Repository>> {
    const { owner, repo, ...body } = params
    return this.octokit.request<Repository>(`/repos/${owner}/${repo}`, {
      method: 'PATCH',
      body,
    })
  }

  /**
   * Delete a repository
   * @see https://docs.github.com/en/rest/repos/repos#delete-a-repository
   */
  async delete(params: GetRepoParams): Promise<OctokitResponse<void>> {
    const { owner, repo } = params
    return this.octokit.request<void>(`/repos/${owner}/${repo}`, {
      method: 'DELETE',
    })
  }

  /**
   * List branches
   * @see https://docs.github.com/en/rest/branches/branches#list-branches
   */
  async listBranches(params: ListBranchesParams): Promise<OctokitResponse<Branch[]>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Branch[]>(`/repos/${owner}/${repo}/branches${query}`)
  }

  /**
   * Get a branch
   * @see https://docs.github.com/en/rest/branches/branches#get-a-branch
   */
  async getBranch(params: GetBranchParams): Promise<OctokitResponse<Branch>> {
    const { owner, repo, branch } = params
    return this.octokit.request<Branch>(`/repos/${owner}/${repo}/branches/${branch}`)
  }

  /**
   * List repository topics
   * @see https://docs.github.com/en/rest/repos/repos#get-all-repository-topics
   */
  async getAllTopics(
    params: GetRepoParams
  ): Promise<OctokitResponse<{ names: string[] }>> {
    const { owner, repo } = params
    return this.octokit.request<{ names: string[] }>(
      `/repos/${owner}/${repo}/topics`
    )
  }

  /**
   * Replace all repository topics
   * @see https://docs.github.com/en/rest/repos/repos#replace-all-repository-topics
   */
  async replaceAllTopics(
    params: GetRepoParams & { names: string[] }
  ): Promise<OctokitResponse<{ names: string[] }>> {
    const { owner, repo, names } = params
    return this.octokit.request<{ names: string[] }>(
      `/repos/${owner}/${repo}/topics`,
      {
        method: 'PUT',
        body: { names },
      }
    )
  }

  /**
   * List repository contributors
   * @see https://docs.github.com/en/rest/repos/repos#list-repository-contributors
   */
  async listContributors(
    params: GetRepoParams & { anon?: string; per_page?: number; page?: number }
  ): Promise<OctokitResponse<Array<{ login: string; contributions: number }>>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Array<{ login: string; contributions: number }>>(
      `/repos/${owner}/${repo}/contributors${query}`
    )
  }

  /**
   * List repository languages
   * @see https://docs.github.com/en/rest/repos/repos#list-repository-languages
   */
  async listLanguages(
    params: GetRepoParams
  ): Promise<OctokitResponse<Record<string, number>>> {
    const { owner, repo } = params
    return this.octokit.request<Record<string, number>>(
      `/repos/${owner}/${repo}/languages`
    )
  }

  /**
   * List repository tags
   * @see https://docs.github.com/en/rest/repos/repos#list-repository-tags
   */
  async listTags(
    params: GetRepoParams & { per_page?: number; page?: number }
  ): Promise<OctokitResponse<Array<{ name: string; commit: { sha: string } }>>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Array<{ name: string; commit: { sha: string } }>>(
      `/repos/${owner}/${repo}/tags${query}`
    )
  }

  /**
   * Transfer a repository
   * @see https://docs.github.com/en/rest/repos/repos#transfer-a-repository
   */
  async transfer(
    params: GetRepoParams & { new_owner: string; new_name?: string; team_ids?: number[] }
  ): Promise<OctokitResponse<Repository>> {
    const { owner, repo, ...body } = params
    return this.octokit.request<Repository>(`/repos/${owner}/${repo}/transfer`, {
      method: 'POST',
      body,
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
    searchParams.set(key, String(value))
  }
  return `?${searchParams.toString()}`
}
