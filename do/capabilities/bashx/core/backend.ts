/**
 * Shell Backend Interface
 *
 * Abstract interface for shell execution backends.
 * Platform-specific implementations (e.g., DurableObjectBackend, NodeBackend)
 * should live outside the core package.
 *
 * @packageDocumentation
 */

/**
 * Result of a shell command execution
 */
export interface ShellResult {
  /** Exit code of the command (0 = success) */
  exitCode: number

  /** Standard output */
  stdout: string

  /** Standard error output */
  stderr: string

  /** Whether the command was successful (exitCode === 0) */
  success: boolean

  /** Execution duration in milliseconds */
  duration?: number

  /** Signal that terminated the process, if any */
  signal?: string
}

/**
 * Options for shell command execution
 */
export interface ShellOptions {
  /** Working directory for command execution */
  cwd?: string

  /** Environment variables to set */
  env?: Record<string, string>

  /** Timeout in milliseconds */
  timeout?: number

  /** Maximum output size in bytes */
  maxOutput?: number

  /** Shell to use (e.g., '/bin/bash', '/bin/sh') */
  shell?: string

  /** Whether to combine stdout and stderr */
  combineOutput?: boolean
}

/**
 * Abstract interface for shell execution backends.
 *
 * Implementations should provide platform-specific execution logic while
 * conforming to this common interface.
 *
 * @example
 * ```typescript
 * // Node.js implementation (outside core)
 * class NodeShellBackend implements ShellBackend {
 *   async execute(command: string, options?: ShellOptions): Promise<ShellResult> {
 *     const { execSync } = await import('child_process')
 *     // ... implementation
 *   }
 * }
 *
 * // Durable Object implementation (outside core)
 * class DurableObjectBackend implements ShellBackend {
 *   async execute(command: string, options?: ShellOptions): Promise<ShellResult> {
 *     // Use container execution via Cloudflare APIs
 *   }
 * }
 * ```
 */
export interface ShellBackend {
  /**
   * Execute a shell command
   *
   * @param command - The command to execute
   * @param options - Execution options
   * @returns Result of the command execution
   */
  execute(command: string, options?: ShellOptions): Promise<ShellResult>

  /**
   * Check if the backend is available and ready
   *
   * @returns true if the backend can execute commands
   */
  isReady(): Promise<boolean>

  /**
   * Get information about the backend
   *
   * @returns Backend metadata
   */
  getInfo(): Promise<BackendInfo>
}

/**
 * Information about a shell backend
 */
export interface BackendInfo {
  /** Name of the backend */
  name: string

  /** Version of the backend */
  version: string

  /** Platform the backend runs on */
  platform: string

  /** Available shells */
  shells: string[]

  /** Maximum command length */
  maxCommandLength?: number

  /** Maximum execution time */
  maxTimeout?: number

  /** Backend-specific capabilities */
  capabilities?: string[]
}
