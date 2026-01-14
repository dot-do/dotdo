/**
 * @dotdo/google-ai - Google Generative AI Compatibility Layer Tests
 *
 * Tests for the Google AI API compatibility layer including:
 * - Generate Content (text generation with prompts)
 * - Chat (multi-turn conversations)
 * - Embeddings (text embeddings)
 * - Function Calling (tool/function definitions)
 * - Streaming (streaming responses)
 * - Safety Settings
 *
 * Following TDD: RED (failing tests) -> GREEN (implementation) -> REFACTOR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GoogleGenerativeAI,
  GoogleGenerativeAIError,
  HarmCategory,
  HarmBlockThreshold,
  type GenerateContentResult,
  type GenerateContentStreamResult,
  type EmbedContentResult,
  type Content,
  type Part,
  type TextPart,
  type FunctionCallPart,
  type FunctionResponsePart,
  type FunctionDeclaration,
  type Tool,
  type SafetySetting,
  type GenerationConfig,
  type ChatSession,
  type GenerativeModel,
} from '../src/index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'GET'} ${urlObj.pathname}`

    // Find matching mock (check for partial path matches)
    let mockResponse: { status: number; body: unknown } | undefined
    for (const [mockKey, value] of responses.entries()) {
      if (key.includes(mockKey.split(' ')[1])) {
        mockResponse = value
        break
      }
    }

    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({
          error: { code: 404, message: `No mock for ${key}`, status: 'NOT_FOUND' },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse.body,
    }
  })
}

function createMockStreamFetch(chunks: unknown[]) {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`
          controller.enqueue(encoder.encode(data))
        }
        controller.close()
      },
    })

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream,
    }
  })
}

function mockGenerateContentResponse(overrides: Partial<GenerateContentResult['response']> = {}): GenerateContentResult {
  return {
    response: {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello! How can I help you today?' }],
          },
          finishReason: 'STOP',
          index: 0,
          safetyRatings: [],
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 8,
        totalTokenCount: 18,
      },
      ...overrides,
      text: () => 'Hello! How can I help you today?',
    },
  }
}

function mockEmbedContentResponse(overrides: Partial<EmbedContentResult> = {}): EmbedContentResult {
  return {
    embedding: {
      values: Array(768).fill(0).map(() => Math.random() * 2 - 1),
    },
    ...overrides,
  }
}

// =============================================================================
// GoogleGenerativeAI Client Tests
// =============================================================================

describe('@dotdo/google-ai - GoogleGenerativeAI Client', () => {
  describe('initialization', () => {
    it('should create a GoogleGenerativeAI instance with API key', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      expect(genAI).toBeDefined()
    })

    it('should throw error without API key', () => {
      expect(() => new GoogleGenerativeAI('')).toThrow('Google AI API key is required')
    })

    it('should provide getGenerativeModel method', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      expect(model).toBeDefined()
    })

    it('should accept configuration options', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: {
          temperature: 0.9,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
      })
      expect(model).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw GoogleGenerativeAIError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :generateContent',
            {
              status: 400,
              body: {
                error: {
                  code: 400,
                  message: 'Invalid request',
                  status: 'INVALID_ARGUMENT',
                },
              },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

      await expect(model.generateContent('Hello')).rejects.toThrow(GoogleGenerativeAIError)
    })

    it('should include error code and message in GoogleGenerativeAIError', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :generateContent',
            {
              status: 401,
              body: {
                error: {
                  code: 401,
                  message: 'Invalid API key',
                  status: 'UNAUTHENTICATED',
                },
              },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('invalid-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

      try {
        await model.generateContent('Hello')
      } catch (error) {
        expect(error).toBeInstanceOf(GoogleGenerativeAIError)
        const googleError = error as GoogleGenerativeAIError
        expect(googleError.status).toBe(401)
        expect(googleError.message).toBe('Invalid API key')
      }
    })
  })
})

// =============================================================================
// Generate Content Tests
// =============================================================================

describe('@dotdo/google-ai - Generate Content', () => {
  describe('generateContent', () => {
    it('should generate content with a simple text prompt', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent('Write a story about a robot')

      expect(result.response).toBeDefined()
      expect(result.response.text()).toBe('Hello! How can I help you today?')
    })

    it('should generate content with Content array', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent([
        { role: 'user', parts: [{ text: 'Hello' }] },
      ])

      expect(result.response).toBeDefined()
    })

    it('should support generationConfig in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 100,
        },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.temperature).toBe(0.7)
      expect(body.generationConfig.topP).toBe(0.9)
      expect(body.generationConfig.maxOutputTokens).toBe(100)
    })

    it('should return usage metadata', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent('Hello')

      expect(result.response.usageMetadata).toBeDefined()
      expect(result.response.usageMetadata?.promptTokenCount).toBe(10)
      expect(result.response.usageMetadata?.candidatesTokenCount).toBe(8)
      expect(result.response.usageMetadata?.totalTokenCount).toBe(18)
    })

    it('should support different models (gemini-pro, gemini-pro-vision)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })

      // Test gemini-pro
      const proModel = genAI.getGenerativeModel({ model: 'gemini-pro' })
      await proModel.generateContent('Hello')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-pro'),
        expect.anything()
      )

      // Test gemini-pro-vision
      const visionModel = genAI.getGenerativeModel({ model: 'gemini-pro-vision' })
      await visionModel.generateContent('Describe this image')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-pro-vision'),
        expect.anything()
      )
    })
  })

  describe('response.text()', () => {
    it('should extract text from response', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent('Hello')

      const text = result.response.text()
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Chat Tests
// =============================================================================

describe('@dotdo/google-ai - Chat', () => {
  describe('startChat', () => {
    it('should start a chat session', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat()

      expect(chat).toBeDefined()
      expect(typeof chat.sendMessage).toBe('function')
    })

    it('should support initial history', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat({
        history: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi! How can I help?' }] },
        ],
      })

      expect(chat).toBeDefined()
      const history = chat.getHistory()
      expect(history).toHaveLength(2)
    })
  })

  describe('sendMessage', () => {
    it('should send a message and receive response', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat()
      const result = await chat.sendMessage('What is 2+2?')

      expect(result.response).toBeDefined()
      expect(result.response.text()).toBeDefined()
    })

    it('should maintain conversation history', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :generateContent', { status: 200, body: expectedResponse.response }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat()

      await chat.sendMessage('Hello')
      await chat.sendMessage('How are you?')

      const history = chat.getHistory()
      expect(history.length).toBeGreaterThanOrEqual(2)
    })

    it('should include history in subsequent requests', async () => {
      const expectedResponse = mockGenerateContentResponse()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse.response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat({
        history: [
          { role: 'user', parts: [{ text: 'My name is Alice' }] },
          { role: 'model', parts: [{ text: 'Nice to meet you Alice!' }] },
        ],
      })

      await chat.sendMessage('What is my name?')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.contents.length).toBeGreaterThan(1)
    })
  })

  describe('getHistory', () => {
    it('should return current conversation history', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat({
        history: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi!' }] },
        ],
      })

      const history = chat.getHistory()
      expect(history).toHaveLength(2)
      expect(history[0].role).toBe('user')
      expect(history[1].role).toBe('model')
    })
  })
})

// =============================================================================
// Embeddings Tests
// =============================================================================

describe('@dotdo/google-ai - Embeddings', () => {
  describe('embedContent', () => {
    it('should generate embeddings for text', async () => {
      const expectedResponse = mockEmbedContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :embedContent', { status: 200, body: expectedResponse }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'embedding-001' })
      const result = await model.embedContent('Hello world')

      expect(result.embedding).toBeDefined()
      expect(result.embedding.values).toBeInstanceOf(Array)
      expect(result.embedding.values.length).toBeGreaterThan(0)
    })

    it('should support Content object input', async () => {
      const expectedResponse = mockEmbedContentResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST :embedContent', { status: 200, body: expectedResponse }],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'embedding-001' })
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text: 'Hello world' }] },
      })

      expect(result.embedding).toBeDefined()
    })
  })

  describe('batchEmbedContents', () => {
    it('should generate embeddings for multiple texts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :batchEmbedContents',
            {
              status: 200,
              body: {
                embeddings: [
                  { values: Array(768).fill(0.1) },
                  { values: Array(768).fill(0.2) },
                  { values: Array(768).fill(0.3) },
                ],
              },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'embedding-001' })
      const result = await model.batchEmbedContents({
        requests: [
          { content: { role: 'user', parts: [{ text: 'Hello' }] } },
          { content: { role: 'user', parts: [{ text: 'World' }] } },
          { content: { role: 'user', parts: [{ text: 'Test' }] } },
        ],
      })

      expect(result.embeddings).toHaveLength(3)
    })
  })
})

// =============================================================================
// Function Calling Tests
// =============================================================================

describe('@dotdo/google-ai - Function Calling', () => {
  const weatherTool: Tool = {
    functionDeclarations: [
      {
        name: 'getWeather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state',
            },
          },
          required: ['location'],
        },
      },
    ],
  }

  describe('tools parameter', () => {
    it('should accept tools in model configuration', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        tools: [weatherTool],
      })

      expect(model).toBeDefined()
    })

    it('should include tools in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        tools: [weatherTool],
      })

      await model.generateContent('What is the weather in San Francisco?')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tools).toBeDefined()
      expect(body.tools[0].functionDeclarations[0].name).toBe('getWeather')
    })
  })

  describe('function call response', () => {
    it('should return function call in response', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :generateContent',
            {
              status: 200,
              body: {
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: [
                        {
                          functionCall: {
                            name: 'getWeather',
                            args: { location: 'San Francisco, CA' },
                          },
                        },
                      ],
                    },
                    finishReason: 'STOP',
                    index: 0,
                  },
                ],
                text: () => '',
              },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        tools: [weatherTool],
      })

      const result = await model.generateContent('What is the weather in San Francisco?')
      const candidate = result.response.candidates?.[0]
      const functionCall = candidate?.content.parts[0] as FunctionCallPart

      expect(functionCall.functionCall).toBeDefined()
      expect(functionCall.functionCall.name).toBe('getWeather')
      expect(functionCall.functionCall.args).toEqual({ location: 'San Francisco, CA' })
    })
  })

  describe('function response handling', () => {
    it('should support function response in conversation', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'The weather in San Francisco is 72F and sunny.' }],
              },
              finishReason: 'STOP',
            },
          ],
          text: () => 'The weather in San Francisco is 72F and sunny.',
        }),
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        tools: [weatherTool],
      })

      const chat = model.startChat()

      // Simulate sending function response
      await chat.sendMessage([
        {
          functionResponse: {
            name: 'getWeather',
            response: { temperature: 72, unit: 'fahrenheit', condition: 'sunny' },
          },
        },
      ])

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.contents).toBeDefined()
    })
  })
})

// =============================================================================
// Streaming Tests
// =============================================================================

describe('@dotdo/google-ai - Streaming', () => {
  describe('generateContentStream', () => {
    it('should return an async iterable stream', async () => {
      const chunks = [
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, index: 0 }],
        },
        {
          candidates: [{ content: { role: 'model', parts: [{ text: ' there!' }] }, index: 0 }],
        },
      ]
      const mockFetch = createMockStreamFetch(chunks)

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContentStream('Tell me a joke')

      expect(result.stream).toBeDefined()
      expect(typeof result.stream[Symbol.asyncIterator]).toBe('function')
    })

    it('should yield chunks with text', async () => {
      const chunks = [
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'Once ' }] }, index: 0 }],
        },
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'upon ' }] }, index: 0 }],
        },
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'a time' }] }, index: 0 }],
        },
      ]
      const mockFetch = createMockStreamFetch(chunks)

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContentStream('Tell me a story')

      const collectedText: string[] = []
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          collectedText.push(text)
        }
      }

      expect(collectedText.join('')).toBe('Once upon a time')
    })

    it('should provide response promise with aggregated result', async () => {
      const chunks = [
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, index: 0 }],
        },
        {
          candidates: [{ content: { role: 'model', parts: [{ text: ' world' }] }, index: 0 }],
        },
      ]
      const mockFetch = createMockStreamFetch(chunks)

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContentStream('Hello')

      // Consume stream first
      for await (const _ of result.stream) {
        // consume
      }

      const response = await result.response
      expect(response.text()).toBe('Hello world')
    })
  })

  describe('chat.sendMessageStream', () => {
    it('should support streaming in chat', async () => {
      const chunks = [
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'I am ' }] }, index: 0 }],
        },
        {
          candidates: [{ content: { role: 'model', parts: [{ text: 'fine!' }] }, index: 0 }],
        },
      ]
      const mockFetch = createMockStreamFetch(chunks)

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const chat = model.startChat()

      const result = await chat.sendMessageStream('How are you?')

      const collectedText: string[] = []
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) {
          collectedText.push(text)
        }
      }

      expect(collectedText.join('')).toBe('I am fine!')
    })
  })
})

// =============================================================================
// Safety Settings Tests
// =============================================================================

describe('@dotdo/google-ai - Safety Settings', () => {
  describe('HarmCategory enum', () => {
    it('should export HarmCategory enum', () => {
      expect(HarmCategory.HARM_CATEGORY_HARASSMENT).toBeDefined()
      expect(HarmCategory.HARM_CATEGORY_HATE_SPEECH).toBeDefined()
      expect(HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT).toBeDefined()
      expect(HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT).toBeDefined()
    })
  })

  describe('HarmBlockThreshold enum', () => {
    it('should export HarmBlockThreshold enum', () => {
      expect(HarmBlockThreshold.BLOCK_NONE).toBeDefined()
      expect(HarmBlockThreshold.BLOCK_LOW_AND_ABOVE).toBeDefined()
      expect(HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE).toBeDefined()
      expect(HarmBlockThreshold.BLOCK_ONLY_HIGH).toBeDefined()
    })
  })

  describe('safetySettings parameter', () => {
    it('should accept safetySettings in model configuration', () => {
      const genAI = new GoogleGenerativeAI('test-api-key')
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
        ],
      })

      expect(model).toBeDefined()
    })

    it('should include safetySettings in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
          },
        ],
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.safetySettings).toHaveLength(2)
      expect(body.safetySettings[0].category).toBe(HarmCategory.HARM_CATEGORY_HARASSMENT)
      expect(body.safetySettings[0].threshold).toBe(HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE)
    })
  })

  describe('safety ratings in response', () => {
    it('should include safety ratings in response', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :generateContent',
            {
              status: 200,
              body: {
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: [{ text: 'Hello!' }],
                    },
                    finishReason: 'STOP',
                    index: 0,
                    safetyRatings: [
                      {
                        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                        probability: 'NEGLIGIBLE',
                      },
                      {
                        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                        probability: 'NEGLIGIBLE',
                      },
                    ],
                  },
                ],
                text: () => 'Hello!',
              },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent('Hello')

      const candidate = result.response.candidates?.[0]
      expect(candidate?.safetyRatings).toBeDefined()
      expect(candidate?.safetyRatings?.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Model Configuration Tests
// =============================================================================

describe('@dotdo/google-ai - Model Configuration', () => {
  describe('generationConfig', () => {
    it('should support temperature', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: { temperature: 0.5 },
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.temperature).toBe(0.5)
    })

    it('should support topK and topP', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: {
          topK: 40,
          topP: 0.95,
        },
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.topK).toBe(40)
      expect(body.generationConfig.topP).toBe(0.95)
    })

    it('should support maxOutputTokens', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: { maxOutputTokens: 2048 },
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.maxOutputTokens).toBe(2048)
    })

    it('should support stopSequences', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: { stopSequences: ['END', 'STOP'] },
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.stopSequences).toEqual(['END', 'STOP'])
    })

    it('should support candidateCount', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockGenerateContentResponse().response,
      })

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({
        model: 'gemini-pro',
        generationConfig: { candidateCount: 3 },
      })

      await model.generateContent('Hello')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.generationConfig.candidateCount).toBe(3)
    })
  })
})

// =============================================================================
// Count Tokens Tests
// =============================================================================

describe('@dotdo/google-ai - Count Tokens', () => {
  describe('countTokens', () => {
    it('should count tokens for text input', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :countTokens',
            {
              status: 200,
              body: { totalTokens: 15 },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.countTokens('Hello, how are you doing today?')

      expect(result.totalTokens).toBe(15)
    })

    it('should count tokens for Content array', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST :countTokens',
            {
              status: 200,
              body: { totalTokens: 25 },
            },
          ],
        ])
      )

      const genAI = new GoogleGenerativeAI('test-api-key', { fetch: mockFetch })
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.countTokens([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ])

      expect(result.totalTokens).toBe(25)
    })
  })
})
