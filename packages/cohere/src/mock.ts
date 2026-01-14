/**
 * @dotdo/cohere - In-Memory Mock Backend
 *
 * Provides an in-memory mock implementation of the Cohere API for testing.
 * Supports all major endpoints: generate, chat, embed, rerank, classify.
 */

import type {
  GenerateRequest,
  GenerateResponse,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  RerankRequest,
  RerankResponse,
  ClassifyRequest,
  ClassifyResponse,
  Generation,
  Classification,
  RerankResult,
} from './types'

// =============================================================================
// Types
// =============================================================================

type ApiEndpoint = 'generate' | 'chat' | 'embed' | 'rerank' | 'classify'

interface MockError {
  status: number
  message: string
}

type CallHistoryEntry = GenerateRequest | ChatRequest | EmbedRequest | RerankRequest | ClassifyRequest

// =============================================================================
// Mock Backend
// =============================================================================

/**
 * In-memory mock backend for testing Cohere API integrations
 */
export class MockCohereBackend {
  private customResponses: Map<ApiEndpoint, unknown> = new Map()
  private errors: Map<ApiEndpoint, MockError> = new Map()
  private callHistory: Map<ApiEndpoint, CallHistoryEntry[]> = new Map()
  private idCounter = 0

  constructor() {
    // Initialize call history for each endpoint
    this.callHistory.set('generate', [])
    this.callHistory.set('chat', [])
    this.callHistory.set('embed', [])
    this.callHistory.set('rerank', [])
    this.callHistory.set('classify', [])
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`
  }

  /**
   * Fetch implementation that routes to mock handlers
   */
  fetch = async (url: string, options?: RequestInit): Promise<Response> => {
    const urlObj = new URL(url)
    const path = urlObj.pathname
    const body = options?.body ? JSON.parse(options.body as string) : {}

    // Route to appropriate handler
    if (path === '/v1/generate') {
      return this.handleGenerate(body)
    } else if (path === '/v2/chat') {
      return this.handleChat(body)
    } else if (path === '/v2/embed') {
      return this.handleEmbed(body)
    } else if (path === '/v2/rerank') {
      return this.handleRerank(body)
    } else if (path === '/v1/classify') {
      return this.handleClassify(body)
    }

    return this.createResponse({ message: 'Not found' }, 404)
  }

  /**
   * Set a custom response for an endpoint
   */
  setResponse(endpoint: ApiEndpoint, response: unknown): void {
    this.customResponses.set(endpoint, response)
  }

  /**
   * Set an error response for an endpoint
   */
  setError(endpoint: ApiEndpoint, status: number, message: string): void {
    this.errors.set(endpoint, { status, message })
  }

  /**
   * Get call history for an endpoint
   */
  getCallHistory(endpoint: ApiEndpoint): CallHistoryEntry[] {
    return this.callHistory.get(endpoint) ?? []
  }

  /**
   * Reset all custom responses, errors, and call history
   */
  reset(): void {
    this.customResponses.clear()
    this.errors.clear()
    for (const key of this.callHistory.keys()) {
      this.callHistory.set(key, [])
    }
    this.idCounter = 0
  }

  // ===========================================================================
  // Handlers
  // ===========================================================================

  private handleGenerate(body: GenerateRequest & { num_generations?: number }): Response {
    this.callHistory.get('generate')!.push(body as GenerateRequest)

    // Check for error
    const error = this.errors.get('generate')
    if (error) {
      return this.createResponse({ message: error.message }, error.status)
    }

    // Check for custom response
    const customResponse = this.customResponses.get('generate')
    if (customResponse) {
      return this.createResponse(customResponse, 200)
    }

    // Generate mock response - handle both camelCase and snake_case
    const numGenerations = body.num_generations ?? body.numGenerations ?? 1
    const generations: Generation[] = []

    for (let i = 0; i < numGenerations; i++) {
      generations.push({
        id: this.generateId('gen'),
        text: this.generateMockText(body.prompt),
        index: i,
      })
    }

    const response: GenerateResponse = {
      id: this.generateId('gen'),
      prompt: body.prompt,
      generations,
      meta: {
        api_version: { version: '1' },
        billed_units: {
          input_tokens: Math.ceil(body.prompt.length / 4),
          output_tokens: Math.ceil(generations[0].text.length / 4),
        },
      },
    }

    return this.createResponse(response, 200)
  }

  private handleChat(body: ChatRequest & { messages?: Array<{ role: string; content: string }> }): Response {
    this.callHistory.get('chat')!.push(body as ChatRequest)

    // Check for error
    const error = this.errors.get('chat')
    if (error) {
      return this.createResponse({ message: error.message }, error.status)
    }

    // Check for custom response
    const customResponse = this.customResponses.get('chat')
    if (customResponse) {
      return this.createResponse(customResponse, 200)
    }

    // Extract the user message
    const userMessage = body.messages?.find(m => m.role === 'user')?.content ?? body.message ?? ''

    // Generate mock response
    const response: ChatResponse = {
      id: this.generateId('chat'),
      finish_reason: 'COMPLETE',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: this.generateMockChatResponse(userMessage) }],
      },
      usage: {
        billed_units: {
          input_tokens: Math.ceil(userMessage.length / 4),
          output_tokens: 50,
        },
        tokens: {
          input_tokens: Math.ceil(userMessage.length / 4),
          output_tokens: 50,
        },
      },
    }

    return this.createResponse(response, 200)
  }

  private handleEmbed(body: EmbedRequest & { output_dimension?: number }): Response {
    this.callHistory.get('embed')!.push(body as EmbedRequest)

    // Check for error
    const error = this.errors.get('embed')
    if (error) {
      return this.createResponse({ message: error.message }, error.status)
    }

    // Check for custom response
    const customResponse = this.customResponses.get('embed')
    if (customResponse) {
      return this.createResponse(customResponse, 200)
    }

    // Generate mock embeddings
    const dimension = body.output_dimension ?? body.outputDimension ?? 1024
    const embeddings = body.texts.map(() => this.generateMockEmbedding(dimension))

    const response: EmbedResponse = {
      id: this.generateId('embed'),
      response_type: 'embeddings_by_type',
      embeddings: {
        float: embeddings,
      },
      texts: body.texts,
      meta: {
        api_version: { version: '2' },
        billed_units: {
          input_tokens: body.texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
        },
      },
    }

    return this.createResponse(response, 200)
  }

  private handleRerank(body: RerankRequest & { top_n?: number }): Response {
    this.callHistory.get('rerank')!.push(body as RerankRequest)

    // Check for error
    const error = this.errors.get('rerank')
    if (error) {
      return this.createResponse({ message: error.message }, error.status)
    }

    // Check for custom response
    const customResponse = this.customResponses.get('rerank')
    if (customResponse) {
      return this.createResponse(customResponse, 200)
    }

    // Generate mock scores based on simple word overlap
    const queryWords = new Set(body.query.toLowerCase().split(/\s+/))
    const results: RerankResult[] = body.documents.map((doc, index) => {
      const docWords = new Set(doc.toLowerCase().split(/\s+/))
      const overlap = [...queryWords].filter(w => docWords.has(w)).length
      const score = Math.min(0.99, (overlap / Math.max(queryWords.size, 1)) * 0.8 + Math.random() * 0.2)
      return { index, relevance_score: score }
    })

    // Sort by score descending
    results.sort((a, b) => b.relevance_score - a.relevance_score)

    // Apply topN limit
    const topN = body.top_n ?? body.topN ?? results.length
    const limitedResults = results.slice(0, topN)

    const response: RerankResponse = {
      id: this.generateId('rerank'),
      results: limitedResults,
      meta: {
        api_version: { version: '2' },
        billed_units: { search_units: 1 },
      },
    }

    return this.createResponse(response, 200)
  }

  private handleClassify(body: ClassifyRequest): Response {
    this.callHistory.get('classify')!.push(body)

    // Check for error
    const error = this.errors.get('classify')
    if (error) {
      return this.createResponse({ message: error.message }, error.status)
    }

    // Check for custom response
    const customResponse = this.customResponses.get('classify')
    if (customResponse) {
      return this.createResponse(customResponse, 200)
    }

    // Get unique labels from examples
    const labels = [...new Set(body.examples?.map(e => e.label) ?? ['positive', 'negative'])]

    // Generate mock classifications
    const classifications: Classification[] = body.inputs.map((input, i) => {
      // Simple heuristic: positive words get higher positive confidence
      const positiveWords = ['good', 'great', 'love', 'wonderful', 'amazing', 'happy', 'excellent']
      const negativeWords = ['bad', 'hate', 'terrible', 'awful', 'sad', 'poor', 'horrible']

      const inputLower = input.toLowerCase()
      const posScore = positiveWords.filter(w => inputLower.includes(w)).length
      const negScore = negativeWords.filter(w => inputLower.includes(w)).length

      const totalScore = posScore + negScore || 1
      const positiveConfidence = posScore / totalScore || 0.5

      const labelConfidences: Record<string, { confidence: number }> = {}
      labels.forEach((label, idx) => {
        if (label.toLowerCase().includes('positive') || label.toLowerCase().includes('good')) {
          labelConfidences[label] = { confidence: positiveConfidence }
        } else if (label.toLowerCase().includes('negative') || label.toLowerCase().includes('bad')) {
          labelConfidences[label] = { confidence: 1 - positiveConfidence }
        } else {
          labelConfidences[label] = { confidence: 1 / labels.length }
        }
      })

      const sortedLabels = Object.entries(labelConfidences).sort((a, b) => b[1].confidence - a[1].confidence)
      const prediction = sortedLabels[0][0]
      const confidence = sortedLabels[0][1].confidence

      return {
        id: this.generateId('class'),
        input,
        prediction,
        predictions: [prediction],
        confidence,
        confidences: [confidence],
        labels: labelConfidences,
        classification_type: 'single-label' as const,
      }
    })

    const response: ClassifyResponse = {
      id: this.generateId('classify'),
      classifications,
      meta: {
        api_version: { version: '1' },
        billed_units: { classifications: body.inputs.length },
      },
    }

    return this.createResponse(response, 200)
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private createResponse(body: unknown, status: number): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
    } as Response
  }

  private generateMockText(prompt: string): string {
    const responses = [
      `Based on your prompt about "${prompt.slice(0, 20)}...", here's a thoughtful response.`,
      `This is a generated completion for the given prompt.`,
      `Mock response generated for testing purposes.`,
    ]
    return responses[Math.floor(Math.random() * responses.length)]
  }

  private generateMockChatResponse(message: string): string {
    const responses = [
      `Thank you for your message. I understand you're asking about "${message.slice(0, 30)}...". Let me help you with that.`,
      `I've processed your request and here's my response.`,
      `That's a great question! Here's what I can tell you.`,
    ]
    return responses[Math.floor(Math.random() * responses.length)]
  }

  private generateMockEmbedding(dimension: number): number[] {
    // Generate a normalized random embedding
    const embedding = Array.from({ length: dimension }, () => Math.random() * 2 - 1)
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
    return embedding.map(val => val / magnitude)
  }
}
