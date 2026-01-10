/**
 * Shared Base for Human and User Proxy Context APIs
 *
 * Contains common utilities, interfaces, and patterns shared between:
 * - $.human.* API (internal escalation via workflows/context/human.ts)
 * - $.user.* API (end-user interaction via workflows/context/user.ts)
 *
 * @module workflows/context/human-base
 */

// ============================================================================
// DURABLE OBJECT TYPE DEFINITIONS
// ============================================================================

/**
 * Durable Object namespace interface
 */
export interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub
  idFromName(name: string): DurableObjectId
}

/**
 * Durable Object ID interface
 */
export interface DurableObjectId {
  toString(): string
}

/**
 * Durable Object stub interface
 */
export interface DurableObjectStub {
  id: DurableObjectId
  fetch(request: Request): Promise<Response>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default timeout for human/user responses (5 minutes) */
export const DEFAULT_TIMEOUT = 300000

// ============================================================================
// TIMEOUT UTILITIES
// ============================================================================

/**
 * Error thrown when a human/user response times out
 */
export class InteractionTimeoutError extends Error {
  constructor(timeout: number, requestType: string = 'request') {
    super(`${requestType} timed out after ${timeout}ms`)
    this.name = 'InteractionTimeoutError'
  }
}

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
export function createTimeout(ms: number, requestType: string = 'Request'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new InteractionTimeoutError(ms, requestType))
    }, ms)
  })
}

/**
 * Race a promise against a timeout
 */
export async function withTimeout<T>(promise: Promise<T>, timeout: number, requestType: string = 'Request'): Promise<T> {
  if (timeout <= 0) {
    throw new InteractionTimeoutError(timeout, requestType)
  }
  return Promise.race([promise, createTimeout(timeout, requestType)])
}

// ============================================================================
// DO STUB UTILITIES
// ============================================================================

/**
 * Configuration for getting a DO stub
 */
export interface GetDOStubConfig {
  namespace: DurableObjectNamespace
  name: string
}

/**
 * Get a DO stub by name
 */
export function getDOStub(config: GetDOStubConfig): DurableObjectStub {
  const id = config.namespace.idFromName(config.name)
  return config.namespace.get(id)
}

// ============================================================================
// REQUEST UTILITIES
// ============================================================================

/**
 * Options for making a request to a DO
 */
export interface MakeRequestOptions {
  stub: DurableObjectStub
  baseUrl: string
  path: string
  method: string
  body?: Record<string, unknown>
  queryParams?: Record<string, string>
}

/**
 * Make a request to a Durable Object
 */
export async function makeRequest(options: MakeRequestOptions): Promise<Response> {
  const { stub, baseUrl, path, method, body, queryParams } = options

  const url = new URL(`${baseUrl}${path}`)

  // Add query parameters if provided
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }

  const request = new Request(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  return stub.fetch(request)
}

// ============================================================================
// RESPONSE UTILITIES
// ============================================================================

/**
 * Validate that response is JSON and parse it
 * @throws Error if response is not JSON
 */
export async function parseJsonResponse<T>(response: Response, errorMessage: string = 'Invalid response from DO'): Promise<T> {
  const contentType = response.headers.get('Content-Type')
  if (!contentType?.includes('application/json')) {
    throw new Error(errorMessage)
  }
  return (await response.json()) as T
}

// ============================================================================
// REQUEST ID GENERATION
// ============================================================================

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Sanitize HTML to prevent XSS attacks
 */
export function sanitizeHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
}
