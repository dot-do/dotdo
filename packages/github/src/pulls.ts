/**
 * @dotdo/github - Pull Requests API
 *
 * Implements GitHub Pull Requests API endpoints.
 * @see https://docs.github.com/en/rest/pulls
 */

import type { Octokit, OctokitResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface PullRequest {
  id: number
  node_id?: string
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  draft?: boolean
  user: {
    login: string
    id: number
    avatar_url?: string
  }
  head: {
    ref: string
    sha: string
    label?: string
    repo?: {
      id: number
      name: string
      full_name: string
    }
  }
  base: {
    ref: string
    sha: string
    label?: string
    repo?: {
      id: number
      name: string
      full_name: string
    }
  }
  merged: boolean
  mergeable?: boolean | null
  mergeable_state?: string
  merge_commit_sha?: string | null
  merged_by?: {
    login: string
    id: number
  } | null
  merged_at?: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  html_url: string
  diff_url?: string
  patch_url?: string
  additions?: number
  deletions?: number
  changed_files?: number
  commits?: number
  comments?: number
  review_comments?: number
  requested_reviewers?: Array<{ login: string; id?: number }>
  requested_teams?: Array<{ slug: string; id?: number }>
  labels?: Array<{ name: string; color?: string }>
}

export interface PullRequestFile {
  sha: string
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  changes: number
  blob_url?: string
  raw_url?: string
  contents_url?: string
  patch?: string
  previous_filename?: string
}

export interface MergeResult {
  sha: string
  merged: boolean
  message: string
}

export interface CreatePullParams {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
  maintainer_can_modify?: boolean
  draft?: boolean
  issue?: number
}

export interface GetPullParams {
  owner: string
  repo: string
  pull_number: number
}

export interface UpdatePullParams extends GetPullParams {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  base?: string
  maintainer_can_modify?: boolean
}

export interface ListPullsParams {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
  head?: string
  base?: string
  sort?: 'created' | 'updated' | 'popularity' | 'long-running'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface MergePullParams extends GetPullParams {
  commit_title?: string
  commit_message?: string
  sha?: string
  merge_method?: 'merge' | 'squash' | 'rebase'
}

export interface ListFilesParams extends GetPullParams {
  per_page?: number
  page?: number
}

export interface RequestReviewersParams extends GetPullParams {
  reviewers?: string[]
  team_reviewers?: string[]
}

export interface ListReviewsParams extends GetPullParams {
  per_page?: number
  page?: number
}

export interface CreateReviewParams extends GetPullParams {
  commit_id?: string
  body?: string
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments?: Array<{
    path: string
    position?: number
    body: string
    line?: number
    side?: 'LEFT' | 'RIGHT'
    start_line?: number
    start_side?: 'LEFT' | 'RIGHT'
  }>
}

export interface Review {
  id: number
  node_id?: string
  user: {
    login: string
    id: number
  }
  body?: string | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  html_url: string
  submitted_at?: string
  commit_id?: string
}

// ============================================================================
// Pulls API
// ============================================================================

export class PullsAPI {
  constructor(private octokit: Octokit) {}

  /**
   * Create a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
   */
  async create(params: CreatePullParams): Promise<OctokitResponse<PullRequest>> {
    const { owner, repo, ...body } = params
    return this.octokit.request<PullRequest>(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body,
    })
  }

  /**
   * Get a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
   */
  async get(params: GetPullParams): Promise<OctokitResponse<PullRequest>> {
    const { owner, repo, pull_number } = params
    return this.octokit.request<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${pull_number}`
    )
  }

  /**
   * Update a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request
   */
  async update(params: UpdatePullParams): Promise<OctokitResponse<PullRequest>> {
    const { owner, repo, pull_number, ...body } = params
    return this.octokit.request<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${pull_number}`,
      {
        method: 'PATCH',
        body,
      }
    )
  }

  /**
   * List pull requests
   * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
   */
  async list(params: ListPullsParams): Promise<OctokitResponse<PullRequest[]>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<PullRequest[]>(`/repos/${owner}/${repo}/pulls${query}`)
  }

  /**
   * Merge a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
   */
  async merge(params: MergePullParams): Promise<OctokitResponse<MergeResult>> {
    const { owner, repo, pull_number, ...body } = params
    return this.octokit.request<MergeResult>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/merge`,
      {
        method: 'PUT',
        body: Object.keys(body).length > 0 ? body : undefined,
      }
    )
  }

  /**
   * Check if a pull request has been merged
   * @see https://docs.github.com/en/rest/pulls/pulls#check-if-a-pull-request-has-been-merged
   */
  async checkIfMerged(params: GetPullParams): Promise<OctokitResponse<void>> {
    const { owner, repo, pull_number } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/merge`
    )
  }

  /**
   * List pull request files
   * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
   */
  async listFiles(
    params: ListFilesParams
  ): Promise<OctokitResponse<PullRequestFile[]>> {
    const { owner, repo, pull_number, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<PullRequestFile[]>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/files${query}`
    )
  }

  /**
   * List commits on a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request
   */
  async listCommits(
    params: ListFilesParams
  ): Promise<OctokitResponse<Array<{ sha: string; commit: { message: string } }>>> {
    const { owner, repo, pull_number, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Array<{ sha: string; commit: { message: string } }>>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/commits${query}`
    )
  }

  // ==========================================================================
  // Reviewers
  // ==========================================================================

  /**
   * Request reviewers for a pull request
   * @see https://docs.github.com/en/rest/pulls/review-requests#request-reviewers-for-a-pull-request
   */
  async requestReviewers(
    params: RequestReviewersParams
  ): Promise<OctokitResponse<PullRequest>> {
    const { owner, repo, pull_number, ...body } = params
    return this.octokit.request<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/requested_reviewers`,
      {
        method: 'POST',
        body,
      }
    )
  }

  /**
   * Remove requested reviewers from a pull request
   * @see https://docs.github.com/en/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request
   */
  async removeRequestedReviewers(
    params: RequestReviewersParams
  ): Promise<OctokitResponse<PullRequest>> {
    const { owner, repo, pull_number, ...body } = params
    return this.octokit.request<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/requested_reviewers`,
      {
        method: 'DELETE',
        body,
      }
    )
  }

  /**
   * Get all requested reviewers for a pull request
   * @see https://docs.github.com/en/rest/pulls/review-requests#get-all-requested-reviewers-for-a-pull-request
   */
  async listRequestedReviewers(
    params: GetPullParams
  ): Promise<
    OctokitResponse<{
      users: Array<{ login: string; id: number }>
      teams: Array<{ slug: string; id: number }>
    }>
  > {
    const { owner, repo, pull_number } = params
    return this.octokit.request(
      `/repos/${owner}/${repo}/pulls/${pull_number}/requested_reviewers`
    )
  }

  // ==========================================================================
  // Reviews
  // ==========================================================================

  /**
   * List reviews for a pull request
   * @see https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request
   */
  async listReviews(params: ListReviewsParams): Promise<OctokitResponse<Review[]>> {
    const { owner, repo, pull_number, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<Review[]>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/reviews${query}`
    )
  }

  /**
   * Create a review for a pull request
   * @see https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request
   */
  async createReview(params: CreateReviewParams): Promise<OctokitResponse<Review>> {
    const { owner, repo, pull_number, ...body } = params
    return this.octokit.request<Review>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
      {
        method: 'POST',
        body,
      }
    )
  }

  /**
   * Get a review for a pull request
   * @see https://docs.github.com/en/rest/pulls/reviews#get-a-review-for-a-pull-request
   */
  async getReview(
    params: GetPullParams & { review_id: number }
  ): Promise<OctokitResponse<Review>> {
    const { owner, repo, pull_number, review_id } = params
    return this.octokit.request<Review>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/reviews/${review_id}`
    )
  }

  /**
   * Dismiss a review for a pull request
   * @see https://docs.github.com/en/rest/pulls/reviews#dismiss-a-review-for-a-pull-request
   */
  async dismissReview(
    params: GetPullParams & { review_id: number; message: string }
  ): Promise<OctokitResponse<Review>> {
    const { owner, repo, pull_number, review_id, message } = params
    return this.octokit.request<Review>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/reviews/${review_id}/dismissals`,
      {
        method: 'PUT',
        body: { message },
      }
    )
  }

  /**
   * Submit a review for a pull request
   * @see https://docs.github.com/en/rest/pulls/reviews#submit-a-review-for-a-pull-request
   */
  async submitReview(
    params: GetPullParams & {
      review_id: number
      body?: string
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
    }
  ): Promise<OctokitResponse<Review>> {
    const { owner, repo, pull_number, review_id, ...body } = params
    return this.octokit.request<Review>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/reviews/${review_id}/events`,
      {
        method: 'POST',
        body,
      }
    )
  }

  /**
   * Update the branch of a pull request
   * @see https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch
   */
  async updateBranch(
    params: GetPullParams & { expected_head_sha?: string }
  ): Promise<OctokitResponse<{ message: string; url: string }>> {
    const { owner, repo, pull_number, expected_head_sha } = params
    return this.octokit.request<{ message: string; url: string }>(
      `/repos/${owner}/${repo}/pulls/${pull_number}/update-branch`,
      {
        method: 'PUT',
        body: expected_head_sha ? { expected_head_sha } : undefined,
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
