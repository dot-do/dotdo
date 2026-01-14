/**
 * OpenAI Agents SDK Provider
 *
 * Adapts the OpenAI Agents SDK to the unified agent interface.
 * Supports handoffs, Responses API, and multi-agent orchestration.
 *
 * @see https://github.com/openai/openai-agents-python
 */

import type {
  AgentProvider,
  AgentConfig,
  Agent,
  Message,
  StepResult,
  ToolDefinition,
  StreamEvent,
  HandoffRequest,
  AgentResult,
} from '../types'
import { BaseAgent } from '../Agent'
import { zodToJsonSchema, isZodSchema } from '../Tool'

// ============================================================================
// Provider Implementation
// ============================================================================

export interface OpenAIProviderOptions {
  /** OpenAI API key */
  apiKey?: string
  /** Default model */
  defaultModel?: string
  /** Organization ID */
  organization?: string
  /** Use Responses API (instead of deprecated Assistants API) */
  useResponsesApi?: boolean
}

export class OpenAIProvider implements AgentProvider {
  readonly name = 'openai'
  readonly version = '1.0'

  private options: OpenAIProviderOptions
  private agents: Map<string, AgentConfig> = new Map()

  constructor(options: OpenAIProviderOptions = {}) {
    this.options = {
      defaultModel: 'gpt-4o',
      useResponsesApi: true,
      ...options,
    }
  }

  createAgent(config: AgentConfig): Agent {
    // Register agent for handoffs
    this.agents.set(config.id, config)

    return new OpenAIAgent({
      config: {
        ...config,
        model: config.model ?? this.options.defaultModel ?? 'gpt-4o',
      },
      provider: this,
      generate: (messages, cfg) => this.generate(messages, cfg),
      generateStream: (messages, cfg) => this.generateStream(messages, cfg),
      handoffTo: (agentId, context) => this.handoff(agentId, context),
    })
  }

  private async generate(messages: Message[], config: AgentConfig): Promise<StepResult> {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({
      apiKey: this.options.apiKey ?? process.env.OPENAI_API_KEY,
      organization: this.options.organization,
    })

    const tools = this.convertTools(config.tools ?? [], config.handoffs)

    // Create params with proper typing
    const createParams: Record<string, unknown> = {
      model: config.model,
      messages: this.convertMessages(messages),
      ...config.providerOptions,
    }
    if (tools.length > 0) {
      createParams.tools = tools
    }

    const response = await client.chat.completions.create(createParams as unknown as Parameters<typeof client.chat.completions.create>[0])

    // Type the response for proper access
    const typedResponse = response as {
      choices: Array<{
        message: {
          content: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
        finish_reason: string | null
      }>
      usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
    }

    const choice = typedResponse.choices[0]
    if (!choice) {
      return {
        text: undefined,
        toolCalls: [],
        finishReason: 'stop',
        usage: undefined,
      }
    }

    const message = choice.message

    return {
      text: message.content ?? undefined,
      toolCalls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: typedResponse.usage
        ? {
            promptTokens: typedResponse.usage.prompt_tokens,
            completionTokens: typedResponse.usage.completion_tokens,
            totalTokens: typedResponse.usage.total_tokens,
          }
        : undefined,
    }
  }

  private async *generateStream(
    messages: Message[],
    config: AgentConfig
  ): AsyncIterable<StreamEvent> {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({
      apiKey: this.options.apiKey ?? process.env.OPENAI_API_KEY,
      organization: this.options.organization,
    })

    const tools = this.convertTools(config.tools ?? [], config.handoffs)

    // Create params with proper typing
    const createParams: Record<string, unknown> = {
      model: config.model,
      messages: this.convertMessages(messages),
      stream: true,
      ...config.providerOptions,
    }
    if (tools.length > 0) {
      createParams.tools = tools
    }

    const stream = await client.chat.completions.create(createParams as unknown as Parameters<typeof client.chat.completions.create>[0])

    // Type the stream chunks
    type StreamChunk = {
      choices: Array<{
        delta: {
          content?: string
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }

    let text = ''
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

    // Cast through unknown to handle both stream and non-stream responses
    for await (const rawChunk of stream as unknown as AsyncIterable<StreamChunk>) {
      const chunk = rawChunk
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        text += delta.content
        yield {
          type: 'text-delta',
          data: { textDelta: delta.content },
          timestamp: new Date(),
        }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' }

          if (tc.id) existing.id = tc.id
          if (tc.function?.name) {
            existing.name = tc.function.name
            yield {
              type: 'tool-call-start',
              data: { toolCallId: tc.id ?? existing.id, toolName: tc.function.name },
              timestamp: new Date(),
            }
          }
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments
            yield {
              type: 'tool-call-delta',
              data: { toolCallId: existing.id, argumentsDelta: tc.function.arguments },
              timestamp: new Date(),
            }
          }

          toolCalls.set(tc.index, existing)
        }
      }
    }

    const finalToolCalls = Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: JSON.parse(tc.arguments || '{}'),
    }))

    yield {
      type: 'done',
      data: {
        finalResult: {
          text,
          toolCalls: finalToolCalls,
          toolResults: [],
          messages,
          steps: 1,
          finishReason: finalToolCalls.length > 0 ? 'tool_calls' : 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
      timestamp: new Date(),
    }
  }

  private async handoff(agentId: string, context: Message[]): Promise<AgentResult> {
    const agentConfig = this.agents.get(agentId)
    if (!agentConfig) {
      throw new Error(`Handoff target not found: ${agentId}`)
    }

    const agent = this.createAgent(agentConfig)
    return agent.run({ messages: context })
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'user':
          return {
            role: 'user',
            content: typeof msg.content === 'string' ? msg.content : msg.content,
          }
        case 'assistant':
          return {
            role: 'assistant',
            content: msg.content ?? null,
            tool_calls: msg.toolCalls?.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          }
        case 'system':
          return { role: 'system', content: msg.content }
        case 'tool':
          return {
            role: 'tool',
            tool_call_id: msg.toolCallId,
            content: JSON.stringify(msg.content),
          }
        default:
          return msg
      }
    })
  }

  private convertTools(
    tools: ToolDefinition[],
    handoffs?: AgentConfig[]
  ): unknown[] {
    const result: unknown[] = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: isZodSchema(tool.inputSchema)
          ? zodToJsonSchema(tool.inputSchema)
          : tool.inputSchema,
      },
    }))

    // Add handoff tools for each available agent
    if (handoffs) {
      for (const agent of handoffs) {
        result.push({
          type: 'function',
          function: {
            name: `handoff_to_${agent.id}`,
            description: `Transfer conversation to ${agent.name}: ${agent.instructions?.slice(0, 100)}...`,
            parameters: {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Why this handoff is needed',
                },
              },
              required: ['reason'],
            },
          },
        })
      }
    }

    return result
  }

  private mapFinishReason(reason: string | null): StepResult['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop'
      case 'tool_calls':
        return 'tool_calls'
      case 'length':
        return 'max_steps'
      default:
        return 'stop'
    }
  }

  async listModels(): Promise<string[]> {
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1-preview',
      'o1-mini',
    ]
  }
}

// ============================================================================
// OpenAI Agent with Handoff Support
// ============================================================================

interface OpenAIAgentOptions {
  config: AgentConfig
  provider: OpenAIProvider
  generate: (messages: Message[], config: AgentConfig) => Promise<StepResult>
  generateStream: (messages: Message[], config: AgentConfig) => AsyncIterable<StreamEvent>
  handoffTo: (agentId: string, context: Message[]) => Promise<AgentResult>
}

class OpenAIAgent extends BaseAgent {
  private handoffTo: (agentId: string, context: Message[]) => Promise<AgentResult>

  constructor(options: OpenAIAgentOptions) {
    super({
      config: options.config,
      provider: options.provider,
      generate: options.generate,
      generateStream: options.generateStream,
    })
    this.handoffTo = options.handoffTo
  }

  override async handoff(request: HandoffRequest): Promise<AgentResult> {
    return this.handoffTo(request.targetAgentId, request.context)
  }
}

export function createOpenAIProvider(options?: OpenAIProviderOptions): OpenAIProvider {
  return new OpenAIProvider(options)
}

export default OpenAIProvider
