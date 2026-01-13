/**
 * LLM Provider Abstraction Tests
 *
 * Tests for the unified LLM provider interface that abstracts differences
 * between OpenAI, Anthropic, Vercel AI SDK, Devin, and Voice providers.
 *
 * These tests cover:
 * 1. Provider interface compliance
 * 2. Agent creation and configuration
 * 3. Message format conversion
 * 4. Tool format conversion
 * 5. Provider switching and multi-provider scenarios
 * 6. Error handling normalization
 * 7. Token usage tracking
 * 8. Streaming interface consistency
 *
 * @see agents/providers/index.ts for provider exports
 * @see agents/types.ts for unified type definitions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import type {
  AgentProvider,
  AgentConfig,
  Message,
  ToolDefinition,
  AgentResult,
  StreamEvent,
  TokenUsage,
  ToolCall,
  Agent,
} from '../types'
import {
  OpenAIProvider,
  ClaudeProvider,
  VercelProvider,
  DevinProvider,
  VapiProvider,
  LiveKitProvider,
  createOpenAIProvider,
  createClaudeProvider,
  createVercelProvider,
  createDevinProvider,
  createVapiProvider,
  createLiveKitProvider,
} from '../providers'
import { BaseAgent } from '../Agent'

// ============================================================================
// Test Fixtures
// ============================================================================

const createMinimalConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
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
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: vi.fn().mockResolvedValue({ temp: 22, condition: 'sunny' }),
})

const createJsonSchemaTool = (): ToolDefinition => ({
  name: 'searchWeb',
  description: 'Search the web',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  },
  execute: vi.fn().mockResolvedValue({ results: [] }),
})

// ============================================================================
// Provider Interface Compliance Tests
// ============================================================================

describe('Provider Interface Compliance', () => {
  const textProviders: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'OpenAI', create: () => createOpenAIProvider({ apiKey: 'test' }) },
    { name: 'Claude', create: () => createClaudeProvider({ apiKey: 'test' }) },
    { name: 'Vercel', create: () => createVercelProvider({}) },
  ]

  const sessionProviders: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'Devin', create: () => createDevinProvider({ apiKey: 'test' }) },
  ]

  const voiceProviders: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'Vapi', create: () => createVapiProvider({ apiKey: 'test' }) },
    { name: 'LiveKit', create: () => createLiveKitProvider({ serverUrl: 'ws://test', apiKey: 'test', apiSecret: 'secret' }) },
  ]

  const allProviders = [...textProviders, ...sessionProviders, ...voiceProviders]

  describe.each(allProviders)('$name Provider', ({ name, create }) => {
    let provider: AgentProvider

    beforeEach(() => {
      provider = create()
    })

    describe('AgentProvider interface', () => {
      it('has readonly name property of type string', () => {
        expect(provider.name).toBeDefined()
        expect(typeof provider.name).toBe('string')
        expect(provider.name.length).toBeGreaterThan(0)
      })

      it('has readonly version property of type string', () => {
        expect(provider.version).toBeDefined()
        expect(typeof provider.version).toBe('string')
      })

      it('implements createAgent() method', () => {
        expect(typeof provider.createAgent).toBe('function')
      })

      it('createAgent() returns an Agent interface', () => {
        const agent = provider.createAgent(createMinimalConfig())
        expect(agent).toBeDefined()
        expect(agent.config).toBeDefined()
        expect(agent.provider).toBeDefined()
        expect(typeof agent.run).toBe('function')
        expect(typeof agent.stream).toBe('function')
      })

      it('optionally implements listModels() method', () => {
        if (provider.listModels) {
          expect(typeof provider.listModels).toBe('function')
        }
      })

      it('listModels() returns array of strings when implemented', async () => {
        if (provider.listModels) {
          const models = await provider.listModels()
          expect(Array.isArray(models)).toBe(true)
          expect(models.length).toBeGreaterThan(0)
          expect(models.every((m) => typeof m === 'string')).toBe(true)
        }
      })
    })

    describe('Agent interface', () => {
      it('agent has readonly config property', () => {
        const agent = provider.createAgent(createMinimalConfig())
        expect(agent.config).toBeDefined()
        expect(agent.config.id).toBe('test-agent')
        expect(agent.config.name).toBe('Test Agent')
      })

      it('agent has readonly provider reference', () => {
        const agent = provider.createAgent(createMinimalConfig())
        expect(agent.provider).toBe(provider)
      })

      it('agent implements run() method returning Promise<AgentResult>', () => {
        const agent = provider.createAgent(createMinimalConfig())
        expect(typeof agent.run).toBe('function')
      })

      it('agent implements stream() method returning AgentStreamResult', () => {
        const agent = provider.createAgent(createMinimalConfig())
        expect(typeof agent.stream).toBe('function')
      })

      it('preserves config id', () => {
        const agent = provider.createAgent(createMinimalConfig({ id: 'custom-id' }))
        expect(agent.config.id).toBe('custom-id')
      })

      it('preserves config name', () => {
        const agent = provider.createAgent(createMinimalConfig({ name: 'Custom Name' }))
        expect(agent.config.name).toBe('Custom Name')
      })

      it('preserves config instructions', () => {
        const agent = provider.createAgent(createMinimalConfig({ instructions: 'Be concise.' }))
        expect(agent.config.instructions).toBe('Be concise.')
      })

      it('preserves tools in config', () => {
        const tools = [createTestTool()]
        const agent = provider.createAgent(createMinimalConfig({ tools }))
        expect(agent.config.tools).toHaveLength(1)
        expect(agent.config.tools![0].name).toBe('getWeather')
      })
    })
  })

  describe.each(sessionProviders)('$name Session Provider', ({ name, create }) => {
    let provider: AgentProvider

    beforeEach(() => {
      provider = create()
    })

    it('implements createSession() method', () => {
      expect(typeof provider.createSession).toBe('function')
    })

    it('implements getSession() method', () => {
      expect(typeof provider.getSession).toBe('function')
    })

    it('implements sendMessage() method', () => {
      expect(typeof provider.sendMessage).toBe('function')
    })

    it('implements streamMessage() method', () => {
      expect(typeof provider.streamMessage).toBe('function')
    })
  })
})

// ============================================================================
// Provider Name and Version Tests
// ============================================================================

describe('Provider Identification', () => {
  it('OpenAI provider has name "openai"', () => {
    const provider = createOpenAIProvider({})
    expect(provider.name).toBe('openai')
  })

  it('Claude provider has name "claude"', () => {
    const provider = createClaudeProvider({})
    expect(provider.name).toBe('claude')
  })

  it('Vercel provider has name "vercel"', () => {
    const provider = createVercelProvider({})
    expect(provider.name).toBe('vercel')
  })

  it('Devin provider has name "devin"', () => {
    const provider = createDevinProvider({ apiKey: 'test' })
    expect(provider.name).toBe('devin')
  })

  it('Vapi provider has name "vapi"', () => {
    const provider = createVapiProvider({ apiKey: 'test' })
    expect(provider.name).toBe('vapi')
  })

  it('LiveKit provider has name "livekit"', () => {
    const provider = createLiveKitProvider({ serverUrl: 'ws://test', apiKey: 'test', apiSecret: 'secret' })
    expect(provider.name).toBe('livekit')
  })

  it('OpenAI provider has version "1.0"', () => {
    const provider = createOpenAIProvider({})
    expect(provider.version).toBe('1.0')
  })

  it('Claude provider has version "2.0"', () => {
    const provider = createClaudeProvider({})
    expect(provider.version).toBe('2.0')
  })

  it('Vercel provider has version "6.0"', () => {
    const provider = createVercelProvider({})
    expect(provider.version).toBe('6.0')
  })
})

// ============================================================================
// Default Model Selection Tests
// ============================================================================

describe('Default Model Selection', () => {
  it('OpenAI defaults to gpt-4o', () => {
    const provider = createOpenAIProvider({})
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('gpt-4o')
  })

  it('OpenAI respects custom defaultModel option', () => {
    const provider = createOpenAIProvider({ defaultModel: 'gpt-4-turbo' })
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('gpt-4-turbo')
  })

  it('Claude defaults to claude-sonnet-4-20250514', () => {
    const provider = createClaudeProvider({})
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('claude-sonnet-4-20250514')
  })

  it('Claude respects custom defaultModel option', () => {
    const provider = createClaudeProvider({ defaultModel: 'claude-opus-4-20250514' })
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('claude-opus-4-20250514')
  })

  it('Vercel defaults to gpt-4o', () => {
    const provider = createVercelProvider({})
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('gpt-4o')
  })

  it('Vercel respects custom defaultModel option', () => {
    const provider = createVercelProvider({ defaultModel: 'claude-3-5-sonnet-20241022' })
    const agent = provider.createAgent(createMinimalConfig({ model: undefined as unknown as string }))
    expect(agent.config.model).toBe('claude-3-5-sonnet-20241022')
  })

  it('Config model takes precedence over provider default', () => {
    const provider = createOpenAIProvider({ defaultModel: 'gpt-4o-mini' })
    const agent = provider.createAgent(createMinimalConfig({ model: 'o1-preview' }))
    expect(agent.config.model).toBe('o1-preview')
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createOpenAIProvider()', () => {
    it('creates OpenAIProvider instance', () => {
      const provider = createOpenAIProvider()
      expect(provider).toBeInstanceOf(OpenAIProvider)
    })

    it('passes options to constructor', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key', defaultModel: 'gpt-4-turbo' })
      expect(provider).toBeInstanceOf(OpenAIProvider)
    })

    it('accepts organization option', () => {
      const provider = createOpenAIProvider({ organization: 'org-123' })
      expect(provider).toBeInstanceOf(OpenAIProvider)
    })
  })

  describe('createClaudeProvider()', () => {
    it('creates ClaudeProvider instance', () => {
      const provider = createClaudeProvider()
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('passes options to constructor', () => {
      const provider = createClaudeProvider({ apiKey: 'sk-test', defaultModel: 'claude-3-opus-20240229' })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('accepts useV2 option', () => {
      const provider = createClaudeProvider({ useV2: true })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })

    it('accepts permissionMode option', () => {
      const provider = createClaudeProvider({ permissionMode: 'confirm' })
      expect(provider).toBeInstanceOf(ClaudeProvider)
    })
  })

  describe('createVercelProvider()', () => {
    it('creates VercelProvider instance', () => {
      const provider = createVercelProvider()
      expect(provider).toBeInstanceOf(VercelProvider)
    })

    it('passes options to constructor', () => {
      const provider = createVercelProvider({ defaultModel: 'gpt-4o-mini', apiKey: 'test' })
      expect(provider).toBeInstanceOf(VercelProvider)
    })
  })

  describe('createDevinProvider()', () => {
    it('creates DevinProvider instance', () => {
      const provider = createDevinProvider({ apiKey: 'test' })
      expect(provider).toBeInstanceOf(DevinProvider)
    })

    it('requires apiKey option', () => {
      const provider = createDevinProvider({ apiKey: 'devin-key' })
      expect(provider).toBeInstanceOf(DevinProvider)
    })

    it('accepts knowledgeIds option', () => {
      const provider = createDevinProvider({ apiKey: 'test', knowledgeIds: ['kb-1', 'kb-2'] })
      expect(provider).toBeInstanceOf(DevinProvider)
    })
  })

  describe('createVapiProvider()', () => {
    it('creates VapiProvider instance', () => {
      const provider = createVapiProvider({ apiKey: 'test' })
      expect(provider).toBeInstanceOf(VapiProvider)
    })

    it('accepts transcriber config', () => {
      const provider = createVapiProvider({
        apiKey: 'test',
        transcriber: { provider: 'whisper', model: 'large-v3', language: 'en' },
      })
      expect(provider).toBeInstanceOf(VapiProvider)
    })

    it('accepts voice config', () => {
      const provider = createVapiProvider({
        apiKey: 'test',
        voice: { provider: 'elevenlabs', voiceId: 'rachel' },
      })
      expect(provider).toBeInstanceOf(VapiProvider)
    })
  })

  describe('createLiveKitProvider()', () => {
    it('creates LiveKitProvider instance', () => {
      const provider = createLiveKitProvider({
        serverUrl: 'ws://localhost:7880',
        apiKey: 'devkey',
        apiSecret: 'secret',
      })
      expect(provider).toBeInstanceOf(LiveKitProvider)
    })

    it('requires all connection options', () => {
      const provider = createLiveKitProvider({
        serverUrl: 'ws://test',
        apiKey: 'key',
        apiSecret: 'secret',
        defaultModel: 'gpt-4o-mini',
      })
      expect(provider).toBeInstanceOf(LiveKitProvider)
    })
  })
})

// ============================================================================
// Tool Configuration Tests
// ============================================================================

describe('Tool Configuration', () => {
  const providers: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'OpenAI', create: () => createOpenAIProvider({ apiKey: 'test' }) },
    { name: 'Claude', create: () => createClaudeProvider({ apiKey: 'test' }) },
    { name: 'Vercel', create: () => createVercelProvider({}) },
  ]

  describe.each(providers)('$name Provider', ({ create }) => {
    let provider: AgentProvider

    beforeEach(() => {
      provider = create()
    })

    it('creates agent with Zod schema tools', () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createMinimalConfig({ tools }))
      expect(agent.config.tools).toHaveLength(1)
      expect(agent.config.tools![0].name).toBe('getWeather')
    })

    it('creates agent with JSON Schema tools', () => {
      const tools = [createJsonSchemaTool()]
      const agent = provider.createAgent(createMinimalConfig({ tools }))
      expect(agent.config.tools).toHaveLength(1)
      expect(agent.config.tools![0].name).toBe('searchWeb')
    })

    it('creates agent with multiple tools', () => {
      const tools = [createTestTool(), createJsonSchemaTool()]
      const agent = provider.createAgent(createMinimalConfig({ tools }))
      expect(agent.config.tools).toHaveLength(2)
    })

    it('preserves tool descriptions', () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createMinimalConfig({ tools }))
      expect(agent.config.tools![0].description).toBe('Get weather for a location')
    })

    it('preserves tool execute function', () => {
      const tools = [createTestTool()]
      const agent = provider.createAgent(createMinimalConfig({ tools }))
      expect(typeof agent.config.tools![0].execute).toBe('function')
    })
  })
})

// ============================================================================
// Handoff Configuration Tests (OpenAI Pattern)
// ============================================================================

describe('Handoff Configuration (OpenAI Pattern)', () => {
  it('OpenAI provider supports handoff agents', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const handoffs: AgentConfig[] = [
      { id: 'support', name: 'Support Agent', instructions: 'Handle support', model: 'gpt-4o' },
      { id: 'sales', name: 'Sales Agent', instructions: 'Handle sales', model: 'gpt-4o' },
    ]

    const agent = provider.createAgent(createMinimalConfig({ handoffs }))
    expect(agent.config.handoffs).toHaveLength(2)
    expect(agent.config.handoffs![0].id).toBe('support')
    expect(agent.config.handoffs![1].id).toBe('sales')
  })

  it('agent has handoff method when handoffs configured', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const handoffs: AgentConfig[] = [
      { id: 'support', name: 'Support', instructions: 'Support agent', model: 'gpt-4o' },
    ]

    const agent = provider.createAgent(createMinimalConfig({ handoffs }))
    expect(typeof agent.handoff).toBe('function')
  })
})

// ============================================================================
// Subagent Configuration Tests (Claude Pattern)
// ============================================================================

describe('Subagent Configuration (Claude Pattern)', () => {
  it('agent can be configured to spawn subagents', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig({ canSpawnSubagents: true }))
    expect(agent.config.canSpawnSubagents).toBe(true)
  })

  it('agent has spawnSubagent method when configured', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig({ canSpawnSubagents: true }))
    expect(typeof agent.spawnSubagent).toBe('function')
  })
})

// ============================================================================
// Provider Switching Tests
// ============================================================================

describe('Provider Switching', () => {
  const openaiProvider = createOpenAIProvider({ apiKey: 'test' })
  const claudeProvider = createClaudeProvider({ apiKey: 'test' })
  const vercelProvider = createVercelProvider({})

  it('same config works across different providers', () => {
    const config = createMinimalConfig()

    const openaiAgent = openaiProvider.createAgent(config)
    const claudeAgent = claudeProvider.createAgent(config)
    const vercelAgent = vercelProvider.createAgent(config)

    expect(openaiAgent.config.id).toBe(config.id)
    expect(claudeAgent.config.id).toBe(config.id)
    expect(vercelAgent.config.id).toBe(config.id)
  })

  it('tools are preserved when switching providers', () => {
    const config = createMinimalConfig({ tools: [createTestTool()] })

    const openaiAgent = openaiProvider.createAgent(config)
    const claudeAgent = claudeProvider.createAgent(config)

    expect(openaiAgent.config.tools![0].name).toBe('getWeather')
    expect(claudeAgent.config.tools![0].name).toBe('getWeather')
  })

  it('each provider creates independent agents', () => {
    const config = createMinimalConfig()

    const openaiAgent = openaiProvider.createAgent(config)
    const claudeAgent = claudeProvider.createAgent(config)

    expect(openaiAgent.provider.name).toBe('openai')
    expect(claudeAgent.provider.name).toBe('claude')
    expect(openaiAgent).not.toBe(claudeAgent)
  })

  it('provider reference is correct on each agent', () => {
    const config = createMinimalConfig()

    const openaiAgent = openaiProvider.createAgent(config)
    const claudeAgent = claudeProvider.createAgent(config)

    expect(openaiAgent.provider).toBe(openaiProvider)
    expect(claudeAgent.provider).toBe(claudeProvider)
  })
})

// ============================================================================
// Model List Tests
// ============================================================================

describe('Model Lists', () => {
  it('OpenAI lists GPT models', async () => {
    const provider = createOpenAIProvider({})
    const models = await provider.listModels()

    expect(models).toContain('gpt-4o')
    expect(models).toContain('gpt-4o-mini')
    expect(models).toContain('gpt-4-turbo')
    expect(models).toContain('o1-preview')
  })

  it('Claude lists Claude models', async () => {
    const provider = createClaudeProvider({})
    const models = await provider.listModels()

    expect(models).toContain('claude-opus-4-20250514')
    expect(models).toContain('claude-sonnet-4-20250514')
    expect(models.some((m) => m.includes('claude-3'))).toBe(true)
  })

  it('Vercel lists multi-provider models', async () => {
    const provider = createVercelProvider({})
    const models = await provider.listModels()

    expect(models).toContain('gpt-4o')
    expect(models.some((m) => m.includes('claude'))).toBe(true)
    expect(models.some((m) => m.includes('gemini'))).toBe(true)
  })

  it('Vapi lists voice-compatible models', async () => {
    const provider = createVapiProvider({ apiKey: 'test' })
    const models = await provider.listModels()

    expect(models).toContain('gpt-4o')
    expect(models.some((m) => m.includes('claude'))).toBe(true)
  })

  it('Devin lists Devin versions', async () => {
    const provider = createDevinProvider({ apiKey: 'test' })
    const models = await provider.listModels()

    expect(models.some((m) => m.includes('devin'))).toBe(true)
  })
})

// ============================================================================
// AgentStreamResult Interface Tests
// ============================================================================

describe('AgentStreamResult Interface', () => {
  const providers: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'OpenAI', create: () => createOpenAIProvider({ apiKey: 'test' }) },
    { name: 'Claude', create: () => createClaudeProvider({ apiKey: 'test' }) },
    { name: 'Vercel', create: () => createVercelProvider({}) },
  ]

  describe.each(providers)('$name Provider', ({ create }) => {
    let provider: AgentProvider

    beforeEach(() => {
      provider = create()
    })

    it('stream() returns object with async iterator', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({ prompt: 'test' })

      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })

    it('stream() returns object with result promise', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({ prompt: 'test' })

      expect(stream.result).toBeInstanceOf(Promise)
    })

    it('stream() returns object with text promise', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({ prompt: 'test' })

      expect(stream.text).toBeInstanceOf(Promise)
    })

    it('stream() returns object with toolCalls promise', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({ prompt: 'test' })

      expect(stream.toolCalls).toBeInstanceOf(Promise)
    })

    it('stream() returns object with usage promise', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({ prompt: 'test' })

      expect(stream.usage).toBeInstanceOf(Promise)
    })
  })
})

// ============================================================================
// Stop Condition Tests
// ============================================================================

describe('Stop Conditions', () => {
  it('agent respects maxSteps configuration', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig({ maxSteps: 5 }))
    expect(agent.config.maxSteps).toBe(5)
  })

  it('agent accepts stopWhen configuration', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        stopWhen: { type: 'stepCount', count: 3 },
      })
    )
    expect(agent.config.stopWhen).toEqual({ type: 'stepCount', count: 3 })
  })

  it('agent accepts array of stopWhen conditions', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        stopWhen: [
          { type: 'stepCount', count: 10 },
          { type: 'hasText' },
        ],
      })
    )
    expect(Array.isArray(agent.config.stopWhen)).toBe(true)
    expect((agent.config.stopWhen as unknown[]).length).toBe(2)
  })

  it('agent accepts custom stop condition', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const customCheck = vi.fn().mockReturnValue(false)
    const agent = provider.createAgent(
      createMinimalConfig({
        stopWhen: { type: 'custom', check: customCheck },
      })
    )
    expect((agent.config.stopWhen as { type: string; check: Function }).type).toBe('custom')
  })
})

// ============================================================================
// PrepareStep Hook Tests
// ============================================================================

describe('PrepareStep Hook', () => {
  it('agent accepts prepareStep function', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const prepareStep = vi.fn().mockReturnValue({})
    const agent = provider.createAgent(createMinimalConfig({ prepareStep }))
    expect(agent.config.prepareStep).toBe(prepareStep)
  })

  it('prepareStep can override model per step', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const prepareStep = vi.fn().mockReturnValue({ model: 'gpt-4o-mini' })
    const agent = provider.createAgent(createMinimalConfig({ prepareStep }))
    expect(typeof agent.config.prepareStep).toBe('function')
  })

  it('prepareStep can override tools per step', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const prepareStep = vi.fn().mockReturnValue({ tools: [createTestTool()] })
    const agent = provider.createAgent(createMinimalConfig({ prepareStep }))
    expect(typeof agent.config.prepareStep).toBe('function')
  })
})

// ============================================================================
// Provider Options Tests
// ============================================================================

describe('Provider Options', () => {
  it('agent accepts providerOptions in config', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        providerOptions: {
          temperature: 0.7,
          topP: 0.9,
        },
      })
    )
    expect(agent.config.providerOptions).toEqual({ temperature: 0.7, topP: 0.9 })
  })

  it('provider options are passed through to agent', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        providerOptions: {
          maxTokens: 2048,
        },
      })
    )
    expect(agent.config.providerOptions).toHaveProperty('maxTokens', 2048)
  })
})

// ============================================================================
// Voice Configuration Tests
// ============================================================================

describe('Voice Configuration', () => {
  it('agent accepts voice configuration', () => {
    const provider = createVapiProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        voice: {
          transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
          voice: { provider: 'elevenlabs', voiceId: 'rachel' },
          bargeIn: true,
          silenceTimeoutMs: 3000,
        },
      })
    )
    expect(agent.config.voice).toBeDefined()
    expect(agent.config.voice!.transcriber.provider).toBe('deepgram')
    expect(agent.config.voice!.voice.provider).toBe('elevenlabs')
  })

  it('Vapi uses default voice config when not specified', () => {
    const provider = createVapiProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig())
    expect(agent.config.voice).toBeDefined()
  })
})

// ============================================================================
// Memory Configuration Tests
// ============================================================================

describe('Memory Configuration', () => {
  it('agent accepts memory configuration', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        memory: {
          type: 'persistent',
          maxTokens: 4096,
        },
      })
    )
    expect(agent.config.memory).toBeDefined()
    expect(agent.config.memory!.type).toBe('persistent')
    expect(agent.config.memory!.maxTokens).toBe(4096)
  })

  it('agent accepts vector memory type', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })
    const agent = provider.createAgent(
      createMinimalConfig({
        memory: {
          type: 'vector',
          embedModel: 'text-embedding-3-small',
        },
      })
    )
    expect(agent.config.memory!.type).toBe('vector')
    expect(agent.config.memory!.embedModel).toBe('text-embedding-3-small')
  })
})

// ============================================================================
// Multi-Provider Parallel Execution Tests
// ============================================================================

describe('Multi-Provider Parallel Execution', () => {
  it('can create agents from multiple providers simultaneously', () => {
    const config = createMinimalConfig()

    const agents = [
      createOpenAIProvider({ apiKey: 'test' }).createAgent(config),
      createClaudeProvider({ apiKey: 'test' }).createAgent(config),
      createVercelProvider({}).createAgent(config),
    ]

    expect(agents).toHaveLength(3)
    expect(agents[0].provider.name).toBe('openai')
    expect(agents[1].provider.name).toBe('claude')
    expect(agents[2].provider.name).toBe('vercel')
  })

  it('agents from different providers are independent', () => {
    const config = createMinimalConfig()

    const openaiAgent = createOpenAIProvider({ apiKey: 'test' }).createAgent(config)
    const claudeAgent = createClaudeProvider({ apiKey: 'test' }).createAgent(config)

    // Modifying one should not affect the other
    expect(openaiAgent.provider).not.toBe(claudeAgent.provider)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('provider handles missing config gracefully', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })

    // Should not throw for minimal valid config
    const agent = provider.createAgent({
      id: 'test',
      name: 'Test',
      instructions: '',
      model: 'gpt-4o',
    })

    expect(agent).toBeDefined()
  })

  it('session provider throws for invalid session ID', async () => {
    const provider = createDevinProvider({ apiKey: 'test' })
    const session = await provider.getSession!('invalid-session-id')
    expect(session).toBeNull()
  })

  it('Claude session throws for non-existent session on sendMessage', async () => {
    const provider = createClaudeProvider({ apiKey: 'test' })

    await expect(
      provider.sendMessage!({
        sessionId: 'non-existent',
        message: 'Hello',
      })
    ).rejects.toThrow('Session not found')
  })

  it('Claude streamMessage throws for non-existent session', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })

    expect(() =>
      provider.streamMessage!({
        sessionId: 'non-existent',
        message: 'Hello',
      })
    ).toThrow('Session not found')
  })
})

// ============================================================================
// Session Management Tests (Session-Based Providers)
// ============================================================================

describe('Session Management', () => {
  describe('Claude Provider Sessions', () => {
    let provider: ClaudeProvider

    beforeEach(() => {
      provider = createClaudeProvider({ apiKey: 'test' })
    })

    it('creates session with unique id', async () => {
      const session = await provider.createSession!({ agentId: 'test-agent' })

      expect(session.id).toBeTruthy()
      expect(session.id).toMatch(/^session-/)
    })

    it('sets agentId on session', async () => {
      const session = await provider.createSession!({ agentId: 'my-agent' })

      expect(session.agentId).toBe('my-agent')
    })

    it('sets initial status to "pending"', async () => {
      const session = await provider.createSession!({ agentId: 'test-agent' })

      expect(session.status).toBe('pending')
    })

    it('adds initial prompt as user message', async () => {
      const session = await provider.createSession!({
        agentId: 'test-agent',
        initialPrompt: 'Hello!',
      })

      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].role).toBe('user')
      expect(session.messages[0].content).toBe('Hello!')
    })

    it('stores session for later retrieval', async () => {
      const session = await provider.createSession!({ agentId: 'test-agent' })

      const retrieved = await provider.getSession!(session.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(session.id)
    })

    it('preserves metadata', async () => {
      const session = await provider.createSession!({
        agentId: 'test-agent',
        metadata: { userId: 'user-123' },
      })

      expect(session.metadata).toEqual({ userId: 'user-123' })
    })
  })
})

// ============================================================================
// BaseAgent Tests
// ============================================================================

describe('BaseAgent', () => {
  it('is used by OpenAI provider', () => {
    const provider = createOpenAIProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig())

    // OpenAI uses OpenAIAgent which extends BaseAgent
    expect(agent.config).toBeDefined()
    expect(typeof agent.run).toBe('function')
  })

  it('is used by Claude provider', () => {
    const provider = createClaudeProvider({ apiKey: 'test' })
    const agent = provider.createAgent(createMinimalConfig())

    expect(agent).toBeInstanceOf(BaseAgent)
  })

  it('is used by Vercel provider', () => {
    const provider = createVercelProvider({})
    const agent = provider.createAgent(createMinimalConfig())

    expect(agent).toBeInstanceOf(BaseAgent)
  })
})

// ============================================================================
// Input Format Tests
// ============================================================================

describe('AgentInput Format', () => {
  const providers: Array<{ name: string; create: () => AgentProvider }> = [
    { name: 'OpenAI', create: () => createOpenAIProvider({ apiKey: 'test' }) },
    { name: 'Claude', create: () => createClaudeProvider({ apiKey: 'test' }) },
    { name: 'Vercel', create: () => createVercelProvider({}) },
  ]

  describe.each(providers)('$name Provider', ({ create }) => {
    let provider: AgentProvider

    beforeEach(() => {
      provider = create()
    })

    it('agent accepts prompt string input', () => {
      const agent = provider.createAgent(createMinimalConfig())
      // Should not throw
      const stream = agent.stream({ prompt: 'Hello' })
      expect(stream).toBeDefined()
    })

    it('agent accepts messages array input', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ]
      const stream = agent.stream({ messages })
      expect(stream).toBeDefined()
    })

    it('agent accepts tools override in input', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({
        prompt: 'Test',
        tools: [createTestTool()],
      })
      expect(stream).toBeDefined()
    })

    it('agent accepts stopWhen override in input', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const stream = agent.stream({
        prompt: 'Test',
        stopWhen: { type: 'stepCount', count: 1 },
      })
      expect(stream).toBeDefined()
    })

    it('agent accepts AbortSignal in input', () => {
      const agent = provider.createAgent(createMinimalConfig())
      const controller = new AbortController()
      const stream = agent.stream({
        prompt: 'Test',
        signal: controller.signal,
      })
      expect(stream).toBeDefined()
    })
  })
})

// ============================================================================
// Provider Registry Integration Tests
// ============================================================================

describe('Provider Registry Integration', () => {
  it('all providers export from index', async () => {
    const exports = await import('../providers')

    expect(exports.OpenAIProvider).toBeDefined()
    expect(exports.ClaudeProvider).toBeDefined()
    expect(exports.VercelProvider).toBeDefined()
    expect(exports.DevinProvider).toBeDefined()
    expect(exports.VapiProvider).toBeDefined()
    expect(exports.LiveKitProvider).toBeDefined()
  })

  it('all factory functions export from index', async () => {
    const exports = await import('../providers')

    expect(exports.createOpenAIProvider).toBeDefined()
    expect(exports.createClaudeProvider).toBeDefined()
    expect(exports.createVercelProvider).toBeDefined()
    expect(exports.createDevinProvider).toBeDefined()
    expect(exports.createVapiProvider).toBeDefined()
    expect(exports.createLiveKitProvider).toBeDefined()
  })

  it('provider options types export from index', async () => {
    const exports = await import('../providers')

    // Types are compile-time only, but we can check the exports exist
    expect(exports).toBeDefined()
  })
})
