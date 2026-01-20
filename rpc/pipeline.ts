// Pipeline/Promise Pipelining - Cap'n Proto style
// Implements true promise pipelining where chained calls are batched into a single round trip
//
// Cap'n Proto Promise Pipelining:
// Instead of:
//   const user = await getUser(id)      // Round trip 1
//   const profile = await user.getProfile()  // Round trip 2
//
// Enable:
//   const profile = getUser(id).getProfile() // Single round trip
//
// The pipeline collects chained method calls and sends them all at once.
// The server resolves the chain and returns the final result.

import type { Transport, RPCMessage, RPCResponse } from './transport/types'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './client'
import { deserializeError } from './errors'

// ============================================================================
// Pipeline Types
// ============================================================================

/**
 * A pipeline step represents either an initial call or a chained operation
 */
export interface PipelineStep {
  /** Type of operation */
  type: 'call' | 'get' | 'pipe'
  /** Method name for 'call', property name for 'get' */
  name?: string
  /** Arguments for method calls */
  args?: unknown[]
  /** Transform function ID for 'pipe' (client-side only) */
  pipeId?: number
}

/**
 * Request format for batched pipeline execution
 */
export interface PipelineRequest {
  /** Initial method to call */
  method: string
  /** Arguments for initial method */
  args: unknown[]
  /** Chain of operations to apply to the result */
  pipeline: PipelineStep[]
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Response format for pipeline execution
 */
export interface PipelineResponse<T = unknown> {
  /** Final result after all pipeline steps */
  result?: T
  /** Error if any step failed */
  error?: {
    /** Index of the failed step (-1 for initial call) */
    stepIndex: number
    /** Error details */
    message: string
    code?: string
    details?: Record<string, unknown>
  }
  /** Correlation ID echoed back */
  correlationId?: string
}

// ============================================================================
// Simple Pipeline Promise (Client-side chaining)
// ============================================================================

/**
 * Enhanced Promise that supports chaining operations on future results
 * This version operates locally, chaining on resolved results
 */
export interface PipelinePromise<T> extends Promise<T> {
  /** Chain another transformation on the result */
  pipe<U>(fn: (result: T) => Promise<U> | U): PipelinePromise<U>

  /** Access a nested property of the result */
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>

  /** Call a method on the result */
  call<K extends keyof T>(
    method: K,
    ...args: T[K] extends (...args: infer A) => unknown ? A : never[]
  ): PipelinePromise<T[K] extends (...args: unknown[]) => infer R ? Awaited<R> : never>
}

/**
 * Create a simple pipeline promise that chains operations locally
 * This is useful for post-processing RPC results without additional round trips
 */
export function createPipeline<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipeline = promise as PipelinePromise<T>

  Object.defineProperty(pipeline, 'pipe', {
    value: <U>(fn: (result: T) => Promise<U> | U): PipelinePromise<U> => {
      return createPipeline(promise.then(fn))
    },
    enumerable: true
  })

  Object.defineProperty(pipeline, 'get', {
    value: <K extends keyof T>(key: K): PipelinePromise<T[K]> => {
      return createPipeline(promise.then(result => result[key]))
    },
    enumerable: true
  })

  Object.defineProperty(pipeline, 'call', {
    value: <K extends keyof T>(method: K, ...args: unknown[]): PipelinePromise<unknown> => {
      return createPipeline(promise.then(result => {
        const fn = result[method]
        if (typeof fn !== 'function') {
          throw new Error(`${String(method)} is not a function`)
        }
        // Cast to callable function type for proper invocation
        return (fn as (...callArgs: unknown[]) => unknown).apply(result, args)
      }))
    },
    enumerable: true
  })

  return pipeline
}

/**
 * Enhance a client with simple pipeline support
 * Wraps all methods to return PipelinePromise for local chaining
 */
export function withPipeline<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }
      const value = (target as Record<string, unknown>)[prop]
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const promise = (value as (...callArgs: unknown[]) => Promise<unknown>).apply(target, args)
          return createPipeline(promise)
        }
      }
      return value
    }
  })
}

// ============================================================================
// True Promise Pipelining (Server-side resolution)
// ============================================================================

/**
 * Pipeline builder that collects operations and executes them in a single round trip
 * This implements Cap'n Proto-style promise pipelining
 */
export class PipelineBuilder<T> implements PromiseLike<T> {
  private steps: PipelineStep[] = []
  private initialMethod: string
  private initialArgs: unknown[]
  private transport: Transport
  private baseUrl?: string
  private correlationId?: string
  private timeout: number
  private resolved: Promise<T> | null = null

  constructor(
    transport: Transport | string,
    method: string,
    args: unknown[],
    options?: { correlationId?: string; timeout?: number }
  ) {
    if (typeof transport === 'string') {
      this.baseUrl = transport
      this.transport = null as unknown as Transport // Will use fetch
    } else {
      this.transport = transport
    }
    this.initialMethod = method
    this.initialArgs = args
    if (options?.correlationId !== undefined) {
      this.correlationId = options.correlationId
    }
    this.timeout = options?.timeout ?? 30000
  }

  /**
   * Add a property access step to the pipeline
   */
  get<K extends keyof T>(key: K): PipelineBuilder<T[K]> {
    const next = this.clone<T[K]>()
    next.steps.push({ type: 'get', name: String(key) })
    return next
  }

  /**
   * Add a method call step to the pipeline
   */
  call<K extends keyof T, Args extends unknown[]>(
    method: K,
    ...args: Args
  ): PipelineBuilder<T[K] extends (...a: Args) => infer R ? Awaited<R> : never> {
    const next = this.clone<T[K] extends (...a: Args) => infer R ? Awaited<R> : never>()
    next.steps.push({ type: 'call', name: String(method), args })
    return next
  }

  /**
   * Create a clone of this builder with the current state
   */
  private clone<U>(): PipelineBuilder<U> {
    const options: { correlationId?: string; timeout?: number } = { timeout: this.timeout }
    if (this.correlationId !== undefined) {
      options.correlationId = this.correlationId
    }
    const clone = new PipelineBuilder<U>(
      this.transport || this.baseUrl!,
      this.initialMethod,
      this.initialArgs,
      options
    )
    clone.steps = [...this.steps]
    return clone
  }

  /**
   * Execute the pipeline and get the result
   * Implements PromiseLike for await support
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    if (!this.resolved) {
      this.resolved = this.execute()
    }
    return this.resolved.then(onfulfilled, onrejected)
  }

  /**
   * Execute the pipeline request
   */
  private async execute(): Promise<T> {
    const correlationId = this.correlationId || generateCorrelationId()

    if (this.transport) {
      // Use transport for pipeline request
      const message: RPCMessage & { pipeline?: PipelineStep[] } = {
        method: this.initialMethod,
        args: this.initialArgs,
        correlationId,
      }

      // If we have pipeline steps, use the pipeline endpoint
      if (this.steps.length > 0) {
        const pipelineRequest: PipelineRequest = {
          method: this.initialMethod,
          args: this.initialArgs,
          pipeline: this.steps,
          correlationId,
        }

        // Send as a special pipeline message
        const response = await this.transport.send<T>({
          method: '__pipeline__',
          args: [pipelineRequest],
          correlationId,
        })

        if (response.error) {
          throw deserializeError(response.error)
        }

        return response.result as T
      }

      // No pipeline steps, just a regular call
      const response = await this.transport.send<T>(message)
      if (response.error) {
        throw deserializeError(response.error)
      }
      return response.result as T
    }

    // Fallback to fetch-based pipeline
    const pipelineRequest: PipelineRequest = {
      method: this.initialMethod,
      args: this.initialArgs,
      pipeline: this.steps,
      correlationId,
    }

    const response = await fetch(`${this.baseUrl}/rpc/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
      },
      body: JSON.stringify(pipelineRequest),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string }
      throw new Error(errorBody.message ?? `Pipeline error: ${response.status}`)
    }

    const result = await response.json() as PipelineResponse<T>
    if (result.error) {
      throw new Error(`Pipeline step ${result.error.stepIndex} failed: ${result.error.message}`)
    }

    return result.result as T
  }
}

// ============================================================================
// Pipeline Client Factory
// ============================================================================

/**
 * Options for creating a pipelining client
 */
export interface PipelineClientOptions {
  /** Base URL for fetch-based transport */
  url?: string
  /** Transport instance */
  transport?: Transport
  /** Request timeout in milliseconds */
  timeout?: number
  /** Correlation ID for request tracing */
  correlationId?: string
}

/**
 * Create a pipelining client that enables Cap'n Proto-style promise pipelining
 *
 * @example
 * ```typescript
 * interface UserAPI {
 *   getUser(id: string): Promise<User>
 *   users: {
 *     profile: {
 *       get(id: string): Promise<Profile>
 *     }
 *   }
 * }
 *
 * interface User {
 *   getProfile(): Promise<Profile>
 *   getOrders(): Promise<Order[]>
 * }
 *
 * const client = createPipelineClient<UserAPI>({ url: 'https://api.example.com' })
 *
 * // Traditional approach (2 round trips):
 * const user = await client.getUser('123')
 * const profile = await user.getProfile()
 *
 * // With pipelining (1 round trip):
 * const profile = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *
 * // Even deeper nesting:
 * const avatar = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *   .get('avatar')
 *   .get('url')
 * ```
 */
export function createPipelineClient<T extends object>(options: PipelineClientOptions): T & {
  /**
   * Start a pipeline from a method call
   * @param method - Method name to call
   * @param args - Arguments for the method
   * @returns PipelineBuilder for chaining
   */
  pipeline<K extends keyof T>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never[]
  ): PipelineBuilder<T[K] extends (...a: unknown[]) => infer R ? Awaited<R> : never>

  /**
   * Start a pipeline from a nested method path (e.g., 'users.profile.get')
   * @param methodPath - Dot-separated method path
   * @param args - Arguments for the method
   * @returns PipelineBuilder for chaining
   */
  pipelineFrom<R>(methodPath: string, ...args: unknown[]): PipelineBuilder<R>
} {
  const { url, transport, timeout = 30000, correlationId } = options

  const proxy = new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Build options object with only defined values
      const buildOptions = (): { correlationId?: string; timeout?: number } => {
        const opts: { correlationId?: string; timeout?: number } = { timeout }
        if (correlationId !== undefined) {
          opts.correlationId = correlationId
        }
        return opts
      }

      // Special pipeline method
      if (prop === 'pipeline') {
        return <K extends keyof T>(method: K, ...args: unknown[]) => {
          return new PipelineBuilder(
            transport || url!,
            String(method),
            args,
            buildOptions()
          )
        }
      }

      // pipelineFrom for nested paths
      if (prop === 'pipelineFrom') {
        return <R>(methodPath: string, ...args: unknown[]) => {
          return new PipelineBuilder<R>(
            transport || url!,
            methodPath,
            args,
            buildOptions()
          )
        }
      }

      // Regular method access - returns a function that creates a pipeline
      return (...args: unknown[]) => {
        return new PipelineBuilder(
          transport || url!,
          String(prop),
          args,
          buildOptions()
        )
      }
    }
  })

  return proxy as T & {
    pipeline<K extends keyof T>(
      method: K,
      ...args: T[K] extends (...a: infer A) => unknown ? A : never[]
    ): PipelineBuilder<T[K] extends (...a: unknown[]) => infer R ? Awaited<R> : never>
    pipelineFrom<R>(methodPath: string, ...args: unknown[]): PipelineBuilder<R>
  }
}

// ============================================================================
// Server-side Pipeline Executor
// ============================================================================

/**
 * Options for pipeline execution
 */
export interface PipelineExecutorOptions {
  /** Maximum pipeline depth (default: 10) */
  maxDepth?: number
  /** Timeout for entire pipeline execution in ms (default: 30000) */
  timeout?: number
}

/**
 * Execute a pipeline request on the server
 *
 * This function takes a pipeline request and executes all steps,
 * returning the final result or an error indicating which step failed.
 *
 * @param target - The object containing methods to call
 * @param request - The pipeline request
 * @param options - Execution options
 * @returns The pipeline response
 *
 * @example
 * ```typescript
 * // In your RPC server
 * app.post('/rpc/pipeline', async (c) => {
 *   const request = await c.req.json<PipelineRequest>()
 *   const response = await executePipeline(myTarget, request)
 *   return c.json(response)
 * })
 * ```
 */
export async function executePipeline<T>(
  target: object,
  request: PipelineRequest,
  options: PipelineExecutorOptions = {}
): Promise<PipelineResponse<T>> {
  const { maxDepth = 10, timeout = 30000 } = options
  const { method, args, pipeline, correlationId } = request

  // Validate pipeline depth
  if (pipeline.length > maxDepth) {
    const response: PipelineResponse<T> = {
      error: {
        stepIndex: -1,
        message: `Pipeline exceeds maximum depth of ${maxDepth}`,
        code: 'PIPELINE_TOO_DEEP',
      },
    }
    if (correlationId !== undefined) {
      response.correlationId = correlationId
    }
    return response
  }

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Pipeline execution timed out after ${timeout}ms`))
    }, timeout)
  })

  try {
    // Execute with timeout
    const result = await Promise.race([
      executeSteps(target, method, args, pipeline),
      timeoutPromise,
    ])

    const response: PipelineResponse<T> = { result: result as T }
    if (correlationId !== undefined) {
      response.correlationId = correlationId
    }
    return response
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    // Check if it's a step error with index
    if ('stepIndex' in err) {
      const errWithCode = err as Error & { stepIndex: number; code?: string }
      const errorObj: PipelineResponse<T>['error'] = {
        stepIndex: errWithCode.stepIndex,
        message: err.message,
      }
      if (errWithCode.code !== undefined) {
        errorObj.code = errWithCode.code
      }
      const response: PipelineResponse<T> = { error: errorObj }
      if (correlationId !== undefined) {
        response.correlationId = correlationId
      }
      return response
    }

    const response: PipelineResponse<T> = {
      error: {
        stepIndex: -1,
        message: err.message,
        code: 'INTERNAL_ERROR',
      },
    }
    if (correlationId !== undefined) {
      response.correlationId = correlationId
    }
    return response
  }
}

/**
 * Execute pipeline steps sequentially
 */
async function executeSteps(
  target: object,
  method: string,
  args: unknown[],
  steps: PipelineStep[]
): Promise<unknown> {
  // Execute initial method
  const methodParts = method.split('.')
  let current: unknown = target

  // Navigate to the method
  for (let i = 0; i < methodParts.length - 1; i++) {
    const part = methodParts[i]
    if (!current || typeof current !== 'object') {
      const error = new Error(`Cannot access ${part} on ${typeof current}`) as Error & { stepIndex: number }
      error.stepIndex = -1
      throw error
    }
    current = (current as Record<string, unknown>)[part]
  }

  // Get and execute the final method
  const methodName = methodParts[methodParts.length - 1]
  if (!current || typeof current !== 'object') {
    const error = new Error(`Method ${method} not found`) as Error & { stepIndex: number }
    error.stepIndex = -1
    throw error
  }

  const fn = (current as Record<string, unknown>)[methodName]
  if (typeof fn !== 'function') {
    const error = new Error(`${method} is not a function`) as Error & { stepIndex: number }
    error.stepIndex = -1
    throw error
  }

  // Execute initial call
  let result = await (fn as (...a: unknown[]) => unknown).apply(current, args)

  // Execute pipeline steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step) continue

    try {
      switch (step.type) {
        case 'get': {
          if (result === null || result === undefined) {
            const error = new Error(`Cannot read property '${step.name ?? 'unknown'}' of ${result}`) as Error & { stepIndex: number }
            error.stepIndex = i
            throw error
          }
          const propName = step.name
          if (propName === undefined) {
            const error = new Error('Get step missing property name') as Error & { stepIndex: number }
            error.stepIndex = i
            throw error
          }
          result = (result as Record<string, unknown>)[propName]
          break
        }

        case 'call': {
          if (result === null || result === undefined) {
            const error = new Error(`Cannot call method '${step.name ?? 'unknown'}' on ${result}`) as Error & { stepIndex: number }
            error.stepIndex = i
            throw error
          }
          const methodName = step.name
          if (methodName === undefined) {
            const error = new Error('Call step missing method name') as Error & { stepIndex: number }
            error.stepIndex = i
            throw error
          }
          const methodFn = (result as Record<string, unknown>)[methodName]
          if (typeof methodFn !== 'function') {
            const error = new Error(`${methodName} is not a function`) as Error & { stepIndex: number }
            error.stepIndex = i
            throw error
          }
          result = await (methodFn as (...a: unknown[]) => unknown).apply(result, step.args ?? [])
          break
        }

        case 'pipe': {
          // Pipe operations are client-side only
          const error = new Error('Pipe operations must be resolved client-side') as Error & { stepIndex: number }
          error.stepIndex = i
          throw error
        }
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'stepIndex' in err) {
        throw err
      }
      const error = err instanceof Error ? err : new Error(String(err))
      const wrappedError = error as Error & { stepIndex: number }
      wrappedError.stepIndex = i
      throw wrappedError
    }
  }

  return result
}

/**
 * Create a handler for pipeline requests in Hono
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createPipelineHandler } from '@dotdo/rpc'
 *
 * const app = new Hono()
 * const myAPI = { ... }
 *
 * app.post('/rpc/pipeline', createPipelineHandler(myAPI))
 * ```
 */
export function createPipelineHandler(target: object, options?: PipelineExecutorOptions) {
  return async (c: { req: { json: <T>() => Promise<T> }; json: (data: unknown, status?: number) => Response; header: (name: string, value: string) => void }) => {
    const request = await c.req.json<PipelineRequest>()
    const correlationId = request.correlationId || generateCorrelationId()

    c.header(CORRELATION_ID_HEADER, correlationId)

    const response = await executePipeline(target, { ...request, correlationId }, options)

    if (response.error) {
      return c.json(response, 500)
    }

    return c.json(response)
  }
}

// ============================================================================
// Integration with existing RPC server
// ============================================================================

/**
 * Middleware to add pipeline support to an existing RPC server
 *
 * This registers the __pipeline__ method that the PipelineBuilder uses
 *
 * @param target - The target object with methods
 * @param options - Pipeline execution options
 */
export function withPipelineSupport<T extends object>(
  target: T,
  options?: PipelineExecutorOptions
): T & { __pipeline__: (request: PipelineRequest) => Promise<PipelineResponse> } {
  return {
    ...target,
    async __pipeline__(request: PipelineRequest): Promise<PipelineResponse> {
      return executePipeline(target, request, options)
    },
  }
}
