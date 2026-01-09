/**
 * Claude Agent SDK Provider
 *
 * Adapts the Claude Agent SDK (both v1 and v2 beta) to the unified agent interface.
 *
 * @see https://docs.anthropic.com/claude/agent-sdk
 */

import type {
  AgentProvider,
  AgentConfig,
  Agent,
  Message,
  StepResult,
  ToolDefinition,
  StreamEvent,
  Session,
  CreateSessionOptions,
  SendMessageOptions,
  AgentResult,
  AgentStreamResult,
} from '../types'
import { BaseAgent } from '../Agent'
import { zodToJsonSchema, isZodSchema } from '../Tool'

// ============================================================================
// Provider Implementation
// ============================================================================

export interface ClaudeProviderOptions {
  /** Anthropic API key */
  apiKey?: string
  /** Default model */
  defaultModel?: string
  /** Use v2 beta session API */
  useV2?: boolean
  /** Permission mode */
  permissionMode?: 'auto' | 'confirm' | 'deny'
}

export class ClaudeProvider implements AgentProvider {
  readonly name = 'claude'
  readonly version = '2.0'

  private options: ClaudeProviderOptions
  private sessions: Map<string, Session> = new Map()

  constructor(options: ClaudeProviderOptions = {}) {
    this.options = {
      defaultModel: 'claude-sonnet-4-20250514',
      useV2: false,
      permissionMode: 'auto',
      ...options,
    }
  }

  createAgent(config: AgentConfig): Agent {
    return new BaseAgent({
      config: {
        ...config,
        model: config.model ?? this.options.defaultModel ?? 'claude-sonnet-4-20250514',
      },
      provider: this,
      generate: (messages, cfg) => this.generate(messages, cfg),
      generateStream: (messages, cfg) => this.generateStream(messages, cfg),
    })
  }

  // ============================================================================
  // V2 Session API (Beta)
  // ============================================================================

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const session: Session = {
      id: sessionId,
      agentId: options.agentId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: options.initialPrompt
        ? [{ role: 'user', content: options.initialPrompt }]
        : [],
      metadata: options.metadata,
    }

    this.sessions.set(sessionId, session)

    // If using v2 API, we'd call unstable_v2_createSession here
    if (this.options.useV2) {
      // const { unstable_v2_createSession } = await import('@anthropic-ai/claude-agent-sdk')
      // const v2Session = await unstable_v2_createSession({ ... })
      // session.id = v2Session.id
    }

    return session
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async sendMessage(options: SendMessageOptions): Promise<AgentResult> {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`)
    }

    session.messages.push({
      role: 'user',
      content: options.message,
    })
    session.status = 'running'
    session.updatedAt = new Date()

    const agent = this.createAgent({
      id: session.agentId,
      name: session.agentId,
      instructions: '',
      model: this.options.defaultModel ?? 'claude-sonnet-4-20250514',
    })

    const result = await agent.run({
      messages: session.messages,
    })

    session.messages = result.messages
    session.status = 'completed'
    session.updatedAt = new Date()

    return result
  }

  streamMessage(options: SendMessageOptions): AgentStreamResult {
    const session = this.sessions.get(options.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`)
    }

    session.messages.push({
      role: 'user',
      content: options.message,
    })
    session.status = 'running'
    session.updatedAt = new Date()

    const agent = this.createAgent({
      id: session.agentId,
      name: session.agentId,
      instructions: '',
      model: this.options.defaultModel ?? 'claude-sonnet-4-20250514',
    })

    return agent.stream({
      messages: session.messages,
    })
  }

  // ============================================================================
  // Core Generation
  // ============================================================================

  private async generate(messages: Message[], config: AgentConfig): Promise<StepResult> {
    // Use Anthropic SDK
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({
      apiKey: this.options.apiKey,
    })

    const systemMessage = messages.find((m) => m.role === 'system')
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemMessage?.content as string,
      messages: this.convertMessages(nonSystemMessages),
      tools: this.convertTools(config.tools ?? []),
      ...config.providerOptions,
    })

    const textBlocks = response.content.filter((b) => b.type === 'text')
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use')

    return {
      text: textBlocks.map((b) => (b as { text: string }).text).join(''),
      toolCalls: toolBlocks.map((b) => {
        const tool = b as { id: string; name: string; input: Record<string, unknown> }
        return {
          id: tool.id,
          name: tool.name,
          arguments: tool.input,
        }
      }),
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    }
  }

  private async *generateStream(
    messages: Message[],
    config: AgentConfig
  ): AsyncIterable<StreamEvent> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({
      apiKey: this.options.apiKey,
    })

    const systemMessage = messages.find((m) => m.role === 'system')
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    const stream = await client.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: systemMessage?.content as string,
      messages: this.convertMessages(nonSystemMessages),
      tools: this.convertTools(config.tools ?? []),
      ...config.providerOptions,
    })

    let text = ''
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = []

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string; partial_json?: string }
        if (delta.type === 'text_delta' && delta.text) {
          text += delta.text
          yield {
            type: 'text-delta',
            data: { textDelta: delta.text },
            timestamp: new Date(),
          }
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          yield {
            type: 'tool-call-delta',
            data: { argumentsDelta: delta.partial_json },
            timestamp: new Date(),
          }
        }
      } else if (event.type === 'content_block_start') {
        const block = event.content_block as { type: string; id?: string; name?: string }
        if (block.type === 'tool_use' && block.id && block.name) {
          yield {
            type: 'tool-call-start',
            data: { toolCallId: block.id, toolName: block.name },
            timestamp: new Date(),
          }
        }
      }
    }

    const finalMessage = await stream.finalMessage()

    yield {
      type: 'done',
      data: {
        finalResult: {
          text,
          toolCalls,
          toolResults: [],
          messages,
          steps: 1,
          finishReason: finalMessage.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
          usage: {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          },
        },
      },
      timestamp: new Date(),
    }
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'user':
          return {
            role: 'user',
            content: typeof msg.content === 'string'
              ? msg.content
              : msg.content.map((part) => {
                  if (part.type === 'text') return { type: 'text', text: part.text }
                  if (part.type === 'image') {
                    return {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: part.mimeType,
                        data: part.data,
                      },
                    }
                  }
                  return part
                }),
          }
        case 'assistant':
          const content: unknown[] = []
          if (msg.content) {
            content.push({ type: 'text', text: msg.content })
          }
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
              content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })
            }
          }
          return { role: 'assistant', content }
        case 'tool':
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.toolCallId,
                content: JSON.stringify(msg.content),
              },
            ],
          }
        default:
          return msg
      }
    })
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: isZodSchema(tool.inputSchema)
        ? zodToJsonSchema(tool.inputSchema)
        : tool.inputSchema,
    }))
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ]
  }
}

export function createClaudeProvider(options?: ClaudeProviderOptions): ClaudeProvider {
  return new ClaudeProvider(options)
}

export default ClaudeProvider
