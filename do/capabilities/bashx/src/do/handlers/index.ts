/**
 * Command Handlers Module
 *
 * Implements the Strategy pattern for command execution in bashx.
 * Each handler is responsible for a category of commands and implements
 * the CommandHandler interface.
 *
 * ## Architecture
 *
 * The handler system follows the Strategy pattern:
 * - `CommandHandler` interface defines the contract for all handlers
 * - Each handler (e.g., `FsCommandHandler`) handles a specific category
 * - `createHandlerRegistry()` creates a registry of all available handlers
 *
 * ## Usage
 *
 * ```typescript
 * import { createHandlerRegistry, FsCommandHandler } from './handlers/index.js'
 *
 * // Create a registry with all handlers
 * const registry = createHandlerRegistry({ fs: myFsCapability })
 *
 * // Find a handler for a command
 * const handler = registry.find(h => h.canHandle('ls'))
 * if (handler) {
 *   const result = await handler.execute('ls', ['-la'])
 * }
 *
 * // Or use a specific handler directly
 * const fsHandler = new FsCommandHandler({ fs: myFsCapability })
 * const result = await fsHandler.execute('cat', ['file.txt'])
 * ```
 *
 * @module src/do/handlers
 */

// Types
export type { CommandHandler, CommandHandlerContext } from './types.js'

// Handlers
export { FsCommandHandler } from './fs-handler.js'

// Registry
import type { CommandHandler, CommandHandlerContext } from './types.js'
import { FsCommandHandler } from './fs-handler.js'

/**
 * Handler registry - array of handlers for command dispatch.
 */
export type HandlerRegistry = CommandHandler[]

/**
 * Create a registry of command handlers.
 *
 * The registry contains all available handlers, initialized with the
 * provided context. Handlers that require capabilities not present in
 * the context are not included in the registry.
 *
 * @param context - Context containing capabilities for handlers
 * @returns Array of initialized command handlers
 *
 * @example
 * ```typescript
 * // Create registry with fs capability
 * const registry = createHandlerRegistry({ fs: myFsCapability })
 *
 * // Find handler for a command
 * const handler = registry.find(h => h.canHandle('ls'))
 *
 * // Execute command
 * if (handler) {
 *   const result = await handler.execute('ls', ['-la'])
 * }
 * ```
 */
export function createHandlerRegistry(context: CommandHandlerContext): HandlerRegistry {
  const handlers: CommandHandler[] = []

  // Add FsCommandHandler if fs capability is available
  if (context.fs) {
    handlers.push(new FsCommandHandler(context))
  }

  // Future handlers will be added here:
  // - HttpCommandHandler (curl, wget) - requires http capability
  // - CryptoCommandHandler (sha256sum, md5sum) - no deps, Web Crypto API
  // - TextCommandHandler (sed, awk, grep) - no deps, pure computation
  // - PosixCommandHandler (cut, sort, tr, uniq) - no deps, pure computation
  // - SystemCommandHandler (pwd, whoami, hostname) - no deps, returns constants
  // - DataCommandHandler (jq, yq, base64) - no deps, pure computation

  return handlers
}

/**
 * Find a handler that can execute the given command.
 *
 * Searches the registry for a handler that returns true from canHandle().
 *
 * @param registry - Handler registry to search
 * @param command - Command name to find handler for
 * @returns The handler if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const handler = findHandler(registry, 'ls')
 * if (handler) {
 *   const result = await handler.execute('ls', [])
 * }
 * ```
 */
export function findHandler(registry: HandlerRegistry, command: string): CommandHandler | undefined {
  return registry.find(h => h.canHandle(command))
}

/**
 * Execute a command using the appropriate handler from the registry.
 *
 * Convenience function that finds a handler and executes the command.
 * Throws if no handler is found for the command.
 *
 * @param registry - Handler registry to use
 * @param command - Command name to execute
 * @param args - Command arguments
 * @param options - Optional execution options
 * @returns Promise resolving to the execution result
 * @throws Error if no handler is found for the command
 *
 * @example
 * ```typescript
 * const result = await executeWithHandler(registry, 'ls', ['-la'])
 * console.log(result.stdout)
 * ```
 */
export async function executeWithHandler(
  registry: HandlerRegistry,
  command: string,
  args: string[],
  options?: import('../../types.js').ExecOptions
): Promise<import('../../types.js').BashResult> {
  const handler = findHandler(registry, command)
  if (!handler) {
    throw new Error(`No handler found for command: ${command}`)
  }
  return handler.execute(command, args, options)
}
