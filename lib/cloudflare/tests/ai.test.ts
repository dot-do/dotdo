/**
 * Workers AI Integration Layer Tests
 *
 * Comprehensive tests for the Workers AI integration including:
 * - Text generation (chat completions)
 * - Embeddings (vector generation)
 * - Image generation
 * - Speech-to-text transcription
 * - Cost tracking and limits
 * - Streaming support
 * - Fallback to external providers via AI Gateway
 *
 * RED PHASE: These tests are expected to FAIL until lib/cloudflare/ai.ts is implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'

// Import the module under test (will fail until implemented)
import {
  WorkersAI,
  WorkersAIConfig,
  WorkersAIEnv,
  AI_MODELS,
  TextGenerationOptions,
  TextGenerationResponse,
  EmbeddingOptions,
  EmbeddingResponse,
  ImageGenerationOptions,
  ImageGenerationResponse,
  SpeechToTextOptions,
  SpeechToTextResponse,
  UsageMetrics,
  CostLimits,
  StreamingTextResponse,
} from '../ai'

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockAIBinding = () => ({
  run: vi.fn(),
})

const createMockEnv = (overrides: Partial<WorkersAIEnv> = {}): WorkersAIEnv => ({
  AI: createMockAIBinding() as unknown as Ai,
  AI_GATEWAY_ID: 'test-gateway',
  OPENAI_API_KEY: 'sk-test-openai',
  ANTHROPIC_API_KEY: 'sk-test-anthropic',
  ...overrides,
})

const createConfig = (overrides: Partial<WorkersAIConfig> = {}): WorkersAIConfig => ({
  ...overrides,
})

// ============================================================================
// Model Configuration Tests
// ============================================================================

describe('AI_MODELS configuration', () => {
  it('exports chat models', () => {
    expect(AI_MODELS.chat).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect(AI_MODELS.chatLarge).toBe('@cf/meta/llama-3.1-70b-instruct')
  })

  it('exports embedding model', () => {
    expect(AI_MODELS.embedding).toBe('@cf/baai/bge-base-en-v1.5')
  })

  it('exports image generation model', () => {
    expect(AI_MODELS.image).toBe('@cf/black-forest-labs/flux-1-schnell')
  })

  it('exports speech-to-text model', () => {
    expect(AI_MODELS.speech).toBe('@cf/openai/whisper')
  })
})

// ============================================================================
// WorkersAI Instantiation Tests
// ============================================================================

describe('WorkersAI instantiation', () => {
  it('creates instance with AI binding', () => {
    const env = createMockEnv()
    const ai = new WorkersAI(env)
    expect(ai).toBeInstanceOf(WorkersAI)
  })

  it('creates instance with optional config', () => {
    const env = createMockEnv()
    const config: WorkersAIConfig = {
      defaultModel: '@cf/meta/llama-3.1-70b-instruct',
      maxTokens: 2000,
      temperature: 0.7,
    }
    const ai = new WorkersAI(env, config)
    expect(ai).toBeInstanceOf(WorkersAI)
  })

  it('throws error when AI binding is not available', () => {
    const env = createMockEnv({ AI: undefined })
    expect(() => new WorkersAI(env)).toThrow('Workers AI binding (AI) is required')
  })
})

// ============================================================================
// Text Generation Tests
// ============================================================================

describe('WorkersAI.generateText', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      response: 'Hello! I am an AI assistant.',
    })
    ai = new WorkersAI(mockEnv)
  })

  it('generates text with simple prompt', async () => {
    const response = await ai.generateText('Hello, who are you?')

    expect(response.text).toBe('Hello! I am an AI assistant.')
    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.chat,
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello, who are you?' }],
      })
    )
  })

  it('generates text with message array', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Hello!' },
    ]

    await ai.generateText(messages)

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.chat,
      expect.objectContaining({
        messages,
      })
    )
  })

  it('uses specified model', async () => {
    await ai.generateText('Hello', { model: AI_MODELS.chatLarge })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.chatLarge,
      expect.any(Object)
    )
  })

  it('passes temperature parameter', async () => {
    await ai.generateText('Hello', { temperature: 0.9 })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        temperature: 0.9,
      })
    )
  })

  it('passes max_tokens parameter', async () => {
    await ai.generateText('Hello', { maxTokens: 500 })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        max_tokens: 500,
      })
    )
  })

  it('includes usage metrics in response', async () => {
    const response = await ai.generateText('Hello')

    expect(response.usage).toBeDefined()
    expect(typeof response.usage?.promptTokens).toBe('number')
    expect(typeof response.usage?.completionTokens).toBe('number')
    expect(typeof response.usage?.totalTokens).toBe('number')
  })

  it('includes model in response', async () => {
    const response = await ai.generateText('Hello')

    expect(response.model).toBe(AI_MODELS.chat)
  })
})

// ============================================================================
// Streaming Text Generation Tests
// ============================================================================

describe('WorkersAI.generateTextStream', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    // Mock streaming response
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response":"Hello"}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"response":" World"}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue(mockStream)
    ai = new WorkersAI(mockEnv)
  })

  it('returns a ReadableStream', async () => {
    const stream = await ai.generateTextStream('Hello')

    expect(stream).toBeInstanceOf(ReadableStream)
  })

  it('streams text chunks', async () => {
    const stream = await ai.generateTextStream('Hello')
    const reader = stream.getReader()
    const chunks: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(chunks.length).toBeGreaterThan(0)
  })

  it('passes stream option to AI binding', async () => {
    await ai.generateTextStream('Hello')

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        stream: true,
      })
    )
  })
})

// ============================================================================
// Embedding Generation Tests
// ============================================================================

describe('WorkersAI.generateEmbedding', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      data: [[0.1, 0.2, 0.3, 0.4, 0.5]],
    })
    ai = new WorkersAI(mockEnv)
  })

  it('generates embedding for single text', async () => {
    const response = await ai.generateEmbedding('Hello world')

    expect(response.embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.embedding,
      expect.objectContaining({
        text: 'Hello world',
      })
    )
  })

  it('generates embeddings for multiple texts', async () => {
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      data: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    })

    const response = await ai.generateEmbeddings(['Hello', 'World'])

    expect(response.embeddings).toHaveLength(2)
    expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3])
    expect(response.embeddings[1]).toEqual([0.4, 0.5, 0.6])
  })

  it('includes embedding dimension in response', async () => {
    const response = await ai.generateEmbedding('Hello')

    expect(response.dimension).toBe(5) // Based on mock data
  })

  it('uses specified embedding model', async () => {
    const customModel = '@cf/custom/embedding-model'
    await ai.generateEmbedding('Hello', { model: customModel })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      customModel,
      expect.any(Object)
    )
  })
})

// ============================================================================
// Image Generation Tests
// ============================================================================

describe('WorkersAI.generateImage', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI
  let mockImageData: Uint8Array

  beforeEach(() => {
    mockEnv = createMockEnv()
    mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue(mockImageData)
    ai = new WorkersAI(mockEnv)
  })

  it('generates image from prompt', async () => {
    const response = await ai.generateImage('A beautiful sunset')

    expect(response.image).toBeInstanceOf(Uint8Array)
    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.image,
      expect.objectContaining({
        prompt: 'A beautiful sunset',
      })
    )
  })

  it('passes image dimensions', async () => {
    await ai.generateImage('A cat', { width: 1024, height: 1024 })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        width: 1024,
        height: 1024,
      })
    )
  })

  it('passes number of steps', async () => {
    await ai.generateImage('A dog', { steps: 20 })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        num_steps: 20,
      })
    )
  })

  it('passes guidance scale', async () => {
    await ai.generateImage('A landscape', { guidance: 7.5 })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        guidance: 7.5,
      })
    )
  })

  it('includes format in response', async () => {
    const response = await ai.generateImage('A flower')

    expect(response.format).toBe('png')
  })

  it('includes dimensions in response', async () => {
    const response = await ai.generateImage('A tree', { width: 512, height: 512 })

    expect(response.width).toBe(512)
    expect(response.height).toBe(512)
  })
})

// ============================================================================
// Speech-to-Text Tests
// ============================================================================

describe('WorkersAI.transcribeAudio', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI
  let mockAudioData: ArrayBuffer

  beforeEach(() => {
    mockEnv = createMockEnv()
    mockAudioData = new ArrayBuffer(100)
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      text: 'Hello, this is a transcription.',
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello, this is a transcription.',
    })
    ai = new WorkersAI(mockEnv)
  })

  it('transcribes audio from ArrayBuffer', async () => {
    const response = await ai.transcribeAudio(mockAudioData)

    expect(response.text).toBe('Hello, this is a transcription.')
    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      AI_MODELS.speech,
      expect.objectContaining({
        audio: expect.any(Array),
      })
    )
  })

  it('transcribes audio from Uint8Array', async () => {
    const uint8Audio = new Uint8Array(mockAudioData)
    const response = await ai.transcribeAudio(uint8Audio)

    expect(response.text).toBe('Hello, this is a transcription.')
  })

  it('includes VTT subtitles in response', async () => {
    const response = await ai.transcribeAudio(mockAudioData)

    expect(response.vtt).toContain('WEBVTT')
  })

  it('passes language hint', async () => {
    await ai.transcribeAudio(mockAudioData, { language: 'en' })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source_lang: 'en',
      })
    )
  })

  it('uses word-level timestamps option', async () => {
    await ai.transcribeAudio(mockAudioData, { wordTimestamps: true })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        word_timestamps: true,
      })
    )
  })
})

// ============================================================================
// Cost Tracking Tests
// ============================================================================

describe('WorkersAI cost tracking', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      response: 'Hello',
    })
    ai = new WorkersAI(mockEnv)
  })

  it('tracks usage across operations', async () => {
    await ai.generateText('Hello')
    await ai.generateText('World')

    const metrics = ai.getUsageMetrics()

    expect(metrics.totalOperations).toBe(2)
    expect(metrics.operationsByType.text).toBe(2)
  })

  it('tracks usage by operation type', async () => {
    ;(mockEnv.AI as unknown as { run: Mock }).run
      .mockResolvedValueOnce({ response: 'Hello' })
      .mockResolvedValueOnce({ data: [[0.1, 0.2]] })

    await ai.generateText('Hello')
    await ai.generateEmbedding('World')

    const metrics = ai.getUsageMetrics()

    expect(metrics.operationsByType.text).toBe(1)
    expect(metrics.operationsByType.embedding).toBe(1)
  })

  it('tracks estimated cost', async () => {
    await ai.generateText('Hello')

    const metrics = ai.getUsageMetrics()

    expect(typeof metrics.estimatedCost).toBe('number')
    expect(metrics.estimatedCost).toBeGreaterThanOrEqual(0)
  })

  it('resets usage metrics', async () => {
    await ai.generateText('Hello')
    ai.resetUsageMetrics()

    const metrics = ai.getUsageMetrics()

    expect(metrics.totalOperations).toBe(0)
  })
})

// ============================================================================
// Cost Limits Tests
// ============================================================================

describe('WorkersAI cost limits', () => {
  let mockEnv: WorkersAIEnv

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      response: 'Hello',
    })
  })

  it('enforces maximum operations limit', async () => {
    const ai = new WorkersAI(mockEnv, {
      limits: { maxOperations: 2 },
    })

    await ai.generateText('One')
    await ai.generateText('Two')

    await expect(ai.generateText('Three')).rejects.toThrow(
      'Operation limit exceeded'
    )
  })

  it('enforces maximum cost limit', async () => {
    const ai = new WorkersAI(mockEnv, {
      limits: { maxCost: 0.001 },
    })

    // Assuming each operation has some cost
    // This might need multiple operations to exceed
    await expect(async () => {
      for (let i = 0; i < 100; i++) {
        await ai.generateText('Test')
      }
    }).rejects.toThrow('Cost limit exceeded')
  })

  it('provides remaining budget', async () => {
    const ai = new WorkersAI(mockEnv, {
      limits: { maxCost: 1.0 },
    })

    await ai.generateText('Hello')

    const remaining = ai.getRemainingBudget()
    expect(remaining).toBeLessThan(1.0)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('checks if operation is within limits', () => {
    const ai = new WorkersAI(mockEnv, {
      limits: { maxOperations: 10 },
    })

    expect(ai.canPerformOperation()).toBe(true)
  })
})

// ============================================================================
// AI Gateway Fallback Tests
// ============================================================================

describe('WorkersAI with AI Gateway fallback', () => {
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

  it('falls back to OpenAI via AI Gateway when Workers AI fails', async () => {
    const mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockRejectedValue(
      new Error('Workers AI unavailable')
    )

    const ai = new WorkersAI(mockEnv, {
      fallback: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    })

    const response = await ai.generateText('Hello')

    expect(response.text).toBe('Hello from OpenAI!')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('gateway.ai.cloudflare.com'),
      expect.any(Object)
    )
  })

  it('falls back to Anthropic via AI Gateway', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: 'text', text: 'Hello from Claude!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
    })

    const mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockRejectedValue(
      new Error('Workers AI unavailable')
    )

    const ai = new WorkersAI(mockEnv, {
      fallback: {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
      },
    })

    const response = await ai.generateText('Hello')

    expect(response.text).toBe('Hello from Claude!')
  })

  it('does not fall back when fallback is disabled', async () => {
    const mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockRejectedValue(
      new Error('Workers AI unavailable')
    )

    const ai = new WorkersAI(mockEnv, {
      fallback: { enabled: false },
    })

    await expect(ai.generateText('Hello')).rejects.toThrow(
      'Workers AI unavailable'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('includes fallback indicator in response when fallback used', async () => {
    const mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockRejectedValue(
      new Error('Workers AI unavailable')
    )

    const ai = new WorkersAI(mockEnv, {
      fallback: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    })

    const response = await ai.generateText('Hello')

    expect(response.usedFallback).toBe(true)
    expect(response.fallbackProvider).toBe('openai')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('WorkersAI error handling', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ai = new WorkersAI(mockEnv)
  })

  it('throws descriptive error on AI binding failure', async () => {
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockRejectedValue(
      new Error('Model not found')
    )

    await expect(ai.generateText('Hello')).rejects.toThrow('Model not found')
  })

  it('throws error for invalid input', async () => {
    await expect(ai.generateText('')).rejects.toThrow(
      'Input cannot be empty'
    )
  })

  it('throws error for invalid embedding input', async () => {
    await expect(ai.generateEmbedding('')).rejects.toThrow(
      'Text cannot be empty'
    )
  })

  it('throws error for invalid image prompt', async () => {
    await expect(ai.generateImage('')).rejects.toThrow(
      'Prompt cannot be empty'
    )
  })

  it('throws error for empty audio data', async () => {
    await expect(ai.transcribeAudio(new ArrayBuffer(0))).rejects.toThrow(
      'Audio data cannot be empty'
    )
  })

  it('handles timeout errors', async () => {
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
    )

    const aiWithTimeout = new WorkersAI(mockEnv, { timeout: 50 })

    await expect(aiWithTimeout.generateText('Hello')).rejects.toThrow()
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('WorkersAI type exports', () => {
  it('exports WorkersAIConfig interface', () => {
    const config: WorkersAIConfig = {
      defaultModel: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.7,
      maxTokens: 1000,
    }
    expect(config.defaultModel).toBe('@cf/meta/llama-3.1-8b-instruct')
  })

  it('exports WorkersAIEnv interface', () => {
    const env: WorkersAIEnv = {
      AI: createMockAIBinding() as unknown as Ai,
    }
    expect(env.AI).toBeDefined()
  })

  it('exports TextGenerationOptions interface', () => {
    const options: TextGenerationOptions = {
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.5,
      maxTokens: 500,
    }
    expect(options.model).toBeDefined()
  })

  it('exports TextGenerationResponse interface', () => {
    const response: TextGenerationResponse = {
      text: 'Hello',
      model: '@cf/meta/llama-3.1-8b-instruct',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }
    expect(response.text).toBe('Hello')
  })

  it('exports EmbeddingResponse interface', () => {
    const response: EmbeddingResponse = {
      embedding: [0.1, 0.2, 0.3],
      dimension: 3,
      model: '@cf/baai/bge-base-en-v1.5',
    }
    expect(response.embedding).toHaveLength(3)
  })

  it('exports ImageGenerationResponse interface', () => {
    const response: ImageGenerationResponse = {
      image: new Uint8Array([1, 2, 3]),
      format: 'png',
      width: 512,
      height: 512,
    }
    expect(response.format).toBe('png')
  })

  it('exports SpeechToTextResponse interface', () => {
    const response: SpeechToTextResponse = {
      text: 'Hello world',
    }
    expect(response.text).toBe('Hello world')
  })

  it('exports UsageMetrics interface', () => {
    const metrics: UsageMetrics = {
      totalOperations: 10,
      operationsByType: { text: 5, embedding: 3, image: 1, speech: 1 },
      estimatedCost: 0.05,
    }
    expect(metrics.totalOperations).toBe(10)
  })

  it('exports CostLimits interface', () => {
    const limits: CostLimits = {
      maxOperations: 100,
      maxCost: 1.0,
    }
    expect(limits.maxOperations).toBe(100)
  })
})

// ============================================================================
// Utility Method Tests
// ============================================================================

describe('WorkersAI utility methods', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ai = new WorkersAI(mockEnv)
  })

  it('provides model info', () => {
    const modelInfo = ai.getModelInfo(AI_MODELS.chat)

    expect(modelInfo).toBeDefined()
    expect(modelInfo.id).toBe(AI_MODELS.chat)
    expect(modelInfo.type).toBe('text')
  })

  it('lists available models', () => {
    const models = ai.listModels()

    expect(models).toContain(AI_MODELS.chat)
    expect(models).toContain(AI_MODELS.embedding)
    expect(models).toContain(AI_MODELS.image)
    expect(models).toContain(AI_MODELS.speech)
  })

  it('validates model existence', () => {
    expect(ai.isValidModel(AI_MODELS.chat)).toBe(true)
    expect(ai.isValidModel('@cf/invalid/model')).toBe(false)
  })
})

// ============================================================================
// Batch Operations Tests
// ============================================================================

describe('WorkersAI batch operations', () => {
  let mockEnv: WorkersAIEnv
  let ai: WorkersAI

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      data: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ],
    })
    ai = new WorkersAI(mockEnv)
  })

  it('generates embeddings in batch', async () => {
    const texts = ['Hello', 'World', 'Test']
    const response = await ai.generateEmbeddings(texts)

    expect(response.embeddings).toHaveLength(3)
  })

  it('handles batch size limits', async () => {
    const texts = Array(150).fill('test') // Assuming batch limit is 100
    const response = await ai.generateEmbeddings(texts)

    // Should split into batches and combine results
    expect(response.embeddings).toHaveLength(150)
    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledTimes(2) // Two batches
  })
})

// ============================================================================
// Configuration Validation Tests
// ============================================================================

describe('WorkersAI configuration validation', () => {
  let mockEnv: WorkersAIEnv

  beforeEach(() => {
    mockEnv = createMockEnv()
  })

  it('validates temperature range', () => {
    expect(
      () => new WorkersAI(mockEnv, { temperature: -0.1 })
    ).toThrow('Temperature must be between 0 and 2')

    expect(
      () => new WorkersAI(mockEnv, { temperature: 2.1 })
    ).toThrow('Temperature must be between 0 and 2')
  })

  it('validates maxTokens is positive', () => {
    expect(
      () => new WorkersAI(mockEnv, { maxTokens: 0 })
    ).toThrow('maxTokens must be a positive integer')

    expect(
      () => new WorkersAI(mockEnv, { maxTokens: -100 })
    ).toThrow('maxTokens must be a positive integer')
  })

  it('validates timeout is positive', () => {
    expect(
      () => new WorkersAI(mockEnv, { timeout: -1000 })
    ).toThrow('timeout must be a positive number')
  })
})
