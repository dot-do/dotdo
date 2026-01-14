/**
 * Vercel AI SDK Provider
 *
 * Adapts the Vercel AI SDK to the unified agent interface.
 *
 * @see https://sdk.vercel.ai/docs
 */

import type {
  AgentProvider,
  AgentConfig,
  Agent,
  Message,
  StepResult,
  ToolDefinition,
  ToolCall,
  StreamEvent,
} from '../types'
import { BaseAgent } from '../Agent'
import { zodToJsonSchema, isZodSchema } from '../Tool'

// Re-export for convenience
export { generateText, streamText, tool as vercelTool } from 'ai'

// ============================================================================
// Provider Implementation
// ============================================================================

export interface VercelProviderOptions {
  /** Default model to use */
  defaultModel?: string
  /** API key (if not using environment variable) */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
}

export class VercelProvider implements AgentProvider {
  readonly name = 'vercel'
  readonly version = '6.0'

  private options: VercelProviderOptions

  constructor(options: VercelProviderOptions = {}) {
    this.options = {
      defaultModel: 'gpt-4o',
      ...options,
    }
  }

  createAgent(config: AgentConfig): Agent {
    return new BaseAgent({
      config: {
        ...config,
        model: config.model ?? this.options.defaultModel ?? 'gpt-4o',
      },
      provider: this,
      generate: (messages, cfg) => this.generate(messages, cfg),
      generateStream: (messages, cfg) => this.generateStream(messages, cfg),
    })
  }

  private async generate(messages: Message[], config: AgentConfig): Promise<StepResult> {
    // Dynamic import to avoid bundling issues
    const { generateText } = await import('ai')

    const tools = this.convertTools(config.tools ?? [])

    const result = await generateText({
      model: this.getModel(config.model),
      messages: this.convertMessages(messages),
      tools,
      ...config.providerOptions,
    })

    return {
      text: result.text,
      toolCalls: result.toolCalls?.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args as Record<string, unknown>,
      })),
      finishReason: this.mapFinishReason(result.finishReason),
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      },
    }
  }

  private async *generateStream(
    messages: Message[],
    config: AgentConfig
  ): AsyncIterable<StreamEvent> {
    const { streamText } = await import('ai')

    const tools = this.convertTools(config.tools ?? [])

    const stream = await streamText({
      model: this.getModel(config.model),
      messages: this.convertMessages(messages),
      tools,
      ...config.providerOptions,
    })

    for await (const part of stream.textStream) {
      yield {
        type: 'text-delta',
        data: { textDelta: part },
        timestamp: new Date(),
      }
    }

    const result = await stream

    yield {
      type: 'done',
      data: {
        finalResult: {
          text: result.text,
          toolCalls: result.toolCalls?.map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            arguments: tc.args as Record<string, unknown>,
          })) ?? [],
          toolResults: [],
          messages,
          steps: 1,
          finishReason: this.mapFinishReason(result.finishReason),
          usage: {
            promptTokens: result.usage?.promptTokens ?? 0,
            completionTokens: result.usage?.completionTokens ?? 0,
            totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
          },
        },
      },
      timestamp: new Date(),
    }
  }

  private getModel(modelId: string): unknown {
    // The model will be resolved by Vercel's provider system
    // This is a placeholder - in practice you'd use @ai-sdk/openai, etc.
    return modelId as unknown
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'user':
          return { role: 'user', content: typeof msg.content === 'string' ? msg.content : msg.content }
        case 'assistant':
          return {
            role: 'assistant',
            content: msg.content,
            toolCalls: msg.toolCalls?.map((tc) => ({
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.arguments,
            })),
          }
        case 'system':
          return { role: 'system', content: msg.content }
        case 'tool':
          return {
            role: 'tool',
            content: JSON.stringify(msg.content),
            toolCallId: msg.toolCallId,
          }
        default:
          return msg
      }
    })
  }

  private convertTools(tools: ToolDefinition[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const tool of tools) {
      // Determine parameters: Zod schema stays as-is for Vercel SDK,
      // JSON Schema (object with 'type') is passed through directly
      let parameters: unknown
      if (isZodSchema(tool.inputSchema)) {
        parameters = tool.inputSchema
      } else if (typeof tool.inputSchema === 'object' && tool.inputSchema !== null && 'type' in tool.inputSchema) {
        // Already JSON Schema - pass through
        parameters = tool.inputSchema
      } else {
        parameters = { type: 'object', properties: {} }
      }

      result[tool.name] = {
        description: tool.description,
        parameters,
        // Note: execute is handled by our agent loop, not Vercel's
      }
    }

    return result
  }

  private mapFinishReason(reason: string): StepResult['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop'
      case 'tool-calls':
        return 'tool_calls'
      case 'length':
        return 'max_steps'
      case 'error':
        return 'error'
      default:
        return 'stop'
    }
  }

  async listModels(): Promise<string[]> {
    // Return commonly available models
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ]
  }
}

export function createVercelProvider(options?: VercelProviderOptions): VercelProvider {
  return new VercelProvider(options)
}

export default VercelProvider
