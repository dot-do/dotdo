/**
 * CLI RPC Client
 *
 * Makes authenticated requests to *.do services via rpc.do gateway.
 */

import { getConfig } from './config'
import { getAuthHeaders, AuthError } from './auth'
import { NetworkError, ErrorCode, ExitCode } from '../utils/errors'

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

/**
 * Network error for RPC calls.
 * Extends the unified NetworkError from utils/errors.
 */
export class RPCNetworkError extends NetworkError {
  constructor(message: string, cause?: Error) {
    super(`Network error: ${message}`, {
      code: ErrorCode.CONNECTION_FAILED,
      cause,
    })
    this.name = 'RPCNetworkError'
  }
}

/**
 * API error for RPC calls.
 * Extends the unified NetworkError from utils/errors.
 */
export class RPCAPIError extends NetworkError {
  constructor(message: string, status: number, errorCode?: string) {
    super(message, {
      code: errorCode ? (errorCode as typeof ErrorCode[keyof typeof ErrorCode]) : ErrorCode.API_ERROR,
      status,
    })
    this.name = 'RPCAPIError'
  }
}

/**
 * Rate limit error for RPC calls.
 * Extends RPCAPIError with retry information.
 */
export class RPCRateLimitError extends NetworkError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, {
      code: ErrorCode.RATE_LIMITED,
      exitCode: ExitCode.RATE_LIMITED,
      retryAfter: retryAfterSeconds,
    })
    this.name = 'RPCRateLimitError'
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
