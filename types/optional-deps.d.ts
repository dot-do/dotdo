/**
 * Type declarations for optional dependencies
 *
 * These packages are optional - they're dynamically imported at runtime
 * when users want to use actual AI providers. These declarations prevent
 * TypeScript errors while allowing the dynamic imports to work at runtime.
 */

declare module '@anthropic-ai/sdk' {
  interface TextBlock {
    type: 'text'
    text: string
  }

  interface MessageResponse {
    content: TextBlock[]
  }

  interface MessageCreateParams {
    model: string
    max_tokens: number
    system: string
    messages: Array<{ role: string; content: string }>
    temperature?: number
  }

  interface Messages {
    create(params: MessageCreateParams): Promise<MessageResponse>
  }

  export interface AnthropicOptions {
    apiKey: string
  }

  export default class Anthropic {
    messages: Messages
    constructor(options: AnthropicOptions)
  }
}

declare module 'openai' {
  interface ChatCompletionMessage {
    content: string | null
  }

  interface ChatCompletionChoice {
    message?: ChatCompletionMessage
  }

  interface ChatCompletion {
    choices: ChatCompletionChoice[]
  }

  interface ChatCompletionCreateParams {
    model: string
    max_tokens: number
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    temperature?: number
  }

  interface Completions {
    create(params: ChatCompletionCreateParams): Promise<ChatCompletion>
  }

  interface Chat {
    completions: Completions
  }

  export interface OpenAIOptions {
    apiKey: string
  }

  export default class OpenAI {
    chat: Chat
    constructor(options: OpenAIOptions)
  }
}
