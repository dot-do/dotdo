/**
 * ToolLoopAgent - AI agent that executes tool calls in a loop until completion
 *
 * Provides:
 * 1. Agent initialization with tools
 * 2. Tool loop execution (think -> act -> observe cycle)
 * 3. Max iteration limits and timeouts
 * 4. Error handling and fallback strategies
 * 5. Context management across iterations
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ToolLoopConfig {
  model: string
  maxIterations?: number
  timeout?: number
  toolTimeout?: number
  systemPrompt?: string
  fallbackStrategy?: FallbackStrategy
  aiRetry?: { maxRetries: number; delayMs: number }
  detectLoops?: boolean
  loopThreshold?: number
  maxContextMessages?: number
  logger?: Logger
  onStep?: (step: ToolLoopStep) => void
  onToolCall?: (toolCall: ToolCall) => void
  onToolResult?: (result: ToolCallResult) => void
  onComplete?: (result: ToolLoopResult) => void
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (params: unknown, context: ToolLoopContext) => Promise<unknown>
  fallbackStrategy?: FallbackStrategy
}

export interface ToolLoopResult {
  success: boolean
  result?: string
  error?: Error
  iterations: number
  steps: ToolLoopStep[]
  metrics: ToolLoopMetrics
  partialResult?: string
  cancelled?: boolean
  loopDetected?: boolean
}

export interface ToolLoopContext {
  agentId: string
  runId: string
  iteration: number
  goal: string
  state: StateAccessor
  log: Logger
  custom?: Record<string, unknown>
}

export interface StateAccessor {
  get: <T>(key: string) => Promise<T | null>
  set: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
  getAll: () => Promise<Record<string, unknown>>
}

export interface Logger {
  info: (message: string) => void
  debug: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface ToolCallResult {
  toolName: string
  result: unknown
  success: boolean
  error?: string
  duration?: number
}

export type FallbackStrategy =
  | { type: 'retry'; maxRetries: number; delayMs: number }
  | { type: 'skip' }
  | { type: 'abort' }
  | { type: 'custom'; handler: (error: Error, toolCall: ToolCall, context: ToolLoopContext) => Promise<{ type: 'substitute'; result: unknown } | { type: 'skip' } | { type: 'abort' }> }

export interface ToolLoopStep {
  type: 'thinking' | 'action' | 'observation' | 'answer'
  content?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  error?: string
  timestamp: number
}

export interface ToolLoopMetrics {
  totalDuration: number
  aiCalls: number
  toolCalls: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
}

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

interface AIClient {
  chat: (params: {
    messages: Message[]
    tools?: { name: string; description: string; parameters: unknown }[]
  }) => Promise<{
    content: string
    toolCalls?: ToolCall[]
    usage?: { inputTokens: number; outputTokens: number }
  }>
}

interface RunOptions {
  maxIterations?: number
  timeout?: number
  signal?: AbortSignal
  context?: Record<string, unknown>
  conversationHistory?: Message[]
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class ToolLoopMaxIterationsError extends Error {
  name = 'ToolLoopMaxIterationsError'
  constructor(message: string) {
    super(message)
  }
}

export class ToolLoopTimeoutError extends Error {
  name = 'ToolLoopTimeoutError'
  constructor(message: string) {
    super(message)
  }
}

export class ToolLoopToolNotFoundError extends Error {
  name = 'ToolLoopToolNotFoundError'
  constructor(message: string) {
    super(message)
  }
}

export class ToolLoopExecutionError extends Error {
  name = 'ToolLoopExecutionError'
  constructor(message: string) {
    super(message)
  }
}

// ============================================================================
// TOOL LOOP AGENT
// ============================================================================

export class ToolLoopAgent {
  private ai: AIClient
  private tools: Map<string, ToolDefinition>
  private config: Required<Pick<ToolLoopConfig, 'model' | 'maxIterations'>> & ToolLoopConfig
  private agentId: string

  constructor(params: { ai: AIClient; tools: Record<string, ToolDefinition>; config: ToolLoopConfig }) {
    if (!params.ai) {
      throw new Error('AI client is required')
    }

    this.ai = params.ai
    this.tools = new Map(Object.entries(params.tools))
    this.config = {
      maxIterations: 10,
      ...params.config,
    }
    this.agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  getConfig(): ToolLoopConfig & { maxIterations: number } {
    return { ...this.config }
  }

  updateConfig(updates: Partial<ToolLoopConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name)
  }

  async run(goal: string, options: RunOptions = {}): Promise<ToolLoopResult> {
    const startTime = Date.now()
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const maxIterations = options.maxIterations ?? this.config.maxIterations
    const timeout = options.timeout ?? this.config.timeout
    const signal = options.signal

    // Check if already aborted
    if (signal?.aborted) {
      return this.createResult({
        success: false,
        cancelled: true,
        iterations: 0,
        steps: [],
        startTime,
        metrics: { aiCalls: 0, toolCalls: 0 },
      })
    }

    // State for this run
    const state: Record<string, unknown> = {}
    const stateAccessor: StateAccessor = {
      get: async <T>(key: string) => (state[key] as T) ?? null,
      set: async <T>(key: string, value: T) => { state[key] = value },
      delete: async (key: string) => { const had = key in state; delete state[key]; return had },
      getAll: async () => ({ ...state }),
    }

    const logger: Logger = this.config.logger ?? {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    }

    const steps: ToolLoopStep[] = []
    const metrics = { aiCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }

    // Build initial messages
    const messages: Message[] = []

    // Add system prompt if configured
    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt })
    }

    // Add conversation history if provided
    if (options.conversationHistory) {
      messages.push(...options.conversationHistory)
    }

    // Add the goal as user message
    messages.push({ role: 'user', content: goal })

    // Loop detection state
    const toolCallHistory: string[] = []

    let iteration = 0
    let lastContent = ''
    let cancelled = false
    let loopDetected = false

    // Setup timeout handling
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let timedOut = false

    const timeoutPromise = timeout ? new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        reject(new ToolLoopTimeoutError('Execution timeout'))
      }, timeout)
    }) : null

    // Setup abort handling
    const abortPromise = signal ? new Promise<void>((_, reject) => {
      const onAbort = () => {
        cancelled = true
        reject(new Error('Aborted'))
      }
      signal.addEventListener('abort', onAbort)
    }) : null

    try {
      while (iteration < maxIterations) {
        iteration++

        // Check for abort
        if (signal?.aborted) {
          cancelled = true
          break
        }

        // Create context for this iteration
        const context: ToolLoopContext = {
          agentId: this.agentId,
          runId,
          iteration,
          goal,
          state: stateAccessor,
          log: logger,
          custom: options.context,
        }

        // Truncate messages if needed
        const truncatedMessages = this.truncateMessages(messages)

        // Build tools array for AI
        const toolsForAI = Array.from(this.tools.values()).map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))

        // Call AI with timeout race
        let response: Awaited<ReturnType<AIClient['chat']>>
        try {
          const aiCallPromise = this.callAIWithRetry(truncatedMessages, toolsForAI)

          const racers: Promise<unknown>[] = [aiCallPromise]
          if (timeoutPromise) racers.push(timeoutPromise)
          if (abortPromise) racers.push(abortPromise)

          response = await Promise.race(racers) as typeof response
          metrics.aiCalls++

          // Track token usage
          if (response.usage) {
            metrics.inputTokens += response.usage.inputTokens
            metrics.outputTokens += response.usage.outputTokens
          }
        } catch (err) {
          if (timedOut || (err instanceof ToolLoopTimeoutError)) {
            const result = this.createResult({
              success: false,
              error: new ToolLoopTimeoutError('Execution timeout'),
              iterations: iteration,
              steps,
              startTime,
              metrics,
              partialResult: lastContent,
            })
            this.config.onComplete?.(result)
            return result
          }
          if (cancelled || signal?.aborted) {
            const result = this.createResult({
              success: false,
              cancelled: true,
              iterations: iteration,
              steps,
              startTime,
              metrics,
              partialResult: lastContent,
            })
            this.config.onComplete?.(result)
            return result
          }
          // AI error
          const result = this.createResult({
            success: false,
            error: err instanceof Error ? err : new Error(String(err)),
            iterations: iteration,
            steps,
            startTime,
            metrics,
          })
          this.config.onComplete?.(result)
          return result
        }

        lastContent = response.content

        // Add assistant message to history
        messages.push({ role: 'assistant', content: response.content })

        // No tool calls = we're done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // Add thinking step if there was content
          if (response.content) {
            const answerStep: ToolLoopStep = {
              type: 'answer',
              content: response.content,
              timestamp: Date.now(),
            }
            steps.push(answerStep)
            this.config.onStep?.(answerStep)
          }

          this.config.onComplete?.({
            success: true,
            result: response.content,
            iterations: iteration,
            steps,
            metrics: this.createMetrics(startTime, metrics),
          })

          return this.createResult({
            success: true,
            result: response.content,
            iterations: iteration,
            steps,
            startTime,
            metrics,
          })
        }

        // Add thinking step
        if (response.content) {
          const thinkingStep: ToolLoopStep = {
            type: 'thinking',
            content: response.content,
            timestamp: Date.now(),
          }
          steps.push(thinkingStep)
          this.config.onStep?.(thinkingStep)
        }

        // Loop detection
        if (this.config.detectLoops) {
          for (const toolCall of response.toolCalls) {
            const callSignature = JSON.stringify({ name: toolCall.name, args: toolCall.arguments })
            toolCallHistory.push(callSignature)

            // Check for repeated identical calls
            const threshold = this.config.loopThreshold ?? 3
            const recentCalls = toolCallHistory.slice(-threshold)
            if (recentCalls.length === threshold && recentCalls.every(c => c === callSignature)) {
              loopDetected = true
              break
            }
          }

          if (loopDetected) {
            return this.createResult({
              success: false,
              loopDetected: true,
              iterations: iteration,
              steps,
              startTime,
              metrics,
              partialResult: lastContent,
            })
          }
        }

        // Execute tool calls (potentially in parallel)
        const toolResults: { id: string; result: string }[] = []

        for (const toolCall of response.toolCalls) {
          // Check for abort before each tool
          if (signal?.aborted) {
            cancelled = true
            break
          }

          // Add action step
          const actionStep: ToolLoopStep = {
            type: 'action',
            toolName: toolCall.name,
            toolInput: toolCall.arguments,
            timestamp: Date.now(),
          }
          steps.push(actionStep)
          this.config.onStep?.(actionStep)
          this.config.onToolCall?.(toolCall)

          const tool = this.tools.get(toolCall.name)

          if (!tool) {
            // Tool not found
            const errorMessage = `Tool '${toolCall.name}' not found`
            const observationStep: ToolLoopStep = {
              type: 'observation',
              toolName: toolCall.name,
              error: errorMessage,
              timestamp: Date.now(),
            }
            steps.push(observationStep)
            this.config.onStep?.(observationStep)

            toolResults.push({
              id: toolCall.id,
              result: JSON.stringify({ error: errorMessage }),
            })

            this.config.onToolResult?.({
              toolName: toolCall.name,
              result: null,
              success: false,
              error: errorMessage,
            })
            continue
          }

          // Execute tool with fallback handling
          try {
            const toolStartTime = Date.now()
            let result: unknown

            // Tool timeout handling
            const toolTimeoutMs = this.config.toolTimeout
            if (toolTimeoutMs) {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new ToolLoopTimeoutError('Tool timeout')), toolTimeoutMs)
              })

              // Also handle abort during tool execution
              const abortPromise = signal ? new Promise<never>((_, reject) => {
                const onAbort = () => reject(new Error('Aborted'))
                signal.addEventListener('abort', onAbort, { once: true })
              }) : null

              const racers: Promise<unknown>[] = [
                this.executeToolWithFallback(tool, toolCall, context),
                timeoutPromise,
              ]
              if (abortPromise) racers.push(abortPromise)

              result = await Promise.race(racers)
            } else {
              // Check for abort during tool execution
              if (signal) {
                const abortPromise = new Promise<never>((_, reject) => {
                  const onAbort = () => reject(new Error('Aborted'))
                  signal.addEventListener('abort', onAbort, { once: true })
                })
                result = await Promise.race([
                  this.executeToolWithFallback(tool, toolCall, context),
                  abortPromise,
                ])
              } else {
                result = await this.executeToolWithFallback(tool, toolCall, context)
              }
            }

            const toolDuration = Date.now() - toolStartTime
            metrics.toolCalls++

            const observationStep: ToolLoopStep = {
              type: 'observation',
              toolName: toolCall.name,
              toolResult: result,
              timestamp: Date.now(),
            }
            steps.push(observationStep)
            this.config.onStep?.(observationStep)

            toolResults.push({
              id: toolCall.id,
              result: JSON.stringify(result),
            })

            this.config.onToolResult?.({
              toolName: toolCall.name,
              result,
              success: true,
              duration: toolDuration,
            })
          } catch (err) {
            if (cancelled || signal?.aborted) {
              cancelled = true
              break
            }

            const errorMessage = err instanceof Error ? err.message : String(err)

            // Check for abort fallback strategy
            const strategy = tool.fallbackStrategy ?? this.config.fallbackStrategy
            if (strategy?.type === 'abort') {
              return this.createResult({
                success: false,
                error: new ToolLoopExecutionError(errorMessage),
                iterations: iteration,
                steps,
                startTime,
                metrics,
                partialResult: lastContent,
              })
            }

            const observationStep: ToolLoopStep = {
              type: 'observation',
              toolName: toolCall.name,
              error: errorMessage,
              timestamp: Date.now(),
            }
            steps.push(observationStep)
            this.config.onStep?.(observationStep)

            // For timeout errors, report as timeout
            const errorContent = err instanceof ToolLoopTimeoutError
              ? JSON.stringify({ error: 'Tool execution timeout' })
              : JSON.stringify({ error: errorMessage })

            toolResults.push({
              id: toolCall.id,
              result: errorContent,
            })

            this.config.onToolResult?.({
              toolName: toolCall.name,
              result: null,
              success: false,
              error: errorMessage,
            })
          }
        }

        if (cancelled) {
          break
        }

        // Add tool results to messages
        for (const toolResult of toolResults) {
          messages.push({
            role: 'tool',
            content: toolResult.result,
            tool_call_id: toolResult.id,
          })
        }
      }

      // Check why we exited
      if (cancelled || signal?.aborted) {
        return this.createResult({
          success: false,
          cancelled: true,
          iterations: iteration,
          steps,
          startTime,
          metrics,
          partialResult: lastContent,
        })
      }

      // Max iterations reached
      return this.createResult({
        success: false,
        error: new ToolLoopMaxIterationsError(`Max iterations (${maxIterations}) reached`),
        iterations: iteration,
        steps,
        startTime,
        metrics,
        partialResult: lastContent,
      })
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private async callAIWithRetry(
    messages: Message[],
    tools: { name: string; description: string; parameters: unknown }[]
  ): Promise<Awaited<ReturnType<AIClient['chat']>>> {
    const retryConfig = this.config.aiRetry
    const maxRetries = retryConfig?.maxRetries ?? 1
    const delayMs = retryConfig?.delayMs ?? 0

    let lastError: Error | undefined
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.ai.chat({ messages, tools })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < maxRetries - 1) {
          await this.delay(delayMs)
        }
      }
    }
    throw lastError
  }

  private async executeToolWithFallback(
    tool: ToolDefinition,
    toolCall: ToolCall,
    context: ToolLoopContext
  ): Promise<unknown> {
    const strategy = tool.fallbackStrategy ?? this.config.fallbackStrategy

    if (!strategy) {
      return await tool.handler(toolCall.arguments, context)
    }

    if (strategy.type === 'retry') {
      let lastError: Error | undefined
      for (let attempt = 0; attempt < strategy.maxRetries; attempt++) {
        try {
          return await tool.handler(toolCall.arguments, context)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (attempt < strategy.maxRetries - 1) {
            await this.delay(strategy.delayMs)
          }
        }
      }
      throw lastError
    }

    if (strategy.type === 'custom') {
      try {
        return await tool.handler(toolCall.arguments, context)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        const fallbackResult = await strategy.handler(error, toolCall, context)

        if (fallbackResult.type === 'substitute') {
          return fallbackResult.result
        }
        if (fallbackResult.type === 'abort') {
          throw new ToolLoopExecutionError(error.message)
        }
        // skip
        throw error
      }
    }

    // For skip and abort, just try once
    return await tool.handler(toolCall.arguments, context)
  }

  private truncateMessages(messages: Message[]): Message[] {
    const maxMessages = this.config.maxContextMessages
    if (!maxMessages || messages.length <= maxMessages) {
      return messages
    }

    // Always preserve system prompt if present
    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    // Take the most recent messages
    const recentMessages = nonSystemMessages.slice(-(maxMessages - (systemMessage ? 1 : 0)))

    return systemMessage ? [systemMessage, ...recentMessages] : recentMessages
  }

  private createResult(params: {
    success: boolean
    result?: string
    error?: Error
    iterations: number
    steps: ToolLoopStep[]
    startTime: number
    metrics: { aiCalls: number; toolCalls: number; inputTokens?: number; outputTokens?: number }
    partialResult?: string
    cancelled?: boolean
    loopDetected?: boolean
  }): ToolLoopResult {
    const totalDuration = Date.now() - params.startTime
    const totalTokens = (params.metrics.inputTokens ?? 0) + (params.metrics.outputTokens ?? 0)

    const result: ToolLoopResult = {
      success: params.success,
      iterations: params.iterations,
      steps: params.steps,
      metrics: {
        totalDuration,
        aiCalls: params.metrics.aiCalls,
        toolCalls: params.metrics.toolCalls,
        ...(params.metrics.inputTokens !== undefined && {
          inputTokens: params.metrics.inputTokens,
          outputTokens: params.metrics.outputTokens,
          totalTokens,
        }),
      },
    }

    if (params.result !== undefined) {
      result.result = params.result
    }
    if (params.error) {
      result.error = params.error
    }
    if (params.partialResult !== undefined) {
      result.partialResult = params.partialResult
    }
    if (params.cancelled) {
      result.cancelled = true
    }
    if (params.loopDetected) {
      result.loopDetected = true
    }

    return result
  }

  private createMetrics(startTime: number, metrics: { aiCalls: number; toolCalls: number; inputTokens?: number; outputTokens?: number }): ToolLoopMetrics {
    return {
      totalDuration: Date.now() - startTime,
      aiCalls: metrics.aiCalls,
      toolCalls: metrics.toolCalls,
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
