import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'

/**
 * AI Gateway Client Tests
 *
 * Tests for unified AI client that routes to Workers AI or external providers
 * via Cloudflare AI Gateway.
 *
 * RED PHASE: These tests are expected to FAIL until lib/ai/gateway.ts is implemented.
 */

// Import the module under test (will fail until implemented)
import { AIGatewayClient, ChatMessage, ChatResponse, AIGatewayEnv } from '../ai/gateway'
import { AIConfig } from '../../types/AI'

// ============================================================================
// Test Fixtures
// ============================================================================

const mockMessages: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
]

const createMockEnv = (overrides: Partial<AIGatewayEnv> = {}): AIGatewayEnv => ({
  AI: {
    run: vi.fn().mockResolvedValue({
      response: 'Hello from Workers AI!',
    }),
  },
  AI_GATEWAY_ID: 'my-gateway',
  OPENAI_API_KEY: 'sk-test-openai-key',
  ANTHROPIC_API_KEY: 'sk-test-anthropic-key',
  GOOGLE_API_KEY: 'test-google-key',
  ...overrides,
})

const createConfig = (overrides: Partial<AIConfig> = {}): AIConfig => ({
  provider: 'openai',
  model: 'gpt-4o',
  ...overrides,
})

// ============================================================================
// Workers AI Provider Tests
// ============================================================================

describe('AIGatewayClient with Workers AI provider', () => {
  let mockEnv: AIGatewayEnv
  let client: AIGatewayClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    const config = createConfig({ provider: 'workers-ai', model: '@cf/meta/llama-3.1-70b-instruct' })
    client = new AIGatewayClient(config, mockEnv)
  })

  it('calls Workers AI binding when provider is workers-ai', async () => {
    const response = await client.chat(mockMessages)

    expect(mockEnv.AI!.run).toHaveBeenCalledTimes(1)
    expect(mockEnv.AI!.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-70b-instruct',
      expect.objectContaining({
        messages: mockMessages,
      })
    )
    expect(response.content).toBe('Hello from Workers AI!')
  })

  it('passes temperature and max_tokens to Workers AI', async () => {
    const config = createConfig({
      provider: 'workers-ai',
      model: '@cf/meta/llama-3.1-70b-instruct',
      temperature: 0.7,
      maxTokens: 1000,
    })
    client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    expect(mockEnv.AI!.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-70b-instruct',
      expect.objectContaining({
        messages: mockMessages,
        temperature: 0.7,
        max_tokens: 1000,
      })
    )
  })

  it('throws error when AI binding is not available', async () => {
    const envWithoutAI = createMockEnv({ AI: undefined })
    const config = createConfig({ provider: 'workers-ai', model: '@cf/meta/llama-3.1-70b-instruct' })
    const clientWithoutAI = new AIGatewayClient(config, envWithoutAI)

    await expect(clientWithoutAI.chat(mockMessages)).rejects.toThrow(
      'Workers AI binding not available'
    )
  })
})

// ============================================================================
// OpenAI Provider Tests
// ============================================================================

describe('AIGatewayClient with OpenAI provider', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'Hello from OpenAI!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls OpenAI via AI Gateway when gateway ID is configured', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'openai', model: 'gpt-4o', gateway: 'my-gateway' })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/my-gateway/openai/chat/completions')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test-openai-key',
    })
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'gpt-4o',
      messages: mockMessages,
    })
    expect(response.content).toBe('Hello from OpenAI!')
  })

  it('calls OpenAI directly when no gateway configured', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: undefined })
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('includes usage information in response', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(response.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    })
  })

  it('throws error when OpenAI API key is missing', async () => {
    const mockEnv = createMockEnv({ OPENAI_API_KEY: undefined })
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('OPENAI_API_KEY is required')
  })

  it('passes temperature and max_tokens to OpenAI', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 500,
    })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(500)
  })
})

// ============================================================================
// Anthropic Provider Tests
// ============================================================================

describe('AIGatewayClient with Anthropic provider', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: 'text', text: 'Hello from Anthropic!' }],
          usage: { input_tokens: 15, output_tokens: 8 },
        }),
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls Anthropic via AI Gateway when gateway ID is configured', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      gateway: 'my-gateway',
    })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/my-gateway/anthropic/v1/messages')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-test-anthropic-key',
      'anthropic-version': '2023-06-01',
    })
    expect(response.content).toBe('Hello from Anthropic!')
  })

  it('calls Anthropic directly when no gateway configured', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: undefined })
    const config = createConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('converts messages to Anthropic format with system prompt', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    // Anthropic uses separate system parameter
    expect(body.system).toBe('You are a helpful assistant.')
    // Messages should exclude system message
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello!' }])
  })

  it('includes usage information in response', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(response.usage).toEqual({
      inputTokens: 15,
      outputTokens: 8,
    })
  })

  it('throws error when Anthropic API key is missing', async () => {
    const mockEnv = createMockEnv({ ANTHROPIC_API_KEY: undefined })
    const config = createConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('ANTHROPIC_API_KEY is required')
  })

  it('passes temperature and max_tokens to Anthropic', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.8,
      maxTokens: 2000,
    })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.temperature).toBe(0.8)
    expect(body.max_tokens).toBe(2000)
  })
})

// ============================================================================
// Google Provider Tests
// ============================================================================

describe('AIGatewayClient with Google provider', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'Hello from Google!' }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
        }),
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls Google via AI Gateway when gateway ID is configured', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({
      provider: 'google',
      model: 'gemini-1.5-pro',
      gateway: 'my-gateway',
    })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://gateway.ai.cloudflare.com/v1/my-gateway/google-ai-studio/v1/models/gemini-1.5-pro:generateContent'
    )
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'test-google-key',
    })
    expect(response.content).toBe('Hello from Google!')
  })

  it('calls Google directly when no gateway configured', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: undefined })
    const config = createConfig({ provider: 'google', model: 'gemini-1.5-pro' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=test-google-key'
    )
  })

  it('converts messages to Google format', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'google', model: 'gemini-1.5-pro' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    // Google uses contents array with parts
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'You are a helpful assistant.' }] },
      { role: 'user', parts: [{ text: 'Hello!' }] },
    ])
  })

  it('includes usage information in response', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'google', model: 'gemini-1.5-pro' })
    const client = new AIGatewayClient(config, mockEnv)

    const response = await client.chat(mockMessages)

    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 6,
    })
  })

  it('throws error when Google API key is missing', async () => {
    const mockEnv = createMockEnv({ GOOGLE_API_KEY: undefined })
    const config = createConfig({ provider: 'google', model: 'gemini-1.5-pro' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('GOOGLE_API_KEY is required')
  })

  it('passes temperature and max_tokens to Google', async () => {
    const mockEnv = createMockEnv()
    const config = createConfig({
      provider: 'google',
      model: 'gemini-1.5-pro',
      temperature: 0.9,
      maxTokens: 1500,
    })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.generationConfig.temperature).toBe(0.9)
    expect(body.generationConfig.maxOutputTokens).toBe(1500)
  })
})

// ============================================================================
// Gateway URL Pattern Tests
// ============================================================================

describe('AIGatewayClient gateway URL patterns', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'Response' } }],
        }),
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('uses gateway from config.gateway over env.AI_GATEWAY_ID', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: 'env-gateway' })
    const config = createConfig({ provider: 'openai', model: 'gpt-4o', gateway: 'config-gateway' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/config-gateway/openai/chat/completions')
  })

  it('falls back to env.AI_GATEWAY_ID when config.gateway is not set', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: 'env-gateway' })
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/env-gateway/openai/chat/completions')
  })

  it('uses direct URL when neither gateway is configured', async () => {
    const mockEnv = createMockEnv({ AI_GATEWAY_ID: undefined })
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await client.chat(mockMessages)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('AIGatewayClient error handling', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('throws descriptive error on HTTP error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } }),
    })

    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('Rate limit exceeded')
  })

  it('throws generic error when error response has no message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    })

    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('API request failed: 500')
  })

  it('throws error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const mockEnv = createMockEnv()
    const config = createConfig({ provider: 'openai', model: 'gpt-4o' })
    const client = new AIGatewayClient(config, mockEnv)

    await expect(client.chat(mockMessages)).rejects.toThrow('Network error')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('AIGatewayClient type safety', () => {
  it('exports ChatMessage interface', () => {
    const message: ChatMessage = {
      role: 'user',
      content: 'Hello',
    }
    expect(message.role).toBe('user')
    expect(message.content).toBe('Hello')
  })

  it('exports ChatResponse interface', () => {
    const response: ChatResponse = {
      content: 'Hello',
      usage: { inputTokens: 10, outputTokens: 5 },
    }
    expect(response.content).toBe('Hello')
    expect(response.usage?.inputTokens).toBe(10)
  })

  it('exports AIGatewayEnv interface', () => {
    const env: AIGatewayEnv = {
      AI: { run: vi.fn() },
      AI_GATEWAY_ID: 'test',
      OPENAI_API_KEY: 'key',
    }
    expect(env.AI_GATEWAY_ID).toBe('test')
  })
})
