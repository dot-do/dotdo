/**
 * AgentRuntime - Core agent execution loop
 *
 * Provides:
 * - Think-Act-Observe agent loop
 * - Tool execution integration
 * - Memory management per session
 * - Usage and cost tracking
 * - Streaming support
 *
 * @module db/primitives/agent-runtime
 */

import type {
  AgentRuntimeConfig,
  AgentRunRequest,
  AgentRunResponse,
  AgentStreamResponse,
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolContext,
  StreamEvent,
  TokenUsage,
  UsageStats,
  CompletionResponse,
} from './types'
import { createLLMRouter, type LLMRouter } from './router'
import { createToolRegistry, type ToolRegistry, validateToolInput } from './tools'
import { createConversationMemory, type ConversationMemory } from './memory'

// ============================================================================
// Cost Calculation
// ============================================================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
}

function calculateCost(model: string, usage: TokenUsage): number {
  const costs = MODEL_COSTS[model]
  if (!costs) return 0
  return (usage.promptTokens / 1000) * costs.input + (usage.completionTokens / 1000) * costs.output
}

// ============================================================================
// AgentRuntime Interface
// ============================================================================

export interface AgentRuntime {
  /** Get runtime configuration */
  getConfig(): AgentRuntimeConfig

  /** Run agent to completion */
  run(request: AgentRunRequest): Promise<AgentRunResponse>

  /** Stream agent execution */
  stream(request: AgentRunRequest): AgentStreamResponse

  /** Get memory for a session */
  getMemory(sessionId: string): ConversationMemory | undefined

  /** Get usage statistics */
  getStats(): UsageStats

  /** Reset statistics */
  resetStats(): void
}

// ============================================================================
// AgentRuntime Implementation
// ============================================================================

class AgentRuntimeImpl implements AgentRuntime {
  private config: AgentRuntimeConfig
  private router: LLMRouter
  private toolRegistry: ToolRegistry
  private sessions: Map<string, ConversationMemory> = new Map()

  constructor(config: AgentRuntimeConfig) {
    // Apply defaults
    this.config = {
      ...config,
      maxSteps: config.maxSteps ?? 20,
    }

    // Initialize router
    this.router = createLLMRouter(config.router)

    // Initialize tool registry
    this.toolRegistry = createToolRegistry()
    if (config.tools) {
      for (const tool of config.tools) {
        this.toolRegistry.register(tool)
      }
    }
  }

  getConfig(): AgentRuntimeConfig {
    return { ...this.config }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResponse> {
    // Check abort signal
    if (request.signal?.aborted) {
      throw new Error('Request aborted')
    }

    const startTime = performance.now()

    // Get or create memory for session
    const sessionId = request.sessionId ?? `session-${Date.now()}`
    let memory = this.sessions.get(sessionId)
    if (!memory) {
      memory = createConversationMemory(this.config.memory, sessionId)
      this.sessions.set(sessionId, memory)
    }

    // Build initial messages
    const messages: Message[] = this.buildInitialMessages(request, memory)

    // Get tools for this run
    const tools = request.tools ?? this.config.tools ?? []
    const model = request.model ?? this.config.model

    // Initialize tracking
    let stepNumber = 0
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const allToolCalls: ToolCall[] = []
    const allToolResults: ToolResult[] = []
    let lastText = ''

    // Agent loop: Think -> Act -> Observe
    while (stepNumber < (this.config.maxSteps ?? 20)) {
      stepNumber++

      // Check abort signal
      if (request.signal?.aborted) {
        throw new Error('Request aborted')
      }

      // THINK: Call LLM
      const response = await this.router.complete({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      })

      // Accumulate usage
      totalUsage.promptTokens += response.usage.promptTokens
      totalUsage.completionTokens += response.usage.completionTokens
      totalUsage.totalTokens += response.usage.totalTokens

      // Add assistant message to conversation
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMessage)

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        lastText = response.content ?? ''
        break
      }

      // ACT: Execute tool calls
      for (const toolCall of response.toolCalls) {
        allToolCalls.push(toolCall)

        // Check abort signal before each tool
        if (request.signal?.aborted) {
          throw new Error('Request aborted')
        }

        // Execute tool
        const context: ToolContext = {
          agentId: this.config.id,
          sessionId,
          abortSignal: request.signal,
          metadata: request.metadata,
        }

        const result = await this.toolRegistry.execute(toolCall.name, toolCall.arguments, context)
        result.toolCallId = toolCall.id

        allToolResults.push(result)

        // Add tool result to conversation
        const toolMessage: Message = {
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: result.error ? { error: result.error } : result.result,
        }
        messages.push(toolMessage)
      }

      // OBSERVE: Loop continues to let LLM see results
    }

    // Save conversation to memory
    memory.clear()
    memory.addMessages(messages)

    // Calculate total latency and cost
    const latencyMs = Math.round(performance.now() - startTime)
    const costUsd = calculateCost(model, totalUsage)

    return {
      text: lastText,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      messages,
      steps: stepNumber,
      finishReason: stepNumber >= (this.config.maxSteps ?? 20) ? 'length' : 'stop',
      usage: totalUsage,
      costUsd,
      latencyMs,
    }
  }

  stream(request: AgentRunRequest): AgentStreamResponse {
    const self = this

    // Create deferred promises
    let resolveResponse: (response: AgentRunResponse) => void
    let rejectResponse: (error: Error) => void
    const responsePromise = new Promise<AgentRunResponse>((resolve, reject) => {
      resolveResponse = resolve
      rejectResponse = reject
    })

    let resolveText: (text: string) => void
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve
    })

    let resolveToolCalls: (calls: ToolCall[]) => void
    const toolCallsPromise = new Promise<ToolCall[]>((resolve) => {
      resolveToolCalls = resolve
    })

    let resolveUsage: (usage: TokenUsage) => void
    const usagePromise = new Promise<TokenUsage>((resolve) => {
      resolveUsage = resolve
    })

    // Create async generator
    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      try {
        // For now, fall back to non-streaming and emit events
        const result = await self.run(request)

        // Emit start
        yield { type: 'start', data: {}, timestamp: new Date() }

        // Emit text as a single delta
        if (result.text) {
          yield {
            type: 'text-delta',
            data: { textDelta: result.text, accumulated: result.text },
            timestamp: new Date(),
          }
        }

        // Emit tool calls
        for (let i = 0; i < result.toolCalls.length; i++) {
          const tc = result.toolCalls[i]
          yield {
            type: 'tool-call-end',
            data: { toolCall: tc },
            timestamp: new Date(),
          }

          yield {
            type: 'tool-result',
            data: { result: result.toolResults[i] },
            timestamp: new Date(),
          }
        }

        // Emit usage
        yield {
          type: 'usage',
          data: { usage: result.usage, costUsd: result.costUsd },
          timestamp: new Date(),
        }

        // Emit done
        yield {
          type: 'done',
          data: { response: result },
          timestamp: new Date(),
        }

        resolveResponse(result)
        resolveText(result.text)
        resolveToolCalls(result.toolCalls)
        resolveUsage(result.usage)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        yield {
          type: 'error',
          data: { error: err, recoverable: false },
          timestamp: new Date(),
        }
        rejectResponse(err)
      }
    }

    return {
      [Symbol.asyncIterator]: generateEvents,
      response: responsePromise,
      text: textPromise,
      toolCalls: toolCallsPromise,
      usage: usagePromise,
    }
  }

  getMemory(sessionId: string): ConversationMemory | undefined {
    return this.sessions.get(sessionId)
  }

  getStats(): UsageStats {
    return this.router.getStats()
  }

  resetStats(): void {
    this.router.resetStats()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildInitialMessages(request: AgentRunRequest, memory: ConversationMemory): Message[] {
    const messages: Message[] = []

    // Add system instructions
    if (this.config.instructions) {
      messages.push({
        role: 'system',
        content: this.config.instructions,
      })
    }

    // Add previous conversation from memory (if continuing session)
    const previousMessages = memory.getMessages()
    if (previousMessages.length > 0) {
      // Filter out system message if we already added one
      const filtered = this.config.instructions
        ? previousMessages.filter((m) => m.role !== 'system')
        : previousMessages
      messages.push(...filtered)
    }

    // Add provided messages or prompt
    if (request.messages) {
      messages.push(...request.messages)
    } else if (request.prompt) {
      messages.push({
        role: 'user',
        content: request.prompt,
      })
    }

    return messages
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  return new AgentRuntimeImpl(config)
}
