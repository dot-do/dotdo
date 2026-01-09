import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Template Literal API Tests
 *
 * Tests for the template literal functions:
 * - ai`prompt` - general AI completion
 * - write`text` - text generation with structured output
 * - summarize`text` - summarization
 * - list`items` - list generation
 * - extract`data` - data extraction
 * - is`prompt` - binary classification (returns boolean)
 * - decide(options)`prompt` - multi-option classification
 */

import {
  ai,
  write,
  summarize,
  list,
  extract,
  is,
  decide,
  configure,
  getConfig,
  type WriteResult,
  type ExtractResult,
  type PipelinePromise,
} from '../template-literals'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the AIGatewayClient
vi.mock('../../lib/ai/gateway', () => ({
  AIGatewayClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn(),
  })),
}))

import { AIGatewayClient } from '../../lib/ai/gateway'

const mockChat = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(AIGatewayClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    chat: mockChat,
  }))
})

// ============================================================================
// ai`prompt` Tests
// ============================================================================

describe('ai`prompt` - General AI Completion', () => {
  it('executes a simple prompt', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Paris is the capital of France.' })

    const result = await ai`What is the capital of France?`

    expect(result).toBe('Paris is the capital of France.')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('interpolates values in the template', async () => {
    mockChat.mockResolvedValueOnce({ content: 'TypeScript is a typed superset of JavaScript.' })

    const topic = 'TypeScript'
    const result = await ai`Explain ${topic} in simple terms`

    expect(result).toBe('TypeScript is a typed superset of JavaScript.')
    expect(mockChat).toHaveBeenCalledWith([
      { role: 'user', content: 'Explain TypeScript in simple terms' },
    ])
  })

  it('handles multiple interpolations', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Comparison complete.' })

    const lang1 = 'Python'
    const lang2 = 'JavaScript'
    const result = await ai`Compare ${lang1} and ${lang2}`

    expect(result).toBe('Comparison complete.')
    expect(mockChat).toHaveBeenCalledWith([
      { role: 'user', content: 'Compare Python and JavaScript' },
    ])
  })

  it('handles null and undefined values', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Response' })

    const value1 = null
    const value2 = undefined
    await ai`Test ${value1} and ${value2}`

    expect(mockChat).toHaveBeenCalledWith([
      { role: 'user', content: 'Test  and ' },
    ])
  })

  it('returns a PipelinePromise', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Test response' })

    const promise = ai`Test`

    expect(promise).toBeInstanceOf(Promise)
    expect(typeof promise.map).toBe('function')
    expect(typeof promise.catch).toBe('function')
  })

  it('supports .map() transformation', async () => {
    mockChat.mockResolvedValueOnce({ content: 'hello world' })

    const result = await ai`Test`.map((s) => s.toUpperCase())

    expect(result).toBe('HELLO WORLD')
  })

  it('supports .catch() error handling', async () => {
    mockChat.mockRejectedValueOnce(new Error('API Error'))

    const result = await ai`Test`.catch(() => 'fallback')

    expect(result).toBe('fallback')
  })

  it('can be configured with options', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Configured response' })

    const configuredAi = ai.configure({
      temperature: 0.5,
      maxTokens: 100,
      systemPrompt: 'You are a helpful assistant.',
    })

    const result = await configuredAi`Test prompt`

    expect(result).toBe('Configured response')
    expect(mockChat).toHaveBeenCalledWith([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Test prompt' },
    ])
  })
})

// ============================================================================
// write`prompt` Tests
// ============================================================================

describe('write`prompt` - Text Generation with Structured Output', () => {
  it('returns structured WriteResult', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        title: 'Introduction to AI',
        body: 'AI is transforming the world...',
        summary: 'A brief overview of AI.',
      }),
    })

    const result = await write`Write a blog post about AI`

    expect(result.title).toBe('Introduction to AI')
    expect(result.body).toBe('AI is transforming the world...')
    expect(result.summary).toBe('A brief overview of AI.')
  })

  it('supports destructuring', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        title: 'Email Subject',
        body: 'Email body content here.',
      }),
    })

    const { title, body } = await write`Write an email about meeting`

    expect(title).toBe('Email Subject')
    expect(body).toBe('Email body content here.')
  })

  it('interpolates values in the template', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        title: 'Machine Learning Guide',
        body: 'Content about ML...',
      }),
    })

    const topic = 'machine learning'
    const result = await write`Write a guide about ${topic}`

    expect(result.title).toBe('Machine Learning Guide')
  })

  it('parses JSON from code blocks', async () => {
    mockChat.mockResolvedValueOnce({
      content: '```json\n{"title": "Test", "body": "Content"}\n```',
    })

    const result = await write`Write something`

    expect(result.title).toBe('Test')
    expect(result.body).toBe('Content')
  })

  it('returns PipelinePromise with .map()', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ title: 'Test Title', body: 'Test Body' }),
    })

    const result = await write`Test`.map((r) => r.title)

    expect(result).toBe('Test Title')
  })

  it('can be configured with custom options', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ title: 'Custom', body: 'Result' }),
    })

    const configuredWrite = write.configure({
      model: 'gpt-4o',
      temperature: 0.3,
    })

    const result = await configuredWrite`Write with custom config`

    expect(result.title).toBe('Custom')
  })
})

// ============================================================================
// summarize`text` Tests
// ============================================================================

describe('summarize`text` - Summarization', () => {
  it('summarizes text', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'This is a summary of the long article.',
    })

    const longText = 'A very long article about many topics...'
    const result = await summarize`${longText}`

    expect(result).toBe('This is a summary of the long article.')
  })

  it('supports prompt with instructions', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Key points: 1, 2, 3',
    })

    const document = 'Document content here...'
    const result = await summarize`Summarize the key points from: ${document}`

    expect(result).toBe('Key points: 1, 2, 3')
  })

  it('returns PipelinePromise', async () => {
    mockChat.mockResolvedValueOnce({ content: 'summary' })

    const promise = summarize`Test`

    expect(promise).toBeInstanceOf(Promise)
    expect(typeof promise.map).toBe('function')
  })

  it('can be configured with length option', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Short summary.',
    })

    const configuredSummarize = summarize.configure({ length: 'short' })
    const result = await configuredSummarize`Some long text...`

    expect(result).toBe('Short summary.')
  })

  it('can be configured with long length', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'A detailed and comprehensive summary covering all the key points...',
    })

    const configuredSummarize = summarize.configure({ length: 'long' })
    const result = await configuredSummarize`Some text...`

    expect(result).toContain('detailed')
  })
})

// ============================================================================
// list`prompt` Tests
// ============================================================================

describe('list`prompt` - List Generation', () => {
  it('returns array of strings', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify(['JavaScript', 'Python', 'TypeScript', 'Go', 'Rust']),
    })

    const result = await list`List 5 programming languages`

    expect(result).toBeInstanceOf(Array)
    expect(result.length).toBe(5)
    expect(result).toContain('JavaScript')
    expect(result).toContain('Python')
  })

  it('interpolates values', async () => {
    mockChat.mockResolvedValueOnce({
      content: '["Step 1", "Step 2", "Step 3"]',
    })

    const task = 'deploy an application'
    const result = await list`Steps to ${task}`

    expect(result).toEqual(['Step 1', 'Step 2', 'Step 3'])
  })

  it('parses JSON from code blocks', async () => {
    mockChat.mockResolvedValueOnce({
      content: '```json\n["Item 1", "Item 2"]\n```',
    })

    const result = await list`List items`

    expect(result).toEqual(['Item 1', 'Item 2'])
  })

  it('returns PipelinePromise with array methods', async () => {
    mockChat.mockResolvedValueOnce({
      content: '["a", "b", "c"]',
    })

    const result = await list`Test`.map((items) => items.length)

    expect(result).toBe(3)
  })

  it('can be configured with count option', async () => {
    mockChat.mockResolvedValueOnce({
      content: '["Item 1", "Item 2", "Item 3"]',
    })

    const configuredList = list.configure({ count: 3 })
    const result = await configuredList`List items`

    expect(result).toHaveLength(3)
  })
})

// ============================================================================
// extract`data` Tests
// ============================================================================

describe('extract`data` - Data Extraction', () => {
  it('extracts entities from text', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        entities: [
          { name: 'Apple', type: 'company' },
          { name: 'Google', type: 'company' },
        ],
        raw: 'Apple and Google announced...',
      }),
    })

    const article = 'Apple and Google announced new products today.'
    const result = await extract`Extract company names from: ${article}`

    expect(result.entities).toHaveLength(2)
    expect(result.entities[0].name).toBe('Apple')
    expect(result.raw).toContain('Apple')
  })

  it('returns typed ExtractResult', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        entities: [{ date: '2024-01-15', location: 'New York' }],
        raw: 'On January 15, 2024 in New York...',
      }),
    })

    const result = await extract<{ date: string; location: string }>`Extract dates and locations from: ${`Some text`}`

    expect(result.entities[0].date).toBe('2024-01-15')
    expect(result.entities[0].location).toBe('New York')
  })

  it('parses JSON from code blocks', async () => {
    mockChat.mockResolvedValueOnce({
      content: '```json\n{"entities": [{"name": "Test"}], "raw": "test"}\n```',
    })

    const result = await extract`Extract data`

    expect(result.entities).toHaveLength(1)
  })

  it('returns PipelinePromise', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ entities: [{ id: 1 }], raw: 'test' }),
    })

    const result = await extract`Test`.map((r) => r.entities.length)

    expect(result).toBe(1)
  })

  it('can be configured with entity type', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        entities: [{ name: 'John Doe', role: 'CEO' }],
        raw: 'John Doe is the CEO...',
      }),
    })

    const configuredExtract = extract.configure<{ name: string; role: string }>({
      entityType: 'person',
    })

    const result = await configuredExtract`Extract people from: ${`Some text`}`

    expect(result.entities[0].name).toBe('John Doe')
    expect(result.entities[0].role).toBe('CEO')
  })

  it('can be configured with schema', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        entities: [{ name: 'Acme Corp', industry: 'Technology' }],
        raw: 'text',
      }),
    })

    const configuredExtract = extract.configure({
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          industry: { type: 'string' },
        },
      },
    })

    const result = await configuredExtract`Extract companies`

    expect(result.entities[0]).toHaveProperty('name')
    expect(result.entities[0]).toHaveProperty('industry')
  })
})

// ============================================================================
// is`prompt` Tests - Binary Classification
// ============================================================================

describe('is`prompt` - Binary Classification', () => {
  it('returns true for affirmative classification', async () => {
    mockChat.mockResolvedValueOnce({ content: 'true' })

    const message = 'Buy now! Limited time offer! Click here!'
    const result = await is`Is this message spam? ${message}`

    expect(result).toBe(true)
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('returns false for negative classification', async () => {
    mockChat.mockResolvedValueOnce({ content: 'false' })

    const message = 'Hi, can we schedule a meeting for tomorrow?'
    const result = await is`Is this message spam? ${message}`

    expect(result).toBe(false)
  })

  it('parses JSON boolean response', async () => {
    mockChat.mockResolvedValueOnce({ content: JSON.stringify({ result: true }) })

    const result = await is`Is the sky blue?`

    expect(result).toBe(true)
  })

  it('handles yes/no text responses', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Yes, this is definitely spam.' })

    const result = await is`Is this spam?`

    expect(result).toBe(true)
  })

  it('handles no text responses', async () => {
    mockChat.mockResolvedValueOnce({ content: 'No, this is a legitimate message.' })

    const result = await is`Is this spam?`

    expect(result).toBe(false)
  })

  it('returns PipelinePromise', async () => {
    mockChat.mockResolvedValueOnce({ content: 'true' })

    const promise = is`Is this valid?`

    expect(promise).toBeInstanceOf(Promise)
    expect(typeof promise.map).toBe('function')
    expect(typeof promise.catch).toBe('function')
  })

  it('supports .map() transformation', async () => {
    mockChat.mockResolvedValueOnce({ content: 'true' })

    const result = await is`Is this valid?`.map((val) => (val ? 'VALID' : 'INVALID'))

    expect(result).toBe('VALID')
  })

  it('supports .catch() error handling', async () => {
    mockChat.mockRejectedValueOnce(new Error('API Error'))

    const result = await is`Is this valid?`.catch(() => false)

    expect(result).toBe(false)
  })

  it('can be configured with options', async () => {
    mockChat.mockResolvedValueOnce({ content: 'true' })

    const configuredIs = is.configure({
      temperature: 0,
      model: 'gpt-4o',
    })

    const result = await configuredIs`Is this accurate?`

    expect(result).toBe(true)
  })

  it('interpolates multiple values', async () => {
    mockChat.mockResolvedValueOnce({ content: 'true' })

    const text = 'Hello world'
    const language = 'English'
    const result = await is`Is "${text}" written in ${language}?`

    expect(result).toBe(true)
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('Hello world') }),
      ])
    )
  })

  it('defaults to false for unclear responses', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Maybe, I am not sure.' })

    const result = await is`Is this certain?`

    expect(result).toBe(false)
  })
})

// ============================================================================
// decide`prompt` Tests - Multi-Option Classification
// ============================================================================

describe('decide`prompt` - Multi-Option Classification', () => {
  it('returns selected option from choices', async () => {
    mockChat.mockResolvedValueOnce({ content: 'positive' })

    const text = 'I love this product!'
    const result = await decide(['positive', 'negative', 'neutral'])`What is the sentiment? ${text}`

    expect(result).toBe('positive')
  })

  it('returns exact option match', async () => {
    mockChat.mockResolvedValueOnce({ content: 'B' })

    const result = await decide(['A', 'B', 'C'])`Which category?`

    expect(result).toBe('B')
  })

  it('handles JSON response with selection', async () => {
    mockChat.mockResolvedValueOnce({ content: JSON.stringify({ choice: 'urgent' }) })

    const result = await decide(['urgent', 'normal', 'low'])`Classify priority`

    expect(result).toBe('urgent')
  })

  it('finds option within longer response text', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Based on the analysis, I classify this as: negative sentiment.',
    })

    const result = await decide(['positive', 'negative', 'neutral'])`Sentiment?`

    expect(result).toBe('negative')
  })

  it('returns PipelinePromise', async () => {
    mockChat.mockResolvedValueOnce({ content: 'option1' })

    const promise = decide(['option1', 'option2'])`Choose`

    expect(promise).toBeInstanceOf(Promise)
    expect(typeof promise.map).toBe('function')
    expect(typeof promise.catch).toBe('function')
  })

  it('supports .map() transformation', async () => {
    mockChat.mockResolvedValueOnce({ content: 'high' })

    const result = await decide(['low', 'medium', 'high'])`Priority level`.map((p) =>
      p.toUpperCase()
    )

    expect(result).toBe('HIGH')
  })

  it('supports .catch() error handling', async () => {
    mockChat.mockRejectedValueOnce(new Error('API Error'))

    const result = await decide(['a', 'b'])`Choose`.catch(() => 'a' as const)

    expect(result).toBe('a')
  })

  it('can be configured with options', async () => {
    mockChat.mockResolvedValueOnce({ content: 'bug' })

    const configuredDecide = decide.configure({
      temperature: 0,
      model: 'gpt-4o',
    })

    const result = await configuredDecide(['feature', 'bug', 'task'])`Classify this issue`

    expect(result).toBe('bug')
  })

  it('supports typed options with literal types', async () => {
    mockChat.mockResolvedValueOnce({ content: 'approved' })

    type Status = 'pending' | 'approved' | 'rejected'
    const options: Status[] = ['pending', 'approved', 'rejected']

    const result = await decide(options)`What status?`

    // TypeScript should infer result as Status
    const status: Status = result
    expect(status).toBe('approved')
  })

  it('returns first option when no match found', async () => {
    mockChat.mockResolvedValueOnce({ content: 'something completely different' })

    const result = await decide(['first', 'second', 'third'])`Choose`

    expect(result).toBe('first')
  })

  it('handles case-insensitive matching', async () => {
    mockChat.mockResolvedValueOnce({ content: 'POSITIVE' })

    const result = await decide(['positive', 'negative', 'neutral'])`Sentiment`

    expect(result).toBe('positive')
  })

  it('interpolates values in prompt', async () => {
    mockChat.mockResolvedValueOnce({ content: 'tech' })

    const article = 'New iPhone released'
    const result = await decide(['tech', 'sports', 'politics'])`Category for: ${article}`

    expect(result).toBe('tech')
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('New iPhone released') }),
      ])
    )
  })

  it('works with number options', async () => {
    mockChat.mockResolvedValueOnce({ content: '2' })

    const result = await decide([1, 2, 3, 4, 5])`Rate from 1-5`

    expect(result).toBe(2)
  })

  it('preserves option order for priority matching', async () => {
    // When multiple options could match, prefer earlier ones
    mockChat.mockResolvedValueOnce({ content: 'both positive and very positive' })

    const result = await decide(['positive', 'very positive', 'negative'])`Sentiment`

    expect(result).toBe('positive')
  })
})

// ============================================================================
// Configuration Tests
// ============================================================================

describe('Global Configuration', () => {
  afterEach(() => {
    // Reset to defaults
    configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    })
  })

  it('configure() updates global settings', () => {
    configure({
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
    })

    const config = getConfig()

    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.temperature).toBe(0.5)
  })

  it('getConfig() returns current configuration', () => {
    const config = getConfig()

    expect(config).toHaveProperty('provider')
    expect(config).toHaveProperty('model')
    expect(config).toHaveProperty('temperature')
  })

  it('configuration is used by template functions', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Response' })

    configure({
      provider: 'openai',
      model: 'gpt-4o-mini',
    })

    await ai`Test`

    // AIGatewayClient should be instantiated with the new config
    expect(AIGatewayClient).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
      }),
      expect.any(Object)
    )
  })
})

// ============================================================================
// PipelinePromise Tests
// ============================================================================

describe('PipelinePromise', () => {
  it('supports chaining with .map()', async () => {
    mockChat.mockResolvedValueOnce({ content: 'hello' })

    const result = await ai`Test`
      .map((s) => s.toUpperCase())
      .map((s) => s + '!')

    expect(result).toBe('HELLO!')
  })

  it('supports error handling with .catch()', async () => {
    mockChat.mockRejectedValueOnce(new Error('Network error'))

    const result = await ai`Test`
      .catch((error) => `Error: ${error.message}`)

    expect(result).toBe('Error: Network error')
  })

  it('can chain .map() after .catch()', async () => {
    mockChat.mockRejectedValueOnce(new Error('Fail'))

    const result = await ai`Test`
      .catch(() => 'recovered')
      .map((s) => s.toUpperCase())

    expect(result).toBe('RECOVERED')
  })

  it('passes through successful results in .catch()', async () => {
    mockChat.mockResolvedValueOnce({ content: 'success' })

    const result = await ai`Test`
      .catch(() => 'fallback')
      .map((s) => s.toUpperCase())

    expect(result).toBe('SUCCESS')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('throws error for invalid JSON in write()', async () => {
    mockChat.mockResolvedValueOnce({ content: 'not valid json' })

    await expect(write`Test`).rejects.toThrow('Failed to parse JSON')
  })

  it('throws error for invalid JSON in list()', async () => {
    mockChat.mockResolvedValueOnce({ content: 'not an array' })

    await expect(list`Test`).rejects.toThrow('Failed to parse JSON')
  })

  it('throws error for invalid JSON in extract()', async () => {
    mockChat.mockResolvedValueOnce({ content: 'invalid' })

    await expect(extract`Test`).rejects.toThrow('Failed to parse JSON')
  })

  it('propagates API errors', async () => {
    mockChat.mockRejectedValueOnce(new Error('API rate limit exceeded'))

    await expect(ai`Test`).rejects.toThrow('API rate limit exceeded')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('all functions use the same client configuration', async () => {
    configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      gateway: 'my-gateway',
    })

    mockChat.mockResolvedValue({ content: '{}' })

    await ai`Test 1`
    await summarize`Test 2`

    // Both calls should use same config
    expect(AIGatewayClient).toHaveBeenCalledTimes(2)
    const calls = (AIGatewayClient as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0].gateway).toBe('my-gateway')
    expect(calls[1][0].gateway).toBe('my-gateway')
  })

  it('configured functions override global config', async () => {
    configure({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    })

    mockChat.mockResolvedValueOnce({ content: 'Result' })

    const customAi = ai.configure({
      model: 'gpt-4o',
      provider: 'openai',
    })

    await customAi`Test`

    expect(AIGatewayClient).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o',
      }),
      expect.any(Object)
    )
  })
})
