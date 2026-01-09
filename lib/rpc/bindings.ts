/**
 * RPC Binding Architecture for Capability Modules
 *
 * Provides type-safe RPC bindings for Cloudflare Workers service bindings,
 * allowing heavy tools (jq, npm resolution, AI) to run as separate Workers
 * instead of bloating the core bundle.
 *
 * Key Features:
 * - Type-safe RPC calls with request/response types
 * - Auto-detection of binding availability with fallback support
 * - Error handling with automatic retries
 * - Streaming response support
 * - Cloudflare Worker service bindings pattern
 *
 * @module lib/rpc/bindings
 */

// ============================================================================
// Types
// ============================================================================

/**
 * RPC request envelope
 */
export interface RPCRequest<T = unknown> {
  /** Unique request ID for correlation */
  id: string
  /** Method name to invoke */
  method: string
  /** Method parameters */
  params: T
  /** Optional timeout in milliseconds */
  timeout?: number
  /** Optional metadata for tracing */
  meta?: Record<string, unknown>
}

/**
 * RPC response envelope
 */
export interface RPCResponse<T = unknown> {
  /** Request ID for correlation */
  id: string
  /** Result data on success */
  result?: T
  /** Error details on failure */
  error?: RPCError
  /** Response metadata */
  meta?: Record<string, unknown>
}

/**
 * RPC error structure
 */
export interface RPCError {
  /** Error code (string for domain errors, number for JSON-RPC) */
  code: string | number
  /** Human-readable error message */
  message: string
  /** Optional error data for debugging */
  data?: unknown
  /** Whether the error is retryable */
  retryable?: boolean
}

/**
 * Streaming RPC response chunk
 */
export interface RPCStreamChunk<T = unknown> {
  /** Chunk sequence number */
  seq: number
  /** Chunk data */
  data: T
  /** Whether this is the final chunk */
  done: boolean
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Base delay in milliseconds */
  baseDelayMs: number
  /** Maximum delay in milliseconds */
  maxDelayMs: number
  /** Backoff multiplier (exponential) */
  backoffMultiplier: number
  /** Jitter factor (0-1) */
  jitterFactor: number
  /** Retryable error codes */
  retryableErrors?: (string | number)[]
}

/**
 * RPC binding configuration
 */
export interface RPCBindingConfig {
  /** Service name for logging */
  name: string
  /** Default timeout in milliseconds */
  timeout?: number
  /** Retry policy */
  retry?: RetryPolicy
  /** Base URL for HTTP-based bindings */
  baseUrl?: string
  /** Whether to log requests */
  debug?: boolean
}

/**
 * Cloudflare service binding interface (Fetcher)
 */
export interface ServiceBinding {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
}

/**
 * Method definition for type-safe RPC
 */
export interface MethodDefinition<TParams = unknown, TResult = unknown> {
  /** Method name */
  name: string
  /** Parameter type (for documentation) */
  params?: TParams
  /** Result type (for documentation) */
  result?: TResult
  /** Whether this method supports streaming */
  streaming?: boolean
}

/**
 * Capability module interface
 */
export interface CapabilityModule<TMethods extends Record<string, MethodDefinition>> {
  /** Module name */
  name: string
  /** Module version */
  version: string
  /** Available methods */
  methods: TMethods
}

// ============================================================================
// Default Retry Policy
// ============================================================================

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  retryableErrors: [
    'TIMEOUT',
    'NETWORK_ERROR',
    'SERVICE_UNAVAILABLE',
    'RATE_LIMITED',
    -32603, // Internal error (JSON-RPC)
    503,
    429,
  ],
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * RPC-specific error class
 */
export class RPCBindingError extends Error {
  readonly code: string | number
  readonly data?: unknown
  readonly retryable: boolean
  readonly requestId?: string

  constructor(
    message: string,
    code: string | number,
    options?: { data?: unknown; retryable?: boolean; requestId?: string }
  ) {
    super(message)
    this.name = 'RPCBindingError'
    this.code = code
    this.data = options?.data
    this.retryable = options?.retryable ?? false
    this.requestId = options?.requestId
  }

  static fromRPCError(error: RPCError, requestId?: string): RPCBindingError {
    return new RPCBindingError(error.message, error.code, {
      data: error.data,
      retryable: error.retryable,
      requestId,
    })
  }

  toRPCError(): RPCError {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
      retryable: this.retryable,
    }
  }
}

/**
 * Timeout error for RPC calls
 */
export class RPCTimeoutError extends RPCBindingError {
  constructor(method: string, timeoutMs: number, requestId?: string) {
    super(`RPC call to '${method}' timed out after ${timeoutMs}ms`, 'TIMEOUT', {
      retryable: true,
      requestId,
      data: { method, timeoutMs },
    })
    this.name = 'RPCTimeoutError'
  }
}

/**
 * Network error for RPC calls
 */
export class RPCNetworkError extends RPCBindingError {
  constructor(message: string, requestId?: string) {
    super(message, 'NETWORK_ERROR', { retryable: true, requestId })
    this.name = 'RPCNetworkError'
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `rpc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Calculate backoff delay with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  policy: RetryPolicy
): number {
  const baseDelay = Math.min(
    policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs
  )
  const jitter = baseDelay * policy.jitterFactor * (Math.random() * 2 - 1)
  return Math.max(0, baseDelay + jitter)
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(
  error: RPCBindingError | RPCError,
  policy: RetryPolicy
): boolean {
  if ('retryable' in error && error.retryable === true) {
    return true
  }
  const code = 'code' in error ? error.code : undefined
  if (code && policy.retryableErrors?.includes(code)) {
    return true
  }
  return false
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// RPCBinding Class
// ============================================================================

/**
 * Type-safe RPC binding for Cloudflare service bindings
 *
 * @typeParam TMethods - Map of method names to their definitions
 *
 * @example
 * ```typescript
 * // Define capability module
 * interface AIMethods {
 *   'ai.generate': MethodDefinition<{ prompt: string }, { text: string }>
 *   'ai.embed': MethodDefinition<{ text: string }, { embedding: number[] }>
 * }
 *
 * // Create binding
 * const aiBinding = new RPCBinding<AIMethods>(env.AI_SERVICE, {
 *   name: 'ai-service',
 *   timeout: 30000,
 * })
 *
 * // Call methods
 * const result = await aiBinding.call('ai.generate', { prompt: 'Hello' })
 * ```
 */
export class RPCBinding<
  TMethods extends Record<string, MethodDefinition> = Record<string, MethodDefinition>
> {
  private binding: ServiceBinding | null
  private config: Required<RPCBindingConfig>
  private fallback?: (method: string, params: unknown) => Promise<unknown>

  constructor(
    binding: ServiceBinding | null | undefined,
    config: RPCBindingConfig,
    fallback?: (method: string, params: unknown) => Promise<unknown>
  ) {
    this.binding = binding ?? null
    this.config = {
      name: config.name,
      timeout: config.timeout ?? 30000,
      retry: config.retry ?? DEFAULT_RETRY_POLICY,
      baseUrl: config.baseUrl ?? '/rpc',
      debug: config.debug ?? false,
    }
    this.fallback = fallback
  }

  /**
   * Check if the binding is available
   */
  isAvailable(): boolean {
    return this.binding !== null
  }

  /**
   * Check if fallback is available
   */
  hasFallback(): boolean {
    return this.fallback !== undefined
  }

  /**
   * Call an RPC method with type safety
   *
   * @typeParam M - Method name from TMethods
   * @param method - Method name to call
   * @param params - Method parameters
   * @param options - Call options
   * @returns Method result
   */
  async call<M extends keyof TMethods & string>(
    method: M,
    params: TMethods[M] extends MethodDefinition<infer P, unknown> ? P : unknown,
    options?: { timeout?: number; meta?: Record<string, unknown> }
  ): Promise<TMethods[M] extends MethodDefinition<unknown, infer R> ? R : unknown> {
    const requestId = generateRequestId()
    const timeout = options?.timeout ?? this.config.timeout

    // If binding not available, try fallback
    if (!this.binding) {
      if (this.fallback) {
        if (this.config.debug) {
          console.log(`[${this.config.name}] Using fallback for ${method}`)
        }
        return this.fallback(method, params) as Promise<
          TMethods[M] extends MethodDefinition<unknown, infer R> ? R : unknown
        >
      }
      throw new RPCBindingError(
        `Service binding '${this.config.name}' not available and no fallback configured`,
        'BINDING_UNAVAILABLE',
        { requestId }
      )
    }

    const request: RPCRequest = {
      id: requestId,
      method,
      params,
      timeout,
      meta: options?.meta,
    }

    return this.executeWithRetry(request) as Promise<
      TMethods[M] extends MethodDefinition<unknown, infer R> ? R : unknown
    >
  }

  /**
   * Call an RPC method that returns a stream
   *
   * @param method - Method name to call
   * @param params - Method parameters
   * @returns AsyncGenerator of stream chunks
   */
  async *stream<M extends keyof TMethods & string>(
    method: M,
    params: TMethods[M] extends MethodDefinition<infer P, unknown> ? P : unknown,
    options?: { timeout?: number; meta?: Record<string, unknown> }
  ): AsyncGenerator<
    TMethods[M] extends MethodDefinition<unknown, infer R> ? R : unknown,
    void,
    unknown
  > {
    const requestId = generateRequestId()
    const timeout = options?.timeout ?? this.config.timeout

    if (!this.binding) {
      throw new RPCBindingError(
        `Service binding '${this.config.name}' not available for streaming`,
        'BINDING_UNAVAILABLE',
        { requestId }
      )
    }

    const request: RPCRequest = {
      id: requestId,
      method,
      params,
      timeout,
      meta: { ...options?.meta, streaming: true },
    }

    const response = await this.executeRaw(request)

    if (!response.body) {
      throw new RPCBindingError(
        'Streaming response has no body',
        'INVALID_RESPONSE',
        { requestId }
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue

          // Handle SSE format
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              return
            }

            try {
              const chunk: RPCStreamChunk = JSON.parse(data)
              yield chunk.data as TMethods[M] extends MethodDefinition<unknown, infer R>
                ? R
                : unknown

              if (chunk.done) {
                return
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(request: RPCRequest): Promise<unknown> {
    const policy = this.config.retry
    let lastError: RPCBindingError | undefined

    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        return await this.execute(request)
      } catch (error) {
        const rpcError =
          error instanceof RPCBindingError
            ? error
            : new RPCBindingError(String(error), 'UNKNOWN_ERROR', {
                requestId: request.id,
              })

        lastError = rpcError

        if (!isRetryableError(rpcError, policy)) {
          throw rpcError
        }

        if (attempt < policy.maxAttempts - 1) {
          const delay = calculateBackoffDelay(attempt, policy)
          if (this.config.debug) {
            console.log(
              `[${this.config.name}] Retry ${attempt + 1}/${policy.maxAttempts} ` +
                `for ${request.method} after ${delay}ms`
            )
          }
          await sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * Execute a single RPC request
   */
  private async execute(request: RPCRequest): Promise<unknown> {
    const response = await this.executeRaw(request)

    if (!response.ok) {
      const errorBody = await response.text()
      throw new RPCBindingError(
        `RPC call failed with status ${response.status}: ${errorBody}`,
        response.status,
        { requestId: request.id, retryable: response.status >= 500 }
      )
    }

    const rpcResponse: RPCResponse = await response.json()

    if (rpcResponse.error) {
      throw RPCBindingError.fromRPCError(rpcResponse.error, request.id)
    }

    return rpcResponse.result
  }

  /**
   * Execute raw HTTP request to the binding
   */
  private async executeRaw(request: RPCRequest): Promise<Response> {
    if (!this.binding) {
      throw new RPCBindingError(
        'Service binding not available',
        'BINDING_UNAVAILABLE',
        { requestId: request.id }
      )
    }

    const controller = new AbortController()
    const timeoutId = request.timeout
      ? setTimeout(() => controller.abort(), request.timeout)
      : undefined

    try {
      if (this.config.debug) {
        console.log(`[${this.config.name}] Calling ${request.method}`, request.params)
      }

      const response = await this.binding.fetch(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': request.id,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      return response
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RPCTimeoutError(request.method, request.timeout ?? 0, request.id)
      }
      throw new RPCNetworkError(String(error), request.id)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }
}

// ============================================================================
// Capability Module Bindings
// ============================================================================

/**
 * AI capability methods
 */
export interface AICapabilityMethods {
  'ai.generate': MethodDefinition<
    { prompt: string; model?: string; temperature?: number; maxTokens?: number },
    { text: string; usage?: { promptTokens: number; completionTokens: number } }
  >
  'ai.generateStream': MethodDefinition<
    { prompt: string; model?: string; temperature?: number },
    string
  >
  'ai.embed': MethodDefinition<
    { text: string | string[]; model?: string },
    { embeddings: number[][]; dimension: number }
  >
  'ai.classify': MethodDefinition<
    { text: string; labels: string[] },
    { label: string; confidence: number }
  >
}

/**
 * KV capability methods
 */
export interface KVCapabilityMethods {
  'kv.get': MethodDefinition<
    { key: string; namespace?: string },
    { value: unknown; metadata?: Record<string, unknown> } | null
  >
  'kv.set': MethodDefinition<
    { key: string; value: unknown; namespace?: string; ttl?: number },
    { success: boolean }
  >
  'kv.delete': MethodDefinition<
    { key: string; namespace?: string },
    { success: boolean }
  >
  'kv.list': MethodDefinition<
    { prefix?: string; namespace?: string; limit?: number; cursor?: string },
    { keys: string[]; cursor?: string; complete: boolean }
  >
}

/**
 * R2 (Object Storage) capability methods
 */
export interface R2CapabilityMethods {
  'r2.get': MethodDefinition<
    { key: string; bucket?: string },
    { body: string; contentType?: string; size: number } | null
  >
  'r2.put': MethodDefinition<
    { key: string; body: string; bucket?: string; contentType?: string },
    { key: string; size: number; etag: string }
  >
  'r2.delete': MethodDefinition<
    { key: string; bucket?: string },
    { success: boolean }
  >
  'r2.list': MethodDefinition<
    { prefix?: string; bucket?: string; limit?: number; cursor?: string },
    { objects: Array<{ key: string; size: number }>; cursor?: string }
  >
}

/**
 * D1 (SQL Database) capability methods
 */
export interface D1CapabilityMethods {
  'd1.query': MethodDefinition<
    { sql: string; params?: unknown[]; database?: string },
    { rows: Record<string, unknown>[]; meta: { changes: number; duration: number } }
  >
  'd1.batch': MethodDefinition<
    { statements: Array<{ sql: string; params?: unknown[] }>; database?: string },
    { results: Array<{ rows: Record<string, unknown>[] }> }
  >
  'd1.exec': MethodDefinition<
    { sql: string; database?: string },
    { count: number }
  >
}

/**
 * Queue capability methods
 */
export interface QueueCapabilityMethods {
  'queue.send': MethodDefinition<
    { queue: string; body: unknown; delaySeconds?: number },
    { messageId: string }
  >
  'queue.sendBatch': MethodDefinition<
    { queue: string; messages: Array<{ body: unknown; delaySeconds?: number }> },
    { messageIds: string[] }
  >
}

/**
 * Vectorize capability methods
 */
export interface VectorizeCapabilityMethods {
  'vectorize.insert': MethodDefinition<
    { vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }> },
    { count: number; ids: string[] }
  >
  'vectorize.query': MethodDefinition<
    {
      vector: number[]
      topK?: number
      filter?: Record<string, unknown>
      returnMetadata?: boolean
    },
    { matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }
  >
  'vectorize.delete': MethodDefinition<
    { ids: string[] },
    { count: number }
  >
}

/**
 * Tool capability methods (jq, npm, etc.)
 */
export interface ToolCapabilityMethods {
  'tool.jq': MethodDefinition<
    { input: unknown; filter: string },
    { output: unknown }
  >
  'tool.npmResolve': MethodDefinition<
    { package: string; version?: string },
    { resolved: string; dependencies: Record<string, string> }
  >
  'tool.transform': MethodDefinition<
    { input: unknown; transformer: string; options?: Record<string, unknown> },
    { output: unknown }
  >
}

/**
 * Combined capability methods for unified binding
 */
export interface AllCapabilityMethods
  extends AICapabilityMethods,
    KVCapabilityMethods,
    R2CapabilityMethods,
    D1CapabilityMethods,
    QueueCapabilityMethods,
    VectorizeCapabilityMethods,
    ToolCapabilityMethods {}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an AI capability binding
 */
export function createAIBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<AICapabilityMethods> {
  return new RPCBinding<AICapabilityMethods>(binding, {
    name: 'ai',
    timeout: 60000, // AI calls can be slow
    ...config,
  })
}

/**
 * Create a KV capability binding
 */
export function createKVBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<KVCapabilityMethods> {
  return new RPCBinding<KVCapabilityMethods>(binding, {
    name: 'kv',
    timeout: 5000,
    ...config,
  })
}

/**
 * Create an R2 capability binding
 */
export function createR2Binding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<R2CapabilityMethods> {
  return new RPCBinding<R2CapabilityMethods>(binding, {
    name: 'r2',
    timeout: 30000,
    ...config,
  })
}

/**
 * Create a D1 capability binding
 */
export function createD1Binding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<D1CapabilityMethods> {
  return new RPCBinding<D1CapabilityMethods>(binding, {
    name: 'd1',
    timeout: 30000,
    ...config,
  })
}

/**
 * Create a Queue capability binding
 */
export function createQueueBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<QueueCapabilityMethods> {
  return new RPCBinding<QueueCapabilityMethods>(binding, {
    name: 'queue',
    timeout: 10000,
    ...config,
  })
}

/**
 * Create a Vectorize capability binding
 */
export function createVectorizeBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<VectorizeCapabilityMethods> {
  return new RPCBinding<VectorizeCapabilityMethods>(binding, {
    name: 'vectorize',
    timeout: 30000,
    ...config,
  })
}

/**
 * Create a Tool capability binding (jq, npm, etc.)
 */
export function createToolBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<ToolCapabilityMethods> {
  return new RPCBinding<ToolCapabilityMethods>(binding, {
    name: 'tools',
    timeout: 60000, // Tools can be slow
    ...config,
  })
}

/**
 * Create a unified binding with all capabilities
 */
export function createUnifiedBinding(
  binding: ServiceBinding | null | undefined,
  config?: Partial<RPCBindingConfig>
): RPCBinding<AllCapabilityMethods> {
  return new RPCBinding<AllCapabilityMethods>(binding, {
    name: 'unified',
    timeout: 30000,
    ...config,
  })
}

// ============================================================================
// Binding Registry
// ============================================================================

/**
 * Registry for managing multiple capability bindings
 */
export class BindingRegistry {
  private bindings = new Map<string, RPCBinding>()
  private fallbacks = new Map<string, (method: string, params: unknown) => Promise<unknown>>()

  /**
   * Register a binding
   */
  register<T extends Record<string, MethodDefinition>>(
    name: string,
    binding: RPCBinding<T>
  ): void {
    this.bindings.set(name, binding as RPCBinding)
  }

  /**
   * Register a fallback for a capability
   */
  registerFallback(
    name: string,
    fallback: (method: string, params: unknown) => Promise<unknown>
  ): void {
    this.fallbacks.set(name, fallback)
  }

  /**
   * Get a binding by name
   */
  get<T extends Record<string, MethodDefinition>>(name: string): RPCBinding<T> | undefined {
    return this.bindings.get(name) as RPCBinding<T> | undefined
  }

  /**
   * Check if a binding is available
   */
  has(name: string): boolean {
    const binding = this.bindings.get(name)
    return binding?.isAvailable() ?? false
  }

  /**
   * List all registered binding names
   */
  list(): string[] {
    return Array.from(this.bindings.keys())
  }

  /**
   * List available bindings (with actual service binding)
   */
  listAvailable(): string[] {
    return Array.from(this.bindings.entries())
      .filter(([_, binding]) => binding.isAvailable())
      .map(([name]) => name)
  }

  /**
   * Call a method on any capability, auto-detecting binding
   */
  async call<T = unknown>(
    method: string,
    params: unknown,
    options?: { timeout?: number }
  ): Promise<T> {
    // Extract capability prefix from method name
    const [prefix] = method.split('.')
    const binding = this.bindings.get(prefix)

    if (binding?.isAvailable()) {
      return binding.call(method, params, options) as Promise<T>
    }

    // Try fallback
    const fallback = this.fallbacks.get(prefix)
    if (fallback) {
      return fallback(method, params) as Promise<T>
    }

    throw new RPCBindingError(
      `No binding or fallback available for capability '${prefix}'`,
      'CAPABILITY_UNAVAILABLE'
    )
  }
}

// ============================================================================
// Proxy Pattern for Auto-Detection
// ============================================================================

/**
 * Options for creating a capability proxy
 */
export interface CapabilityProxyOptions<T extends Record<string, MethodDefinition>> {
  /** Service binding */
  binding?: ServiceBinding | null
  /** Binding configuration */
  config?: Partial<RPCBindingConfig>
  /** Inline fallback implementation */
  fallback?: Partial<{
    [K in keyof T]: (
      params: T[K] extends MethodDefinition<infer P, unknown> ? P : unknown
    ) => Promise<T[K] extends MethodDefinition<unknown, infer R> ? R : unknown>
  }>
}

/**
 * Create a capability proxy that auto-detects binding availability
 * and falls back to inline implementation when binding is unavailable.
 *
 * This implements the $ proxy pattern from the issue description.
 *
 * @example
 * ```typescript
 * const ai = createCapabilityProxy<AICapabilityMethods>({
 *   binding: env.AI_SERVICE,
 *   fallback: {
 *     'ai.generate': async (params) => {
 *       // Inline implementation using Workers AI
 *       return await localAI.run(params)
 *     }
 *   }
 * })
 *
 * // Auto-detects: uses binding if available, fallback otherwise
 * const result = await ai.call('ai.generate', { prompt: 'Hello' })
 * ```
 */
export function createCapabilityProxy<T extends Record<string, MethodDefinition>>(
  options: CapabilityProxyOptions<T>
): RPCBinding<T> {
  const fallbackFn = options.fallback
    ? async (method: string, params: unknown): Promise<unknown> => {
        const handler = options.fallback?.[method as keyof T]
        if (handler) {
          return handler(params as Parameters<typeof handler>[0])
        }
        throw new RPCBindingError(
          `No fallback implementation for method '${method}'`,
          'NO_FALLBACK'
        )
      }
    : undefined

  return new RPCBinding<T>(
    options.binding ?? null,
    {
      name: 'capability-proxy',
      ...options.config,
    },
    fallbackFn
  )
}
