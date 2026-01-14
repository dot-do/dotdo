/**
 * Devin API Provider
 *
 * Adapts the Cognition Devin API to the unified agent interface.
 * Devin is a session-based coding agent that operates in a sandboxed environment.
 *
 * @see https://docs.devin.ai/external-api/external-api
 */

import type {
  AgentProvider,
  AgentConfig,
  Agent,
  Message,
  StepResult,
  Session,
  SessionStatus,
  CreateSessionOptions,
  SendMessageOptions,
  Attachment,
  AgentResult,
  AgentStreamResult,
  StreamEvent,
} from '../types'
import { BaseAgent } from '../Agent'

// ============================================================================
// Devin API Types
// ============================================================================

interface DevinSession {
  session_id: string
  url: string
  is_new_session?: boolean
}

interface DevinSessionDetails {
  session_id: string
  status: 'running' | 'paused' | 'finished' | 'failed'
  title?: string
  created_at: string
  updated_at: string
  acu_used: number
  pull_request?: {
    url: string
    status: string
  }
}

interface DevinAttachment {
  url: string
}

// ============================================================================
// Provider Implementation
// ============================================================================

export interface DevinProviderOptions {
  /** Devin API key */
  apiKey: string
  /** Base URL for Devin API */
  baseUrl?: string
  /** Default max ACU limit per session */
  maxAcuLimit?: number
  /** Knowledge IDs to use by default */
  knowledgeIds?: string[]
  /** Secret IDs to use by default */
  secretIds?: string[]
  /** Polling interval for session status (ms) */
  pollIntervalMs?: number
}

export class DevinProvider implements AgentProvider {
  readonly name = 'devin'
  readonly version = '1.0'

  private options: DevinProviderOptions
  private baseUrl: string

  constructor(options: DevinProviderOptions) {
    this.options = {
      baseUrl: 'https://api.devin.ai/v1',
      maxAcuLimit: 10,
      pollIntervalMs: 5000,
      ...options,
    }
    this.baseUrl = this.options.baseUrl!
  }

  /**
   * Create an agent - for Devin this creates a session-based agent
   */
  createAgent(config: AgentConfig): Agent {
    return new BaseAgent({
      config,
      provider: this,
      generate: async (messages, cfg) => {
        // Devin works differently - we create a session and poll for results
        const prompt = this.buildPromptFromMessages(messages)
        const session = await this.createSession({
          agentId: cfg.id,
          initialPrompt: prompt,
          knowledgeIds: this.options.knowledgeIds,
        })

        // Poll for completion
        const result = await this.waitForCompletion(session.id)

        return {
          text: result.text,
          toolCalls: [],
          finishReason: result.finishReason,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
        }
      },
    })
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const body: Record<string, unknown> = {
      prompt: options.initialPrompt ?? '',
      idempotent: options.idempotent ?? false,
    }

    if (options.knowledgeIds?.length) {
      body.knowledge_ids = options.knowledgeIds
    }

    if (this.options.secretIds?.length) {
      body.secret_ids = this.options.secretIds
    }

    if (this.options.maxAcuLimit) {
      body.max_acu_limit = options.maxAcuLimit ?? this.options.maxAcuLimit
    }

    const response = await this.fetch('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const data = (await response.json()) as DevinSession

    return {
      id: data.session_id,
      agentId: options.agentId,
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: options.initialPrompt
        ? [{ role: 'user', content: options.initialPrompt }]
        : [],
      metadata: {
        url: data.url,
        isNewSession: data.is_new_session,
      },
      knowledgeIds: options.knowledgeIds,
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const response = await this.fetch(`/session/${sessionId}`)
      const data = (await response.json()) as DevinSessionDetails

      return {
        id: data.session_id,
        agentId: 'devin',
        status: this.mapStatus(data.status),
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        messages: [],
        metadata: {
          title: data.title,
          acuUsed: data.acu_used,
          pullRequest: data.pull_request,
        },
      }
    } catch {
      return null
    }
  }

  async sendMessage(options: SendMessageOptions): Promise<AgentResult> {
    const response = await this.fetch(`/session/${options.sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({
        message: options.message,
      }),
    })

    // Devin processes asynchronously - poll for result
    const result = await this.waitForCompletion(options.sessionId)

    return result
  }

  streamMessage(options: SendMessageOptions): AgentStreamResult {
    const self = this

    // Create deferred promises
    let resolveResult: (result: AgentResult) => void
    const resultPromise = new Promise<AgentResult>((resolve) => {
      resolveResult = resolve
    })

    let resolveText: (text: string) => void
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve
    })

    const toolCallsPromise = Promise.resolve([])
    const usagePromise = Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })

    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      // Send the message
      await self.fetch(`/session/${options.sessionId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: options.message }),
      })

      // Poll for completion, emitting status updates
      let lastStatus = 'running'

      while (true) {
        const session = await self.getSession(options.sessionId)
        if (!session) {
          yield {
            type: 'error',
            data: { error: new Error('Session not found') },
            timestamp: new Date(),
          }
          break
        }

        if (session.status !== lastStatus) {
          lastStatus = session.status
          yield {
            type: 'text-delta',
            data: { textDelta: `\n[Status: ${session.status}]\n` },
            timestamp: new Date(),
          }
        }

        if (session.status === 'completed' || session.status === 'failed') {
          const result: AgentResult = {
            text: `Session ${session.status}`,
            toolCalls: [],
            toolResults: [],
            messages: session.messages,
            steps: 1,
            finishReason: session.status === 'completed' ? 'stop' : 'error',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          }

          yield {
            type: 'done',
            data: { finalResult: result },
            timestamp: new Date(),
          }

          resolveResult(result)
          resolveText(result.text)
          break
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, self.options.pollIntervalMs))
      }
    }

    return {
      [Symbol.asyncIterator]: generateEvents,
      result: resultPromise,
      text: textPromise,
      toolCalls: toolCallsPromise,
      usage: usagePromise,
    }
  }

  // ============================================================================
  // Attachments
  // ============================================================================

  async uploadAttachment(file: File): Promise<Attachment> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Failed to upload attachment: ${response.statusText}`)
    }

    const data = (await response.json()) as DevinAttachment

    return {
      id: data.url.split('/').pop() ?? '',
      name: file.name,
      url: data.url,
      mimeType: file.type,
      size: file.size,
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
        ...init?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Devin API error: ${response.status} ${response.statusText}`)
    }

    return response
  }

  private buildPromptFromMessages(messages: Message[]): string {
    return messages
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `${m.role}: ${content}`
      })
      .join('\n\n')
  }

  private async waitForCompletion(sessionId: string): Promise<AgentResult> {
    const maxAttempts = 120 // 10 minutes with 5s polling
    let attempts = 0

    while (attempts < maxAttempts) {
      const session = await this.getSession(sessionId)
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      if (session.status === 'completed') {
        return {
          text: `Session completed. ${session.metadata?.pullRequest ? `PR: ${session.metadata.pullRequest.url}` : ''}`,
          toolCalls: [],
          toolResults: [],
          messages: session.messages,
          steps: 1,
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }
      }

      if (session.status === 'failed') {
        return {
          text: 'Session failed',
          toolCalls: [],
          toolResults: [],
          messages: session.messages,
          steps: 1,
          finishReason: 'error',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs))
      attempts++
    }

    throw new Error('Session timed out waiting for completion')
  }

  private mapStatus(status: string): SessionStatus {
    switch (status) {
      case 'running':
        return 'running'
      case 'paused':
        return 'waiting_for_input'
      case 'finished':
        return 'completed'
      case 'failed':
        return 'failed'
      default:
        return 'pending'
    }
  }

  async listModels(): Promise<string[]> {
    // Devin doesn't expose model selection - it's a single integrated system
    return ['devin-2.0', 'devin-2.1']
  }
}

export function createDevinProvider(options: DevinProviderOptions): DevinProvider {
  return new DevinProvider(options)
}

export default DevinProvider
