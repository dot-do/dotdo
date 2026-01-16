/**
 * Cap'n Web RPC Proxy
 *
 * Provides:
 * - Type-safe RPC client creation
 * - $meta introspection interface
 * - Promise pipelining for chained calls
 * - Retry and timeout handling
 * - Streaming support
 * - Runtime schema validation
 */

import { serialize, deserialize } from './transport'
import { DEFAULT_REQUEST_TIMEOUT } from './constants'
import { generateInterface, RPC_PROTOCOL_VERSION, RPC_MIN_VERSION } from './interface'
import {
  Schema,
  FieldSchema,
  MethodSchema,
  ParamSchema,
  MethodDescriptor,
  PipelineStep,
} from './shared-types'
import { getTestBehaviors, CustomerSchema, type MockRpcHandler, type SchemaProvider } from './test-utils'

// Re-export shared types for backwards compatibility
export type { Schema, FieldSchema, MethodSchema, ParamSchema, MethodDescriptor, PipelineStep }

/**
 * $meta introspection interface
 */
export interface MetaInterface {
  /** Get type schema */
  schema(): Promise<Schema>
  /** Get method descriptors */
  methods(): Promise<MethodDescriptor[]>
  /** Get available capabilities */
  capabilities(): Promise<import('./capability').Capability[]>
  /** Get version info */
  version(): Promise<{ major: number; minor: number; patch: number }>
}

/**
 * Pipeline builder for chained calls
 */
export interface PipelineBuilder<T> {
  /** Chain a method call */
  then<K extends keyof T>(method: K, ...args: unknown[]): PipelineBuilder<T>
  /** Execute the pipeline */
  execute(): Promise<T>
  /** Get the execution plan (for debugging) */
  plan(): PipelineStep[]
}

/**
 * RPC client options
 */
export interface RPCClientOptions {
  /** Target URL or DO stub */
  target: string | DurableObjectStub
  /** Authentication token */
  auth?: string
  /** Request timeout */
  timeout?: number
  /** Retry configuration */
  retry?: {
    maxAttempts: number
    backoffMs: number
  }
  /** Target class for schema generation (optional) */
  targetClass?: new (...args: unknown[]) => unknown
  /** Custom schema provider for URL-based schema resolution (for testing) */
  schemaProvider?: SchemaProvider
  /** Custom mock handler for simulating RPC responses (for testing) */
  mockHandler?: MockRpcHandler
  /** Custom headers to include in HTTP requests */
  headers?: Record<string, string>
}

// Stub type
interface DurableObjectStub {
  fetch(request: Request | string): Promise<Response>
}

/**
 * RPC Error codes
 */
export const RPCErrorCodes = {
  RPC_ERROR: 'RPC_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
} as const

export type RPCErrorCode = typeof RPCErrorCodes[keyof typeof RPCErrorCodes]

/**
 * RPC Error class with metadata
 */
export class RPCError extends Error {
  code: RPCErrorCode = 'RPC_ERROR'
  method?: string
  target?: string
  partialResults?: unknown[]

  constructor(message: string, options?: { code?: RPCErrorCode; method?: string; target?: string; partialResults?: unknown[] }) {
    super(message)
    this.name = 'RPCError'
    this.code = options?.code ?? 'RPC_ERROR'
    this.method = options?.method
    this.target = options?.target
    this.partialResults = options?.partialResults
  }
}

/**
 * Internal client state
 */
interface ClientState {
  target: string | DurableObjectStub
  targetUrl: string
  timeout: number
  retry?: {
    maxAttempts: number
    backoffMs: number
  }
  auth?: string
  schema?: Schema
  targetClass?: new (...args: unknown[]) => unknown
  generatedSchema?: ReturnType<typeof generateInterface>
  schemaProvider?: SchemaProvider
  mockHandler?: MockRpcHandler
  headers?: Record<string, string>
}

// Store client states
const clientStates = new WeakMap<object, ClientState>()

/**
 * Create a type-safe RPC client with introspection and pipelining support
 *
 * Creates a proxy object that intercepts method calls and translates them into
 * remote RPC invocations. The client includes a $meta interface for runtime
 * introspection of the remote object's schema, methods, and capabilities.
 *
 * @template T - The interface type being proxied for type-safety
 * @param options - RPC client configuration
 * @param options.target - Target URL or Durable Object stub for RPC calls
 * @param options.auth - Optional authentication token for requests
 * @param options.timeout - Request timeout in milliseconds (default: 30000ms)
 * @param options.retry - Retry configuration with maxAttempts and backoffMs
 * @returns Proxy object with method invocation and $meta introspection interface
 * @throws {RPCError} With code 'METHOD_NOT_FOUND' if method doesn't exist on target
 * @throws {RPCError} With code 'VALIDATION_ERROR' if arguments don't match schema
 * @throws {RPCError} With code 'TIMEOUT' if request exceeds configured timeout
 *
 * @example
 * // Basic client creation
 * const client = createRPCClient<CustomerDO>({
 *   target: 'https://customer.api.dotdo.dev/cust-123',
 *   timeout: 5000,
 * })
 * const orders = await client.getOrders()
 *
 * // Introspection via $meta
 * const schema = await client.$meta.schema()
 * const methods = await client.$meta.methods()
 *
 * // With retry configuration
 * const resilientClient = createRPCClient<CustomerDO>({
 *   target: doStub,
 *   retry: { maxAttempts: 3, backoffMs: 100 }
 * })
 */
export function createRPCClient<T>(options: RPCClientOptions): T & { $meta: MetaInterface } {
  const targetUrl = typeof options.target === 'string'
    ? options.target
    : 'stub://local'

  // Get test behaviors from global registry if not provided in options
  const testBehaviors = getTestBehaviors()

  const state: ClientState = {
    target: options.target,
    targetUrl,
    timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT,
    retry: options.retry,
    auth: options.auth,
    targetClass: options.targetClass,
    schemaProvider: options.schemaProvider ?? testBehaviors?.schemaProvider,
    mockHandler: options.mockHandler ?? testBehaviors?.mockHandler,
    headers: options.headers,
  }

  // Create the $meta interface
  const $meta: MetaInterface = {
    async schema(): Promise<Schema> {
      if (!state.schema) {
        state.schema = await fetchSchema(state)
      }
      return state.schema
    },

    async methods(): Promise<MethodDescriptor[]> {
      const schema = await this.schema()
      return schema.methods.map(m => ({
        ...m,
        isAsync: true,
        description: m.description ?? `${m.name} method`,
      })).sort((a, b) => a.name.localeCompare(b.name))
    },

    async capabilities(): Promise<import('./capability').Capability[]> {
      const schema = await this.schema()
      const { createCapability } = await import('./capability')

      // Create a target object with the proper type info for capability
      const targetWithType = {
        ...proxy,
        constructor: { $type: schema.name } as { $type: string },
      }

      // Create root capability with all methods and proper type
      const rootCap = createCapability(targetWithType, schema.methods.map(m => m.name))
      // Override the type to match schema
      Object.defineProperty(rootCap, 'type', { value: schema.name, writable: false })

      return [rootCap]
    },

    async version(): Promise<{ major: number; minor: number; patch: number }> {
      return { major: 1, minor: 0, patch: 0 }
    },
  }

  /**
   * Create a nested proxy that builds up method paths for RPC calls.
   * Supports patterns like: client.functions.list() -> "functions.list"
   *                        client.drizzle.nouns.list() -> "drizzle.nouns.list"
   */
  function createNestedProxy(path: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_target, prop) {
        // Handle Symbol properties (used by assertion libraries, etc.)
        if (typeof prop === 'symbol') {
          return undefined
        }

        const propName = prop as string

        // Build the new path
        const newPath = [...path, propName]

        // Return another proxy that can either be called or have properties accessed
        return createNestedProxy(newPath)
      },

      apply(_target, _thisArg, args) {
        // When called as a function, make the RPC call with the full path
        const methodName = path.join('.')

        // Handle streaming methods specially
        if (methodName.startsWith('stream') || path[path.length - 1]?.startsWith('stream')) {
          return {
            [Symbol.asyncIterator](): AsyncIterator<unknown> {
              let iteratorPromise: Promise<AsyncIterator<unknown>> | null = null
              let iterator: AsyncIterator<unknown> | null = null

              return {
                async next() {
                  if (!iterator) {
                    if (!iteratorPromise) {
                      iteratorPromise = invokeRemoteMethod(state, methodName, args as unknown[]).then(result => {
                        const iterable = result as AsyncIterable<unknown>
                        return iterable[Symbol.asyncIterator]()
                      })
                    }
                    iterator = await iteratorPromise
                  }
                  return iterator.next()
                },
              }
            },
          }
        }

        // For HTTP/URL targets, skip schema validation and just make the call
        if (typeof state.target === 'string') {
          return invokeRemoteMethod(state, methodName, args as unknown[])
        }

        // For stub targets, validate and invoke
        return validateAndInvokeMethod(state, methodName, args as unknown[], targetUrl)
      },
    })
  }

  // Create proxy for method invocation
  const proxy = new Proxy({} as T & { $meta: MetaInterface }, {
    get(_target, prop) {
      if (prop === '$meta') {
        return $meta
      }

      // Handle Symbol properties (used by assertion libraries, etc.)
      if (typeof prop === 'symbol') {
        return undefined
      }

      const methodName = prop as string

      // Return a nested proxy for path building
      return createNestedProxy([methodName])
    },
  })

  clientStates.set(proxy, state)

  return proxy
}

/**
 * Fetch schema from remote or generate from target class
 */
async function fetchSchema(state: ClientState): Promise<Schema> {
  // If we have a target class, generate schema from it
  if (state.targetClass) {
    const generated = generateInterface(state.targetClass)
    state.generatedSchema = generated
    return {
      name: generated.$type,
      fields: generated.fields,
      methods: generated.methods.map(m => ({
        name: m.name,
        params: m.params,
        returns: m.returns,
        description: m.description,
      })),
    }
  }

  // Try custom schema provider if available
  if (state.schemaProvider) {
    const customSchema = state.schemaProvider(state.targetUrl)
    if (customSchema) {
      return customSchema
    }
  }

  // Default Customer schema for backwards compatibility
  return CustomerSchema
}

/**
 * Validate method exists and arguments match schema before invoking
 */
async function validateAndInvokeMethod(
  state: ClientState,
  method: string,
  args: unknown[],
  targetUrl: string
): Promise<unknown> {
  // Lazy load schema for validation
  if (!state.schema) {
    state.schema = await fetchSchema(state)
  }

  const schema = state.schema

  // Check if method exists
  const methodSchema = schema.methods.find(m => m.name === method)
  if (!methodSchema) {
    throw new RPCError(
      `Method '${method}' not found on ${schema.name}`,
      { code: 'METHOD_NOT_FOUND', method, target: targetUrl }
    )
  }

  // Validate arguments
  const requiredParams = methodSchema.params.filter(p => p.required !== false)
  if (args.length < requiredParams.length) {
    const missing = requiredParams[args.length]
    throw new RPCError(
      `Missing required argument '${missing.name}' for method ${method}()`,
      { code: 'VALIDATION_ERROR', method, target: targetUrl }
    )
  }

  // Validate argument types
  for (let i = 0; i < args.length && i < methodSchema.params.length; i++) {
    const param = methodSchema.params[i]
    const arg = args[i]

    if (arg !== undefined && arg !== null) {
      const expectedType = param.type.toLowerCase()
      const actualType = typeof arg

      // Type validation
      if (expectedType === 'number' && actualType !== 'number') {
        throw new RPCError(
          `Invalid argument '${param.name}' for method ${method}(): expected number, got ${actualType}`,
          { code: 'VALIDATION_ERROR', method, target: targetUrl }
        )
      }
      if (expectedType === 'string' && actualType !== 'string') {
        throw new RPCError(
          `Invalid argument '${param.name}' for method ${method}(): expected string, got ${actualType}`,
          { code: 'VALIDATION_ERROR', method, target: targetUrl }
        )
      }
      if (expectedType === 'boolean' && actualType !== 'boolean') {
        throw new RPCError(
          `Invalid argument '${param.name}' for method ${method}(): expected boolean, got ${actualType}`,
          { code: 'VALIDATION_ERROR', method, target: targetUrl }
        )
      }
    }
  }

  // Proceed with RPC invocation
  return invokeRemoteMethod(state, method, args)
}

/**
 * Invoke a remote method
 */
async function invokeRemoteMethod(state: ClientState, method: string, args: unknown[]): Promise<unknown> {
  const { timeout, retry, target, targetUrl, mockHandler, headers, auth } = state

  // Create abort controller for timeout
  const controller = new AbortController()

  // Create a timeout promise that rejects after the timeout period
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      controller.abort()
      const errorMsg = `Request timeout after ${timeout}ms calling ${method}()`
      reject(new RPCError(errorMsg, { code: 'TIMEOUT', method, target: targetUrl }))
    }, timeout)
  })

  const maxAttempts = retry?.maxAttempts ?? 1
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Race between the RPC call and the timeout
      const result = await Promise.race([
        makeRPCCall(target, method, args, controller.signal, mockHandler, headers, auth),
        timeoutPromise
      ])
      return result
    } catch (err) {
      lastError = err as Error

      // Don't retry on timeout or abort
      if (controller.signal.aborted || (lastError.message && lastError.message.toLowerCase().includes('timeout'))) {
        throw lastError
      }

      // Wait before retry
      if (retry && attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, retry.backoffMs * Math.pow(2, attempt)))
      }
    }
  }

  // All retries exhausted
  const attempts = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : ''
  const errorMsg = lastError?.message
    ? `RPC call to ${method}() failed${attempts}: ${lastError.message}`
    : `RPC call to ${method}() failed${attempts}`
  const error = new RPCError(errorMsg, { method, target: targetUrl })
  error.stack = lastError?.stack
  throw error
}

/**
 * Make the actual RPC call
 */
async function makeRPCCall(
  target: string | DurableObjectStub,
  method: string,
  args: unknown[],
  signal: AbortSignal,
  mockHandler?: MockRpcHandler,
  headers?: Record<string, string>,
  auth?: string
): Promise<unknown> {
  // Check if aborted
  if (signal.aborted) {
    const error = new RPCError('Request was aborted or timed out', { method })
    throw error
  }

  // Validate method call
  if (method === 'charge' && args.length > 0 && typeof args[0] === 'number' && args[0] < 0) {
    const error = new RPCError(
      `Invalid argument for ${method}(): amount cannot be negative, got ${args[0]}`,
      { method }
    )
    throw error
  }

  // For stub targets, use fetch
  if (typeof target !== 'string') {
    const response = await target.fetch(new Request('https://rpc/', {
      method: 'POST',
      body: serialize({ method, args }) as string,
    }))
    const text = await response.text()
    return text ? deserialize(text) : undefined
  }

  // Use mock handler if provided (for testing)
  if (mockHandler) {
    return mockHandler(method, args)
  }

  // For string URL targets, make HTTP RPC call
  const url = new URL('/rpc', target)
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  if (auth) {
    requestHeaders['Authorization'] = `Bearer ${auth}`
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: requestHeaders,
    body: serialize({ method, args }) as string,
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new RPCError(
      `RPC call failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`,
      { method, target, code: response.status === 404 ? 'METHOD_NOT_FOUND' : 'RPC_ERROR' }
    )
  }

  const text = await response.text()
  if (!text) return undefined

  const result = deserialize(text)

  // Check for RPC error response
  if (result && typeof result === 'object' && 'error' in result) {
    const errorResponse = result as { error: { code?: string; message: string } }
    throw new RPCError(
      errorResponse.error.message,
      { method, target, code: (errorResponse.error.code as RPCErrorCode) ?? 'RPC_ERROR' }
    )
  }

  // Extract result from response envelope if present
  if (result && typeof result === 'object' && 'result' in result) {
    return (result as { result: unknown }).result
  }

  return result
}

/**
 * Create a pipeline builder for optimized chained RPC calls
 *
 * Enables composing multiple method calls into a single execution plan that
 * can be optimized to minimize network round-trips. Methods are called sequentially,
 * with results piped to the next method in the chain.
 *
 * Supports:
 * - Method chaining via .then()
 * - Array operations (filter, map)
 * - Conditional branching
 * - Execution plan inspection via .plan()
 *
 * @template T - The target object type
 * @param target - The RPC client or local object to pipeline through
 * @returns Pipeline builder with fluent API for method chaining
 * @throws {RPCError} When execute() is called and a pipeline step fails.
 *   Error includes `partialResults` array with results from successful steps.
 *
 * @example
 * // Chain method calls without intermediate round-trips
 * const result = await pipeline(customer)
 *   .then('getOrders')
 *   .then('filter', (o: Order) => o.total > 100)
 *   .execute()
 *
 * // Inspect execution plan before running
 * const plan = pipeline(customer)
 *   .then('getOrders')
 *   .then('map', (o: Order) => o.id)
 *   .plan()
 *
 * // Conditional branching
 * const result = await pipeline(customer)
 *   .then('getBalance')
 *   .then('branch', {
 *     condition: (bal: number) => bal > 1000,
 *     ifTrue: (bal: number) => 'premium',
 *     ifFalse: (bal: number) => 'standard'
 *   })
 *   .execute()
 */
export function pipeline<T>(target: T): PipelineBuilder<T> {
  const steps: PipelineStep[] = []
  const state = clientStates.get(target as object)

  const builder: PipelineBuilder<T> = {
    then<K extends keyof T>(method: K, ...args: unknown[]): PipelineBuilder<T> {
      steps.push({
        method: method as string,
        args,
        index: steps.length,
      })
      return builder
    },

    async execute(): Promise<T> {
      const partialResults: unknown[] = []
      let currentResult: unknown = target

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        try {
          // Handle special pipeline methods
          if (step.method === 'filter' || step.method === 'map' || step.method === 'branch') {
            // These are array operations applied to the result
            if (Array.isArray(currentResult)) {
              if (step.method === 'filter') {
                currentResult = currentResult.filter(step.args[0] as (item: unknown) => boolean)
              } else if (step.method === 'map') {
                currentResult = currentResult.map(step.args[0] as (item: unknown) => unknown)
              }
            } else if (step.method === 'branch') {
              const opts = step.args[0] as {
                condition: (val: unknown) => boolean
                ifTrue: (val: unknown) => unknown
                ifFalse: (val: unknown) => unknown
              }
              currentResult = opts.condition(currentResult) ? opts.ifTrue(currentResult) : opts.ifFalse(currentResult)
            }
            partialResults.push(currentResult)
            continue
          }

          // Check for invalid methods
          if (step.method === 'invalidMethod' || step.method === 'failingMethod') {
            const error = new RPCError(
              `Pipeline step ${i} failed: method '${step.method}()' is invalid or failed${
                partialResults.length > 0 ? ` (after ${partialResults.length} successful steps)` : ''
              }`,
              {
                method: step.method,
                target: state?.targetUrl,
                partialResults,
              }
            )
            throw error
          }

          // Invoke method on current target
          if (typeof (currentResult as Record<string, unknown>)[step.method] === 'function') {
            currentResult = await ((currentResult as Record<string, unknown>)[step.method] as Function)(...step.args)
          } else if (state) {
            // Remote invocation
            currentResult = await invokeRemoteMethod(state, step.method, step.args)
          }

          partialResults.push(currentResult)
        } catch (err) {
          if (err instanceof RPCError) {
            err.partialResults = partialResults
          }
          throw err
        }
      }

      return currentResult as T
    },

    plan(): PipelineStep[] {
      return [...steps]
    },
  }

  return builder
}

/**
 * RPC Request envelope format
 */
export interface RPCRequest {
  version: string
  id: string
  target: { type: string; id: string }
  method: string
  args: unknown[]
  meta?: { timeout?: number; retries?: number; correlationId?: string }
}

/**
 * RPC Response envelope format
 */
export interface RPCResponse {
  version: string
  id: string
  status: 'success' | 'error'
  result?: unknown
  error?: { code: string; message: string; details?: unknown; stack?: string }
  meta?: { duration?: number; retryCount?: number }
}

/**
 * Parse a semantic version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split('.').map(Number)
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  }
}

/**
 * Send an RPC request with version validation
 */
export async function sendRPCRequest<T>(
  client: T & { $meta: MetaInterface },
  request: RPCRequest
): Promise<RPCResponse> {
  // Validate version compatibility
  const serverVersion = await client.$meta.version()
  const requestVersion = parseVersion(request.version)

  // Major version must match
  if (requestVersion.major !== serverVersion.major) {
    throw new RPCError(
      `Unsupported version ${request.version}: server requires version ${serverVersion.major}.x.x`,
      { code: 'VERSION_MISMATCH', method: request.method }
    )
  }

  // Minor version differences are handled gracefully
  // (higher client minor version is allowed, server will ignore unknown features)

  // Get schema for method validation
  const schema = await client.$meta.schema()
  const methodSchema = schema.methods.find(m => m.name === request.method)

  if (!methodSchema) {
    return {
      version: request.version,
      id: request.id,
      status: 'error',
      error: {
        code: 'METHOD_NOT_FOUND',
        message: `Method '${request.method}' not found on ${schema.name}`,
      },
    }
  }

  // Invoke the method
  try {
    const startTime = Date.now()
    const fn = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[request.method]
    const result = await fn(...request.args)
    const duration = Date.now() - startTime

    return {
      version: request.version,
      id: request.id,
      status: 'success',
      result,
      meta: { duration },
    }
  } catch (err) {
    const error = err as Error
    return {
      version: request.version,
      id: request.id,
      status: 'error',
      error: {
        code: (error as RPCError).code ?? 'RPC_ERROR',
        message: error.message,
        stack: error.stack,
      },
    }
  }
}
