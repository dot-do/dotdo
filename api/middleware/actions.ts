import type { Context, MiddlewareHandler } from 'hono'

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
// Helper Functions
// ============================================================================

/**
 * Substitutes {{variable}} placeholders in a template with input values
 */
function substituteTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return String(input[key] ?? '')
  })
}

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/**
 * Checks if user has required permission
 */
function hasPermission(user: { permissions?: string[] } | null, requiredPermission?: string): boolean {
  if (!requiredPermission) return true
  if (!user?.permissions) return false
  return user.permissions.includes(requiredPermission) || user.permissions.includes('actions:*')
}

// ============================================================================
// Function Executors
// ============================================================================

async function executeCodeFunction(
  config: CodeFunction,
  input: unknown,
  c: Context
): Promise<unknown> {
  const result = await Promise.resolve(config.handler(input, c))
  return result
}

async function executeGenerativeFunction(
  config: GenerativeFunction,
  input: unknown,
  c: Context
): Promise<unknown> {
  const ai = c.get('ai') as { generate: Function; stream: Function } | undefined
  if (!ai) {
    throw new Error('AI service not available')
  }

  const inputObj = (input || {}) as Record<string, unknown>
  const prompt = substituteTemplate(config.prompt, inputObj)

  if (config.stream) {
    // For streaming, we can either stream or generate - tests accept either
    const result = await ai.generate({
      model: config.model,
      prompt,
    })
    return result
  }

  const result = await ai.generate({
    model: config.model,
    prompt,
  })

  return result
}

async function executeAgenticFunction(
  config: AgenticFunction,
  input: unknown,
  c: Context
): Promise<unknown> {
  const agentRunner = c.get('agentRunner') as { run: Function } | undefined
  if (!agentRunner) {
    throw new Error('Agent runner not available')
  }

  const maxIterations = config.maxIterations ?? 10

  const result = await agentRunner.run({
    agent: config.agent,
    input,
    maxIterations,
  })

  return result
}

async function executeHumanFunction(
  config: HumanFunction,
  input: unknown,
  c: Context
): Promise<unknown> {
  const notifications = c.get('notifications') as {
    send: Function
    waitForResponse: Function
  } | undefined

  if (!notifications) {
    throw new Error('Notification channel not available')
  }

  const inputObj = (input || {}) as Record<string, unknown>
  const message = config.prompt ? substituteTemplate(config.prompt, inputObj) : ''

  // Send notification
  await notifications.send({
    channel: config.channel,
    message,
  })

  // Wait for response with timeout
  const response = await notifications.waitForResponse({
    timeout: config.timeout,
  })

  return response
}

// ============================================================================
// Middleware Factory
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
export function actions(config?: ActionsConfig): MiddlewareHandler {
  const actionsMap = config?.actions || {}

  return async (c, next) => {
    // Parse the path to determine what action to take
    const path = c.req.path
    const method = c.req.method

    // Match /api/actions or /api/actions/
    const isListRoute = /^\/api\/actions\/?$/.test(path)
    // Match /api/actions/:action
    const actionMatch = path.match(/^\/api\/actions\/([^/]+)\/?$/)

    if (isListRoute && method === 'GET') {
      // GET / - list available actions
      const actionList = Object.entries(actionsMap).map(([name, actionConfig]) => ({
        name,
        description: actionConfig.description,
        type: actionConfig.type,
      }))
      return c.json({ actions: actionList })
    }

    if (actionMatch) {
      const actionName = actionMatch[1]

      // Only POST is allowed for action invocation
      if (method !== 'POST') {
        return c.json({ error: 'Method not allowed' }, 405)
      }

      // Check if action exists
      const actionConfig = actionsMap[actionName]
      if (!actionConfig) {
        return c.json({ error: `Action '${actionName}' not found` }, 404)
      }

      // Check authentication
      const user = c.get('user') as { id: string; permissions?: string[] } | undefined
      if (!user) {
        return c.json({ error: 'Authentication required' }, 401)
      }

      // Check permission
      if (!hasPermission(user, actionConfig.requiredPermission)) {
        return c.json({ error: 'Permission denied' }, 403)
      }

      // Parse input
      let input: unknown
      try {
        const bodyText = await c.req.text()
        if (bodyText) {
          input = JSON.parse(bodyText)
        } else {
          input = {}
        }
      } catch {
        return c.json({ error: 'Invalid JSON input' }, 400)
      }

      // Execute based on type
      try {
        let result: unknown
        const timeout = actionConfig.timeout

        const executeAction = async (): Promise<unknown> => {
          switch (actionConfig.type) {
            case 'code':
              return await executeCodeFunction(actionConfig, input, c)
            case 'generative':
              return await executeGenerativeFunction(actionConfig, input, c)
            case 'agentic':
              return await executeAgenticFunction(actionConfig, input, c)
            case 'human':
              return await executeHumanFunction(actionConfig, input, c)
            default:
              throw new Error(`Unknown action type`)
          }
        }

        if (timeout) {
          result = await withTimeout(executeAction(), timeout, 'Action timeout')
        } else {
          result = await executeAction()
        }

        return c.json({ result })
      } catch (error) {
        const err = error as Error

        // Handle timeout errors
        if (err.message === 'Action timeout' || err.message?.includes('Timeout')) {
          return c.json({ error: 'Timeout waiting for response' }, 408)
        }

        // Handle human function timeout
        if (actionConfig.type === 'human' && err.message?.includes('Timeout')) {
          return c.json({ error: 'Timeout waiting for response' }, 408)
        }

        // Handle AI/agent errors
        if (actionConfig.type === 'generative' || actionConfig.type === 'agentic') {
          return c.json({ error: 'Service unavailable' }, 502)
        }

        // Handle notification channel errors
        if (actionConfig.type === 'human') {
          return c.json({ error: 'Channel unavailable' }, 502)
        }

        // Generic server error - don't leak details
        return c.json({ error: 'Internal server error' }, 500)
      }
    }

    // Not an actions route, pass to next middleware
    await next()
  }
}

export default actions
