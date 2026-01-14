/**
 * @dotdo/gitlab - GitLab API Client
 *
 * A lightweight, edge-compatible GitLab API client that works
 * in Cloudflare Workers and edge environments.
 * @see https://docs.gitlab.com/ee/api/
 */

import { ProjectsAPI } from './projects'
import { IssuesAPI } from './issues'
import { MergeRequestsAPI } from './merge-requests'
import { PipelinesAPI } from './pipelines'
import { UsersAPI } from './users'

// ============================================================================
// Types
// ============================================================================

export interface GitLabOptions {
  token?: string
  baseUrl?: string
  userAgent?: string
  request?: {
    timeout?: number
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
}

export interface GitLabResponse<T> {
  status: number
  url: string
  headers: Record<string, string>
  data: T
}

// ============================================================================
// Error Classes
// ============================================================================

export class GitLabError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitLabError'
  }
}

export class RequestError extends GitLabError {
  status: number
  response: unknown

  constructor(message: string, status: number, response: unknown) {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.response = response
  }
}

// ============================================================================
// GitLab Client
// ============================================================================

export class GitLab {
  private token?: string
  private baseUrl: string
  private userAgent: string
  private timeout: number

  readonly api: {
    projects: ProjectsAPI
    issues: IssuesAPI
    mergeRequests: MergeRequestsAPI
    pipelines: PipelinesAPI
    users: UsersAPI
  }

  constructor(options: GitLabOptions = {}) {
    this.token = options.token
    this.baseUrl = options.baseUrl || 'https://gitlab.com/api/v4'
    this.userAgent = options.userAgent
      ? `${options.userAgent} gitlab-dotdo/1.0.0`
      : 'gitlab-dotdo/1.0.0'
    this.timeout = options.request?.timeout || 30000

    // Initialize API namespaces
    this.api = {
      projects: new ProjectsAPI(this),
      issues: new IssuesAPI(this),
      mergeRequests: new MergeRequestsAPI(this),
      pipelines: new PipelinesAPI(this),
      users: new UsersAPI(this),
    }
  }

  /**
   * Make a request to the GitLab API
   */
  async request<T>(
    route: string,
    options: RequestOptions = {}
  ): Promise<GitLabResponse<T>> {
    const { method = 'GET', headers = {}, body } = options

    // Build URL
    const url = route.startsWith('http') ? route : `${this.baseUrl}${route}`

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      ...headers,
    }

    if (this.token) {
      requestHeaders['PRIVATE-TOKEN'] = this.token
    }

    // Make request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Parse response headers
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      // Handle error responses
      if (!response.ok) {
        let errorData: unknown = {}
        try {
          errorData = await response.json()
        } catch {
          // Response may not be JSON
        }
        throw new RequestError(
          (errorData as any)?.message || (errorData as any)?.error || `HTTP ${response.status}`,
          response.status,
          errorData
        )
      }

      // Parse successful response
      let data: T
      if (response.status === 204) {
        data = undefined as T
      } else {
        try {
          data = await response.json()
        } catch {
          data = undefined as T
        }
      }

      return {
        status: response.status,
        url: response.url,
        headers: responseHeaders,
        data,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof RequestError) {
        throw error
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new GitLabError(`Request timeout after ${this.timeout}ms`)
      }

      throw error
    }
  }
}
