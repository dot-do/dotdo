/**
 * workers.do API Client
 *
 * Client for interacting with the workers.do platform for deployment management.
 * This is the platform layer that sits on top of the dotdo runtime/framework.
 *
 * Features:
 * - Project creation and management
 * - Deployment triggering and tracking
 * - Status checking and health monitoring
 * - Log streaming via WebSocket
 * - Environment variable and secret management
 * - Automatic retry with exponential backoff
 * - Timeout handling
 */

import { createClient } from '@dotdo/rpc'

/**
 * Deployment status
 */
export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'active'
  | 'failed'
  | 'cancelled'

/**
 * Log level for filtering
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Project configuration
 */
export interface Project {
  $id: string
  name: string
  url: string
  createdAt: string
  updatedAt?: string
  namespace?: string
  environment?: 'production' | 'staging' | 'development'
}

/**
 * Deployment record
 */
export interface Deployment {
  $id: string
  projectId: string
  version: string
  status: DeploymentStatus
  url?: string
  createdAt: string
  deployedAt?: string
  failedAt?: string
  error?: string
  bundleSize?: number
  buildTime?: number
}

/**
 * Log entry from workers.do
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
}

/**
 * Environment variable
 */
export interface EnvVar {
  key: string
  value: string
  isSecret: boolean
}

/**
 * Deployment health status
 */
export interface HealthStatus {
  healthy: boolean
  uptime: number
  lastCheck: string
  errors?: string[]
  metrics?: {
    requestCount: number
    errorRate: number
    avgResponseTime: number
  }
}

/**
 * Options for creating a project
 */
export interface CreateProjectOptions {
  name: string
  namespace?: string
  environment?: 'production' | 'staging' | 'development'
}

/**
 * Options for deploying
 */
export interface DeployOptions {
  projectId: string
  bundle: Uint8Array | ArrayBuffer
  version?: string
  environment?: string
  dryRun?: boolean
}

/**
 * Options for streaming logs
 */
export interface LogStreamOptions {
  projectId: string
  follow?: boolean
  level?: LogLevel
  since?: string
  tail?: number
}

/**
 * Options for setting environment variables
 */
export interface SetEnvOptions {
  projectId: string
  variables: Array<{ key: string; value: string; isSecret?: boolean }>
}

/**
 * workers.do API interface
 */
export interface WorkersDoAPI {
  projects: {
    create(options: CreateProjectOptions): Promise<Project>
    get(id: string): Promise<Project>
    list(): Promise<Project[]>
    delete(id: string): Promise<boolean>
  }
  deployments: {
    create(options: DeployOptions): Promise<Deployment>
    get(id: string): Promise<Deployment>
    list(projectId: string): Promise<Deployment[]>
    cancel(id: string): Promise<boolean>
  }
  logs: {
    stream(options: LogStreamOptions): Promise<ReadableStream<LogEntry>>
    get(projectId: string, options?: { limit?: number; level?: LogLevel }): Promise<LogEntry[]>
  }
  env: {
    set(options: SetEnvOptions): Promise<boolean>
    get(projectId: string): Promise<EnvVar[]>
    delete(projectId: string, key: string): Promise<boolean>
  }
  health: {
    check(projectId: string): Promise<HealthStatus>
  }
}

/**
 * Configuration for workers.do client
 */
export interface WorkersDoClientOptions {
  /** API endpoint (default: https://workers.do) */
  url?: string
  /** Authentication token */
  token: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number
}

const DEFAULT_URL = 'https://workers.do'
const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BASE_DELAY = 1000

/**
 * Check if an error is retryable (network/transient errors)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('aborted') ||
      message.includes('timeout')
    )
  }
  return false
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * workers.do Client
 *
 * Handles all interactions with the workers.do platform including:
 * - Project lifecycle management
 * - Deployment orchestration
 * - Log streaming
 * - Environment variable management
 */
export class WorkersDoClient {
  private api: WorkersDoAPI
  private token: string
  private timeout: number
  private maxRetries: number
  private retryBaseDelay: number

  constructor(options: WorkersDoClientOptions) {
    const {
      url = DEFAULT_URL,
      token,
      timeout = DEFAULT_TIMEOUT,
      maxRetries = DEFAULT_MAX_RETRIES,
      retryBaseDelay = DEFAULT_RETRY_BASE_DELAY,
    } = options

    this.token = token
    this.timeout = timeout
    this.maxRetries = maxRetries
    this.retryBaseDelay = retryBaseDelay

    // Create RPC client
    this.api = createClient<WorkersDoAPI>({
      url,
      timeout,
    })
  }

  /**
   * Execute operation with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry non-retryable errors
        if (!isRetryableError(error)) {
          throw lastError
        }

        // Last attempt - throw without retry
        if (attempt === this.maxRetries - 1) {
          break
        }

        // Exponential backoff with jitter (0-25% added to prevent thundering herd)
        const baseExponentialDelay = this.retryBaseDelay * Math.pow(2, attempt)
        const jitterFactor = 0.25
        const delay = baseExponentialDelay * (1 + Math.random() * jitterFactor)
        await sleep(delay)
      }
    }

    throw lastError || new Error(`Failed to ${operationName}`)
  }

  /**
   * Create a new project on workers.do
   */
  async createProject(options: CreateProjectOptions): Promise<Project> {
    return this.withRetry(
      () => this.api.projects.create(options),
      'create project'
    )
  }

  /**
   * Get project by ID
   */
  async getProject(id: string): Promise<Project> {
    return this.withRetry(
      () => this.api.projects.get(id),
      'get project'
    )
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<Project[]> {
    return this.withRetry(
      () => this.api.projects.list(),
      'list projects'
    )
  }

  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<boolean> {
    return this.withRetry(
      () => this.api.projects.delete(id),
      'delete project'
    )
  }

  /**
   * Deploy a bundle to workers.do
   *
   * Uploads the bundle and triggers deployment. Returns deployment record
   * that can be polled for status updates.
   */
  async deploy(options: DeployOptions): Promise<Deployment> {
    return this.withRetry(
      () => this.api.deployments.create(options),
      'deploy bundle'
    )
  }

  /**
   * Get deployment by ID
   */
  async getDeployment(id: string): Promise<Deployment> {
    return this.withRetry(
      () => this.api.deployments.get(id),
      'get deployment'
    )
  }

  /**
   * List deployments for a project
   */
  async listDeployments(projectId: string): Promise<Deployment[]> {
    return this.withRetry(
      () => this.api.deployments.list(projectId),
      'list deployments'
    )
  }

  /**
   * Cancel a pending or in-progress deployment
   */
  async cancelDeployment(id: string): Promise<boolean> {
    return this.withRetry(
      () => this.api.deployments.cancel(id),
      'cancel deployment'
    )
  }

  /**
   * Stream logs from a deployed project
   *
   * Returns a ReadableStream of log entries. Use with for-await-of:
   *
   * @example
   * ```typescript
   * const stream = await client.streamLogs({ projectId: 'my-project', follow: true })
   * for await (const log of stream) {
   *   console.log(`[${log.level}] ${log.message}`)
   * }
   * ```
   */
  async streamLogs(options: LogStreamOptions): Promise<ReadableStream<LogEntry>> {
    return this.withRetry(
      () => this.api.logs.stream(options),
      'stream logs'
    )
  }

  /**
   * Get recent logs (non-streaming)
   */
  async getLogs(
    projectId: string,
    options?: { limit?: number; level?: LogLevel }
  ): Promise<LogEntry[]> {
    return this.withRetry(
      () => this.api.logs.get(projectId, options),
      'get logs'
    )
  }

  /**
   * Set environment variables for a project
   */
  async setEnv(options: SetEnvOptions): Promise<boolean> {
    return this.withRetry(
      () => this.api.env.set(options),
      'set environment variables'
    )
  }

  /**
   * Get environment variables for a project
   */
  async getEnv(projectId: string): Promise<EnvVar[]> {
    return this.withRetry(
      () => this.api.env.get(projectId),
      'get environment variables'
    )
  }

  /**
   * Delete an environment variable
   */
  async deleteEnv(projectId: string, key: string): Promise<boolean> {
    return this.withRetry(
      () => this.api.env.delete(projectId, key),
      'delete environment variable'
    )
  }

  /**
   * Check deployment health status
   */
  async checkHealth(projectId: string): Promise<HealthStatus> {
    return this.withRetry(
      () => this.api.health.check(projectId),
      'check health'
    )
  }

  /**
   * Wait for deployment to complete
   *
   * Polls deployment status until it reaches a terminal state (active/failed/cancelled).
   *
   * @param deploymentId - Deployment ID to wait for
   * @param pollInterval - How often to poll in milliseconds (default: 2000)
   * @param maxWaitTime - Maximum time to wait in milliseconds (default: 300000 = 5 minutes)
   * @returns Final deployment status
   */
  async waitForDeployment(
    deploymentId: string,
    pollInterval: number = 2000,
    maxWaitTime: number = 300000
  ): Promise<Deployment> {
    const startTime = Date.now()

    while (true) {
      const deployment = await this.getDeployment(deploymentId)

      // Check if deployment reached terminal state
      if (['active', 'failed', 'cancelled'].includes(deployment.status)) {
        return deployment
      }

      // Check timeout
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`Deployment timeout after ${maxWaitTime}ms`)
      }

      // Wait before next poll
      await sleep(pollInterval)
    }
  }
}

/**
 * Create a workers.do client instance
 */
export function createWorkersDoClient(options: WorkersDoClientOptions): WorkersDoClient {
  return new WorkersDoClient(options)
}
