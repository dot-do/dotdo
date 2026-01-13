/**
 * API Fixtures for E2E Tests
 *
 * Provides fixtures for API testing with type-safe request helpers.
 * Includes response validation and error handling utilities.
 */

import { test as base, expect } from '@playwright/test'
import type { APIRequestContext, APIResponse } from '@playwright/test'

/**
 * API fixture types
 */
export type APIFixtures = {
  /** Pre-configured API client */
  apiClient: APIClient

  /** Authenticated API client */
  authenticatedApiClient: APIClient
}

/**
 * Type-safe API client wrapper
 */
export class APIClient {
  constructor(
    private request: APIRequestContext,
    private authToken?: string
  ) {}

  /**
   * Get default headers for requests
   */
  private getHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...additionalHeaders,
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    return headers
  }

  /**
   * Make a GET request
   */
  async get<T = unknown>(path: string, options?: RequestOptions): Promise<APIResult<T>> {
    const response = await this.request.get(path, {
      headers: this.getHeaders(options?.headers),
      params: options?.params,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Make a POST request
   */
  async post<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<APIResult<T>> {
    const response = await this.request.post(path, {
      headers: this.getHeaders(options?.headers),
      data,
      params: options?.params,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Make a PUT request
   */
  async put<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<APIResult<T>> {
    const response = await this.request.put(path, {
      headers: this.getHeaders(options?.headers),
      data,
      params: options?.params,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Make a PATCH request
   */
  async patch<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<APIResult<T>> {
    const response = await this.request.patch(path, {
      headers: this.getHeaders(options?.headers),
      data,
      params: options?.params,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Make a DELETE request
   */
  async delete<T = unknown>(path: string, options?: RequestOptions): Promise<APIResult<T>> {
    const response = await this.request.delete(path, {
      headers: this.getHeaders(options?.headers),
      params: options?.params,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Parse API response
   */
  private async parseResponse<T>(response: APIResponse): Promise<APIResult<T>> {
    const status = response.status()
    const headers = response.headers()
    const contentType = headers['content-type'] || ''

    let data: T | undefined
    let error: APIError | undefined

    try {
      if (contentType.includes('application/json')) {
        const json = await response.json()

        if (status >= 400) {
          error = json.error || { code: 'UNKNOWN', message: 'Request failed' }
        } else {
          data = json as T
        }
      } else {
        // Non-JSON response
        const text = await response.text()
        if (status >= 400) {
          error = { code: 'UNKNOWN', message: text }
        }
      }
    } catch {
      // Failed to parse response
      if (status >= 400) {
        error = { code: 'PARSE_ERROR', message: 'Failed to parse response' }
      }
    }

    return {
      ok: status < 400,
      status,
      headers,
      data,
      error,
    }
  }

  /**
   * Health check helper
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const result = await this.get<{ status: string; timestamp: string }>('/api/health')
    return {
      healthy: result.ok && result.data?.status === 'healthy',
      status: result.data?.status,
      timestamp: result.data?.timestamp,
      responseTime: 0, // Would need timing to calculate
    }
  }
}

/**
 * Request options
 */
export type RequestOptions = {
  headers?: Record<string, string>
  params?: Record<string, string>
}

/**
 * API response result
 */
export type APIResult<T> = {
  ok: boolean
  status: number
  headers: Record<string, string>
  data?: T
  error?: APIError
}

/**
 * API error structure
 */
export type APIError = {
  code: string
  message: string
  details?: Record<string, string[]>
}

/**
 * Health check result
 */
export type HealthCheckResult = {
  healthy: boolean
  status?: string
  timestamp?: string
  responseTime: number
}

/**
 * Extended test with API fixtures
 */
export const test = base.extend<APIFixtures>({
  // Pre-configured API client
  apiClient: async ({ request }, use) => {
    const client = new APIClient(request)
    await use(client)
  },

  // Authenticated API client
  authenticatedApiClient: async ({ request }, use) => {
    // TODO: Get auth token from login
    // For now, use without auth
    const client = new APIClient(request)
    await use(client)
  },
})

/**
 * API response assertions
 */
export const apiExpect = {
  /**
   * Assert response is successful (2xx)
   */
  toBeSuccessful<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(true)
    expect(result.status).toBeGreaterThanOrEqual(200)
    expect(result.status).toBeLessThan(300)
  },

  /**
   * Assert response is created (201)
   */
  toBeCreated<T>(result: APIResult<T>): void {
    expect(result.status).toBe(201)
    expect(result.data).toBeDefined()
  },

  /**
   * Assert response is not found (404)
   */
  toBeNotFound<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  },

  /**
   * Assert response is unauthorized (401)
   */
  toBeUnauthorized<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  },

  /**
   * Assert response is forbidden (403)
   */
  toBeForbidden<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
  },

  /**
   * Assert response is validation error (422)
   */
  toBeValidationError<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.error).toBeDefined()
  },

  /**
   * Assert response is bad request (400)
   */
  toBeBadRequest<T>(result: APIResult<T>): void {
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  },

  /**
   * Assert response has error with specific code
   */
  toHaveErrorCode<T>(result: APIResult<T>, code: string): void {
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(code)
  },
}

export { expect } from '@playwright/test'
