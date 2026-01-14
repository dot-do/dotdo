/**
 * Cloudflare Container Executor
 *
 * Implements the BashExecutor interface using Cloudflare Containers
 * for executing bash commands in a sandboxed Linux environment.
 *
 * This executor is designed for Tier 4 execution in the bashx tiered model:
 * - Shell scripts with bash-specific features
 * - Python with native C extensions
 * - Binary executables (ffmpeg, imagemagick, etc.)
 *
 * @module bashx/do/container-executor
 */

import type { BashExecutor } from './index.js'
import type { BashResult, ExecOptions, SpawnOptions, SpawnHandle } from '../types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Cloudflare Container stub interface.
 * Based on @cloudflare/containers package API.
 */
export interface ContainerStub {
  /**
   * Fetch method to make HTTP requests to the container.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * Function type for getting a container instance.
 * Matches the signature from @cloudflare/containers: getContainer(binding, name?)
 */
export type GetContainerFn = (binding: unknown, name?: string) => ContainerStub

/**
 * Configuration for the CloudflareContainerExecutor.
 */
export interface ContainerExecutorConfig {
  /**
   * The container binding from env.
   * This is typically configured in wrangler.toml/jsonc.
   *
   * @example
   * ```typescript
   * // In wrangler.toml:
   * // [[containers]]
   * // binding = "BASH_CONTAINER"
   * // class_name = "BashContainer"
   * // image = "./containers/bash"
   *
   * const executor = new CloudflareContainerExecutor({
   *   containerBinding: env.BASH_CONTAINER,
   * })
   * ```
   */
  containerBinding: unknown

  /**
   * Optional function to get container instance.
   * Defaults to using the binding directly as a stub.
   *
   * Use this when you need named container instances for isolation:
   * ```typescript
   * import { getContainer } from '@cloudflare/containers'
   *
   * const executor = new CloudflareContainerExecutor({
   *   containerBinding: env.BASH_CONTAINER,
   *   getContainer: (binding, name) => getContainer(binding, name),
   *   containerName: 'my-session-id'
   * })
   * ```
   */
  getContainer?: GetContainerFn

  /**
   * Optional name for the container instance.
   * When provided with getContainer, creates an isolated instance.
   * Useful for session-based isolation.
   */
  containerName?: string

  /**
   * Base path for the execution API in the container.
   * The container should expose endpoints like:
   * - POST /exec - Execute a command
   * - POST /spawn - Spawn a streaming process
   *
   * @default '/api'
   */
  apiBasePath?: string

  /**
   * Default timeout for command execution in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number

  /**
   * Maximum output size in bytes before truncation.
   * @default 1048576 (1MB)
   */
  maxOutputSize?: number
}

/**
 * Request body for the container's /exec endpoint.
 */
interface ExecRequest {
  command: string
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  timeout?: number
  maxOutputSize?: number
}

/**
 * Response from the container's /exec endpoint.
 */
interface ExecResponse {
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
  truncated?: boolean
}

/**
 * Response from the container's /spawn endpoint.
 */
interface SpawnResponse {
  pid: number
  streamUrl?: string
}

// ============================================================================
// EXECUTOR CLASS
// ============================================================================

/**
 * CloudflareContainerExecutor - Execute bash commands via Cloudflare Containers.
 *
 * This executor sends commands to a Cloudflare Container running a bash
 * execution service. The container should expose HTTP endpoints for
 * command execution.
 *
 * ## Container Requirements
 *
 * The container should implement these endpoints:
 *
 * - `POST /api/exec` - Execute a command synchronously
 *   - Request: `{ command: string, cwd?: string, env?: Record<string, string>, stdin?: string, timeout?: number }`
 *   - Response: `{ stdout: string, stderr: string, exitCode: number, timedOut?: boolean }`
 *
 * - `POST /api/spawn` - Spawn a command for streaming (optional)
 *   - Request: `{ command: string, args?: string[], cwd?: string, env?: Record<string, string> }`
 *   - Response: `{ pid: number, streamUrl: string }`
 *
 * @example Basic usage
 * ```typescript
 * const executor = new CloudflareContainerExecutor({
 *   containerBinding: env.BASH_CONTAINER,
 * })
 *
 * const result = await executor.execute('ls -la /app')
 * console.log(result.stdout)
 * ```
 *
 * @example With named container instance for session isolation
 * ```typescript
 * import { getContainer } from '@cloudflare/containers'
 *
 * const executor = new CloudflareContainerExecutor({
 *   containerBinding: env.BASH_CONTAINER,
 *   getContainer,
 *   containerName: `session-${sessionId}`,
 * })
 * ```
 *
 * @example With BashModule
 * ```typescript
 * import { BashModule, CloudflareContainerExecutor } from 'bashx/do'
 *
 * const executor = new CloudflareContainerExecutor({
 *   containerBinding: env.BASH_CONTAINER,
 * })
 *
 * const bash = new BashModule(executor)
 * const result = await bash.exec('npm', ['install'])
 * ```
 */
export class CloudflareContainerExecutor implements BashExecutor {
  private readonly containerBinding: unknown
  private readonly getContainerFn?: GetContainerFn
  private readonly containerName?: string
  private readonly apiBasePath: string
  private readonly defaultTimeout: number
  private readonly maxOutputSize: number

  /**
   * Cached container stub for reuse.
   */
  private containerStub?: ContainerStub

  /**
   * Create a new CloudflareContainerExecutor.
   *
   * @param config - Configuration options
   */
  constructor(config: ContainerExecutorConfig) {
    this.containerBinding = config.containerBinding
    this.getContainerFn = config.getContainer
    this.containerName = config.containerName
    this.apiBasePath = config.apiBasePath ?? '/api'
    this.defaultTimeout = config.defaultTimeout ?? 30000
    this.maxOutputSize = config.maxOutputSize ?? 1048576
  }

  /**
   * Get the container stub, creating it if necessary.
   */
  private getContainer(): ContainerStub {
    if (this.containerStub) {
      return this.containerStub
    }

    if (this.getContainerFn) {
      this.containerStub = this.getContainerFn(this.containerBinding, this.containerName)
    } else {
      // Assume the binding itself is a container stub
      this.containerStub = this.containerBinding as ContainerStub
    }

    return this.containerStub
  }

  /**
   * Execute a command and return the result.
   *
   * Sends the command to the container's /exec endpoint and waits
   * for the result.
   *
   * @param command - The command string to execute
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    const container = this.getContainer()

    const execRequest: ExecRequest = {
      command,
      cwd: options?.cwd,
      env: options?.env,
      stdin: options?.stdin,
      timeout: options?.timeout ?? this.defaultTimeout,
      maxOutputSize: options?.maxOutputSize ?? this.maxOutputSize,
    }

    try {
      const response = await container.fetch(`${this.apiBasePath}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(execRequest),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return this.createErrorResult(command, `Container request failed: ${response.status} ${errorText}`)
      }

      const execResponse: ExecResponse = await response.json()

      return this.createResult(command, execResponse, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.createErrorResult(command, `Container execution failed: ${message}`)
    }
  }

  /**
   * Spawn a command for streaming execution.
   *
   * This method requires the container to support the /spawn endpoint
   * and WebSocket streaming.
   *
   * @param command - The command to spawn
   * @param args - Optional command arguments
   * @param options - Optional spawn options
   * @returns Promise resolving to a spawn handle
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    const container = this.getContainer()

    const spawnRequest = {
      command,
      args,
      cwd: options?.cwd,
      env: options?.env,
    }

    const response = await container.fetch(`${this.apiBasePath}/spawn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(spawnRequest),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Container spawn failed: ${response.status} ${errorText}`)
    }

    const spawnResponse: SpawnResponse = await response.json()

    // Create a promise that will resolve when the process exits
    let resolveExit: (result: BashResult) => void
    let rejectExit: (error: Error) => void

    const donePromise = new Promise<BashResult>((resolve, reject) => {
      resolveExit = resolve
      rejectExit = reject
    })

    // Collected output
    let stdout = ''
    let stderr = ''
    let exitCode = 0

    // If there's a stream URL, connect to it
    if (spawnResponse.streamUrl) {
      try {
        // Connect to WebSocket stream for output
        // This would need WebSocket support in the container
        const streamResponse = await container.fetch(spawnResponse.streamUrl, {
          headers: {
            Upgrade: 'websocket',
          },
        })

        // Handle WebSocket stream
        // Note: In a real implementation, we'd need to handle the WebSocket connection
        // This is simplified for the interface definition
        if (streamResponse.webSocket) {
          const ws = streamResponse.webSocket
          ws.accept()

          ws.addEventListener('message', (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data as string)
              if (data.type === 'stdout') {
                stdout += data.data
                options?.onStdout?.(data.data)
              } else if (data.type === 'stderr') {
                stderr += data.data
                options?.onStderr?.(data.data)
              } else if (data.type === 'exit') {
                exitCode = data.exitCode
                options?.onExit?.(exitCode)
                resolveExit(this.createResult(command, { stdout, stderr, exitCode }))
              }
            } catch {
              // Ignore parse errors
            }
          })

          ws.addEventListener('error', () => {
            rejectExit(new Error('WebSocket stream error'))
          })

          ws.addEventListener('close', () => {
            // If we haven't received an exit event, resolve with what we have
            resolveExit(this.createResult(command, { stdout, stderr, exitCode }))
          })
        }
      } catch (error) {
        rejectExit!(error instanceof Error ? error : new Error(String(error)))
      }
    }

    return {
      pid: spawnResponse.pid,
      done: donePromise,

      kill: async (signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' = 'SIGTERM') => {
        try {
          await container.fetch(`${this.apiBasePath}/kill`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pid: spawnResponse.pid, signal }),
          })
        } catch {
          // Ignore kill errors
        }
      },

      write: async (data: string) => {
        try {
          await container.fetch(`${this.apiBasePath}/stdin`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pid: spawnResponse.pid, data }),
          })
        } catch {
          // Ignore write errors
        }
      },

      closeStdin: async () => {
        try {
          await container.fetch(`${this.apiBasePath}/stdin/close`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pid: spawnResponse.pid }),
          })
        } catch {
          // Ignore close errors
        }
      },
    }
  }

  /**
   * Create a BashResult from an execution response.
   */
  private createResult(command: string, response: ExecResponse, options?: ExecOptions): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: response.stdout,
      stderr: response.stderr,
      exitCode: response.exitCode,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: 'Executed via Cloudflare Container',
      },
      blocked: options?.dryRun,
      requiresConfirm: options?.elevated,
    }
  }

  /**
   * Create an error BashResult.
   */
  private createErrorResult(command: string, error: string): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: error,
      exitCode: 1,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: 'Container execution error',
      },
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a CloudflareContainerExecutor from environment bindings.
 *
 * This is a convenience factory for common use cases.
 *
 * @param env - The Worker environment containing the container binding
 * @param bindingName - The name of the container binding in env
 * @param options - Optional additional configuration
 * @returns A configured CloudflareContainerExecutor
 *
 * @example
 * ```typescript
 * // In your Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const executor = createContainerExecutor(env, 'BASH_CONTAINER')
 *     const bash = new BashModule(executor)
 *     const result = await bash.exec('echo', ['hello'])
 *     return new Response(result.stdout)
 *   }
 * }
 * ```
 */
export function createContainerExecutor(
  env: Record<string, unknown>,
  bindingName: string,
  options?: Omit<ContainerExecutorConfig, 'containerBinding'>,
): CloudflareContainerExecutor {
  const binding = env[bindingName]
  if (!binding) {
    throw new Error(`Container binding "${bindingName}" not found in environment`)
  }

  return new CloudflareContainerExecutor({
    containerBinding: binding,
    ...options,
  })
}

/**
 * Create a CloudflareContainerExecutor with session isolation.
 *
 * Each session gets its own container instance, useful for
 * multi-tenant scenarios or when you need isolated state.
 *
 * @param env - The Worker environment containing the container binding
 * @param bindingName - The name of the container binding in env
 * @param sessionId - Unique identifier for the session
 * @param getContainer - Function from @cloudflare/containers package
 * @param options - Optional additional configuration
 * @returns A configured CloudflareContainerExecutor
 *
 * @example
 * ```typescript
 * import { getContainer } from '@cloudflare/containers'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const sessionId = request.headers.get('X-Session-ID') || crypto.randomUUID()
 *     const executor = createSessionContainerExecutor(
 *       env,
 *       'BASH_CONTAINER',
 *       sessionId,
 *       getContainer
 *     )
 *     const bash = new BashModule(executor)
 *     // Each session has its own container instance
 *     const result = await bash.exec('pwd')
 *     return new Response(result.stdout)
 *   }
 * }
 * ```
 */
export function createSessionContainerExecutor(
  env: Record<string, unknown>,
  bindingName: string,
  sessionId: string,
  getContainer: GetContainerFn,
  options?: Omit<ContainerExecutorConfig, 'containerBinding' | 'getContainer' | 'containerName'>,
): CloudflareContainerExecutor {
  const binding = env[bindingName]
  if (!binding) {
    throw new Error(`Container binding "${bindingName}" not found in environment`)
  }

  return new CloudflareContainerExecutor({
    containerBinding: binding,
    getContainer,
    containerName: sessionId,
    ...options,
  })
}
