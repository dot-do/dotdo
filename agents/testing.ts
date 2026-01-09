/**
 * Testing Utilities for Agent SDK
 *
 * Provides reusable helpers for testing agents, providers, and tools.
 *
 * @module agents/testing
 *
 * @example
 * ```ts
 * import { createMockProvider, createMockTool, mockResponses } from './testing'
 *
 * const provider = createMockProvider({
 *   responses: [
 *     mockResponses.text('Hello!'),
 *     mockResponses.toolCall('search', { query: 'test' }),
 *     mockResponses.text('Done!'),
 *   ],
 * })
 *
 * const agent = provider.createAgent({ ... })
 * const result = await agent.run({ prompt: 'Test' })
 * ```
 */

import { BaseAgent } from './Agent'
import type {
  AgentConfig,
  AgentProvider,
  Message,
  StepResult,
  StreamEvent,
  ToolDefinition,
  ToolCall,
  ToolResult,
  TokenUsage,
} from './types'

// ============================================================================
// Mock Response Builders
// ============================================================================

/**
 * Helpers for building mock step results
 */
export const mockResponses = {
  /**
   * Create a text-only response
   */
  text(content: string, usage?: Partial<TokenUsage>): StepResult {
    return {
      text: content,
      finishReason: 'stop',
      usage: {
        promptTokens: usage?.promptTokens ?? 10,
        completionTokens: usage?.completionTokens ?? 5,
        totalTokens: usage?.totalTokens ?? 15,
      },
    }
  },

  /**
   * Create a response with tool calls
   */
  toolCall(
    toolName: string,
    args: Record<string, unknown>,
    options: { id?: string; text?: string } = {}
  ): StepResult {
    return {
      text: options.text,
      toolCalls: [
        {
          id: options.id ?? `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          arguments: args,
        },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }
  },

  /**
   * Create a response with multiple tool calls
   */
  toolCalls(calls: { name: string; args: Record<string, unknown>; id?: string }[]): StepResult {
    return {
      toolCalls: calls.map((tc, i) => ({
        id: tc.id ?? `call-${Date.now()}-${i}`,
        name: tc.name,
        arguments: tc.args,
      })),
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }
  },

  /**
   * Create an error response
   */
  error(message: string): StepResult {
    return {
      text: message,
      finishReason: 'error',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }
  },

  /**
   * Create a max tokens exceeded response
   */
  maxTokens(partialText: string): StepResult {
    return {
      text: partialText,
      finishReason: 'max_steps',
      usage: { promptTokens: 100, completionTokens: 4096, totalTokens: 4196 },
    }
  },
}

// ============================================================================
// Mock Provider Factory
// ============================================================================

/**
 * Options for creating a mock provider
 */
export interface MockProviderOptions {
  /** Sequence of responses to return for each generate call */
  responses: StepResult[]
  /** Provider name (default: 'mock') */
  name?: string
  /** Whether to support streaming (default: true) */
  supportsStreaming?: boolean
  /** Callback before each generate call */
  onGenerate?: (messages: Message[], config: AgentConfig, stepIndex: number) => void
}

/**
 * Create a mock provider for testing
 *
 * The provider returns responses in sequence for each step.
 * Once responses are exhausted, it returns a default "No more responses" text.
 *
 * @example
 * ```ts
 * const provider = createMockProvider({
 *   responses: [
 *     mockResponses.text('First response'),
 *     mockResponses.toolCall('search', { query: 'test' }),
 *     mockResponses.text('Final response'),
 *   ],
 * })
 *
 * const agent = provider.createAgent({
 *   id: 'test',
 *   name: 'Test',
 *   instructions: 'You are a test agent',
 *   model: 'mock',
 * })
 *
 * const result = await agent.run({ prompt: 'Hello' })
 * ```
 */
export function createMockProvider(options: MockProviderOptions): AgentProvider {
  let stepIndex = 0

  const provider: AgentProvider = {
    name: options.name ?? 'mock',
    version: '1.0.0',

    createAgent(config: AgentConfig) {
      return new BaseAgent({
        config,
        provider,
        generate: async (messages, cfg) => {
          options.onGenerate?.(messages, cfg, stepIndex)

          const response = options.responses[stepIndex] ?? {
            text: 'No more responses',
            finishReason: 'stop' as const,
          }
          stepIndex++
          return response
        },
        generateStream:
          options.supportsStreaming !== false
            ? async function* (messages, cfg) {
                options.onGenerate?.(messages, cfg, stepIndex)

                const response = options.responses[stepIndex] ?? {
                  text: 'No more responses',
                  finishReason: 'stop' as const,
                }
                stepIndex++

                // Emit text deltas
                if (response.text) {
                  for (const char of response.text) {
                    yield {
                      type: 'text-delta' as const,
                      data: { textDelta: char },
                      timestamp: new Date(),
                    }
                  }
                }

                // Emit tool call events
                if (response.toolCalls) {
                  for (const tc of response.toolCalls) {
                    yield {
                      type: 'tool-call-start' as const,
                      data: { toolCallId: tc.id, toolName: tc.name },
                      timestamp: new Date(),
                    }
                    yield {
                      type: 'tool-call-end' as const,
                      data: { toolCall: tc },
                      timestamp: new Date(),
                    }
                  }
                }

                // Emit done
                yield {
                  type: 'done' as const,
                  data: {
                    finalResult: {
                      text: response.text ?? '',
                      toolCalls: response.toolCalls ?? [],
                      toolResults: [],
                      messages,
                      steps: stepIndex,
                      finishReason: response.finishReason,
                      usage: response.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    },
                  },
                  timestamp: new Date(),
                }
              }
            : undefined,
      })
    },

    async listModels() {
      return ['mock-model']
    },
  }

  return provider
}

/**
 * Create a mock provider that resets step index for each agent
 *
 * Unlike createMockProvider which shares state across all agents,
 * this creates isolated instances where each agent starts from step 0.
 */
export function createIsolatedMockProvider(options: MockProviderOptions): AgentProvider {
  const provider: AgentProvider = {
    name: options.name ?? 'mock',
    version: '1.0.0',

    createAgent(config: AgentConfig) {
      let stepIndex = 0

      return new BaseAgent({
        config,
        provider,
        generate: async (messages, cfg) => {
          options.onGenerate?.(messages, cfg, stepIndex)

          const response = options.responses[stepIndex] ?? {
            text: 'No more responses',
            finishReason: 'stop' as const,
          }
          stepIndex++
          return response
        },
      })
    },

    async listModels() {
      return ['mock-model']
    },
  }

  return provider
}

// ============================================================================
// Mock Tool Factory
// ============================================================================

/**
 * Create a mock tool for testing
 *
 * @example
 * ```ts
 * const searchTool = createMockTool({
 *   name: 'search',
 *   description: 'Search the web',
 *   execute: async ({ query }) => ({ results: [`Result for: ${query}`] }),
 * })
 * ```
 */
export function createMockTool<TInput = Record<string, unknown>, TOutput = unknown>(options: {
  name: string
  description?: string
  inputSchema?: ToolDefinition['inputSchema']
  execute?: (input: TInput) => Promise<TOutput>
  executeSync?: (input: TInput) => TOutput
}): ToolDefinition<TInput, TOutput> {
  return {
    name: options.name,
    description: options.description ?? `Mock ${options.name} tool`,
    inputSchema: options.inputSchema ?? ({ type: 'object', properties: {} } as any),
    execute: options.execute ?? (async (input) => (options.executeSync?.(input) ?? { success: true }) as TOutput),
  }
}

/**
 * Create a mock tool that tracks calls
 *
 * @example
 * ```ts
 * const [tool, calls] = createTrackedTool('search')
 *
 * // ... run agent with tool ...
 *
 * expect(calls).toHaveLength(2)
 * expect(calls[0].input).toEqual({ query: 'first search' })
 * ```
 */
export function createTrackedTool<TInput = Record<string, unknown>>(
  name: string,
  returnValue: unknown = { success: true }
): [ToolDefinition<TInput, unknown>, { input: TInput; timestamp: Date }[]] {
  const calls: { input: TInput; timestamp: Date }[] = []

  const tool: ToolDefinition<TInput, unknown> = {
    name,
    description: `Tracked ${name} tool`,
    inputSchema: { type: 'object', properties: {} } as any,
    execute: async (input) => {
      calls.push({ input, timestamp: new Date() })
      return returnValue
    },
  }

  return [tool, calls]
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Common test agent configurations
 */
export const fixtures = {
  /** Minimal agent config */
  minimalAgent: {
    id: 'test-agent',
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    model: 'mock',
  } satisfies AgentConfig,

  /** Agent with tools */
  agentWithTools: {
    id: 'tool-agent',
    name: 'Tool Agent',
    instructions: 'You are an agent with tools.',
    model: 'mock',
    tools: [],
  } satisfies AgentConfig,

  /** Chat-style messages */
  chatMessages: [
    { role: 'user' as const, content: 'Hello!' },
    { role: 'assistant' as const, content: 'Hi there!' },
    { role: 'user' as const, content: 'How are you?' },
  ] satisfies Message[],

  /** Tool call message sequence */
  toolCallSequence: [
    { role: 'user' as const, content: 'Search for cats' },
    {
      role: 'assistant' as const,
      content: 'Let me search for that.',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'cats' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'call-1',
      toolName: 'search',
      content: { results: ['cats are cute'] },
    },
    { role: 'assistant' as const, content: 'I found that cats are cute!' },
  ] satisfies Message[],
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that an agent result contains expected properties
 */
export function expectAgentResult(
  result: { text: string; steps: number; toolCalls: ToolCall[] },
  expected: { text?: string | RegExp; minSteps?: number; maxSteps?: number; toolCallCount?: number }
): void {
  if (expected.text !== undefined) {
    if (expected.text instanceof RegExp) {
      if (!expected.text.test(result.text)) {
        throw new Error(`Expected text to match ${expected.text}, got "${result.text}"`)
      }
    } else if (result.text !== expected.text) {
      throw new Error(`Expected text "${expected.text}", got "${result.text}"`)
    }
  }

  if (expected.minSteps !== undefined && result.steps < expected.minSteps) {
    throw new Error(`Expected at least ${expected.minSteps} steps, got ${result.steps}`)
  }

  if (expected.maxSteps !== undefined && result.steps > expected.maxSteps) {
    throw new Error(`Expected at most ${expected.maxSteps} steps, got ${result.steps}`)
  }

  if (expected.toolCallCount !== undefined && result.toolCalls.length !== expected.toolCallCount) {
    throw new Error(`Expected ${expected.toolCallCount} tool calls, got ${result.toolCalls.length}`)
  }
}

/**
 * Wait for a stream to complete and collect all events
 */
export async function collectStreamEvents(
  stream: AsyncIterable<StreamEvent>
): Promise<{ events: StreamEvent[]; textDeltas: string[]; toolCalls: ToolCall[] }> {
  const events: StreamEvent[] = []
  const textDeltas: string[] = []
  const toolCalls: ToolCall[] = []

  for await (const event of stream) {
    events.push(event)

    if (event.type === 'text-delta') {
      textDeltas.push((event.data as { textDelta: string }).textDelta)
    }

    if (event.type === 'tool-call-end') {
      toolCalls.push((event.data as { toolCall: ToolCall }).toolCall)
    }
  }

  return { events, textDeltas, toolCalls }
}
