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
  ConversationTagParams,
  ConversationUntagParams,
  ConversationNoteParams,
  ConversationRedactParams,
  ConversationSetPriorityParams,
  TagRef,
  Message,
  MessageCreateParams,
} from './types'

import type { IntercomClientInterface } from './contacts'

/**
 * Conversations resource for managing Intercom conversations
 *
 * @example
 * ```typescript
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   from: { type: 'user', id: 'contact_123' },
 *   body: 'Hello, I need help!',
 * })
 *
 * // Reply as admin
 * await client.conversations.reply({
 *   id: conversation.id,
 *   type: 'admin',
 *   admin_id: 'admin_123',
 *   body: 'How can I help you?',
 *   message_type: 'comment',
 * })
 *
 * // Close the conversation
 * await client.conversations.close({
 *   id: conversation.id,
 *   admin_id: 'admin_123',
 * })
 * ```
 */
export class ConversationsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create a new conversation
   *
   * @param params - Conversation creation parameters
   * @param options - Request options
   * @returns The created conversation
   */
  async create(params: ConversationCreateParams, options?: RequestOptions): Promise<Conversation> {
    return this.client._request('POST', '/conversations', params as Record<string, unknown>, options)
  }

  /**
   * Find a conversation by ID
   *
   * @param id - Conversation ID
   * @param options - Request options
   * @returns The conversation
   */
  async find(id: string, options?: RequestOptions): Promise<Conversation> {
    return this.client._request('GET', `/conversations/${id}`, undefined, options)
  }

  /**
   * List conversations
   *
   * @param params - Pagination parameters
   * @param options - Request options
   * @returns Paginated list of conversations
   */
  async list(params?: ConversationListParams, options?: RequestOptions): Promise<ConversationListResponse> {
    return this.client._request('GET', '/conversations', params as Record<string, unknown>, options)
  }

  /**
   * Reply to a conversation
   *
   * Can be used to:
   * - Reply as an admin (with message_type: 'comment')
   * - Reply as a user
   * - Add an internal note (with message_type: 'note')
   *
   * @param params - Reply parameters
   * @param options - Request options
   * @returns The updated conversation
   */
  async reply(params: ConversationReplyParams, options?: RequestOptions): Promise<Conversation> {
    const { id, ...body } = params
    return this.client._request('POST', `/conversations/${id}/reply`, body as Record<string, unknown>, options)
  }

  /**
   * Assign a conversation to an admin or team
   *
   * @param params - Assignment parameters
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * @param params - Close parameters
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * @param params - Open parameters
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * The conversation will be reopened automatically at the specified time.
   *
   * @param params - Snooze parameters
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * @param params - Search parameters
   * @param options - Request options
   * @returns Paginated search results
   */
  async search(params: ConversationSearchParams, options?: RequestOptions): Promise<ConversationListResponse> {
    return this.client._request('POST', '/conversations/search', params as Record<string, unknown>, options)
  }

  /**
   * Add a tag to a conversation
   *
   * @example
   * ```typescript
   * await client.conversations.addTag({
   *   id: 'conv_123',
   *   admin_id: 'admin_123',
   *   tag_id: 'tag_456',
   * })
   * ```
   *
   * @param params - Tag parameters
   * @param options - Request options
   * @returns The tag that was added
   */
  async addTag(params: ConversationTagParams, options?: RequestOptions): Promise<TagRef> {
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
   *
   * @example
   * ```typescript
   * await client.conversations.removeTag({
   *   id: 'conv_123',
   *   admin_id: 'admin_123',
   *   tag_id: 'tag_456',
   * })
   * ```
   *
   * @param params - Untag parameters
   * @param options - Request options
   * @returns The tag that was removed
   */
  async removeTag(params: ConversationUntagParams, options?: RequestOptions): Promise<TagRef> {
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
   *
   * Notes are only visible to admins and not shown to the customer.
   *
   * @example
   * ```typescript
   * await client.conversations.addNote({
   *   id: 'conv_123',
   *   admin_id: 'admin_123',
   *   body: 'VIP customer - handle with care',
   * })
   * ```
   *
   * @param params - Note parameters
   * @param options - Request options
   * @returns The updated conversation
   */
  async addNote(params: ConversationNoteParams, options?: RequestOptions): Promise<Conversation> {
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
   * Redact a conversation part
   *
   * Permanently removes sensitive content from a conversation part.
   *
   * @example
   * ```typescript
   * await client.conversations.redact({
   *   type: 'conversation_part',
   *   conversation_id: 'conv_123',
   *   conversation_part_id: 'part_456',
   * })
   * ```
   *
   * @param params - Redact parameters
   * @param options - Request options
   * @returns The redacted conversation part
   */
  async redact(params: ConversationRedactParams, options?: RequestOptions): Promise<Conversation> {
    return this.client._request(
      'POST',
      '/conversations/redact',
      params as Record<string, unknown>,
      options
    )
  }

  /**
   * Set the priority of a conversation
   *
   * @example
   * ```typescript
   * await client.conversations.setPriority({
   *   id: 'conv_123',
   *   admin_id: 'admin_123',
   *   priority: 'priority',
   * })
   * ```
   *
   * @param params - Priority parameters
   * @param options - Request options
   * @returns The updated conversation
   */
  async setPriority(params: ConversationSetPriorityParams, options?: RequestOptions): Promise<Conversation> {
    const { id, admin_id, priority } = params
    return this.client._request(
      'PUT',
      `/conversations/${id}`,
      { admin_id, priority } as Record<string, unknown>,
      options
    )
  }

  /**
   * Run assignment rules on a conversation
   *
   * Triggers auto-assignment based on configured rules.
   *
   * @param id - Conversation ID
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * Useful for group conversations or adding participants.
   *
   * @example
   * ```typescript
   * await client.conversations.attachContact({
   *   id: 'conv_123',
   *   admin_id: 'admin_123',
   *   customer: {
   *     intercom_user_id: 'contact_456',
   *   },
   * })
   * ```
   *
   * @param params - Attach contact parameters
   * @param options - Request options
   * @returns The updated conversation
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
   *
   * @param params - Detach contact parameters
   * @param options - Request options
   * @returns The updated conversation
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
 *
 * @example
 * ```typescript
 * // Send an in-app message
 * await client.messages.create({
 *   message_type: 'inapp',
 *   body: 'Welcome to our service!',
 *   from: { type: 'admin', id: 'admin_123' },
 *   to: { type: 'user', id: 'contact_123' },
 * })
 *
 * // Send an email message
 * await client.messages.create({
 *   message_type: 'email',
 *   subject: 'Welcome!',
 *   body: 'Thank you for signing up.',
 *   from: { type: 'admin', id: 'admin_123' },
 *   to: { type: 'user', email: 'user@example.com' },
 * })
 * ```
 */
export class MessagesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create/send a message
   *
   * @param params - Message parameters
   * @param options - Request options
   * @returns The created message
   */
  async create(params: MessageCreateParams, options?: RequestOptions): Promise<Message> {
    return this.client._request('POST', '/messages', params as Record<string, unknown>, options)
  }
}
