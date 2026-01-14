/**
 * Fetch Interceptor
 *
 * Instruments fetch() and XMLHttpRequest to inject correlation headers
 * (X-Request-ID, X-Session-ID) for backend trace correlation.
 *
 * @module @dotdo/client/snippet/fetch-interceptor
 */

/**
 * Generates a short request ID.
 *
 * @param sessionId - The session ID prefix
 * @returns A unique request ID in the format `{sessionId}-{random8chars}`
 */
function generateRequestId(sessionId: string): string {
  return `${sessionId}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Instruments the global fetch function to inject correlation headers.
 *
 * Adds X-Request-ID and X-Session-ID headers to all outgoing fetch requests,
 * enabling correlation between frontend resource timing and backend traces.
 *
 * @param sessionId - The session ID to include in requests
 * @returns A function to restore the original fetch implementation
 *
 * @example
 * ```typescript
 * const restore = instrumentFetch('session-123')
 *
 * // All fetch requests now include:
 * // X-Request-ID: session-123-abc12345
 * // X-Session-ID: session-123
 * await fetch('https://api.example.com/data')
 *
 * // Restore original fetch
 * restore()
 * ```
 */
export function instrumentFetch(sessionId: string): () => void {
  // Store reference to original fetch
  const originalFetch = window.fetch

  // Replace global fetch with instrumented version
  window.fetch = async function instrumentedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const requestId = generateRequestId(sessionId)
    const headers = new Headers(init?.headers)

    // Inject correlation headers
    headers.set('X-Request-ID', requestId)
    headers.set('X-Session-ID', sessionId)

    return originalFetch.call(window, input, { ...init, headers })
  }

  // Return restore function
  return () => {
    window.fetch = originalFetch
  }
}

/**
 * Extended XMLHttpRequest interface with request ID tracking.
 */
interface InstrumentedXHR extends XMLHttpRequest {
  _dotdo_request_id?: string
}

/**
 * Instruments XMLHttpRequest to inject correlation headers.
 *
 * Intercepts XMLHttpRequest.open() and send() to add X-Request-ID
 * and X-Session-ID headers to all XHR requests.
 *
 * @param sessionId - The session ID to include in requests
 * @returns A function to restore the original XMLHttpRequest methods
 *
 * @example
 * ```typescript
 * const restore = instrumentXHR('session-123')
 *
 * // All XHR requests now include correlation headers
 * const xhr = new XMLHttpRequest()
 * xhr.open('GET', 'https://api.example.com/data')
 * xhr.send()
 *
 * // Restore original methods
 * restore()
 * ```
 */
export function instrumentXHR(sessionId: string): () => void {
  // Store references to original methods
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  // Intercept open() to generate request ID
  XMLHttpRequest.prototype.open = function (
    this: InstrumentedXHR,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    // Generate and store request ID for this request
    this._dotdo_request_id = generateRequestId(sessionId)

    // Call original open with all parameters
    return originalOpen.call(this, method, url, async, username ?? null, password ?? null)
  }

  // Intercept send() to inject headers
  XMLHttpRequest.prototype.send = function (
    this: InstrumentedXHR,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    // Inject correlation headers before sending
    if (this._dotdo_request_id) {
      this.setRequestHeader('X-Request-ID', this._dotdo_request_id)
      this.setRequestHeader('X-Session-ID', sessionId)
    }

    return originalSend.call(this, body)
  }

  // Return restore function
  return () => {
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
  }
}

/**
 * Options for instrumenting both fetch and XHR.
 */
export interface InstrumentNetworkOptions {
  /** Session ID to include in correlation headers */
  sessionId: string
  /** Whether to instrument fetch (default: true) */
  instrumentFetch?: boolean
  /** Whether to instrument XMLHttpRequest (default: true) */
  instrumentXHR?: boolean
}

/**
 * Instruments both fetch and XMLHttpRequest for correlation.
 *
 * Convenience function that instruments both fetch() and XMLHttpRequest
 * with a single call.
 *
 * @param options - Instrumentation options
 * @returns A function to restore all original implementations
 *
 * @example
 * ```typescript
 * const restore = instrumentNetwork({
 *   sessionId: 'session-123',
 *   instrumentFetch: true,
 *   instrumentXHR: true
 * })
 *
 * // Later, restore all
 * restore()
 * ```
 */
export function instrumentNetwork(options: InstrumentNetworkOptions): () => void {
  const restorers: Array<() => void> = []

  if (options.instrumentFetch !== false) {
    restorers.push(instrumentFetch(options.sessionId))
  }

  if (options.instrumentXHR !== false) {
    restorers.push(instrumentXHR(options.sessionId))
  }

  // Return combined restore function
  return () => {
    for (const restore of restorers) {
      restore()
    }
  }
}
