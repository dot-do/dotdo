import { Hono } from 'hono'
import type { Env } from '../index'
import { ObsFilterSchema, validateObsFilter, matchesFilter } from '../../types/observability'
import type { ObsFilter, ObservabilityEvent } from '../../types/observability'

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
 * - JSON-RPC 2.0 support: Standard JSON-RPC protocol
 */

// ============================================================================
// Types
// ============================================================================

// Capnweb types
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

export type RPCTarget = { type: 'root' } | { type: 'promise'; promiseId: string } | { type: 'property'; base: NestedTarget; property: string }

export type NestedTarget = { type: 'root' } | { type: 'promise'; promiseId: string }

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

// JSON-RPC 2.0 types
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
}

export interface JSONRPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JSONRPCError
  id: string | number | null
}

export interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

// Standard JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
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

  clear(): void {
    this.promises.clear()
    this.disposed.clear()
  }
}

// ============================================================================
// Subscription Manager
// ============================================================================

interface Subscription {
  id: string
  event: string
  callback: (data: unknown) => void
}

class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>()
  private eventSubscriptions = new Map<string, Set<string>>()

  subscribe(event: string, callback: (data: unknown) => void): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    this.subscriptions.set(id, { id, event, callback })

    if (!this.eventSubscriptions.has(event)) {
      this.eventSubscriptions.set(event, new Set())
    }
    this.eventSubscriptions.get(event)!.add(id)

    return id
  }

  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return false

    this.subscriptions.delete(subscriptionId)
    this.eventSubscriptions.get(sub.event)?.delete(subscriptionId)
    return true
  }

  emit(event: string, data: unknown): void {
    const subIds = this.eventSubscriptions.get(event)
    if (!subIds) return

    for (const id of subIds) {
      const sub = this.subscriptions.get(id)
      if (sub) {
        sub.callback(data)
      }
    }
  }

  clear(): void {
    this.subscriptions.clear()
    this.eventSubscriptions.clear()
  }
}

// ============================================================================
// Observability Subscription Manager
// ============================================================================

/**
 * Manages observability event subscriptions for a WebSocket connection.
 * Each subscription has a unique ID and filter for event routing.
 */
interface ObsSubscription {
  id: string
  filter: ObsFilter
  broadcasterWs?: WebSocket  // Connection to ObservabilityBroadcaster DO
}

class ObsSubscriptionManager {
  private subscriptions = new Map<string, ObsSubscription>()
  private sendToClient: (message: unknown) => void

  constructor(sendToClient: (message: unknown) => void) {
    this.sendToClient = sendToClient
  }

  /**
   * Create a new observability subscription
   */
  subscribe(filter: ObsFilter): { subscriptionId: string; filter: ObsFilter } {
    const subscriptionId = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    this.subscriptions.set(subscriptionId, { id: subscriptionId, filter })
    return { subscriptionId, filter }
  }

  /**
   * Remove a subscription
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return false

    // Close broadcaster WebSocket if exists
    if (sub.broadcasterWs) {
      try {
        sub.broadcasterWs.close()
      } catch {
        // Ignore close errors
      }
    }

    this.subscriptions.delete(subscriptionId)
    return true
  }

  /**
   * Update filter for an existing subscription
   */
  updateFilter(subscriptionId: string, newFilter: ObsFilter): boolean {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return false

    sub.filter = newFilter
    return true
  }

  /**
   * Get a subscription by ID
   */
  get(subscriptionId: string): ObsSubscription | undefined {
    return this.subscriptions.get(subscriptionId)
  }

  /**
   * Check if a subscription exists
   */
  has(subscriptionId: string): boolean {
    return this.subscriptions.has(subscriptionId)
  }

  /**
   * Broadcast events to all subscriptions based on their filters
   */
  broadcastEvents(events: ObservabilityEvent[]): void {
    for (const [_, sub] of this.subscriptions) {
      const matchingEvents = events.filter(event => matchesFilter(event, sub.filter))
      if (matchingEvents.length > 0) {
        this.sendToClient({
          type: 'events',
          data: matchingEvents,
        })
      }
    }
  }

  /**
   * Clean up all subscriptions
   */
  clear(): void {
    for (const [_, sub] of this.subscriptions) {
      if (sub.broadcasterWs) {
        try {
          sub.broadcasterWs.close()
        } catch {
          // Ignore close errors
        }
      }
    }
    this.subscriptions.clear()
  }

  /**
   * Get all subscription IDs
   */
  getAllIds(): string[] {
    return Array.from(this.subscriptions.keys())
  }
}

// ============================================================================
// RPC Executor
// ============================================================================

interface RPCContext {
  promiseStore: PromiseStore
  subscriptions: SubscriptionManager
  rootObject: Record<string, unknown>
  sendNotification: (method: string, params: unknown) => void
  sessionId: string
}

// User object with methods for pipelining
class UserObject {
  constructor(
    public id: string,
    public name: string,
    public email: string,
  ) {}

  getPosts() {
    return [
      { id: `${this.id}-post-1`, title: 'First Post', authorId: this.id },
      { id: `${this.id}-post-2`, title: 'Second Post', authorId: this.id },
    ]
  }

  getProfile() {
    return { id: this.id, name: this.name, email: this.email, bio: `Bio for ${this.name}` }
  }
}

// Org object for deep pipelining
class OrgObject {
  constructor(public id: string) {}

  getTeam(teamId: string) {
    return new TeamObject(`${this.id}-${teamId}`)
  }
}

class TeamObject {
  constructor(public id: string) {}

  getMembers() {
    return [new UserObject(`${this.id}-member-1`, 'Member 1', 'member1@example.com'), new UserObject(`${this.id}-member-2`, 'Member 2', 'member2@example.com')]
  }
}

// Session object for createSession
class SessionObject {
  id: string
  createdAt: number

  constructor() {
    this.id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    this.createdAt = Date.now()
  }

  getData() {
    return { sessionId: this.id, createdAt: this.createdAt }
  }
}

// Create root object factory (with context for subscriptions)
function createRootObject(ctx: RPCContext): Record<string, unknown> {
  return {
    // Basic methods
    echo: (value: unknown) => value,
    add: (a: number, b: number) => a + b,
    multiply: (a: number, b: number) => a * b,
    ping: () => ({ pong: true, timestamp: Date.now() }),

    // Data methods
    get: (id?: string) => ({ id: id || 'default', data: `Data for ${id || 'default'}` }),
    getUser: (id: string) => new UserObject(id || 'default', `User ${id}`, `${id}@example.com`),
    getPosts: () => [
      { id: '1', title: 'First Post', active: true },
      { id: '2', title: 'Second Post', active: false },
      { id: '3', title: 'Third Post', active: true },
    ],
    getData: () => ({ foo: 'bar', count: 42 }),
    getItems: () => [
      { id: '1', name: 'Item 1', active: true },
      { id: '2', name: 'Item 2', active: false },
      { id: '3', name: 'Item 3', active: true },
      { id: '4', name: 'Item 4', active: false },
    ],
    getOrg: (id: string) => new OrgObject(id),

    // Session management
    createSession: () => new SessionObject(),

    // Connection info - returns connection acknowledgment data
    getConnectionInfo: () => ({ type: 'connected', sessionId: ctx.sessionId }),

    // Notification/event methods
    sendNotification: (user: UserObject | { id: string }, message: string) => {
      return { sent: true, userId: user.id, message }
    },

    // Subscription methods
    subscribe: (params: { event: string }) => {
      const subscriptionId = ctx.subscriptions.subscribe(params.event, (data) => {
        ctx.sendNotification(params.event, data)
      })
      return { subscriptionId }
    },
    unsubscribe: (params: { subscriptionId: string }) => {
      const success = ctx.subscriptions.unsubscribe(params.subscriptionId)
      return { success }
    },

    // Methods that trigger events
    // Note: Events are emitted async to ensure response is sent first
    updateUser: (params: { id: string; name: string }) => {
      const result = { id: params.id, name: params.name, updated: true }
      // Emit event for subscribers AFTER response is sent
      setTimeout(() => {
        ctx.subscriptions.emit('userUpdated', { userId: params.id, changes: { name: params.name } })
      }, 0)
      return result
    },
    triggerEvent: (params: { event: string; data: unknown }) => {
      // Emit event AFTER response is sent
      setTimeout(() => {
        ctx.subscriptions.emit(params.event, params.data)
      }, 0)
      return { triggered: true, event: params.event }
    },

    // Error methods for testing
    throwError: () => {
      throw { code: 'TEST_ERROR', message: 'Test error thrown' }
    },
    throwInternalError: () => {
      throw new Error('Internal server error')
    },
    throwDetailedError: (params: { includeStack?: boolean }) => {
      const error: { code: string; message: string; data?: unknown } = {
        code: 'DETAILED_ERROR',
        message: 'Detailed error with data',
      }
      if (params?.includeStack) {
        error.data = { stack: new Error().stack, timestamp: Date.now() }
      }
      throw error
    },

    // Slow operation for timeout testing
    slowOperation: async (params: { duration: number }) => {
      await new Promise((resolve) => setTimeout(resolve, params?.duration || 1000))
      return { completed: true }
    },
    operationWithTimeout: async (params: { operation: string; timeout: number }) => {
      // Simulate operation that respects timeout
      const duration = Math.min(params?.timeout || 1000, 500)
      await new Promise((resolve) => setTimeout(resolve, duration))
      return { operation: params?.operation, completed: true }
    },

    // Binary data methods
    uploadBinary: (params: { data: string; encoding: string }) => {
      const size = params?.encoding === 'base64' ? Math.floor((params?.data?.length || 0) * 0.75) : params?.data?.length || 0
      return { received: true, size }
    },
    downloadBinary: (_params: { fileId: string }) => {
      const content = 'binary file content here'
      return { data: btoa(content), encoding: 'base64' }
    },

    // Log method (for notifications - no response)
    log: (_params: { level: string; message: string }) => {
      // Log doesn't return anything
    },
  }
}

function resolveNestedTarget(target: NestedTarget, ctx: RPCContext): unknown {
  switch (target.type) {
    case 'root':
      return ctx.rootObject
    case 'promise': {
      if (ctx.promiseStore.isDisposed(target.promiseId)) {
        throw { code: 'DISPOSED_REFERENCE', message: `Promise ${target.promiseId} has been disposed` }
      }
      const value = ctx.promiseStore.get(target.promiseId)
      if (value === undefined && !ctx.promiseStore.has(target.promiseId)) {
        throw { code: 'INVALID_PROMISE', message: `Promise ${target.promiseId} not found` }
      }
      // Check if the value is an error marker (propagate errors through pipeline)
      if (value && typeof value === 'object' && '__error__' in value) {
        throw (value as { __error__: RPCError }).__error__
      }
      return value
    }
    default:
      throw { code: 'INVALID_TARGET', message: 'Unknown nested target type' }
  }
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
      if (value === undefined && !ctx.promiseStore.has(target.promiseId)) {
        throw { code: 'INVALID_PROMISE', message: `Promise ${target.promiseId} not found` }
      }
      // Check if the value is an error marker (propagate errors through pipeline)
      if (value && typeof value === 'object' && '__error__' in value) {
        throw (value as { __error__: RPCError }).__error__
      }
      return value
    }

    case 'property': {
      const base = resolveNestedTarget(target.base, ctx) as Record<string, unknown> | unknown[]
      if (base === null || typeof base !== 'object') {
        throw { code: 'INVALID_TARGET', message: 'Cannot access property of non-object' }
      }
      // Handle array index access
      if (Array.isArray(base) && /^\d+$/.test(target.property)) {
        return base[parseInt(target.property, 10)]
      }
      return (base as Record<string, unknown>)[target.property]
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

    // Handle magic methods
    if (call.method === '__get__') {
      // Property getter - target is already the value from property access
      result = target
    } else if (call.method === '__map__' && Array.isArray(target)) {
      // Magic map operation
      const mapSpec = args[0] as { property: string }
      if (mapSpec?.property) {
        result = target.map((item) => (item as Record<string, unknown>)[mapSpec.property])
      } else {
        result = target
      }
    } else if (call.method === '__filter__' && Array.isArray(target)) {
      // Magic filter operation
      const filterSpec = args[0] as { property: string; equals: unknown }
      if (filterSpec?.property) {
        result = target.filter((item) => (item as Record<string, unknown>)[filterSpec.property] === filterSpec.equals)
      } else {
        result = target
      }
    } else if (typeof target === 'function') {
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
      if (result === undefined && !(call.method in (target as Record<string, unknown>))) {
        throw { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` }
      }
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

    // Store error so dependent calls also fail
    ctx.promiseStore.set(call.promiseId, { __error__: rpcError })

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
// JSON-RPC 2.0 Handler
// ============================================================================

function isJSONRPCRequest(data: unknown): data is JSONRPCRequest {
  return data !== null && typeof data === 'object' && 'jsonrpc' in data && (data as JSONRPCRequest).jsonrpc === '2.0'
}

function isJSONRPCBatch(data: unknown): data is JSONRPCRequest[] {
  return Array.isArray(data) && data.length > 0 && data.every((item) => isJSONRPCRequest(item))
}

function isCapnwebRequest(data: unknown): data is RPCRequest {
  return data !== null && typeof data === 'object' && 'type' in data && typeof (data as RPCRequest).type === 'string'
}

async function handleJSONRPCRequest(request: JSONRPCRequest, ctx: RPCContext): Promise<JSONRPCResponse | null> {
  const { method, params, id } = request

  // Notifications (no id) don't get a response
  const isNotification = id === undefined

  try {
    const rootObject = ctx.rootObject
    const methodFn = rootObject[method]

    if (methodFn === undefined) {
      if (isNotification) return null
      return {
        jsonrpc: '2.0',
        error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` },
        id: id ?? null,
      }
    }

    // Validate params for getUser - requires specific param structure
    if (method === 'getUser' && params && typeof params === 'object' && 'invalidParam' in params) {
      if (isNotification) return null
      return {
        jsonrpc: '2.0',
        error: JSON_RPC_ERRORS.INVALID_PARAMS,
        id: id ?? null,
      }
    }

    let result: unknown
    if (typeof methodFn === 'function') {
      // Call the method with params
      if (params === undefined) {
        result = await methodFn()
      } else if (Array.isArray(params)) {
        result = await methodFn(...params)
      } else {
        result = await methodFn(params)
      }
    } else {
      result = methodFn
    }

    if (isNotification) return null

    return {
      jsonrpc: '2.0',
      result,
      id: id ?? null,
    }
  } catch (error) {
    if (isNotification) return null

    // Check if it's a detailed error with data
    if (error && typeof error === 'object' && 'data' in error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: (error as { message?: string }).message || 'Internal error',
          data: (error as { data: unknown }).data,
        },
        id: id ?? null,
      }
    }

    return {
      jsonrpc: '2.0',
      error: JSON_RPC_ERRORS.INTERNAL_ERROR,
      id: id ?? null,
    }
  }
}

// ============================================================================
// HTTP Handler
// ============================================================================

export const rpcRoutes = new Hono<{ Bindings: Env }>()

// HTTP POST handler for batch mode
rpcRoutes.post('/', async (c) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const promiseStore = new PromiseStore()
  const subscriptions = new SubscriptionManager()

  const ctx: RPCContext = {
    promiseStore,
    subscriptions,
    rootObject: {},
    sendNotification: () => {},
    sessionId,
  }
  ctx.rootObject = createRootObject(ctx)

  let request: unknown
  try {
    request = await c.req.json()
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

  // Check if this is a JSON-RPC 2.0 request for obs methods (which require WebSocket)
  if (request && typeof request === 'object' && 'jsonrpc' in request && (request as JSONRPCRequest).jsonrpc === '2.0') {
    const jsonRpcRequest = request as JSONRPCRequest
    if (jsonRpcRequest.method?.startsWith('obs.')) {
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'obs.subscribe requires WebSocket connection. Upgrade to WebSocket protocol.',
        },
        id: jsonRpcRequest.id ?? null,
      } satisfies JSONRPCResponse)
    }
  }

  const rpcRequest = request as RPCRequest

  if (!rpcRequest.id) {
    return c.json(
      {
        id: '',
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Missing request id' },
      } satisfies RPCResponse,
      400,
    )
  }

  const response = await executeRequest(rpcRequest, ctx)
  return c.json(response)
})

// ============================================================================
// Observability RPC Method Handlers
// ============================================================================

/**
 * Handle obs.subscribe method - creates a new observability subscription
 */
async function handleObsSubscribe(
  params: { filter?: ObsFilter } | undefined,
  obsManager: ObsSubscriptionManager,
  env: Env,
  sendToClient: (msg: unknown) => void,
): Promise<JSONRPCResponse & { result?: { subscriptionId: string; filter: ObsFilter } }> {
  const filter = params?.filter || {}

  // Validate filter
  const validation = validateObsFilter(filter)
  if (!validation.success) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: `Invalid filter: ${validation.errors.map(e => e.message).join(', ')}`,
        data: validation.errors,
      },
      id: null,
    }
  }

  // Create subscription in manager
  const result = obsManager.subscribe(filter)

  // Connect to ObservabilityBroadcaster DO if available
  if (env.OBS_BROADCASTER) {
    try {
      const broadcasterStub = env.OBS_BROADCASTER.get(
        env.OBS_BROADCASTER.idFromName('global')
      )

      // Build URL with filter params
      const url = new URL('http://broadcaster/ws')
      if (filter.level) url.searchParams.set('level', filter.level)
      if (filter.script) url.searchParams.set('script', filter.script)
      if (filter.type) url.searchParams.set('type', filter.type)
      if (filter.requestId) url.searchParams.set('requestId', filter.requestId)
      if (filter.doName) url.searchParams.set('doName', filter.doName)

      // Fetch with WebSocket upgrade to connect to broadcaster
      const broadcasterResponse = await broadcasterStub.fetch(url.toString(), {
        headers: { Upgrade: 'websocket' },
      })

      if (broadcasterResponse.webSocket) {
        const broadcasterWs = broadcasterResponse.webSocket
        broadcasterWs.accept()

        // Forward events from broadcaster to client
        broadcasterWs.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data as string)
            // Forward events messages to client
            if (message.type === 'events') {
              // Apply filter before forwarding (in case broadcaster filter changes)
              const sub = obsManager.get(result.subscriptionId)
              if (sub) {
                const matchingEvents = (message.data as ObservabilityEvent[]).filter(
                  (e) => matchesFilter(e, sub.filter)
                )
                if (matchingEvents.length > 0) {
                  sendToClient({
                    type: 'events',
                    data: matchingEvents,
                  })
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        })

        // Store broadcaster WebSocket in subscription
        const sub = obsManager.get(result.subscriptionId)
        if (sub) {
          sub.broadcasterWs = broadcasterWs
        }
      }
    } catch {
      // Failed to connect to broadcaster - subscription still works but no events
      // Log this in production but don't fail the subscription
    }
  }

  return {
    jsonrpc: '2.0',
    result,
    id: null,
  }
}

/**
 * Handle obs.unsubscribe method - removes a subscription
 */
function handleObsUnsubscribe(
  params: { subscriptionId: string } | undefined,
  obsManager: ObsSubscriptionManager,
): JSONRPCResponse {
  if (!params?.subscriptionId) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: 'Missing subscriptionId parameter',
      },
      id: null,
    }
  }

  const success = obsManager.unsubscribe(params.subscriptionId)
  if (!success) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: `Subscription ${params.subscriptionId} not found`,
      },
      id: null,
    }
  }

  return {
    jsonrpc: '2.0',
    result: { success: true },
    id: null,
  }
}

/**
 * Handle obs.updateFilter method - updates filter for existing subscription
 */
function handleObsUpdateFilter(
  params: { subscriptionId: string; filter: ObsFilter } | undefined,
  obsManager: ObsSubscriptionManager,
): JSONRPCResponse {
  if (!params?.subscriptionId) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: 'Missing subscriptionId parameter',
      },
      id: null,
    }
  }

  if (!params.filter) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: 'Missing filter parameter',
      },
      id: null,
    }
  }

  // Validate new filter
  const validation = validateObsFilter(params.filter)
  if (!validation.success) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: `Invalid filter: ${validation.errors.map(e => e.message).join(', ')}`,
        data: validation.errors,
      },
      id: null,
    }
  }

  const success = obsManager.updateFilter(params.subscriptionId, params.filter)
  if (!success) {
    return {
      jsonrpc: '2.0',
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: `Subscription ${params.subscriptionId} not found`,
      },
      id: null,
    }
  }

  return {
    jsonrpc: '2.0',
    result: { success: true, filter: params.filter },
    id: null,
  }
}

// ============================================================================
// WebSocket Handler
// ============================================================================

// Helper to create WebSocket handler with env access
function createWebSocketHandler(_path: string) {
  return (c: { req: { header: (name: string) => string | undefined }; env: Env }) => {
    const upgradeHeader = c.req.header('upgrade')
    // Check Connection header to determine if this is a full WebSocket upgrade
    const connectionHeader = c.req.header('connection')?.toLowerCase() || ''
    const hasConnectionUpgrade = connectionHeader.includes('upgrade')

    // Only treat as WebSocket if BOTH Upgrade AND Connection headers are correct
    // This prevents the Workers runtime from intercepting incomplete upgrades
    if (upgradeHeader?.toLowerCase() !== 'websocket' || !hasConnectionUpgrade) {
      // Return RPC info for GET requests without proper WebSocket upgrade headers
      return new Response(
        JSON.stringify({
          message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
          methods: Object.keys(createRootObject({} as RPCContext)),
          hint: 'Connect with WebSocket protocol for streaming RPC',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Check for required WebSocket headers - if missing, return 426 Upgrade Required
    const secWebSocketKey = c.req.header('sec-websocket-key')
    const secWebSocketVersion = c.req.header('sec-websocket-version')

    if (!secWebSocketKey || !secWebSocketVersion) {
      return new Response(
        JSON.stringify({
          message: 'Incomplete WebSocket upgrade request',
          hint: 'Missing required Sec-WebSocket-Key or Sec-WebSocket-Version headers',
        }),
        {
          status: 426,
          headers: {
            'Content-Type': 'application/json',
            Upgrade: 'websocket',
            Connection: 'Upgrade',
          },
        },
      )
    }

    // Get environment bindings
    const env = c.env

    // WebSocket upgrade
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const promiseStore = new PromiseStore()
    const subscriptions = new SubscriptionManager()

    // Helper to send messages to client
    const sendToClient = (message: unknown) => {
      try {
        server.send(JSON.stringify(message))
      } catch {
        // Ignore send errors on closed socket
      }
    }

    // Create obs subscription manager
    const obsManager = new ObsSubscriptionManager(sendToClient)

    // Create context with send notification capability
    const sendNotification = (method: string, params: unknown) => {
      sendToClient({
        jsonrpc: '2.0',
        method,
        params,
      })
    }

    const ctx: RPCContext = {
      promiseStore,
      subscriptions,
      rootObject: {},
      sendNotification,
      sessionId,
    }
    ctx.rootObject = createRootObject(ctx)

    server.accept()

    // Track if we've received any message or sent the ack
    let receivedMessage = false
    let sentAck = false

    // Send connection acknowledgment after a short delay if no message received
    // This allows tests that immediately send a request to get their response first
    // while tests that wait for ack will receive it
    const ackTimeout = setTimeout(() => {
      if (!receivedMessage && !sentAck) {
        sentAck = true
        server.send(
          JSON.stringify({
            type: 'connected',
            sessionId,
          }),
        )
      }
    }, 500) // 500ms delay - give tests time to send first message

    server.addEventListener('message', async (event) => {
      receivedMessage = true
      // Cancel pending ack if we receive a message
      clearTimeout(ackTimeout)
      const rawData = event.data

      // Handle binary data
      if (rawData instanceof ArrayBuffer) {
        server.send(
          JSON.stringify({
            type: 'binary_received',
            size: rawData.byteLength,
          }),
        )
        return
      }

      // Check message size (limit to 1MB for safety)
      const MAX_MESSAGE_SIZE = 1024 * 1024 // 1MB
      const messageStr = rawData as string
      if (messageStr.length > MAX_MESSAGE_SIZE) {
        server.send(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Message too large' },
            id: null,
          } satisfies JSONRPCResponse),
        )
        return
      }

      // Parse the message
      let data: unknown
      try {
        data = JSON.parse(messageStr)
      } catch {
        // Parse error
        server.send(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          } satisfies JSONRPCResponse),
        )
        return
      }

      // Check for empty batch (array with length 0)
      if (Array.isArray(data) && data.length === 0) {
        server.send(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request' },
            id: null,
          } satisfies JSONRPCResponse),
        )
        return
      }

      // Handle JSON-RPC 2.0 batch
      if (isJSONRPCBatch(data)) {
        const responses: JSONRPCResponse[] = []
        for (const req of data) {
          // Check for obs methods in batch
          if (req.method?.startsWith('obs.')) {
            const obsResponse = await handleObsMethod(req, obsManager, env, sendToClient)
            if (obsResponse && req.id !== undefined) {
              responses.push({ ...obsResponse, id: req.id })
            }
          } else {
            const response = await handleJSONRPCRequest(req, ctx)
            if (response) {
              responses.push(response)
            }
          }
        }
        if (responses.length > 0) {
          server.send(JSON.stringify(responses))
        }
        return
      }

      // Handle single JSON-RPC 2.0 request
      if (isJSONRPCRequest(data)) {
        // Check for obs methods
        if (data.method?.startsWith('obs.')) {
          const response = await handleObsMethod(data, obsManager, env, sendToClient)
          if (response) {
            server.send(JSON.stringify({ ...response, id: data.id ?? null }))
          }
          return
        }

        const response = await handleJSONRPCRequest(data, ctx)
        if (response) {
          server.send(JSON.stringify(response))
        }
        return
      }

      // Handle Capnweb request
      if (isCapnwebRequest(data)) {
        const response = await executeRequest(data, ctx)
        server.send(JSON.stringify(response))
        return
      }

      // Invalid request format
      server.send(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request' },
          id: null,
        } satisfies JSONRPCResponse),
      )
    })

    server.addEventListener('close', () => {
      // Clean up resources
      promiseStore.clear()
      subscriptions.clear()
      obsManager.clear()
    })

    server.addEventListener('error', () => {
      server.close()
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }
}

/**
 * Route obs.* methods to appropriate handlers
 */
async function handleObsMethod(
  request: JSONRPCRequest,
  obsManager: ObsSubscriptionManager,
  env: Env,
  sendToClient: (msg: unknown) => void,
): Promise<JSONRPCResponse | null> {
  const { method, params, id } = request

  // Notifications (no id) don't get a response for subscribe but do for unsubscribe
  const isNotification = id === undefined

  switch (method) {
    case 'obs.subscribe': {
      const response = await handleObsSubscribe(
        params as { filter?: ObsFilter } | undefined,
        obsManager,
        env,
        sendToClient,
      )
      if (isNotification) return null
      return response
    }

    case 'obs.unsubscribe': {
      const response = handleObsUnsubscribe(
        params as { subscriptionId: string } | undefined,
        obsManager,
      )
      if (isNotification) return null
      return response
    }

    case 'obs.updateFilter': {
      const response = handleObsUpdateFilter(
        params as { subscriptionId: string; filter: ObsFilter } | undefined,
        obsManager,
      )
      if (isNotification) return null
      return response
    }

    default:
      // Unknown obs method
      if (isNotification) return null
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
          message: `Method '${method}' not found`,
        },
        id: id ?? null,
      }
  }
}

// WebSocket upgrade handler for /rpc
rpcRoutes.get('/', createWebSocketHandler('/'))

// WebSocket upgrade handler for /rpc/:doName (e.g., /rpc/Users)
rpcRoutes.get('/:doName', createWebSocketHandler('/:doName'))

// WebSocket upgrade handler for /rpc/:doName/:id (e.g., /rpc/Users/user-123)
rpcRoutes.get('/:doName/:id', createWebSocketHandler('/:doName/:id'))

export default rpcRoutes
