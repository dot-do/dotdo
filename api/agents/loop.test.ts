/**
 * Agent Loop Tests
 *
 * Tests for the think-act-observe execution pattern:
 * - Think phase: LLM generates response/plan
 * - Act phase: Execute tool calls
 * - Observe phase: Process results and decide to continue or stop
 *
 * @module agents/loop.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { AgentLoop, createAgentLoop, runSingleCycle, type AgentLoopEvent } from './loop'
import { tool } from './Tool'
import { stepCountIs, hasToolCall, hasText } from './stopConditions'
import type { Message, StepResult, ToolDefinition } from './types'

// ============================================================================
// Test Utilities
// ============================================================================

function createMockGenerate() {
  const responses: StepResult[] = []
  let callIndex = 0

  const generate = vi.fn(async (_messages: Message[], _tools?: ToolDefinition[]): Promise<StepResult> => {
    if (callIndex >= responses.length) {
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

function createTestTool(name: string, executeFn?: (input: unknown) => Promise<unknown>): ToolDefinition {
  return tool({
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({ value: z.string().optional() }),
    execute: executeFn ?? (async (input) => ({ result: `executed ${name}`, input })),
  })
}

// ============================================================================
// AgentLoop Basic Tests
// ============================================================================

describe('AgentLoop', () => {
  describe('constructor and factory', () => {
    it('creates loop with createAgentLoop factory', () => {
      const mockGen = createMockGenerate()
      const loop = createAgentLoop({
        generate: mockGen.generate,
        maxSteps: 5,
      })

      expect(loop).toBeInstanceOf(AgentLoop)
    })

    it('creates loop with class constructor', () => {
      const mockGen = createMockGenerate()
      const loop = new AgentLoop({
        generate: mockGen.generate,
        tools: [],
      })

      expect(loop).toBeInstanceOf(AgentLoop)
    })
  })

  describe('run() - Basic execution', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('completes single step when no tools called', async () => {
      mockGen.setResponses([
        {
          text: 'Hello! How can I help?',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate })
      const result = await loop.run({ prompt: 'Hi' })

      expect(result.text).toBe('Hello! How can I help?')
      expect(result.steps).toBe(1)
      expect(result.toolCalls).toHaveLength(0)
      expect(result.toolResults).toHaveLength(0)
    })

    it('builds messages from prompt', async () => {
      mockGen.setResponses([
        { text: 'Response', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate })
      await loop.run({ prompt: 'Hello there!' })

      expect(mockGen.generate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Hello there!' })]),
        expect.anything()
      )
    })

    it('uses provided messages array', async () => {
      mockGen.setResponses([
        { text: 'Response', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      ])

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ]

      const loop = createAgentLoop({ generate: mockGen.generate })
      await loop.run({ messages })

      expect(mockGen.generate).toHaveBeenCalledWith(expect.arrayContaining(messages), expect.anything())
    })
  })

  describe('run() - Think phase', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('calls generate with messages and tools', async () => {
      mockGen.setResponses([
        { text: 'Done', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      ])

      const testTool = createTestTool('search')
      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
      })

      await loop.run({ prompt: 'Search something' })

      expect(mockGen.generate).toHaveBeenCalledWith(expect.any(Array), expect.arrayContaining([testTool]))
    })

    it('accumulates token usage across steps', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
        {
          text: 'Final',
          finishReason: 'stop',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        },
      ])

      const testTool = createTestTool('test')
      const loop = createAgentLoop({ generate: mockGen.generate, tools: [testTool] })
      const result = await loop.run({ prompt: 'Test' })

      expect(result.usage.promptTokens).toBe(300)
      expect(result.usage.completionTokens).toBe(150)
      expect(result.usage.totalTokens).toBe(450)
    })
  })

  describe('run() - Act phase', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('executes tool calls', async () => {
      const executeFn = vi.fn().mockResolvedValue({ data: 'result' })
      const testTool = createTestTool('myTool', executeFn)

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'myTool', arguments: { value: 'test' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [testTool] })
      const result = await loop.run({ prompt: 'Run tool' })

      expect(executeFn).toHaveBeenCalledWith({ value: 'test' }, expect.any(Object))
      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].result).toEqual({ data: 'result' })
    })

    it('executes multiple tool calls in sequence', async () => {
      const tool1Execute = vi.fn().mockResolvedValue({ from: 'tool1' })
      const tool2Execute = vi.fn().mockResolvedValue({ from: 'tool2' })

      const tool1 = createTestTool('tool1', tool1Execute)
      const tool2 = createTestTool('tool2', tool2Execute)

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
          text: 'Both done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [tool1, tool2] })
      const result = await loop.run({ prompt: 'Run both' })

      expect(tool1Execute).toHaveBeenCalled()
      expect(tool2Execute).toHaveBeenCalled()
      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolResults).toHaveLength(2)
    })

    it('handles tool execution errors', async () => {
      const errorTool = tool({
        name: 'errorTool',
        description: 'Throws',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Tool failed!')
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

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [errorTool] })
      const result = await loop.run({ prompt: 'Test' })

      expect(result.toolResults[0].error).toBe('Tool failed!')
      expect(result.toolResults[0].result).toBeNull()
    })

    it('handles unknown tool gracefully', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'unknownTool', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Recovered',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [] })
      const result = await loop.run({ prompt: 'Test' })

      expect(result.toolResults[0].error).toContain('Unknown tool')
      expect(result.toolResults[0].error).toContain('unknownTool')
    })
  })

  describe('run() - Observe phase', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('stops when stopWhen condition is met', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'finish', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const finishTool = createTestTool('finish')
      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [finishTool],
        stopWhen: hasToolCall('finish'),
      })

      const result = await loop.run({ prompt: 'Test' })

      expect(result.steps).toBe(1)
      expect(result.toolCalls.some((tc) => tc.name === 'finish')).toBe(true)
    })

    it('respects maxSteps limit', async () => {
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
          text: 'Unreachable',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loopTool = createTestTool('loop')
      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [loopTool],
        maxSteps: 2,
      })

      const result = await loop.run({ prompt: 'Test' })

      expect(result.steps).toBeLessThanOrEqual(2)
    })

    it('stops when text is produced without tool calls', async () => {
      mockGen.setResponses([
        {
          text: 'Here is my response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({ generate: mockGen.generate })
      const result = await loop.run({ prompt: 'Test' })

      expect(result.text).toBe('Here is my response')
      expect(result.steps).toBe(1)
    })
  })

  describe('run() - Multi-step loop', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('loops through think-act-observe cycle multiple times', async () => {
      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'AI news' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        },
        {
          text: undefined,
          toolCalls: [{ id: 'tc2', name: 'summarize', arguments: { text: 'results' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
        },
        {
          text: 'Here is your summary of AI news...',
          finishReason: 'stop',
          usage: { promptTokens: 40, completionTokens: 50, totalTokens: 90 },
        },
      ])

      const searchTool = createTestTool('search')
      const summarizeTool = createTestTool('summarize')

      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [searchTool, summarizeTool],
      })

      const result = await loop.run({ prompt: 'Find and summarize AI news' })

      expect(result.steps).toBe(3)
      expect(result.toolCalls).toHaveLength(2)
      expect(result.text).toContain('summary')
    })
  })

  describe('run() - Abort signal', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('respects abort signal', async () => {
      const controller = new AbortController()

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'slow', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const slowTool = tool({
        name: 'slow',
        description: 'Slow tool',
        inputSchema: z.object({}),
        execute: async () => {
          controller.abort()
          return 'done'
        },
      })

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [slowTool] })
      const result = await loop.run({ prompt: 'Test', signal: controller.signal })

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

      const loop = createAgentLoop({ generate: mockGen.generate, tools: [signalTool] })
      await loop.run({ prompt: 'Test', signal: controller.signal })

      expect(receivedSignal).toHaveBeenCalledWith(controller.signal)
    })
  })

  describe('run() - Hooks', () => {
    let mockGen: ReturnType<typeof createMockGenerate>

    beforeEach(() => {
      mockGen = createMockGenerate()
    })

    it('calls onStepStart before each step', async () => {
      const onStepStart = vi.fn()

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
      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
        hooks: { onStepStart },
      })

      await loop.run({ prompt: 'Test' })

      expect(onStepStart).toHaveBeenCalledTimes(2)
      expect(onStepStart).toHaveBeenCalledWith(1, expect.objectContaining({ stepNumber: 1 }))
      expect(onStepStart).toHaveBeenCalledWith(2, expect.objectContaining({ stepNumber: 2 }))
    })

    it('calls onStepFinish after each step', async () => {
      const onStepFinish = vi.fn()

      mockGen.setResponses([
        {
          text: 'Response',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({
        generate: mockGen.generate,
        hooks: { onStepFinish },
      })

      await loop.run({ prompt: 'Test' })

      expect(onStepFinish).toHaveBeenCalledTimes(1)
      expect(onStepFinish).toHaveBeenCalledWith(expect.objectContaining({ text: 'Response' }), 1)
    })

    it('calls onPreToolUse before tool execution', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({ action: 'allow' })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: { value: 'x' } }],
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
      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
        hooks: { onPreToolUse },
      })

      await loop.run({ prompt: 'Test' })

      expect(onPreToolUse).toHaveBeenCalledWith(expect.objectContaining({ name: 'test' }))
    })

    it('denies tool execution when hook returns deny', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({
        action: 'deny',
        reason: 'Not allowed',
      })

      const toolExecute = vi.fn()
      const testTool = tool({
        name: 'test',
        description: 'Test',
        inputSchema: z.object({}),
        execute: toolExecute,
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Handled',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
        hooks: { onPreToolUse },
      })

      const result = await loop.run({ prompt: 'Test' })

      expect(toolExecute).not.toHaveBeenCalled()
      expect(result.toolResults[0].error).toBe('Not allowed')
    })

    it('modifies tool arguments when hook returns modify', async () => {
      const onPreToolUse = vi.fn().mockResolvedValue({
        action: 'modify',
        arguments: { value: 'modified' },
      })

      const receivedArgs = vi.fn()
      const testTool = tool({
        name: 'test',
        description: 'Test',
        inputSchema: z.object({ value: z.string() }),
        execute: async (input) => {
          receivedArgs(input)
          return input
        },
      })

      mockGen.setResponses([
        {
          text: undefined,
          toolCalls: [{ id: 'tc1', name: 'test', arguments: { value: 'original' } }],
          finishReason: 'tool_calls',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        {
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ])

      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
        hooks: { onPreToolUse },
      })

      await loop.run({ prompt: 'Test' })

      expect(receivedArgs).toHaveBeenCalledWith({ value: 'modified' })
    })

    it('calls onPostToolUse after tool execution', async () => {
      const onPostToolUse = vi.fn()

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
        execute: async () => ({ output: 'result' }),
      })

      const loop = createAgentLoop({
        generate: mockGen.generate,
        tools: [testTool],
        hooks: { onPostToolUse },
      })

      await loop.run({ prompt: 'Test' })

      expect(onPostToolUse).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test' }),
        expect.objectContaining({ result: { output: 'result' } })
      )
    })
  })
})

// ============================================================================
// Stream Tests
// ============================================================================

describe('AgentLoop.stream()', () => {
  let mockGen: ReturnType<typeof createMockGenerate>

  beforeEach(() => {
    mockGen = createMockGenerate()
  })

  it('emits step-start events', async () => {
    mockGen.setResponses([
      {
        text: 'Response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ])

    const loop = createAgentLoop({ generate: mockGen.generate })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'step-start')).toBe(true)
  })

  it('emits think-start and think-complete events', async () => {
    mockGen.setResponses([
      {
        text: 'Thinking result',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ])

    const loop = createAgentLoop({ generate: mockGen.generate })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    const thinkStart = events.find((e) => e.type === 'think-start')
    const thinkComplete = events.find((e) => e.type === 'think-complete')

    expect(thinkStart).toBeDefined()
    expect(thinkComplete).toBeDefined()
    if (thinkComplete?.type === 'think-complete') {
      expect(thinkComplete.result.text).toBe('Thinking result')
    }
  })

  it('emits act-start and act-complete events when tools called', async () => {
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
    const loop = createAgentLoop({ generate: mockGen.generate, tools: [testTool] })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    const actStart = events.find((e) => e.type === 'act-start')
    const actComplete = events.find((e) => e.type === 'act-complete')

    expect(actStart).toBeDefined()
    expect(actComplete).toBeDefined()
  })

  it('emits observe-start and observe-complete events', async () => {
    mockGen.setResponses([
      {
        text: 'Response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ])

    const loop = createAgentLoop({ generate: mockGen.generate })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    const observeStart = events.find((e) => e.type === 'observe-start')
    const observeComplete = events.find((e) => e.type === 'observe-complete')

    expect(observeStart).toBeDefined()
    expect(observeComplete).toBeDefined()
    if (observeComplete?.type === 'observe-complete') {
      expect(observeComplete.shouldStop).toBe(true)
    }
  })

  it('emits loop-complete with final result', async () => {
    mockGen.setResponses([
      {
        text: 'Final answer',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ])

    const loop = createAgentLoop({ generate: mockGen.generate })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    const loopComplete = events.find((e) => e.type === 'loop-complete')
    expect(loopComplete).toBeDefined()
    if (loopComplete?.type === 'loop-complete') {
      expect(loopComplete.result.text).toBe('Final answer')
    }
  })

  it('streams multiple steps correctly', async () => {
    mockGen.setResponses([
      {
        text: undefined,
        toolCalls: [{ id: 'tc1', name: 'step1', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      {
        text: 'Complete',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ])

    const step1Tool = createTestTool('step1')
    const loop = createAgentLoop({ generate: mockGen.generate, tools: [step1Tool] })
    const events: AgentLoopEvent[] = []

    for await (const event of loop.stream({ prompt: 'Test' })) {
      events.push(event)
    }

    const stepStarts = events.filter((e) => e.type === 'step-start')
    expect(stepStarts).toHaveLength(2)
  })
})

// ============================================================================
// runSingleCycle Tests
// ============================================================================

describe('runSingleCycle()', () => {
  it('executes one think-act cycle', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: undefined,
      toolCalls: [{ id: 'tc1', name: 'test', arguments: { value: 'x' } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const testTool = tool({
      name: 'test',
      description: 'Test',
      inputSchema: z.object({ value: z.string() }),
      execute: async () => ({ output: 'result' }),
    })

    const messages: Message[] = [{ role: 'user', content: 'Run test' }]

    const { result, toolResults, newMessages } = await runSingleCycle(messages, generate, [testTool])

    expect(result.toolCalls).toHaveLength(1)
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].result).toEqual({ output: 'result' })
    expect(newMessages).toHaveLength(2) // assistant + tool result
  })

  it('handles no tool calls', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: 'Just text response',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const messages: Message[] = [{ role: 'user', content: 'Hello' }]

    const { result, toolResults, newMessages } = await runSingleCycle(messages, generate)

    expect(result.text).toBe('Just text response')
    expect(toolResults).toHaveLength(0)
    expect(newMessages).toHaveLength(1) // just assistant
  })

  it('applies hooks during cycle', async () => {
    const onPreToolUse = vi.fn().mockResolvedValue({ action: 'allow' })
    const onPostToolUse = vi.fn()

    const generate = vi.fn().mockResolvedValue({
      text: undefined,
      toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })

    const testTool = createTestTool('test')
    const messages: Message[] = [{ role: 'user', content: 'Test' }]

    await runSingleCycle(messages, generate, [testTool], { onPreToolUse, onPostToolUse })

    expect(onPreToolUse).toHaveBeenCalled()
    expect(onPostToolUse).toHaveBeenCalled()
  })
})
