/**
 * Google AI (Gemini) Provider Adapter
 *
 * Handles requests to Google AI API with streaming support.
 *
 * @module llm/providers/google
 */

import type {
  ProviderAdapter,
  LLMEnv,
  LLMRequestContext,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIChatMessage,
} from '../types'

// ============================================================================
// Google AI Types
// ============================================================================

interface GoogleAIContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface GoogleAIRequest {
  contents: GoogleAIContent[]
  systemInstruction?: { parts: Array<{ text: string }> }
  generationConfig?: {
    temperature?: number
    topP?: number
    topK?: number
    maxOutputTokens?: number
    stopSequences?: string[]
  }
  tools?: Array<{
    functionDeclarations: Array<{
      name: string
      description?: string
      parameters?: Record<string, unknown>
    }>
  }>
}

interface GoogleAIResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>
      role: string
    }
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER'
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

// ============================================================================
// Google AI Provider
// ============================================================================

export class GoogleAIAdapter implements ProviderAdapter {
  readonly name = 'google' as const

  private getBaseUrl(env: LLMEnv, model: string): string {
    // Use AI Gateway if available
    if (env.AI_GATEWAY_ID) {
      return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/google-ai-studio/v1/models/${model}`
    }
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}`
  }

  async chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse> {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required')
    }

    const model = this.mapModel(request.model)
    const googleRequest = this.convertToGoogleFormat(request)

    const baseUrl = this.getBaseUrl(env, model)
    const url = env.AI_GATEWAY_ID
      ? `${baseUrl}:generateContent`
      : `${baseUrl}:generateContent?key=${env.GOOGLE_API_KEY}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (env.AI_GATEWAY_ID) {
      headers['x-goog-api-key'] = env.GOOGLE_API_KEY
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(googleRequest),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `Google AI error: ${response.status}`)
    }

    const result = await response.json() as GoogleAIResponse

    return this.convertToOpenAIFormat(result, request.model)
  }

  async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required')
    }

    const model = this.mapModel(request.model)
    const googleRequest = this.convertToGoogleFormat(request)

    const baseUrl = this.getBaseUrl(env, model)
    const url = env.AI_GATEWAY_ID
      ? `${baseUrl}:streamGenerateContent?alt=sse`
      : `${baseUrl}:streamGenerateContent?alt=sse&key=${env.GOOGLE_API_KEY}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (env.AI_GATEWAY_ID) {
      headers['x-goog-api-key'] = env.GOOGLE_API_KEY
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(googleRequest),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `Google AI error: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    const requestId = `chatcmpl-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          try {
            const data = JSON.parse(trimmed.slice(6)) as GoogleAIResponse
            const candidate = data.candidates?.[0]

            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  yield {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created,
                    model: request.model,
                    choices: [{
                      index: 0,
                      delta: { content: part.text },
                      finish_reason: null,
                    }],
                  }
                }

                if (part.functionCall) {
                  yield {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created,
                    model: request.model,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          id: `call_${Date.now()}`,
                          type: 'function',
                          function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args),
                          },
                        }],
                      },
                      finish_reason: null,
                    }],
                  }
                }
              }
            }

            if (candidate?.finishReason) {
              const finishReason = candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop'
              yield {
                id: requestId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: finishReason,
                }],
                usage: data.usageMetadata ? {
                  prompt_tokens: data.usageMetadata.promptTokenCount,
                  completion_tokens: data.usageMetadata.candidatesTokenCount,
                  total_tokens: data.usageMetadata.totalTokenCount,
                } : undefined,
              }
            }
          } catch (error) {
            // Log malformed JSON so data loss is visible
            console.warn('[llm/google] SSE JSON parse failed - event dropped:', {
              data: line.slice(0, 100) + (line.length > 100 ? '...' : ''),
              error: error instanceof Error ? error.message : 'unknown',
            })
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private mapModel(model: string): string {
    const modelMap: Record<string, string> = {
      // Direct mappings
      'gemini-1.5-pro': 'gemini-1.5-pro',
      'gemini-1.5-flash': 'gemini-1.5-flash',
      'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
      'gemini-pro': 'gemini-1.5-pro',
      'gemini-flash': 'gemini-1.5-flash',

      // OpenAI model fallbacks
      'gpt-4o': 'gemini-1.5-pro',
      'gpt-4o-mini': 'gemini-1.5-flash',
      'gpt-4': 'gemini-1.5-pro',
      'gpt-3.5-turbo': 'gemini-1.5-flash',

      // Claude model fallbacks
      'claude-3-5-sonnet': 'gemini-1.5-pro',
      'claude-3-5-haiku': 'gemini-1.5-flash',
      'claude-3-opus': 'gemini-1.5-pro',
    }

    const lowerModel = model.toLowerCase()
    for (const [key, value] of Object.entries(modelMap)) {
      if (lowerModel.includes(key)) {
        return value
      }
    }

    // If it's already a Gemini model, use as-is
    if (model.toLowerCase().startsWith('gemini')) {
      return model
    }

    // Default to Gemini 1.5 Flash
    return 'gemini-1.5-flash'
  }

  private convertToGoogleFormat(request: OpenAIChatCompletionRequest): GoogleAIRequest {
    const contents: GoogleAIContent[] = []
    let systemInstruction: { parts: Array<{ text: string }> } | undefined

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // Combine system messages
        if (systemInstruction) {
          systemInstruction.parts.push({ text: msg.content ?? '' })
        } else {
          systemInstruction = { parts: [{ text: msg.content ?? '' }] }
        }
      } else if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content ?? '' }],
        })
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content ?? '' }],
        })
      } else if (msg.role === 'tool') {
        // Tool results go into user messages for Gemini
        contents.push({
          role: 'user',
          parts: [{ text: `Tool result for ${msg.name ?? 'unknown'}: ${msg.content ?? ''}` }],
        })
      }
    }

    const googleRequest: GoogleAIRequest = {
      contents,
      systemInstruction,
    }

    // Add generation config
    if (request.temperature !== undefined || request.top_p !== undefined || request.max_tokens !== undefined || request.stop !== undefined) {
      googleRequest.generationConfig = {}

      if (request.temperature !== undefined) {
        googleRequest.generationConfig.temperature = request.temperature
      }
      if (request.top_p !== undefined) {
        googleRequest.generationConfig.topP = request.top_p
      }
      if (request.max_tokens !== undefined) {
        googleRequest.generationConfig.maxOutputTokens = request.max_tokens
      }
      if (request.stop !== undefined) {
        googleRequest.generationConfig.stopSequences = typeof request.stop === 'string'
          ? [request.stop]
          : request.stop
      }
    }

    // Convert tools
    if (request.tools) {
      googleRequest.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }]
    }

    return googleRequest
  }

  private convertToOpenAIFormat(
    response: GoogleAIResponse,
    requestModel: string
  ): OpenAIChatCompletionResponse {
    const candidate = response.candidates?.[0]
    const message: OpenAIChatMessage = {
      role: 'assistant',
      content: null,
    }

    if (candidate?.content?.parts) {
      const textParts = candidate.content.parts
        .filter((p): p is { text: string } => !!p.text)
        .map((p) => p.text)

      if (textParts.length > 0) {
        message.content = textParts.join('')
      }

      const functionCalls = candidate.content.parts.filter(
        (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
          !!p.functionCall
      )

      if (functionCalls.length > 0) {
        message.tool_calls = functionCalls.map((fc, i) => ({
          id: `call_${Date.now()}_${i}`,
          type: 'function' as const,
          function: {
            name: fc.functionCall.name,
            arguments: JSON.stringify(fc.functionCall.args),
          },
        }))
      }
    }

    const finishReasonMap: Record<string, 'stop' | 'length' | 'tool_calls' | 'content_filter'> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'stop',
      OTHER: 'stop',
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReasonMap[candidate?.finishReason ?? 'STOP'] ?? 'stop',
      }],
      usage: response.usageMetadata ? {
        prompt_tokens: response.usageMetadata.promptTokenCount,
        completion_tokens: response.usageMetadata.candidatesTokenCount,
        total_tokens: response.usageMetadata.totalTokenCount,
      } : {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    }
  }

  canHandle(model: string): boolean {
    const googleModels = ['gemini', 'google']
    return googleModels.some((m) => model.toLowerCase().includes(m.toLowerCase()))
  }

  listModels(): string[] {
    return [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash-exp',
      'gemini-pro',
    ]
  }
}

export const googleAdapter = new GoogleAIAdapter()
