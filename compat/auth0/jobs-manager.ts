/**
 * @dotdo/auth0 - Jobs Manager
 *
 * Auth0 Management API Jobs operations for async tasks like email verification.
 *
 * @see https://auth0.com/docs/api/management/v2#!/Jobs
 * @module
 */

import type { UserRecord } from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for verification email job
 */
export interface VerifyEmailJobParams {
  /** User ID */
  user_id: string
  /** Client ID (optional) */
  client_id?: string
  /** Identity info (optional) */
  identity?: {
    user_id: string
    provider: string
  }
  /** Organization ID (optional) */
  organization_id?: string
}

/**
 * Job response
 */
export interface JobResponse {
  /** Job status */
  status: 'pending' | 'processing' | 'completed' | 'failed'
  /** Job type */
  type: string
  /** Job ID */
  id: string
  /** Created at */
  created_at: string
  /** Connection ID */
  connection_id?: string
}

/**
 * Parameters for user import job
 */
export interface UsersImportJobParams {
  /** Connection ID */
  connection_id: string
  /** Users file (JSON) */
  users: string
  /** Upsert mode */
  upsert?: boolean
  /** External ID */
  external_id?: string
  /** Send completion email */
  send_completion_email?: boolean
}

/**
 * Parameters for users export job
 */
export interface UsersExportJobParams {
  /** Connection ID (optional) */
  connection_id?: string
  /** Format */
  format?: 'csv' | 'json'
  /** Fields to include */
  fields?: Array<{ name: string; export_as?: string }>
  /** Limit */
  limit?: number
}

// ============================================================================
// JOBS MANAGER OPTIONS
// ============================================================================

/**
 * Options for JobsManager
 */
export interface JobsManagerOptions {
  /** Auth0 domain */
  domain: string
  /** User lookup function */
  getUser: (userId: string) => UserRecord | undefined
}

// ============================================================================
// JOBS MANAGER
// ============================================================================

/**
 * Auth0 Jobs Manager
 *
 * Provides async job operations like email verification.
 */
export class JobsManager {
  private domain: string
  private getUser: (userId: string) => UserRecord | undefined

  // Store for active jobs
  private jobs = new Map<string, JobResponse>()

  constructor(options: JobsManagerOptions) {
    this.domain = options.domain
    this.getUser = options.getUser
  }

  /**
   * Send a verification email
   *
   * @see https://auth0.com/docs/api/management/v2#!/Jobs/post_verification_email
   */
  async verifyEmail(params: VerifyEmailJobParams): Promise<JobResponse> {
    const user = this.getUser(params.user_id)
    if (!user) {
      throw new Auth0ManagementError('User not found', 404, 'inexistent_user')
    }

    if (!user.email) {
      throw new Auth0ManagementError('User has no email address', 400, 'invalid_body')
    }

    const jobId = this.generateJobId()
    const now = new Date().toISOString()

    const job: JobResponse = {
      status: 'completed', // In-memory simulation - immediately complete
      type: 'verification_email',
      id: jobId,
      created_at: now,
    }

    this.jobs.set(jobId, job)

    return job
  }

  /**
   * Get a job by ID
   *
   * @see https://auth0.com/docs/api/management/v2#!/Jobs/get_jobs_by_id
   */
  async get(params: { id: string }): Promise<JobResponse | null> {
    return this.jobs.get(params.id) ?? null
  }

  /**
   * Import users
   *
   * @see https://auth0.com/docs/api/management/v2#!/Jobs/post_users_imports
   */
  async importUsers(params: UsersImportJobParams): Promise<JobResponse> {
    const jobId = this.generateJobId()
    const now = new Date().toISOString()

    const job: JobResponse = {
      status: 'pending',
      type: 'users_import',
      id: jobId,
      created_at: now,
      connection_id: params.connection_id,
    }

    this.jobs.set(jobId, job)

    return job
  }

  /**
   * Export users
   *
   * @see https://auth0.com/docs/api/management/v2#!/Jobs/post_users_exports
   */
  async exportUsers(params: UsersExportJobParams): Promise<JobResponse> {
    const jobId = this.generateJobId()
    const now = new Date().toISOString()

    const job: JobResponse = {
      status: 'pending',
      type: 'users_export',
      id: jobId,
      created_at: now,
      connection_id: params.connection_id,
    }

    this.jobs.set(jobId, job)

    return job
  }

  /**
   * Generate a job ID
   */
  private generateJobId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return `job_${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`
  }
}
