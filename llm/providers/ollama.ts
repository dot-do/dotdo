/**
 * Ollama Provider Adapter
 *
 * Handles requests to local Ollama server with streaming support.
 *
 * @module llm/providers/ollama
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
// Ollama Types
// ============================================================================

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChatRequest {
  model: string
  messages: OllamaMessage[]
  stream?: boolean
  options?: {
    temperature?: number
    top_p?: number
    num_predict?: number
    stop?: string[]
  }
}

interface OllamaChatResponse {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

// ============================================================================
// Ollama Provider
// ============================================================================

export class OllamaAdapter implements ProviderAdapter {
  readonly name = 'ollama' as const

  private getBaseUrl(env: LLMEnv): string {
    return env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  }

  async chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse> {
    const baseUrl = this.getBaseUrl(env)
    const ollamaRequest = this.convertToOllamaFormat(request)

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...ollamaRequest, stream: false }),
    })

    if (!response.ok) {
      const error = await response.text().catch(() => '')
      throw new Error(`Ollama error: ${response.status} - ${error}`)
    }

    const result = await response.json() as OllamaChatResponse

    return this.convertToOpenAIFormat(result, request.model)
  }

  async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    const baseUrl = this.getBaseUrl(env)
    const ollamaRequest = this.convertToOllamaFormat(request)

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...ollamaRequest, stream: true }),
    })

    if (!response.ok) {
      const error = await response.text().catch(() => '')
      throw new Error(`Ollama error: ${response.status} - ${error}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    const requestId = `chatcmpl-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let completionTokens = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const data = JSON.parse(line) as OllamaChatResponse

            // Track token counts from final response
            if (data.prompt_eval_count) {
              promptTokens = data.prompt_eval_count
            }
            if (data.eval_count) {
              completionTokens = data.eval_count
            }

            if (data.message?.content) {
              yield {
                id: requestId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: { content: data.message.content },
                  finish_reason: null,
                }],
              }
            }

            if (data.done) {
              yield {
                id: requestId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                }],
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  total_tokens: promptTokens + completionTokens,
                },
              }
            }
          } catch (error) {
            // Log malformed JSON so data loss is visible
            console.warn('[llm/ollama] JSON parse failed - event dropped:', {
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

  private convertToOllamaFormat(request: OpenAIChatCompletionRequest): OllamaChatRequest {
    const messages: OllamaMessage[] = request.messages
      .filter((msg): msg is OpenAIChatMessage & { role: 'system' | 'user' | 'assistant' } =>
        ['system', 'user', 'assistant'].includes(msg.role)
      )
      .map((msg) => ({
        role: msg.role,
        content: msg.content ?? '',
      }))

    const ollamaRequest: OllamaChatRequest = {
      model: this.mapModel(request.model),
      messages,
      options: {},
    }

    if (request.temperature !== undefined) {
      ollamaRequest.options!.temperature = request.temperature
    }
    if (request.top_p !== undefined) {
      ollamaRequest.options!.top_p = request.top_p
    }
    if (request.max_tokens !== undefined) {
      ollamaRequest.options!.num_predict = request.max_tokens
    }
    if (request.stop !== undefined) {
      ollamaRequest.options!.stop = typeof request.stop === 'string'
        ? [request.stop]
        : request.stop
    }

    return ollamaRequest
  }

  private mapModel(model: string): string {
    const modelMap: Record<string, string> = {
      // Direct Ollama models
      'llama3.2': 'llama3.2',
      'llama3.2:1b': 'llama3.2:1b',
      'llama3.2:3b': 'llama3.2:3b',
      'llama3.1': 'llama3.1',
      'llama3.1:8b': 'llama3.1:8b',
      'llama3.1:70b': 'llama3.1:70b',
      'mistral': 'mistral',
      'mixtral': 'mixtral',
      'codellama': 'codellama',
      'deepseek-coder': 'deepseek-coder',
      'phi3': 'phi3',
      'qwen2.5': 'qwen2.5',

      // OpenAI model fallbacks
      'gpt-4o': 'llama3.2',
      'gpt-4o-mini': 'llama3.2:1b',
      'gpt-4': 'llama3.1:70b',
      'gpt-3.5-turbo': 'llama3.2:1b',

      // Claude model fallbacks
      'claude-3-5-sonnet': 'llama3.2',
      'claude-3-5-haiku': 'llama3.2:1b',
      'claude-3-opus': 'llama3.1:70b',
    }

    const lowerModel = model.toLowerCase()

    // Check for exact matches first
    if (modelMap[lowerModel]) {
      return modelMap[lowerModel]
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(modelMap)) {
      if (lowerModel.includes(key)) {
        return value
      }
    }

    // If it looks like an Ollama model (no slashes, simple name), use as-is
    if (!model.includes('/') && !model.includes('@')) {
      return model
    }

    // Default to llama3.2
    return 'llama3.2'
  }

  private convertToOpenAIFormat(
    response: OllamaChatResponse,
    requestModel: string
  ): OpenAIChatCompletionResponse {
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.message.content,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: response.prompt_eval_count ?? 0,
        completion_tokens: response.eval_count ?? 0,
        total_tokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
      },
    }
  }

  canHandle(model: string): boolean {
    const ollamaModels = [
      'ollama',
      'llama3',
      'mistral',
      'mixtral',
      'codellama',
      'deepseek',
      'phi',
      'qwen',
      'local',
    ]
    return ollamaModels.some((m) => model.toLowerCase().includes(m.toLowerCase()))
  }

  listModels(): string[] {
    return [
      'llama3.2',
      'llama3.2:1b',
      'llama3.2:3b',
      'llama3.1',
      'llama3.1:8b',
      'llama3.1:70b',
      'mistral',
      'mixtral',
      'codellama',
      'deepseek-coder',
      'phi3',
      'qwen2.5',
    ]
  }
}

export const ollamaAdapter = new OllamaAdapter()
