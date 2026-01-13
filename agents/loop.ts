/**
 * Agent Loop - Think, Act, Observe Execution Pattern
 *
 * The agent loop implements the core cognitive pattern for AI agents:
 *
 * 1. **Think (Plan)**: LLM generates a response, possibly with tool calls
 * 2. **Act (Execute)**: If tool calls present, execute them
 * 3. **Observe (Process)**: Process results, add to context, continue or stop
 *
 * This module provides both the embedded loop (used by BaseAgent) and
 * a standalone AgentLoop class for custom agent implementations.
 *
 * @example
 * ```ts
 * import { AgentLoop, createAgentLoop } from './loop'
 *
 * const loop = createAgentLoop({
 *   generate: async (messages) => provider.complete(messages),
 *   tools: [weatherTool, calculatorTool],
 *   maxSteps: 10,
 * })
 *
 * const result = await loop.run({ prompt: 'What is the weather in NYC?' })
 * ```
 *
 * @module agents/loop
 */

import type {
  Message,
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  StepState,
  StepResult,
  StopCondition,
  TokenUsage,
  AgentHooks,
  AgentResult,
} from './types'
import { shouldStop, stepCountIs } from './stopConditions'
import { validateInput } from './Tool'

// ============================================================================
// Types
// ============================================================================

/**
 * Step in the agent loop with explicit phase information
 */
export interface AgentLoopStep {
  /** Step number (1-indexed) */
  stepNumber: number
  /** Phase: think (LLM call), act (tool execution), observe (process results) */
  phase: 'think' | 'act' | 'observe'
  /** Messages at this point */
  messages: Message[]
  /** Result from think phase */
  thinkResult?: StepResult
  /** Tool executions from act phase */
  actResults?: ToolResult[]
  /** Observation/analysis from observe phase */
  observation?: string
  /** Token usage for this step */
  usage?: TokenUsage
}

/**
 * Configuration for the agent loop
 */
export interface AgentLoopConfig {
  /** Function to call LLM for think phase */
  generate: (messages: Message[], tools?: ToolDefinition[]) => Promise<StepResult>
  /** Available tools for act phase */
  tools?: ToolDefinition[]
  /** Stop conditions */
  stopWhen?: StopCondition | StopCondition[]
  /** Maximum steps before forcing stop */
  maxSteps?: number
  /** Hooks for customization */
  hooks?: AgentHooks
  /** Agent ID for tool context */
  agentId?: string
  /** Abort signal */
  signal?: AbortSignal
}

/**
 * Input for running the agent loop
 */
export interface AgentLoopInput {
  /** Initial prompt */
  prompt?: string
  /** Initial messages */
  messages?: Message[]
  /** Override tools for this run */
  tools?: ToolDefinition[]
  /** Override stop conditions */
  stopWhen?: StopCondition | StopCondition[]
  /** Abort signal */
  signal?: AbortSignal
}

/**
 * Events emitted during loop execution
 */
export type AgentLoopEvent =
  | { type: 'step-start'; step: AgentLoopStep }
  | { type: 'think-start'; stepNumber: number; messages: Message[] }
  | { type: 'think-complete'; stepNumber: number; result: StepResult }
  | { type: 'act-start'; stepNumber: number; toolCalls: ToolCall[] }
  | { type: 'act-complete'; stepNumber: number; results: ToolResult[] }
  | { type: 'observe-start'; stepNumber: number; state: StepState }
  | { type: 'observe-complete'; stepNumber: number; shouldStop: boolean }
  | { type: 'step-complete'; step: AgentLoopStep }
  | { type: 'loop-complete'; result: AgentResult }
  | { type: 'error'; error: Error; stepNumber?: number }

// ============================================================================
// Agent Loop Implementation
// ============================================================================

/**
 * AgentLoop - Explicit Think, Act, Observe execution cycle
 *
 * The loop encapsulates the core cognitive pattern:
 * - Think: Call LLM to plan/respond (may include tool calls)
 * - Act: Execute any requested tools
 * - Observe: Process results, update context, decide to continue or stop
 *
 * @example
 * ```ts
 * const loop = new AgentLoop({
 *   generate: async (messages) => llm.complete({ messages }),
 *   tools: [searchTool, writeTool],
 *   maxSteps: 5,
 * })
 *
 * // Run to completion
 * const result = await loop.run({ prompt: 'Research and write a report on AI' })
 *
 * // Or stream events
 * for await (const event of loop.stream({ prompt: 'Hello' })) {
 *   console.log(event.type, event)
 * }
 * ```
 */
export class AgentLoop {
  private config: AgentLoopConfig

  constructor(config: AgentLoopConfig) {
    this.config = config
  }

  /**
   * Run the agent loop to completion
   *
   * @param input - Input prompt or messages
   * @returns Final result after loop completes
   */
  async run(input: AgentLoopInput): Promise<AgentResult> {
    const messages = this.buildInitialMessages(input)
    const tools = input.tools ?? this.config.tools ?? []
    const stopConditions = input.stopWhen ?? this.config.stopWhen ?? stepCountIs(this.config.maxSteps ?? 20)
    const signal = input.signal ?? this.config.signal

    let stepNumber = 0
    let totalTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const allToolCalls: ToolCall[] = []
    const allToolResults: ToolResult[] = []

    while (true) {
      stepNumber++

      // Check abort before starting step
      if (signal?.aborted) {
        return this.buildResult('', allToolCalls, allToolResults, messages, stepNumber, 'cancelled', totalTokens)
      }

      // ========================================
      // THINK Phase - LLM generates response
      // ========================================
      await this.config.hooks?.onStepStart?.(stepNumber, {
        stepNumber,
        messages,
        lastStep: { finishReason: 'stop' },
        totalTokens: totalTokens.totalTokens,
      })

      const thinkResult = await this.think(messages, tools)

      // Accumulate usage
      if (thinkResult.usage) {
        totalTokens = this.accumulateUsage(totalTokens, thinkResult.usage)
      }

      // Add assistant message to context
      messages.push({
        role: 'assistant',
        content: thinkResult.text,
        toolCalls: thinkResult.toolCalls,
      })

      // ========================================
      // ACT Phase - Execute tool calls
      // ========================================
      if (thinkResult.toolCalls && thinkResult.toolCalls.length > 0) {
        const actResults = await this.act(thinkResult.toolCalls, tools, signal)

        // Add results to tracking
        allToolCalls.push(...thinkResult.toolCalls)
        allToolResults.push(...actResults)

        // Add tool results to messages
        for (const result of actResults) {
          messages.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            content: result.error ? { error: result.error } : result.result,
          })
        }

        thinkResult.toolResults = actResults
      }

      // ========================================
      // OBSERVE Phase - Process and decide
      // ========================================
      await this.config.hooks?.onStepFinish?.(thinkResult, stepNumber)

      const state: StepState = {
        stepNumber,
        messages,
        lastStep: thinkResult,
        totalTokens: totalTokens.totalTokens,
      }

      const shouldStopNow = this.observe(state, stopConditions, thinkResult)

      if (shouldStopNow) {
        return this.buildResult(
          thinkResult.text ?? '',
          allToolCalls,
          allToolResults,
          messages,
          stepNumber,
          thinkResult.finishReason,
          totalTokens
        )
      }

      // Check abort after observe
      if (signal?.aborted) {
        return this.buildResult(
          thinkResult.text ?? '',
          allToolCalls,
          allToolResults,
          messages,
          stepNumber,
          'cancelled',
          totalTokens
        )
      }
    }
  }

  /**
   * Stream loop events
   *
   * @param input - Input prompt or messages
   * @yields Loop events as they occur
   */
  async *stream(input: AgentLoopInput): AsyncGenerator<AgentLoopEvent> {
    const messages = this.buildInitialMessages(input)
    const tools = input.tools ?? this.config.tools ?? []
    const stopConditions = input.stopWhen ?? this.config.stopWhen ?? stepCountIs(this.config.maxSteps ?? 20)
    const signal = input.signal ?? this.config.signal

    let stepNumber = 0
    let totalTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const allToolCalls: ToolCall[] = []
    const allToolResults: ToolResult[] = []

    try {
      while (true) {
        stepNumber++

        // Check abort
        if (signal?.aborted) {
          yield {
            type: 'loop-complete',
            result: this.buildResult('', allToolCalls, allToolResults, messages, stepNumber, 'cancelled', totalTokens),
          }
          return
        }

        const step: AgentLoopStep = {
          stepNumber,
          phase: 'think',
          messages: [...messages],
        }

        yield { type: 'step-start', step }

        // ========================================
        // THINK Phase
        // ========================================
        yield { type: 'think-start', stepNumber, messages: [...messages] }

        const thinkResult = await this.think(messages, tools)

        if (thinkResult.usage) {
          totalTokens = this.accumulateUsage(totalTokens, thinkResult.usage)
        }

        step.thinkResult = thinkResult
        step.usage = thinkResult.usage

        yield { type: 'think-complete', stepNumber, result: thinkResult }

        messages.push({
          role: 'assistant',
          content: thinkResult.text,
          toolCalls: thinkResult.toolCalls,
        })

        // ========================================
        // ACT Phase
        // ========================================
        if (thinkResult.toolCalls && thinkResult.toolCalls.length > 0) {
          step.phase = 'act'
          yield { type: 'act-start', stepNumber, toolCalls: thinkResult.toolCalls }

          const actResults = await this.act(thinkResult.toolCalls, tools, signal)

          allToolCalls.push(...thinkResult.toolCalls)
          allToolResults.push(...actResults)
          step.actResults = actResults

          for (const result of actResults) {
            messages.push({
              role: 'tool',
              toolCallId: result.toolCallId,
              toolName: result.toolName,
              content: result.error ? { error: result.error } : result.result,
            })
          }

          thinkResult.toolResults = actResults

          yield { type: 'act-complete', stepNumber, results: actResults }
        }

        // ========================================
        // OBSERVE Phase
        // ========================================
        step.phase = 'observe'

        const state: StepState = {
          stepNumber,
          messages,
          lastStep: thinkResult,
          totalTokens: totalTokens.totalTokens,
        }

        yield { type: 'observe-start', stepNumber, state }

        const shouldStopNow = this.observe(state, stopConditions, thinkResult)

        yield { type: 'observe-complete', stepNumber, shouldStop: shouldStopNow }

        step.messages = [...messages]
        yield { type: 'step-complete', step }

        if (shouldStopNow) {
          yield {
            type: 'loop-complete',
            result: this.buildResult(
              thinkResult.text ?? '',
              allToolCalls,
              allToolResults,
              messages,
              stepNumber,
              thinkResult.finishReason,
              totalTokens
            ),
          }
          return
        }

        if (signal?.aborted) {
          yield {
            type: 'loop-complete',
            result: this.buildResult(
              thinkResult.text ?? '',
              allToolCalls,
              allToolResults,
              messages,
              stepNumber,
              'cancelled',
              totalTokens
            ),
          }
          return
        }
      }
    } catch (error) {
      yield { type: 'error', error: error as Error, stepNumber }
      throw error
    }
  }

  // ============================================================================
  // Phase Implementations
  // ============================================================================

  /**
   * THINK Phase - Call LLM to generate response/plan
   *
   * @param messages - Current conversation context
   * @param tools - Available tools
   * @returns LLM step result
   */
  private async think(messages: Message[], tools: ToolDefinition[]): Promise<StepResult> {
    return this.config.generate(messages, tools)
  }

  /**
   * ACT Phase - Execute tool calls
   *
   * @param toolCalls - Tool calls from think phase
   * @param tools - Available tool definitions
   * @param signal - Abort signal
   * @returns Tool execution results
   */
  private async act(
    toolCalls: ToolCall[],
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = []

    for (const toolCall of toolCalls) {
      // Check abort between tool calls
      if (signal?.aborted) {
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: 'Execution cancelled',
        })
        continue
      }

      // Pre-tool hook
      if (this.config.hooks?.onPreToolUse) {
        const decision = await this.config.hooks.onPreToolUse(toolCall)
        if (decision.action === 'deny') {
          results.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: decision.reason,
          })
          continue
        }
        if (decision.action === 'use_cached') {
          // Skip execution and use cached result
          const cachedResult: ToolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: decision.result,
          }
          results.push(cachedResult)
          // Still call post-hook to allow tracking
          await this.config.hooks?.onPostToolUse?.(toolCall, cachedResult)
          continue
        }
        if (decision.action === 'modify') {
          toolCall.arguments = decision.arguments
        }
      }

      // Find tool definition
      const toolDef = tools.find((t) => t.name === toolCall.name)
      let result: ToolResult

      if (toolDef) {
        const context: ToolContext = {
          agentId: this.config.agentId ?? 'agent-loop',
          abortSignal: signal,
        }

        try {
          // Validate input
          const validation = validateInput(toolDef.inputSchema, toolCall.arguments)
          if (!validation.success) {
            throw validation.error
          }

          // Execute tool
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

      results.push(result)

      // Post-tool hook
      await this.config.hooks?.onPostToolUse?.(toolCall, result)
    }

    return results
  }

  /**
   * OBSERVE Phase - Process results and decide whether to continue
   *
   * @param state - Current step state
   * @param stopConditions - Conditions that trigger loop termination
   * @param stepResult - Result from think phase
   * @returns True if loop should stop
   */
  private observe(
    state: StepState,
    stopConditions: StopCondition | StopCondition[],
    stepResult: StepResult
  ): boolean {
    // Check explicit stop conditions
    if (shouldStop(stopConditions, state)) {
      return true
    }

    // Default behavior: stop if no tool calls and we have text
    if (!stepResult.toolCalls?.length && stepResult.text) {
      return true
    }

    return false
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private buildInitialMessages(input: AgentLoopInput): Message[] {
    const messages: Message[] = []

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

  private accumulateUsage(total: TokenUsage, step: TokenUsage): TokenUsage {
    return {
      promptTokens: total.promptTokens + step.promptTokens,
      completionTokens: total.completionTokens + step.completionTokens,
      totalTokens: total.totalTokens + step.totalTokens,
    }
  }

  private buildResult(
    text: string,
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    messages: Message[],
    steps: number,
    finishReason: StepResult['finishReason'] | 'cancelled',
    usage: TokenUsage
  ): AgentResult {
    return {
      text,
      toolCalls,
      toolResults,
      messages,
      steps,
      finishReason: finishReason as AgentResult['finishReason'],
      usage,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an agent loop instance
 *
 * @param config - Loop configuration
 * @returns Configured AgentLoop instance
 *
 * @example
 * ```ts
 * const loop = createAgentLoop({
 *   generate: async (messages, tools) => {
 *     const response = await openai.chat.completions.create({
 *       model: 'gpt-4',
 *       messages,
 *       tools: tools?.map(t => convertTool(t)),
 *     })
 *     return parseResponse(response)
 *   },
 *   tools: [searchTool],
 *   maxSteps: 10,
 * })
 *
 * const result = await loop.run({ prompt: 'Search for recent AI news' })
 * ```
 */
export function createAgentLoop(config: AgentLoopConfig): AgentLoop {
  return new AgentLoop(config)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Run a single think-act-observe cycle
 *
 * Useful for custom loop implementations that need fine-grained control.
 *
 * @param messages - Current messages
 * @param generate - LLM generate function
 * @param tools - Available tools
 * @param hooks - Optional hooks
 * @returns Step result with tool results
 */
export async function runSingleCycle(
  messages: Message[],
  generate: (messages: Message[], tools?: ToolDefinition[]) => Promise<StepResult>,
  tools: ToolDefinition[] = [],
  hooks?: AgentHooks
): Promise<{
  result: StepResult
  toolResults: ToolResult[]
  newMessages: Message[]
}> {
  // Think
  const result = await generate(messages, tools)

  const newMessages: Message[] = [
    {
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
    },
  ]

  // Act
  const toolResults: ToolResult[] = []
  if (result.toolCalls && result.toolCalls.length > 0) {
    for (const toolCall of result.toolCalls) {
      // Pre-hook
      if (hooks?.onPreToolUse) {
        const decision = await hooks.onPreToolUse(toolCall)
        if (decision.action === 'deny') {
          toolResults.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: decision.reason,
          })
          continue
        }
        if (decision.action === 'use_cached') {
          // Skip execution and use cached result
          const cachedResult: ToolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: decision.result,
          }
          toolResults.push(cachedResult)
          await hooks?.onPostToolUse?.(toolCall, cachedResult)
          newMessages.push({
            role: 'tool',
            toolCallId: cachedResult.toolCallId,
            toolName: cachedResult.toolName,
            content: cachedResult.result,
          })
          continue
        }
        if (decision.action === 'modify') {
          toolCall.arguments = decision.arguments
        }
      }

      const toolDef = tools.find((t) => t.name === toolCall.name)
      let toolResult: ToolResult

      if (toolDef) {
        try {
          const validation = validateInput(toolDef.inputSchema, toolCall.arguments)
          if (!validation.success) {
            throw validation.error
          }
          const output = await toolDef.execute(validation.data, { agentId: 'cycle' })
          toolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: output,
          }
        } catch (error) {
          toolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      } else {
        toolResult = {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: `Unknown tool: ${toolCall.name}`,
        }
      }

      toolResults.push(toolResult)

      // Post-hook
      await hooks?.onPostToolUse?.(toolCall, toolResult)

      // Add to messages
      newMessages.push({
        role: 'tool',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        content: toolResult.error ? { error: toolResult.error } : toolResult.result,
      })
    }
  }

  result.toolResults = toolResults

  return { result, toolResults, newMessages }
}

export default AgentLoop
