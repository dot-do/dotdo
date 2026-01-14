/**
 * executeOrBlock Pipeline Stage
 *
 * Executes commands or returns blocked status based on gate decisions.
 * This is an independently callable pipeline stage that handles the actual
 * command execution or blocked result generation.
 *
 * @module src/mcp/pipeline/execute
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { GateResult } from './gate.js'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

/**
 * Options for command execution.
 */
export interface ExecuteOptions {
  /**
   * Timeout in milliseconds for command execution.
   * @default 30000
   */
  timeout?: number

  /**
   * Working directory for command execution.
   * @default process.cwd()
   */
  cwd?: string

  /**
   * Environment variables for the command.
   */
  env?: Record<string, string>
}

/**
 * Input for the executeOrBlock stage.
 */
export interface ExecuteInput {
  /**
   * The command to execute.
   */
  command: string

  /**
   * Result from the gate stage indicating if command is blocked.
   */
  gateResult: GateResult

  /**
   * Optional execution options.
   */
  options?: ExecuteOptions
}

/**
 * Result from the executeOrBlock stage.
 */
export interface ExecuteResult {
  /**
   * Whether the command was executed.
   * - true: Command was run
   * - false: Command was blocked
   */
  executed: boolean

  /**
   * Whether the command was blocked by the gate.
   * Only present when executed is false.
   */
  blocked?: boolean

  /**
   * Reason for blocking.
   * Only present when blocked is true.
   */
  blockReason?: string

  /**
   * Standard output from the command.
   * Only present when executed is true.
   */
  stdout?: string

  /**
   * Standard error from the command.
   * Only present when executed is true.
   */
  stderr?: string

  /**
   * Exit code from the command.
   * Only present when executed is true.
   */
  exitCode?: number
}

/**
 * Error type for child_process exec errors.
 */
interface ExecError extends Error {
  code?: number
  killed?: boolean
  stdout?: Buffer | string
  stderr?: Buffer | string
}

/**
 * Type guard to check if an error is an ExecError.
 */
function isExecError(error: unknown): error is ExecError {
  if (!(error instanceof Error)) {
    return false
  }
  const err = error as unknown as Record<string, unknown>
  return 'code' in err || 'killed' in err || 'stdout' in err || 'stderr' in err
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a command or return blocked status based on gate result.
 *
 * This pipeline stage handles the final decision to execute or block:
 * - If gateResult.blocked is true, returns blocked result without execution
 * - If gateResult.blocked is false, executes the command and returns result
 *
 * @param input - The execute input containing command, gate result, and options
 * @returns Promise resolving to execute result
 *
 * @example
 * ```typescript
 * // Execute when not blocked
 * const result = await executeOrBlock({
 *   command: 'echo hello',
 *   gateResult: { blocked: false, requiresConfirm: false }
 * })
 * // { executed: true, stdout: 'hello\n', stderr: '', exitCode: 0 }
 *
 * // Block when gate says blocked
 * const result = await executeOrBlock({
 *   command: 'rm -rf /',
 *   gateResult: { blocked: true, requiresConfirm: true, blockReason: 'Dangerous' }
 * })
 * // { executed: false, blocked: true, blockReason: 'Dangerous' }
 * ```
 */
export async function executeOrBlock(input: ExecuteInput): Promise<ExecuteResult> {
  const { command, gateResult, options } = input

  // If gate blocked the command, return blocked result
  if (gateResult.blocked) {
    return {
      executed: false,
      blocked: true,
      blockReason: gateResult.blockReason,
    }
  }

  // Handle empty command - return success like bash does
  if (!command || command.trim() === '') {
    return {
      executed: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    }
  }

  // Execute the command
  const timeout = options?.timeout ?? 30000
  const cwd = options?.cwd ?? process.cwd()
  const env = options?.env ? { ...process.env, ...options.env } : process.env

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      env,
    })

    return {
      executed: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    }
  } catch (error: unknown) {
    // Handle timeout (killed by signal)
    if (isExecError(error) && error.killed) {
      return {
        executed: true,
        stdout: error.stdout?.toString() ?? '',
        stderr: error.stderr?.toString() ?? 'Command timed out',
        exitCode: 124, // Standard timeout exit code
      }
    }

    // Handle command failure (non-zero exit)
    if (isExecError(error)) {
      return {
        executed: true,
        stdout: error.stdout?.toString() ?? '',
        stderr: error.stderr?.toString() ?? error.message,
        exitCode: error.code ?? 1,
      }
    }

    // Unknown error
    return {
      executed: true,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Unknown error',
      exitCode: 1,
    }
  }
}
