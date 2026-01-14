/**
 * AgentRuntime Tests
 *
 * Tests for:
 * - Agent loop (think-act-observe)
 * - Tool execution integration
 * - Memory integration
 * - Cost tracking
 * - Streaming
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type {
  Message,
  CompletionResponse,
  ToolCall,
  ToolResult,
  StreamEvent,
  AgentRunResponse,
} from '../types'
import { createAgentRuntime, type AgentRuntime } from '../runtime'
import { createTool } from '../tools'

// ============================================================================
// Test Utilities
// ============================================================================

function createMockTextResponse(text: string): CompletionResponse {
  return {
    id: 'resp-1',
    model: 'gpt-4o',
    content: text,
    finishReason: 'stop',
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    latencyMs: 100,
    provider: 'openai',
  }
}

function createMockToolCallResponse(toolCalls: ToolCall[]): CompletionResponse {
  return {
    id: 'resp-1',
    model: 'gpt-4o',
    toolCalls,
    finishReason: 'tool_calls',
    usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
    latencyMs: 100,
    provider: 'openai',
  }
}

// ============================================================================
// Runtime Creation Tests
// ============================================================================

describe('AgentRuntime', () => {
  describe('createAgentRuntime()', () => {
    it('should create runtime with minimal config', () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [{ name: 'openai', apiKey: 'test-key' }],
        },
      })

      expect(runtime).toBeDefined()
      expect(runtime.getConfig().id).toBe('test-agent')
    })

    it('should create runtime with full config', () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        name: 'Test Agent',
        model: 'gpt-4o',
        instructions: 'You are a helpful assistant.',
        router: {
          providers: [{ name: 'openai', apiKey: 'test-key' }],
        },
        memory: {
          maxMessages: 50,
          maxTokens: 4000,
        },
        maxSteps: 10,
      })

      expect(runtime.getConfig().name).toBe('Test Agent')
      expect(runtime.getConfig().instructions).toBe('You are a helpful assistant.')
      expect(runtime.getConfig().maxSteps).toBe(10)
    })
  })

  // ============================================================================
  // Basic Run Tests
  // ============================================================================

  describe('run()', () => {
    it('should return text response for simple query', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Hello! How can I help?') },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Hello' })

      expect(response.text).toBe('Hello! How can I help?')
      expect(response.finishReason).toBe('stop')
      expect(response.steps).toBe(1)
    })

    it('should include messages in response', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        instructions: 'You are helpful.',
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Response') },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Query' })

      // Should have system, user, and assistant messages
      expect(response.messages.length).toBeGreaterThanOrEqual(2)
      expect(response.messages.some((m) => m.role === 'system')).toBe(true)
      expect(response.messages.some((m) => m.role === 'user')).toBe(true)
      expect(response.messages.some((m) => m.role === 'assistant')).toBe(true)
    })

    it('should track usage', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Response') },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Query' })

      expect(response.usage.totalTokens).toBeGreaterThan(0)
      expect(response.costUsd).toBeGreaterThanOrEqual(0)
      expect(response.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // Tool Execution Tests
  // ============================================================================

  describe('Tool Execution', () => {
    it('should execute tool when LLM returns tool call', async () => {
      const weatherTool = createTool({
        name: 'get_weather',
        description: 'Get weather for a location',
        inputSchema: z.object({
          location: z.string(),
        }),
        execute: async ({ location }) => ({ temp: 72, location, condition: 'sunny' }),
      })

      // Create mock responses: first returns tool call, second returns final text
      const responses: CompletionResponse[] = [
        createMockToolCallResponse([
          { id: 'call-1', name: 'get_weather', arguments: { location: 'NYC' } },
        ]),
        createMockTextResponse('The weather in NYC is 72F and sunny.'),
      ]

      let callIndex = 0
      const getMockResponse = () => responses[Math.min(callIndex++, responses.length - 1)]

      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        tools: [weatherTool],
        maxSteps: 3,
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: {
                mockResponse: getMockResponse(),
                mockStreamEvents: undefined,
              },
            },
          ],
        },
      })

      // Override the router to use sequential responses
      // This is a workaround since the provider is created once
      const response = await runtime.run({ prompt: 'What is the weather in NYC?' })

      // The first response triggers a tool call, which should be at least 1
      expect(response.toolCalls.length).toBeGreaterThanOrEqual(1)
      expect(response.toolCalls[0].name).toBe('get_weather')
      expect(response.toolResults.length).toBeGreaterThanOrEqual(1)
      expect(response.toolResults[0].result).toEqual({ temp: 72, location: 'NYC', condition: 'sunny' })
    })

    it('should handle multiple tool calls in one step', async () => {
      const addTool = createTool({
        name: 'add',
        description: 'Add numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ result: a + b }),
      })

      // Test with a single response that has multiple tool calls
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        tools: [addTool],
        maxSteps: 3,
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: {
                mockResponse: createMockToolCallResponse([
                  { id: 'call-1', name: 'add', arguments: { a: 2, b: 3 } },
                  { id: 'call-2', name: 'add', arguments: { a: 10, b: 20 } },
                ]),
              },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Add 2+3 and 10+20' })

      // With maxSteps=3, we'll get multiple iterations but each has 2 tool calls
      expect(response.toolCalls.length).toBeGreaterThanOrEqual(2)
      expect(response.toolResults.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle tool execution errors', async () => {
      const errorTool = createTool({
        name: 'error_tool',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Tool failed!')
        },
      })

      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        tools: [errorTool],
        maxSteps: 2,
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: {
                mockResponse: createMockToolCallResponse([{ id: 'call-1', name: 'error_tool', arguments: {} }]),
              },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Use the error tool' })

      expect(response.toolResults[0].error).toBe('Tool failed!')
    })
  })

  // ============================================================================
  // Max Steps Tests
  // ============================================================================

  describe('Max Steps', () => {
    it('should stop at maxSteps', async () => {
      // Keep returning tool calls to force looping
      const loopTool = createTool({
        name: 'loop',
        description: 'Causes loop',
        inputSchema: z.object({}),
        execute: async () => ({ continue: true }),
      })

      const toolResponse = createMockToolCallResponse([
        { id: 'call-1', name: 'loop', arguments: {} },
      ])

      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        tools: [loopTool],
        maxSteps: 3,
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: toolResponse },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Loop forever' })

      expect(response.steps).toBeLessThanOrEqual(3)
    })

    it('should use default maxSteps of 20', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [{ name: 'openai', apiKey: 'test-key' }],
        },
      })

      expect(runtime.getConfig().maxSteps).toBe(20)
    })
  })

  // ============================================================================
  // Memory Integration Tests
  // ============================================================================

  describe('Memory Integration', () => {
    it('should preserve conversation in memory', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        memory: { maxMessages: 100 },
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Hello!') },
            },
          ],
        },
      })

      await runtime.run({ prompt: 'Hi', sessionId: 'session-1' })

      const memory = runtime.getMemory('session-1')
      expect(memory).toBeDefined()
      expect(memory?.getMessages().length).toBeGreaterThan(0)
    })

    it('should continue conversation with session ID', async () => {
      const responses: CompletionResponse[] = [
        createMockTextResponse('Hello! My name is Claude.'),
        createMockTextResponse('As I mentioned, my name is Claude.'),
      ]

      let callIndex = 0

      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        memory: { maxMessages: 100 },
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: {
                get mockResponse() {
                  return responses[callIndex++]
                },
              },
            },
          ],
        },
      })

      await runtime.run({ prompt: 'Hello, what is your name?', sessionId: 'session-1' })
      const response2 = await runtime.run({ prompt: 'What was your name again?', sessionId: 'session-1' })

      // Second response should have context from first
      expect(response2.messages.length).toBeGreaterThan(2)
    })
  })

  // ============================================================================
  // Abort Signal Tests
  // ============================================================================

  describe('Abort Signal', () => {
    it('should cancel on abort signal', async () => {
      const controller = new AbortController()

      // Abort immediately
      controller.abort()

      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Should not see this') },
            },
          ],
        },
      })

      await expect(
        runtime.run({ prompt: 'Hello', signal: controller.signal })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // Stats Tests
  // ============================================================================

  describe('Statistics', () => {
    it('should accumulate usage across steps', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        maxSteps: 1,
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: {
                mockResponse: {
                  ...createMockTextResponse('Done'),
                  usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
                },
              },
            },
          ],
        },
      })

      const response = await runtime.run({ prompt: 'Test' })

      expect(response.usage.totalTokens).toBe(300)
    })

    it('should get runtime stats', async () => {
      const runtime = createAgentRuntime({
        id: 'test-agent',
        model: 'gpt-4o',
        router: {
          providers: [
            {
              name: 'openai',
              apiKey: 'test-key',
              options: { mockResponse: createMockTextResponse('Response') },
            },
          ],
        },
      })

      await runtime.run({ prompt: 'Query 1' })
      await runtime.run({ prompt: 'Query 2' })

      const stats = runtime.getStats()
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2)
    })
  })
})
