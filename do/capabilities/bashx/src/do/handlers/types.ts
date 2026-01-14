/**
 * Command Handler Types
 *
 * Defines the Strategy pattern interface for command handlers.
 * Each handler implements this interface to handle specific command categories.
 *
 * @module src/do/handlers/types
 */

import type { BashResult, ExecOptions, FsCapability } from '../../types.js'

/**
 * Context provided to command handlers.
 * Contains capabilities and services needed for command execution.
 */
export interface CommandHandlerContext {
  /**
   * Filesystem capability for file operations.
   * Required for handlers that perform filesystem operations.
   */
  fs?: FsCapability
}

/**
 * Strategy interface for command handlers.
 *
 * Each handler is responsible for a category of commands (fs, http, crypto, etc.)
 * and implements the Strategy pattern for command execution.
 *
 * @example
 * ```typescript
 * class FsCommandHandler implements CommandHandler {
 *   readonly name = 'fs'
 *
 *   canHandle(command: string): boolean {
 *     return ['ls', 'cat', 'head', 'tail'].includes(command)
 *   }
 *
 *   async execute(command: string, args: string[], options?: ExecOptions): Promise<BashResult> {
 *     // Execute the command...
 *   }
 * }
 * ```
 */
export interface CommandHandler {
  /**
   * Name of this handler (e.g., 'fs', 'http', 'crypto').
   * Used for identification and logging.
   */
  readonly name: string

  /**
   * Check if this handler can handle the given command.
   *
   * @param command - The command name (e.g., 'ls', 'cat')
   * @returns true if this handler can execute the command
   */
  canHandle(command: string): boolean

  /**
   * Execute the command with the given arguments.
   *
   * @param command - The command name to execute
   * @param args - Command arguments
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   * @throws Error if the command is not supported
   */
  execute(command: string, args: string[], options?: ExecOptions): Promise<BashResult>
}
