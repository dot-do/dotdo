/**
 * @dotdo/github - Octokit-compatible GitHub Client
 *
 * A lightweight, Octokit-compatible GitHub API client that works
 * in Cloudflare Workers and edge environments.
 */

import { ReposAPI } from './repos'
import { IssuesAPI } from './issues'
import { PullsAPI } from './pulls'
import { ActionsAPI } from './actions'
import { UsersAPI } from './users'

// ============================================================================
// Types
// ============================================================================

export interface OctokitOptions {
  auth?: string
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

export interface OctokitResponse<T> {
  status: number
  url: string
  headers: Record<string, string>
  data: T
}

// ============================================================================
// Error Classes
// ============================================================================

export class GitHubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

export class RequestError extends GitHubError {
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
// Octokit Client
// ============================================================================

export class Octokit {
  private auth?: string
  private baseUrl: string
  private userAgent: string
  private timeout: number

  readonly rest: {
    repos: ReposAPI
    issues: IssuesAPI
    pulls: PullsAPI
    actions: ActionsAPI
    users: UsersAPI
  }

  constructor(options: OctokitOptions = {}) {
    this.auth = options.auth
    this.baseUrl = options.baseUrl || 'https://api.github.com'
    this.userAgent = options.userAgent
      ? `${options.userAgent} octokit-dotdo/1.0.0`
      : 'octokit-dotdo/1.0.0'
    this.timeout = options.request?.timeout || 30000

    // Initialize API namespaces
    this.rest = {
      repos: new ReposAPI(this),
      issues: new IssuesAPI(this),
      pulls: new PullsAPI(this),
      actions: new ActionsAPI(this),
      users: new UsersAPI(this),
    }
  }

  /**
   * Make a request to the GitHub API
   */
  async request<T>(
    route: string,
    options: RequestOptions = {}
  ): Promise<OctokitResponse<T>> {
    const { method = 'GET', headers = {}, body } = options

    // Build URL
    const url = route.startsWith('http') ? route : `${this.baseUrl}${route}`

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    }

    if (this.auth) {
      requestHeaders['Authorization'] = `token ${this.auth}`
    }

    if (body) {
      requestHeaders['Content-Type'] = 'application/json'
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
          (errorData as any)?.message || `HTTP ${response.status}`,
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
        throw new GitHubError(`Request timeout after ${this.timeout}ms`)
      }

      throw error
    }
  }
}
