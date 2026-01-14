/**
 * Agent.ts Unit Tests (RED Phase)
 *
 * Tests for:
 * - Stop Conditions (stepCountIs, hasToolCall, hasText, customStop, shouldStop)
 * - BaseAgent.run() - Tool loop execution
 * - BaseAgent hooks - onPreToolUse, onPostToolUse, onStepFinish
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  BaseAgent,
  stepCountIs,
  hasToolCall,
  hasText,
  customStop,
} from './Agent'
import type {
  AgentConfig,
  AgentProvider,
  Message,
  StepResult,
  ToolDefinition,
  ToolCall,
  ToolResult,
  StopCondition,
  StepState,
  AgentHooks,
  ToolCallDecision,
} from './types'
import { tool } from './Tool'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock generate function that can be configured to return different responses
 */
function createMockGenerate() {
  const responses: StepResult[] = []
  let callIndex = 0

  const generate = vi.fn(async (_messages: Message[], _config: AgentConfig): Promise<StepResult> => {
    if (callIndex >= responses.length) {
      // Default: return text with stop
      return {
        text: 'Default response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }
    }
    return responses[callIndex++]
  })

  return {
    generate,
    addResponse: (response: StepResult) => responses.push(response),
    setResponses: (newResponses: StepResult[]) => {
      responses.length = 0
      responses.push(...newResponses)
      callIndex = 0
    },
    reset: () => {
      callIndex = 0
      responses.length = 0
      generate.mockClear()
    },
  }
}

/**
 * Creates a simple tool definition for testing
 */
function createTestTool(name: string, executeFn?: (input: unknown) => Promise<unknown>): ToolDefinition {
  return tool({
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({ value: z.string().optional() }),
    execute: executeFn ?? (async (input) => ({ result: `executed ${name}`, input })),
  })
}

/**
 * Creates a mock provider
 */
function createMockProvider(): AgentProvider {
  return {
    name: 'mock',
    version: '1.0.0',
    createAgent: vi.fn(),
  }
}

/**
 * Creates a base agent config
 */
function createTestConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    model: 'test-model',
    ...overrides,
  }
}

// ============================================================================
// Stop Condition Helper Tests
// ============================================================================

describe('Stop Condition Helpers', () => {
  describe('stepCountIs()', () => {
    it('returns StopCondition with type "stepCount"', () => {
      const condition = stepCountIs(5)

      expect(condition.type).toBe('stepCount')
    })

    it('returns StopCondition with the specified count', () => {
      const condition = stepCountIs(10)

      expect(condition).toEqual({ type: 'stepCount', count: 10 })
    })

    it('works with count of 1', () => {
      const condition = stepCountIs(1)

      expect(condition).toEqual({ type: 'stepCount', count: 1 })
    })

    it('works with large count', () => {
      const condition = stepCountIs(1000)

      expect(condition).toEqual({ type: 'stepCount', count: 1000 })
    })
  })

  describe('hasToolCall()', () => {
    it('returns StopCondition with type "hasToolCall"', () => {
      const condition = hasToolCall('finish')

      expect(condition.type).toBe('hasToolCall')
    })

    it('returns StopCondition with the specified toolName', () => {
      const condition = hasToolCall('myTool')

      expect(condition).toEqual({ type: 'hasToolCall', toolName: 'myTool' })
    })

    it('handles special characters in tool names', () => {
      const condition = hasToolCall('my-tool_v2')

      expect(condition).toEqual({ type: 'hasToolCall', toolName: 'my-tool_v2' })
    })
  })

  describe('hasText()', () => {
    it('returns StopCondition with type "hasText"', () => {
      const condition = hasText()

      expect(condition.type).toBe('hasText')
    })

    it('returns correct structure', () => {
      const condition = hasText()

      expect(condition).toEqual({ type: 'hasText' })
    })
  })

  describe('customStop()', () => {
    it('returns StopCondition with type "custom"', () => {
      const checkFn = vi.fn(() => false)
      const condition = customStop(checkFn)

      expect(condition.type).toBe('custom')
    })

    it('returns StopCondition with the check function', () => {
      const checkFn = (_state: StepState) => true
      const condition = customStop(checkFn)

      expect(condition).toEqual({ type: 'custom', check: checkFn })
    })

    it('check function receives StepState', () => {
      const checkFn = vi.fn(() => false)
      const condition = customStop(checkFn)

      const state: StepState = {
        stepNumber: 3,
        messages: [],
        lastStep: { finishReason: 'stop' },
        totalTokens: 100,
      }

      // When the condition is evaluated
      if (condition.type === 'custom') {
        condition.check(state)
      }

      expect(checkFn).toHaveBeenCalledWith(state)
    })
  })

  describe('shouldStop() evaluation (via BaseAgent)', () => {
    // We test shouldStop indirectly through BaseAgent since it's not exported
    // These tests verify the OR logic and condition evaluation

    it('stops when stepCount condition is met', async () => {
      const mockGen = createMockGenerate()
      // Make it try to loop by returning tool calls, but we want it to stop at step 2
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'After step 2',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: stepCountIs(1) }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test' })

      // Should stop after step 1 (before tool execution loop continues)
      expect(result.steps).toBe(1)
    })

    it('stops when hasToolCall condition is met', async () => {
      const mockGen = createMockGenerate()
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'finish', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const finishTool = createTestTool('finish')

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: hasToolCall('finish') }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [finishTool] })

      expect(result.toolCalls.some((tc) => tc.name === 'finish')).toBe(true)
    })

    it('stops when hasText condition is met', async () => {
      const mockGen = createMockGenerate()
      mockGen.setResponses([
        {
          text: 'Hello world',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: hasText() }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test' })

      expect(result.text).toBe('Hello world')
      expect(result.steps).toBe(1)
    })

    it('stops when custom condition returns true', async () => {
      const mockGen = createMockGenerate()
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        },
      ])

      const customCondition = customStop((state) => state.totalTokens >= 100)

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: customCondition }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({
        prompt: 'Test',
        tools: [createTestTool('test')],
      })

      // Should stop after first step due to token count
      expect(result.usage.totalTokens).toBeGreaterThanOrEqual(100)
    })

    it('uses OR logic with array of conditions (any match stops)', async () => {
      const mockGen = createMockGenerate()
      mockGen.setResponses([
        {
          text: 'Response text',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const conditions: StopCondition[] = [
        stepCountIs(10), // Not met (step 1)
        hasText(),       // Met - has text
        hasToolCall('nonexistent'), // Not met
      ]

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: conditions }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test' })

      // Should stop because hasText() is true (OR logic)
      expect(result.text).toBe('Response text')
      expect(result.steps).toBe(1)
    })

    it('continues when no condition in array is met', async () => {
      const mockGen = createMockGenerate()
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'someOtherTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Final answer',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const conditions: StopCondition[] = [
        hasToolCall('finish'), // Not met
        customStop((state) => state.stepNumber >= 5), // Not met yet
      ]

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: conditions }),
        provider: createMockProvider(),
        generate: mockGen.generate,
      })

      const result = await agent.run({
        prompt: 'Test',
        tools: [createTestTool('someOtherTool')],
      })

      // Should continue to step 2 (text response stops it)
      expect(result.steps).toBe(2)
    })
  })
})

// ============================================================================
// BaseAgent.run() Tests
// ============================================================================

describe('BaseAgent.run()', () => {
  let mockGen: ReturnType<typeof createMockGenerate>
  let mockProvider: AgentProvider

  beforeEach(() => {
    mockGen = createMockGenerate()
    mockProvider = createMockProvider()
  })

  describe('Basic execution', () => {
    it('returns text when no tools are called', async () => {
      mockGen.setResponses([
        {
          text: 'Hello, I am the agent',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Hello' })

      expect(result.text).toBe('Hello, I am the agent')
      expect(result.toolCalls).toHaveLength(0)
      expect(result.toolResults).toHaveLength(0)
      expect(result.finishReason).toBe('stop')
    })

    it('builds initial messages with system instructions', async () => {
      mockGen.setResponses([
        {
          text: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig({ instructions: 'You are helpful.' }),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Hello' })

      expect(mockGen.generate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'You are helpful.' }),
          expect.objectContaining({ role: 'user', content: 'Hello' }),
        ]),
        expect.anything()
      )
    })

    it('accepts messages array instead of prompt', async () => {
      mockGen.setResponses([
        {
          text: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const messages: Message[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ]

      await agent.run({ messages })

      expect(mockGen.generate).toHaveBeenCalledWith(
        expect.arrayContaining(messages),
        expect.anything()
      )
    })
  })

  describe('Tool loop execution', () => {
    it('loops when tool calls are returned', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'testTool', arguments: { value: 'a' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc2', name: 'testTool', arguments: { value: 'b' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 15, completionTokens: 5, totalTokens: 20 },
        },
        {
          text: 'Final answer',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const testTool = createTestTool('testTool')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(result.steps).toBe(3)
      expect(result.toolCalls).toHaveLength(2)
      expect(result.text).toBe('Final answer')
    })

    it('executes tools and adds results to messages', async () => {
      const executeFn = vi.fn().mockResolvedValue({ computed: 42 })
      const testTool = createTestTool('calculator', executeFn)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { value: '5' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'The result is 42',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Calculate', tools: [testTool] })

      expect(executeFn).toHaveBeenCalledWith({ value: '5' }, expect.any(Object))
      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].result).toEqual({ computed: 42 })

      // Check that tool result was added to messages for next generate call
      const secondCall = mockGen.generate.mock.calls[1]
      const messagesInSecondCall = secondCall[0]
      expect(messagesInSecondCall.some((m: Message) => m.role === 'tool')).toBe(true)
    })

    it('handles multiple tool calls in single step', async () => {
      const tool1 = createTestTool('tool1')
      const tool2 = createTestTool('tool2')

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [
            { id: 'tc1', name: 'tool1', arguments: {} },
            { id: 'tc2', name: 'tool2', arguments: {} },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done with both',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [tool1, tool2] })

      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolResults).toHaveLength(2)
    })
  })

  describe('Stopping behavior', () => {
    it('stops at maxSteps', async () => {
      // Keep returning tool calls to force looping
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'loop', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc2', name: 'loop', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc3', name: 'loop', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Should not reach this',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loopTool = createTestTool('loop')

      const agent = new BaseAgent({
        config: createTestConfig({ maxSteps: 3 }),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [loopTool] })

      // With maxSteps: 3 and default stopWhen: stepCountIs(maxSteps)
      expect(result.steps).toBeLessThanOrEqual(3)
    })

    it('stops when stopWhen condition met', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'finish', arguments: { summary: 'done' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const finishTool = createTestTool('finish')

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: hasToolCall('finish') }),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [finishTool] })

      expect(result.toolCalls.some((tc) => tc.name === 'finish')).toBe(true)
      expect(result.steps).toBe(1)
    })

    it('input stopWhen overrides config stopWhen', async () => {
      mockGen.setResponses([
        {
          text: 'Quick response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig({ stopWhen: stepCountIs(10) }),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      // Override with hasText which should stop immediately
      const result = await agent.run({ prompt: 'Test', stopWhen: hasText() })

      expect(result.steps).toBe(1)
    })
  })

  describe('Error handling', () => {
    it('handles tool execution errors gracefully', async () => {
      const errorTool = tool({
        name: 'errorTool',
        description: 'Tool that throws',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Tool execution failed!')
        },
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'errorTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Handled the error',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [errorTool] })

      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].error).toBe('Tool execution failed!')
      expect(result.toolResults[0].result).toBeNull()
    })

    it('handles unknown tool gracefully', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'nonexistent', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Recovered from unknown tool',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [] })

      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].error).toContain('Unknown tool')
      expect(result.toolResults[0].error).toContain('nonexistent')
    })

    it('handles validation errors in tool arguments', async () => {
      const strictTool = tool({
        name: 'strictTool',
        description: 'Requires specific input',
        inputSchema: z.object({
          required: z.string(),
          count: z.number(),
        }),
        execute: async (input) => input,
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'strictTool', arguments: { required: 123 } }], // Wrong type
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Handled validation error',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [strictTool] })

      expect(result.toolResults[0].error).toBeTruthy()
    })
  })

  describe('Abort signal', () => {
    it('respects abort signal', async () => {
      const controller = new AbortController()

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'slowTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Should not reach this',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const slowTool = tool({
        name: 'slowTool',
        description: 'Slow tool',
        inputSchema: z.object({}),
        execute: async () => {
          // Abort during tool execution
          controller.abort()
          return 'done'
        },
      })

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({
        prompt: 'Test',
        tools: [slowTool],
        signal: controller.signal,
      })

      expect(result.finishReason).toBe('cancelled')
    })

    it('passes abort signal to tool context', async () => {
      const controller = new AbortController()
      const receivedSignal = vi.fn()

      const signalTool = tool({
        name: 'signalTool',
        description: 'Checks signal',
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          receivedSignal(context.abortSignal)
          return 'done'
        },
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'signalTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      await agent.run({
        prompt: 'Test',
        tools: [signalTool],
        signal: controller.signal,
      })

      expect(receivedSignal).toHaveBeenCalledWith(controller.signal)
    })
  })

  describe('Usage accumulation', () => {
    it('accumulates usage across steps', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc2', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        },
        {
          text: 'Final',
          finishReason: 'stop',
          usage: { promptTokens: 300, completionTokens: 150, totalTokens: 450 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(result.usage.promptTokens).toBe(600) // 100 + 200 + 300
      expect(result.usage.completionTokens).toBe(300) // 50 + 100 + 150
      expect(result.usage.totalTokens).toBe(900) // 150 + 300 + 450
    })

    it('handles steps without usage data', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          // No usage field
        },
        {
          text: 'Final',
          finishReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [testTool] })

      // Should still work, accumulating only the usage that was provided
      expect(result.usage.promptTokens).toBe(50)
      expect(result.usage.completionTokens).toBe(25)
      expect(result.usage.totalTokens).toBe(75)
    })
  })
})

// ============================================================================
// BaseAgent Hooks Tests
// ============================================================================

describe('BaseAgent Hooks', () => {
  let mockGen: ReturnType<typeof createMockGenerate>
  let mockProvider: AgentProvider

  beforeEach(() => {
    mockGen = createMockGenerate()
    mockProvider = createMockProvider()
  })

  describe('onPreToolUse', () => {
    it('is called before each tool execution', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({ action: 'allow' })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [
            { id: 'tc1', name: 'tool1', arguments: { value: 'a' } },
            { id: 'tc2', name: 'tool2', arguments: { value: 'b' } },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const tool1 = createTestTool('tool1')
      const tool2 = createTestTool('tool2')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPreToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [tool1, tool2] })

      expect(onPreToolUse).toHaveBeenCalledTimes(2)
      expect(onPreToolUse).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc1', name: 'tool1' })
      )
      expect(onPreToolUse).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc2', name: 'tool2' })
      )
    })

    it('can deny tool call', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({
        action: 'deny',
        reason: 'Not allowed in test mode',
      })

      const toolExecute = vi.fn().mockResolvedValue('executed')
      const deniedTool = tool({
        name: 'deniedTool',
        description: 'Will be denied',
        inputSchema: z.object({}),
        execute: toolExecute,
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'deniedTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Handled denial',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPreToolUse },
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [deniedTool] })

      // Tool execute should NOT have been called
      expect(toolExecute).not.toHaveBeenCalled()

      // Result should contain the denial error
      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].error).toBe('Not allowed in test mode')
      expect(result.toolResults[0].result).toBeNull()
    })

    it('can modify tool arguments', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({
        action: 'modify',
        arguments: { value: 'modified-value' },
      })

      const receivedArgs = vi.fn()
      const modifiableTool = tool({
        name: 'modifiableTool',
        description: 'Args can be modified',
        inputSchema: z.object({ value: z.string() }),
        execute: async (input) => {
          receivedArgs(input)
          return input
        },
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'modifiableTool', arguments: { value: 'original' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPreToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [modifiableTool] })

      // Tool should have received modified arguments
      expect(receivedArgs).toHaveBeenCalledWith({ value: 'modified-value' })
    })

    it('allow action lets tool execute normally', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({ action: 'allow' })

      const toolExecute = vi.fn().mockResolvedValue('success')
      const allowedTool = tool({
        name: 'allowedTool',
        description: 'Will be allowed',
        inputSchema: z.object({}),
        execute: toolExecute,
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'allowedTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPreToolUse },
        generate: mockGen.generate,
      })

      const result = await agent.run({ prompt: 'Test', tools: [allowedTool] })

      expect(toolExecute).toHaveBeenCalled()
      expect(result.toolResults[0].result).toBe('success')
    })
  })

  describe('onPostToolUse', () => {
    it('is called after each tool execution', async () => {
      const onPostToolUse = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'testTool', arguments: { value: 'test' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = createTestTool('testTool')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPostToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(onPostToolUse).toHaveBeenCalledTimes(1)
    })

    it('receives toolCall and toolResult', async () => {
      const onPostToolUse = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'testTool', arguments: { value: 'input' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = tool({
        name: 'testTool',
        description: 'Test',
        inputSchema: z.object({ value: z.string() }),
        execute: async () => ({ output: 'result' }),
      })

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPostToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(onPostToolUse).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tc1',
          name: 'testTool',
          arguments: { value: 'input' },
        }),
        expect.objectContaining({
          toolCallId: 'tc1',
          toolName: 'testTool',
          result: { output: 'result' },
        })
      )
    })

    it('is called even when tool errors', async () => {
      const onPostToolUse = vi.fn().mockResolvedValue(undefined)

      const errorTool = tool({
        name: 'errorTool',
        description: 'Throws error',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Oops!')
        },
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'errorTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Handled error',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPostToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [errorTool] })

      expect(onPostToolUse).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'errorTool' }),
        expect.objectContaining({ error: 'Oops!' })
      )
    })

    it('is called for each tool in multi-tool step', async () => {
      const onPostToolUse = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [
            { id: 'tc1', name: 'tool1', arguments: {} },
            { id: 'tc2', name: 'tool2', arguments: {} },
            { id: 'tc3', name: 'tool3', arguments: {} },
          ],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const tool1 = createTestTool('tool1')
      const tool2 = createTestTool('tool2')
      const tool3 = createTestTool('tool3')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onPostToolUse },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [tool1, tool2, tool3] })

      expect(onPostToolUse).toHaveBeenCalledTimes(3)
    })
  })

  describe('onStepStart', () => {
    it('is called before each step', async () => {
      const onStepStart = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc2', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onStepStart },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(onStepStart).toHaveBeenCalledTimes(3)
    })

    it('receives step number and state', async () => {
      const onStepStart = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onStepStart },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Hello' })

      expect(onStepStart).toHaveBeenCalledWith(
        1, // stepNumber
        expect.objectContaining({
          stepNumber: 1,
          messages: expect.any(Array),
          totalTokens: expect.any(Number),
        })
      )
    })
  })

  describe('onStepFinish', () => {
    it('is called after each step with result', async () => {
      const onStepFinish = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Final response',
          finishReason: 'stop',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onStepFinish },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(onStepFinish).toHaveBeenCalledTimes(2)
    })

    it('receives step result and step number', async () => {
      const onStepFinish = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: 'Hello world',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onStepFinish },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test' })

      expect(onStepFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello world',
          finishReason: 'stop',
        }),
        1 // stepNumber
      )
    })

    it('step result includes tool results after tool execution', async () => {
      const onStepFinish = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = tool({
        name: 'test',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => ({ computed: 42 }),
      })

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: { onStepFinish },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      // First call should have toolResults populated after tool execution
      const firstCall = onStepFinish.mock.calls[0]
      expect(firstCall[0].toolResults).toBeDefined()
      expect(firstCall[0].toolResults).toHaveLength(1)
      expect(firstCall[0].toolResults[0].result).toEqual({ computed: 42 })
    })
  })

  describe('Hook combinations', () => {
    it('all hooks work together', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({ action: 'allow' })
      const onPostToolUse = vi.fn().mockResolvedValue(undefined)
      const onStepStart = vi.fn().mockResolvedValue(undefined)
      const onStepFinish = vi.fn().mockResolvedValue(undefined)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: {
          onPreToolUse,
          onPostToolUse,
          onStepStart,
          onStepFinish,
        },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      expect(onStepStart).toHaveBeenCalledTimes(2)
      expect(onPreToolUse).toHaveBeenCalledTimes(1)
      expect(onPostToolUse).toHaveBeenCalledTimes(1)
      expect(onStepFinish).toHaveBeenCalledTimes(2)
    })

    it('hooks are called in correct order within a step', async () => {
      const callOrder: string[] = []

      const onStepStart = vi.fn().mockImplementation(async () => {
        callOrder.push('stepStart')
      })
      const onPreToolUse = vi.fn().mockImplementation(async () => {
        callOrder.push('preToolUse')
        return { action: 'allow' }
      })
      const onPostToolUse = vi.fn().mockImplementation(async () => {
        callOrder.push('postToolUse')
      })
      const onStepFinish = vi.fn().mockImplementation(async () => {
        callOrder.push('stepFinish')
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const testTool = createTestTool('test')

      const agent = new BaseAgent({
        config: createTestConfig(),
        provider: mockProvider,
        hooks: {
          onPreToolUse,
          onPostToolUse,
          onStepStart,
          onStepFinish,
        },
        generate: mockGen.generate,
      })

      await agent.run({ prompt: 'Test', tools: [testTool] })

      // Expected order for step 1: stepStart -> (generate) -> preToolUse -> (execute) -> postToolUse -> stepFinish
      expect(callOrder[0]).toBe('stepStart')
      expect(callOrder[1]).toBe('preToolUse')
      expect(callOrder[2]).toBe('postToolUse')
      expect(callOrder[3]).toBe('stepFinish')
      // Step 2: stepStart -> (generate) -> stepFinish (no tools)
      expect(callOrder[4]).toBe('stepStart')
      expect(callOrder[5]).toBe('stepFinish')
    })
  })
})
