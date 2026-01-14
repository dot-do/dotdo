/**
 * Shell RPC Types
 *
 * Interfaces for remote shell execution via Cap'n Web RPC.
 * These types define the contract for ShellApi and ShellStream
 * that enable remote process spawning, streaming I/O, and lifecycle management.
 *
 * @packageDocumentation
 */

// ============================================================================
// ShellResult - Result of command execution
// ============================================================================

/**
 * Result of a shell command execution.
 * Returned by ShellApi.exec() after command completes.
 */
export interface ShellResult {
  /** Standard output from the command */
  stdout: string

  /** Standard error output from the command */
  stderr: string

  /** Exit code of the process (0 = success) */
  exitCode: number

  /** Signal that terminated the process, if any (e.g., 'SIGTERM', 'SIGKILL') */
  signal?: string

  /** Whether the command timed out */
  timedOut?: boolean

  /** Execution duration in milliseconds */
  duration?: number
}

// ============================================================================
// ShellExecOptions - Options for exec()
// ============================================================================

/**
 * Options for ShellApi.exec() command execution.
 */
export interface ShellExecOptions {
  /** Working directory for command execution */
  cwd?: string

  /** Environment variables to set (merged with process env) */
  env?: Record<string, string>

  /** Timeout in milliseconds. Command is killed if exceeded. */
  timeout?: number

  /** Maximum output size in bytes. Truncates if exceeded. */
  maxOutput?: number

  /** Shell to use (defaults to /bin/sh) */
  shell?: string
}

// ============================================================================
// ShellSpawnOptions - Options for spawn()
// ============================================================================

/**
 * Options for ShellApi.spawn() process spawning.
 */
export interface ShellSpawnOptions {
  /** Working directory for the spawned process */
  cwd?: string

  /** Environment variables to set (merged with process env) */
  env?: Record<string, string>

  /** Shell to use (defaults to /bin/sh) */
  shell?: string

  /** Initial terminal dimensions (cols x rows) */
  cols?: number
  rows?: number
}

// ============================================================================
// ShellStream - Streaming process handle
// ============================================================================

/**
 * Callback for receiving stdout/stderr data chunks.
 * @param chunk - The data chunk as a string
 */
export type ShellDataCallback = (chunk: string) => void

/**
 * Callback for process exit.
 * @param exitCode - The process exit code
 * @param signal - The signal that terminated the process, if any
 */
export type ShellExitCallback = (exitCode: number, signal?: string) => void

/**
 * Handle to a spawned process with streaming I/O capabilities.
 * Returned by ShellApi.spawn() for interactive process control.
 *
 * Implements Symbol.dispose for automatic cleanup via `using` syntax.
 *
 * @example
 * ```typescript
 * const stream = api.spawn('cat')
 * stream.onData((chunk) => console.log('stdout:', chunk))
 * stream.onStderr((chunk) => console.error('stderr:', chunk))
 * stream.onExit((code) => console.log('exited with:', code))
 * stream.write('hello\n')
 * stream.closeStdin()
 * await stream.wait()
 * ```
 */
export interface ShellStream {
  /** Process ID of the spawned process */
  readonly pid: number

  /**
   * Write data to the process stdin.
   * @param data - String to write to stdin
   */
  write(data: string): void

  /**
   * Close the stdin stream, signaling EOF to the process.
   */
  closeStdin(): void

  /**
   * Terminate the process with the specified signal.
   * @param signal - Signal to send (defaults to 'SIGTERM')
   */
  kill(signal?: string): void

  /**
   * Register a callback for stdout data.
   * Multiple callbacks can be registered.
   * Late-registered callbacks receive any buffered data.
   * @param callback - Function to call with each stdout chunk
   * @returns Unsubscribe function
   */
  onData(callback: ShellDataCallback): () => void

  /**
   * Register a callback for stderr data.
   * Multiple callbacks can be registered.
   * Late-registered callbacks receive any buffered data.
   * @param callback - Function to call with each stderr chunk
   * @returns Unsubscribe function
   */
  onStderr(callback: ShellDataCallback): () => void

  /**
   * Register a callback for process exit.
   * @param callback - Function to call when process exits
   * @returns Unsubscribe function
   */
  onExit(callback: ShellExitCallback): () => void

  /**
   * Wait for the process to complete.
   * @returns Promise that resolves with the final ShellResult
   */
  wait(): Promise<ShellResult>

  /**
   * Dispose of the stream, killing the process if still running.
   * Called automatically when using `using` syntax.
   */
  [Symbol.dispose](): void
}

// ============================================================================
// ShellApi - Main API interface
// ============================================================================

/**
 * Shell execution API for remote process management.
 * Provides both synchronous-style exec() and streaming spawn().
 *
 * @example
 * ```typescript
 * // Synchronous execution
 * const result = await api.exec('ls -la', { cwd: '/tmp' })
 * console.log(result.stdout)
 *
 * // Streaming execution
 * const stream = api.spawn('tail -f /var/log/syslog')
 * stream.onData((line) => console.log(line))
 * // later...
 * stream.kill()
 * ```
 */
export interface ShellApi {
  /**
   * Execute a command and wait for completion.
   * Returns the full output after the command finishes.
   *
   * @param command - The shell command to execute
   * @param options - Execution options (cwd, env, timeout, etc.)
   * @returns Promise resolving to the command result
   */
  exec(command: string, options?: ShellExecOptions): Promise<ShellResult>

  /**
   * Spawn a process with streaming I/O.
   * Returns immediately with a ShellStream handle for interaction.
   *
   * @param command - The shell command to spawn
   * @param options - Spawn options (cwd, env, etc.)
   * @returns ShellStream handle for process interaction
   */
  spawn(command: string, options?: ShellSpawnOptions): ShellStream
}
