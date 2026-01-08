import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

/**
 * Actions Middleware
 *
 * Handles action invocation for different function types:
 * - CodeFunction: Synchronous code execution
 * - GenerativeFunction: Calls AI model for response
 * - AgenticFunction: Runs multi-step agent loop
 * - HumanFunction: Sends to human, waits for response
 *
 * Features:
 * - GET /api/actions to list available actions
 * - POST /api/actions/:action to invoke functions
 * - Permission checks before execution
 * - Timeout handling per function type
 *
 * NOT YET IMPLEMENTED - This is a stub for TDD.
 */

// ============================================================================
// Types
// ============================================================================

export interface CodeFunction {
  type: 'code'
  description?: string
  handler: (input: unknown, c: Context) => unknown | Promise<unknown>
  timeout?: number
  requiredPermission?: string
}

export interface GenerativeFunction {
  type: 'generative'
  description?: string
  model: string
  prompt: string
  stream?: boolean
  timeout?: number
  requiredPermission?: string
}

export interface AgenticFunction {
  type: 'agentic'
  description?: string
  agent: string
  maxIterations?: number
  timeout?: number
  requiredPermission?: string
}

export interface HumanFunction {
  type: 'human'
  description?: string
  channel: string
  prompt?: string
  timeout: number
  requiredPermission?: string
}

export type ActionFunction = CodeFunction | GenerativeFunction | AgenticFunction | HumanFunction

export interface ActionsConfig {
  actions?: Record<string, ActionFunction>
}

// ============================================================================
// Middleware Factory (Stub)
// ============================================================================

/**
 * Creates an actions middleware for handling action invocation.
 *
 * @param config - Actions configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/actions/*', actions({
 *   actions: {
 *     'send-email': {
 *       type: 'code',
 *       handler: async (input) => { ... },
 *     },
 *     'summarize': {
 *       type: 'generative',
 *       model: 'claude-3-sonnet',
 *       prompt: 'Summarize: {{input}}',
 *     },
 *     'research': {
 *       type: 'agentic',
 *       agent: 'researcher',
 *       maxIterations: 10,
 *     },
 *     'approve': {
 *       type: 'human',
 *       channel: 'slack',
 *       timeout: 3600000,
 *     },
 *   },
 * }))
 * ```
 */
export function actions(_config?: ActionsConfig): MiddlewareHandler {
  // TODO: Implement actions middleware
  // This is a stub that will cause all tests to fail

  const app = new Hono()

  // Stub route that returns 501 Not Implemented
  app.get('/', (c) => {
    return c.json({ error: 'Actions middleware not implemented' }, 501)
  })

  app.post('/:action', (c) => {
    return c.json({ error: 'Actions middleware not implemented' }, 501)
  })

  return async (c, next) => {
    // Stub: just pass through to next middleware
    // The actual implementation would handle action routing
    await next()
  }
}

export default actions
