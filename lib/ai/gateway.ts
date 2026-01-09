/**
 * AI Gateway Client
 *
 * Unified AI client that routes to Workers AI or external providers via Cloudflare AI Gateway.
 * Provides a consistent interface for chat completions across multiple providers.
 *
 * Gateway URL Patterns:
 * - With gateway: https://gateway.ai.cloudflare.com/v1/{gateway_id}/{provider}/...
 * - Without gateway (direct):
 *   - OpenAI: https://api.openai.com/v1/chat/completions
 *   - Anthropic: https://api.anthropic.com/v1/messages
 *   - Google: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */

import { AIConfig, AIProvider } from '../../types/AI'

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for AI Gateway
 */
export interface AIGatewayEnv {
  /** Workers AI binding */
  AI?: { run: (model: string, params: unknown) => Promise<unknown> }
  /** AI Gateway ID from environment */
  AI_GATEWAY_ID?: string
  /** OpenAI API key */
  OPENAI_API_KEY?: string
  /** Anthropic API key */
  ANTHROPIC_API_KEY?: string
  /** Google API key */
  GOOGLE_API_KEY?: string
}

/**
 * Chat message format (OpenAI-compatible)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Chat response format
 */
export interface ChatResponse {
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

// ============================================================================
// Provider Response Types
// ============================================================================

interface WorkersAIResponse {
  response: string
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

interface GoogleResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string
      }>
    }
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
  }
}

interface ErrorResponse {
  error?: {
    message?: string
  }
}

// ============================================================================
// AIGatewayClient
// ============================================================================

/**
 * Unified AI client that routes to Workers AI or external providers via AI Gateway
 */
export class AIGatewayClient {
  constructor(
    private config: AIConfig,
    private env: AIGatewayEnv
  ) {}

  /**
   * Send chat messages to the configured AI provider
   */
  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    switch (this.config.provider) {
      case 'workers-ai':
        return this.chatWorkersAI(messages)
      case 'openai':
        return this.chatOpenAI(messages)
      case 'anthropic':
        return this.chatAnthropic(messages)
      case 'google':
        return this.chatGoogle(messages)
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`)
    }
  }

  // ============================================================================
  // Workers AI
  // ============================================================================

  private async chatWorkersAI(messages: ChatMessage[]): Promise<ChatResponse> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding not available')
    }

    const params: Record<string, unknown> = {
      messages,
    }

    if (this.config.temperature !== undefined) {
      params.temperature = this.config.temperature
    }

    if (this.config.maxTokens !== undefined) {
      params.max_tokens = this.config.maxTokens
    }

    const response = (await this.env.AI.run(
      this.config.model,
      params
    )) as WorkersAIResponse

    return {
      content: response.response,
    }
  }

  // ============================================================================
  // OpenAI
  // ============================================================================

  private async chatOpenAI(messages: ChatMessage[]): Promise<ChatResponse> {
    if (!this.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required')
    }

    const url = this.getOpenAIUrl()
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    }

    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature
    }

    if (this.config.maxTokens !== undefined) {
      body.max_tokens = this.config.maxTokens
    }

    const response = await this.fetchWithErrorHandling<OpenAIResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    })

    return {
      content: response.choices[0]?.message?.content ?? '',
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    }
  }

  private getOpenAIUrl(): string {
    const gateway = this.getGatewayId()
    if (gateway) {
      return `https://gateway.ai.cloudflare.com/v1/${gateway}/openai/chat/completions`
    }
    return 'https://api.openai.com/v1/chat/completions'
  }

  // ============================================================================
  // Anthropic
  // ============================================================================

  private async chatAnthropic(messages: ChatMessage[]): Promise<ChatResponse> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required')
    }

    const url = this.getAnthropicUrl()

    // Extract system message and convert to Anthropic format
    const systemMessage = messages.find((m) => m.role === 'system')
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: nonSystemMessages,
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }

    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature
    }

    if (this.config.maxTokens !== undefined) {
      body.max_tokens = this.config.maxTokens
    } else {
      // Anthropic requires max_tokens
      body.max_tokens = 4096
    }

    const response = await this.fetchWithErrorHandling<AnthropicResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const textContent = response.content.find((c) => c.type === 'text')

    return {
      content: textContent?.text ?? '',
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
    }
  }

  private getAnthropicUrl(): string {
    const gateway = this.getGatewayId()
    if (gateway) {
      return `https://gateway.ai.cloudflare.com/v1/${gateway}/anthropic/v1/messages`
    }
    return 'https://api.anthropic.com/v1/messages'
  }

  // ============================================================================
  // Google
  // ============================================================================

  private async chatGoogle(messages: ChatMessage[]): Promise<ChatResponse> {
    if (!this.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required')
    }

    const url = this.getGoogleUrl()

    // Convert messages to Google format
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const body: Record<string, unknown> = {
      contents,
    }

    // Add generation config if we have parameters
    if (this.config.temperature !== undefined || this.config.maxTokens !== undefined) {
      const generationConfig: Record<string, unknown> = {}
      if (this.config.temperature !== undefined) {
        generationConfig.temperature = this.config.temperature
      }
      if (this.config.maxTokens !== undefined) {
        generationConfig.maxOutputTokens = this.config.maxTokens
      }
      body.generationConfig = generationConfig
    }

    const response = await this.fetchWithErrorHandling<GoogleResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.getGatewayId() ? { 'x-goog-api-key': this.env.GOOGLE_API_KEY } : {}),
      },
      body: JSON.stringify(body),
    })

    const textPart = response.candidates?.[0]?.content?.parts?.[0]

    return {
      content: textPart?.text ?? '',
      usage: response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount,
            outputTokens: response.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    }
  }

  private getGoogleUrl(): string {
    const gateway = this.getGatewayId()
    if (gateway) {
      return `https://gateway.ai.cloudflare.com/v1/${gateway}/google-ai-studio/v1/models/${this.config.model}:generateContent`
    }
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.env.GOOGLE_API_KEY}`
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Get the gateway ID from config or environment
   */
  private getGatewayId(): string | undefined {
    return this.config.gateway || this.env.AI_GATEWAY_ID
  }

  /**
   * Fetch with error handling
   */
  private async fetchWithErrorHandling<T>(
    url: string,
    init: RequestInit
  ): Promise<T> {
    const response = await fetch(url, init)

    if (!response.ok) {
      let errorMessage: string | undefined

      try {
        const errorData = (await response.json()) as ErrorResponse
        errorMessage = errorData.error?.message
      } catch {
        // Ignore JSON parse errors
      }

      if (errorMessage) {
        throw new Error(errorMessage)
      }

      throw new Error(`API request failed: ${response.status}`)
    }

    return response.json() as Promise<T>
  }
}
