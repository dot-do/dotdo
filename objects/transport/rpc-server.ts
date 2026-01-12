/**
 * RPC Server for DO - Legacy RPC Protocol Implementation
 *
 * @deprecated This module is deprecated in favor of the official capnweb library.
 * Use the root endpoint (/) for Cap'n Web RPC via `objects/transport/capnweb-target.ts`.
 *
 * This module is kept for backward compatibility at the /rpc endpoint and supports:
 * - JSON-RPC 2.0: Standard JSON-RPC protocol (still useful for many clients)
 * - Chain RPC: Legacy chain-based format (deprecated, use capnweb)
 * - Custom Cap'n Web emulation: (deprecated, use real capnweb at /)
 *
 * Migration guide:
 * - For new clients: Use capnweb client connecting to root endpoint (/)
 * - For JSON-RPC 2.0: Continue using /rpc endpoint
 * - For Chain RPC: Migrate to capnweb protocol
 *
 * @see {@link ./capnweb-target.ts} for the new capnweb integration
 */

// ============================================================================
// TYPES - Cap'n Web RPC Protocol
// ============================================================================

/**
 * RPC Request - Cap'n Web protocol
 */
export interface RPCRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: RPCCall[]
  resolve?: { promiseId: string }
  dispose?: { promiseIds: string[] }
}

/**
 * RPC Call - a single method invocation
 */
export interface RPCCall {
  promiseId: string
  target: RPCTarget
  method: string
  args: RPCArg[]
}

/**
 * RPC Target - where to invoke the method
 */
export type RPCTarget =
  | { type: 'root' }
  | { type: 'promise'; promiseId: string }
  | { type: 'property'; base: NestedTarget; property: string }

/**
 * Nested Target - for property access
 */
export type NestedTarget =
  | { type: 'root' }
  | { type: 'promise'; promiseId: string }

/**
 * RPC Argument - value, promise reference, or callback
 */
export type RPCArg =
  | { type: 'value'; value: unknown }
  | { type: 'promise'; promiseId: string }
  | { type: 'callback'; callbackId: string }

/**
 * RPC Response
 */
export interface RPCResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: RPCResult[]
  error?: RPCError
}

/**
 * RPC Result - result of a single call
 */
export interface RPCResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: RPCError
}

/**
 * RPC Error
 */
export interface RPCError {
  code: string
  message: string
  data?: unknown
}

// ============================================================================
// TYPES - JSON-RPC 2.0 Protocol
// ============================================================================

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JSONRPCError
  id: string | number | null
}

/**
 * JSON-RPC 2.0 Error
 */
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
// TYPES - Chain RPC Protocol
// ============================================================================

/**
 * Chain step types for simple chain-based RPC
 */
export interface ChainPropertyStep {
  type: 'property'
  key: string
}

export interface ChainCallStep {
  type: 'call'
  args?: unknown[]
}

export interface ChainIndexStep {
  type: 'index'
  index: number
}

export type ChainStep = ChainPropertyStep | ChainCallStep | ChainIndexStep

/**
 * Chain RPC Request - Simple chain-based execution format
 */
export interface ChainRpcRequest {
  chain: ChainStep[]
}

/**
 * Chain RPC Response
 */
export interface ChainRpcResponse {
  result?: unknown
  error?: {
    message: string
    code?: string
  }
}

/**
 * Chain execution error codes
 */
const CHAIN_ERRORS = {
  INVALID_CHAIN: { code: 'INVALID_CHAIN', message: 'Chain must be a non-empty array' },
  INVALID_STEP: { code: 'INVALID_STEP', message: 'Invalid step type' },
  NOT_FOUND: { code: 'NOT_FOUND', message: 'Property not found' },
  NOT_CALLABLE: { code: 'NOT_CALLABLE', message: 'Value is not a function' },
  NOT_INDEXABLE: { code: 'NOT_INDEXABLE', message: 'Value is not an array' },
  INDEX_OUT_OF_BOUNDS: { code: 'INDEX_OUT_OF_BOUNDS', message: 'Array index out of bounds' },
  EXECUTION_ERROR: { code: 'EXECUTION_ERROR', message: 'Chain execution failed' },
  BLOCKED_ACCESS: { code: 'BLOCKED_ACCESS', message: 'Access to this property is blocked' },
}

// ============================================================================
// PROMISE STORE - Manages stored promise results for pipelining
// ============================================================================

class PromiseStore {
  private promises = new Map<string, unknown>()
  private disposed = new Set<string>()
  private depths = new Map<string, number>()

  set(id: string, value: unknown, depth: number = 0): void {
    this.promises.set(id, value)
    this.depths.set(id, depth)
  }

  get(id: string): unknown {
    if (this.disposed.has(id)) {
      throw { code: 'DISPOSED_REFERENCE', message: `Promise ${id} has been disposed` }
    }
    return this.promises.get(id)
  }

  getDepth(id: string): number {
    return this.depths.get(id) ?? 0
  }

  has(id: string): boolean {
    return this.promises.has(id) && !this.disposed.has(id)
  }

  dispose(id: string): boolean {
    if (this.promises.has(id)) {
      this.disposed.add(id)
      this.promises.delete(id)
      this.depths.delete(id)
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
    this.depths.clear()
  }
}

// ============================================================================
// SUBSCRIPTION MANAGER - For WebSocket event subscriptions
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
        try {
          sub.callback(data)
        } catch (error) {
          // Log callback errors so broken subscriptions can be detected
          console.error('[rpc] Subscription callback error:', {
            subscriptionId: id,
            event,
            error: error instanceof Error ? error.message : 'unknown',
            stack: error instanceof Error ? error.stack : undefined,
          })
        }
      }
    }
  }

  clear(): void {
    this.subscriptions.clear()
    this.eventSubscriptions.clear()
  }
}

// ============================================================================
// RPC CONTEXT - Shared context for RPC execution
// ============================================================================

interface RPCContext {
  promiseStore: PromiseStore
  subscriptions: SubscriptionManager
  rootObject: Record<string, unknown>
  sendNotification: (method: string, params: unknown) => void
  sessionId: string
  exposedMethods: Set<string>
  blockedMethods: Set<string>
}

// ============================================================================
// RPC SERVER - Main server class for DO integration
// ============================================================================

/**
 * Configuration for RPC Server
 */
export interface RPCServerConfig {
  /** Maximum depth for promise pipelining */
  maxPipelineDepth?: number
  /** Methods to expose (if empty, all non-private methods are exposed) */
  exposedMethods?: string[]
  /** Methods to explicitly block (takes precedence over exposedMethods) */
  blockedMethods?: string[]
}

// Default blocked methods - internal DO methods that should never be exposed
const DEFAULT_BLOCKED_METHODS = new Set([
  // Lifecycle methods
  'initialize',
  'fetch',
  'handleFetch',
  'alarm',
  // Internal state
  'db',
  'ctx',
  'storage',
  'env',
  // Private accessors
  '_users',
  '_posts',
  '_things',
  '_rels',
  '_actions',
  '_events',
  '_search',
  '_objects',
  '_dlq',
  '_typeCache',
  '_eventHandlers',
  '_scheduleHandlers',
  '_scheduleManager',
  '_currentActor',
  '_stepCache',
  // Constructor
  'constructor',
])

// ============================================================================
// COLLECTION RPC PATTERN MATCHING
// ============================================================================

/**
 * Valid collection methods
 */
const COLLECTION_METHODS = new Set(['create', 'update', 'delete', 'get', 'list', 'find'])

/**
 * Pattern for valid PascalCase noun names (no numbers, no special chars)
 */
const VALID_NOUN_PATTERN = /^[A-Z][a-zA-Z]*$/

/**
 * Pattern for {Noun}.{method} format (exactly one dot)
 * Noun must be PascalCase, method can be any valid identifier starting with lowercase
 */
const COLLECTION_RPC_PATTERN = /^([A-Z][a-zA-Z]*)\.([a-z][a-zA-Z]*)$/

/**
 * Check if a method name looks like a collection RPC call
 */
function isCollectionRpcMethod(method: string): boolean {
  return method.includes('.') && !method.startsWith('_')
}

/**
 * Parse a collection RPC method into noun and action
 * Returns null if invalid format
 */
function parseCollectionRpcMethod(method: string): { noun: string; action: string } | null {
  // Check for multiple dots (invalid)
  if ((method.match(/\./g) || []).length !== 1) {
    return null
  }

  const match = method.match(COLLECTION_RPC_PATTERN)
  if (!match) return null

  const [, noun, action] = match
  return { noun: noun!, action: action! }
}

/**
 * Validate noun name
 * @returns error message if invalid, null if valid
 */
function validateNounName(noun: string): string | null {
  if (!noun || noun.trim() === '') {
    return 'Noun name cannot be empty'
  }
  if (!VALID_NOUN_PATTERN.test(noun)) {
    return `Invalid noun '${noun}': must be PascalCase letters only`
  }
  return null
}

/**
 * Validate collection method name
 * @returns error message if invalid, null if valid
 */
function validateCollectionMethod(noun: string, method: string): string | null {
  if (!COLLECTION_METHODS.has(method)) {
    return `Unknown method '${method}' on ${noun}. Valid methods: ${Array.from(COLLECTION_METHODS).join(', ')}`
  }
  return null
}

/**
 * RPC Server class that wraps a DO instance
 */
export class RPCServer {
  private doInstance: Record<string, unknown>
  private config: RPCServerConfig
  private exposedMethods: Set<string>
  private blockedMethods: Set<string>
  private sessions: Map<string, RPCContext> = new Map()
  private defaultHttpSession?: RPCContext

  constructor(doInstance: unknown, config: RPCServerConfig = {}) {
    this.doInstance = doInstance as Record<string, unknown>
    this.config = {
      maxPipelineDepth: config.maxPipelineDepth ?? 20,
      ...config,
    }

    // Build blocked methods set
    this.blockedMethods = new Set([
      ...DEFAULT_BLOCKED_METHODS,
      ...(config.blockedMethods ?? []),
    ])

    // Build exposed methods set
    this.exposedMethods = new Set<string>()
    if (config.exposedMethods && config.exposedMethods.length > 0) {
      for (const method of config.exposedMethods) {
        if (!this.blockedMethods.has(method)) {
          this.exposedMethods.add(method)
        }
      }
    } else {
      // Auto-discover methods from the DO instance
      this.discoverMethods()
    }
  }

  /**
   * Discover exposed methods from the DO instance
   */
  private discoverMethods(): void {
    // Get own property names from instance and prototype chain
    const visited = new Set<string>()
    let obj = this.doInstance

    while (obj && obj !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (visited.has(key)) continue
        visited.add(key)

        // Skip blocked methods
        if (this.blockedMethods.has(key)) continue

        // Skip private methods (starting with _)
        if (key.startsWith('_')) continue

        // Skip getter/setter only properties
        const descriptor = Object.getOwnPropertyDescriptor(obj, key)
        if (descriptor && (descriptor.get || descriptor.set) && !descriptor.value) {
          continue
        }

        // Check if it's a function
        const value = this.doInstance[key]
        if (typeof value === 'function') {
          this.exposedMethods.add(key)
        }
      }

      obj = Object.getPrototypeOf(obj)
    }
  }

  /**
   * Get list of exposed methods
   */
  get methods(): string[] {
    return Array.from(this.exposedMethods)
  }

  /**
   * Check if a method is exposed
   */
  isRpcExposed(method: string): boolean {
    if (this.blockedMethods.has(method)) return false
    if (method.startsWith('_')) return false
    return this.exposedMethods.has(method)
  }

  /**
   * Check if a method requires authentication and return an error if auth is missing
   */
  private checkMethodAuth(method: string, request: Request): JSONRPCError | null {
    // Get the $auth config from the DO instance's constructor
    const DOClass = this.doInstance.constructor as {
      $auth?: Record<string, { requireAuth?: boolean; public?: boolean; roles?: string[] }>
    }

    const authConfig = DOClass.$auth?.[method]
    if (!authConfig) return null

    // If method is public, no auth needed
    if (authConfig.public) return null

    // If method requires auth, check for Authorization header
    if (authConfig.requireAuth || authConfig.roles) {
      const authHeader = request.headers.get('Authorization')
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          code: -32001, // Custom auth error code
          message: 'Authentication required',
        }
      }

      // Basic token validation (could be extended to actually validate JWT)
      const token = authHeader.slice(7)
      if (!token || token.split('.').length !== 3) {
        return {
          code: -32001,
          message: 'Invalid authentication token',
        }
      }
    }

    return null
  }

  /**
   * Handle collection RPC call pattern: {Noun}.{method}
   * Routes to the DO's collection() method for typed data access.
   *
   * @param method - The method name (e.g., "Task.create")
   * @param args - The resolved arguments
   * @returns The result of the collection operation, or throws an error
   */
  private async handleCollectionRpc(method: string, args: unknown[]): Promise<unknown> {
    // Check if this looks like a collection RPC call
    if (!isCollectionRpcMethod(method)) {
      return null // Not a collection RPC, let normal handling proceed
    }

    // Handle multiple dots (invalid pattern)
    if ((method.match(/\./g) || []).length !== 1) {
      throw { code: 'INVALID_METHOD', message: `Invalid method pattern: ${method}` }
    }

    // Parse the method
    const parsed = parseCollectionRpcMethod(method)

    // Check for invalid noun pattern (lowercase, special chars, etc.)
    if (!parsed) {
      // Extract noun part for better error message
      const [nounPart] = method.split('.')

      // Check if it's a lowercase noun issue
      if (nounPart && /^[a-z]/.test(nounPart)) {
        throw { code: 'INVALID_NOUN', message: `Invalid noun '${nounPart}': must start with uppercase letter` }
      }

      // Check for numbers or special chars
      if (nounPart && !/^[A-Za-z]+$/.test(nounPart)) {
        throw { code: 'INVALID_NOUN', message: `Invalid noun '${nounPart}': must contain only letters` }
      }

      // Empty noun
      if (!nounPart || nounPart === '') {
        throw { code: 'INVALID_NOUN', message: 'Noun name cannot be empty' }
      }

      throw { code: 'INVALID_METHOD', message: `Invalid method pattern: ${method}` }
    }

    const { noun, action } = parsed

    // Validate noun name
    const nounError = validateNounName(noun)
    if (nounError) {
      throw { code: 'INVALID_NOUN', message: nounError }
    }

    // Validate collection method
    const methodError = validateCollectionMethod(noun, action)
    if (methodError) {
      throw { code: 'UNKNOWN_METHOD', message: methodError }
    }

    // Get the collection method from the DO instance
    // The collection method is protected, but we can access it via the instance
    const collectionFn = (this.doInstance as Record<string, unknown>)['collection'] as
      ((noun: string) => Record<string, (...args: unknown[]) => Promise<unknown>>) | undefined

    if (typeof collectionFn !== 'function') {
      // Fallback: the DO doesn't have a collection method, so we can't handle this
      throw { code: 'NOT_SUPPORTED', message: 'This DO does not support collection operations' }
    }

    // Get the collection for this noun
    const collection = collectionFn.call(this.doInstance, noun)

    if (!collection || typeof collection !== 'object') {
      throw { code: 'COLLECTION_ERROR', message: `Failed to get collection for '${noun}'` }
    }

    const actionFn = collection[action]
    if (typeof actionFn !== 'function') {
      throw { code: 'UNKNOWN_METHOD', message: `Method '${action}' not found on ${noun} collection` }
    }

    // Execute the collection method with the provided arguments
    let result = await actionFn.apply(collection, args)

    // For mutations (create, update, delete), ensure $rowid is included
    if (action === 'create' || action === 'update' || action === 'delete') {
      result = this.ensureRowidInResult(result, action)
    }

    return result
  }

  /**
   * Ensure $rowid is present in mutation results.
   * If not present, generate a synthetic one for compatibility.
   */
  private ensureRowidInResult(result: unknown, action: string): unknown {
    if (result === null || result === undefined) {
      return result
    }

    if (typeof result === 'object' && !Array.isArray(result)) {
      const obj = result as Record<string, unknown>

      // If $rowid is already present, return as-is
      if ('$rowid' in obj && typeof obj.$rowid === 'number') {
        return result
      }

      // For delete, also add 'deleted' flag if not present
      if (action === 'delete') {
        return {
          ...obj,
          deleted: obj.deleted ?? true,
          $rowid: obj.$rowid ?? this.generateSyntheticRowid(),
        }
      }

      // For create/update, add $rowid if missing
      return {
        ...obj,
        $rowid: this.generateSyntheticRowid(),
      }
    }

    return result
  }

  /**
   * Generate a synthetic rowid for collection operations.
   * This is used when the underlying collection doesn't return a rowid.
   */
  private syntheticRowidCounter = 1
  private generateSyntheticRowid(): number {
    return this.syntheticRowidCounter++
  }

  /**
   * Create a new RPC session
   */
  private createSession(): RPCContext {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const promiseStore = new PromiseStore()
    const subscriptions = new SubscriptionManager()

    const ctx: RPCContext = {
      promiseStore,
      subscriptions,
      rootObject: this.doInstance,
      sendNotification: () => {},
      sessionId,
      exposedMethods: this.exposedMethods,
      blockedMethods: this.blockedMethods,
    }

    this.sessions.set(sessionId, ctx)
    return ctx
  }

  /**
   * Get or create a session
   */
  private getSession(sessionId?: string): RPCContext {
    if (sessionId && this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!
    }
    return this.createSession()
  }

  /**
   * Get the default HTTP session (persists across HTTP requests to same DO)
   */
  private getDefaultHttpSession(): RPCContext {
    if (!this.defaultHttpSession) {
      this.defaultHttpSession = this.createSession()
    }
    return this.defaultHttpSession
  }

  /**
   * Clean up a session
   */
  private cleanupSession(sessionId: string): void {
    const ctx = this.sessions.get(sessionId)
    if (ctx) {
      ctx.promiseStore.clear()
      ctx.subscriptions.clear()
      this.sessions.delete(sessionId)
    }
  }

  /**
   * Handle an HTTP RPC request
   */
  async handleRpcRequest(request: Request): Promise<Response> {
    // Use persistent session for HTTP requests (state persists across requests to same DO)
    const ctx = this.getDefaultHttpSession()

    // Parse request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({
        id: '',
        type: 'error',
        error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
      } satisfies RPCResponse, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    // Check if JSON-RPC 2.0
    if (this.isJSONRPCRequest(body)) {
      // Check if the method requires auth
      const authError = this.checkMethodAuth(body.method, request)
      if (authError) {
        return Response.json({
          jsonrpc: '2.0',
          error: authError,
          id: body.id ?? null,
        }, { status: 401, headers: { 'Content-Type': 'application/json' } })
      }
      const response = await this.handleJSONRPCRequest(body, ctx)
      if (!response) {
        // Notification - no response
        return new Response(null, { status: 204 })
      }
      return Response.json(response, { headers: { 'Content-Type': 'application/json' } })
    }

    // Check if JSON-RPC 2.0 batch
    if (this.isJSONRPCBatch(body)) {
      const responses: JSONRPCResponse[] = []
      for (const req of body) {
        const response = await this.handleJSONRPCRequest(req, ctx)
        if (response) {
          responses.push(response)
        }
      }
      if (responses.length === 0) {
        return new Response(null, { status: 204 })
      }
      return Response.json(responses, { headers: { 'Content-Type': 'application/json' } })
    }

    // Cap'n Web RPC
    if (this.isCapnWebRequest(body)) {
      const response = await this.executeCapnWebRequest(body, ctx)
      return Response.json(response, { headers: { 'Content-Type': 'application/json' } })
    }

    // Chain RPC - Check for chain request format
    if (this.isChainRequest(body)) {
      // Get the WorkflowContext if available on the DO instance
      const workflowContext = (this.doInstance as { $?: unknown }).$
      return this.executeChainRequest(body, workflowContext)
    }

    // Check for invalid chain format (has 'chain' property but it's not an array)
    if (body !== null && typeof body === 'object' && 'chain' in body) {
      return Response.json({
        error: { message: 'Chain must be a non-empty array', code: 'INVALID_CHAIN' },
      } satisfies ChainRpcResponse, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    return Response.json({
      id: '',
      type: 'error',
      error: { code: 'INVALID_REQUEST', message: 'Unknown request format' },
    } satisfies RPCResponse, { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  /**
   * Handle WebSocket RPC connection
   */
  handleWebSocketRpc(): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    const ctx = this.createSession()

    // Set up notification sender
    ctx.sendNotification = (method: string, params: unknown) => {
      try {
        server!.send(JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
        }))
      } catch (error) {
        // Log send errors for debugging WebSocket connection issues
        console.debug('[rpc] WebSocket notification send failed:', {
          method,
          readyState: (server as any).readyState,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }

    server!.accept()

    // Send connection acknowledgment
    server!.send(JSON.stringify({
      type: 'connected',
      sessionId: ctx.sessionId,
    }))

    server!.addEventListener('message', async (event) => {
      const rawData = event.data

      // Handle binary data
      if (rawData instanceof ArrayBuffer) {
        server!.send(JSON.stringify({
          type: 'binary_received',
          size: rawData.byteLength,
        }))
        return
      }

      // Parse message
      let data: unknown
      try {
        data = JSON.parse(rawData as string)
      } catch {
        server!.send(JSON.stringify({
          jsonrpc: '2.0',
          error: JSON_RPC_ERRORS.PARSE_ERROR,
          id: null,
        } satisfies JSONRPCResponse))
        return
      }

      // Handle JSON-RPC 2.0 batch
      if (this.isJSONRPCBatch(data)) {
        const responses: JSONRPCResponse[] = []
        for (const req of data) {
          const response = await this.handleJSONRPCRequest(req, ctx)
          if (response) {
            responses.push(response)
          }
        }
        if (responses.length > 0) {
          server!.send(JSON.stringify(responses))
        }
        return
      }

      // Handle single JSON-RPC 2.0 request
      if (this.isJSONRPCRequest(data)) {
        const response = await this.handleJSONRPCRequest(data, ctx)
        if (response) {
          server!.send(JSON.stringify(response))
        }
        return
      }

      // Handle Cap'n Web request
      if (this.isCapnWebRequest(data)) {
        const response = await this.executeCapnWebRequest(data, ctx)
        server!.send(JSON.stringify(response))
        return
      }

      // Invalid request format
      server!.send(JSON.stringify({
        jsonrpc: '2.0',
        error: JSON_RPC_ERRORS.INVALID_REQUEST,
        id: null,
      } satisfies JSONRPCResponse))
    })

    server!.addEventListener('close', () => {
      this.cleanupSession(ctx.sessionId)
    })

    server!.addEventListener('error', () => {
      this.cleanupSession(ctx.sessionId)
      server!.close()
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // ============================================================================
  // PROTOCOL DETECTION
  // ============================================================================

  private isJSONRPCRequest(data: unknown): data is JSONRPCRequest {
    return (
      data !== null &&
      typeof data === 'object' &&
      'jsonrpc' in data &&
      (data as JSONRPCRequest).jsonrpc === '2.0'
    )
  }

  private isJSONRPCBatch(data: unknown): data is JSONRPCRequest[] {
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      data.every((item) => this.isJSONRPCRequest(item))
    )
  }

  private isCapnWebRequest(data: unknown): data is RPCRequest {
    return (
      data !== null &&
      typeof data === 'object' &&
      'type' in data &&
      typeof (data as RPCRequest).type === 'string'
    )
  }

  /**
   * Check if request is a Chain RPC request
   */
  private isChainRequest(data: unknown): data is ChainRpcRequest {
    return (
      data !== null &&
      typeof data === 'object' &&
      'chain' in data &&
      Array.isArray((data as ChainRpcRequest).chain)
    )
  }

  // ============================================================================
  // CHAIN RPC HANDLER
  // ============================================================================

  /**
   * Execute a chain-based RPC request.
   *
   * The chain starts from the root object (the DO instance) and executes
   * each step in sequence. If a WorkflowContext ($) is available, the chain
   * can access it via the 'chain' starting from root.
   *
   * @param request - The chain RPC request
   * @param workflowContext - Optional WorkflowContext to use as $ root
   * @returns Response with data or error
   */
  async executeChainRequest(
    request: ChainRpcRequest,
    workflowContext?: unknown
  ): Promise<Response> {
    const { chain } = request

    // Validate chain
    if (!Array.isArray(chain) || chain.length === 0) {
      return Response.json({
        error: { message: 'Chain must be a non-empty array', code: 'INVALID_CHAIN' },
      } satisfies ChainRpcResponse, { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    try {
      const result = await this.executeChain(chain, workflowContext)
      return Response.json({
        result,
      } satisfies ChainRpcResponse, { headers: { 'Content-Type': 'application/json' } })
    } catch (error) {
      const chainError = error as { code?: string; message?: string; status?: number }
      const status = chainError.status ?? 400

      return Response.json({
        error: {
          message: chainError.message ?? 'Chain execution failed',
          code: chainError.code ?? 'EXECUTION_ERROR',
        },
      } satisfies ChainRpcResponse, { status, headers: { 'Content-Type': 'application/json' } })
    }
  }

  /**
   * Execute a chain of steps starting from the DO instance.
   *
   * The chain can access:
   * - DO instance properties and methods directly (e.g., config, getStatus)
   * - WorkflowContext via the $ property (e.g., $.things, $.on)
   *
   * @param chain - Array of chain steps
   * @param workflowContext - Optional WorkflowContext accessible via $ property
   * @returns The final result of the chain
   */
  private async executeChain(
    chain: ChainStep[],
    workflowContext?: unknown
  ): Promise<unknown> {
    // Always start from the DO instance
    // WorkflowContext ($) is accessible as a property of the instance
    let current: unknown = this.doInstance

    // If the first step is accessing '$', use the WorkflowContext directly
    if (chain.length > 0 && chain[0]!.type === 'property' && (chain[0] as ChainPropertyStep).key === '$' && workflowContext) {
      current = workflowContext
      chain = chain.slice(1) // Skip the '$' step
    }

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!

      switch (step.type) {
        case 'property': {
          const propStep = step as ChainPropertyStep
          // Validate the step
          if (typeof propStep.key !== 'string') {
            throw { code: 'INVALID_STEP', message: 'Property step requires a string key', status: 400 }
          }

          // Block access to private/internal properties
          if (propStep.key.startsWith('_')) {
            throw { code: 'BLOCKED_ACCESS', message: `Access to private property '${propStep.key}' is blocked`, status: 404 }
          }

          // Block access to internal DO methods on first step (from root)
          if (i === 0 && this.blockedMethods.has(propStep.key)) {
            throw { code: 'BLOCKED_ACCESS', message: `Access to '${propStep.key}' is blocked`, status: 404 }
          }

          if (current === null || current === undefined) {
            throw { code: 'NOT_FOUND', message: `Cannot access property '${propStep.key}' of ${current}`, status: 404 }
          }

          // For objects with a Proxy get trap (like WorkflowContext), accessing the property triggers the proxy
          const value = (current as Record<string, unknown>)[propStep.key]

          if (value === undefined && !(propStep.key in (current as object))) {
            throw { code: 'NOT_FOUND', message: `Property '${propStep.key}' not found`, status: 404 }
          }

          current = value
          break
        }

        case 'call': {
          const callStep = step as ChainCallStep
          const args = callStep.args ?? []

          // SDK Combined Format: { type: 'call', key: 'methodName', args: [...] }
          // This combines property access and method call in one step.
          // When 'key' is present, first access the property, then call it.
          const combinedKey = (step as { key?: string }).key

          if (combinedKey !== undefined) {
            // Combined call step - first access the property, then call it
            if (typeof combinedKey !== 'string') {
              throw { code: 'INVALID_STEP', message: 'Combined call step requires a string key', status: 400 }
            }

            // Block access to private methods
            if (combinedKey.startsWith('_')) {
              throw { code: 'BLOCKED_ACCESS', message: `Access to private method '${combinedKey}' is blocked`, status: 404 }
            }

            // Block access to internal DO methods on first step (from root)
            if (i === 0 && this.blockedMethods.has(combinedKey)) {
              throw { code: 'BLOCKED_ACCESS', message: `Access to '${combinedKey}' is blocked`, status: 404 }
            }

            if (current === null || current === undefined) {
              throw { code: 'NOT_FOUND', message: `Cannot access method '${combinedKey}' of ${current}`, status: 404 }
            }

            // Access the method
            const method = (current as Record<string, unknown>)[combinedKey]

            if (method === undefined && !(combinedKey in (current as object))) {
              throw { code: 'NOT_FOUND', message: `Method '${combinedKey}' not found`, status: 404 }
            }

            if (typeof method !== 'function') {
              throw { code: 'NOT_CALLABLE', message: `'${combinedKey}' is not a function`, status: 400 }
            }

            // Execute the method with 'current' as 'this' context
            const result = method.apply(current, args)

            // Await if it's a promise
            current = result instanceof Promise ? await result : result
          } else {
            // Traditional call step - 'current' should already be a function
            if (typeof current !== 'function') {
              throw { code: 'NOT_CALLABLE', message: 'Value is not a function, cannot call', status: 400 }
            }

            // Find the 'this' context for the call
            // Look back for the last property access to get the parent object
            let thisContext: unknown = this.doInstance
            if (i > 0) {
              // Re-execute chain up to the previous step to get the parent context
              const prevChain = chain.slice(0, i - 1)
              if (prevChain.length > 0) {
                thisContext = await this.executeChain(prevChain, workflowContext)
              } else if (i === 1) {
                // First call after property access - use root
                thisContext = workflowContext ?? this.doInstance
              }
            }

            // Execute the function
            const result = (current as Function).apply(thisContext, args)

            // Await if it's a promise
            current = result instanceof Promise ? await result : result
          }
          break
        }

        case 'index': {
          const indexStep = step as ChainIndexStep
          if (typeof indexStep.index !== 'number') {
            throw { code: 'INVALID_STEP', message: 'Index step requires a numeric index', status: 400 }
          }

          if (!Array.isArray(current)) {
            throw { code: 'NOT_INDEXABLE', message: 'Value is not an array, cannot use index access', status: 400 }
          }

          if (indexStep.index < 0 || indexStep.index >= current.length) {
            throw {
              code: 'INDEX_OUT_OF_BOUNDS',
              message: `Index ${indexStep.index} is out of bounds (array length: ${current.length})`,
              status: 404
            }
          }

          current = current[indexStep.index]
          break
        }

        default: {
          throw {
            code: 'INVALID_STEP',
            message: `Invalid step type: ${(step as { type: string }).type}`,
            status: 400
          }
        }
      }
    }

    return current
  }

  // ============================================================================
  // JSON-RPC 2.0 HANDLER
  // ============================================================================

  private async handleJSONRPCRequest(
    request: JSONRPCRequest,
    ctx: RPCContext
  ): Promise<JSONRPCResponse | null> {
    const { method, params, id } = request
    const isNotification = id === undefined

    try {
      // Handle subscription methods
      if (method === 'subscribe') {
        const p = params as { event: string }
        const subscriptionId = ctx.subscriptions.subscribe(p.event, (data) => {
          ctx.sendNotification(p.event, data)
        })
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          result: { subscriptionId },
          id: id ?? null,
        }
      }

      if (method === 'unsubscribe') {
        const p = params as { subscriptionId: string }
        const success = ctx.subscriptions.unsubscribe(p.subscriptionId)
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          result: { success },
          id: id ?? null,
        }
      }

      // Handle triggerEvent (for testing)
      if (method === 'triggerEvent') {
        const p = params as { event: string; data: unknown }
        ctx.subscriptions.emit(p.event, p.data)
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          result: { triggered: true },
          id: id ?? null,
        }
      }

      // Check for collection RPC pattern: {Noun}.{method}
      if (isCollectionRpcMethod(method)) {
        // Convert params to args array
        const args: unknown[] = params === undefined
          ? []
          : Array.isArray(params)
            ? params
            : [params]

        const result = await this.handleCollectionRpc(method, args)

        if (isNotification) return null

        return {
          jsonrpc: '2.0',
          result,
          id: id ?? null,
        }
      }

      // Check if method exists and is exposed
      if (!this.isRpcExposed(method)) {
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` },
          id: id ?? null,
        }
      }

      const methodFn = ctx.rootObject[method]
      if (typeof methodFn !== 'function') {
        if (isNotification) return null
        return {
          jsonrpc: '2.0',
          error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` },
          id: id ?? null,
        }
      }

      // Execute method
      let result: unknown
      if (params === undefined) {
        result = await methodFn.call(ctx.rootObject)
      } else if (Array.isArray(params)) {
        result = await methodFn.apply(ctx.rootObject, params)
      } else if (typeof params === 'object' && params !== null) {
        // Named parameters - try to extract positional args from object
        const namedParams = params as Record<string, unknown>
        const paramNames = this.extractParamNames(methodFn)

        if (paramNames.length > 0 && paramNames.every((name) => name in namedParams)) {
          // All parameter names found in the object - convert to positional args
          const args = paramNames.map((name) => namedParams[name])
          result = await methodFn.apply(ctx.rootObject, args)
        } else {
          // Fall back to passing the object as a single argument
          result = await methodFn.call(ctx.rootObject, params)
        }
      } else {
        result = await methodFn.call(ctx.rootObject, params)
      }

      if (isNotification) return null

      return {
        jsonrpc: '2.0',
        result,
        id: id ?? null,
      }
    } catch (error) {
      if (isNotification) return null

      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: errorMessage,
        },
        id: id ?? null,
      }
    }
  }

  // ============================================================================
  // CAP'N WEB RPC HANDLER
  // ============================================================================

  private async executeCapnWebRequest(
    request: RPCRequest,
    ctx: RPCContext
  ): Promise<RPCResponse> {
    switch (request.type) {
      case 'call':
      case 'batch':
        return this.executeBatch(request, ctx)

      case 'resolve':
        return this.executeResolve(request, ctx)

      case 'dispose':
        return this.executeDispose(request, ctx)

      default:
        return {
          id: request.id,
          type: 'error',
          error: { code: 'INVALID_REQUEST', message: 'Unknown request type' },
        }
    }
  }

  private async executeBatch(request: RPCRequest, ctx: RPCContext): Promise<RPCResponse> {
    if (!request.calls || request.calls.length === 0) {
      return {
        id: request.id,
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'No calls provided' },
      }
    }

    const results: RPCResult[] = []

    for (const call of request.calls) {
      const result = await this.executeCall(call, ctx)
      results.push(result)
    }

    return {
      id: request.id,
      type: 'batch',
      results,
    }
  }

  private async executeResolve(request: RPCRequest, ctx: RPCContext): Promise<RPCResponse> {
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

    if (!ctx.promiseStore.has(promiseId)) {
      return {
        id: request.id,
        type: 'error',
        error: { code: 'INVALID_PROMISE', message: `Promise ${promiseId} not found` },
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

  private async executeDispose(request: RPCRequest, ctx: RPCContext): Promise<RPCResponse> {
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

  private async executeCall(call: RPCCall, ctx: RPCContext): Promise<RPCResult> {
    // Calculate depth for this call (outside try for catch access)
    let callDepth = 0
    try {
      if (call.target.type === 'promise') {
        const baseDepth = ctx.promiseStore.getDepth(call.target.promiseId)
        callDepth = baseDepth + 1

        // Check max pipeline depth
        const maxDepth = this.config.maxPipelineDepth ?? 20
        if (callDepth >= maxDepth) {
          throw { code: 'MAX_PIPELINE_DEPTH', message: `Pipeline depth ${callDepth} exceeds maximum ${maxDepth}` }
        }
      } else if (call.target.type === 'property') {
        const base = call.target.base
        if (base.type === 'promise') {
          const baseDepth = ctx.promiseStore.getDepth(base.promiseId)
          callDepth = baseDepth + 1

          // Check max pipeline depth
          if (callDepth > (this.config.maxPipelineDepth ?? 20)) {
            throw { code: 'MAX_PIPELINE_DEPTH', message: `Pipeline depth ${callDepth} exceeds maximum ${this.config.maxPipelineDepth ?? 20}` }
          }
        }
      }

      const target = this.resolveTarget(call.target, ctx)
      const args = call.args.map((arg) => this.resolveArg(arg, ctx))

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
          result = target.filter(
            (item) => (item as Record<string, unknown>)[filterSpec.property] === filterSpec.equals
          )
        } else {
          result = target
        }
      } else if (target === ctx.rootObject) {
        // Check for collection RPC pattern first: {Noun}.{method}
        if (isCollectionRpcMethod(call.method)) {
          result = await this.handleCollectionRpc(call.method, args)
        } else {
          // Regular root object method call - MUST check if exposed
          if (!this.isRpcExposed(call.method)) {
            throw { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` }
          }

          const method = (target as Record<string, unknown>)[call.method]
          if (typeof method !== 'function') {
            throw { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` }
          }

          result = await method.apply(target, args)
        }
      } else if (target && typeof target === 'object' && call.method in (target as object)) {
        // Method call on non-root object (from pipelining)
        const method = (target as Record<string, unknown>)[call.method]
        if (typeof method === 'function') {
          result = await method.apply(target, args)
        } else {
          result = method
        }
      } else if (target && typeof target === 'object') {
        // Property access on object
        result = (target as Record<string, unknown>)[call.method]
        if (result === undefined && !(call.method in (target as object))) {
          throw { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` }
        }
      } else {
        throw { code: 'INVALID_TARGET', message: 'Cannot call method on null or primitive' }
      }

      // Store result for pipelining (with depth tracking)
      ctx.promiseStore.set(call.promiseId, result, callDepth)

      return {
        promiseId: call.promiseId,
        type: 'value',
        value: result,
      }
    } catch (error) {
      const rpcError: RPCError =
        error && typeof error === 'object' && 'code' in error
          ? (error as RPCError)
          : {
              code: 'EXECUTION_ERROR',
              message: error instanceof Error ? error.message : String(error),
            }

      // Store error marker for pipeline propagation (with depth tracking)
      ctx.promiseStore.set(call.promiseId, { __error__: rpcError }, callDepth)

      return {
        promiseId: call.promiseId,
        type: 'error',
        error: rpcError,
      }
    }
  }

  private resolveTarget(target: RPCTarget, ctx: RPCContext): unknown {
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

        // Check for null/undefined target
        if (value === null || value === undefined) {
          throw { code: 'INVALID_TARGET', message: 'Cannot access property of null or undefined' }
        }

        return value
      }

      case 'property': {
        const base = this.resolveNestedTarget(target.base, ctx)
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

  private resolveNestedTarget(target: NestedTarget, ctx: RPCContext): unknown {
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

        // Check if the value is an error marker
        if (value && typeof value === 'object' && '__error__' in value) {
          throw (value as { __error__: RPCError }).__error__
        }

        return value
      }

      default:
        throw { code: 'INVALID_TARGET', message: 'Unknown nested target type' }
    }
  }

  private resolveArg(arg: RPCArg, ctx: RPCContext): unknown {
    switch (arg.type) {
      case 'value':
        return arg.value

      case 'promise': {
        if (ctx.promiseStore.isDisposed(arg.promiseId)) {
          throw { code: 'DISPOSED_REFERENCE', message: `Promise ${arg.promiseId} has been disposed` }
        }

        const value = ctx.promiseStore.get(arg.promiseId)

        // If the value is an object with an id, extract it for method calls
        // This handles the case where we pass a user object to getUserPosts
        if (value && typeof value === 'object' && 'id' in value) {
          return (value as { id: string }).id
        }

        return value
      }

      case 'callback':
        throw { code: 'NOT_IMPLEMENTED', message: 'Callbacks not yet supported' }

      default:
        throw { code: 'INVALID_ARG', message: 'Unknown argument type' }
    }
  }

  /**
   * Extract parameter names from a function.
   * Uses function.toString() parsing to extract parameter names.
   */
  private extractParamNames(fn: Function): string[] {
    const fnStr = fn.toString()
    // Match function parameters - handles various function syntaxes
    const arrowMatch = fnStr.match(/^\s*\(?([^)=]*)\)?\s*=>/)
    const funcMatch = fnStr.match(/^(?:async\s+)?(?:function\s*)?\s*\w*\s*\(([^)]*)\)/)

    const paramsStr = arrowMatch?.[1] || funcMatch?.[1] || ''

    if (!paramsStr.trim()) {
      return []
    }

    return paramsStr
      .split(',')
      .map((p) => {
        // Handle destructuring, default values, rest params
        const cleaned = p.trim()
          .replace(/\s*=\s*.*$/, '') // Remove default values
          .replace(/\.\.\.\s*/, '') // Remove rest operator
          .replace(/[{}[\]]/g, '') // Remove destructuring braces

        // Extract the first identifier
        const match = cleaned.match(/^\s*(\w+)/)
        return match?.[1] || ''
      })
      .filter((p) => p.length > 0)
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an RPC handler for a DO instance
 */
export function createRpcHandler(doInstance: unknown, config?: RPCServerConfig): RPCServer {
  return new RPCServer(doInstance, config)
}

/**
 * Handle an RPC request (HTTP)
 */
export async function handleRpcRequest(
  request: Request,
  doInstance: unknown,
  config?: RPCServerConfig
): Promise<Response> {
  const server = createRpcHandler(doInstance, config)
  return server.handleRpcRequest(request)
}

/**
 * Handle WebSocket RPC upgrade
 */
export function handleWebSocketRpc(
  doInstance: unknown,
  config?: RPCServerConfig
): Response {
  const server = createRpcHandler(doInstance, config)
  return server.handleWebSocketRpc()
}

// ============================================================================
// DO INTEGRATION MIXIN
// ============================================================================

/**
 * Interface for DO instances with RPC capabilities
 */
export interface WithRpcServer {
  rpcServer: RPCServer
  isRpcExposed(method: string): boolean
}

/**
 * Mixin to add RPC capabilities to a DO class
 *
 * Usage:
 * ```typescript
 * class MyDO extends withRpcServer(DO) {
 *   // RPC methods are automatically exposed
 *   getUser(id: string) { ... }
 * }
 * ```
 */
import type { DOConstructor } from './types'

export function withRpcServer<T extends DOConstructor>(
  Base: T,
  config?: RPCServerConfig
) {
  return class extends (Base as new (...args: any[]) => any) implements WithRpcServer {
    protected _rpcServer?: RPCServer

    get rpcServer(): RPCServer {
      if (!this._rpcServer) {
        this._rpcServer = new RPCServer(this, config)
      }
      return this._rpcServer
    }

    isRpcExposed(method: string): boolean {
      return this.rpcServer.isRpcExposed(method)
    }

    /**
     * Override fetch to handle /rpc endpoint
     */
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)

      // Handle /rpc endpoint
      if (url.pathname === '/rpc') {
        // Check for WebSocket upgrade
        const upgradeHeader = request.headers.get('upgrade')
        const connectionHeader = request.headers.get('connection')?.toLowerCase() || ''
        const hasConnectionUpgrade = connectionHeader.includes('upgrade')

        if (upgradeHeader?.toLowerCase() === 'websocket' && hasConnectionUpgrade) {
          return this.rpcServer.handleWebSocketRpc()
        }

        // HTTP RPC request
        if (request.method === 'POST') {
          return this.rpcServer.handleRpcRequest(request)
        }

        // GET request - return RPC info
        return Response.json({
          message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
          methods: this.rpcServer.methods,
        }, { headers: { 'Content-Type': 'application/json' } })
      }

      // Delegate to parent fetch
      return super.fetch(request)
    }
  }
}

/**
 * Apply RPC integration to an existing DO instance
 * This is useful when you can't use the mixin pattern
 */
export function applyRpcIntegration(doInstance: any, config?: RPCServerConfig): void {
  const rpcServer = new RPCServer(doInstance, config)

  // Add rpcServer property
  Object.defineProperty(doInstance, 'rpcServer', {
    get() {
      return rpcServer
    },
    enumerable: true,
    configurable: false,
  })

  // Add isRpcExposed method
  doInstance.isRpcExposed = (method: string) => rpcServer.isRpcExposed(method)

  // Wrap the existing fetch method
  const originalFetch = doInstance.fetch.bind(doInstance)
  doInstance.fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    // Handle /rpc endpoint
    if (url.pathname === '/rpc') {
      // Check for WebSocket upgrade
      const upgradeHeader = request.headers.get('upgrade')
      const connectionHeader = request.headers.get('connection')?.toLowerCase() || ''
      const hasConnectionUpgrade = connectionHeader.includes('upgrade')

      if (upgradeHeader?.toLowerCase() === 'websocket' && hasConnectionUpgrade) {
        return rpcServer.handleWebSocketRpc()
      }

      // HTTP RPC request
      if (request.method === 'POST') {
        return rpcServer.handleRpcRequest(request)
      }

      // GET request - return RPC info
      return Response.json({
        message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
        methods: rpcServer.methods,
      }, { headers: { 'Content-Type': 'application/json' } })
    }

    // Delegate to original fetch
    return originalFetch(request)
  }
}

export default RPCServer

// ============================================================================
// RPC HANDLER - TransportHandler Implementation
// ============================================================================

import type {
  TransportHandler,
  HandlerContext,
  CanHandleResult,
  HandlerOptions,
  DurableObjectState,
} from './handler'
import {
  buildJsonResponse,
  buildErrorResponse,
} from './shared'

/**
 * RPC Handler options
 */
export interface RpcHandlerOptions extends HandlerOptions {
  /** Path for RPC endpoint (default: /rpc) */
  path?: string
  /** Maximum pipeline depth */
  maxPipelineDepth?: number
  /** Methods to explicitly expose */
  exposedMethods?: string[]
  /** Methods to explicitly block */
  blockedMethods?: string[]
}

/**
 * Cache for RPC servers per DO instance
 */
const rpcServerCache = new WeakMap<object, RPCServer>()

/**
 * RPC Handler implementing TransportHandler interface
 *
 * Provides Cap'n Web RPC functionality:
 * - Promise pipelining
 * - JSON-RPC 2.0 support
 * - WebSocket streaming RPC
 * - Method discovery and invocation
 *
 * @example
 * ```typescript
 * const rpcHandler = new RpcHandler({
 *   path: '/rpc',
 *   maxPipelineDepth: 20,
 * })
 *
 * // Use in handler chain
 * chain.use(rpcHandler, 40)
 * ```
 */
export class RpcHandler implements TransportHandler {
  readonly name = 'rpc'
  private options: RpcHandlerOptions
  private server: RPCServer | null = null

  constructor(options: RpcHandlerOptions = {}) {
    this.options = {
      path: '/rpc',
      maxPipelineDepth: 20,
      ...options,
    }
  }

  /**
   * Check if this handler can process the request
   * RPC handler processes requests to the /rpc endpoint
   */
  canHandle(request: Request): CanHandleResult {
    const url = new URL(request.url)
    const rpcPath = this.options.path || '/rpc'

    // Check if request is to RPC endpoint
    if (url.pathname === rpcPath) {
      // RPC handler has medium-high priority
      return {
        canHandle: true,
        priority: 40,
      }
    }

    return { canHandle: false, reason: 'Path does not match RPC endpoint' }
  }

  /**
   * Handle the RPC request
   */
  async handle(request: Request, context: HandlerContext): Promise<Response> {
    // Get or create RPC server for this instance
    const server = this.getOrCreateServer(context.instance)

    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('upgrade')
    const connectionHeader = request.headers.get('connection')?.toLowerCase() || ''
    const hasConnectionUpgrade = connectionHeader.includes('upgrade')

    if (upgradeHeader?.toLowerCase() === 'websocket' && hasConnectionUpgrade) {
      return server.handleWebSocketRpc()
    }

    // Handle HTTP methods
    if (request.method === 'POST') {
      return server.handleRpcRequest(request)
    }

    if (request.method === 'GET') {
      // Return RPC info
      return buildJsonResponse({
        message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
        methods: server.methods,
      })
    }

    return buildErrorResponse(
      { message: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      405,
      { headers: { 'Allow': 'GET, POST' } }
    )
  }

  /**
   * Get or create RPC server for an instance
   */
  private getOrCreateServer(instance: Record<string, unknown>): RPCServer {
    // Check cache
    if (rpcServerCache.has(instance)) {
      return rpcServerCache.get(instance)!
    }

    // Create new server
    const server = new RPCServer(instance, {
      maxPipelineDepth: this.options.maxPipelineDepth,
      exposedMethods: this.options.exposedMethods,
      blockedMethods: this.options.blockedMethods,
    })

    rpcServerCache.set(instance, server)
    this.server = server

    return server
  }

  /**
   * Get current RPC server
   */
  getServer(): RPCServer | null {
    return this.server
  }

  /**
   * Clear server cache for an instance
   */
  static clearCache(instance: object): void {
    rpcServerCache.delete(instance)
  }

  /**
   * Dispose handler resources
   */
  dispose(): void {
    this.server = null
  }
}
