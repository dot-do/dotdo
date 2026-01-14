/**
 * ShellBackend Interface
 *
 * An abstraction layer for shell execution that supports both real and mock implementations.
 * This enables testing without actual shell access and provides a clean API for shell operations.
 */

/**
 * Options for execute() method
 */
export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string
  /** Environment variables to set for the command */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Standard input to pass to the command */
  stdin?: string
}

/**
 * Result from execute() method
 */
export interface ExecResult {
  /** Standard output from the command */
  stdout: string
  /** Standard error from the command */
  stderr: string
  /** Exit code of the command */
  exitCode: number
  /** Whether the command timed out */
  timedOut?: boolean
  /** Whether the command was aborted via AbortSignal */
  aborted?: boolean
  /** Whether the process was killed */
  killed?: boolean
  /** Signal that terminated the process (e.g., 'SIGTERM', 'SIGKILL') */
  signal?: string
}

/**
 * Options for spawn() method
 */
export interface SpawnOptions {
  /** Working directory for the command */
  cwd?: string
  /** Environment variables to set for the command */
  env?: Record<string, string>
  /** Whether to run in shell mode */
  shell?: boolean
}

/**
 * Writable stdin stream interface
 */
export interface StdinStream {
  /** Write data to stdin */
  write(data: string): void
  /** Close the stdin stream */
  end(): void
}

/**
 * Readable stream interface (stdout/stderr)
 */
export interface ReadableStream {
  /** Register a listener for data events */
  on(event: 'data', callback: (data: string) => void): void
  /** Register a listener for end events */
  on(event: 'end', callback: () => void): void
  /** Register a listener for error events */
  on(event: 'error', callback: (error: Error) => void): void
  on(event: string, callback: (...args: unknown[]) => void): void
}

/**
 * Handle to a spawned process
 */
export interface ShellProcess {
  /** Process ID */
  pid: number
  /** Writable stdin stream */
  stdin: StdinStream
  /** Readable stdout stream */
  stdout: ReadableStream
  /** Readable stderr stream */
  stderr: ReadableStream
  /** Kill the process with an optional signal */
  kill(signal?: string): void
  /** Wait for the process to complete and get the result */
  wait(): Promise<ExecResult>
}

/**
 * ShellBackend Interface
 *
 * Provides an abstraction for shell operations that can be implemented
 * by real shell backends or mock backends for testing.
 */
export interface ShellBackend {
  /**
   * Execute a command and wait for it to complete.
   *
   * @param command - The shell command to execute
   * @param options - Execution options (cwd, env, timeout, signal, stdin)
   * @returns Promise resolving to the execution result
   */
  execute(command: string, options?: ExecOptions): Promise<ExecResult>

  /**
   * Spawn a process without waiting for it to complete.
   *
   * @param command - The shell command to spawn
   * @param options - Spawn options (cwd, env, shell)
   * @returns A handle to the spawned process
   */
  spawn(command: string, options?: SpawnOptions): ShellProcess

  /**
   * Get the current environment variables.
   *
   * @returns A copy of the current environment variables
   */
  getEnv(): Record<string, string>

  /**
   * Set an environment variable.
   *
   * @param key - Environment variable name
   * @param value - Environment variable value
   */
  setEnv(key: string, value: string): void

  /**
   * Get the current working directory.
   *
   * @returns The current working directory path
   */
  getCwd(): string

  /**
   * Set the current working directory.
   *
   * @param path - The new working directory path
   * @throws Error if the path does not exist
   */
  setCwd(path: string): void
}
