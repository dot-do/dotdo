/**
 * @dotdo/gitlab - Pipelines API
 *
 * Implements GitLab CI/CD Pipelines API endpoints.
 * @see https://docs.gitlab.com/ee/api/pipelines.html
 */

import type { GitLab, GitLabResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Pipeline {
  id: number
  iid: number
  project_id: number
  sha: string
  ref: string
  status: PipelineStatus
  source: PipelineSource
  created_at: string
  updated_at: string
  web_url: string
  before_sha?: string
  tag?: boolean
  yaml_errors?: string | null
  user?: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
  started_at?: string | null
  finished_at?: string | null
  committed_at?: string | null
  duration?: number | null
  queued_duration?: number | null
  coverage?: string | null
  detailed_status?: {
    icon: string
    text: string
    label: string
    group: string
    tooltip: string
    has_details: boolean
    details_path: string
    illustration: null
    favicon: string
  }
}

export type PipelineStatus =
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'scheduled'

export type PipelineSource =
  | 'push'
  | 'web'
  | 'trigger'
  | 'schedule'
  | 'api'
  | 'external'
  | 'pipeline'
  | 'chat'
  | 'webide'
  | 'merge_request_event'
  | 'external_pull_request_event'
  | 'parent_pipeline'
  | 'ondemand_dast_scan'
  | 'ondemand_dast_validation'

export interface PipelineJob {
  id: number
  status: JobStatus
  stage: string
  name: string
  ref: string
  tag: boolean
  coverage?: number | null
  allow_failure: boolean
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  duration?: number | null
  queued_duration?: number | null
  user?: {
    id: number
    username: string
    name: string
    avatar_url?: string
  }
  commit?: {
    id: string
    short_id: string
    title: string
    message?: string
    author_name: string
    author_email: string
    created_at: string
  }
  pipeline?: {
    id: number
    project_id: number
    ref: string
    sha: string
    status: PipelineStatus
  }
  web_url: string
  artifacts?: Array<{
    file_type: string
    size: number
    filename: string
    file_format?: string | null
  }>
  runner?: {
    id: number
    description: string
    active: boolean
    is_shared: boolean
    name?: string
    online?: boolean
    status?: string
  } | null
  artifacts_expire_at?: string | null
  tag_list?: string[]
}

export type JobStatus =
  | 'created'
  | 'pending'
  | 'running'
  | 'failed'
  | 'success'
  | 'canceled'
  | 'skipped'
  | 'manual'

export interface PipelineVariable {
  variable_type: 'env_var' | 'file'
  key: string
  value: string
}

export interface ProjectPipelineParams {
  id: string | number
}

export interface GetPipelineParams extends ProjectPipelineParams {
  pipeline_id: number
}

export interface ListPipelinesParams extends ProjectPipelineParams {
  scope?: 'running' | 'pending' | 'finished' | 'branches' | 'tags'
  status?: PipelineStatus
  source?: PipelineSource
  ref?: string
  sha?: string
  yaml_errors?: boolean
  username?: string
  updated_after?: string
  updated_before?: string
  order_by?: 'id' | 'status' | 'ref' | 'updated_at' | 'user_id'
  sort?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface CreatePipelineParams extends ProjectPipelineParams {
  ref: string
  variables?: Array<{ key: string; value: string; variable_type?: 'env_var' | 'file' }>
}

export interface ListJobsParams extends GetPipelineParams {
  scope?: JobStatus | JobStatus[]
  include_retried?: boolean
  per_page?: number
  page?: number
}

export interface GetJobParams extends ProjectPipelineParams {
  job_id: number
}

export interface RetryJobParams extends GetJobParams {}
export interface CancelJobParams extends GetJobParams {}
export interface PlayJobParams extends GetJobParams {
  job_variables_attributes?: Array<{ key: string; value: string }>
}

// ============================================================================
// Pipelines API
// ============================================================================

export class PipelinesAPI {
  constructor(private gitlab: GitLab) {}

  /**
   * List project pipelines
   * @see https://docs.gitlab.com/ee/api/pipelines.html#list-project-pipelines
   */
  async list(params: ListPipelinesParams): Promise<GitLabResponse<Pipeline[]>> {
    const { id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<Pipeline[]>(`/projects/${encodedId}/pipelines${query}`)
  }

  /**
   * Get a single pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#get-a-single-pipeline
   */
  async get(params: GetPipelineParams): Promise<GitLabResponse<Pipeline>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/pipelines/${pipeline_id}`)
  }

  /**
   * Get the latest pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#get-the-latest-pipeline
   */
  async getLatest(params: ProjectPipelineParams & { ref?: string }): Promise<GitLabResponse<Pipeline>> {
    const { id, ref } = params
    const encodedId = encodeURIComponent(String(id))
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/pipelines/latest${query}`)
  }

  /**
   * Create a new pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#create-a-new-pipeline
   */
  async create(params: CreatePipelineParams): Promise<GitLabResponse<Pipeline>> {
    const { id, ref, variables } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/pipeline`, {
      method: 'POST',
      body: { ref, variables },
    })
  }

  /**
   * Retry a pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#retry-jobs-in-a-pipeline
   */
  async retry(params: GetPipelineParams): Promise<GitLabResponse<Pipeline>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/pipelines/${pipeline_id}/retry`, {
      method: 'POST',
    })
  }

  /**
   * Cancel a pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#cancel-a-pipelines-jobs
   */
  async cancel(params: GetPipelineParams): Promise<GitLabResponse<Pipeline>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/pipelines/${pipeline_id}/cancel`, {
      method: 'POST',
    })
  }

  /**
   * Delete a pipeline
   * @see https://docs.gitlab.com/ee/api/pipelines.html#delete-a-pipeline
   */
  async delete(params: GetPipelineParams): Promise<GitLabResponse<void>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<void>(`/projects/${encodedId}/pipelines/${pipeline_id}`, {
      method: 'DELETE',
    })
  }

  /**
   * Get pipeline variables
   * @see https://docs.gitlab.com/ee/api/pipelines.html#get-variables-of-a-pipeline
   */
  async getVariables(params: GetPipelineParams): Promise<GitLabResponse<PipelineVariable[]>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineVariable[]>(`/projects/${encodedId}/pipelines/${pipeline_id}/variables`)
  }

  /**
   * Get pipeline test report
   * @see https://docs.gitlab.com/ee/api/pipelines.html#get-a-pipelines-test-report
   */
  async getTestReport(params: GetPipelineParams): Promise<GitLabResponse<{
    total_time: number
    total_count: number
    success_count: number
    failed_count: number
    skipped_count: number
    error_count: number
    test_suites: Array<{
      name: string
      total_time: number
      total_count: number
      success_count: number
      failed_count: number
      skipped_count: number
      error_count: number
      test_cases: Array<{
        status: string
        name: string
        classname: string
        execution_time: number
        system_output?: string | null
        stack_trace?: string | null
      }>
    }>
  }>> {
    const { id, pipeline_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request(`/projects/${encodedId}/pipelines/${pipeline_id}/test_report`)
  }

  // ==========================================================================
  // Jobs
  // ==========================================================================

  /**
   * List pipeline jobs
   * @see https://docs.gitlab.com/ee/api/jobs.html#list-pipeline-jobs
   */
  async listJobs(params: ListJobsParams): Promise<GitLabResponse<PipelineJob[]>> {
    const { id, pipeline_id, ...queryParams } = params
    const encodedId = encodeURIComponent(String(id))
    const query = buildQueryString(queryParams)
    return this.gitlab.request<PipelineJob[]>(`/projects/${encodedId}/pipelines/${pipeline_id}/jobs${query}`)
  }

  /**
   * Get a single job
   * @see https://docs.gitlab.com/ee/api/jobs.html#get-a-single-job
   */
  async getJob(params: GetJobParams): Promise<GitLabResponse<PipelineJob>> {
    const { id, job_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineJob>(`/projects/${encodedId}/jobs/${job_id}`)
  }

  /**
   * Retry a job
   * @see https://docs.gitlab.com/ee/api/jobs.html#retry-a-job
   */
  async retryJob(params: RetryJobParams): Promise<GitLabResponse<PipelineJob>> {
    const { id, job_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineJob>(`/projects/${encodedId}/jobs/${job_id}/retry`, {
      method: 'POST',
    })
  }

  /**
   * Cancel a job
   * @see https://docs.gitlab.com/ee/api/jobs.html#cancel-a-job
   */
  async cancelJob(params: CancelJobParams): Promise<GitLabResponse<PipelineJob>> {
    const { id, job_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineJob>(`/projects/${encodedId}/jobs/${job_id}/cancel`, {
      method: 'POST',
    })
  }

  /**
   * Play a manual job
   * @see https://docs.gitlab.com/ee/api/jobs.html#play-a-job
   */
  async playJob(params: PlayJobParams): Promise<GitLabResponse<PipelineJob>> {
    const { id, job_id, job_variables_attributes } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineJob>(`/projects/${encodedId}/jobs/${job_id}/play`, {
      method: 'POST',
      body: job_variables_attributes ? { job_variables_attributes } : undefined,
    })
  }

  /**
   * Erase a job (remove artifacts and trace)
   * @see https://docs.gitlab.com/ee/api/jobs.html#erase-a-job
   */
  async eraseJob(params: GetJobParams): Promise<GitLabResponse<PipelineJob>> {
    const { id, job_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<PipelineJob>(`/projects/${encodedId}/jobs/${job_id}/erase`, {
      method: 'POST',
    })
  }

  /**
   * Get job trace (log)
   * @see https://docs.gitlab.com/ee/api/jobs.html#get-a-log-file
   */
  async getJobTrace(params: GetJobParams): Promise<GitLabResponse<string>> {
    const { id, job_id } = params
    const encodedId = encodeURIComponent(String(id))
    return this.gitlab.request<string>(`/projects/${encodedId}/jobs/${job_id}/trace`)
  }

  // ==========================================================================
  // Pipeline Triggers
  // ==========================================================================

  /**
   * Trigger a pipeline with a token
   * @see https://docs.gitlab.com/ee/api/pipeline_triggers.html#trigger-a-pipeline-with-a-token
   */
  async trigger(params: ProjectPipelineParams & {
    token: string
    ref: string
    variables?: Record<string, string>
  }): Promise<GitLabResponse<Pipeline>> {
    const { id, token, ref, variables } = params
    const encodedId = encodeURIComponent(String(id))

    // Build form data for trigger endpoint
    const body: Record<string, unknown> = { token, ref }
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        body[`variables[${key}]`] = value
      }
    }

    return this.gitlab.request<Pipeline>(`/projects/${encodedId}/trigger/pipeline`, {
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
    if (Array.isArray(value)) {
      searchParams.set(key, value.join(','))
    } else {
      searchParams.set(key, String(value))
    }
  }
  return `?${searchParams.toString()}`
}
