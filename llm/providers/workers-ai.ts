/**
 * Workers AI Provider Adapter
 *
 * Handles requests to Cloudflare Workers AI with streaming support.
 *
 * @module llm/providers/workers-ai
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
// Workers AI Types
// ============================================================================

interface WorkersAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface WorkersAIRequest {
  messages: WorkersAIMessage[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
}

interface WorkersAIResponse {
  response: string
}

interface WorkersAIStreamChunk {
  response: string
}

// ============================================================================
// Workers AI Provider
// ============================================================================

export class WorkersAIAdapter implements ProviderAdapter {
  readonly name = 'workers-ai' as const

  async chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse> {
    if (!env.AI) {
      throw new Error('Workers AI binding (AI) is required')
    }

    // Convert OpenAI format to Workers AI format
    const workersRequest: WorkersAIRequest = {
      messages: this.convertMessages(request.messages),
      max_tokens: request.max_tokens ?? request.max_completion_tokens,
      temperature: request.temperature,
      stream: false,
    }

    // Map model name to Workers AI format
    const model = this.mapModel(request.model)

    const result = await env.AI.run(model, workersRequest) as WorkersAIResponse

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.response,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0, // Workers AI doesn't provide token counts
        completion_tokens: 0,
        total_tokens: 0,
      },
    }
  }

  async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    if (!env.AI) {
      throw new Error('Workers AI binding (AI) is required')
    }

    // Convert OpenAI format to Workers AI format
    const workersRequest: WorkersAIRequest = {
      messages: this.convertMessages(request.messages),
      max_tokens: request.max_tokens ?? request.max_completion_tokens,
      temperature: request.temperature,
      stream: true,
    }

    // Map model name to Workers AI format
    const model = this.mapModel(request.model)

    const result = await env.AI.run(model, workersRequest) as ReadableStream

    const requestId = `chatcmpl-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    const reader = result.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })

        // Workers AI streams raw text chunks
        if (text) {
          yield {
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model: request.model,
            choices: [{
              index: 0,
              delta: { content: text },
              finish_reason: null,
            }],
          }
        }
      }

      // Final chunk with finish reason
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
      }
    } finally {
      reader.releaseLock()
    }
  }

  private convertMessages(messages: OpenAIChatMessage[]): WorkersAIMessage[] {
    return messages
      .filter((msg): msg is OpenAIChatMessage & { role: 'system' | 'user' | 'assistant' } =>
        ['system', 'user', 'assistant'].includes(msg.role)
      )
      .map((msg) => ({
        role: msg.role,
        content: msg.content ?? '',
      }))
  }

  private mapModel(model: string): string {
    // If already a Workers AI model, use as-is
    if (model.startsWith('@cf/')) {
      return model
    }

    // Map common model names to Workers AI models
    const modelMap: Record<string, string> = {
      // Llama models
      'llama-3.1-70b': '@cf/meta/llama-3.1-70b-instruct',
      'llama-3.1-8b': '@cf/meta/llama-3.1-8b-instruct',
      'llama-3.3-70b': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'llama3': '@cf/meta/llama-3.1-8b-instruct',
      'llama': '@cf/meta/llama-3.1-8b-instruct',

      // Mistral models
      'mistral': '@cf/mistral/mistral-7b-instruct-v0.2',
      'mistral-7b': '@cf/mistral/mistral-7b-instruct-v0.2',

      // Fallback for OpenAI-style model names
      'gpt-4o': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'gpt-4o-mini': '@cf/meta/llama-3.1-8b-instruct',
      'gpt-4': '@cf/meta/llama-3.1-70b-instruct',
      'gpt-3.5-turbo': '@cf/meta/llama-3.1-8b-instruct',

      // Claude fallbacks
      'claude-3-5-sonnet': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'claude-3-5-haiku': '@cf/meta/llama-3.1-8b-instruct',
    }

    const lowerModel = model.toLowerCase()
    for (const [key, value] of Object.entries(modelMap)) {
      if (lowerModel.includes(key)) {
        return value
      }
    }

    // Default to Llama 3.1 8B
    return '@cf/meta/llama-3.1-8b-instruct'
  }

  canHandle(model: string): boolean {
    // Handle @cf/ prefixed models
    if (model.startsWith('@cf/')) {
      return true
    }

    // Handle known model aliases
    const workerModels = [
      'llama',
      'mistral',
      'workers-ai',
      '@cf/',
    ]
    return workerModels.some((m) => model.toLowerCase().includes(m.toLowerCase()))
  }

  listModels(): string[] {
    return [
      '@cf/meta/llama-3.1-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@cf/meta/codellama-70b-instruct',
    ]
  }
}

export const workersAIAdapter = new WorkersAIAdapter()
