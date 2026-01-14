import { extractColoFromCfRay } from './colos'

/**
 * Typed client for Durable Object operations
 */
export interface DOClient {
  /**
   * GET request to DO
   */
  get<T = unknown>(path: string): Promise<T>

  /**
   * POST request to create/update
   */
  create<T = unknown>(path: string, data: unknown): Promise<T>

  /**
   * GET request to list resources
   */
  list<T = unknown>(path: string): Promise<T[]>

  /**
   * DELETE request
   */
  delete(path: string): Promise<void>

  /**
   * Generic request method
   */
  request<T = unknown>(path: string, init?: RequestInit): Promise<T>
}

/**
 * Context provided to benchmark run functions
 */
export interface BenchmarkContext {
  /** Target hostname (e.g., 'promote.perf.do') */
  target: string

  /**
   * Fetch function bound to the target host
   * Automatically extracts colo from response and updates lastColoServed
   */
  fetch: (path: string, init?: RequestInit) => Promise<Response>

  /** Last colo that served a request (extracted from cf-ray header) */
  lastColoServed?: string

  /** Typed DO client for common operations */
  do: DOClient
}

/**
 * Internal context implementation with mutable state
 */
interface MutableBenchmarkContext extends BenchmarkContext {
  lastColoServed: string | undefined
}

/**
 * Create a benchmark context for making requests to a target DO
 *
 * @param target - Target hostname (e.g., 'promote.perf.do')
 * @param headers - Optional headers to include in all requests
 * @returns BenchmarkContext with fetch method and DO client
 *
 * @example
 * ```ts
 * const ctx = await createContext('promote.perf.do', {
 *   'Authorization': 'Bearer token',
 *   'cf-ipcolo': 'SJC', // Request routing to specific colo
 * })
 *
 * const response = await ctx.fetch('/api/data')
 * console.log(ctx.lastColoServed) // 'SJC'
 * ```
 */
export async function createContext(target: string, headers?: Record<string, string>): Promise<BenchmarkContext> {
  const baseUrl = `https://${target}`
  const defaultHeaders = headers || {}

  // Create mutable context with placeholder for do client
  const ctx: MutableBenchmarkContext = {
    target,
    lastColoServed: undefined,
    // Placeholder - will be replaced after ctx is defined
    do: null as unknown as DOClient,

    async fetch(path: string, init?: RequestInit): Promise<Response> {
      // Normalize path
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const url = `${baseUrl}${normalizedPath}`

      // Merge headers
      const mergedHeaders: Record<string, string> = {
        ...defaultHeaders,
        ...((init?.headers as Record<string, string>) || {}),
      }

      // Make request
      const response = await globalThis.fetch(url, {
        ...init,
        headers: mergedHeaders,
      })

      // Extract colo from cf-ray header
      const cfRay = response.headers.get('cf-ray')
      const colo = extractColoFromCfRay(cfRay)
      if (colo) {
        ctx.lastColoServed = colo
      }

      return response
    },
  }

  // Now that ctx is defined, create the DO client
  ctx.do = createDOClient(baseUrl, defaultHeaders, ctx)

  return ctx
}

/**
 * Create a typed DO client
 */
function createDOClient(baseUrl: string, defaultHeaders: Record<string, string>, ctx: MutableBenchmarkContext): DOClient {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = `${baseUrl}${normalizedPath}`

    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...defaultHeaders,
      ...((init?.headers as Record<string, string>) || {}),
    }

    const response = await globalThis.fetch(url, {
      ...init,
      headers: mergedHeaders,
    })

    // Extract colo from cf-ray header
    const cfRay = response.headers.get('cf-ray')
    const colo = extractColoFromCfRay(cfRay)
    if (colo) {
      ctx.lastColoServed = colo
    }

    if (!response.ok) {
      throw new Error(`DO request failed: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    return text ? JSON.parse(text) : (undefined as T)
  }

  return {
    async get<T>(path: string): Promise<T> {
      return request<T>(path, { method: 'GET' })
    },

    async create<T>(path: string, data: unknown): Promise<T> {
      return request<T>(path, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },

    async list<T>(path: string): Promise<T[]> {
      return request<T[]>(path, { method: 'GET' })
    },

    async delete(path: string): Promise<void> {
      await request(path, { method: 'DELETE' })
    },

    request,
  }
}
