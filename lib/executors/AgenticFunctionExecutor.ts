/**
 * AgenticFunctionExecutor
 *
 * Executes agentic functions that orchestrate multi-step AI tasks with tools.
 * It runs an AI model in a loop, allowing it to call tools, observe results, and
 * iterate until a final answer is reached or limits are exceeded.
 *
 * Features:
 * 1. Agent runner with tool loop
 * 2. Tool discovery and execution
 * 3. Iteration limits and convergence detection
 * 4. Step callbacks for observability
 * 5. State management between steps
 * 6. Error recovery and retry
 * 7. Parallel tool execution
 * 8. Memory/conversation history
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class AgentMaxIterationsError extends Error {
  constructor(message: string = 'Maximum iterations reached') {
    super(message)
    this.name = 'AgentMaxIterationsError'
  }
}

export class AgentToolExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentToolExecutionError'
  }
}

export class AgentConvergenceError extends Error {
  constructor(message: string = 'Agent is stuck in a loop') {
    super(message)
    this.name = 'AgentConvergenceError'
  }
}

export class AgentToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`)
    this.name = 'AgentToolNotFoundError'
  }
}

export class AgentToolAuthorizationError extends Error {
  constructor(toolName: string) {
    super(`Tool requires authorization: ${toolName}`)
    this.name = 'AgentToolAuthorizationError'
  }
}

export class AgentCancelledError extends Error {
  constructor(message: string = 'Agent execution cancelled') {
    super(message)
    this.name = 'AgentCancelledError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  success: boolean
  error?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties?: Record<string, { type: string; description?: string }>
    required?: string[]
  }
  execute: (
    params: Record<string, unknown>,
    ctx: AgentContext
  ) => Promise<unknown>
  requiresAuthorization?: boolean
  retryConfig?: {
    maxRetries: number
    delay: number
  }
}

export interface AgentStep {
  iteration: number
  type: 'thinking' | 'tool_call' | 'tool_result' | 'final_answer'
  thought?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  answer?: string
  timestamp: Date
  duration?: number
}

export interface AgentContext {
  agentId: string
  invocationId: string
  currentIteration: number
  maxIterations: number
  state: {
    get: <T>(key: string) => Promise<T | null>
    set: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    getAll: () => Promise<Record<string, unknown>>
  }
  ai: {
    complete: (params: {
      model: string
      messages: ConversationMessage[]
      tools?: ToolDefinition[]
      temperature?: number
    }) => Promise<{
      text: string
      toolCalls?: ToolCall[]
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
      usage?: { inputTokens: number; outputTokens: number }
    }>
  }
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }
  emit: (event: string, data: unknown) => Promise<void>
  signal: AbortSignal
  integration?: {
    provider: string
    credentials?: Record<string, unknown>
  }
}

export interface AgentResult {
  success: boolean
  result?: string | Record<string, unknown>
  error?: Error
  iterations: number
  steps: AgentStep[]
  totalDuration: number
  toolCallCount: number
  metrics: {
    tokensUsed?: number
    modelCalls?: number
    toolCalls?: number
  }
}

export interface RetryConfig {
  maxRetries: number
  delay: number
}

export interface ExecutionOptions {
  goal: string
  model: string
  input?: unknown
  systemPrompt?: string
  tools?: string[]
  maxIterations?: number
  authorizedTools?: string[]
  integrations?: Record<string, { provider: string; credentials?: Record<string, unknown> }>
  onStep?: (step: AgentStep) => void | Promise<void>
  onToolCall?: (call: ToolCall, ctx: AgentContext) => ToolCall | null | void | Promise<ToolCall | null | void>
  onToolResult?: (result: ToolResult) => void | Promise<void>
  onComplete?: (result: AgentResult) => void | Promise<void>
  signal?: AbortSignal
  detectLoops?: boolean
  loopThreshold?: number
  parallelToolCalls?: boolean
  maxConcurrency?: number
  aiRetry?: RetryConfig
  maxContextTokens?: number
  conversationHistory?: ConversationMessage[]
  outputSchema?: {
    type: string
    properties?: Record<string, { type: string }>
  }
}

// DurableObjectState interface
interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

export interface AgenticFunctionExecutorOptions {
  state: DurableObjectState
  env: Record<string, unknown>
  ai: {
    complete: (params: {
      model: string
      messages: ConversationMessage[]
      tools?: ToolDefinition[]
      temperature?: number
    }) => Promise<{
      text: string
      toolCalls?: ToolCall[]
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
      usage?: { inputTokens: number; outputTokens: number }
    }>
  }
  tools: Record<string, ToolDefinition>
  onEvent?: (event: string, data: unknown) => void | Promise<void>
  summarizeOnContextFull?: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function validateRequiredParams(
  params: Record<string, unknown>,
  schema: ToolDefinition['parameters']
): string | null {
  if (!schema.required) return null
  for (const field of schema.required) {
    if (!(field in params) || params[field] === undefined) {
      return `Missing required parameter: ${field}`
    }
  }
  return null
}

function hashToolCall(call: ToolCall): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`
}

// Limit concurrency for parallel execution
async function limitConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result)
    })
    executing.push(p)

    if (executing.length >= limit) {
      await Promise.race(executing)
      // Remove settled promises
      for (let i = executing.length - 1; i >= 0; i--) {
        if (
          (executing[i] as Promise<void> & { settled?: boolean })['settled'] ??
          false
        ) {
          executing.splice(i, 1)
        }
      }
    }
  }

  await Promise.all(executing)
  return results
}

// ============================================================================
// AGENTIC FUNCTION EXECUTOR
// ============================================================================

export class AgenticFunctionExecutor {
  private state: DurableObjectState
  private env: Record<string, unknown>
  private ai: AgenticFunctionExecutorOptions['ai']
  private tools: Record<string, ToolDefinition>
  private onEvent?: (event: string, data: unknown) => void | Promise<void>
  private summarizeOnContextFull: boolean

  constructor(options: AgenticFunctionExecutorOptions) {
    this.state = options.state
    this.env = options.env
    this.ai = options.ai
    this.tools = options.tools
    this.onEvent = options.onEvent
    this.summarizeOnContextFull = options.summarizeOnContextFull ?? false
  }

  async execute(options: ExecutionOptions): Promise<AgentResult> {
    const startTime = Date.now()
    const agentId = this.state.id.toString()
    const invocationId = crypto.randomUUID()
    const maxIterations = options.maxIterations ?? 10

    // Check for pre-aborted signal
    if (options.signal?.aborted) {
      throw new AgentCancelledError()
    }

    // Validate requested tools exist
    const requestedTools = options.tools ?? []
    for (const toolName of requestedTools) {
      if (!this.tools[toolName]) {
        throw new AgentToolNotFoundError(toolName)
      }
    }

    // Filter tools to only those requested
    const availableTools: ToolDefinition[] = requestedTools.map(
      (name) => this.tools[name]
    )

    // Build initial messages
    const messages: ConversationMessage[] = []

    // Add system prompt if provided
    if (options.systemPrompt) {
      messages.push({
        role: 'system',
        content: options.systemPrompt,
      })
    }

    // Add conversation history if provided
    if (options.conversationHistory) {
      messages.push(...options.conversationHistory)
    }

    // Build goal with input
    let goalContent = options.goal
    if (options.input !== undefined) {
      if (typeof options.input === 'object') {
        goalContent = `${options.goal}\n\nInput: ${JSON.stringify(options.input)}`
      } else {
        goalContent = options.goal // Already contains input
      }
    }

    messages.push({
      role: 'user',
      content: goalContent,
    })

    // Tracking
    const steps: AgentStep[] = []
    let iterations = 0
    let totalToolCalls = 0
    let totalTokensUsed = 0
    let modelCalls = 0
    const toolCallHashes: string[] = []

    // Create abort controller that links to external signal
    const controller = new AbortController()
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        controller.abort()
      })
    }

    // Create state wrapper
    const stateWrapper: AgentContext['state'] = {
      get: async <T>(key: string): Promise<T | null> => {
        const value = await this.state.storage.get(key)
        return (value as T) ?? null
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await this.state.storage.put(key, value)
      },
      delete: async (key: string): Promise<boolean> => {
        return this.state.storage.delete(key)
      },
      getAll: async (): Promise<Record<string, unknown>> => {
        const all = await this.state.storage.list()
        const result: Record<string, unknown> = {}
        for (const [key, value] of all) {
          result[key] = value
        }
        return result
      },
    }

    // Create logger
    const logger: AgentContext['log'] = {
      debug: (msg, data) => console.debug(`[Agent ${agentId}] ${msg}`, data),
      info: (msg, data) => console.info(`[Agent ${agentId}] ${msg}`, data),
      warn: (msg, data) => console.warn(`[Agent ${agentId}] ${msg}`, data),
      error: (msg, data) => console.error(`[Agent ${agentId}] ${msg}`, data),
    }

    // Emit start event
    await this.onEvent?.('agent.started', { agentId, invocationId, goal: options.goal })

    let result: AgentResult
    let finalError: Error | undefined

    try {
      // Main agent loop
      while (iterations < maxIterations) {
        iterations++

        // Check cancellation
        if (controller.signal.aborted) {
          throw new AgentCancelledError()
        }

        const stepStart = Date.now()

        // Make AI call with optional retry
        let response: Awaited<ReturnType<typeof this.ai.complete>>
        try {
          response = await this.callAIWithRetry(
            options.model,
            messages,
            availableTools,
            options.aiRetry,
            controller.signal
          )
        } catch (error) {
          // Re-throw cancellation errors
          if (controller.signal.aborted) {
            throw new AgentCancelledError()
          }
          throw error
        }

        modelCalls++
        if (response.usage) {
          totalTokensUsed += response.usage.inputTokens + response.usage.outputTokens
        }

        // Check for final answer (no tool calls or end_turn)
        if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
          // Parse structured output if schema provided
          let finalResult: string | Record<string, unknown> = response.text
          if (options.outputSchema) {
            try {
              finalResult = JSON.parse(response.text)
            } catch {
              // Keep as string if not valid JSON
            }
          }

          const step: AgentStep = {
            iteration: iterations,
            type: 'final_answer',
            answer: response.text,
            timestamp: new Date(),
            duration: Date.now() - stepStart,
          }
          steps.push(step)

          await options.onStep?.(step)
          await this.onEvent?.('agent.step', step)

          result = {
            success: true,
            result: finalResult,
            iterations,
            steps,
            totalDuration: Date.now() - startTime,
            toolCallCount: totalToolCalls,
            metrics: {
              tokensUsed: totalTokensUsed || undefined,
              modelCalls,
              toolCalls: totalToolCalls,
            },
          }

          await this.onEvent?.('agent.completed', { ...result, duration: result.totalDuration })
          await options.onComplete?.(result)
          return result
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Check for loops if enabled
          if (options.detectLoops) {
            const threshold = options.loopThreshold ?? 3
            for (const call of response.toolCalls) {
              const hash = hashToolCall(call)
              const count = toolCallHashes.filter((h) => h === hash).length
              if (count >= threshold - 1) {
                const error = new AgentConvergenceError('Agent is stuck in a loop with repeated tool calls')
                result = {
                  success: false,
                  error,
                  iterations,
                  steps,
                  totalDuration: Date.now() - startTime,
                  toolCallCount: totalToolCalls,
                  metrics: {
                    tokensUsed: totalTokensUsed || undefined,
                    modelCalls,
                    toolCalls: totalToolCalls,
                  },
                }
                await options.onComplete?.(result)
                return result
              }
              toolCallHashes.push(hash)
            }
          }

          // Create tool_call step
          const toolCallStep: AgentStep = {
            iteration: iterations,
            type: 'tool_call',
            thought: response.text,
            toolCalls: response.toolCalls,
            timestamp: new Date(),
          }
          steps.push(toolCallStep)
          await options.onStep?.(toolCallStep)
          await this.onEvent?.('agent.step', toolCallStep)

          // Add assistant message to conversation
          messages.push({
            role: 'assistant',
            content: response.text,
            toolCalls: response.toolCalls,
          })

          // Execute tools
          const toolResults: ToolResult[] = []

          // Process each tool call
          const toolExecutionTasks = response.toolCalls.map((call) => async () => {
            // Check cancellation before each tool
            if (controller.signal.aborted) {
              throw new AgentCancelledError()
            }

            // Call onToolCall callback for potential modification or skip
            let modifiedCall = call
            if (options.onToolCall) {
              const callbackResult = await options.onToolCall(call, {
                agentId,
                invocationId,
                currentIteration: iterations,
                maxIterations,
                state: stateWrapper,
                ai: this.ai,
                log: logger,
                emit: async (event, data) => {
                  await this.onEvent?.(event, data)
                },
                signal: controller.signal,
              })
              if (callbackResult === null) {
                // Skip this tool call
                const skippedResult: ToolResult = {
                  toolCallId: call.id,
                  toolName: call.name,
                  result: { skipped: true },
                  success: true,
                }
                return skippedResult
              }
              if (callbackResult) {
                modifiedCall = callbackResult
              }
            }

            await this.onEvent?.('tool.called', {
              toolName: modifiedCall.name,
              arguments: modifiedCall.arguments,
            })

            const tool = this.tools[modifiedCall.name]

            // Check authorization
            if (tool.requiresAuthorization) {
              const isAuthorized =
                options.authorizedTools?.includes(modifiedCall.name) ||
                options.integrations?.[modifiedCall.name] ||
                // Check for integration by tool category (e.g., 'email' for 'send_email')
                Object.keys(options.integrations ?? {}).some((key) =>
                  modifiedCall.name.toLowerCase().includes(key.toLowerCase())
                )

              if (!isAuthorized) {
                throw new AgentToolAuthorizationError(modifiedCall.name)
              }
            }

            // Validate required parameters
            const validationError = validateRequiredParams(
              modifiedCall.arguments,
              tool.parameters
            )

            if (validationError) {
              const errorResult: ToolResult = {
                toolCallId: modifiedCall.id,
                toolName: modifiedCall.name,
                result: null,
                success: false,
                error: validationError,
              }
              await options.onToolResult?.(errorResult)
              return errorResult
            }

            // Build tool context
            const toolContext: AgentContext = {
              agentId,
              invocationId,
              currentIteration: iterations,
              maxIterations,
              state: stateWrapper,
              ai: this.ai,
              log: logger,
              emit: async (event, data) => {
                await this.onEvent?.(event, data)
              },
              signal: controller.signal,
            }

            // Add integration context if available
            if (options.integrations) {
              // Find matching integration
              for (const [key, integration] of Object.entries(options.integrations)) {
                if (modifiedCall.name.toLowerCase().includes(key.toLowerCase())) {
                  toolContext.integration = integration
                  break
                }
              }
            }

            // Execute with retry if configured
            let attemptCount = 0
            const maxRetries = tool.retryConfig?.maxRetries ?? 1
            const retryDelay = tool.retryConfig?.delay ?? 100

            while (attemptCount < maxRetries) {
              attemptCount++
              try {
                const toolOutput = await tool.execute(modifiedCall.arguments, toolContext)
                totalToolCalls++

                const toolResult: ToolResult = {
                  toolCallId: modifiedCall.id,
                  toolName: modifiedCall.name,
                  result: toolOutput,
                  success: true,
                }
                await options.onToolResult?.(toolResult)
                await this.onEvent?.('tool.result', toolResult)
                return toolResult
              } catch (error) {
                if (attemptCount >= maxRetries) {
                  const errorMessage = error instanceof Error ? error.message : String(error)
                  const toolResult: ToolResult = {
                    toolCallId: modifiedCall.id,
                    toolName: modifiedCall.name,
                    result: null,
                    success: false,
                    error: errorMessage,
                  }
                  await options.onToolResult?.(toolResult)
                  await this.onEvent?.('tool.error', {
                    toolName: modifiedCall.name,
                    error: errorMessage,
                  })
                  totalToolCalls++
                  return toolResult
                }
                await sleep(retryDelay)
              }
            }

            // Should never reach here, but TypeScript needs it
            throw new Error('Unexpected end of retry loop')
          })

          // Execute tools (parallel or sequential)
          if (options.parallelToolCalls) {
            const concurrency = options.maxConcurrency ?? Infinity
            if (concurrency === Infinity || concurrency >= toolExecutionTasks.length) {
              const results = await Promise.all(toolExecutionTasks.map((t) => t()))
              toolResults.push(...results)
            } else {
              // Use concurrency limiter
              const results = await this.executeWithConcurrency(
                toolExecutionTasks,
                concurrency
              )
              toolResults.push(...results)
            }
          } else {
            // Sequential execution
            for (const task of toolExecutionTasks) {
              const result = await task()
              toolResults.push(result)
            }
          }

          // Create tool_result step and push it
          const toolResultStep: AgentStep = {
            iteration: iterations,
            type: 'tool_result',
            toolResults,
            timestamp: new Date(),
            duration: Date.now() - stepStart,
          }
          steps.push(toolResultStep)
          await options.onStep?.(toolResultStep)
          await this.onEvent?.('agent.step', toolResultStep)

          // Add tool results to messages
          for (const result of toolResults) {
            const content = result.success
              ? serializeToolResult(result.result)
              : `error: ${result.error}`

            messages.push({
              role: 'tool',
              content,
              toolCallId: result.toolCallId,
            })
          }
        }
      }

      // Exceeded max iterations
      const error = new AgentMaxIterationsError()
      result = {
        success: false,
        error,
        iterations,
        steps,
        totalDuration: Date.now() - startTime,
        toolCallCount: totalToolCalls,
        metrics: {
          tokensUsed: totalTokensUsed || undefined,
          modelCalls,
          toolCalls: totalToolCalls,
        },
      }
      await options.onComplete?.(result)
      return result
    } catch (error) {
      finalError = error instanceof Error ? error : new Error(String(error))

      // Emit error event
      await this.onEvent?.('agent.error', {
        error: finalError.message,
        agentId,
        invocationId,
      })

      result = {
        success: false,
        error: finalError,
        iterations,
        steps,
        totalDuration: Date.now() - startTime,
        toolCallCount: totalToolCalls,
        metrics: {
          tokensUsed: totalTokensUsed || undefined,
          modelCalls,
          toolCalls: totalToolCalls,
        },
      }
      await options.onComplete?.(result)

      // Re-throw specific errors
      if (
        error instanceof AgentCancelledError ||
        error instanceof AgentToolAuthorizationError ||
        error instanceof AgentToolNotFoundError
      ) {
        throw error
      }

      // Re-throw AI errors unless we're handling them
      throw error
    }
  }

  private async callAIWithRetry(
    model: string,
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    retryConfig?: RetryConfig,
    signal?: AbortSignal
  ): Promise<Awaited<ReturnType<typeof this.ai.complete>>> {
    const maxRetries = retryConfig?.maxRetries ?? 1
    const delay = retryConfig?.delay ?? 100

    let attempts = 0
    let lastError: Error | undefined

    while (attempts < maxRetries) {
      attempts++

      // Check cancellation
      if (signal?.aborted) {
        throw new AgentCancelledError()
      }

      try {
        // Race AI call against abort signal
        const aiPromise = this.ai.complete({
          model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
        })

        if (signal) {
          const abortPromise = new Promise<never>((_, reject) => {
            if (signal.aborted) {
              reject(new AgentCancelledError())
              return
            }
            signal.addEventListener('abort', () => {
              reject(new AgentCancelledError())
            }, { once: true })
          })
          return await Promise.race([aiPromise, abortPromise])
        }

        return await aiPromise
      } catch (error) {
        if (error instanceof AgentCancelledError) {
          throw error
        }
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempts >= maxRetries) {
          throw lastError
        }
        await sleep(delay)
      }
    }

    throw lastError ?? new Error('AI call failed')
  }

  private async executeWithConcurrency(
    tasks: (() => Promise<ToolResult>)[],
    maxConcurrency: number
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    const executing: Set<Promise<void>> = new Set()

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const p = task().then((result) => {
        results[i] = result
        executing.delete(p as unknown as Promise<void>)
      }) as unknown as Promise<void>

      executing.add(p)

      if (executing.size >= maxConcurrency) {
        await Promise.race(executing)
      }
    }

    await Promise.all(executing)
    return results
  }
}

export default AgenticFunctionExecutor
