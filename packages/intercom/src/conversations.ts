/**
 * @dotdo/intercom - Conversations Resource
 *
 * Manages Intercom conversations with support for:
 * - Create conversations
 * - Reply, assign, close, open, snooze
 * - List and search conversations
 *
 * Also includes Messages resource for sending messages.
 *
 * @module @dotdo/intercom/conversations
 */

import type {
  RequestOptions,
  Conversation,
  ConversationCreateParams,
  ConversationListParams,
  ConversationListResponse,
  ConversationReplyParams,
  ConversationAssignParams,
  ConversationCloseParams,
  ConversationOpenParams,
  ConversationSnoozeParams,
  ConversationSearchParams,
  TagRef,
  Message,
  MessageCreateParams,
} from './types'

import type { IntercomClientInterface } from './contacts'

/**
 * Conversations resource for managing Intercom conversations
 */
export class ConversationsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create a new conversation
   */
  async create(params: ConversationCreateParams, options?: RequestOptions): Promise<Conversation> {
    return this.client._request('POST', '/conversations', params as Record<string, unknown>, options)
  }

  /**
   * Find a conversation by ID
   */
  async find(id: string, options?: RequestOptions): Promise<Conversation> {
    return this.client._request('GET', `/conversations/${id}`, undefined, options)
  }

  /**
   * List conversations
   */
  async list(params?: ConversationListParams, options?: RequestOptions): Promise<ConversationListResponse> {
    return this.client._request('GET', '/conversations', params as Record<string, unknown>, options)
  }

  /**
   * Reply to a conversation
   */
  async reply(params: ConversationReplyParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request('POST', `/conversations/${id}/reply`, body as Record<string, unknown>, options)
  }

  /**
   * Assign a conversation to an admin or team
   */
  async assign(params: ConversationAssignParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/parts`,
      {
        message_type: 'assignment',
        ...body,
      } as Record<string, unknown>,
      options
    )
  }

  /**
   * Close a conversation
   */
  async close(params: ConversationCloseParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/parts`,
      {
        message_type: 'close',
        type: 'admin',
        ...body,
      } as Record<string, unknown>,
      options
    )
  }

  /**
   * Open/reopen a conversation
   */
  async open(params: ConversationOpenParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/parts`,
      {
        message_type: 'open',
        type: 'admin',
        ...body,
      } as Record<string, unknown>,
      options
    )
  }

  /**
   * Snooze a conversation
   */
  async snooze(params: ConversationSnoozeParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/parts`,
      {
        message_type: 'snoozed',
        type: 'admin',
        ...body,
      } as Record<string, unknown>,
      options
    )
  }

  /**
   * Search conversations
   */
  async search(params: ConversationSearchParams, options?: RequestOptions): Promise<ConversationListResponse> {
    return this.client._request('POST', '/conversations/search', params as Record<string, unknown>, options)
  }

  /**
   * Add a tag to a conversation
   */
  async addTag(params: { id: string; admin_id: string; tag_id: string }, options?: RequestOptions): Promise<TagRef> {
    const { id, tag_id, admin_id } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/tags`,
      { id: tag_id, admin_id } as Record<string, unknown>,
      options
    )
  }

  /**
   * Remove a tag from a conversation
   */
  async removeTag(params: { id: string; admin_id: string; tag_id: string }, options?: RequestOptions): Promise<TagRef> {
    const { id, tag_id, admin_id } = params
    return this.client._request(
      'DELETE',
      `/conversations/${id}/tags/${tag_id}`,
      { admin_id } as Record<string, unknown>,
      options
    )
  }

  /**
   * Add an internal note to a conversation
   */
  async addNote(params: { id: string; admin_id: string; body: string }, options?: RequestOptions): Promise<Conversation> {
    const { id, admin_id, body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/reply`,
      {
        type: 'admin',
        admin_id,
        body,
        message_type: 'note',
      } as Record<string, unknown>,
      options
    )
  }

  /**
   * Set the priority of a conversation
   */
  async setPriority(params: { id: string; admin_id: string; priority: 'priority' | 'not_priority' }, options?: RequestOptions): Promise<Conversation> {
    const { id, admin_id, priority } = params
    return this.client._request(
      'PUT',
      `/conversations/${id}`,
      { admin_id, priority } as Record<string, unknown>,
      options
    )
  }

  /**
   * Redact a conversation part
   */
  async redact(params: { type: 'conversation_part' | 'source'; conversation_id: string; conversation_part_id?: string; source_id?: string }, options?: RequestOptions): Promise<Conversation> {
    return this.client._request(
      'POST',
      '/conversations/redact',
      params as Record<string, unknown>,
      options
    )
  }

  /**
   * Run assignment rules on a conversation
   */
  async runAssignmentRules(id: string, options?: RequestOptions): Promise<Conversation> {
    return this.client._request(
      'POST',
      `/conversations/${id}/run_assignment_rules`,
      undefined,
      options
    )
  }

  /**
   * Attach a contact to a conversation
   */
  async attachContact(
    params: {
      id: string
      admin_id: string
      customer: {
        intercom_user_id?: string
        user_id?: string
        email?: string
      }
    },
    options?: RequestOptions
  ): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request(
      'POST',
      `/conversations/${id}/customers`,
      body as Record<string, unknown>,
      options
    )
  }

  /**
   * Detach a contact from a conversation
   */
  async detachContact(
    params: {
      id: string
      admin_id: string
      contact_id: string
    },
    options?: RequestOptions
  ): Promise<Conversation> {
    const { id, contact_id, admin_id } = params
    return this.client._request(
      'DELETE',
      `/conversations/${id}/customers/${contact_id}`,
      { admin_id } as Record<string, unknown>,
      options
    )
  }
}

/**
 * Messages resource for sending messages
 */
export class MessagesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create/send a message
   */
  async create(params: MessageCreateParams, options?: RequestOptions): Promise<Message> {
    return this.client._request('POST', '/messages', params as Record<string, unknown>, options)
  }
}
