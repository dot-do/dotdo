/**
 * Local type definitions for @dotdo/mcp
 *
 * These types define the minimal interface needed by MCP tools to interact
 * with WorkflowContext, without creating a direct dependency on @dotdo/do.
 *
 * This breaks the bidirectional dependency: @dotdo/do -> @dotdo/mcp would
 * create a cycle with @dotdo/mcp -> @dotdo/do.
 */

/**
 * Options for $.do() durable action execution
 * Mirrors DoOptions from @dotdo/do
 */
export interface DoOptions {
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Backoff strategy: 'linear' or 'exponential' (default: 'exponential') */
  backoff?: 'linear' | 'exponential'
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Minimal WorkflowContext interface for MCP sandbox operations.
 *
 * This defines only the methods actually used by the sandbox:
 * - send(): Fire-and-forget event emission
 * - try(): Single attempt action execution
 * - do(): Durable action execution with retries
 *
 * The full WorkflowContext from @dotdo/do includes additional features
 * (on, every, integrations, etc.) that the sandbox doesn't directly invoke.
 */
export interface WorkflowContext {
  /** Fire-and-forget event emission */
  send(event: { type: string; payload?: unknown }): void

  /** Single attempt (no retries) */
  try<T>(action: () => Promise<T>): Promise<T>

  /** Durable with retries */
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>
}
