/**
 * $.agents[name].run() Proxy Factory
 *
 * Creates a proxy that provides named agent access through the workflow context:
 *   const result = await $.agents.priya.run({ prompt: 'Define MVP' })
 *   const code = await $.agents.ralph.run({ prompt: 'Build the feature' })
 *
 * Named agents:
 * - priya: Product - specs, roadmaps
 * - ralph: Engineering - builds code
 * - tom: Tech Lead - architecture, review
 * - mark: Marketing - content, launches
 * - sally: Sales - outreach, closing
 * - quinn: QA - testing, quality
 *
 * @see agents/named/ for agent implementations
 * @module client/context/agents-proxy
 */

import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Named agents available in the system
 */
export const NAMED_AGENTS = ['priya', 'ralph', 'tom', 'mark', 'sally', 'quinn'] as const
export type NamedAgent = (typeof NAMED_AGENTS)[number]

/**
 * Tool definition for the agents proxy
 */
export interface AgentTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown> }
  execute: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>
}

/**
 * Input for agent run
 */
export interface AgentRunInput {
  /** The prompt for the agent */
  prompt: string
  /** Additional tools to provide */
  tools?: AgentTool[]
  /** Timeout in milliseconds */
  timeout?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Number of retries on failure */
  retries?: number
  /** Delay between retries in milliseconds */
  retryDelay?: number
  /** Maximum steps for agent loop */
  maxSteps?: number
  /** Custom stop condition */
  stopWhen?: { type: 'hasToolCall'; toolName: string } | { type: 'hasText' } | { type: 'stepCount'; count: number }
}

/**
 * Result from agent run
 */
export interface AgentRunResult {
  /** Final text output */
  text: string
  /** All tool calls made */
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  /** All tool results */
  toolResults: Array<{ toolCallId: string; toolName: string; result: unknown }>
  /** Number of steps taken */
  steps: number
  /** Why the agent stopped */
  finishReason: 'stop' | 'tool_calls' | 'max_steps' | 'error' | 'cancelled'
  /** Token usage */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** Optional metadata */
  metadata?: {
    agentName?: string
    duration?: number
    model?: string
  }
}

/**
 * Stream event types
 */
export interface StreamEvent {
  type: 'text-delta' | 'tool-call-start' | 'tool-call-delta' | 'tool-call-end' | 'tool-result' | 'step-start' | 'step-finish' | 'error' | 'done'
  data: unknown
  timestamp: Date
}

/**
 * Stream result with async iteration and promises
 */
export interface AgentStreamResult extends AsyncIterable<StreamEvent> {
  result: Promise<AgentRunResult>
  text: Promise<string>
  toolCalls: Promise<Array<{ id: string; name: string; arguments: Record<string, unknown> }>>
  usage: Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>
}

/**
 * Agent hooks for lifecycle events
 */
export interface AgentHooks {
  onStepStart?: (stepNumber: number, state: unknown) => Promise<void> | void
  onStepFinish?: (step: unknown, stepNumber: number) => Promise<void> | void
  onError?: (error: Error, context: { agentName: string }) => Promise<void> | void
}

/**
 * Context interface for the agent proxy
 */
export interface AgentContext {
  db?: {
    query: (query: string) => Promise<unknown[]>
    insert: (data: unknown) => Promise<{ id: string }>
    update: (id: string, data: unknown) => Promise<{ updated: boolean }>
  }
  api?: {
    call: (endpoint: string, data?: unknown) => Promise<unknown>
    fetch: (url: string, options?: RequestInit) => Promise<unknown>
  }
  escalate?: (params: { reason: string; role: string; context?: Record<string, unknown> }) => Promise<{ approved: boolean; by: string; notes?: string }>
}

/**
 * Runner function type
 */
export type AgentRunner = (
  input: {
    agentName: string
    prompt: string
    tools?: AgentTool[]
    signal?: AbortSignal
    maxSteps?: number
    stopWhen?: AgentRunInput['stopWhen']
    apiAllowedDomains?: string[]
    escalationConfig?: { sla?: string }
    handoffConfig?: { preventConcurrent?: boolean }
  },
  context: {
    context: AgentContext
    hooks?: AgentHooks
  }
) => Promise<AgentRunResult> | AgentStreamResult

/**
 * Configuration for the agents proxy factory
 */
export interface AgentsProxyConfig {
  /** The workflow context */
  context: AgentContext
  /** The agent runner function */
  runner: AgentRunner
  /** Default tools to provide to all agents */
  defaultTools?: AgentTool[]
  /** Enable database tools */
  enableDbTools?: boolean
  /** Enable API tools */
  enableApiTools?: boolean
  /** Allowed domains for API calls */
  apiAllowedDomains?: string[]
  /** Enable human escalation */
  enableEscalation?: boolean
  /** SLA for escalation */
  escalationSLA?: string
  /** Enable agent handoffs */
  enableHandoffs?: boolean
  /** Prevent concurrent handoffs */
  preventConcurrentHandoffs?: boolean
  /** Default timeout for agent runs */
  defaultTimeout?: number
  /** Default max steps */
  defaultMaxSteps?: number
  /** Enable streaming */
  streamingEnabled?: boolean
  /** Hooks for agent lifecycle */
  hooks?: AgentHooks
}

/**
 * Individual agent proxy with run and stream methods
 */
export interface AgentProxy {
  run: (input: AgentRunInput) => Promise<AgentRunResult>
  stream: (input: AgentRunInput) => AgentStreamResult
}

/**
 * The agents proxy object with named agents
 */
export interface AgentsProxy {
  priya: AgentProxy
  ralph: AgentProxy
  tom: AgentProxy
  mark: AgentProxy
  sally: AgentProxy
  quinn: AgentProxy
  [Symbol.toStringTag]: string
}

// ============================================================================
// Tool Factories
// ============================================================================

/**
 * Create database tools
 */
function createDbTools(context: AgentContext): AgentTool[] {
  const tools: AgentTool[] = []

  if (context.db) {
    tools.push({
      name: 'db_query',
      description: 'Query the database',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to execute' },
        },
      },
      execute: async (input) => {
        return context.db!.query(input.query as string)
      },
    })

    tools.push({
      name: 'db_insert',
      description: 'Insert data into the database',
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          data: { type: 'object', description: 'Data to insert' },
        },
      },
      execute: async (input) => {
        return context.db!.insert(input.data)
      },
    })

    tools.push({
      name: 'db_update',
      description: 'Update data in the database',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record ID' },
          data: { type: 'object', description: 'Data to update' },
        },
      },
      execute: async (input) => {
        return context.db!.update(input.id as string, input.data)
      },
    })
  }

  return tools
}

/**
 * Create API tools
 */
function createApiTools(context: AgentContext): AgentTool[] {
  const tools: AgentTool[] = []

  if (context.api) {
    tools.push({
      name: 'api_call',
      description: 'Call an API endpoint',
      inputSchema: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'API endpoint' },
          data: { type: 'object', description: 'Request data' },
        },
      },
      execute: async (input) => {
        return context.api!.call(input.endpoint as string, input.data)
      },
    })

    tools.push({
      name: 'api_fetch',
      description: 'Fetch data from a URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          options: { type: 'object', description: 'Fetch options' },
        },
      },
      execute: async (input) => {
        return context.api!.fetch(input.url as string, input.options as RequestInit)
      },
    })
  }

  return tools
}

/**
 * Create escalation tool
 */
function createEscalationTool(context: AgentContext): AgentTool {
  return {
    name: 'escalate_to_human',
    description: 'Escalate to a human for decisions requiring approval',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for escalation' },
        role: { type: 'string', description: 'Role to escalate to' },
        context: { type: 'object', description: 'Additional context' },
      },
    },
    execute: async (input) => {
      if (!context.escalate) {
        throw new Error('Escalation not configured')
      }
      return context.escalate({
        reason: input.reason as string,
        role: input.role as string,
        context: input.context as Record<string, unknown>,
      })
    },
  }
}

/**
 * Create handoff tool
 */
function createHandoffTool(): AgentTool {
  return {
    name: 'handoff_to_agent',
    description: 'Hand off to another named agent',
    inputSchema: {
      type: 'object',
      properties: {
        targetAgent: { type: 'string', description: 'Target agent name' },
        reason: { type: 'string', description: 'Reason for handoff' },
        context: { type: 'object', description: 'Context to pass' },
      },
    },
    execute: async (input) => {
      const targetAgent = input.targetAgent as string
      if (!NAMED_AGENTS.includes(targetAgent as NamedAgent)) {
        throw new Error(`Invalid agent: ${targetAgent}. Must be one of: ${NAMED_AGENTS.join(', ')}`)
      }
      return {
        targetAgent,
        reason: input.reason,
        context: input.context,
      }
    },
  }
}

// ============================================================================
// Timeout and Retry Utilities
// ============================================================================

/**
 * Create a promise that rejects after timeout
 */
function createTimeoutPromise(ms: number, signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Agent timeout after ${ms}ms`))
    }, ms)

    // Clean up if signal aborts
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId)
    })
  })
}

/**
 * Execute with timeout
 */
async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeout?: number,
  signal?: AbortSignal
): Promise<T> {
  if (!timeout) {
    return promise
  }

  return Promise.race([promise, createTimeoutPromise(timeout, signal)])
}

/**
 * Execute with retries
 */
async function executeWithRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  retryDelay: number
): Promise<T> {
  let lastError: Error | undefined
  let attempts = 0

  while (attempts < retries) {
    attempts++
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempts < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw lastError ?? new Error('All retries exhausted')
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create the agents proxy
 *
 * @example
 * ```ts
 * const agents = createAgentsProxy({
 *   context: $,
 *   runner: myAgentRunner,
 * })
 *
 * const result = await agents.priya.run({ prompt: 'Define MVP' })
 * ```
 */
export function createAgentsProxy(config: AgentsProxyConfig): AgentsProxy {
  const {
    context,
    runner,
    defaultTools = [],
    enableDbTools = false,
    enableApiTools = false,
    apiAllowedDomains,
    enableEscalation = false,
    escalationSLA,
    enableHandoffs = false,
    preventConcurrentHandoffs = false,
    defaultTimeout,
    defaultMaxSteps,
    streamingEnabled = false,
    hooks,
  } = config

  // Build tools array based on config
  const buildTools = (inputTools?: AgentTool[]): AgentTool[] => {
    const tools: AgentTool[] = [...defaultTools]

    if (inputTools) {
      tools.push(...inputTools)
    }

    if (enableDbTools) {
      tools.push(...createDbTools(context))
    }

    if (enableApiTools) {
      tools.push(...createApiTools(context))
    }

    if (enableEscalation) {
      tools.push(createEscalationTool(context))
    }

    if (enableHandoffs) {
      tools.push(createHandoffTool())
    }

    return tools
  }

  // Create agent proxy for a named agent
  const createAgentProxy = (agentName: NamedAgent): AgentProxy => {
    const run = async (input: AgentRunInput): Promise<AgentRunResult> => {
      const tools = buildTools(input.tools)
      const timeout = input.timeout ?? defaultTimeout
      const maxSteps = input.maxSteps ?? defaultMaxSteps
      const retries = input.retries ?? 1
      const retryDelay = input.retryDelay ?? 0

      // Create combined signal for timeout and external abort
      let signal = input.signal
      const timeoutController = new AbortController()

      // If timeout is set and no external signal, use timeout signal
      if (timeout && !signal) {
        signal = timeoutController.signal
      }

      const runnerInput = {
        agentName,
        prompt: input.prompt,
        tools,
        signal,
        maxSteps,
        stopWhen: input.stopWhen,
        apiAllowedDomains,
        escalationConfig: enableEscalation ? { sla: escalationSLA } : undefined,
        handoffConfig: enableHandoffs ? { preventConcurrent: preventConcurrentHandoffs } : undefined,
      }

      const runnerContext = {
        context,
        hooks,
      }

      const executeFn = async (): Promise<AgentRunResult> => {
        const result = runner(runnerInput, runnerContext)

        // Handle both Promise and StreamResult
        const resultPromise = result instanceof Promise ? result : result.result

        // Apply timeout if configured
        if (timeout) {
          // Create timeout promise
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timeoutId = setTimeout(() => {
              timeoutController.abort()
              reject(new Error(`Agent timeout after ${timeout}ms`))
            }, timeout)

            // Clean up on abort
            signal?.addEventListener('abort', () => {
              clearTimeout(timeoutId)
            })
          })

          return Promise.race([resultPromise, timeoutPromise])
        }

        return resultPromise
      }

      // Handle retries
      if (retries > 1) {
        return executeWithRetries(executeFn, retries, retryDelay)
      }

      try {
        return await executeFn()
      } catch (error) {
        // Call error hook
        if (hooks?.onError) {
          await hooks.onError(
            error instanceof Error ? error : new Error(String(error)),
            { agentName }
          )
        }
        throw error
      }
    }

    const stream = (input: AgentRunInput): AgentStreamResult => {
      const tools = buildTools(input.tools)
      const maxSteps = input.maxSteps ?? defaultMaxSteps

      const runnerInput = {
        agentName,
        prompt: input.prompt,
        tools,
        signal: input.signal,
        maxSteps,
        stopWhen: input.stopWhen,
        apiAllowedDomains,
        escalationConfig: enableEscalation ? { sla: escalationSLA } : undefined,
        handoffConfig: enableHandoffs ? { preventConcurrent: preventConcurrentHandoffs } : undefined,
      }

      const runnerContext = {
        context,
        hooks,
      }

      const result = runner(runnerInput, runnerContext)

      // If runner returns a Promise, convert to stream
      if (result instanceof Promise) {
        // Create promises for stream properties
        let resolveResult: (r: AgentRunResult) => void
        let rejectResult: (e: Error) => void
        const resultPromise = new Promise<AgentRunResult>((resolve, reject) => {
          resolveResult = resolve
          rejectResult = reject
        })

        let resolveText: (t: string) => void
        const textPromise = new Promise<string>((resolve) => {
          resolveText = resolve
        })

        let resolveToolCalls: (tc: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) => void
        const toolCallsPromise = new Promise<Array<{ id: string; name: string; arguments: Record<string, unknown> }>>((resolve) => {
          resolveToolCalls = resolve
        })

        let resolveUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
        const usagePromise = new Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>((resolve) => {
          resolveUsage = resolve
        })

        // Start the async resolution
        result
          .then((r) => {
            resolveResult!(r)
            resolveText!(r.text)
            resolveToolCalls!(r.toolCalls)
            resolveUsage!(r.usage)
          })
          .catch((e) => {
            rejectResult!(e)
          })

        // Create async iterator
        const asyncIterator = async function* (): AsyncGenerator<StreamEvent> {
          try {
            const r = await result
            yield {
              type: 'text-delta',
              data: { textDelta: r.text },
              timestamp: new Date(),
            }
            yield {
              type: 'done',
              data: { finalResult: r },
              timestamp: new Date(),
            }
          } catch (error) {
            yield {
              type: 'error',
              data: { error },
              timestamp: new Date(),
            }
          }
        }

        return {
          [Symbol.asyncIterator]: asyncIterator,
          result: resultPromise,
          text: textPromise,
          toolCalls: toolCallsPromise,
          usage: usagePromise,
        }
      }

      // Runner returned a stream result, return it directly
      return result as AgentStreamResult
    }

    return { run, stream }
  }

  // Create the proxy object
  const agentsProxy: AgentsProxy = {
    priya: createAgentProxy('priya'),
    ralph: createAgentProxy('ralph'),
    tom: createAgentProxy('tom'),
    mark: createAgentProxy('mark'),
    sally: createAgentProxy('sally'),
    quinn: createAgentProxy('quinn'),
    [Symbol.toStringTag]: 'AgentsProxy',
  }

  // Use Proxy to handle unknown property access
  return new Proxy(agentsProxy, {
    get(target, prop) {
      if (prop === Symbol.toStringTag) {
        return 'AgentsProxy'
      }
      if (prop in target) {
        return target[prop as keyof AgentsProxy]
      }
      return undefined
    },
  })
}

export default createAgentsProxy
