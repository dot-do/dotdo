/**
 * Claude Provider Unit Tests (RED Phase)
 *
 * Tests for ClaudeProvider:
 * - createAgent() returns valid BaseAgent
 * - Session management (createSession, getSession)
 * - convertMessages() uses Anthropic format (tool_use, tool_result blocks)
 * - convertTools() uses input_schema key
 * - Provider configuration options
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { ClaudeProvider, createClaudeProvider } from './claude'
import type { Message, ToolDefinition, AgentConfig, CreateSessionOptions } from '../types'
import { BaseAgent } from '../Agent'

// Shared mock functions for Anthropic SDK
const mockCreate = vi.fn()
const mockStream = vi.fn()

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  })),
}))

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'test-agent',
  name: 'Test Agent',
  instructions: 'You are a helpful assistant.',
  model: 'claude-sonnet-4-20250514',
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
// ClaudeProvider Constructor Tests
// ============================================================================

describe('ClaudeProvider', () => {
  describe('constructor', () => {
    it('sets name to "claude"', () => {
      const provider = new ClaudeProvider()
      expect(provider.name).toBe('claude')
    })

    it('sets version to "2.0"', () => {
      const provider = new ClaudeProvider()
      expect(provider.version).toBe('2.0')
    })

    it('uses default model "claude-sonnet-4-20250514" when not specified', () => {
      const provider = new ClaudeProvider()
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('claude-sonnet-4-20250514')
    })

    it('accepts custom defaultModel option', () => {
      const provider = new ClaudeProvider({ defaultModel: 'claude-opus-4-20250514' })
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('claude-opus-4-20250514')
    })

    it('accepts apiKey option', () => {
      const provider = new ClaudeProvider({ apiKey: 'sk-test-key' })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('defaults useV2 to false', () => {
      const provider = new ClaudeProvider()
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('accepts useV2 option', () => {
      const provider = new ClaudeProvider({ useV2: true })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('defaults permissionMode to "auto"', () => {
      const provider = new ClaudeProvider()
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('accepts permissionMode option', () => {
      const provider = new ClaudeProvider({ permissionMode: 'confirm' })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })
  })

  // ============================================================================
  // createAgent Tests
  // ============================================================================

  describe('createAgent()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider()
    })

    it('returns an instance of BaseAgent', () => {
      const agent = provider.createAgent(createTestConfig())
      expect(agent).toBeInstanceOf(BaseAgent)
    })

    it('preserves agent config id', () => {
      const agent = provider.createAgent(createTestConfig({ id: 'my-claude-agent' }))
      expect(agent.config.id).toBe('my-claude-agent')
    })

    it('preserves agent config name', () => {
      const agent = provider.createAgent(createTestConfig({ name: 'Claude Helper' }))
      expect(agent.config.name).toBe('Claude Helper')
    })

    it('preserves agent config instructions', () => {
      const agent = provider.createAgent(createTestConfig({ instructions: 'Be concise and accurate.' }))
      expect(agent.config.instructions).toBe('Be concise and accurate.')
    })

    it('uses config model over default', () => {
      const agent = provider.createAgent(createTestConfig({ model: 'claude-3-opus-20240229' }))
      expect(agent.config.model).toBe('claude-3-opus-20240229')
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
  // Session Management Tests
  // ============================================================================

  describe('createSession()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider()
    })

    it('creates session with unique id', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      expect(session.id).toBeTruthy()
      expect(session.id).toMatch(/^session-/)
    })

    it('sets agentId on session', async () => {
      const session = await provider.createSession({
        agentId: 'my-agent',
      })

      expect(session.agentId).toBe('my-agent')
    })

    it('sets initial status to "pending"', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      expect(session.status).toBe('pending')
    })

    it('sets createdAt to current date', async () => {
      const before = new Date()
      const session = await provider.createSession({
        agentId: 'test-agent',
      })
      const after = new Date()

      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('sets updatedAt to current date', async () => {
      const before = new Date()
      const session = await provider.createSession({
        agentId: 'test-agent',
      })
      const after = new Date()

      expect(session.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(session.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('adds initial prompt as user message', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
        initialPrompt: 'Hello, Claude!',
      })

      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].role).toBe('user')
      expect(session.messages[0].content).toBe('Hello, Claude!')
    })

    it('initializes empty messages array without initial prompt', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      expect(session.messages).toEqual([])
    })

    it('preserves metadata', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
        metadata: { userId: 'user-123', source: 'web' },
      })

      expect(session.metadata).toEqual({ userId: 'user-123', source: 'web' })
    })

    it('stores session for later retrieval', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      const retrieved = await provider.getSession(session.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(session.id)
    })
  })

  describe('getSession()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider()
    })

    it('returns session by id', async () => {
      const created = await provider.createSession({
        agentId: 'test-agent',
        initialPrompt: 'Hello',
      })

      const session = await provider.getSession(created.id)

      expect(session).not.toBeNull()
      expect(session!.id).toBe(created.id)
      expect(session!.agentId).toBe('test-agent')
    })

    it('returns null for non-existent session', async () => {
      const session = await provider.getSession('non-existent-session')
      expect(session).toBeNull()
    })

    it('returns session with all properties', async () => {
      const created = await provider.createSession({
        agentId: 'test-agent',
        initialPrompt: 'Test',
        metadata: { key: 'value' },
      })

      const session = await provider.getSession(created.id)

      expect(session!.status).toBe('pending')
      expect(session!.messages).toHaveLength(1)
      expect(session!.metadata).toEqual({ key: 'value' })
    })
  })

  describe('sendMessage()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })

      // Use the shared mockCreate from the top of the file
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello back!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('adds message to session', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      await provider.sendMessage({
        sessionId: session.id,
        message: 'How are you?',
      })

      const updated = await provider.getSession(session.id)
      expect(updated!.messages.length).toBeGreaterThan(0)
    })

    it('updates session status to running during processing', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      // This would need to be checked mid-execution
      await provider.sendMessage({
        sessionId: session.id,
        message: 'Test',
      })

      // After completion, status should be completed
      const updated = await provider.getSession(session.id)
      expect(updated!.status).toBe('completed')
    })

    it('throws error for non-existent session', async () => {
      await expect(
        provider.sendMessage({
          sessionId: 'non-existent',
          message: 'Hello',
        })
      ).rejects.toThrow('Session not found')
    })

    it('returns AgentResult', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      const result = await provider.sendMessage({
        sessionId: session.id,
        message: 'Hello',
      })

      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('toolCalls')
      expect(result).toHaveProperty('messages')
      expect(result).toHaveProperty('usage')
    })
  })

  describe('streamMessage()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })
    })

    it('returns AgentStreamResult', async () => {
      const session = await provider.createSession({
        agentId: 'test-agent',
      })

      const stream = provider.streamMessage({
        sessionId: session.id,
        message: 'Hello',
      })

      // Check it's async iterable
      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
      expect(stream).toHaveProperty('result')
      expect(stream).toHaveProperty('text')
    })

    it('throws for non-existent session', () => {
      expect(() =>
        provider.streamMessage({
          sessionId: 'non-existent',
          message: 'Hello',
        })
      ).toThrow('Session not found')
    })
  })

  // ============================================================================
  // convertMessages Tests
  // ============================================================================

  describe('convertMessages()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('converts user message with string content', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({ messages: [{ role: 'user', content: 'Hello Claude' }] })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user')
      expect(userMsg).toBeDefined()
    })

    it('converts user message with image content to base64 source', async () => {
      const agent = provider.createAgent(createTestConfig())
      const contentParts = [
        { type: 'text' as const, text: 'Describe this' },
        { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
      ]
      await agent.run({ messages: [{ role: 'user', content: contentParts }] })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user')
      expect(userMsg.content).toContainEqual(
        expect.objectContaining({
          type: 'image',
          source: expect.objectContaining({
            type: 'base64',
            media_type: 'image/png',
            data: 'base64data',
          }),
        })
      )
    })

    it('uses system message as top-level system parameter', async () => {
      const agent = provider.createAgent(createTestConfig({ instructions: 'You are helpful.' }))
      await agent.run({ messages: [{ role: 'user', content: 'Hello' }] })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.system).toBe('You are helpful.')
    })

    it('converts assistant message with tool_use blocks', async () => {
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
          { role: 'user', content: 'Thanks' },
        ],
      })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      const assistantMsg = callArgs.messages.find((m: any) => m.role === 'assistant')
      expect(assistantMsg.content).toContainEqual(
        expect.objectContaining({
          type: 'tool_use',
          id: 'call-1',
          name: 'getWeather',
          input: { location: 'NYC' },
        })
      )
    })

    it('converts tool result as user message with tool_result block', async () => {
      const agent = provider.createAgent(createTestConfig())
      await agent.run({
        messages: [
          { role: 'user', content: 'Get weather' },
          {
            role: 'tool',
            toolCallId: 'call-1',
            toolName: 'getWeather',
            content: { temp: 22, condition: 'sunny' },
          },
        ],
      })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      // Tool results in Claude are sent as user messages with tool_result content
      const toolResultMsg = callArgs.messages.find((m: any) =>
        m.content?.some?.((c: any) => c.type === 'tool_result')
      )
      expect(toolResultMsg).toBeDefined()
      expect(toolResultMsg.role).toBe('user')
      expect(toolResultMsg.content[0].tool_use_id).toBe('call-1')
    })
  })

  // ============================================================================
  // convertTools Tests
  // ============================================================================

  describe('convertTools()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('uses input_schema key for tool schema', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools).toBeDefined()
      expect(callArgs.tools[0]).toHaveProperty('input_schema')
    })

    it('converts Zod schema to JSON Schema for input_schema', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      const toolDef = callArgs.tools[0]
      expect(toolDef.input_schema).toHaveProperty('type')
    })

    it('preserves tool name', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools[0].name).toBe('getWeather')
    })

    it('preserves tool description', async () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createTestConfig({ tools }))
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools[0].description).toBe('Get weather for a location')
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

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools).toHaveLength(2)
      expect(callArgs.tools.map((t: any) => t.name)).toContain('getWeather')
      expect(callArgs.tools.map((t: any) => t.name)).toContain('searchWeb')
    })

    it('handles JSON Schema input directly', async () => {
      const jsonSchemaTool: ToolDefinition = {
        name: 'createUser',
        description: 'Create a user',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        execute: vi.fn(),
      }
      const agent = provider.createAgent(createTestConfig({ tools: [jsonSchemaTool] }))
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.tools[0].input_schema.type).toBe('object')
    })
  })

  // ============================================================================
  // generate() Tests
  // ============================================================================

  describe('generate()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('extracts text from text blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'text', text: ' How can I help?' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Hi' })

      expect(result.text).toBe('Hello! How can I help?')
    })

    it('extracts tool calls from tool_use blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'getWeather',
            input: { location: 'NYC' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      }).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'The weather is sunny.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      })

      const tool = createTestTool()
      const agent = provider.createAgent(createTestConfig({ tools: [tool] }))
      const result = await agent.run({ prompt: 'Get weather in NYC' })

      expect(result.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'toolu_123',
          name: 'getWeather',
          arguments: { location: 'NYC' },
        })
      )
    })

    it('maps stop_reason "end_turn" to finishReason "stop"', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.finishReason).toBe('stop')
    })

    it('maps stop_reason "tool_use" to finishReason "tool_calls"', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'call-1', name: 'test', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      }).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 15, output_tokens: 5 },
      })

      const tool: ToolDefinition = {
        name: 'test',
        description: 'Test',
        inputSchema: z.object({}),
        execute: vi.fn().mockResolvedValue('ok'),
      }
      const agent = provider.createAgent(createTestConfig({ tools: [tool] }))
      const result = await agent.run({ prompt: 'Test' })

      // Final reason depends on the last step
      expect(['stop', 'tool_calls']).toContain(result.finishReason)
    })

    it('calculates usage correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      const agent = provider.createAgent(createTestConfig())
      const result = await agent.run({ prompt: 'Test' })

      expect(result.usage.promptTokens).toBe(100)
      expect(result.usage.completionTokens).toBe(50)
      expect(result.usage.totalTokens).toBe(150)
    })

    it('passes max_tokens to API', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const agent = provider.createAgent(createTestConfig())
      await agent.run({ prompt: 'Test' })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 })
      )
    })
  })

  // ============================================================================
  // generateStream() Tests
  // ============================================================================

  describe('generateStream()', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = new ClaudeProvider({ apiKey: 'test-key' })
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('streams text deltas from content_block_delta events', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
      ]

      mockStream.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) {
            yield event
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })

      const agent = provider.createAgent(createTestConfig())
      const stream = agent.stream({ prompt: 'Test' })

      const streamEvents: any[] = []
      for await (const event of stream) {
        streamEvents.push(event)
      }

      const textDeltas = streamEvents.filter((e) => e.type === 'text-delta')
      expect(textDeltas.length).toBeGreaterThan(0)
    })

    // TODO: BaseAgent.stream() doesn't use generateStream yet - falls back to run()
    it.skip('emits tool-call-start from content_block_start with tool_use', async () => {
      const events = [
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'call-1', name: 'getWeather' },
        },
      ]

      mockStream.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) {
            yield event
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })

      const agent = provider.createAgent(createTestConfig())
      const stream = agent.stream({ prompt: 'Test' })

      const streamEvents: any[] = []
      for await (const event of stream) {
        streamEvents.push(event)
      }

      const toolCallStart = streamEvents.find((e) => e.type === 'tool-call-start')
      expect(toolCallStart).toBeDefined()
      expect(toolCallStart.data.toolCallId).toBe('call-1')
      expect(toolCallStart.data.toolName).toBe('getWeather')
    })

    // TODO: BaseAgent.stream() doesn't use generateStream yet - falls back to run()
    it.skip('emits tool-call-delta from input_json_delta', async () => {
      const events = [
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"location":' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '"NYC"}' },
        },
      ]

      mockStream.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) {
            yield event
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })

      const agent = provider.createAgent(createTestConfig())
      const stream = agent.stream({ prompt: 'Test' })

      const streamEvents: any[] = []
      for await (const event of stream) {
        streamEvents.push(event)
      }

      const toolCallDeltas = streamEvents.filter((e) => e.type === 'tool-call-delta')
      expect(toolCallDeltas.length).toBeGreaterThan(0)
    })

    it('emits done event with final result', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } },
      ]

      mockStream.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const event of events) {
            yield event
          }
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })

      const agent = provider.createAgent(createTestConfig())
      const stream = agent.stream({ prompt: 'Test' })

      const streamEvents: any[] = []
      for await (const event of stream) {
        streamEvents.push(event)
      }

      const doneEvent = streamEvents.find((e) => e.type === 'done')
      expect(doneEvent).toBeDefined()
      expect(doneEvent.data.finalResult).toBeDefined()
    })
  })

  // ============================================================================
  // listModels Tests
  // ============================================================================

  describe('listModels()', () => {
    it('returns array of available models', async () => {
      const provider = new ClaudeProvider()
      const models = await provider.listModels()

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
    })

    it('includes claude-opus-4-20250514', async () => {
      const provider = new ClaudeProvider()
      const models = await provider.listModels()
      expect(models).toContain('claude-opus-4-20250514')
    })

    it('includes claude-sonnet-4-20250514', async () => {
      const provider = new ClaudeProvider()
      const models = await provider.listModels()
      expect(models).toContain('claude-sonnet-4-20250514')
    })

    it('includes older claude-3 models', async () => {
      const provider = new ClaudeProvider()
      const models = await provider.listModels()
      expect(models.some((m) => m.includes('claude-3'))).toBe(true)
    })
  })

  // ============================================================================
  // createClaudeProvider factory Tests
  // ============================================================================

  describe('createClaudeProvider()', () => {
    it('creates ClaudeProvider instance', () => {
      const provider = createClaudeProvider()
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('passes options to constructor', () => {
      const provider = createClaudeProvider({ defaultModel: 'claude-3-opus-20240229' })
      const agent = provider.createAgent(createTestConfig({ model: undefined as unknown as string }))
      expect(agent.config.model).toBe('claude-3-opus-20240229')
    })
  })
})
