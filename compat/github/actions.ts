/**
 * @dotdo/github - Actions API
 *
 * Implements GitHub Actions API endpoints.
 * @see https://docs.github.com/en/rest/actions
 */

import type { Octokit, OctokitResponse } from './client'

// ============================================================================
// Types
// ============================================================================

export interface Workflow {
  id: number
  node_id: string
  name: string
  path: string
  state: 'active' | 'deleted' | 'disabled_fork' | 'disabled_inactivity' | 'disabled_manually'
  created_at: string
  updated_at: string
  url: string
  html_url: string
  badge_url: string
}

export interface WorkflowRun {
  id: number
  name?: string | null
  node_id?: string
  head_branch?: string | null
  head_sha: string
  path?: string
  display_title?: string
  run_number: number
  event: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending' | null
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | null
  workflow_id: number
  check_suite_id?: number
  check_suite_node_id?: string
  url: string
  html_url: string
  created_at: string
  updated_at: string
  run_started_at?: string
  jobs_url?: string
  logs_url?: string
  check_suite_url?: string
  artifacts_url?: string
  cancel_url?: string
  rerun_url?: string
  workflow_url?: string
  actor?: {
    login: string
    id: number
    avatar_url?: string
  }
  triggering_actor?: {
    login: string
    id: number
  }
  run_attempt?: number
}

export interface WorkflowJob {
  id: number
  run_id: number
  run_url: string
  node_id?: string
  head_sha: string
  url: string
  html_url?: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting'
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null
  started_at: string
  completed_at?: string | null
  name: string
  steps?: Array<{
    name: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | null
    number: number
    started_at?: string
    completed_at?: string
  }>
  runner_id?: number | null
  runner_name?: string | null
  runner_group_id?: number | null
  runner_group_name?: string | null
}

export interface Artifact {
  id: number
  node_id: string
  name: string
  size_in_bytes: number
  url: string
  archive_download_url: string
  expired: boolean
  created_at: string
  updated_at: string
  expires_at: string
}

export interface WorkflowDispatchParams {
  owner: string
  repo: string
  workflow_id: string | number
  ref: string
  inputs?: Record<string, string>
}

export interface ListWorkflowRunsParams {
  owner: string
  repo: string
  workflow_id: string | number
  actor?: string
  branch?: string
  event?: string
  status?: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  created?: string
  exclude_pull_requests?: boolean
  check_suite_id?: number
  head_sha?: string
  per_page?: number
  page?: number
}

export interface GetWorkflowRunParams {
  owner: string
  repo: string
  run_id: number
  exclude_pull_requests?: boolean
}

export interface ListJobsParams {
  owner: string
  repo: string
  run_id: number
  filter?: 'latest' | 'all'
  per_page?: number
  page?: number
}

export interface ListArtifactsParams {
  owner: string
  repo: string
  run_id: number
  per_page?: number
  page?: number
}

export interface DownloadArtifactParams {
  owner: string
  repo: string
  artifact_id: number
  archive_format: 'zip'
}

// ============================================================================
// Actions API
// ============================================================================

export class ActionsAPI {
  constructor(private octokit: Octokit) {}

  /**
   * Create a workflow dispatch event
   * @see https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
   */
  async createWorkflowDispatch(
    params: WorkflowDispatchParams
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, workflow_id, ref, inputs } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
      {
        method: 'POST',
        body: { ref, inputs },
      }
    )
  }

  /**
   * List workflow runs for a workflow
   * @see https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
   */
  async listWorkflowRuns(
    params: ListWorkflowRunsParams
  ): Promise<OctokitResponse<{ total_count: number; workflow_runs: WorkflowRun[] }>> {
    const { owner, repo, workflow_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; workflow_runs: WorkflowRun[] }>(
      `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs${query}`
    )
  }

  /**
   * List workflow runs for a repository
   * @see https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository
   */
  async listWorkflowRunsForRepo(
    params: Omit<ListWorkflowRunsParams, 'workflow_id'>
  ): Promise<OctokitResponse<{ total_count: number; workflow_runs: WorkflowRun[] }>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; workflow_runs: WorkflowRun[] }>(
      `/repos/${owner}/${repo}/actions/runs${query}`
    )
  }

  /**
   * Get a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run
   */
  async getWorkflowRun(
    params: GetWorkflowRunParams
  ): Promise<OctokitResponse<WorkflowRun>> {
    const { owner, repo, run_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<WorkflowRun>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}${query}`
    )
  }

  /**
   * Cancel a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-runs#cancel-a-workflow-run
   */
  async cancelWorkflowRun(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'>
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/cancel`,
      { method: 'POST' }
    )
  }

  /**
   * Re-run a workflow
   * @see https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow
   */
  async reRunWorkflow(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'> & {
      enable_debug_logging?: boolean
    }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id, enable_debug_logging } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/rerun`,
      {
        method: 'POST',
        body: enable_debug_logging ? { enable_debug_logging } : undefined,
      }
    )
  }

  /**
   * Re-run failed jobs for a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run
   */
  async reRunWorkflowFailedJobs(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'> & {
      enable_debug_logging?: boolean
    }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id, enable_debug_logging } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/rerun-failed-jobs`,
      {
        method: 'POST',
        body: enable_debug_logging ? { enable_debug_logging } : undefined,
      }
    )
  }

  /**
   * Delete a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-runs#delete-a-workflow-run
   */
  async deleteWorkflowRun(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'>
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}`,
      { method: 'DELETE' }
    )
  }

  // ==========================================================================
  // Workflow Run Logs
  // ==========================================================================

  /**
   * Download workflow run logs
   * @see https://docs.github.com/en/rest/actions/workflow-runs#download-workflow-run-logs
   */
  async downloadWorkflowRunLogs(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'>
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/logs`
    )
  }

  /**
   * Delete workflow run logs
   * @see https://docs.github.com/en/rest/actions/workflow-runs#delete-workflow-run-logs
   */
  async deleteWorkflowRunLogs(
    params: Pick<GetWorkflowRunParams, 'owner' | 'repo' | 'run_id'>
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, run_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/logs`,
      { method: 'DELETE' }
    )
  }

  // ==========================================================================
  // Jobs
  // ==========================================================================

  /**
   * List jobs for a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run
   */
  async listJobsForWorkflowRun(
    params: ListJobsParams
  ): Promise<OctokitResponse<{ total_count: number; jobs: WorkflowJob[] }>> {
    const { owner, repo, run_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; jobs: WorkflowJob[] }>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/jobs${query}`
    )
  }

  /**
   * Get a job for a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-jobs#get-a-job-for-a-workflow-run
   */
  async getJobForWorkflowRun(
    params: { owner: string; repo: string; job_id: number }
  ): Promise<OctokitResponse<WorkflowJob>> {
    const { owner, repo, job_id } = params
    return this.octokit.request<WorkflowJob>(
      `/repos/${owner}/${repo}/actions/jobs/${job_id}`
    )
  }

  /**
   * Download job logs for a workflow run
   * @see https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run
   */
  async downloadJobLogsForWorkflowRun(
    params: { owner: string; repo: string; job_id: number }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, job_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/jobs/${job_id}/logs`
    )
  }

  // ==========================================================================
  // Artifacts
  // ==========================================================================

  /**
   * List workflow run artifacts
   * @see https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts
   */
  async listWorkflowRunArtifacts(
    params: ListArtifactsParams
  ): Promise<OctokitResponse<{ total_count: number; artifacts: Artifact[] }>> {
    const { owner, repo, run_id, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; artifacts: Artifact[] }>(
      `/repos/${owner}/${repo}/actions/runs/${run_id}/artifacts${query}`
    )
  }

  /**
   * List artifacts for a repository
   * @see https://docs.github.com/en/rest/actions/artifacts#list-artifacts-for-a-repository
   */
  async listArtifactsForRepo(
    params: { owner: string; repo: string; per_page?: number; page?: number; name?: string }
  ): Promise<OctokitResponse<{ total_count: number; artifacts: Artifact[] }>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; artifacts: Artifact[] }>(
      `/repos/${owner}/${repo}/actions/artifacts${query}`
    )
  }

  /**
   * Get an artifact
   * @see https://docs.github.com/en/rest/actions/artifacts#get-an-artifact
   */
  async getArtifact(
    params: { owner: string; repo: string; artifact_id: number }
  ): Promise<OctokitResponse<Artifact>> {
    const { owner, repo, artifact_id } = params
    return this.octokit.request<Artifact>(
      `/repos/${owner}/${repo}/actions/artifacts/${artifact_id}`
    )
  }

  /**
   * Delete an artifact
   * @see https://docs.github.com/en/rest/actions/artifacts#delete-an-artifact
   */
  async deleteArtifact(
    params: { owner: string; repo: string; artifact_id: number }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, artifact_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/artifacts/${artifact_id}`,
      { method: 'DELETE' }
    )
  }

  // ==========================================================================
  // Workflows
  // ==========================================================================

  /**
   * List repository workflows
   * @see https://docs.github.com/en/rest/actions/workflows#list-repository-workflows
   */
  async listRepoWorkflows(
    params: { owner: string; repo: string; per_page?: number; page?: number }
  ): Promise<OctokitResponse<{ total_count: number; workflows: Workflow[] }>> {
    const { owner, repo, ...queryParams } = params
    const query = buildQueryString(queryParams)
    return this.octokit.request<{ total_count: number; workflows: Workflow[] }>(
      `/repos/${owner}/${repo}/actions/workflows${query}`
    )
  }

  /**
   * Get a workflow
   * @see https://docs.github.com/en/rest/actions/workflows#get-a-workflow
   */
  async getWorkflow(
    params: { owner: string; repo: string; workflow_id: string | number }
  ): Promise<OctokitResponse<Workflow>> {
    const { owner, repo, workflow_id } = params
    return this.octokit.request<Workflow>(
      `/repos/${owner}/${repo}/actions/workflows/${workflow_id}`
    )
  }

  /**
   * Disable a workflow
   * @see https://docs.github.com/en/rest/actions/workflows#disable-a-workflow
   */
  async disableWorkflow(
    params: { owner: string; repo: string; workflow_id: string | number }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, workflow_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/disable`,
      { method: 'PUT' }
    )
  }

  /**
   * Enable a workflow
   * @see https://docs.github.com/en/rest/actions/workflows#enable-a-workflow
   */
  async enableWorkflow(
    params: { owner: string; repo: string; workflow_id: string | number }
  ): Promise<OctokitResponse<void>> {
    const { owner, repo, workflow_id } = params
    return this.octokit.request<void>(
      `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/enable`,
      { method: 'PUT' }
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
