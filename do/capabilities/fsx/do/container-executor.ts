/**
 * CloudflareContainerExecutor - External executor integration for Cloudflare Containers
 *
 * This module provides an executor interface for running commands in Cloudflare Containers,
 * enabling:
 * - HTTP-based command execution via exec endpoint
 * - WebSocket streaming for real-time output
 * - Session isolation for multi-tenant workloads
 * - Integration with FsModule for filesystem operations
 *
 * The executor acts as a bridge between the BashModule and external Cloudflare Containers,
 * allowing heavy or long-running operations to be offloaded to container instances.
 *
 * @example
 * ```typescript
 * // Using as external executor for BashModule
 * const executor = new CloudflareContainerExecutor({
 *   container: env.CONTAINER,
 *   sessionId: 'user-123',
 * })
 *
 * // Execute a command
 * const result = await executor.exec('npm install')
 *
 * // Stream output via WebSocket
 * const ws = executor.createStreamingExec('npm run build')
 * ```
 *
 * @module durable-object/container-executor
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Container binding interface from @cloudflare/containers
 * This represents the binding exposed in wrangler.toml/jsonc
 */
export interface ContainerBinding {
  /** Get a container instance by ID or name */
  get(id: string | DurableObjectId): ContainerInstance
  /** Get ID from name */
  idFromName(name: string): DurableObjectId
  /** Create a new unique ID */
  newUniqueId(): DurableObjectId
}

/**
 * Container instance interface
 * Represents a running container that can receive requests
 */
export interface ContainerInstance {
  /** Fetch method for HTTP requests (supports WebSocket upgrade) */
  fetch(request: Request): Promise<Response>
  /** Container-specific fetch with port targeting */
  containerFetch(request: Request, port?: number): Promise<Response>
  containerFetch(url: string | URL, init?: RequestInit, port?: number): Promise<Response>
}

/**
 * Configuration for CloudflareContainerExecutor
 */
export interface ContainerExecutorConfig {
  /** Container binding from environment */
  container: ContainerBinding
  /** Session ID for container instance isolation */
  sessionId?: string
  /** Port for exec HTTP endpoint (default: 8080) */
  execPort?: number
  /** Port for WebSocket streaming (default: 8081) */
  wsPort?: number
  /** Timeout for exec operations in milliseconds (default: 300000 = 5 min) */
  timeout?: number
  /** Base URL path for exec endpoint (default: '/exec') */
  execPath?: string
  /** Base URL path for WebSocket streaming (default: '/ws') */
  wsPath?: string
  /** Environment variables to pass to commands */
  env?: Record<string, string>
  /** Working directory for command execution */
  cwd?: string
  /** Enable command logging */
  enableLogging?: boolean
}

/**
 * Result of a command execution
 */
export interface ContainerExecResult {
  /** Exit code of the command (0 = success) */
  exitCode: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Whether the command succeeded */
  success: boolean
  /** Command that was executed */
  command: string
  /** Session ID used */
  sessionId: string
  /** Execution duration in milliseconds */
  duration: number
  /** Whether the command was killed (timeout, signal) */
  killed: boolean
  /** Signal that killed the command (if any) */
  signal?: string
}

/**
 * Options for exec operations
 */
export interface ExecOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Input to send to stdin */
  stdin?: string
  /** Whether to combine stdout and stderr */
  combineOutput?: boolean
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Streaming exec event types
 */
export type StreamingExecEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; exitCode: number; signal?: string }
  | { type: 'error'; message: string }

/**
 * Streaming exec session handle
 */
export interface StreamingExecSession {
  /** Session ID */
  sessionId: string
  /** WebSocket connection (if using WebSocket transport) */
  websocket?: WebSocket
  /** Async iterator for events */
  events: AsyncIterable<StreamingExecEvent>
  /** Send input to stdin */
  write(data: string): Promise<void>
  /** Send signal to process */
  kill(signal?: string): Promise<void>
  /** Close the session */
  close(): void
  /** Promise that resolves when execution completes */
  done: Promise<ContainerExecResult>
}

/**
 * Container state information
 */
export interface ContainerState {
  /** Current status */
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown'
  /** Last state change timestamp */
  lastChange: number
  /** Exit code if stopped */
  exitCode?: number
}

// ============================================================================
// CLOUDFLARE CONTAINER EXECUTOR
// ============================================================================

/**
 * CloudflareContainerExecutor - External executor for Cloudflare Containers
 *
 * This class provides command execution capabilities by communicating with
 * Cloudflare Container instances via HTTP and WebSocket.
 *
 * Architecture:
 * - Each session gets its own container instance for isolation
 * - Commands are sent via HTTP POST to the exec endpoint
 * - Real-time output can be streamed via WebSocket
 * - The container should run a compatible exec server (see ExecServer)
 */
export class CloudflareContainerExecutor {
  private container: ContainerBinding
  private sessionId: string
  private execPort: number
  private wsPort: number
  private timeout: number
  private execPath: string
  private wsPath: string
  private defaultEnv: Record<string, string>
  private defaultCwd: string
  // Reserved for future logging implementation
  // @ts-expect-error Reserved for future logging implementation
  private _enableLogging: boolean
  private instance: ContainerInstance | null = null

  constructor(config: ContainerExecutorConfig) {
    this.container = config.container
    this.sessionId = config.sessionId ?? crypto.randomUUID()
    this.execPort = config.execPort ?? 8080
    this.wsPort = config.wsPort ?? 8081
    this.timeout = config.timeout ?? 300000 // 5 minutes
    this.execPath = config.execPath ?? '/exec'
    this.wsPath = config.wsPath ?? '/ws'
    this.defaultEnv = config.env ?? {}
    this.defaultCwd = config.cwd ?? '/'
    this._enableLogging = config.enableLogging ?? false
  }

  // ===========================================================================
  // INSTANCE MANAGEMENT
  // ===========================================================================

  /**
   * Get or create the container instance for this session
   */
  private getContainerInstance(): ContainerInstance {
    if (!this.instance) {
      const id = this.container.idFromName(this.sessionId)
      this.instance = this.container.get(id)
    }
    return this.instance
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Change the session ID (creates new container instance)
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
    this.instance = null // Reset instance to create new one
  }

  /**
   * Create a new isolated session
   * @returns New session ID
   */
  createSession(): string {
    const newSessionId = crypto.randomUUID()
    this.setSessionId(newSessionId)
    return newSessionId
  }

  // ===========================================================================
  // HTTP EXEC OPERATIONS
  // ===========================================================================

  /**
   * Execute a command in the container via HTTP
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Execution result
   */
  async exec(command: string, options: ExecOptions = {}): Promise<ContainerExecResult> {
    const startTime = Date.now()
    const instance = this.getContainerInstance()

    const timeout = options.timeout ?? this.timeout
    const cwd = options.cwd ?? this.defaultCwd
    const env = { ...this.defaultEnv, ...options.env }

    // Build request body
    const body = JSON.stringify({
      command,
      cwd,
      env,
      stdin: options.stdin,
      combineOutput: options.combineOutput ?? false,
      timeout,
    })

    // Create request
    const url = `http://localhost:${this.execPort}${this.execPath}`
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
      },
      body,
      signal: options.signal,
    })

    try {
      // Execute via containerFetch
      const response = await instance.containerFetch(request, this.execPort)

      if (!response.ok) {
        const errorText = await response.text()
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Container exec failed: ${response.status} ${errorText}`,
          success: false,
          command,
          sessionId: this.sessionId,
          duration: Date.now() - startTime,
          killed: false,
        }
      }

      const result = (await response.json()) as {
        exitCode: number
        stdout: string
        stderr: string
        killed?: boolean
        signal?: string
      }

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0,
        command,
        sessionId: this.sessionId,
        duration: Date.now() - startTime,
        killed: result.killed ?? false,
        signal: result.signal,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const isAborted = error instanceof Error && error.name === 'AbortError'

      return {
        exitCode: isAborted ? 130 : 1,
        stdout: '',
        stderr: `Exec error: ${message}`,
        success: false,
        command,
        sessionId: this.sessionId,
        duration: Date.now() - startTime,
        killed: isAborted,
        signal: isAborted ? 'SIGINT' : undefined,
      }
    }
  }

  /**
   * Execute multiple commands in sequence
   *
   * @param commands - Array of commands to execute
   * @param options - Execution options (shared across all commands)
   * @returns Array of execution results
   */
  async execAll(commands: string[], options: ExecOptions = {}): Promise<ContainerExecResult[]> {
    const results: ContainerExecResult[] = []

    for (const command of commands) {
      const result = await this.exec(command, options)
      results.push(result)

      // Stop on first failure unless we add a flag to continue
      if (!result.success) {
        break
      }
    }

    return results
  }

  /**
   * Execute a command and return only stdout (throws on error)
   */
  async execStdout(command: string, options: ExecOptions = {}): Promise<string> {
    const result = await this.exec(command, options)
    if (!result.success) {
      throw new Error(result.stderr || `Command failed with exit code ${result.exitCode}`)
    }
    return result.stdout
  }

  // ===========================================================================
  // WEBSOCKET STREAMING
  // ===========================================================================

  /**
   * Create a streaming exec session via WebSocket
   *
   * This allows real-time streaming of stdout/stderr and interactive input.
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Streaming session handle
   */
  createStreamingExec(command: string, options: ExecOptions = {}): StreamingExecSession {
    const instance = this.getContainerInstance()
    const cwd = options.cwd ?? this.defaultCwd
    const env = { ...this.defaultEnv, ...options.env }

    // Create WebSocket upgrade request
    const wsUrl = `ws://localhost:${this.wsPort}${this.wsPath}`
    const params = new URLSearchParams({
      command,
      cwd,
      sessionId: this.sessionId,
    })

    // Add env as JSON
    if (Object.keys(env).length > 0) {
      params.set('env', JSON.stringify(env))
    }

    const fullUrl = `${wsUrl}?${params.toString()}`

    // Create event queue for async iteration
    const eventQueue: StreamingExecEvent[] = []
    let resolveNextEvent: ((value: IteratorResult<StreamingExecEvent>) => void) | null = null
    let closed = false
    let doneResolver: ((result: ContainerExecResult) => void) | null = null
    let doneRejecter: ((error: Error) => void) | null = null

    const startTime = Date.now()
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    let killed = false
    let signal: string | undefined

    // Create done promise
    const donePromise = new Promise<ContainerExecResult>((resolve, reject) => {
      doneResolver = resolve
      doneRejecter = reject
    })

    // We need to use fetch for WebSocket upgrade through the container
    const upgradeRequest = new Request(fullUrl, {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'X-Session-Id': this.sessionId,
      },
    })

    // Note: The actual WebSocket connection happens through container.fetch()
    // The container proxies the WebSocket connection to the exec server

    // Create async iterator for events
    const events: AsyncIterable<StreamingExecEvent> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<StreamingExecEvent>> {
            if (closed && eventQueue.length === 0) {
              return { done: true, value: undefined }
            }

            if (eventQueue.length > 0) {
              return { done: false, value: eventQueue.shift()! }
            }

            // Wait for next event
            return new Promise((resolve) => {
              resolveNextEvent = resolve
            })
          },
        }
      },
    }

    // Process incoming WebSocket message
    const processMessage = (data: string) => {
      try {
        const event = JSON.parse(data) as StreamingExecEvent

        // Accumulate output
        if (event.type === 'stdout') {
          stdout += event.data
        } else if (event.type === 'stderr') {
          stderr += event.data
        } else if (event.type === 'exit') {
          exitCode = event.exitCode
          signal = event.signal
          killed = !!event.signal
        }

        // Push to queue or resolve waiting iterator
        if (resolveNextEvent) {
          resolveNextEvent({ done: false, value: event })
          resolveNextEvent = null
        } else {
          eventQueue.push(event)
        }

        // Resolve done promise on exit
        if (event.type === 'exit' && doneResolver) {
          doneResolver({
            exitCode,
            stdout,
            stderr,
            success: exitCode === 0,
            command,
            sessionId: this.sessionId,
            duration: Date.now() - startTime,
            killed,
            signal,
          })
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Note: In a real implementation, we would initiate the WebSocket connection
    // through container.fetch() with the upgrade request. The container handles
    // proxying the WebSocket to the internal exec server.
    //
    // For now, we return a session object that the caller can use to
    // interact with the WebSocket connection.

    let websocket: WebSocket | undefined

    // Initiate connection (async, will be handled by caller)
    const initConnection = async () => {
      try {
        const response = await instance.fetch(upgradeRequest)
        // The response should be a WebSocket upgrade response in CF Workers runtime
        // The webSocket property exists on upgraded responses in Cloudflare Workers
        websocket = (response as Response & { webSocket?: WebSocket }).webSocket
        if (websocket) {
          websocket.accept()
          websocket.addEventListener('message', (event) => {
            processMessage(String(event.data))
          })
          websocket.addEventListener('close', () => {
            closed = true
            if (resolveNextEvent) {
              resolveNextEvent({ done: true, value: undefined })
            }
          })
          websocket.addEventListener('error', (_event) => {
            const errorEvent: StreamingExecEvent = {
              type: 'error',
              message: 'WebSocket error',
            }
            if (resolveNextEvent) {
              resolveNextEvent({ done: false, value: errorEvent })
              resolveNextEvent = null
            } else {
              eventQueue.push(errorEvent)
            }
            if (doneRejecter) {
              doneRejecter(new Error('WebSocket error'))
            }
          })
        }
      } catch (error) {
        closed = true
        if (doneRejecter) {
          doneRejecter(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    // Start connection in background
    initConnection()

    return {
      sessionId: this.sessionId,
      get websocket() {
        return websocket
      },
      events,
      async write(data: string) {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'stdin', data }))
        }
      },
      async kill(sig = 'SIGTERM') {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'signal', signal: sig }))
        }
      },
      close() {
        if (websocket) {
          websocket.close()
        }
        closed = true
      },
      done: donePromise,
    }
  }

  // ===========================================================================
  // CONTAINER STATE
  // ===========================================================================

  /**
   * Get the current state of the container
   */
  async getState(): Promise<ContainerState> {
    const instance = this.getContainerInstance()

    try {
      const request = new Request(`http://localhost:${this.execPort}/health`, {
        method: 'GET',
        headers: {
          'X-Session-Id': this.sessionId,
        },
      })

      const response = await instance.containerFetch(request, this.execPort)

      if (response.ok) {
        const state = (await response.json()) as ContainerState
        return state
      }

      return {
        status: 'unknown',
        lastChange: Date.now(),
      }
    } catch {
      return {
        status: 'stopped',
        lastChange: Date.now(),
      }
    }
  }

  /**
   * Check if the container is ready to accept commands
   */
  async isReady(): Promise<boolean> {
    const state = await this.getState()
    return state.status === 'running'
  }

  /**
   * Wait for the container to be ready
   */
  async waitUntilReady(timeoutMs = 30000): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      if (await this.isReady()) {
        return true
      }
      // Wait 500ms before retry
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return false
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Set the default working directory
   */
  setCwd(cwd: string): void {
    this.defaultCwd = cwd
  }

  /**
   * Get the default working directory
   */
  getCwd(): string {
    return this.defaultCwd
  }

  /**
   * Set an environment variable
   */
  setEnv(key: string, value: string): void {
    this.defaultEnv[key] = value
  }

  /**
   * Get an environment variable
   */
  getEnv(key: string): string | undefined {
    return this.defaultEnv[key]
  }

  /**
   * Get all environment variables
   */
  getAllEnv(): Record<string, string> {
    return { ...this.defaultEnv }
  }

  /**
   * Clear all environment variables
   */
  clearEnv(): void {
    this.defaultEnv = {}
  }
}

// ============================================================================
// EXEC SERVER PROTOCOL
// ============================================================================

/**
 * Protocol definition for the exec server that runs inside the container.
 *
 * The container should expose:
 * 1. HTTP POST /exec - Execute a command and return result
 * 2. WebSocket /ws - Streaming command execution
 * 3. GET /health - Health check endpoint
 *
 * HTTP Exec Request:
 * ```json
 * {
 *   "command": "ls -la",
 *   "cwd": "/app",
 *   "env": {"NODE_ENV": "production"},
 *   "stdin": "input data",
 *   "combineOutput": false,
 *   "timeout": 30000
 * }
 * ```
 *
 * HTTP Exec Response:
 * ```json
 * {
 *   "exitCode": 0,
 *   "stdout": "file1.txt\nfile2.txt",
 *   "stderr": "",
 *   "killed": false,
 *   "signal": null
 * }
 * ```
 *
 * WebSocket Messages (server -> client):
 * - { type: "stdout", data: "..." }
 * - { type: "stderr", data: "..." }
 * - { type: "exit", exitCode: 0, signal?: "SIGTERM" }
 * - { type: "error", message: "..." }
 *
 * WebSocket Messages (client -> server):
 * - { type: "stdin", data: "..." }
 * - { type: "signal", signal: "SIGTERM" }
 */

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a CloudflareContainerExecutor from environment bindings
 *
 * @example
 * ```typescript
 * const executor = createContainerExecutor(env.CONTAINER, 'user-session-123')
 * const result = await executor.exec('echo hello')
 * ```
 */
export function createContainerExecutor(
  container: ContainerBinding,
  sessionId?: string,
  options: Partial<ContainerExecutorConfig> = {}
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor({
    container,
    sessionId,
    ...options,
  })
}

/**
 * Create an isolated container executor with a new session
 */
export function createIsolatedExecutor(
  container: ContainerBinding,
  options: Partial<ContainerExecutorConfig> = {}
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor({
    container,
    sessionId: crypto.randomUUID(),
    ...options,
  })
}

// ============================================================================
// HELPER TYPES FOR MIXIN INTEGRATION
// ============================================================================

/**
 * Interface for classes that have container executor capability
 */
export interface HasContainerExecutor {
  $: {
    exec: CloudflareContainerExecutor
    [key: string]: unknown
  }
}

/**
 * Extended WorkflowContext with exec capability
 */
export interface WithExecContext {
  exec: CloudflareContainerExecutor
  [key: string]: unknown
}
