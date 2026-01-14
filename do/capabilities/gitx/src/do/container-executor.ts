/**
 * @fileoverview Cloudflare Container Executor Integration
 *
 * This module provides executor implementations for running bash commands
 * in Cloudflare Containers. It supports multiple execution modes:
 *
 * - HTTP-based execution with the Sandbox SDK (exec/execStream)
 * - WebSocket streaming for interactive sessions
 * - Session isolation for multi-tenant environments
 *
 * @module do/container-executor
 *
 * @example
 * ```typescript
 * import { CloudflareContainerExecutor } from 'gitx.do/do'
 *
 * const executor = new CloudflareContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'user-123',
 * })
 *
 * const result = await executor.execute('ls -la')
 * console.log(result.stdout)
 * ```
 */

// ============================================================================
// Executor Types (compatible with bashx.do's BashExecutor)
// ============================================================================

/**
 * Result of a bash command execution.
 */
export interface BashResult {
  /**
   * The command that was executed.
   */
  command: string

  /**
   * Standard output from the command.
   */
  stdout: string

  /**
   * Standard error from the command.
   */
  stderr: string

  /**
   * Exit code from the command.
   */
  exitCode: number
}

/**
 * Options for executing a command.
 */
export interface ExecOptions {
  /**
   * Working directory for command execution.
   */
  cwd?: string

  /**
   * Environment variables.
   */
  env?: Record<string, string>

  /**
   * Timeout in milliseconds.
   */
  timeout?: number

  /**
   * Input to provide to stdin.
   */
  stdin?: string
}

/**
 * Options for spawning a command with streaming output.
 */
export interface SpawnOptions extends ExecOptions {
  /**
   * Callback for stdout data.
   */
  onStdout?: (data: string) => void

  /**
   * Callback for stderr data.
   */
  onStderr?: (data: string) => void

  /**
   * Callback for process exit.
   */
  onExit?: (code: number) => void
}

/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
  /**
   * Process ID.
   */
  pid: number

  /**
   * Promise that resolves when the process completes.
   */
  done: Promise<BashResult>

  /**
   * Send a signal to the process.
   */
  kill: (signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => void

  /**
   * Write data to the process stdin.
   */
  write: (data: string) => void

  /**
   * Close the process stdin.
   */
  closeStdin: () => void
}

/**
 * Interface for bash command execution.
 * Compatible with bashx.do's BashExecutor interface.
 */
export interface BashExecutor {
  /**
   * Execute a command and return the result.
   */
  execute(command: string, options?: ExecOptions): Promise<BashResult>

  /**
   * Spawn a command for streaming execution.
   */
  spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
}

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Cloudflare Sandbox interface.
 * Matches the Sandbox SDK API from @cloudflare/sandbox.
 */
export interface CloudflareSandbox {
  /**
   * Execute a command and wait for completion.
   * Returns stdout, stderr, exitCode, and success flag.
   */
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>

  /**
   * Execute a command with streaming output.
   * Returns a readable stream of output chunks.
   */
  execStream?(command: string, options?: SandboxExecOptions): Promise<SandboxStreamResult>

  /**
   * Start a background process.
   * Returns a handle for managing the process.
   */
  startProcess?(command: string, options?: SandboxExecOptions): Promise<SandboxProcessHandle>

  /**
   * Write a file to the sandbox filesystem.
   */
  writeFile?(path: string, content: string | Uint8Array): Promise<void>

  /**
   * Read a file from the sandbox filesystem.
   */
  readFile?(path: string): Promise<string | Uint8Array>
}

/**
 * Options for sandbox execution.
 */
export interface SandboxExecOptions {
  /**
   * Working directory for command execution.
   */
  cwd?: string

  /**
   * Environment variables.
   */
  env?: Record<string, string>

  /**
   * Timeout in milliseconds.
   */
  timeout?: number

  /**
   * Input to provide to stdin.
   */
  stdin?: string
}

/**
 * Result from sandbox command execution.
 */
export interface SandboxExecResult {
  /**
   * Standard output from the command.
   */
  stdout: string

  /**
   * Standard error from the command.
   */
  stderr: string

  /**
   * Exit code of the command.
   */
  exitCode: number

  /**
   * Whether the command succeeded (exitCode === 0).
   */
  success: boolean
}

/**
 * Result from streaming command execution.
 */
export interface SandboxStreamResult {
  /**
   * Readable stream of output.
   */
  stream: ReadableStream<SandboxStreamChunk>

  /**
   * Promise that resolves when command completes.
   */
  done: Promise<SandboxExecResult>

  /**
   * Abort the streaming execution.
   */
  abort(): void
}

/**
 * Chunk from streaming output.
 */
export interface SandboxStreamChunk {
  /**
   * Type of output: 'stdout', 'stderr', or 'exit'.
   */
  type: 'stdout' | 'stderr' | 'exit'

  /**
   * Data content for stdout/stderr, exit code for exit.
   */
  data: string | number
}

/**
 * Handle for managing a background process.
 */
export interface SandboxProcessHandle {
  /**
   * Process ID.
   */
  pid: number

  /**
   * Send signal to the process.
   */
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): Promise<void>

  /**
   * Write to process stdin.
   */
  write(data: string): Promise<void>

  /**
   * Close stdin.
   */
  closeStdin(): Promise<void>

  /**
   * Promise that resolves when process exits.
   */
  exited: Promise<SandboxExecResult>
}

/**
 * Cloudflare Container binding interface.
 * For use with native Cloudflare Containers (when exec becomes available).
 */
export interface CloudflareContainer {
  /**
   * Fetch method for HTTP requests to the container.
   */
  fetch(request: Request): Promise<Response>

  /**
   * Get a container instance.
   */
  get(id: DurableObjectId): CloudflareContainerInstance
}

/**
 * Container instance interface.
 */
export interface CloudflareContainerInstance {
  /**
   * Fetch method for HTTP requests.
   */
  fetch(request: Request): Promise<Response>

  /**
   * Start the container.
   */
  start?(options?: ContainerStartOptions): Promise<void>

  /**
   * Stop the container.
   */
  stop?(): Promise<void>
}

/**
 * Options for starting a container.
 */
export interface ContainerStartOptions {
  /**
   * Override the entrypoint command.
   */
  entrypoint?: string[]

  /**
   * Environment variables.
   */
  env?: Record<string, string>
}

/**
 * DurableObjectId type (simplified).
 */
export interface DurableObjectId {
  toString(): string
}

/**
 * Configuration options for CloudflareContainerExecutor.
 */
export interface ContainerExecutorOptions {
  /**
   * Cloudflare Sandbox binding.
   * Use this for Sandbox SDK-based execution.
   */
  sandbox?: CloudflareSandbox

  /**
   * Cloudflare Container binding.
   * Use this for native container-based execution.
   */
  container?: CloudflareContainer | CloudflareContainerInstance

  /**
   * Session ID for isolation.
   * Each session gets its own sandbox/container instance.
   */
  sessionId?: string

  /**
   * Default working directory.
   * @default '/'
   */
  cwd?: string

  /**
   * Default timeout in milliseconds.
   * @default 30000
   */
  timeout?: number

  /**
   * Default environment variables.
   */
  env?: Record<string, string>

  /**
   * WebSocket endpoint for streaming execution.
   * Used when connecting to a container with WebSocket support.
   */
  wsEndpoint?: string

  /**
   * HTTP exec endpoint for command execution.
   * Used when connecting to a container with HTTP exec API.
   */
  httpExecEndpoint?: string

  /**
   * Custom fetch function for HTTP requests.
   * Useful for testing or custom transport layers.
   */
  fetch?: typeof fetch
}

/**
 * Internal session state.
 */
interface SessionState {
  /**
   * Session ID.
   */
  id: string

  /**
   * Working directory.
   */
  cwd: string

  /**
   * Environment variables.
   */
  env: Record<string, string>

  /**
   * Active processes.
   */
  processes: Map<number, SandboxProcessHandle>

  /**
   * Last activity timestamp.
   */
  lastActivity: number
}

// ============================================================================
// CloudflareContainerExecutor Class
// ============================================================================

/**
 * CloudflareContainerExecutor - Execute bash commands in Cloudflare Containers.
 *
 * This executor implements the BashExecutor interface and supports multiple
 * execution backends:
 *
 * 1. **Sandbox SDK**: Uses `exec()` and `execStream()` from @cloudflare/sandbox
 * 2. **HTTP Exec**: Sends commands to an HTTP endpoint in the container
 * 3. **WebSocket Streaming**: Connects to container via WebSocket for streaming
 *
 * @example
 * ```typescript
 * // Using Sandbox SDK
 * const executor = new CloudflareContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'session-123',
 * })
 *
 * // Execute a command
 * const result = await executor.execute('npm install')
 *
 * // Spawn for streaming
 * const handle = await executor.spawn('npm', ['run', 'dev'], {
 *   onStdout: (chunk) => console.log(chunk),
 *   onStderr: (chunk) => console.error(chunk),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Using HTTP exec endpoint
 * const executor = new CloudflareContainerExecutor({
 *   httpExecEndpoint: 'https://container.example.com.ai/exec',
 *   sessionId: 'session-456',
 * })
 *
 * const result = await executor.execute('ls -la')
 * ```
 */
export class CloudflareContainerExecutor implements BashExecutor {
  private readonly sandbox?: CloudflareSandbox
  private readonly container?: CloudflareContainer | CloudflareContainerInstance
  private readonly sessionId: string
  private readonly defaultCwd: string
  private readonly defaultTimeout: number
  private readonly defaultEnv: Record<string, string>
  private readonly wsEndpoint?: string
  private readonly httpExecEndpoint?: string
  private readonly fetchFn: typeof fetch

  /**
   * Session state for isolation.
   */
  private session: SessionState

  /**
   * Process ID counter for spawn handles.
   */
  private pidCounter = 1000

  /**
   * Create a new CloudflareContainerExecutor.
   *
   * @param options - Configuration options
   */
  constructor(options: ContainerExecutorOptions = {}) {
    this.sandbox = options.sandbox
    this.container = options.container
    this.sessionId = options.sessionId ?? crypto.randomUUID()
    this.defaultCwd = options.cwd ?? '/'
    this.defaultTimeout = options.timeout ?? 30000
    this.defaultEnv = options.env ?? {}
    this.wsEndpoint = options.wsEndpoint
    this.httpExecEndpoint = options.httpExecEndpoint
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize session state
    this.session = {
      id: this.sessionId,
      cwd: this.defaultCwd,
      env: { ...this.defaultEnv },
      processes: new Map(),
      lastActivity: Date.now(),
    }
  }

  // ===========================================================================
  // BashExecutor Interface
  // ===========================================================================

  /**
   * Execute a command and return the result.
   *
   * @param command - The command to execute
   * @param options - Execution options
   * @returns Promise resolving to the execution result
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    this.session.lastActivity = Date.now()

    const cwd = options?.cwd ?? this.session.cwd
    const timeout = options?.timeout ?? this.defaultTimeout
    const env = { ...this.session.env, ...options?.env }

    // Try sandbox SDK first
    if (this.sandbox) {
      return this.executeViaSandbox(command, { cwd, timeout, env, stdin: options?.stdin })
    }

    // Try HTTP exec endpoint
    if (this.httpExecEndpoint) {
      return this.executeViaHttp(command, { cwd, timeout, env, stdin: options?.stdin })
    }

    // Try container fetch with custom exec endpoint
    if (this.container) {
      return this.executeViaContainer(command, { cwd, timeout, env, stdin: options?.stdin })
    }

    // No execution backend available
    return {
      command,
      stdout: '',
      stderr: 'No execution backend configured (sandbox, httpExecEndpoint, or container required)',
      exitCode: 1,
    }
  }

  /**
   * Spawn a command for streaming execution.
   *
   * @param command - The command to spawn
   * @param args - Command arguments
   * @param options - Spawn options
   * @returns Promise resolving to a spawn handle
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    this.session.lastActivity = Date.now()

    const fullCommand = args?.length ? `${command} ${args.join(' ')}` : command
    const cwd = options?.cwd ?? this.session.cwd
    const timeout = options?.timeout ?? this.defaultTimeout
    const env = { ...this.session.env, ...options?.env }

    // Try sandbox SDK streaming
    if (this.sandbox?.execStream) {
      return this.spawnViaSandbox(fullCommand, { cwd, timeout, env }, options)
    }

    // Try WebSocket streaming
    if (this.wsEndpoint) {
      return this.spawnViaWebSocket(fullCommand, { cwd, timeout, env }, options)
    }

    // Try sandbox startProcess
    if (this.sandbox?.startProcess) {
      return this.spawnViaProcess(fullCommand, { cwd, timeout, env }, options)
    }

    // Fallback: execute and simulate streaming
    return this.spawnViaExec(fullCommand, { cwd, timeout, env }, options)
  }

  // ===========================================================================
  // Sandbox SDK Execution
  // ===========================================================================

  /**
   * Execute a command using the Sandbox SDK.
   */
  private async executeViaSandbox(
    command: string,
    options: SandboxExecOptions
  ): Promise<BashResult> {
    try {
      const result = await this.sandbox!.exec(command, options)
      return {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error) {
      return {
        command,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  }

  /**
   * Spawn a command using Sandbox SDK streaming.
   */
  private async spawnViaSandbox(
    command: string,
    execOptions: SandboxExecOptions,
    spawnOptions?: SpawnOptions
  ): Promise<SpawnHandle> {
    const pid = this.pidCounter++
    let abortController: { abort: () => void } | null = null

    const streamResult = await this.sandbox!.execStream!(command, execOptions)
    abortController = { abort: streamResult.abort }

    // Process the stream
    const reader = streamResult.stream.getReader()
    const processStream = async (): Promise<BashResult> => {
      let stdout = ''
      let stderr = ''
      let exitCode = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          if (value.type === 'stdout') {
            const data = String(value.data)
            stdout += data
            spawnOptions?.onStdout?.(data)
          } else if (value.type === 'stderr') {
            const data = String(value.data)
            stderr += data
            spawnOptions?.onStderr?.(data)
          } else if (value.type === 'exit') {
            exitCode = Number(value.data)
          }
        }
      } catch (error) {
        stderr += error instanceof Error ? error.message : String(error)
        exitCode = 1
      }

      spawnOptions?.onExit?.(exitCode)
      return { command, stdout, stderr, exitCode }
    }

    const donePromise = processStream()

    const handle: SpawnHandle = {
      pid,
      done: donePromise,
      kill: (_signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => {
        abortController?.abort()
      },
      write: (_data: string) => {
        // Sandbox stream doesn't support stdin writing
      },
      closeStdin: () => {
        // No-op for sandbox stream
      },
    }

    return handle
  }

  /**
   * Spawn a command using Sandbox SDK startProcess.
   */
  private async spawnViaProcess(
    command: string,
    execOptions: SandboxExecOptions,
    spawnOptions?: SpawnOptions
  ): Promise<SpawnHandle> {
    const processHandle = await this.sandbox!.startProcess!(command, execOptions)
    const pid = processHandle.pid

    // Track the process
    this.session.processes.set(pid, processHandle)

    // Set up exit handling
    const donePromise = processHandle.exited.then(result => {
      this.session.processes.delete(pid)
      spawnOptions?.onExit?.(result.exitCode)
      return {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    })

    const handle: SpawnHandle = {
      pid,
      done: donePromise,
      kill: (signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => {
        processHandle.kill(signal)
      },
      write: (data: string) => {
        processHandle.write(data)
      },
      closeStdin: () => {
        processHandle.closeStdin()
      },
    }

    return handle
  }

  // ===========================================================================
  // HTTP Exec Execution
  // ===========================================================================

  /**
   * Execute a command via HTTP exec endpoint.
   */
  private async executeViaHttp(
    command: string,
    options: SandboxExecOptions
  ): Promise<BashResult> {
    try {
      const response = await this.fetchFn(this.httpExecEndpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': this.sessionId,
        },
        body: JSON.stringify({
          command,
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeout,
          stdin: options.stdin,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          command,
          stdout: '',
          stderr: `HTTP exec failed: ${response.status} ${errorText}`,
          exitCode: 1,
        }
      }

      const result = await response.json() as {
        stdout?: string
        stderr?: string
        exitCode?: number
        success?: boolean
      }

      return {
        command,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
      }
    } catch (error) {
      return {
        command,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  }

  // ===========================================================================
  // Container Fetch Execution
  // ===========================================================================

  /**
   * Execute a command via container fetch.
   */
  private async executeViaContainer(
    command: string,
    options: SandboxExecOptions
  ): Promise<BashResult> {
    try {
      // Build the request to the container's exec endpoint
      const container = this.container!
      const request = new Request('http://container/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': this.sessionId,
        },
        body: JSON.stringify({
          command,
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeout,
          stdin: options.stdin,
        }),
      })

      const response = await container.fetch(request)

      if (!response.ok) {
        const errorText = await response.text()
        return {
          command,
          stdout: '',
          stderr: `Container exec failed: ${response.status} ${errorText}`,
          exitCode: 1,
        }
      }

      const result = await response.json() as {
        stdout?: string
        stderr?: string
        exitCode?: number
        success?: boolean
      }

      return {
        command,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
      }
    } catch (error) {
      return {
        command,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  }

  // ===========================================================================
  // WebSocket Streaming
  // ===========================================================================

  /**
   * Spawn a command via WebSocket connection.
   */
  private async spawnViaWebSocket(
    command: string,
    execOptions: SandboxExecOptions,
    spawnOptions?: SpawnOptions
  ): Promise<SpawnHandle> {
    const pid = this.pidCounter++
    let ws: WebSocket | null = null

    const { promise: donePromise, resolve: resolveDone } = withResolvers<BashResult>()

    let stdout = ''
    let stderr = ''
    let exitCode = 0

    try {
      // Build WebSocket URL with session and command info
      const wsUrl = new URL(this.wsEndpoint!)
      wsUrl.searchParams.set('session', this.sessionId)
      wsUrl.searchParams.set('command', command)
      if (execOptions.cwd) wsUrl.searchParams.set('cwd', execOptions.cwd)

      // Create WebSocket connection
      ws = new WebSocket(wsUrl.toString())

      ws.addEventListener('open', () => {
        // Send initial configuration
        ws!.send(JSON.stringify({
          type: 'init',
          env: execOptions.env,
          timeout: execOptions.timeout,
        }))
      })

      ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type: 'stdout' | 'stderr' | 'exit' | 'error'
            data?: string | number
          }

          switch (message.type) {
            case 'stdout': {
              const outData = String(message.data ?? '')
              stdout += outData
              spawnOptions?.onStdout?.(outData)
              break
            }
            case 'stderr': {
              const errData = String(message.data ?? '')
              stderr += errData
              spawnOptions?.onStderr?.(errData)
              break
            }
            case 'exit':
              exitCode = Number(message.data ?? 0)
              ws?.close()
              break
            case 'error':
              stderr += String(message.data ?? '')
              exitCode = 1
              ws?.close()
              break
          }
        } catch {
          // Handle non-JSON messages as stdout
          const data = String(event.data)
          stdout += data
          spawnOptions?.onStdout?.(data)
        }
      })

      ws.addEventListener('close', () => {
        spawnOptions?.onExit?.(exitCode)
        resolveDone({ command, stdout, stderr, exitCode })
      })

      ws.addEventListener('error', (event: Event) => {
        stderr += `WebSocket error: ${event}`
        exitCode = 1
      })
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
      exitCode = 1
      resolveDone({ command, stdout, stderr, exitCode })
    }

    const handle: SpawnHandle = {
      pid,
      done: donePromise,
      kill: (signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'signal', signal: signal ?? 'SIGTERM' }))
          ws.close()
        }
      },
      write: (data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stdin', data }))
        }
      },
      closeStdin: () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stdin_close' }))
        }
      },
    }

    return handle
  }

  /**
   * Spawn a command by executing and simulating streaming output.
   */
  private async spawnViaExec(
    command: string,
    execOptions: SandboxExecOptions,
    spawnOptions?: SpawnOptions
  ): Promise<SpawnHandle> {
    const pid = this.pidCounter++

    const executeAndStream = async (): Promise<BashResult> => {
      const result = await this.execute(command, {
        cwd: execOptions.cwd,
        timeout: execOptions.timeout,
        env: execOptions.env,
        stdin: execOptions.stdin,
      })

      // Simulate streaming by emitting all output at once
      if (result.stdout) {
        spawnOptions?.onStdout?.(result.stdout)
      }
      if (result.stderr) {
        spawnOptions?.onStderr?.(result.stderr)
      }
      spawnOptions?.onExit?.(result.exitCode)

      return result
    }

    const handle: SpawnHandle = {
      pid,
      done: executeAndStream(),
      kill: () => {
        // Cannot kill a non-streaming execution
      },
      write: () => {
        // Cannot write to a non-streaming execution
      },
      closeStdin: () => {
        // No-op
      },
    }

    return handle
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Get the current session ID.
   *
   * @returns The session ID
   */
  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Get the current session state.
   *
   * @returns Copy of the session state
   */
  getSessionState(): Omit<SessionState, 'processes'> & { processCount: number } {
    return {
      id: this.session.id,
      cwd: this.session.cwd,
      env: { ...this.session.env },
      lastActivity: this.session.lastActivity,
      processCount: this.session.processes.size,
    }
  }

  /**
   * Update the session working directory.
   *
   * @param cwd - New working directory
   */
  setCwd(cwd: string): void {
    this.session.cwd = cwd
  }

  /**
   * Update session environment variables.
   *
   * @param env - Environment variables to set
   */
  setEnv(env: Record<string, string>): void {
    Object.assign(this.session.env, env)
  }

  /**
   * Unset session environment variables.
   *
   * @param keys - Environment variable keys to unset
   */
  unsetEnv(keys: string[]): void {
    for (const key of keys) {
      delete this.session.env[key]
    }
  }

  /**
   * Get the number of active processes.
   *
   * @returns Number of active processes
   */
  getActiveProcessCount(): number {
    return this.session.processes.size
  }

  /**
   * Kill all active processes.
   *
   * @param signal - Signal to send (default: SIGTERM)
   */
  async killAll(signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' = 'SIGTERM'): Promise<void> {
    const kills = Array.from(this.session.processes.values()).map(handle =>
      handle.kill(signal)
    )
    await Promise.all(kills)
    this.session.processes.clear()
  }

  // ===========================================================================
  // File Operations (when sandbox supports it)
  // ===========================================================================

  /**
   * Write a file to the container filesystem.
   *
   * @param path - File path
   * @param content - File content
   */
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.sandbox?.writeFile) {
      await this.sandbox.writeFile(path, content)
    } else if (this.httpExecEndpoint) {
      // Use HTTP endpoint for file writing
      const bodyContent = typeof content === 'string' ? content : new Uint8Array(content).buffer
      await this.fetchFn(this.httpExecEndpoint.replace('/exec', '/file'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Session-Id': this.sessionId,
          'X-File-Path': path,
        },
        body: bodyContent as BodyInit,
      })
    } else {
      throw new Error('File operations not supported by this executor')
    }
  }

  /**
   * Read a file from the container filesystem.
   *
   * @param path - File path
   * @returns File content
   */
  async readFile(path: string): Promise<string | Uint8Array> {
    if (this.sandbox?.readFile) {
      return await this.sandbox.readFile(path)
    } else if (this.httpExecEndpoint) {
      // Use HTTP endpoint for file reading
      const response = await this.fetchFn(this.httpExecEndpoint.replace('/exec', '/file'), {
        method: 'GET',
        headers: {
          'X-Session-Id': this.sessionId,
          'X-File-Path': path,
        },
      })

      if (!response.ok) {
        throw new Error(`File read failed: ${response.status}`)
      }

      return await response.text()
    } else {
      throw new Error('File operations not supported by this executor')
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CloudflareContainerExecutor instance.
 *
 * @param options - Configuration options
 * @returns A new CloudflareContainerExecutor instance
 *
 * @example
 * ```typescript
 * const executor = createContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'user-123',
 * })
 * ```
 */
export function createContainerExecutor(
  options: ContainerExecutorOptions = {}
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor(options)
}

/**
 * Create an executor from a Sandbox binding.
 *
 * @param sandbox - Cloudflare Sandbox binding
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createSandboxExecutor(
  sandbox: CloudflareSandbox,
  sessionId?: string
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor({ sandbox, sessionId })
}

/**
 * Create an executor from an HTTP exec endpoint.
 *
 * @param endpoint - HTTP exec endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createHttpExecutor(
  endpoint: string,
  sessionId?: string
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor({ httpExecEndpoint: endpoint, sessionId })
}

/**
 * Create an executor from a WebSocket endpoint.
 *
 * @param endpoint - WebSocket endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createWebSocketExecutor(
  endpoint: string,
  sessionId?: string
): CloudflareContainerExecutor {
  return new CloudflareContainerExecutor({ wsEndpoint: endpoint, sessionId })
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a CloudflareContainerExecutor instance.
 *
 * @param value - Value to check
 * @returns True if value is a CloudflareContainerExecutor
 */
export function isContainerExecutor(value: unknown): value is CloudflareContainerExecutor {
  return value instanceof CloudflareContainerExecutor
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Promise.withResolvers polyfill for older environments.
 */
function withResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve: (value: T) => void
  let reject: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve: resolve!, reject: reject! }
}
