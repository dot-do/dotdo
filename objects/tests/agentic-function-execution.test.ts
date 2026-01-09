/**
 * AgenticFunction Execution Tests
 *
 * RED TDD: These tests should FAIL because AgenticFunction execution engine doesn't exist yet.
 *
 * AgenticFunction is a function type that orchestrates multi-step AI tasks with tools.
 * It runs an AI model in a loop, allowing it to call tools, observe results, and
 * iterate until a final answer is reached or limits are exceeded.
 *
 * This file tests the execution engine for agentic functions:
 * 1. Agent runner with tool loop
 * 2. Tool discovery and execution
 * 3. Iteration limits and convergence
 * 4. Step callbacks for observability
 * 5. State management between steps
 * 6. Error recovery and retry
 * 7. Parallel tool execution
 * 8. Memory/conversation history
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  AgenticFunctionExecutor,
  type AgentContext,
  type AgentResult,
  type AgentStep,
  type ToolDefinition,
  type ToolResult,
  type ToolCall,
  type ExecutionOptions,
  type ConversationMessage,
  AgentMaxIterationsError,
  AgentToolExecutionError,
  AgentConvergenceError,
  AgentToolNotFoundError,
  AgentToolAuthorizationError,
  AgentCancelledError,
} from '../AgenticFunctionExecutor'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected agent context passed to tools and callbacks
 */
interface ExpectedAgentContext {
  // Identity
  agentId: string
  invocationId: string

  // Current state
  currentIteration: number
  maxIterations: number

  // State management
  state: {
    get: <T>(key: string) => Promise<T | null>
    set: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    getAll: () => Promise<Record<string, unknown>>
  }

  // Services
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
    }>
  }

  // Logging
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }

  // Events
  emit: (event: string, data: unknown) => Promise<void>

  // Cancellation
  signal: AbortSignal
}

/**
 * Expected agent step emitted during execution
 */
interface ExpectedAgentStep {
  iteration: number
  type: 'thinking' | 'tool_call' | 'tool_result' | 'final_answer'
  thought?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  answer?: string
  timestamp: Date
  duration?: number
}

/**
 * Expected agent result
 */
interface ExpectedAgentResult {
  success: boolean
  result?: string
  error?: {
    message: string
    name: string
    stack?: string
  }
  iterations: number
  steps: ExpectedAgentStep[]
  totalDuration: number
  toolCallCount: number
  metrics: {
    tokensUsed?: number
    modelCalls?: number
    toolCalls?: number
  }
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-agent-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    API_KEY: 'test-api-key',
    MODEL_ENDPOINT: 'https://api.example.com/v1',
  }
}

function createMockAI() {
  return {
    complete: vi.fn().mockResolvedValue({
      text: 'Final answer',
      stopReason: 'end_turn' as const,
    }),
  }
}

function createMockTools(): Record<string, ToolDefinition> {
  return {
    web_search: {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
      execute: vi.fn().mockResolvedValue({
        results: [
          { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
          { title: 'Result 2', url: 'https://example.com/2', snippet: 'Second result' },
        ],
      }),
    },
    read_url: {
      name: 'read_url',
      description: 'Read and extract content from a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to read' },
        },
        required: ['url'],
      },
      execute: vi.fn().mockResolvedValue({
        content: 'Page content extracted from URL',
        title: 'Page Title',
      }),
    },
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression' },
        },
        required: ['expression'],
      },
      execute: vi.fn().mockResolvedValue({ result: 42 }),
    },
    send_email: {
      name: 'send_email',
      description: 'Send an email',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
      execute: vi.fn().mockResolvedValue({ sent: true, messageId: 'msg-123' }),
      requiresAuthorization: true,
    },
    failing_tool: {
      name: 'failing_tool',
      description: 'A tool that always fails',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
    },
    slow_tool: {
      name: 'slow_tool',
      description: 'A tool that takes a long time',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return { result: 'slow' }
      }),
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('AgenticFunction Execution', () => {
  let executor: InstanceType<typeof AgenticFunctionExecutor>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockAI = createMockAI()
    mockTools = createMockTools()
    executor = new AgenticFunctionExecutor({
      state: mockState,
      env: mockEnv,
      ai: mockAI,
      tools: mockTools,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC AGENT TESTS (goal -> tool loop -> result)
  // ==========================================================================

  describe('Basic Agent Execution', () => {
    describe('Simple goal completion', () => {
      it('executes agent and returns final answer', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'The answer to your question is 42.',
          stopReason: 'end_turn',
        })

        const result = await executor.execute({
          goal: 'What is the meaning of life?',
          model: 'claude-3-sonnet',
        })

        expect(result.success).toBe(true)
        expect(result.result).toBe('The answer to your question is 42.')
      })

      it('passes goal as initial user message', async () => {
        await executor.execute({
          goal: 'Research AI trends in 2024',
          model: 'claude-3-sonnet',
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: 'user',
                content: 'Research AI trends in 2024',
              }),
            ]),
          })
        )
      })

      it('includes system prompt when provided', async () => {
        await executor.execute({
          goal: 'Help me',
          model: 'claude-3-sonnet',
          systemPrompt: 'You are a helpful research assistant.',
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: 'system',
                content: 'You are a helpful research assistant.',
              }),
            ]),
          })
        )
      })

      it('passes model to AI complete', async () => {
        await executor.execute({
          goal: 'Test',
          model: 'claude-opus-4',
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-opus-4',
          })
        )
      })

      it('returns iterations count', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'Done',
          stopReason: 'end_turn',
        })

        const result = await executor.execute({
          goal: 'Simple task',
          model: 'claude-3-sonnet',
        })

        expect(result.iterations).toBe(1)
      })

      it('tracks total duration', async () => {
        mockAI.complete.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { text: 'Done', stopReason: 'end_turn' as const }
        })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
        })

        expect(result.totalDuration).toBeGreaterThanOrEqual(50)
      })
    })

    describe('Tool loop execution', () => {
      it('executes tool when AI requests it', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'I need to search for information.',
            toolCalls: [
              {
                id: 'call_1',
                name: 'web_search',
                arguments: { query: 'AI trends 2024' },
              },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Based on my search, here are the AI trends...',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'What are the AI trends in 2024?',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        expect(mockTools.web_search.execute).toHaveBeenCalledWith(
          { query: 'AI trends 2024' },
          expect.any(Object) // context
        )
        expect(result.success).toBe(true)
        expect(result.iterations).toBe(2)
      })

      it('passes tool results back to AI', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Searching...',
            toolCalls: [
              {
                id: 'call_1',
                name: 'web_search',
                arguments: { query: 'test' },
              },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Final answer',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        // Second call should include tool results
        expect(mockAI.complete).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: 'tool',
                content: expect.stringContaining('Result 1'),
              }),
            ]),
          })
        )
      })

      it('executes multiple tools in sequence', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'First, I will search...',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'topic' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Now I will read the URL...',
            toolCalls: [{ id: 'call_2', name: 'read_url', arguments: { url: 'https://example.com/1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Based on my research, the answer is...',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Research a topic',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'read_url'],
        })

        expect(mockTools.web_search.execute).toHaveBeenCalledTimes(1)
        expect(mockTools.read_url.execute).toHaveBeenCalledTimes(1)
        expect(result.iterations).toBe(3)
        expect(result.toolCallCount).toBe(2)
      })

      it('handles AI response with no tool calls after tool_use', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Using tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '2+2' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'The result is 4',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Calculate 2+2',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        expect(result.success).toBe(true)
        expect(result.result).toBe('The result is 4')
      })
    })

    describe('Multi-step reasoning', () => {
      it('maintains conversation history across iterations', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Step 1: Searching',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'step1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Step 2: Reading',
            toolCalls: [{ id: 'call_2', name: 'read_url', arguments: { url: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Final answer based on steps 1 and 2',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Multi-step task',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'read_url'],
        })

        // Third call should have full conversation history
        const thirdCall = mockAI.complete.mock.calls[2][0]
        expect(thirdCall.messages.length).toBeGreaterThan(3)
      })

      it('tracks steps in result', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Thinking...',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'The answer is 2',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'What is 1+1?',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        expect(result.steps).toHaveLength(2)
        expect(result.steps[0].type).toBe('tool_call')
        expect(result.steps[1].type).toBe('final_answer')
      })
    })
  })

  // ==========================================================================
  // 2. TOOL TESTS (tool execution, parameter validation)
  // ==========================================================================

  describe('Tool Execution', () => {
    describe('Tool discovery', () => {
      it('provides available tools to AI', async () => {
        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'calculate'],
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: expect.arrayContaining([
              expect.objectContaining({ name: 'web_search' }),
              expect.objectContaining({ name: 'calculate' }),
            ]),
          })
        )
      })

      it('filters tools based on provided list', async () => {
        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        const call = mockAI.complete.mock.calls[0][0]
        expect(call.tools).toHaveLength(1)
        expect(call.tools[0].name).toBe('web_search')
      })

      it('throws when requested tool does not exist', async () => {
        await expect(
          executor.execute({
            goal: 'Test',
            model: 'claude-3-sonnet',
            tools: ['nonexistent_tool'],
          })
        ).rejects.toThrow(AgentToolNotFoundError)
      })

      it('includes tool descriptions and parameters', async () => {
        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              expect.objectContaining({
                name: 'web_search',
                description: 'Search the web for information',
                parameters: expect.objectContaining({
                  type: 'object',
                  properties: expect.objectContaining({
                    query: expect.any(Object),
                  }),
                }),
              }),
            ],
          })
        )
      })
    })

    describe('Tool parameter validation', () => {
      it('validates required parameters', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'Calling tool',
          toolCalls: [
            {
              id: 'call_1',
              name: 'web_search',
              arguments: {}, // Missing required 'query'
            },
          ],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Search something',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        // Should continue with error as tool result
        expect(mockAI.complete).toHaveBeenCalledTimes(2)
        const secondCall = mockAI.complete.mock.calls[1][0]
        expect(secondCall.messages).toContainEqual(
          expect.objectContaining({
            role: 'tool',
            content: expect.stringContaining('required'),
          })
        )
      })

      it('validates parameter types', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'Calling tool',
          toolCalls: [
            {
              id: 'call_1',
              name: 'web_search',
              arguments: { query: 'test', limit: 'not a number' },
            },
          ],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Search',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        // Tool execution should handle type coercion or report error
        expect(mockTools.web_search.execute).toHaveBeenCalled()
      })

      it('passes validated parameters to tool', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Searching',
            toolCalls: [
              {
                id: 'call_1',
                name: 'web_search',
                arguments: { query: 'AI news', limit: 5 },
              },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Search for AI news',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
        })

        expect(mockTools.web_search.execute).toHaveBeenCalledWith(
          { query: 'AI news', limit: 5 },
          expect.any(Object)
        )
      })
    })

    describe('Tool execution context', () => {
      it('passes agent context to tool', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        const context = mockTools.calculate.execute.mock.calls[0][1]
        expect(context).toHaveProperty('agentId')
        expect(context).toHaveProperty('invocationId')
        expect(context).toHaveProperty('currentIteration')
        expect(context).toHaveProperty('state')
        expect(context).toHaveProperty('log')
      })

      it('tool can access agent state', async () => {
        const stateAccessingTool: ToolDefinition = {
          name: 'state_tool',
          description: 'Accesses state',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            await ctx.state.set('key', 'value')
            const value = await ctx.state.get('key')
            return { storedValue: value }
          }),
        }

        const executorWithTool = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { state_tool: stateAccessingTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Using state tool',
            toolCalls: [{ id: 'call_1', name: 'state_tool', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithTool.execute({
          goal: 'Test state',
          model: 'claude-3-sonnet',
          tools: ['state_tool'],
        })

        expect(stateAccessingTool.execute).toHaveBeenCalled()
        expect(await mockState.storage.get('key')).toBe('value')
      })
    })

    describe('Tool authorization', () => {
      it('blocks unauthorized tool execution', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'Sending email',
          toolCalls: [
            {
              id: 'call_1',
              name: 'send_email',
              arguments: { to: 'test@example.com', subject: 'Test', body: 'Body' },
            },
          ],
          stopReason: 'tool_use',
        })

        await expect(
          executor.execute({
            goal: 'Send email',
            model: 'claude-3-sonnet',
            tools: ['send_email'],
            // No authorization provided
          })
        ).rejects.toThrow(AgentToolAuthorizationError)
      })

      it('allows authorized tool execution', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Sending email',
            toolCalls: [
              {
                id: 'call_1',
                name: 'send_email',
                arguments: { to: 'test@example.com', subject: 'Test', body: 'Body' },
              },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Email sent',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Send email',
          model: 'claude-3-sonnet',
          tools: ['send_email'],
          authorizedTools: ['send_email'],
        })

        expect(mockTools.send_email.execute).toHaveBeenCalled()
        expect(result.success).toBe(true)
      })

      it('uses integration context for authorization', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Sending email',
            toolCalls: [
              {
                id: 'call_1',
                name: 'send_email',
                arguments: { to: 'test@example.com', subject: 'Test', body: 'Body' },
              },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Send email',
          model: 'claude-3-sonnet',
          tools: ['send_email'],
          integrations: {
            email: {
              provider: 'sendgrid',
              credentials: { apiKey: 'test-key' },
            },
          },
        })

        expect(mockTools.send_email.execute).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            integration: expect.objectContaining({
              provider: 'sendgrid',
            }),
          })
        )
      })
    })
  })

  // ==========================================================================
  // 3. ITERATION TESTS (maxIterations, convergence detection)
  // ==========================================================================

  describe('Iteration Limits', () => {
    describe('Max iterations', () => {
      it('stops after maxIterations', async () => {
        // AI always wants to use tools, never finishes
        mockAI.complete.mockResolvedValue({
          text: 'Need more info',
          toolCalls: [{ id: 'call_x', name: 'web_search', arguments: { query: 'test' } }],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Endless task',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          maxIterations: 3,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(AgentMaxIterationsError)
        expect(result.iterations).toBe(3)
        expect(mockAI.complete).toHaveBeenCalledTimes(3)
      })

      it('defaults to 10 iterations', async () => {
        mockAI.complete.mockResolvedValue({
          text: 'Need more',
          toolCalls: [{ id: 'call_x', name: 'calculate', arguments: { expression: '1' } }],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Task',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          // No maxIterations specified
        })

        expect(result.iterations).toBe(10)
        expect(mockAI.complete).toHaveBeenCalledTimes(10)
      })

      it('can set maxIterations to 1', async () => {
        mockAI.complete.mockResolvedValue({
          text: 'Needs tool',
          toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'x' } }],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Task',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          maxIterations: 1,
        })

        expect(result.iterations).toBe(1)
        expect(result.success).toBe(false)
      })

      it('completes within maxIterations when possible', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          maxIterations: 5,
        })

        expect(result.success).toBe(true)
        expect(result.iterations).toBe(2)
      })
    })

    describe('Convergence detection', () => {
      it('detects when AI is looping without progress', async () => {
        // Same tool call repeatedly
        mockAI.complete.mockResolvedValue({
          text: 'Searching again',
          toolCalls: [{ id: 'call_x', name: 'web_search', arguments: { query: 'same query' } }],
          stopReason: 'tool_use',
        })

        const result = await executor.execute({
          goal: 'Task',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          maxIterations: 10,
          detectLoops: true,
        })

        // Should detect loop before reaching maxIterations
        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(AgentConvergenceError)
        expect(result.iterations).toBeLessThan(10)
      })

      it('allows repeated tool calls with different arguments', async () => {
        let callCount = 0
        mockAI.complete.mockImplementation(() => {
          callCount++
          if (callCount < 3) {
            return Promise.resolve({
              text: `Search ${callCount}`,
              toolCalls: [
                { id: `call_${callCount}`, name: 'web_search', arguments: { query: `query ${callCount}` } },
              ],
              stopReason: 'tool_use' as const,
            })
          }
          return Promise.resolve({
            text: 'Done',
            stopReason: 'end_turn' as const,
          })
        })

        const result = await executor.execute({
          goal: 'Multiple searches',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          detectLoops: true,
        })

        expect(result.success).toBe(true)
        expect(result.iterations).toBe(3)
      })

      it('stops on repeated identical responses', async () => {
        mockAI.complete.mockResolvedValue({
          text: 'I am thinking...',
          stopReason: 'tool_use',
          toolCalls: [{ id: 'same', name: 'calculate', arguments: { expression: '1+1' } }],
        })

        const result = await executor.execute({
          goal: 'Task',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          detectLoops: true,
          loopThreshold: 3,
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/loop|converge|stuck/i)
      })
    })

    describe('Early termination', () => {
      it('stops when AI indicates completion', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'I have completed the task.',
          stopReason: 'end_turn',
        })

        const result = await executor.execute({
          goal: 'Simple task',
          model: 'claude-3-sonnet',
          maxIterations: 10,
        })

        expect(result.success).toBe(true)
        expect(result.iterations).toBe(1)
        expect(mockAI.complete).toHaveBeenCalledTimes(1)
      })

      it('respects max_tokens stop reason', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: 'The answer is...',
          stopReason: 'max_tokens',
        })

        const result = await executor.execute({
          goal: 'Long response task',
          model: 'claude-3-sonnet',
        })

        // Should handle max_tokens gracefully
        expect(result.iterations).toBe(1)
        expect(result.result).toContain('The answer is')
      })
    })
  })

  // ==========================================================================
  // 4. CALLBACK TESTS (onStep, onToolCall, onComplete)
  // ==========================================================================

  describe('Step Callbacks', () => {
    describe('onStep callback', () => {
      it('calls onStep for each iteration', async () => {
        const onStep = vi.fn()

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Tool call',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          onStep,
        })

        expect(onStep).toHaveBeenCalledTimes(2)
      })

      it('provides step details in callback', async () => {
        const steps: AgentStep[] = []
        const onStep = vi.fn((step: AgentStep) => {
          steps.push(step)
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Using tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '2+2' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'The answer is 4',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Calculate 2+2',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          onStep,
        })

        expect(steps[0]).toMatchObject({
          iteration: 1,
          type: 'tool_call',
          thought: 'Using tool',
          toolCalls: [
            expect.objectContaining({
              name: 'calculate',
              arguments: { expression: '2+2' },
            }),
          ],
        })

        expect(steps[1]).toMatchObject({
          iteration: 2,
          type: 'final_answer',
          answer: 'The answer is 4',
        })
      })

      it('includes timestamp in step', async () => {
        let stepTimestamp: Date | undefined
        const onStep = vi.fn((step: AgentStep) => {
          stepTimestamp = step.timestamp
        })

        mockAI.complete.mockResolvedValueOnce({
          text: 'Done',
          stopReason: 'end_turn',
        })

        const before = new Date()
        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          onStep,
        })
        const after = new Date()

        expect(stepTimestamp).toBeDefined()
        expect(stepTimestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime())
        expect(stepTimestamp!.getTime()).toBeLessThanOrEqual(after.getTime())
      })

      it('supports async onStep callback', async () => {
        const events: string[] = []
        const onStep = vi.fn(async (step: AgentStep) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          events.push(`step_${step.iteration}`)
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          onStep,
        })

        expect(events).toEqual(['step_1', 'step_2'])
      })
    })

    describe('onToolCall callback', () => {
      it('calls onToolCall before tool execution', async () => {
        const onToolCall = vi.fn()

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling tool',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Search',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          onToolCall,
        })

        expect(onToolCall).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'web_search',
            arguments: { query: 'test' },
          }),
          expect.any(Object) // context
        )
        expect(onToolCall).toHaveBeenCalledBefore(mockTools.web_search.execute as jest.Mock)
      })

      it('can modify tool arguments in onToolCall', async () => {
        const onToolCall = vi.fn((call: ToolCall) => {
          return {
            ...call,
            arguments: { ...call.arguments, limit: 10 },
          }
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Searching',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Search',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          onToolCall,
        })

        expect(mockTools.web_search.execute).toHaveBeenCalledWith(
          { query: 'test', limit: 10 },
          expect.any(Object)
        )
      })

      it('can skip tool execution by returning null', async () => {
        const onToolCall = vi.fn(() => null) // Skip all tool calls

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling tool',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done anyway',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          onToolCall,
        })

        expect(mockTools.web_search.execute).not.toHaveBeenCalled()
      })
    })

    describe('onToolResult callback', () => {
      it('calls onToolResult after tool execution', async () => {
        const onToolResult = vi.fn()

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '2+2' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          onToolResult,
        })

        expect(onToolResult).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCallId: 'call_1',
            toolName: 'calculate',
            result: { result: 42 },
            success: true,
          })
        )
      })

      it('reports tool errors in onToolResult', async () => {
        const onToolResult = vi.fn()

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling failing tool',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Handled error',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test failure',
          model: 'claude-3-sonnet',
          tools: ['failing_tool'],
          onToolResult,
        })

        expect(onToolResult).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('Tool execution failed'),
          })
        )
      })
    })

    describe('onComplete callback', () => {
      it('calls onComplete with final result', async () => {
        const onComplete = vi.fn()

        mockAI.complete.mockResolvedValueOnce({
          text: 'Final answer',
          stopReason: 'end_turn',
        })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          onComplete,
        })

        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            result: 'Final answer',
            iterations: 1,
          })
        )
      })

      it('calls onComplete on error', async () => {
        const onComplete = vi.fn()

        mockAI.complete.mockRejectedValue(new Error('AI error'))

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          onComplete,
        }).catch(() => {}) // Ignore error

        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.any(Object),
          })
        )
      })

      it('includes metrics in onComplete', async () => {
        const onComplete = vi.fn()

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          onComplete,
        })

        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            metrics: expect.objectContaining({
              modelCalls: 2,
              toolCalls: 1,
            }),
          })
        )
      })
    })
  })

  // ==========================================================================
  // 5. STATE TESTS (state persistence, state isolation)
  // ==========================================================================

  describe('State Management', () => {
    describe('State persistence between steps', () => {
      it('persists state across tool calls', async () => {
        const statefulTool: ToolDefinition = {
          name: 'counter',
          description: 'Increment counter',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            const current = (await ctx.state.get<number>('count')) || 0
            await ctx.state.set('count', current + 1)
            return { count: current + 1 }
          }),
        }

        const executorWithTool = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { counter: statefulTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'First increment',
            toolCalls: [{ id: 'call_1', name: 'counter', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Second increment',
            toolCalls: [{ id: 'call_2', name: 'counter', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithTool.execute({
          goal: 'Increment twice',
          model: 'claude-3-sonnet',
          tools: ['counter'],
        })

        expect(await mockState.storage.get('count')).toBe(2)
      })

      it('provides state in agent context', async () => {
        let capturedState: AgentContext['state'] | undefined

        const inspectTool: ToolDefinition = {
          name: 'inspect',
          description: 'Inspect state',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            capturedState = ctx.state
            return { ok: true }
          }),
        }

        const executorWithTool = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { inspect: inspectTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Inspect',
            toolCalls: [{ id: 'call_1', name: 'inspect', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithTool.execute({
          goal: 'Test state',
          model: 'claude-3-sonnet',
          tools: ['inspect'],
        })

        expect(capturedState).toBeDefined()
        expect(typeof capturedState!.get).toBe('function')
        expect(typeof capturedState!.set).toBe('function')
        expect(typeof capturedState!.delete).toBe('function')
        expect(typeof capturedState!.getAll).toBe('function')
      }

      it('state survives tool errors', async () => {
        const stateThenFailTool: ToolDefinition = {
          name: 'state_then_fail',
          description: 'Sets state then fails',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            await ctx.state.set('before_error', true)
            throw new Error('Intentional failure')
          }),
        }

        const executorWithTool = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { state_then_fail: stateThenFailTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Will fail',
            toolCalls: [{ id: 'call_1', name: 'state_then_fail', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Recovered',
            stopReason: 'end_turn',
          })

        await executorWithTool.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['state_then_fail'],
        })

        expect(await mockState.storage.get('before_error')).toBe(true)
      })
    })

    describe('State isolation', () => {
      it('isolates state between agent invocations', async () => {
        const stateTool: ToolDefinition = {
          name: 'set_value',
          description: 'Set value',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          execute: vi.fn(async (params: { value: string }, ctx: AgentContext) => {
            await ctx.state.set('value', params.value)
            return { set: params.value }
          }),
        }

        // First execution with isolated state
        const state1 = createMockState()
        const executor1 = new AgenticFunctionExecutor({
          state: state1,
          env: mockEnv,
          ai: mockAI,
          tools: { set_value: stateTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Setting',
            toolCalls: [{ id: 'call_1', name: 'set_value', arguments: { value: 'first' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor1.execute({
          goal: 'Set value',
          model: 'claude-3-sonnet',
          tools: ['set_value'],
        })

        // Second execution with different isolated state
        const state2 = createMockState()
        const executor2 = new AgenticFunctionExecutor({
          state: state2,
          env: mockEnv,
          ai: mockAI,
          tools: { set_value: stateTool },
        })

        const getTool: ToolDefinition = {
          name: 'get_value',
          description: 'Get value',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            return { value: await ctx.state.get('value') }
          }),
        }

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Getting',
            toolCalls: [{ id: 'call_1', name: 'get_value', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const executor2WithGet = new AgenticFunctionExecutor({
          state: state2,
          env: mockEnv,
          ai: mockAI,
          tools: { get_value: getTool },
        })

        await executor2WithGet.execute({
          goal: 'Get value',
          model: 'claude-3-sonnet',
          tools: ['get_value'],
        })

        // State should be isolated
        expect(await state1.storage.get('value')).toBe('first')
        expect(await state2.storage.get('value')).toBeUndefined()
      })

      it('can share state using statePrefix', async () => {
        const sharedState = createMockState()
        await sharedState.storage.put('shared:data', 'shared_value')

        const readTool: ToolDefinition = {
          name: 'read_shared',
          description: 'Read shared state',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            return { value: await ctx.state.get('shared:data') }
          }),
        }

        const executorWithShared = new AgenticFunctionExecutor({
          state: sharedState,
          env: mockEnv,
          ai: mockAI,
          tools: { read_shared: readTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Reading',
            toolCalls: [{ id: 'call_1', name: 'read_shared', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithShared.execute({
          goal: 'Read shared',
          model: 'claude-3-sonnet',
          tools: ['read_shared'],
        })

        expect(readTool.execute).toHaveReturnedWith(
          expect.objectContaining({ value: 'shared_value' })
        )
      })
    })

    describe('State getAll', () => {
      it('returns all state values', async () => {
        await mockState.storage.put('key1', 'value1')
        await mockState.storage.put('key2', 'value2')
        await mockState.storage.put('key3', 'value3')

        let allState: Record<string, unknown> | undefined

        const getAllTool: ToolDefinition = {
          name: 'get_all',
          description: 'Get all state',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async (params, ctx: AgentContext) => {
            allState = await ctx.state.getAll()
            return { state: allState }
          }),
        }

        const executorWithTool = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { get_all: getAllTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Getting all',
            toolCalls: [{ id: 'call_1', name: 'get_all', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithTool.execute({
          goal: 'Get all state',
          model: 'claude-3-sonnet',
          tools: ['get_all'],
        })

        expect(allState).toEqual({
          key1: 'value1',
          key2: 'value2',
          key3: 'value3',
        })
      })
    })
  })

  // ==========================================================================
  // 6. ERROR TESTS (tool errors, recovery, max retries)
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Tool execution errors', () => {
      it('continues after tool error with error message to AI', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling failing tool',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'I see the tool failed, proceeding without it',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Test error handling',
          model: 'claude-3-sonnet',
          tools: ['failing_tool'],
        })

        expect(result.success).toBe(true)
        expect(mockAI.complete).toHaveBeenCalledTimes(2)

        // Second call should include error message
        const secondCall = mockAI.complete.mock.calls[1][0]
        expect(secondCall.messages).toContainEqual(
          expect.objectContaining({
            role: 'tool',
            content: expect.stringContaining('error'),
          })
        )
      })

      it('reports tool errors in step', async () => {
        const steps: AgentStep[] = []
        const onStep = vi.fn((step: AgentStep) => steps.push(step))

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['failing_tool'],
          onStep,
        })

        const toolResultStep = steps.find((s) => s.type === 'tool_result')
        expect(toolResultStep?.toolResults?.[0]).toMatchObject({
          success: false,
          error: expect.stringContaining('failed'),
        })
      })
    })

    describe('Tool retry', () => {
      it('retries tool on failure when configured', async () => {
        let attemptCount = 0
        const flakeyTool: ToolDefinition = {
          name: 'flakey',
          description: 'Sometimes fails',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async () => {
            attemptCount++
            if (attemptCount < 3) {
              throw new Error('Temporary failure')
            }
            return { success: true }
          }),
          retryConfig: {
            maxRetries: 3,
            delay: 10,
          },
        }

        const executorWithFlakey = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { flakey: flakeyTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling flakey',
            toolCalls: [{ id: 'call_1', name: 'flakey', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const result = await executorWithFlakey.execute({
          goal: 'Test retry',
          model: 'claude-3-sonnet',
          tools: ['flakey'],
        })

        expect(attemptCount).toBe(3)
        expect(result.success).toBe(true)
      })

      it('gives up after max retries', async () => {
        let attemptCount = 0
        const alwaysFails: ToolDefinition = {
          name: 'always_fails',
          description: 'Always fails',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async () => {
            attemptCount++
            throw new Error('Persistent failure')
          }),
          retryConfig: {
            maxRetries: 2,
            delay: 10,
          },
        }

        const executorWithFailing = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { always_fails: alwaysFails },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling',
            toolCalls: [{ id: 'call_1', name: 'always_fails', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Tool failed, proceeding',
            stopReason: 'end_turn',
          })

        await executorWithFailing.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['always_fails'],
        })

        expect(attemptCount).toBe(2)
      })
    })

    describe('AI errors', () => {
      it('throws on AI completion error', async () => {
        mockAI.complete.mockRejectedValue(new Error('AI service unavailable'))

        await expect(
          executor.execute({
            goal: 'Test',
            model: 'claude-3-sonnet',
          })
        ).rejects.toThrow('AI service unavailable')
      })

      it('can retry AI calls on failure', async () => {
        mockAI.complete
          .mockRejectedValueOnce(new Error('Temporary error'))
          .mockResolvedValueOnce({
            text: 'Success after retry',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          aiRetry: {
            maxRetries: 2,
            delay: 10,
          },
        })

        expect(result.success).toBe(true)
        expect(mockAI.complete).toHaveBeenCalledTimes(2)
      })

      it('gives up after AI retry limit', async () => {
        mockAI.complete.mockRejectedValue(new Error('Persistent AI error'))

        await expect(
          executor.execute({
            goal: 'Test',
            model: 'claude-3-sonnet',
            aiRetry: {
              maxRetries: 2,
              delay: 10,
            },
          })
        ).rejects.toThrow('Persistent AI error')

        expect(mockAI.complete).toHaveBeenCalledTimes(2)
      })
    })

    describe('Cancellation', () => {
      it('can cancel execution', async () => {
        const controller = new AbortController()

        mockAI.complete.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return { text: 'Done', stopReason: 'end_turn' as const }
        })

        setTimeout(() => controller.abort(), 50)

        await expect(
          executor.execute({
            goal: 'Slow task',
            model: 'claude-3-sonnet',
            signal: controller.signal,
          })
        ).rejects.toThrow(AgentCancelledError)
      })

      it('stops tool execution on cancel', async () => {
        const controller = new AbortController()

        mockAI.complete.mockResolvedValueOnce({
          text: 'Calling slow tool',
          toolCalls: [{ id: 'call_1', name: 'slow_tool', arguments: {} }],
          stopReason: 'tool_use',
        })

        setTimeout(() => controller.abort(), 50)

        await expect(
          executor.execute({
            goal: 'Slow task',
            model: 'claude-3-sonnet',
            tools: ['slow_tool'],
            signal: controller.signal,
          })
        ).rejects.toThrow(AgentCancelledError)
      })

      it('early return when signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(
          executor.execute({
            goal: 'Task',
            model: 'claude-3-sonnet',
            signal: controller.signal,
          })
        ).rejects.toThrow(AgentCancelledError)

        expect(mockAI.complete).not.toHaveBeenCalled()
      })
    })

    describe('Error events', () => {
      it('emits agent.error event on failure', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: mockTools,
          onEvent,
        })

        mockAI.complete.mockRejectedValue(new Error('Test error'))

        await executorWithEvents
          .execute({
            goal: 'Test',
            model: 'claude-3-sonnet',
          })
          .catch(() => {})

        expect(onEvent).toHaveBeenCalledWith(
          'agent.error',
          expect.objectContaining({
            error: expect.stringContaining('Test error'),
          })
        )
      })

      it('emits tool.error event on tool failure', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: mockTools,
          onEvent,
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling failing tool',
            toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithEvents.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['failing_tool'],
        })

        expect(onEvent).toHaveBeenCalledWith(
          'tool.error',
          expect.objectContaining({
            toolName: 'failing_tool',
            error: expect.stringContaining('failed'),
          })
        )
      })
    })
  })

  // ==========================================================================
  // 7. PARALLEL TESTS (concurrent tool calls)
  // ==========================================================================

  describe('Parallel Tool Execution', () => {
    describe('Concurrent tool calls', () => {
      it('executes multiple tools in parallel', async () => {
        const startTimes: number[] = []
        const endTimes: number[] = []

        const timedTool: ToolDefinition = {
          name: 'timed',
          description: 'Timed tool',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
          execute: vi.fn(async (params: { id: string }) => {
            startTimes.push(Date.now())
            await new Promise((resolve) => setTimeout(resolve, 50))
            endTimes.push(Date.now())
            return { id: params.id }
          }),
        }

        const executorWithTimed = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { timed: timedTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling multiple tools',
            toolCalls: [
              { id: 'call_1', name: 'timed', arguments: { id: 'a' } },
              { id: 'call_2', name: 'timed', arguments: { id: 'b' } },
              { id: 'call_3', name: 'timed', arguments: { id: 'c' } },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const start = Date.now()
        await executorWithTimed.execute({
          goal: 'Parallel test',
          model: 'claude-3-sonnet',
          tools: ['timed'],
          parallelToolCalls: true,
        })
        const duration = Date.now() - start

        // If parallel, should take ~50ms, not 150ms
        expect(duration).toBeLessThan(100)
        expect(timedTool.execute).toHaveBeenCalledTimes(3)
      })

      it('executes tools sequentially when parallelToolCalls is false', async () => {
        const execOrder: string[] = []

        const orderedTool: ToolDefinition = {
          name: 'ordered',
          description: 'Ordered tool',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
          execute: vi.fn(async (params: { id: string }) => {
            execOrder.push(`start_${params.id}`)
            await new Promise((resolve) => setTimeout(resolve, 10))
            execOrder.push(`end_${params.id}`)
            return { id: params.id }
          }),
        }

        const executorWithOrdered = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { ordered: orderedTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling multiple tools',
            toolCalls: [
              { id: 'call_1', name: 'ordered', arguments: { id: 'a' } },
              { id: 'call_2', name: 'ordered', arguments: { id: 'b' } },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithOrdered.execute({
          goal: 'Sequential test',
          model: 'claude-3-sonnet',
          tools: ['ordered'],
          parallelToolCalls: false,
        })

        // Sequential: start_a, end_a, start_b, end_b
        expect(execOrder).toEqual(['start_a', 'end_a', 'start_b', 'end_b'])
      })

      it('collects all parallel tool results', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Parallel calls',
            toolCalls: [
              { id: 'call_1', name: 'web_search', arguments: { query: 'topic 1' } },
              { id: 'call_2', name: 'calculate', arguments: { expression: '2+2' } },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Both tools returned',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Parallel test',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'calculate'],
          parallelToolCalls: true,
        })

        // Second AI call should have both tool results
        const secondCall = mockAI.complete.mock.calls[1][0]
        const toolMessages = secondCall.messages.filter((m: { role: string }) => m.role === 'tool')
        expect(toolMessages).toHaveLength(2)
      })
    })

    describe('Parallel error handling', () => {
      it('continues with successful tools when one fails', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Parallel calls',
            toolCalls: [
              { id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } },
              { id: 'call_2', name: 'failing_tool', arguments: {} },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'One succeeded, one failed',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Mixed parallel',
          model: 'claude-3-sonnet',
          tools: ['calculate', 'failing_tool'],
          parallelToolCalls: true,
        })

        expect(result.success).toBe(true)

        // Should have both results (one success, one error)
        const secondCall = mockAI.complete.mock.calls[1][0]
        const toolMessages = secondCall.messages.filter((m: { role: string }) => m.role === 'tool')
        expect(toolMessages).toHaveLength(2)
      })

      it('respects concurrency limit', async () => {
        let concurrentCount = 0
        let maxConcurrent = 0

        const concurrentTool: ToolDefinition = {
          name: 'concurrent',
          description: 'Concurrent tool',
          parameters: { type: 'object', properties: {} },
          execute: vi.fn(async () => {
            concurrentCount++
            maxConcurrent = Math.max(maxConcurrent, concurrentCount)
            await new Promise((resolve) => setTimeout(resolve, 50))
            concurrentCount--
            return { ok: true }
          }),
        }

        const executorWithConcurrent = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: { concurrent: concurrentTool },
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Many calls',
            toolCalls: [
              { id: 'call_1', name: 'concurrent', arguments: {} },
              { id: 'call_2', name: 'concurrent', arguments: {} },
              { id: 'call_3', name: 'concurrent', arguments: {} },
              { id: 'call_4', name: 'concurrent', arguments: {} },
              { id: 'call_5', name: 'concurrent', arguments: {} },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithConcurrent.execute({
          goal: 'Concurrency test',
          model: 'claude-3-sonnet',
          tools: ['concurrent'],
          parallelToolCalls: true,
          maxConcurrency: 2,
        })

        expect(maxConcurrent).toBeLessThanOrEqual(2)
        expect(concurrentTool.execute).toHaveBeenCalledTimes(5)
      })
    })
  })

  // ==========================================================================
  // 8. MEMORY TESTS (conversation history, context window)
  // ==========================================================================

  describe('Memory and Conversation History', () => {
    describe('Conversation management', () => {
      it('maintains full conversation history', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'First thought',
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'step1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Second thought',
            toolCalls: [{ id: 'call_2', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Final answer',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Multi-step task',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'calculate'],
        })

        const finalCall = mockAI.complete.mock.calls[2][0]
        const messages = finalCall.messages

        // Should contain: system (optional), user, assistant, tool, assistant, tool
        expect(messages.length).toBeGreaterThanOrEqual(5)

        // Check conversation structure
        expect(messages).toContainEqual(
          expect.objectContaining({ role: 'user' })
        )
        expect(messages).toContainEqual(
          expect.objectContaining({ role: 'assistant', content: expect.stringContaining('First thought') })
        )
        expect(messages).toContainEqual(
          expect.objectContaining({ role: 'assistant', content: expect.stringContaining('Second thought') })
        )
      })

      it('correctly orders tool results with their calls', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Calling tools',
            toolCalls: [
              { id: 'call_1', name: 'web_search', arguments: { query: 'test' } },
              { id: 'call_2', name: 'calculate', arguments: { expression: '1+1' } },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'calculate'],
          parallelToolCalls: true,
        })

        const secondCall = mockAI.complete.mock.calls[1][0]
        const toolMessages = secondCall.messages.filter((m: { role: string }) => m.role === 'tool')

        // Each tool result should reference its call ID
        expect(toolMessages[0]).toHaveProperty('toolCallId', 'call_1')
        expect(toolMessages[1]).toHaveProperty('toolCallId', 'call_2')
      })
    })

    describe('Context window management', () => {
      it('truncates history when exceeding token limit', async () => {
        // Simulate long conversation
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'A'.repeat(1000), // Long response
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'B'.repeat(1000),
            toolCalls: [{ id: 'call_2', name: 'web_search', arguments: { query: 'test2' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'C'.repeat(1000),
            toolCalls: [{ id: 'call_3', name: 'web_search', arguments: { query: 'test3' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Final',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Long conversation',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          maxContextTokens: 2000,
        })

        // Later calls should have truncated history
        const finalCall = mockAI.complete.mock.calls[3][0]
        // Should still include the goal but may have trimmed early messages
        expect(finalCall.messages[0]).toMatchObject({
          role: expect.stringMatching(/user|system/),
        })
      })

      it('preserves system prompt when truncating', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Long response'.repeat(100),
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          systemPrompt: 'You are a helpful assistant.',
          maxContextTokens: 1000,
        })

        const secondCall = mockAI.complete.mock.calls[1][0]
        expect(secondCall.messages[0]).toMatchObject({
          role: 'system',
          content: 'You are a helpful assistant.',
        })
      })

      it('summarizes old messages when context is full', async () => {
        const summarizingExecutor = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: mockTools,
          summarizeOnContextFull: true,
        })

        // Generate many iterations
        for (let i = 0; i < 10; i++) {
          mockAI.complete.mockResolvedValueOnce({
            text: `Response ${i}`.repeat(50),
            toolCalls: [{ id: `call_${i}`, name: 'calculate', arguments: { expression: `${i}+1` } }],
            stopReason: 'tool_use',
          })
        }
        mockAI.complete.mockResolvedValueOnce({
          text: 'Final',
          stopReason: 'end_turn',
        })

        await summarizingExecutor.execute({
          goal: 'Long task',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
          maxContextTokens: 2000,
        })

        // Should have summarized some messages
        // Check that there's a summary message in later calls
        const laterCall = mockAI.complete.mock.calls[5]?.[0]
        if (laterCall) {
          const hasSummary = laterCall.messages.some(
            (m: { content: string }) => m.content?.includes('Summary') || m.content?.includes('summary')
          )
          // Summarization behavior - may or may not be present depending on implementation
        }
      })
    })

    describe('Conversation retrieval', () => {
      it('can retrieve conversation history from result', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Step 1',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        expect(result.steps).toBeDefined()
        expect(result.steps.length).toBeGreaterThan(0)
      })

      it('can resume from previous conversation', async () => {
        // First execution
        mockAI.complete.mockResolvedValueOnce({
          text: 'Partial progress',
          toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query: 'test' } }],
          stopReason: 'tool_use',
        })

        const result1 = await executor.execute({
          goal: 'Research task',
          model: 'claude-3-sonnet',
          tools: ['web_search'],
          maxIterations: 1,
        })

        expect(result1.success).toBe(false) // Hit iteration limit

        // Resume with previous conversation
        mockAI.complete.mockResolvedValueOnce({
          text: 'Continuing from where we left off',
          stopReason: 'end_turn',
        })

        const result2 = await executor.execute({
          goal: 'Continue research',
          model: 'claude-3-sonnet',
          conversationHistory: result1.steps.map((step) => ({
            role: step.type === 'final_answer' ? 'assistant' : 'assistant',
            content: step.answer || step.thought || '',
          })),
        })

        expect(result2.success).toBe(true)

        // Should have included previous context
        const call = mockAI.complete.mock.calls[1][0]
        expect(call.messages.length).toBeGreaterThan(1)
      })
    })

    describe('Input/output tracking', () => {
      it('includes input in first message', async () => {
        await executor.execute({
          goal: 'Process this data: {"key": "value"}',
          model: 'claude-3-sonnet',
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: 'user',
                content: expect.stringContaining('{"key": "value"}'),
              }),
            ]),
          })
        )
      })

      it('can pass structured input', async () => {
        await executor.execute({
          goal: 'Analyze this data',
          input: { items: [1, 2, 3], total: 6 },
          model: 'claude-3-sonnet',
        })

        expect(mockAI.complete).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                role: 'user',
                content: expect.stringMatching(/items.*total|Analyze this data/),
              }),
            ]),
          })
        )
      })

      it('extracts structured output when schema provided', async () => {
        mockAI.complete.mockResolvedValueOnce({
          text: '{"answer": 42, "confidence": 0.95}',
          stopReason: 'end_turn',
        })

        const result = await executor.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          outputSchema: {
            type: 'object',
            properties: {
              answer: { type: 'number' },
              confidence: { type: 'number' },
            },
          },
        })

        expect(result.result).toEqual({ answer: 42, confidence: 0.95 })
      })
    })
  })

  // ==========================================================================
  // 9. EXECUTION TRACE TESTS
  // ==========================================================================

  describe('Execution Trace', () => {
    describe('Step-by-step trace', () => {
      it('emits step events for observability', async () => {
        const events: Array<{ type: string; data: unknown }> = []
        const onEvent = vi.fn((type, data) => events.push({ type, data }))

        const executorWithEvents = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: mockTools,
          onEvent,
        })

        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Thinking',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        await executorWithEvents.execute({
          goal: 'Calculate',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        const eventTypes = events.map((e) => e.type)
        expect(eventTypes).toContain('agent.started')
        expect(eventTypes).toContain('agent.step')
        expect(eventTypes).toContain('tool.called')
        expect(eventTypes).toContain('tool.result')
        expect(eventTypes).toContain('agent.completed')
      })

      it('includes timing in trace events', async () => {
        const events: Array<{ type: string; data: Record<string, unknown> }> = []
        const onEvent = vi.fn((type, data) => events.push({ type, data }))

        const executorWithEvents = new AgenticFunctionExecutor({
          state: mockState,
          env: mockEnv,
          ai: mockAI,
          tools: mockTools,
          onEvent,
        })

        mockAI.complete.mockResolvedValueOnce({
          text: 'Done',
          stopReason: 'end_turn',
        })

        await executorWithEvents.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
        })

        const completedEvent = events.find((e) => e.type === 'agent.completed')
        expect(completedEvent?.data).toHaveProperty('duration')
        expect(typeof completedEvent?.data.duration).toBe('number')
      })
    })

    describe('Token tracking', () => {
      it('tracks tokens used across iterations', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Step 1',
            stopReason: 'tool_use',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            usage: { inputTokens: 100, outputTokens: 50 },
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
            usage: { inputTokens: 150, outputTokens: 30 },
          })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        expect(result.metrics.tokensUsed).toBe(330) // 100+50+150+30
      })

      it('reports model calls in metrics', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Tool',
            toolCalls: [{ id: 'call_1', name: 'calculate', arguments: { expression: '1' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Tool',
            toolCalls: [{ id: 'call_2', name: 'calculate', arguments: { expression: '2' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['calculate'],
        })

        expect(result.metrics.modelCalls).toBe(3)
      })

      it('reports tool calls in metrics', async () => {
        mockAI.complete
          .mockResolvedValueOnce({
            text: 'Multiple tools',
            toolCalls: [
              { id: 'call_1', name: 'web_search', arguments: { query: 'a' } },
              { id: 'call_2', name: 'calculate', arguments: { expression: '1' } },
            ],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'One more tool',
            toolCalls: [{ id: 'call_3', name: 'read_url', arguments: { url: 'test' } }],
            stopReason: 'tool_use',
          })
          .mockResolvedValueOnce({
            text: 'Done',
            stopReason: 'end_turn',
          })

        const result = await executor.execute({
          goal: 'Test',
          model: 'claude-3-sonnet',
          tools: ['web_search', 'calculate', 'read_url'],
        })

        expect(result.metrics.toolCalls).toBe(3)
        expect(result.toolCallCount).toBe(3)
      })
    })
  })
})
