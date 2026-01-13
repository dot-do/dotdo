/**
 * DO Client Context
 *
 * Utilities for creating Durable Object clients with colocation targeting
 * and extracting response metadata.
 */

/**
 * Options for creating a DO client.
 */
export interface DOClientOptions {
  /** Base URL for the DO API */
  baseUrl: string
  /** Target colocation code (e.g., 'SJC', 'DFW') */
  colo?: string
  /** DO namespace for routing */
  namespace?: string
  /** Custom headers to include in requests */
  headers?: Record<string, string>
  /** Custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
}

/**
 * A DO client with fetch capability and namespace info.
 */
export interface DOClient {
  /** Make a request to the DO */
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  /** The namespace this client targets */
  namespace?: string
  /** The base URL for requests */
  baseUrl: string
}

/**
 * Header used to specify target colocation.
 * Cloudflare uses 'cf-ray-colo' in responses, but for targeting we use 'x-cf-colo'.
 */
const COLO_REQUEST_HEADER = 'x-cf-colo'

/**
 * Create a DO client with optional colocation targeting.
 *
 * @param options - Client configuration options
 * @returns A DO client instance
 */
export function createDOClient(options: DOClientOptions): DOClient {
  const { baseUrl, colo, namespace, headers: customHeaders, fetch: customFetch } = options

  const fetchImpl = customFetch ?? globalThis.fetch

  const client: DOClient = {
    baseUrl,
    namespace,
    fetch: async (path: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(path, baseUrl)

      // Merge headers
      const headers = new Headers(init?.headers)

      // Add custom headers
      if (customHeaders) {
        for (const [key, value] of Object.entries(customHeaders)) {
          headers.set(key, value)
        }
      }

      // Add colo header if specified
      if (colo) {
        headers.set(COLO_REQUEST_HEADER, colo)
      }

      return fetchImpl(url.toString(), {
        ...init,
        headers,
      })
    },
  }

  return client
}

/**
 * Extract the colocation code from a Cloudflare response.
 *
 * The cf-ray header has the format: <ray-id>-<COLO>
 * Example: 7f8a1b2c3d4e5f6g-SJC
 *
 * @param response - The response to extract colo from
 * @returns The colocation code, or undefined if not present
 */
export function extractColo(response: Response): string | undefined {
  const cfRay = response.headers.get('cf-ray')

  if (!cfRay) {
    return undefined
  }

  // The format is <ray-id>-<COLO>
  const parts = cfRay.split('-')

  if (parts.length < 2) {
    return undefined
  }

  // The last part is the colo code
  return parts[parts.length - 1]
}
