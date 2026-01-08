import { Hono } from 'hono'
import type { Env } from '../index'

/**
 * RPC.do WebSocket Route Handler
 *
 * Implements Capnweb-style RPC with promise pipelining:
 * - HTTP POST /rpc: Batch mode for multiple calls in one request
 * - WebSocket /rpc: Persistent connection for streaming RPC
 *
 * Features:
 * - Promise pipelining: Chain calls without awaiting intermediate results
 * - Pass-by-reference: Send object references instead of serializing
 * - Automatic batching: Multiple calls batched in single round-trip
 */

// ============================================================================
// Types
// ============================================================================

export interface RPCRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: RPCCall[]
  resolve?: { promiseId: string }
  dispose?: { promiseIds: string[] }
}

export interface RPCCall {
  promiseId: string
  target: RPCTarget
  method: string
  args: RPCArg[]
}

export type RPCTarget = { type: 'root' } | { type: 'promise'; promiseId: string } | { type: 'property'; base: RPCTarget; property: string }

export type RPCArg = { type: 'value'; value: unknown } | { type: 'promise'; promiseId: string } | { type: 'callback'; callbackId: string }

export interface RPCResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: RPCResult[]
  error?: RPCError
}

export interface RPCResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: RPCError
}

export interface RPCError {
  code: string
  message: string
  data?: unknown
}

// ============================================================================
// Promise Store
// ============================================================================

class PromiseStore {
  private promises = new Map<string, unknown>()
  private disposed = new Set<string>()

  set(id: string, value: unknown): void {
    this.promises.set(id, value)
  }

  get(id: string): unknown {
    if (this.disposed.has(id)) {
      throw new Error(`Promise ${id} has been disposed`)
    }
    return this.promises.get(id)
  }

  has(id: string): boolean {
    return this.promises.has(id) && !this.disposed.has(id)
  }

  dispose(id: string): boolean {
    if (this.promises.has(id)) {
      this.disposed.add(id)
      this.promises.delete(id)
      return true
    }
    return false
  }

  isDisposed(id: string): boolean {
    return this.disposed.has(id)
  }
}

// ============================================================================
// RPC Executor
// ============================================================================

interface RPCContext {
  promiseStore: PromiseStore
  rootObject: Record<string, unknown>
}

// Default root object with available methods
const defaultRootObject: Record<string, unknown> = {
  echo: (value: unknown) => value,
  add: (a: number, b: number) => a + b,
  multiply: (a: number, b: number) => a * b,
  getUser: (id: string) => ({ id, name: `User ${id}`, email: `${id}@example.com` }),
  getPosts: () => [
    { id: '1', title: 'First Post' },
    { id: '2', title: 'Second Post' },
  ],
  getData: () => ({ foo: 'bar', count: 42 }),
}

function resolveTarget(target: RPCTarget, ctx: RPCContext): unknown {
  switch (target.type) {
    case 'root':
      return ctx.rootObject

    case 'promise': {
      if (ctx.promiseStore.isDisposed(target.promiseId)) {
        throw { code: 'DISPOSED_REFERENCE', message: `Promise ${target.promiseId} has been disposed` }
      }
      const value = ctx.promiseStore.get(target.promiseId)
      if (value === undefined) {
        throw { code: 'INVALID_PROMISE', message: `Promise ${target.promiseId} not found` }
      }
      return value
    }

    case 'property': {
      const base = resolveTarget(target.base, ctx) as Record<string, unknown>
      if (base === null || typeof base !== 'object') {
        throw { code: 'INVALID_TARGET', message: 'Cannot access property of non-object' }
      }
      return base[target.property]
    }

    default:
      throw { code: 'INVALID_TARGET', message: 'Unknown target type' }
  }
}

function resolveArg(arg: RPCArg, ctx: RPCContext): unknown {
  switch (arg.type) {
    case 'value':
      return arg.value

    case 'promise': {
      if (ctx.promiseStore.isDisposed(arg.promiseId)) {
        throw { code: 'DISPOSED_REFERENCE', message: `Promise ${arg.promiseId} has been disposed` }
      }
      return ctx.promiseStore.get(arg.promiseId)
    }

    case 'callback':
      // Callbacks are not yet implemented
      throw { code: 'NOT_IMPLEMENTED', message: 'Callbacks not yet supported' }

    default:
      throw { code: 'INVALID_ARG', message: 'Unknown argument type' }
  }
}

async function executeCall(call: RPCCall, ctx: RPCContext): Promise<RPCResult> {
  try {
    const target = resolveTarget(call.target, ctx)
    const args = call.args.map((arg) => resolveArg(arg, ctx))

    let result: unknown

    if (typeof target === 'function') {
      result = await target(...args)
    } else if (target && typeof target === 'object' && call.method in target) {
      const method = (target as Record<string, unknown>)[call.method]
      if (typeof method === 'function') {
        result = await method.apply(target, args)
      } else {
        result = method
      }
    } else if (target && typeof target === 'object') {
      // Property access
      result = (target as Record<string, unknown>)[call.method]
    } else {
      throw { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` }
    }

    // Store result for pipelining
    ctx.promiseStore.set(call.promiseId, result)

    return {
      promiseId: call.promiseId,
      type: 'value',
      value: result,
    }
  } catch (error) {
    const rpcError: RPCError = error && typeof error === 'object' && 'code' in error ? (error as RPCError) : { code: 'EXECUTION_ERROR', message: String(error) }

    return {
      promiseId: call.promiseId,
      type: 'error',
      error: rpcError,
    }
  }
}

async function executeRequest(request: RPCRequest, ctx: RPCContext): Promise<RPCResponse> {
  switch (request.type) {
    case 'call':
    case 'batch': {
      if (!request.calls || request.calls.length === 0) {
        return {
          id: request.id,
          type: 'error',
          error: { code: 'INVALID_REQUEST', message: 'No calls provided' },
        }
      }

      const results: RPCResult[] = []
      for (const call of request.calls) {
        const result = await executeCall(call, ctx)
        results.push(result)
      }

      return {
        id: request.id,
        type: 'batch',
        results,
      }
    }

    case 'resolve': {
      if (!request.resolve?.promiseId) {
        return {
          id: request.id,
          type: 'error',
          error: { code: 'INVALID_REQUEST', message: 'No promiseId provided' },
        }
      }

      const promiseId = request.resolve.promiseId
      if (ctx.promiseStore.isDisposed(promiseId)) {
        return {
          id: request.id,
          type: 'error',
          error: { code: 'DISPOSED_REFERENCE', message: `Promise ${promiseId} has been disposed` },
        }
      }

      const value = ctx.promiseStore.get(promiseId)
      return {
        id: request.id,
        type: 'result',
        results: [
          {
            promiseId,
            type: 'value',
            value,
          },
        ],
      }
    }

    case 'dispose': {
      if (!request.dispose?.promiseIds) {
        return {
          id: request.id,
          type: 'error',
          error: { code: 'INVALID_REQUEST', message: 'No promiseIds provided' },
        }
      }

      for (const promiseId of request.dispose.promiseIds) {
        ctx.promiseStore.dispose(promiseId)
      }

      return {
        id: request.id,
        type: 'result',
        results: [],
      }
    }

    default:
      return {
        id: request.id,
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Unknown request type' },
      }
  }
}

// ============================================================================
// HTTP Handler
// ============================================================================

export const rpcRoutes = new Hono<{ Bindings: Env }>()

// HTTP POST handler for batch mode
rpcRoutes.post('/', async (c) => {
  const promiseStore = new PromiseStore()
  const ctx: RPCContext = {
    promiseStore,
    rootObject: defaultRootObject,
  }

  let request: RPCRequest
  try {
    request = (await c.req.json()) as RPCRequest
  } catch {
    return c.json(
      {
        id: '',
        type: 'error',
        error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      } satisfies RPCResponse,
      400,
    )
  }

  if (!request.id) {
    return c.json(
      {
        id: '',
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Missing request id' },
      } satisfies RPCResponse,
      400,
    )
  }

  const response = await executeRequest(request, ctx)
  return c.json(response)
})

// WebSocket upgrade handler
rpcRoutes.get('/', async (c) => {
  const upgradeHeader = c.req.header('upgrade')

  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.json({
      message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
      methods: Object.keys(defaultRootObject),
    })
  }

  // WebSocket upgrade
  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)

  const promiseStore = new PromiseStore()
  const ctx: RPCContext = {
    promiseStore,
    rootObject: defaultRootObject,
  }

  server.accept()

  server.addEventListener('message', async (event) => {
    try {
      const request = JSON.parse(event.data as string) as RPCRequest
      const response = await executeRequest(request, ctx)
      server.send(JSON.stringify(response))
    } catch (error) {
      server.send(
        JSON.stringify({
          id: '',
          type: 'error',
          error: { code: 'PARSE_ERROR', message: String(error) },
        }),
      )
    }
  })

  server.addEventListener('close', () => {
    // Clean up
  })

  server.addEventListener('error', () => {
    server.close()
  })

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
})

// Catch-all for /rpc/* paths
rpcRoutes.all('/*', (c) => {
  return c.json({ error: 'Use /rpc for RPC endpoint' }, 404)
})

export default rpcRoutes
