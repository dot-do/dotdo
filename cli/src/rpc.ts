/**
 * CLI RPC Client
 *
 * Makes authenticated requests to *.do services via rpc.do gateway.
 */

import { getConfig } from './config'
import { getAuthHeaders, AuthError } from './auth'

// ============================================================================
// Types
// ============================================================================

export interface RPCError {
  error: string
  message?: string
  code?: string
}

export interface RPCRequestOptions {
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Request body (will be JSON stringified) */
  body?: unknown
  /** Additional headers */
  headers?: Record<string, string>
  /** Stream the response */
  stream?: boolean
}

export class RPCNetworkError extends Error {
  constructor(message: string) {
    super(`Network error: ${message}`)
    this.name = 'RPCNetworkError'
  }
}

export class RPCAPIError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'RPCAPIError'
    this.status = status
    this.code = code
  }
}

export class RPCRateLimitError extends RPCAPIError {
  retryAfter?: number

  constructor(message: string, retryAfter?: number) {
    super(message, 429, 'rate_limit_exceeded')
    this.name = 'RPCRateLimitError'
    this.retryAfter = retryAfter
  }
}

// ============================================================================
// RPC Client
// ============================================================================

/**
 * Make an authenticated request to a *.do service
 */
export async function rpcRequest<T = unknown>(
  service: string,
  path: string,
  options: RPCRequestOptions = {}
): Promise<T> {
  const config = await getConfig()
  const authHeaders = await getAuthHeaders()

  const { method = 'GET', body, headers = {}, stream = false } = options

  const url = `${config.api_url}/${service}${path}`

  const requestHeaders: Record<string, string> = {
    ...authHeaders,
    ...headers,
  }

  // Only set Content-Type if not already provided and body is defined
  if (body !== undefined && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    throw new RPCNetworkError((error as Error).message)
  }

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    throw new RPCRateLimitError(
      'Rate limit exceeded. Please try again later.',
      retryAfter ? parseInt(retryAfter, 10) : undefined
    )
  }

  // Handle errors
  if (!response.ok) {
    let errorData: RPCError
    try {
      errorData = await response.json()
    } catch {
      errorData = { error: 'unknown_error', message: `Request failed with status ${response.status}` }
    }

    throw new RPCAPIError(
      errorData.message || errorData.error,
      response.status,
      errorData.code || errorData.error
    )
  }

  // Stream response
  if (stream && response.body) {
    return response.body as unknown as T
  }

  // JSON response
  return response.json()
}

/**
 * Make a request to calls.do
 */
export async function callsRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('calls.do', path, options)
}

/**
 * Make a request to texts.do
 */
export async function textsRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('texts.do', path, options)
}

/**
 * Make a request to emails.do
 */
export async function emailsRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('emails.do', path, options)
}

/**
 * Make a request to payments.do
 */
export async function paymentsRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('payments.do', path, options)
}

/**
 * Make a request to queue.do
 */
export async function queueRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('queue.do', path, options)
}

/**
 * Make a request to llm.do
 */
export async function llmRequest<T = unknown>(
  path: string,
  options?: RPCRequestOptions
): Promise<T> {
  return rpcRequest<T>('llm.do', path, options)
}
