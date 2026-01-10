/**
 * MDXUI Chat Channel Adapter
 *
 * Enables chat-based interactions with users through MDXUI components.
 * Supports action buttons, forms, MDX content, and real-time updates.
 */

import type { Action, HumanResponse } from './types'

export interface ChatAction {
  label: string
  value: string
}

export interface ChatFormField {
  name: string
  type: 'text' | 'boolean'
  label: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: ChatAction[]
  form?: { fields: ChatFormField[] }
}

export interface ChatConversationOptions {
  initialMessage: string
  userId: string
  actions?: ChatAction[]
  form?: { fields: ChatFormField[] }
}

/**
 * Manages a conversation with messages, actions, and forms
 */
export class ChatConversation {
  public messages: ChatMessage[]
  public userId: string

  constructor(options: ChatConversationOptions) {
    this.userId = options.userId
    const initialMsg: ChatMessage = {
      role: 'assistant',
      content: options.initialMessage,
    }
    if (options.actions) {
      initialMsg.actions = options.actions
    }
    if (options.form) {
      initialMsg.form = options.form
    }
    this.messages = [initialMsg]
  }

  addMessage(msg: { role: string; content: string }) {
    this.messages.push(msg as ChatMessage)
  }
}

export interface UserDOBinding {
  idFromName(name: string): { toString(): string }
  get(id: { toString(): string }): {
    fetch(request: Request): Promise<Response>
  }
}

export interface MDXUIChatConfig {
  env: { USER_DO: UserDOBinding }
  realtime?: boolean
}

export interface SendPayload {
  message: string
  userId: string
  mdxContent?: string
}

export interface WaitForResponseParams {
  timeout: number
}

export interface UserResponse {
  action: string
  data: Record<string, unknown>
}

/**
 * Channel adapter for MDXUI chat-based interactions
 */
export class MDXUIChatChannel {
  public supportsRealtime: boolean
  private config: MDXUIChatConfig
  private lastUserId: string | null = null

  constructor(config: MDXUIChatConfig) {
    this.config = config
    this.supportsRealtime = config.realtime ?? false
  }

  /**
   * Send a message to a user via their Durable Object
   */
  async send(payload: SendPayload): Promise<{ delivered: boolean }> {
    const { USER_DO } = this.config.env
    const doId = USER_DO.idFromName(payload.userId)
    const stub = USER_DO.get(doId)

    this.lastUserId = payload.userId

    const body: Record<string, unknown> = {
      type: 'chat_message',
      message: payload.message,
      userId: payload.userId,
    }

    if (payload.mdxContent) {
      body.mdxContent = payload.mdxContent
    }

    await stub.fetch(
      new Request('https://internal/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )

    return { delivered: true }
  }

  /**
   * Wait for a user response with timeout
   */
  async waitForResponse(params: WaitForResponseParams): Promise<UserResponse> {
    if (!this.lastUserId) {
      throw new Error('No user context - call send() first')
    }

    const { USER_DO } = this.config.env
    const doId = USER_DO.idFromName(this.lastUserId)
    const stub = USER_DO.get(doId)

    const response = await stub.fetch(
      new Request(`https://internal/chat/response?timeout=${params.timeout}`, {
        method: 'GET',
      })
    )

    const data = (await response.json()) as { response: UserResponse }
    return data.response
  }

  /**
   * Send a typing indicator to the user (fire and forget)
   */
  async sendTypingIndicator(userId: string): Promise<void> {
    const { USER_DO } = this.config.env
    const doId = USER_DO.idFromName(userId)
    const stub = USER_DO.get(doId)

    await stub.fetch(
      new Request('https://internal/chat/typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
    )
  }
}
