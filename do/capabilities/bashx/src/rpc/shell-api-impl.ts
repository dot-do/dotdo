/**
 * ShellApiImpl - Shell execution API implementation
 *
 * Implements the ShellApi interface using Node.js child_process module.
 * Provides both synchronous-style exec() and streaming spawn() methods.
 *
 * @packageDocumentation
 */

import { spawn, exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
} from '../../core/rpc/types.js'
import { ShellStreamImpl } from './shell-stream-impl.js'

const execPromise = promisify(execCb)

/**
 * Implementation of ShellApi interface using Node.js child_process.
 * Provides both exec() for one-shot commands and spawn() for streaming I/O.
 */
export class ShellApiImpl implements ShellApi {
  /**
   * Execute a command and wait for completion.
   * Returns the full output after the command finishes.
   *
   * @param command - The shell command to execute
   * @param options - Execution options (cwd, env, timeout, etc.)
   * @returns Promise resolving to the command result
   */
  async exec(command: string, options: ShellExecOptions = {}): Promise<ShellResult> {
    const startTime = Date.now()
    const shell = options.shell ?? '/bin/sh'
    const cwd = options.cwd
    const timeout = options.timeout
    const maxOutput = options.maxOutput

    // Merge environment variables
    const env = options.env ? { ...process.env, ...options.env } : process.env

    try {
      const execOptions: Parameters<typeof execPromise>[1] = {
        shell,
        env,
        timeout,
        maxBuffer: maxOutput ?? 10 * 1024 * 1024, // 10MB default
        encoding: 'utf-8' as const,
      }

      // Add cwd if specified
      if (cwd) {
        execOptions.cwd = cwd
      }

      const result = await execPromise(command, execOptions)
      const duration = Date.now() - startTime

      return {
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        exitCode: 0,
        duration,
      }
    } catch (error: unknown) {
      const duration = Date.now() - startTime

      // Handle ExecException from child_process
      if (error && typeof error === 'object' && 'code' in error) {
        const execError = error as {
          code?: number | string
          signal?: string
          killed?: boolean
          stdout?: string
          stderr?: string
          message?: string
        }

        // Check for timeout kill
        const timedOut = execError.killed === true && execError.signal === 'SIGTERM'

        // Handle cwd error (ENOENT on the directory)
        if (execError.code === 'ENOENT' && cwd) {
          return {
            stdout: '',
            stderr: `exec: ${cwd}: No such file or directory`,
            exitCode: 1,
            duration,
          }
        }

        return {
          stdout: execError.stdout ?? '',
          stderr: execError.stderr ?? '',
          exitCode: typeof execError.code === 'number' ? execError.code : 1,
          signal: execError.signal,
          timedOut,
          duration,
        }
      }

      // Unknown error
      return {
        stdout: '',
        stderr: String(error),
        exitCode: 1,
        duration,
      }
    }
  }

  /**
   * Spawn a process with streaming I/O.
   * Returns immediately with a ShellStream handle for interaction.
   *
   * @param command - The shell command to spawn
   * @param options - Spawn options (cwd, env, etc.)
   * @returns ShellStream handle for process interaction
   */
  spawn(command: string, options: ShellSpawnOptions = {}): ShellStream {
    const shell = options.shell ?? '/bin/sh'
    const cwd = options.cwd

    // Merge environment variables
    const env = options.env ? { ...process.env, ...options.env } : process.env

    // Spawn the process using shell
    const childProcess = spawn(shell, ['-c', command], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return new ShellStreamImpl(childProcess)
  }
}

/**
 * Create a new ShellApiImpl instance.
 * Factory function for creating ShellApi implementations.
 */
export function createShellApi(): ShellApi {
  return new ShellApiImpl()
}
