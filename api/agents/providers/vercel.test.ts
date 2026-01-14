/**
 * Vercel Provider Unit Tests (RED Phase)
 *
 * Tests for VercelProvider:
 * - createAgent() returns valid BaseAgent
 * - convertMessages() transforms Message[] to Vercel format
 * - convertTools() transforms ToolDefinition[] to Vercel format
 * - Uses ai SDK generateText/streamText
 * - Provider configuration options
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { VercelProvider, createVercelProvider } from './vercel'
import type { Message, ToolDefinition, AgentConfig } from '../types'
import { BaseAgent } from '../Agent'

// Mock the 'ai' module
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
}))

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'test-agent',
  name: 'Test Agent',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o',
  ...overrides,
})

const createTestTool = (): ToolDefinition => ({
  name: 'getWeather',
  description: 'Get weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: vi.fn().mockResolvedValue({ temp: 22, condition: 'sunny' }),
})

// ============================================================================
// VercelProvider Constructor Tests
// ============================================================================

describe('VercelProvider', () => {
  describe('constructor', () => {
    it('sets name to "vercel"', () => {
      const provider = new VercelProvider()
      expect(provider.name).toBe('vercel')
    })

    it('sets version to "6.0"', () => {
      const provider = new VercelProvider()
      expect(provider.version).toBe('6.0')
    })

    it('uses default model "gpt-4o" when not specified', () => {
      const provider = new VercelProvider()
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('gpt-4o')
    })

    it('accepts custom defaultModel option', () => {
      const provider = new VercelProvider({ defaultModel: 'claude-3-5-sonnet-20241022' })
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('claude-3-5-sonnet-20241022')
    })

    it('accepts apiKey option', () => {
      const provider = new VercelProvider({ apiKey: 'test-api-key' })
      expect(provider).toBeInstanceOf(VercelProvider)
    })

    it('accepts baseUrl option', () => {
      const provider = new VercelProvider({ baseUrl: 'https://custom.api.com' })
      expect(provider).toBeInstanceOf(VercelProvider)
    })
  })

  // ============================================================================
  // createAgent Tests
  // ============================================================================

  describe('createAgent()', () => {
    let provider: VercelProvider

    beforeEach(() => {
      provider = new VercelProvider()
    })

    it('returns an instance of BaseAgent', () => {
      const agent = provider.createAgent(createTestConfig())
      expect(agent).toBeInstanceOf(BaseAgent)
    })

    it('preserves agent config id', () => {
      const agent = provider.createAgent(createTestConfig({ id: 'my-agent' }))
      expect(agent.config.id).toBe('my-agent')
    })

    it('preserves agent config name', () => {
      const agent = provider.createAgent(createTestConfig({ name: 'Custom Agent' }))
      expect(agent.config.name).toBe('Custom Agent')
    })

    it('preserves agent config instructions', () => {
      const agent = provider.createAgent(createTestConfig({ instructions: 'Be concise.' }))
      expect(agent.config.instructions).toBe('Be concise.')
    })

    it('uses config model over default', () => {
      const agent = provider.createAgent(createTestConfig({ model: 'gpt-4-turbo' }))
      expect(agent.config.model).toBe('gpt-4-turbo')
    })

    it('sets provider reference on agent', () => {
      const agent = provider.createAgent(createTestConfig())
      expect(agent.provider).toBe(provider)
    })

    it('preserves tools in config', () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      expect(agent.config.tools).toHaveLength(1)
      expect(agent.config.tools![0].name).toBe('getWeather')
    })

    it('agent has run method', () => {
      const agent = provider.createAgent(createTestConfig())
      expect(typeof agent.run).toBe('function')
    })

    it('agent has stream method', () => {
      const agent = provider.createAgent(createTestConfig())
      expect(typeof agent.stream).toBe('function')
    })
  })

  // ============================================================================
  // convertMessages Tests (accessed via generate)
  // ============================================================================

  describe('convertMessages()', () => {
    let provider: VercelProvider
    let generateTextMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      provider = new VercelProvider()
      const ai = await import('ai')
      generateTextMock = vi.mocked(ai.generateText)
      generateTextMock.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('converts user message with string content', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({ messages: [{ role: 'user', content: 'Hello' }] })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user')
      expect(userMsg).toEqual({ role: 'user', content: 'Hello' })
    })

    it('converts user message with content parts', async () => {
      const agent = provider.createAgent(createTestConfig())
      const contentParts = [
        { type: 'text' as const, text: 'Describe this image' },
        { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
      ]
      await agent.run({ messages: [{ role: 'user', content: contentParts }] })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user')
      expect(userMsg.content).toEqual(contentParts)
    })

    it('converts system message', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({ messages: [{ role: 'system', content: 'Be helpful' }] })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      // System message may be added from instructions + explicit
      const systemMsgs = callArgs.messages.filter((m: any) => m.role === 'system')
      expect(systemMsgs.some((m: any) => m.content === 'Be helpful')).toBe(true)
    })

    it('converts assistant message with text content', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'How are you?' },
        ],
      })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      const assistantMsg = callArgs.messages.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.content).toBe('Hello!')
    })

    it('converts assistant message with tool calls', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({
        messages: [
          { role: 'user', content: 'Get weather' },
          {
            role: 'assistant',
            content: 'Let me check',
            toolCalls: [
              { id: 'call-1', name: 'getWeather', arguments: { location: 'NYC' } },
            ],
          },
        ],
      })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      const assistantMsg = callArgs.messages.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.toolCalls).toEqual([
        { toolCallId: 'call-1', toolName: 'getWeather', args: { location: 'NYC' } },
      ])
    })

    it('converts tool result message', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({
        messages: [
          { role: 'user', content: 'Get weather' },
          {
            role: 'tool',
            toolCallId: 'call-1',
            toolName: 'getWeather',
            content: { temp: 22 },
          },
        ],
      })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      const toolMsg = callArgs.messages.find((m: any) => m.role === 'tool')
      expect(toolMsg.toolCallId).toBe('call-1')
      expect(toolMsg.content).toBe(JSON.stringify({ temp: 22 }))
    })
  })

  // ============================================================================
  // convertTools Tests
  // ============================================================================

  describe('convertTools()', () => {
    let provider: VercelProvider
    let generateTextMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      provider = new VercelProvider()
      const ai = await import('ai')
      generateTextMock = vi.mocked(ai.generateText)
      generateTextMock.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('converts tool with Zod input schema', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      expect(callArgs.tools).toBeDefined()
      expect(callArgs.tools.getWeather).toBeDefined()
      expect(callArgs.tools.getWeather.description).toBe('Get weather for a location')
    })

    it('converts tool with JSON Schema input', async () => {
      const jsonSchemaTool: ToolDefinition = {
        name: 'createUser',
        description: 'Create a user',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        execute: vi.fn(),
      }
      const agent = provider.createAgent(createTestConfig({ tools: [jsonSchemaTool] }))
      await agent.run({ prompt: 'Test' })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      expect(callArgs.tools.createUser).toBeDefined()
    })

    it('converts multiple tools', async () => {
      const tool1 = createTestTool()
      const tool2: ToolDefinition = {
        name: 'searchWeb',
        description: 'Search the web',
        inputSchema: z.object({ query: z.string() }),
        execute: vi.fn(),
      }
      const agent = provider.createAgent(createTestConfig({ tools: [tool1, tool2] }))
      await agent.run({ prompt: 'Test' })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      expect(Object.keys(callArgs.tools)).toContain('getWeather')
      expect(Object.keys(callArgs.tools)).toContain('searchWeb')
    })

    it('does not include execute function in converted tool', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(generateTextMock).toHaveBeenCalled()
      const callArgs = generateTextMock.mock.calls[0][0]
      // Vercel tools should not have execute - it's handled by agent loop
      expect(callArgs.tools.getWeather.execute).toBeUndefined()
    })
  })

  // ============================================================================
  // generate() / generateText integration Tests
  // ============================================================================

  describe('generate()', () => {
    let provider: VercelProvider
    let generateTextMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      provider = new VercelProvider()
      const ai = await import('ai')
      generateTextMock = vi.mocked(ai.generateText)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('calls generateText with correct model', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Hello',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      })

      const agent = provider.createAgent(createTestConfig({ model: 'gpt-4-turbo' }))
      await agent.run({ prompt: 'Hi' })

      expect(generateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4-turbo' })
      )
    })

    it('returns text from response', async () => {
      generateTextMock.mockResolvedValue({
        text: 'I am doing well, thank you!',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 8 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'How are you?' })

      expect(result.text).toBe('I am doing well, thank you!')
    })

    it('returns tool calls from response', async () => {
      // First call returns tool call, second call returns final text
      generateTextMock
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { toolCallId: 'call-123', toolName: 'getWeather', args: { location: 'NYC' } },
          ],
          finishReason: 'tool-calls',
          usage: { promptTokens: 10, completionTokens: 5 },
        })
        .mockResolvedValueOnce({
          text: 'The weather in NYC is sunny.',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 15, completionTokens: 10 },
        })

      const tool = createTestTool()
      const agent = provider.createAgent(createTestConfig({ tools: [tool] }))
      const result = await agent.run({ prompt: 'Get weather in NYC' })

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('getWeather')
      expect(result.toolCalls[0].arguments).toEqual({ location: 'NYC' })
    })

    it('maps finish reason "stop" correctly', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Done',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.finishReason).toBe('stop')
    })

    it('maps finish reason "tool-calls" to "tool_calls"', async () => {
      generateTextMock.mockResolvedValue({
        text: '',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', args: {} }],
        finishReason: 'tool-calls',
        usage: { promptTokens: 10, completionTokens: 5 },
      })

      const tool: ToolDefinition = {
        name: 'test',
        description: 'Test tool',
        inputSchema: z.object({}),
        execute: vi.fn().mockResolvedValue('ok'),
      }
      const agent = provider.createAgent(createTestConfig({ tools: [tool] }))
      // Need two calls because first returns tool call, second stops
      generateTextMock.mockResolvedValueOnce({
        text: '',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'test', args: {} }],
        finishReason: 'tool-calls',
        usage: { promptTokens: 10, completionTokens: 5 },
      }).mockResolvedValueOnce({
        text: 'Done',
        finishReason: 'stop',
        usage: { promptTokens: 15, completionTokens: 5 },
      })

      const result = await agent.run({ prompt: 'Test' })
      // Final finish reason depends on implementation
      expect(['stop', 'tool_calls']).toContain(result.finishReason)
    })

    it('maps finish reason "length" to "max_steps"', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Truncated...',
        finishReason: 'length',
        usage: { promptTokens: 10, completionTokens: 100 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.finishReason).toBe('max_steps')
    })

    it('calculates usage correctly', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Response',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.usage.promptTokens).toBe(100)
      expect(result.usage.completionTokens).toBe(50)
      expect(result.usage.totalTokens).toBe(150)
    })

    it('handles missing usage gracefully', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Response',
        finishReason: 'stop',
        usage: undefined,
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.usage.promptTokens).toBe(0)
      expect(result.usage.completionTokens).toBe(0)
      expect(result.usage.totalTokens).toBe(0)
    })

    it('passes providerOptions to generateText', async () => {
      generateTextMock.mockResolvedValue({
        text: 'Response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      })

      const agent = provider.createAgent(
        createTestConfig({
          providerOptions: { temperature: 0.7, maxTokens: 1000 },
        })
      )
      await agent.run({ prompt: 'Test' })

      expect(generateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          maxTokens: 1000,
        })
      )
    })
  })

  // ============================================================================
  // generateStream() / streamText integration Tests
  // ============================================================================

  describe('generateStream()', () => {
    let provider: VercelProvider
    let streamTextMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      provider = new VercelProvider()
      const ai = await import('ai')
      streamTextMock = vi.mocked(ai.streamText)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('streams text deltas', async () => {
      const textChunks = ['Hello', ' ', 'world', '!']
      let chunkIndex = 0

      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of textChunks) {
              yield chunk
            }
          },
        },
        text: 'Hello world!',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        then: (resolve: any) => resolve({
          text: 'Hello world!',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
          toolCalls: [],
        }),
      }

      streamTextMock.mockResolvedValue(mockStream)

      const agent = provider.createAgent(createTestConfig())
      const streamResult = agent.stream({ prompt: 'Say hello' })

      const events: any[] = []
      for await (const event of streamResult) {
        events.push(event)
      }

      const textDeltas = events.filter((e) => e.type === 'text-delta')
      expect(textDeltas.length).toBeGreaterThan(0)
    })

    it('emits done event with final result', async () => {
      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: async function* () {
            yield 'Done'
          },
        },
        text: 'Done',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        then: (resolve: any) => resolve({
          text: 'Done',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
          toolCalls: [],
        }),
      }

      streamTextMock.mockResolvedValue(mockStream)

      const agent = provider.createAgent(createTestConfig())
      const streamResult = agent.stream({ prompt: 'Test' })

      const events: any[] = []
      for await (const event of streamResult) {
        events.push(event)
      }

      const doneEvent = events.find((e) => e.type === 'done')
      expect(doneEvent).toBeDefined()
      expect(doneEvent.data.finalResult).toBeDefined()
    })

    it('resolves text promise with complete text', async () => {
      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: async function* () {
            yield 'Complete text'
          },
        },
        text: 'Complete text',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        then: (resolve: any) => resolve({
          text: 'Complete text',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
          toolCalls: [],
        }),
      }

      streamTextMock.mockResolvedValue(mockStream)

      const agent = provider.createAgent(createTestConfig())
      const streamResult = agent.stream({ prompt: 'Test' })

      // Consume the stream
      for await (const _ of streamResult) {}

      const text = await streamResult.text
      expect(text).toBeTruthy()
    })
  })

  // ============================================================================
  // listModels Tests
  // ============================================================================

  describe('listModels()', () => {
    it('returns array of available models', async () => {
      const provider = new VercelProvider()
      const models = await provider.listModels()

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
    })

    it('includes gpt-4o', async () => {
      const provider = new VercelProvider()
      const models = await provider.listModels()
      expect(models).toContain('gpt-4o')
    })

    it('includes claude models', async () => {
      const provider = new VercelProvider()
      const models = await provider.listModels()
      expect(models.some((m) => m.startsWith('claude'))).toBe(true)
    })

    it('includes gemini models', async () => {
      const provider = new VercelProvider()
      const models = await provider.listModels()
      expect(models.some((m) => m.startsWith('gemini'))).toBe(true)
    })
  })

  // ============================================================================
  // createVercelProvider factory Tests
  // ============================================================================

  describe('createVercelProvider()', () => {
    it('creates VercelProvider instance', () => {
      const provider = createVercelProvider()
      expect(provider).toBeInstanceOf(VercelProvider)
    })

    it('passes options to constructor', () => {
      const provider = createVercelProvider({ defaultModel: 'gpt-4-turbo' })
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('gpt-4-turbo')
    })
  })
})
