/**
 * ToolLoopAgent Tests
 *
 * RED TDD: These tests should FAIL because ToolLoopAgent doesn't exist yet.
 *
 * ToolLoopAgent is an AI agent that executes tool calls in a loop until
 * completion or max iterations. It provides:
 * 1. Agent initialization with tools
 * 2. Tool loop execution (think -> act -> observe cycle)
 * 3. Max iteration limits and timeouts
 * 4. Error handling and fallback strategies
 * 5. Context management across iterations
 *
 * This is distinct from AgenticFunctionExecutor - ToolLoopAgent is a
 * standalone agent class that can be used independently or integrated
 * with Durable Objects.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the module under test - will FAIL until implemented
import {
  ToolLoopAgent,
  type ToolLoopConfig,
  type ToolDefinition,
  type ToolLoopResult,
  type ToolLoopContext,
  type ToolCallResult,
  type FallbackStrategy,
  ToolLoopMaxIterationsError,
  ToolLoopTimeoutError,
  ToolLoopToolNotFoundError,
  ToolLoopExecutionError,
} from '../ai/tool-loop-agent'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockAI() {
  return {
    chat: vi.fn().mockResolvedValue({
      content: 'Task completed.',
      toolCalls: undefined,
    }),
  }
}

function createMockTools(): Record<string, ToolDefinition> {
  return {
    search: {
      name: 'search',
      description: 'Search for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      handler: vi.fn().mockResolvedValue({
        results: [{ title: 'Result 1', snippet: 'Content 1' }],
      }),
    },
    calculate: {
      name: 'calculate',
      description: 'Perform calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression' },
        },
        required: ['expression'],
      },
      handler: vi.fn().mockResolvedValue({ result: 42 }),
    },
    read_file: {
      name: 'read_file',
      description: 'Read file contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
      handler: vi.fn().mockResolvedValue({ content: 'file contents' }),
    },
    failing_tool: {
      name: 'failing_tool',
      description: 'A tool that always fails',
      parameters: { type: 'object', properties: {} },
      handler: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
    },
    slow_tool: {
      name: 'slow_tool',
      description: 'A tool that takes a long time',
      parameters: { type: 'object', properties: {} },
      handler: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return { result: 'slow' }
      }),
    },
  }
}

function createDefaultConfig(overrides: Partial<ToolLoopConfig> = {}): ToolLoopConfig {
  return {
    maxIterations: 10,
    model: 'claude-3-sonnet',
    systemPrompt: 'You are a helpful assistant.',
    ...overrides,
  }
}

// ============================================================================
// 1. AGENT INITIALIZATION TESTS
// ============================================================================

describe('ToolLoopAgent Initialization', () => {
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>

  beforeEach(() => {
    mockAI = createMockAI()
    mockTools = createMockTools()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Constructor', () => {
    it('creates agent with AI client and tools', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      expect(agent).toBeInstanceOf(ToolLoopAgent)
    })

    it('creates agent with minimal configuration', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: {},
        config: { model: 'claude-3-sonnet' },
      })

      expect(agent).toBeInstanceOf(ToolLoopAgent)
    })

    it('throws error when AI client is not provided', () => {
      expect(
        () =>
          new ToolLoopAgent({
            ai: undefined as any,
            tools: mockTools,
            config: createDefaultConfig(),
          })
      ).toThrow('AI client is required')
    })

    it('uses default maxIterations when not specified', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: { model: 'claude-3-sonnet' },
      })

      expect(agent.getConfig().maxIterations).toBe(10)
    })

    it('accepts custom maxIterations', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 5 }),
      })

      expect(agent.getConfig().maxIterations).toBe(5)
    })
  })

  describe('Tool Registration', () => {
    it('registers tools from constructor', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const tools = agent.getTools()
      expect(tools).toHaveLength(5)
      expect(tools.map((t) => t.name)).toContain('search')
      expect(tools.map((t) => t.name)).toContain('calculate')
    })

    it('allows registering tools after construction', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: {},
        config: createDefaultConfig(),
      })

      agent.registerTool({
        name: 'new_tool',
        description: 'A new tool',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(),
      })

      expect(agent.getTools()).toHaveLength(1)
      expect(agent.getTools()[0].name).toBe('new_tool')
    })

    it('replaces tool with same name on re-registration', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { search: mockTools.search },
        config: createDefaultConfig(),
      })

      const newHandler = vi.fn()
      agent.registerTool({
        name: 'search',
        description: 'Updated search tool',
        parameters: { type: 'object', properties: {} },
        handler: newHandler,
      })

      const tools = agent.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].description).toBe('Updated search tool')
    })

    it('allows unregistering tools', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      agent.unregisterTool('search')

      const tools = agent.getTools()
      expect(tools.map((t) => t.name)).not.toContain('search')
    })

    it('returns false when unregistering non-existent tool', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = agent.unregisterTool('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('Configuration', () => {
    it('returns current configuration', () => {
      const config = createDefaultConfig({
        maxIterations: 15,
        timeout: 30000,
      })
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config,
      })

      const currentConfig = agent.getConfig()
      expect(currentConfig.maxIterations).toBe(15)
      expect(currentConfig.timeout).toBe(30000)
    })

    it('allows updating configuration', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 10 }),
      })

      agent.updateConfig({ maxIterations: 20 })

      expect(agent.getConfig().maxIterations).toBe(20)
    })

    it('preserves unchanged config values on update', () => {
      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          maxIterations: 10,
          timeout: 30000,
          systemPrompt: 'Original prompt',
        }),
      })

      agent.updateConfig({ maxIterations: 20 })

      expect(agent.getConfig().timeout).toBe(30000)
      expect(agent.getConfig().systemPrompt).toBe('Original prompt')
    })
  })
})

// ============================================================================
// 2. TOOL LOOP EXECUTION TESTS
// ============================================================================

describe('ToolLoopAgent Tool Loop Execution', () => {
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>
  let agent: InstanceType<typeof ToolLoopAgent>

  beforeEach(() => {
    mockAI = createMockAI()
    mockTools = createMockTools()
    agent = new ToolLoopAgent({
      ai: mockAI,
      tools: mockTools,
      config: createDefaultConfig(),
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Execution', () => {
    it('executes goal and returns result', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'The answer is 42.',
        toolCalls: undefined,
      })

      const result = await agent.run('What is the meaning of life?')

      expect(result.success).toBe(true)
      expect(result.result).toBe('The answer is 42.')
    })

    it('passes goal as user message to AI', async () => {
      await agent.run('Calculate 2+2')

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Calculate 2+2',
            }),
          ]),
        })
      )
    })

    it('includes system prompt in messages', async () => {
      agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ systemPrompt: 'You are a math expert.' }),
      })

      await agent.run('Calculate 2+2')

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: 'You are a math expert.',
            }),
          ]),
        })
      )
    })

    it('provides available tools to AI', async () => {
      await agent.run('Search for something')

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'search' }),
            expect.objectContaining({ name: 'calculate' }),
          ]),
        })
      )
    })

    it('returns iterations count', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'Done',
        toolCalls: undefined,
      })

      const result = await agent.run('Simple task')

      expect(result.iterations).toBe(1)
    })
  })

  describe('Tool Loop Cycle', () => {
    it('executes tool when AI requests it', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Let me search for that.',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'AI trends' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Based on the search results, here is the answer.',
          toolCalls: undefined,
        })

      const result = await agent.run('What are the latest AI trends?')

      expect(mockTools.search.handler).toHaveBeenCalledWith(
        { query: 'AI trends' },
        expect.any(Object) // context
      )
      expect(result.success).toBe(true)
      expect(result.iterations).toBe(2)
    })

    it('passes tool results back to AI', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Searching...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'test' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Found the answer.',
          toolCalls: undefined,
        })

      await agent.run('Search for test')

      // Second call should include tool result
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('Result 1'),
        })
      )
    })

    it('executes multiple tools in sequence', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'First, search...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'data' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Now, calculate...',
          toolCalls: [
            { id: 'call_2', name: 'calculate', arguments: { expression: '2+2' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'The final answer is 4.',
          toolCalls: undefined,
        })

      const result = await agent.run('Search and calculate')

      expect(mockTools.search.handler).toHaveBeenCalledTimes(1)
      expect(mockTools.calculate.handler).toHaveBeenCalledTimes(1)
      expect(result.iterations).toBe(3)
    })

    it('handles multiple parallel tool calls', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Running multiple tools...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'topic' } },
            { id: 'call_2', name: 'calculate', arguments: { expression: '1+1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done with both.',
          toolCalls: undefined,
        })

      const result = await agent.run('Search and calculate at once')

      expect(mockTools.search.handler).toHaveBeenCalledTimes(1)
      expect(mockTools.calculate.handler).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
    })

    it('maintains conversation history across iterations', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Step 1',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'step1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Step 2',
          toolCalls: [
            { id: 'call_2', name: 'calculate', arguments: { expression: '1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Final answer',
          toolCalls: undefined,
        })

      await agent.run('Multi-step task')

      // Third call should have full conversation history
      const thirdCall = mockAI.chat.mock.calls[2][0]
      expect(thirdCall.messages.length).toBeGreaterThan(3)
    })
  })

  describe('Think-Act-Observe Cycle', () => {
    it('tracks thinking in result steps', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'I need to search for this information.',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'info' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Based on the search, the answer is...',
          toolCalls: undefined,
        })

      const result = await agent.run('Find info')

      expect(result.steps).toContainEqual(
        expect.objectContaining({
          type: 'thinking',
          content: expect.stringContaining('search'),
        })
      )
    })

    it('tracks tool actions in result steps', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Searching...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'test' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const result = await agent.run('Search')

      expect(result.steps).toContainEqual(
        expect.objectContaining({
          type: 'action',
          toolName: 'search',
          toolInput: { query: 'test' },
        })
      )
    })

    it('tracks observations in result steps', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Searching...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'test' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const result = await agent.run('Search')

      expect(result.steps).toContainEqual(
        expect.objectContaining({
          type: 'observation',
          toolName: 'search',
          toolResult: expect.objectContaining({
            results: expect.any(Array),
          }),
        })
      )
    })

    it('tracks final answer in result steps', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'The final answer is 42.',
        toolCalls: undefined,
      })

      const result = await agent.run('What is the answer?')

      expect(result.steps).toContainEqual(
        expect.objectContaining({
          type: 'answer',
          content: 'The final answer is 42.',
        })
      )
    })
  })
})

// ============================================================================
// 3. MAX ITERATION LIMITS AND TIMEOUTS TESTS
// ============================================================================

describe('ToolLoopAgent Iteration Limits and Timeouts', () => {
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>

  beforeEach(() => {
    mockAI = createMockAI()
    mockTools = createMockTools()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Max Iterations', () => {
    it('stops after maxIterations', async () => {
      // AI always wants more tools, never finishes
      mockAI.chat.mockResolvedValue({
        content: 'Need more info',
        toolCalls: [
          { id: 'call_x', name: 'search', arguments: { query: 'more' } },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 3 }),
      })

      const result = await agent.run('Endless task')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ToolLoopMaxIterationsError)
      expect(result.iterations).toBe(3)
    })

    it('completes within maxIterations when possible', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Tool 1',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '1+1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 5 }),
      })

      const result = await agent.run('Calculate')

      expect(result.success).toBe(true)
      expect(result.iterations).toBe(2)
      expect(result.iterations).toBeLessThan(5)
    })

    it('can set maxIterations to 1', async () => {
      mockAI.chat.mockResolvedValue({
        content: 'Need tool',
        toolCalls: [
          { id: 'call_1', name: 'search', arguments: { query: 'x' } },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 1 }),
      })

      const result = await agent.run('Task')

      expect(result.iterations).toBe(1)
      expect(result.success).toBe(false)
    })

    it('can override maxIterations per run', async () => {
      mockAI.chat.mockResolvedValue({
        content: 'Need tool',
        toolCalls: [
          { id: 'call_x', name: 'search', arguments: { query: 'x' } },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 10 }),
      })

      const result = await agent.run('Task', { maxIterations: 2 })

      expect(result.iterations).toBe(2)
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
    })

    it('provides partial result when hitting max iterations', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Partial progress...',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'test' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'More progress...',
          toolCalls: [
            { id: 'call_2', name: 'calculate', arguments: { expression: '1+1' } },
          ],
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ maxIterations: 2 }),
      })

      const result = await agent.run('Long task')

      expect(result.success).toBe(false)
      expect(result.partialResult).toBeDefined()
      expect(result.steps.length).toBeGreaterThan(0)
    })
  })

  describe('Timeout', () => {
    it('stops execution on timeout', async () => {
      mockAI.chat.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return { content: 'Slow response', toolCalls: undefined }
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ timeout: 50 }),
      })

      const result = await agent.run('Slow task')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ToolLoopTimeoutError)
    })

    it('can override timeout per run', async () => {
      mockAI.chat.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { content: 'Response', toolCalls: undefined }
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ timeout: 1000 }),
      })

      const result = await agent.run('Task', { timeout: 30 })

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ToolLoopTimeoutError)
    })

    it('timeout applies to entire execution, not per iteration', async () => {
      let callCount = 0
      mockAI.chat.mockImplementation(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 30))
        if (callCount < 5) {
          return {
            content: `Step ${callCount}`,
            toolCalls: [
              { id: `call_${callCount}`, name: 'calculate', arguments: { expression: '1' } },
            ],
          }
        }
        return { content: 'Done', toolCalls: undefined }
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ timeout: 100 }),
      })

      const result = await agent.run('Multi-step task')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ToolLoopTimeoutError)
      expect(callCount).toBeLessThan(5)
    })

    it('tool timeout stops individual tool execution', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'Using slow tool',
        toolCalls: [
          { id: 'call_1', name: 'slow_tool', arguments: {} },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ toolTimeout: 50 }),
      })

      const result = await agent.run('Use slow tool')

      // Tool should timeout, but agent should continue with error result
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('timeout'),
        })
      )
    })
  })

  describe('Cancellation', () => {
    it('can cancel execution with AbortController', async () => {
      const controller = new AbortController()

      mockAI.chat.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { content: 'Response', toolCalls: undefined }
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      setTimeout(() => controller.abort(), 30)

      const result = await agent.run('Task', { signal: controller.signal })

      expect(result.success).toBe(false)
      expect(result.cancelled).toBe(true)
    })

    it('early returns when signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Task', { signal: controller.signal })

      expect(result.success).toBe(false)
      expect(result.cancelled).toBe(true)
      expect(mockAI.chat).not.toHaveBeenCalled()
    })

    it('stops tool execution on cancellation', async () => {
      const controller = new AbortController()

      mockAI.chat.mockResolvedValueOnce({
        content: 'Using slow tool',
        toolCalls: [
          { id: 'call_1', name: 'slow_tool', arguments: {} },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      setTimeout(() => controller.abort(), 50)

      const result = await agent.run('Slow task', { signal: controller.signal })

      expect(result.cancelled).toBe(true)
    })
  })
})

// ============================================================================
// 4. ERROR HANDLING AND FALLBACK TESTS
// ============================================================================

describe('ToolLoopAgent Error Handling and Fallback', () => {
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>

  beforeEach(() => {
    mockAI = createMockAI()
    mockTools = createMockTools()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Tool Errors', () => {
    it('continues after tool error with error message to AI', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using failing tool',
          toolCalls: [
            { id: 'call_1', name: 'failing_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'I see the tool failed, proceeding without it.',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test error handling')

      expect(result.success).toBe(true)
      expect(mockAI.chat).toHaveBeenCalledTimes(2)

      // Second call should include error message
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('error'),
        })
      )
    })

    it('throws ToolLoopToolNotFoundError for unknown tool', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'Using unknown tool',
        toolCalls: [
          { id: 'call_1', name: 'nonexistent_tool', arguments: {} },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Use unknown tool')

      // Should continue with error message to AI, not throw
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('not found'),
        })
      )
    })

    it('tracks tool errors in steps', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using failing tool',
          toolCalls: [
            { id: 'call_1', name: 'failing_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test')

      const errorStep = result.steps.find(
        (s) => s.type === 'observation' && s.error
      )
      expect(errorStep).toBeDefined()
      expect(errorStep?.error).toContain('Tool execution failed')
    })
  })

  describe('Fallback Strategies', () => {
    it('uses retry fallback strategy', async () => {
      let callCount = 0
      const flakeyTool = {
        name: 'flakey',
        description: 'Sometimes fails',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => {
          callCount++
          if (callCount < 3) {
            throw new Error('Temporary failure')
          }
          return { success: true }
        }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using flakey tool',
          toolCalls: [
            { id: 'call_1', name: 'flakey', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { flakey: flakeyTool },
        config: createDefaultConfig({
          fallbackStrategy: {
            type: 'retry',
            maxRetries: 3,
            delayMs: 10,
          },
        }),
      })

      const result = await agent.run('Test retry')

      expect(callCount).toBe(3)
      expect(result.success).toBe(true)
    })

    it('uses skip fallback strategy', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using failing tool',
          toolCalls: [
            { id: 'call_1', name: 'failing_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Continuing without tool',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          fallbackStrategy: { type: 'skip' },
        }),
      })

      const result = await agent.run('Test skip')

      expect(result.success).toBe(true)
      // Tool error should be reported but not block execution
    })

    it('uses abort fallback strategy', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'Using failing tool',
        toolCalls: [
          { id: 'call_1', name: 'failing_tool', arguments: {} },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          fallbackStrategy: { type: 'abort' },
        }),
      })

      const result = await agent.run('Test abort')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(ToolLoopExecutionError)
    })

    it('uses custom fallback function', async () => {
      const customFallback = vi.fn().mockResolvedValue({
        type: 'substitute',
        result: { fallbackResult: true },
      })

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using failing tool',
          toolCalls: [
            { id: 'call_1', name: 'failing_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done with fallback',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          fallbackStrategy: { type: 'custom', handler: customFallback },
        }),
      })

      const result = await agent.run('Test custom fallback')

      expect(customFallback).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('can specify per-tool fallback strategy', async () => {
      const failingToolWithRetry = {
        ...mockTools.failing_tool,
        fallbackStrategy: {
          type: 'retry' as const,
          maxRetries: 2,
          delayMs: 5,
        },
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using failing tool',
          toolCalls: [
            { id: 'call_1', name: 'failing_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Handling failure',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { ...mockTools, failing_tool: failingToolWithRetry },
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test per-tool fallback')

      // Should have retried twice
      expect(mockTools.failing_tool.handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('AI Errors', () => {
    it('handles AI service errors', async () => {
      mockAI.chat.mockRejectedValue(new Error('AI service unavailable'))

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test AI error')

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('AI service unavailable')
    })

    it('retries AI calls on failure when configured', async () => {
      mockAI.chat
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          content: 'Success after retry',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          aiRetry: { maxRetries: 2, delayMs: 10 },
        }),
      })

      const result = await agent.run('Test AI retry')

      expect(result.success).toBe(true)
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
    })

    it('gives up after AI retry limit', async () => {
      mockAI.chat.mockRejectedValue(new Error('Persistent error'))

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          aiRetry: { maxRetries: 2, delayMs: 10 },
        }),
      })

      const result = await agent.run('Test AI retry limit')

      expect(result.success).toBe(false)
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
    })
  })

  describe('Loop Detection', () => {
    it('detects when agent is looping without progress', async () => {
      // Same tool call repeatedly
      mockAI.chat.mockResolvedValue({
        content: 'Searching again',
        toolCalls: [
          { id: 'call_x', name: 'search', arguments: { query: 'same query' } },
        ],
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          maxIterations: 10,
          detectLoops: true,
          loopThreshold: 3,
        }),
      })

      const result = await agent.run('Task')

      expect(result.success).toBe(false)
      expect(result.loopDetected).toBe(true)
      expect(result.iterations).toBeLessThan(10)
    })

    it('allows repeated tool calls with different arguments', async () => {
      let callCount = 0
      mockAI.chat.mockImplementation(() => {
        callCount++
        if (callCount < 3) {
          return Promise.resolve({
            content: `Search ${callCount}`,
            toolCalls: [
              { id: `call_${callCount}`, name: 'search', arguments: { query: `query ${callCount}` } },
            ],
          })
        }
        return Promise.resolve({
          content: 'Done',
          toolCalls: undefined,
        })
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ detectLoops: true }),
      })

      const result = await agent.run('Multiple searches')

      expect(result.success).toBe(true)
      expect(result.loopDetected).toBeFalsy()
    })
  })
})

// ============================================================================
// 5. CONTEXT MANAGEMENT TESTS
// ============================================================================

describe('ToolLoopAgent Context Management', () => {
  let mockAI: ReturnType<typeof createMockAI>
  let mockTools: ReturnType<typeof createMockTools>

  beforeEach(() => {
    mockAI = createMockAI()
    mockTools = createMockTools()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Tool Context', () => {
    it('passes context to tool handlers', async () => {
      const contextCapturingTool = {
        name: 'context_tool',
        description: 'Captures context',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn().mockResolvedValue({ captured: true }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using context tool',
          toolCalls: [
            { id: 'call_1', name: 'context_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { context_tool: contextCapturingTool },
        config: createDefaultConfig(),
      })

      await agent.run('Test context')

      const context = contextCapturingTool.handler.mock.calls[0][1]
      expect(context).toHaveProperty('agentId')
      expect(context).toHaveProperty('runId')
      expect(context).toHaveProperty('iteration')
      expect(context).toHaveProperty('goal')
    })

    it('provides state accessor in context', async () => {
      let capturedContext: ToolLoopContext | undefined

      const stateTool = {
        name: 'state_tool',
        description: 'Uses state',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async (params: unknown, ctx: ToolLoopContext) => {
          capturedContext = ctx
          await ctx.state.set('key', 'value')
          const value = await ctx.state.get('key')
          return { value }
        }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using state',
          toolCalls: [
            { id: 'call_1', name: 'state_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { state_tool: stateTool },
        config: createDefaultConfig(),
      })

      await agent.run('Test state')

      expect(capturedContext).toBeDefined()
      expect(typeof capturedContext!.state.get).toBe('function')
      expect(typeof capturedContext!.state.set).toBe('function')
    })

    it('state persists across tool calls', async () => {
      const values: (string | null)[] = []

      const stateTool = {
        name: 'state_tool',
        description: 'Uses state',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async (params: unknown, ctx: ToolLoopContext) => {
          const current = await ctx.state.get<number>('counter')
          const newValue = (current || 0) + 1
          await ctx.state.set('counter', newValue)
          values.push(`counter=${newValue}`)
          return { counter: newValue }
        }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'First call',
          toolCalls: [
            { id: 'call_1', name: 'state_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Second call',
          toolCalls: [
            { id: 'call_2', name: 'state_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { state_tool: stateTool },
        config: createDefaultConfig(),
      })

      await agent.run('Test state persistence')

      expect(values).toEqual(['counter=1', 'counter=2'])
    })
  })

  describe('Run Context', () => {
    it('passes custom context to run', async () => {
      let receivedContext: ToolLoopContext | undefined

      const contextTool = {
        name: 'context_tool',
        description: 'Reads context',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async (params: unknown, ctx: ToolLoopContext) => {
          receivedContext = ctx
          return { customValue: ctx.custom?.myValue }
        }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using context',
          toolCalls: [
            { id: 'call_1', name: 'context_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { context_tool: contextTool },
        config: createDefaultConfig(),
      })

      await agent.run('Test', {
        context: { myValue: 'test-value' },
      })

      expect(receivedContext?.custom?.myValue).toBe('test-value')
    })

    it('provides logger in context', async () => {
      const logMessages: string[] = []

      const loggingTool = {
        name: 'logging_tool',
        description: 'Uses logger',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async (params: unknown, ctx: ToolLoopContext) => {
          ctx.log.info('Tool executing')
          ctx.log.debug('Debug message')
          return { logged: true }
        }),
      }

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Using logger',
          toolCalls: [
            { id: 'call_1', name: 'logging_tool', arguments: {} },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: { logging_tool: loggingTool },
        config: createDefaultConfig({
          logger: {
            info: (msg: string) => logMessages.push(`INFO: ${msg}`),
            debug: (msg: string) => logMessages.push(`DEBUG: ${msg}`),
            warn: (msg: string) => logMessages.push(`WARN: ${msg}`),
            error: (msg: string) => logMessages.push(`ERROR: ${msg}`),
          },
        }),
      })

      await agent.run('Test logging')

      expect(logMessages).toContain('INFO: Tool executing')
    })
  })

  describe('Conversation History Management', () => {
    it('can limit conversation history length', async () => {
      // Generate many iterations
      const responses = []
      for (let i = 0; i < 10; i++) {
        responses.push({
          content: `Step ${i} with lots of content`.repeat(100),
          toolCalls: [
            { id: `call_${i}`, name: 'calculate', arguments: { expression: `${i}+1` } },
          ],
        })
      }
      responses.push({ content: 'Final', toolCalls: undefined })

      mockAI.chat
        .mockImplementation(() => Promise.resolve(responses.shift()!))

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          maxContextMessages: 10,
        }),
      })

      await agent.run('Long task')

      // Later calls should have truncated history
      const lastCall = mockAI.chat.mock.calls[mockAI.chat.mock.calls.length - 1][0]
      expect(lastCall.messages.length).toBeLessThanOrEqual(10)
    })

    it('preserves system prompt when truncating', async () => {
      const responses = []
      for (let i = 0; i < 5; i++) {
        responses.push({
          content: `Step ${i}`.repeat(50),
          toolCalls: [
            { id: `call_${i}`, name: 'calculate', arguments: { expression: '1' } },
          ],
        })
      }
      responses.push({ content: 'Done', toolCalls: undefined })

      mockAI.chat
        .mockImplementation(() => Promise.resolve(responses.shift()!))

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({
          systemPrompt: 'Important system prompt',
          maxContextMessages: 5,
        }),
      })

      await agent.run('Task')

      const lastCall = mockAI.chat.mock.calls[mockAI.chat.mock.calls.length - 1][0]
      expect(lastCall.messages[0]).toMatchObject({
        role: 'system',
        content: 'Important system prompt',
      })
    })

    it('can resume from previous conversation', async () => {
      mockAI.chat.mockResolvedValueOnce({
        content: 'Continuing from previous context',
        toolCalls: undefined,
      })

      const previousHistory = [
        { role: 'user' as const, content: 'First message' },
        { role: 'assistant' as const, content: 'First response' },
        { role: 'user' as const, content: 'Second message' },
      ]

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      await agent.run('Continue', {
        conversationHistory: previousHistory,
      })

      const call = mockAI.chat.mock.calls[0][0]
      expect(call.messages).toContainEqual(
        expect.objectContaining({ role: 'user', content: 'First message' })
      )
      expect(call.messages).toContainEqual(
        expect.objectContaining({ role: 'assistant', content: 'First response' })
      )
    })
  })

  describe('Callbacks', () => {
    it('calls onStep callback for each iteration', async () => {
      const onStep = vi.fn()

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Tool call',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ onStep }),
      })

      await agent.run('Test callbacks')

      expect(onStep).toHaveBeenCalled()
      expect(onStep.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('calls onToolCall before tool execution', async () => {
      const callOrder: string[] = []
      const onToolCall = vi.fn(() => callOrder.push('onToolCall'))
      const originalHandler = mockTools.calculate.handler
      mockTools.calculate.handler = vi.fn(async (...args) => {
        callOrder.push('toolHandler')
        return originalHandler(...args)
      })

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Calculating',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ onToolCall }),
      })

      await agent.run('Test')

      expect(callOrder).toEqual(['onToolCall', 'toolHandler'])
    })

    it('calls onToolResult after tool execution', async () => {
      const onToolResult = vi.fn()

      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Calculating',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '2+2' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ onToolResult }),
      })

      await agent.run('Test')

      expect(onToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'calculate',
          result: { result: 42 },
          success: true,
        })
      )
    })

    it('calls onComplete when execution finishes', async () => {
      const onComplete = vi.fn()

      mockAI.chat.mockResolvedValueOnce({
        content: 'Done',
        toolCalls: undefined,
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ onComplete }),
      })

      await agent.run('Test')

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          result: 'Done',
        })
      )
    })

    it('calls onComplete even on error', async () => {
      const onComplete = vi.fn()

      mockAI.chat.mockRejectedValue(new Error('AI error'))

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig({ onComplete }),
      })

      await agent.run('Test')

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      )
    })
  })

  describe('Metrics', () => {
    it('tracks total duration', async () => {
      mockAI.chat.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { content: 'Done', toolCalls: undefined }
      })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test')

      expect(result.metrics.totalDuration).toBeGreaterThanOrEqual(50)
    })

    it('tracks tool call count', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Multiple tools',
          toolCalls: [
            { id: 'call_1', name: 'search', arguments: { query: 'a' } },
            { id: 'call_2', name: 'calculate', arguments: { expression: '1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'One more',
          toolCalls: [
            { id: 'call_3', name: 'read_file', arguments: { path: 'test' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test')

      expect(result.metrics.toolCalls).toBe(3)
    })

    it('tracks AI call count', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Step 1',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '1' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Step 2',
          toolCalls: [
            { id: 'call_2', name: 'calculate', arguments: { expression: '2' } },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test')

      expect(result.metrics.aiCalls).toBe(3)
    })

    it('tracks token usage when available', async () => {
      mockAI.chat
        .mockResolvedValueOnce({
          content: 'Step 1',
          toolCalls: [
            { id: 'call_1', name: 'calculate', arguments: { expression: '1' } },
          ],
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: undefined,
          usage: { inputTokens: 150, outputTokens: 30 },
        })

      const agent = new ToolLoopAgent({
        ai: mockAI,
        tools: mockTools,
        config: createDefaultConfig(),
      })

      const result = await agent.run('Test')

      expect(result.metrics.totalTokens).toBe(330) // 100+50+150+30
      expect(result.metrics.inputTokens).toBe(250)
      expect(result.metrics.outputTokens).toBe(80)
    })
  })
})

// ============================================================================
// TYPE EXPORTS TESTS
// ============================================================================

describe('ToolLoopAgent Type Exports', () => {
  it('exports ToolLoopConfig type', () => {
    const config: ToolLoopConfig = {
      model: 'claude-3-sonnet',
      maxIterations: 10,
    }
    expect(config.model).toBe('claude-3-sonnet')
  })

  it('exports ToolDefinition type', () => {
    const tool: ToolDefinition = {
      name: 'test',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({}),
    }
    expect(tool.name).toBe('test')
  })

  it('exports ToolLoopResult type', () => {
    const result: ToolLoopResult = {
      success: true,
      result: 'Done',
      iterations: 1,
      steps: [],
      metrics: {
        totalDuration: 100,
        aiCalls: 1,
        toolCalls: 0,
      },
    }
    expect(result.success).toBe(true)
  })

  it('exports ToolLoopContext type', () => {
    const context: ToolLoopContext = {
      agentId: 'agent-1',
      runId: 'run-1',
      iteration: 1,
      goal: 'Test goal',
      state: {
        get: async () => null,
        set: async () => {},
        delete: async () => true,
        getAll: async () => ({}),
      },
      log: {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
    }
    expect(context.agentId).toBe('agent-1')
  })

  it('exports FallbackStrategy type', () => {
    const strategy: FallbackStrategy = { type: 'retry', maxRetries: 3, delayMs: 100 }
    expect(strategy.type).toBe('retry')
  })

  it('exports error classes', () => {
    const maxIterError = new ToolLoopMaxIterationsError('Max iterations reached')
    expect(maxIterError).toBeInstanceOf(Error)
    expect(maxIterError.name).toBe('ToolLoopMaxIterationsError')

    const timeoutError = new ToolLoopTimeoutError('Timeout')
    expect(timeoutError).toBeInstanceOf(Error)

    const notFoundError = new ToolLoopToolNotFoundError('Tool not found')
    expect(notFoundError).toBeInstanceOf(Error)

    const execError = new ToolLoopExecutionError('Execution failed')
    expect(execError).toBeInstanceOf(Error)
  })
})
