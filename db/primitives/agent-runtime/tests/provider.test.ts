/**
 * LLM Provider Tests (RED Phase)
 *
 * Tests for:
 * - Base provider interface
 * - OpenAI provider adapter
 * - Anthropic provider adapter
 * - Provider registry
 * - Model configuration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  LLMProvider,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamEvent,
  ModelConfig,
} from '../types'
import {
  createOpenAIProvider,
  createAnthropicProvider,
  createProviderRegistry,
  type ProviderRegistry,
} from '../providers'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestMessages(): Message[] {
  return [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello, how are you?' },
  ]
}

function createMockResponse(): CompletionResponse {
  return {
    id: 'resp-123',
    model: 'gpt-4o',
    content: 'Hello! I am doing well, thank you for asking.',
    finishReason: 'stop',
    usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
    latencyMs: 150,
    provider: 'openai',
  }
}

// ============================================================================
// Base Provider Interface Tests
// ============================================================================

describe('LLM Provider Interface', () => {
  describe('Provider contract', () => {
    it('should expose name property', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(provider.name).toBe('openai')
    })

    it('should expose config property', () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        defaultModel: 'gpt-4o',
      })
      expect(provider.config.name).toBe('openai')
      expect(provider.config.apiKey).toBe('test-key')
      expect(provider.config.defaultModel).toBe('gpt-4o')
    })

    it('should implement supportsModel method', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(typeof provider.supportsModel).toBe('function')
      expect(provider.supportsModel('gpt-4o')).toBe(true)
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(false)
    })

    it('should implement complete method', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(typeof provider.complete).toBe('function')
    })

    it('should implement stream method', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(typeof provider.stream).toBe('function')
    })

    it('should implement countTokens method', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(typeof provider.countTokens).toBe('function')
    })

    it('should implement listModels method', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })
      expect(typeof provider.listModels).toBe('function')
    })
  })
})

// ============================================================================
// OpenAI Provider Tests
// ============================================================================

describe('OpenAI Provider', () => {
  describe('createOpenAIProvider()', () => {
    it('should create provider with minimal config', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      expect(provider).toBeDefined()
      expect(provider.name).toBe('openai')
    })

    it('should use default model from config', () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        defaultModel: 'gpt-4o-mini',
      })

      expect(provider.config.defaultModel).toBe('gpt-4o-mini')
    })

    it('should accept custom base URL', () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        baseUrl: 'https://custom-openai.com/v1',
      })

      expect(provider.config.baseUrl).toBe('https://custom-openai.com/v1')
    })

    it('should accept organization ID', () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        organization: 'org-123',
      })

      expect(provider.config.organization).toBe('org-123')
    })
  })

  describe('supportsModel()', () => {
    it('should return true for OpenAI models', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      expect(provider.supportsModel('gpt-4o')).toBe(true)
      expect(provider.supportsModel('gpt-4o-mini')).toBe(true)
      expect(provider.supportsModel('gpt-4-turbo')).toBe(true)
      expect(provider.supportsModel('gpt-3.5-turbo')).toBe(true)
      expect(provider.supportsModel('o1')).toBe(true)
      expect(provider.supportsModel('o1-mini')).toBe(true)
    })

    it('should return false for non-OpenAI models', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(false)
      expect(provider.supportsModel('gemini-pro')).toBe(false)
      expect(provider.supportsModel('command-r')).toBe(false)
    })
  })

  describe('complete()', () => {
    it('should return completion response with correct structure', async () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        // Use mock transport for testing
        options: { mockResponse: createMockResponse() },
      })

      const request: CompletionRequest = {
        model: 'gpt-4o',
        messages: createTestMessages(),
      }

      const response = await provider.complete(request)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('content')
      expect(response).toHaveProperty('finishReason')
      expect(response).toHaveProperty('usage')
      expect(response).toHaveProperty('provider', 'openai')
    })

    it('should include token usage in response', async () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        options: { mockResponse: createMockResponse() },
      })

      const response = await provider.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })

      expect(response.usage.promptTokens).toBeGreaterThan(0)
      expect(response.usage.completionTokens).toBeGreaterThan(0)
      expect(response.usage.totalTokens).toBe(
        response.usage.promptTokens + response.usage.completionTokens
      )
    })

    it('should handle tool calls in response', async () => {
      const mockWithTools: CompletionResponse = {
        ...createMockResponse(),
        content: undefined,
        toolCalls: [
          { id: 'call-1', name: 'get_weather', arguments: { location: 'NYC' } },
        ],
        finishReason: 'tool_calls',
      }

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        options: { mockResponse: mockWithTools },
      })

      const response = await provider.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            inputSchema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
            execute: async () => ({ temp: 72 }),
          },
        ],
      })

      expect(response.toolCalls).toHaveLength(1)
      expect(response.toolCalls?.[0].name).toBe('get_weather')
      expect(response.finishReason).toBe('tool_calls')
    })

    it('should measure latency', async () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        options: { mockResponse: createMockResponse() },
      })

      const response = await provider.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })

      expect(response.latencyMs).toBeDefined()
      expect(response.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('stream()', () => {
    it('should yield stream events', async () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        options: {
          mockStreamEvents: [
            { type: 'start', data: {}, timestamp: new Date() },
            { type: 'text-delta', data: { textDelta: 'Hello', accumulated: 'Hello' }, timestamp: new Date() },
            { type: 'text-delta', data: { textDelta: ' world', accumulated: 'Hello world' }, timestamp: new Date() },
            { type: 'done', data: { response: createMockResponse() }, timestamp: new Date() },
          ],
        },
      })

      const events: StreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })) {
        events.push(event)
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('start')
      expect(events[events.length - 1].type).toBe('done')
    })

    it('should include text deltas', async () => {
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        options: {
          mockStreamEvents: [
            { type: 'start', data: {}, timestamp: new Date() },
            { type: 'text-delta', data: { textDelta: 'Hi', accumulated: 'Hi' }, timestamp: new Date() },
            { type: 'done', data: { response: createMockResponse() }, timestamp: new Date() },
          ],
        },
      })

      const events: StreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })) {
        events.push(event)
      }

      const textDeltas = events.filter((e) => e.type === 'text-delta')
      expect(textDeltas.length).toBeGreaterThan(0)
    })
  })

  describe('countTokens()', () => {
    it('should estimate token count for messages', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      const tokenCount = await provider.countTokens(createTestMessages())

      expect(tokenCount).toBeGreaterThan(0)
      expect(typeof tokenCount).toBe('number')
    })

    it('should count more tokens for longer messages', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      const shortMessages: Message[] = [{ role: 'user', content: 'Hi' }]
      const longMessages: Message[] = [
        { role: 'user', content: 'This is a much longer message that contains many more words and should result in a higher token count.' },
      ]

      const shortCount = await provider.countTokens(shortMessages)
      const longCount = await provider.countTokens(longMessages)

      expect(longCount).toBeGreaterThan(shortCount)
    })
  })

  describe('listModels()', () => {
    it('should return list of available models', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      const models = await provider.listModels()

      expect(models).toBeInstanceOf(Array)
      expect(models.length).toBeGreaterThan(0)
    })

    it('should return model configs with required fields', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      const models = await provider.listModels()

      for (const model of models) {
        expect(model).toHaveProperty('model')
        expect(model).toHaveProperty('provider', 'openai')
      }
    })

    it('should include cost information', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      const models = await provider.listModels()
      const gpt4o = models.find((m) => m.model === 'gpt-4o')

      expect(gpt4o).toBeDefined()
      expect(gpt4o?.inputCostPer1k).toBeDefined()
      expect(gpt4o?.outputCostPer1k).toBeDefined()
    })
  })
})

// ============================================================================
// Anthropic Provider Tests
// ============================================================================

describe('Anthropic Provider', () => {
  describe('createAnthropicProvider()', () => {
    it('should create provider with minimal config', () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' })

      expect(provider).toBeDefined()
      expect(provider.name).toBe('anthropic')
    })

    it('should use default model from config', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        defaultModel: 'claude-sonnet-4-20250514',
      })

      expect(provider.config.defaultModel).toBe('claude-sonnet-4-20250514')
    })
  })

  describe('supportsModel()', () => {
    it('should return true for Anthropic models', () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' })

      expect(provider.supportsModel('claude-opus-4-20250514')).toBe(true)
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(true)
      expect(provider.supportsModel('claude-3-5-sonnet-20241022')).toBe(true)
      expect(provider.supportsModel('claude-3-opus-20240229')).toBe(true)
      expect(provider.supportsModel('claude-3-haiku-20240307')).toBe(true)
    })

    it('should return false for non-Anthropic models', () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' })

      expect(provider.supportsModel('gpt-4o')).toBe(false)
      expect(provider.supportsModel('gemini-pro')).toBe(false)
    })
  })

  describe('complete()', () => {
    it('should return completion response with correct structure', async () => {
      const mockResponse: CompletionResponse = {
        id: 'msg-123',
        model: 'claude-sonnet-4-20250514',
        content: 'Hello! How can I help you today?',
        finishReason: 'stop',
        usage: { promptTokens: 25, completionTokens: 12, totalTokens: 37 },
        latencyMs: 200,
        provider: 'anthropic',
      }

      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        options: { mockResponse },
      })

      const response = await provider.complete({
        model: 'claude-sonnet-4-20250514',
        messages: createTestMessages(),
      })

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('content')
      expect(response).toHaveProperty('provider', 'anthropic')
    })

    it('should handle tool use blocks', async () => {
      const mockWithTools: CompletionResponse = {
        id: 'msg-123',
        model: 'claude-sonnet-4-20250514',
        toolCalls: [
          { id: 'toolu_01', name: 'calculator', arguments: { expression: '2+2' } },
        ],
        finishReason: 'tool_calls',
        usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        latencyMs: 180,
        provider: 'anthropic',
      }

      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        options: { mockResponse: mockWithTools },
      })

      const response = await provider.complete({
        model: 'claude-sonnet-4-20250514',
        messages: createTestMessages(),
        tools: [
          {
            name: 'calculator',
            description: 'Evaluate math expressions',
            inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
            execute: async () => ({ result: 4 }),
          },
        ],
      })

      expect(response.toolCalls).toBeDefined()
      expect(response.toolCalls?.[0].name).toBe('calculator')
    })
  })

  describe('listModels()', () => {
    it('should return Claude models', async () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' })

      const models = await provider.listModels()
      const modelNames = models.map((m) => m.model)

      expect(modelNames).toContain('claude-opus-4-20250514')
      expect(modelNames).toContain('claude-sonnet-4-20250514')
    })
  })
})

// ============================================================================
// Provider Registry Tests
// ============================================================================

describe('Provider Registry', () => {
  describe('createProviderRegistry()', () => {
    it('should create empty registry', () => {
      const registry = createProviderRegistry()

      expect(registry).toBeDefined()
      expect(registry.getProviders()).toHaveLength(0)
    })

    it('should accept initial providers', () => {
      const openai = createOpenAIProvider({ apiKey: 'test-key' })
      const anthropic = createAnthropicProvider({ apiKey: 'test-key' })

      const registry = createProviderRegistry([openai, anthropic])

      expect(registry.getProviders()).toHaveLength(2)
    })
  })

  describe('register()', () => {
    it('should add provider to registry', () => {
      const registry = createProviderRegistry()
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      registry.register(provider)

      expect(registry.getProviders()).toHaveLength(1)
      expect(registry.get('openai')).toBe(provider)
    })

    it('should replace existing provider with same name', () => {
      const registry = createProviderRegistry()
      const provider1 = createOpenAIProvider({ apiKey: 'key-1' })
      const provider2 = createOpenAIProvider({ apiKey: 'key-2' })

      registry.register(provider1)
      registry.register(provider2)

      expect(registry.getProviders()).toHaveLength(1)
      expect(registry.get('openai')).toBe(provider2)
    })
  })

  describe('get()', () => {
    it('should return registered provider', () => {
      const registry = createProviderRegistry()
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      registry.register(provider)

      expect(registry.get('openai')).toBe(provider)
    })

    it('should return undefined for unregistered provider', () => {
      const registry = createProviderRegistry()

      expect(registry.get('openai')).toBeUndefined()
    })
  })

  describe('getForModel()', () => {
    it('should return provider that supports the model', () => {
      const openai = createOpenAIProvider({ apiKey: 'test-key' })
      const anthropic = createAnthropicProvider({ apiKey: 'test-key' })
      const registry = createProviderRegistry([openai, anthropic])

      expect(registry.getForModel('gpt-4o')).toBe(openai)
      expect(registry.getForModel('claude-sonnet-4-20250514')).toBe(anthropic)
    })

    it('should return undefined for unsupported model', () => {
      const openai = createOpenAIProvider({ apiKey: 'test-key' })
      const registry = createProviderRegistry([openai])

      expect(registry.getForModel('unknown-model')).toBeUndefined()
    })
  })

  describe('remove()', () => {
    it('should remove provider from registry', () => {
      const registry = createProviderRegistry()
      const provider = createOpenAIProvider({ apiKey: 'test-key' })

      registry.register(provider)
      registry.remove('openai')

      expect(registry.get('openai')).toBeUndefined()
      expect(registry.getProviders()).toHaveLength(0)
    })
  })
})
