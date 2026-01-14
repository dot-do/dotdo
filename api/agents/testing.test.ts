/**
 * Testing Utilities Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  createMockProvider,
  createIsolatedMockProvider,
  createMockTool,
  createTrackedTool,
  mockResponses,
  fixtures,
  expectAgentResult,
  collectStreamEvents,
} from './testing'
import { tool, stepCountIs, hasToolCall } from './index'

describe('mockResponses', () => {
  describe('text()', () => {
    it('creates text response with defaults', () => {
      const response = mockResponses.text('Hello')
      expect(response.text).toBe('Hello')
      expect(response.finishReason).toBe('stop')
      expect(response.usage).toBeDefined()
    })

    it('allows custom usage', () => {
      const response = mockResponses.text('Hello', { promptTokens: 100 })
      expect(response.usage?.promptTokens).toBe(100)
    })
  })

  describe('toolCall()', () => {
    it('creates tool call response', () => {
      const response = mockResponses.toolCall('search', { query: 'test' })
      expect(response.toolCalls).toHaveLength(1)
      expect(response.toolCalls![0].name).toBe('search')
      expect(response.toolCalls![0].arguments).toEqual({ query: 'test' })
      expect(response.finishReason).toBe('tool_calls')
    })

    it('allows custom id and text', () => {
      const response = mockResponses.toolCall('search', { query: 'test' }, {
        id: 'custom-id',
        text: 'Searching...',
      })
      expect(response.toolCalls![0].id).toBe('custom-id')
      expect(response.text).toBe('Searching...')
    })
  })

  describe('toolCalls()', () => {
    it('creates multiple tool calls', () => {
      const response = mockResponses.toolCalls([
        { name: 'search', args: { query: 'a' } },
        { name: 'fetch', args: { url: 'http://...' } },
      ])
      expect(response.toolCalls).toHaveLength(2)
      expect(response.toolCalls![0].name).toBe('search')
      expect(response.toolCalls![1].name).toBe('fetch')
    })
  })

  describe('error()', () => {
    it('creates error response', () => {
      const response = mockResponses.error('Something went wrong')
      expect(response.text).toBe('Something went wrong')
      expect(response.finishReason).toBe('error')
    })
  })

  describe('maxTokens()', () => {
    it('creates max tokens response', () => {
      const response = mockResponses.maxTokens('Partial...')
      expect(response.text).toBe('Partial...')
      expect(response.finishReason).toBe('max_steps')
    })
  })
})

describe('createMockProvider', () => {
  it('returns responses in sequence', async () => {
    const provider = createMockProvider({
      responses: [
        mockResponses.text('First'),
        mockResponses.text('Second'),
      ],
    })

    const agent = provider.createAgent(fixtures.minimalAgent)

    // First run gets first response
    const result1 = await agent.run({ prompt: 'Hello' })
    expect(result1.text).toBe('First')
  })

  it('uses default response when exhausted', async () => {
    const provider = createMockProvider({
      responses: [mockResponses.text('Only one')],
    })

    const agent = provider.createAgent({
      ...fixtures.minimalAgent,
      stopWhen: stepCountIs(3),
    })

    // Force multiple steps
    const result = await agent.run({ prompt: 'Hello' })
    // Should eventually get "No more responses" as default
  })

  it('calls onGenerate callback', async () => {
    const onGenerate = vi.fn()
    const provider = createMockProvider({
      responses: [mockResponses.text('Response')],
      onGenerate,
    })

    const agent = provider.createAgent(fixtures.minimalAgent)
    await agent.run({ prompt: 'Hello' })

    expect(onGenerate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      0
    )
  })

  it('lists mock model', async () => {
    const provider = createMockProvider({ responses: [] })
    const models = await provider.listModels()
    expect(models).toContain('mock-model')
  })
})

describe('createIsolatedMockProvider', () => {
  it('resets step index for each agent', async () => {
    const provider = createIsolatedMockProvider({
      responses: [
        mockResponses.text('First'),
        mockResponses.text('Second'),
      ],
    })

    // Create two agents
    const agent1 = provider.createAgent({ ...fixtures.minimalAgent, id: 'agent-1' })
    const agent2 = provider.createAgent({ ...fixtures.minimalAgent, id: 'agent-2' })

    // Both should get "First" since they have separate step counters
    const result1 = await agent1.run({ prompt: 'Hello' })
    const result2 = await agent2.run({ prompt: 'Hello' })

    expect(result1.text).toBe('First')
    expect(result2.text).toBe('First')
  })
})

describe('createMockTool', () => {
  it('creates tool with defaults', () => {
    const mockTool = createMockTool({ name: 'test' })
    expect(mockTool.name).toBe('test')
    expect(mockTool.description).toContain('test')
  })

  it('uses custom execute function', async () => {
    const mockTool = createMockTool({
      name: 'multiply',
      execute: async ({ a, b }: { a: number; b: number }) => a * b,
    })

    const result = await mockTool.execute({ a: 3, b: 4 }, { agentId: 'test' })
    expect(result).toBe(12)
  })

  it('uses executeSync for simple returns', async () => {
    const mockTool = createMockTool({
      name: 'greet',
      executeSync: ({ name }: { name: string }) => `Hello, ${name}!`,
    })

    const result = await mockTool.execute({ name: 'World' }, { agentId: 'test' })
    expect(result).toBe('Hello, World!')
  })
})

describe('createTrackedTool', () => {
  it('tracks all calls', async () => {
    const [trackedTool, calls] = createTrackedTool('search')

    await trackedTool.execute({ query: 'first' }, { agentId: 'test' })
    await trackedTool.execute({ query: 'second' }, { agentId: 'test' })

    expect(calls).toHaveLength(2)
    expect(calls[0].input).toEqual({ query: 'first' })
    expect(calls[1].input).toEqual({ query: 'second' })
  })

  it('records timestamps', async () => {
    const [trackedTool, calls] = createTrackedTool('search')
    const before = new Date()

    await trackedTool.execute({ query: 'test' }, { agentId: 'test' })

    const after = new Date()
    expect(calls[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(calls[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('returns custom value', async () => {
    const [trackedTool] = createTrackedTool('search', { results: ['a', 'b'] })
    const result = await trackedTool.execute({ query: 'test' }, { agentId: 'test' })
    expect(result).toEqual({ results: ['a', 'b'] })
  })
})

describe('fixtures', () => {
  it('provides minimal agent config', () => {
    expect(fixtures.minimalAgent.id).toBeDefined()
    expect(fixtures.minimalAgent.name).toBeDefined()
    expect(fixtures.minimalAgent.instructions).toBeDefined()
    expect(fixtures.minimalAgent.model).toBeDefined()
  })

  it('provides chat messages', () => {
    expect(fixtures.chatMessages).toHaveLength(3)
    expect(fixtures.chatMessages[0].role).toBe('user')
  })

  it('provides tool call sequence', () => {
    expect(fixtures.toolCallSequence).toHaveLength(4)
    expect(fixtures.toolCallSequence[1].toolCalls).toBeDefined()
  })
})

describe('expectAgentResult', () => {
  it('validates text match', () => {
    const result = { text: 'Hello', steps: 1, toolCalls: [] }

    // Should not throw
    expectAgentResult(result, { text: 'Hello' })

    // Should throw
    expect(() => expectAgentResult(result, { text: 'Goodbye' }))
      .toThrow('Expected text "Goodbye"')
  })

  it('validates regex match', () => {
    const result = { text: 'Hello World!', steps: 1, toolCalls: [] }

    // Should not throw
    expectAgentResult(result, { text: /World/ })

    // Should throw
    expect(() => expectAgentResult(result, { text: /Universe/ }))
      .toThrow('Expected text to match')
  })

  it('validates step count', () => {
    const result = { text: 'Done', steps: 5, toolCalls: [] }

    // Should not throw
    expectAgentResult(result, { minSteps: 3 })
    expectAgentResult(result, { maxSteps: 10 })

    // Should throw
    expect(() => expectAgentResult(result, { minSteps: 10 }))
      .toThrow('Expected at least 10 steps')
    expect(() => expectAgentResult(result, { maxSteps: 3 }))
      .toThrow('Expected at most 3 steps')
  })

  it('validates tool call count', () => {
    const result = { text: 'Done', steps: 1, toolCalls: [{ id: '1', name: 'a', arguments: {} }] }

    // Should not throw
    expectAgentResult(result, { toolCallCount: 1 })

    // Should throw
    expect(() => expectAgentResult(result, { toolCallCount: 2 }))
      .toThrow('Expected 2 tool calls')
  })
})

describe('collectStreamEvents', () => {
  it('collects all events', async () => {
    async function* mockStream() {
      yield { type: 'text-delta' as const, data: { textDelta: 'Hello ' }, timestamp: new Date() }
      yield { type: 'text-delta' as const, data: { textDelta: 'World' }, timestamp: new Date() }
      yield { type: 'done' as const, data: {}, timestamp: new Date() }
    }

    const { events, textDeltas } = await collectStreamEvents(mockStream())

    expect(events).toHaveLength(3)
    expect(textDeltas).toEqual(['Hello ', 'World'])
  })

  it('collects tool calls', async () => {
    async function* mockStream() {
      yield {
        type: 'tool-call-end' as const,
        data: { toolCall: { id: '1', name: 'search', arguments: { q: 'test' } } },
        timestamp: new Date(),
      }
      yield { type: 'done' as const, data: {}, timestamp: new Date() }
    }

    const { toolCalls } = await collectStreamEvents(mockStream())

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].name).toBe('search')
  })
})
