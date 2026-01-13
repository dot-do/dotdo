/**
 * Cap'n Web RPC Client for TanStack DB
 *
 * Provides Cap'n Web protocol-based RPC for CRUD mutations.
 * Promise pipelining allows batching multiple operations in a single round trip.
 *
 * @module db/tanstack/rpc
 */

// =============================================================================
// Cap'n Web Protocol Types
// =============================================================================

/**
 * Cap'n Web request payload
 */
export interface CapnWebRequest {
  id: string
  type: 'call' | 'batch'
  calls: Array<{
    promiseId: string
    target: { type: 'root' }
    method: string
    args: Array<{ type: 'value'; value: unknown }>
  }>
}

/**
 * Cap'n Web response payload
 */
export interface CapnWebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: Array<{
    promiseId: string
    type: 'value' | 'promise' | 'error'
    value?: unknown
    error?: { code: string; message: string }
  }>
  error?: { code: string; message: string }
}

/**
 * Mutation operation types
 */
export type MutationType = 'create' | 'insert' | 'update' | 'delete'

/**
 * A single mutation operation
 */
export interface MutationOperation {
  type: MutationType
  key: string
  data?: unknown
}

/**
 * Result of a mutation operation
 */
export interface MutationResult {
  success: boolean
  rowid: number
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for RPC client
 */
export interface RpcClientConfig {
  /** HTTP URL for the RPC endpoint */
  rpcUrl: string
  /** Optional fetch options (headers, credentials, etc.) */
  fetchOptions?: RequestInit
  /** Optional timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * RPC client interface
 */
export interface RpcClient {
  /**
   * Execute a single mutation
   */
  execute(collection: string, mutation: MutationOperation): Promise<MutationResult>

  /**
   * Execute multiple mutations in a batch
   */
  executeBatch(collection: string, mutations: MutationOperation[]): Promise<MutationResult[]>

  /**
   * Call a generic RPC method
   */
  call<T = unknown>(method: string, args: unknown[]): Promise<T>
}

// =============================================================================
// URL Helpers
// =============================================================================

/**
 * Convert WebSocket URL to HTTP URL for RPC
 *
 * @example
 * ```typescript
 * deriveRpcUrl('wss://example.com/do/123') // 'https://example.com/do/123/rpc'
 * deriveRpcUrl('wss://example.com/do/123/sync') // 'https://example.com/do/123/rpc'
 * ```
 */
export function deriveRpcUrl(doUrl: string): string {
  let rpcUrl = doUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  rpcUrl = rpcUrl.replace(/\/sync$/, '')
  return `${rpcUrl}/rpc`
}

/**
 * Validate URL format
 * @throws Error if URL is invalid
 */
export function validateUrl(url: string): void {
  try {
    new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an RPC client for Cap'n Web protocol
 *
 * @example
 * ```typescript
 * const rpc = createRpcClient({
 *   rpcUrl: 'https://my-do.workers.dev/do/123/rpc',
 * })
 *
 * // Single mutation
 * const result = await rpc.execute('Task', {
 *   type: 'create',
 *   key: 'task-1',
 *   data: { title: 'New Task', status: 'todo' },
 * })
 *
 * // Batch mutations
 * const results = await rpc.executeBatch('Task', [
 *   { type: 'create', key: 'task-1', data: { title: 'Task 1' } },
 *   { type: 'create', key: 'task-2', data: { title: 'Task 2' } },
 * ])
 * ```
 */
export function createRpcClient(config: RpcClientConfig): RpcClient {
  const { rpcUrl, fetchOptions = {}, timeout = 30000 } = config

  async function sendRequest(request: CapnWebRequest): Promise<CapnWebResponse> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers as Record<string, string> ?? {}),
      }

      const response = await fetch(rpcUrl, {
        ...fetchOptions,
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      return await response.json() as CapnWebResponse
    } finally {
      clearTimeout(timeoutId)
    }
  }

  function buildCalls(collection: string, mutations: MutationOperation[]): CapnWebRequest['calls'] {
    return mutations.map((mutation, index) => {
      const method = `${collection}.${mutation.type}`
      const args: Array<{ type: 'value'; value: unknown }> = []

      if (mutation.type === 'delete') {
        args.push({ type: 'value', value: { key: mutation.key } })
      } else {
        args.push({ type: 'value', value: mutation.data ?? { key: mutation.key } })
      }

      return {
        promiseId: `p-${index + 1}`,
        target: { type: 'root' as const },
        method,
        args,
      }
    })
  }

  function parseResults(response: CapnWebResponse): MutationResult[] {
    if (response.type === 'error' && response.error) {
      throw new Error(response.error.message)
    }

    if (!response.results || response.results.length === 0) {
      throw new Error('No results in response')
    }

    return response.results.map((r) => {
      if (r.type === 'error' && r.error) {
        throw new Error(r.error.message)
      }
      return r.value as MutationResult
    })
  }

  return {
    async execute(collection: string, mutation: MutationOperation): Promise<MutationResult> {
      const results = await this.executeBatch(collection, [mutation])
      return results[0]
    },

    async executeBatch(collection: string, mutations: MutationOperation[]): Promise<MutationResult[]> {
      if (mutations.length === 0) {
        return []
      }

      const requestId = crypto.randomUUID()
      const request: CapnWebRequest = {
        id: requestId,
        type: mutations.length > 1 ? 'batch' : 'call',
        calls: buildCalls(collection, mutations),
      }

      const response = await sendRequest(request)
      return parseResults(response)
    },

    async call<T = unknown>(method: string, args: unknown[]): Promise<T> {
      const requestId = crypto.randomUUID()
      const request: CapnWebRequest = {
        id: requestId,
        type: 'call',
        calls: [{
          promiseId: 'p-1',
          target: { type: 'root' },
          method,
          args: args.map((arg) => ({ type: 'value' as const, value: arg })),
        }],
      }

      const response = await sendRequest(request)

      if (response.type === 'error' && response.error) {
        throw new Error(response.error.message)
      }

      if (!response.results || response.results.length === 0) {
        throw new Error('No results in response')
      }

      const result = response.results[0]
      if (result.type === 'error' && result.error) {
        throw new Error(result.error.message)
      }

      return result.value as T
    },
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Execute mutations via Cap'n Web RPC (standalone function)
 *
 * @deprecated Use createRpcClient().executeBatch() instead
 */
export async function executeMutations(
  rpcUrl: string,
  collection: string,
  mutations: MutationOperation[],
  fetchOptions?: RequestInit
): Promise<MutationResult[]> {
  const client = createRpcClient({ rpcUrl, fetchOptions })
  return client.executeBatch(collection, mutations)
}
