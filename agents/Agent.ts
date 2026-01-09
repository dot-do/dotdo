/**
 * Agent - Base Agent implementation
 *
 * Provides the core agent loop with:
 * - Multi-step execution (Vercel stopWhen/prepareStep pattern)
 * - Streaming support
 * - Tool execution
 * - Hooks for customization
 */

import type {
  Agent,
  AgentConfig,
  AgentProvider,
  AgentInput,
  AgentResult,
  AgentStreamResult,
  AgentHooks,
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  StepState,
  StepResult,
  TokenUsage,
  StreamEvent,
  SubagentTask,
  SubagentResult,
  HandoffRequest,
  ToolContext,
} from './types'
import { validateInput } from './Tool'

// Import stop conditions from dedicated module
import {
  stepCountIs,
  hasToolCall,
  hasText,
  customStop,
  shouldStop,
  all,
  any,
  not,
} from './stopConditions'

// Re-export for backwards compatibility
export { stepCountIs, hasToolCall, hasText, customStop, all, any, not }

// ============================================================================
// Base Agent Implementation
// ============================================================================

export interface BaseAgentOptions {
  config: AgentConfig
  provider: AgentProvider
  hooks?: AgentHooks
  /** Provider-specific generate function */
  generate: (messages: Message[], config: AgentConfig) => Promise<StepResult>
  /** Provider-specific stream function */
  generateStream?: (messages: Message[], config: AgentConfig) => AsyncIterable<StreamEvent>
}

export class BaseAgent implements Agent {
  readonly config: AgentConfig
  readonly provider: AgentProvider
  private hooks: AgentHooks
  private generate: (messages: Message[], config: AgentConfig) => Promise<StepResult>
  private generateStream?: (messages: Message[], config: AgentConfig) => AsyncIterable<StreamEvent>

  constructor(options: BaseAgentOptions) {
    this.config = options.config
    this.provider = options.provider
    this.hooks = options.hooks ?? {}
    this.generate = options.generate
    this.generateStream = options.generateStream
  }

  /**
   * Run agent to completion
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const messages = this.buildInitialMessages(input)
    const tools = input.tools ?? this.config.tools ?? []
    const stopConditions = input.stopWhen ?? this.config.stopWhen ?? stepCountIs(this.config.maxSteps ?? 20)

    let stepNumber = 0
    let totalTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const allToolCalls: ToolCall[] = []
    const allToolResults: ToolResult[] = []

    while (true) {
      stepNumber++

      // Prepare step (may modify config)
      let stepConfig = this.config
      if (this.config.prepareStep) {
        const state: StepState = {
          stepNumber,
          messages,
          lastStep: { finishReason: 'stop', toolCalls: [], toolResults: [] },
          totalTokens: totalTokens.totalTokens,
        }
        const prepared = await this.config.prepareStep(state)
        stepConfig = {
          ...this.config,
          model: prepared.model ?? this.config.model,
          tools: prepared.tools ?? this.config.tools,
          instructions: prepared.instructions ?? this.config.instructions,
          providerOptions: {
            ...this.config.providerOptions,
            ...prepared.providerOptions,
          },
        }
        if (prepared.messages) {
          messages.length = 0
          messages.push(...prepared.messages)
        }
      }

      // Hook: step start
      await this.hooks.onStepStart?.(stepNumber, {
        stepNumber,
        messages,
        lastStep: { finishReason: 'stop' },
        totalTokens: totalTokens.totalTokens,
      })

      // Generate
      const stepResult = await this.generate(messages, { ...stepConfig, tools })

      // Accumulate usage
      if (stepResult.usage) {
        totalTokens.promptTokens += stepResult.usage.promptTokens
        totalTokens.completionTokens += stepResult.usage.completionTokens
        totalTokens.totalTokens += stepResult.usage.totalTokens
      }

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: stepResult.text,
        toolCalls: stepResult.toolCalls,
      })

      // Execute tool calls
      if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
        for (const toolCall of stepResult.toolCalls) {
          allToolCalls.push(toolCall)

          // Hook: pre tool use
          if (this.hooks.onPreToolUse) {
            const decision = await this.hooks.onPreToolUse(toolCall)
            if (decision.action === 'deny') {
              const result: ToolResult = {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: null,
                error: decision.reason,
              }
              allToolResults.push(result)
              messages.push({
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: { error: decision.reason },
              })
              continue
            }
            if (decision.action === 'modify') {
              toolCall.arguments = decision.arguments
            }
          }

          // Find and execute tool
          const toolDef = tools.find((t) => t.name === toolCall.name)
          let result: ToolResult

          if (toolDef) {
            const context: ToolContext = {
              agentId: this.config.id,
              abortSignal: input.signal,
            }

            try {
              const validation = validateInput(toolDef.inputSchema, toolCall.arguments)
              if (!validation.success) {
                throw validation.error
              }

              const output = await toolDef.execute(validation.data, context)
              result = {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: output,
              }
            } catch (error) {
              result = {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: null,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          } else {
            result = {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: null,
              error: `Unknown tool: ${toolCall.name}`,
            }
          }

          allToolResults.push(result)

          // Add tool result message
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: result.error ? { error: result.error } : result.result,
          })

          // Hook: post tool use
          await this.hooks.onPostToolUse?.(toolCall, result)
        }

        stepResult.toolResults = allToolResults.slice(-stepResult.toolCalls.length)
      }

      // Hook: step finish
      await this.hooks.onStepFinish?.(stepResult, stepNumber)

      // Check stop conditions
      const state: StepState = {
        stepNumber,
        messages,
        lastStep: stepResult,
        totalTokens: totalTokens.totalTokens,
      }

      if (shouldStop(stopConditions, state)) {
        return {
          text: stepResult.text ?? '',
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          messages,
          steps: stepNumber,
          finishReason: stepResult.finishReason,
          usage: totalTokens,
        }
      }

      // If no tool calls and we have text, stop
      if (!stepResult.toolCalls?.length && stepResult.text) {
        return {
          text: stepResult.text,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          messages,
          steps: stepNumber,
          finishReason: stepResult.finishReason,
          usage: totalTokens,
        }
      }

      // Check abort signal
      if (input.signal?.aborted) {
        return {
          text: stepResult.text ?? '',
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          messages,
          steps: stepNumber,
          finishReason: 'cancelled',
          usage: totalTokens,
        }
      }
    }
  }

  /**
   * Stream agent execution
   */
  stream(input: AgentInput): AgentStreamResult {
    const self = this

    // Create deferred promises for final values
    let resolveResult: (result: AgentResult) => void
    let rejectResult: (error: Error) => void
    const resultPromise = new Promise<AgentResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
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
        const result = await self.run(input)

        // Emit text as a single chunk
        if (result.text) {
          yield {
            type: 'text-delta',
            data: { textDelta: result.text },
            timestamp: new Date(),
          }
        }

        // Emit done
        yield {
          type: 'done',
          data: { finalResult: result },
          timestamp: new Date(),
        }

        resolveResult(result)
        resolveText(result.text)
        resolveToolCalls(result.toolCalls)
        resolveUsage(result.usage)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        yield {
          type: 'error',
          data: { error: err },
          timestamp: new Date(),
        }
        rejectResult(err)
      }
    }

    return {
      [Symbol.asyncIterator]: generateEvents,
      result: resultPromise,
      text: textPromise,
      toolCalls: toolCallsPromise,
      usage: usagePromise,
    }
  }

  /**
   * Spawn a subagent (Claude pattern)
   */
  async spawnSubagent?(task: SubagentTask): Promise<SubagentResult> {
    if (!this.config.canSpawnSubagents) {
      throw new Error('Agent is not configured to spawn subagents')
    }

    const subagentConfig: AgentConfig = {
      ...this.config,
      id: `${this.config.id}-subagent-${Date.now()}`,
      ...task.agentConfig,
    }

    const subagent = this.provider.createAgent(subagentConfig)

    const controller = new AbortController()
    const timeoutId = task.timeout
      ? setTimeout(() => controller.abort(), task.timeout)
      : null

    try {
      const result = await subagent.run({
        prompt: task.prompt,
        signal: controller.signal,
      })

      return {
        taskId: subagentConfig.id,
        status: 'completed',
        result,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          taskId: subagentConfig.id,
          status: 'timeout',
          error: new Error('Subagent timed out'),
        }
      }
      return {
        taskId: subagentConfig.id,
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  /**
   * Hand off to another agent (OpenAI pattern)
   */
  async handoff?(request: HandoffRequest): Promise<AgentResult> {
    const targetAgent = this.config.handoffs?.find((a) => a.id === request.targetAgentId)
    if (!targetAgent) {
      throw new Error(`Handoff target not found: ${request.targetAgentId}`)
    }

    const agent = this.provider.createAgent(targetAgent)

    return agent.run({
      messages: [
        ...request.context,
        {
          role: 'system',
          content: `Handoff from ${this.config.id}: ${request.reason}`,
        },
      ],
    })
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildInitialMessages(input: AgentInput): Message[] {
    const messages: Message[] = []

    // Add system message with instructions
    if (this.config.instructions) {
      messages.push({
        role: 'system',
        content: this.config.instructions,
      })
    }

    // Add provided messages or prompt
    if (input.messages) {
      messages.push(...input.messages)
    } else if (input.prompt) {
      messages.push({
        role: 'user',
        content: input.prompt,
      })
    }

    return messages
  }
}

export default BaseAgent
