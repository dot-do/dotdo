/**
 * @dotdo/helpscout - Help Scout API Compatibility Layer
 *
 * Drop-in replacement for Help Scout API SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import HelpScout from '@dotdo/helpscout'
 *
 * const client = new HelpScout.Client({
 *   oauth: {
 *     clientId: 'your_client_id',
 *     clientSecret: 'your_client_secret',
 *     accessToken: 'your_access_token',
 *   },
 * })
 *
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   subject: 'Help needed',
 *   customer: { email: 'customer@example.com' },
 *   mailboxId: 1,
 *   type: 'email',
 *   threads: [{ type: 'customer', text: 'I need help with...' }],
 * })
 * ```
 *
 * @module @dotdo/helpscout
 */

import type {
  ClientConfig,
  RequestOptions,
  HelpScoutErrorResponse,
  FetchFunction,
  HalCollectionResponse,
  // Conversation types
  Conversation,
  Thread,
  ConversationCreateParams,
  ConversationUpdateParams,
  ConversationListParams,
  ConversationSearchParams,
  ThreadCreateParams,
  // Customer types
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  // Mailbox types
  Mailbox,
  Folder,
  MailboxField,
  // User types
  User,
  UserListParams,
  // Saved Reply types
  SavedReply,
  SavedReplyCreateParams,
  SavedReplyUpdateParams,
  // Tag types
  Tag,
  TagCreateParams,
  // Webhook types
  Webhook,
  WebhookCreateParams,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.helpscout.net'

// =============================================================================
// Help Scout Error Class
// =============================================================================

/**
 * Help Scout API Error
 */
export class HelpScoutError extends Error {
  statusCode: number
  error: string
  errors: { path?: string; message: string; source?: string }[]

  constructor(response: HelpScoutErrorResponse, statusCode: number) {
    const message = response.message ?? response.error ?? 'Unknown error'
    super(message)
    this.name = 'HelpScoutError'
    this.statusCode = statusCode
    this.error = response.error ?? 'unknown'
    this.errors = response._embedded?.errors ?? []
  }
}

// =============================================================================
// Resource Base Class
// =============================================================================

/**
 * Base class for Help Scout API resources
 */
abstract class HelpScoutResource {
  protected client: Client

  constructor(client: Client) {
    this.client = client
  }

  protected request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.client._request(method, path, params as Record<string, unknown> | undefined, options)
  }
}

// =============================================================================
// Conversations Resource
// =============================================================================

/**
 * Conversations resource for managing Help Scout conversations
 */
export class ConversationsResource extends HelpScoutResource {
  /**
   * Create a new conversation
   */
  async create(params: ConversationCreateParams, options?: RequestOptions): Promise<Conversation> {
    return this.request<Conversation>('POST', '/v2/conversations', params, options)
  }

  /**
   * Get a conversation by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Conversation> {
    return this.request<Conversation>('GET', `/v2/conversations/${id}`, undefined, options)
  }

  /**
   * Update a conversation (uses JSON Patch)
   */
  async update(id: number, operations: ConversationUpdateParams[], options?: RequestOptions): Promise<void> {
    await this.request<void>('PATCH', `/v2/conversations/${id}`, operations, options)
  }

  /**
   * Delete a conversation
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/conversations/${id}`, undefined, options)
  }

  /**
   * List conversations
   */
  async list(
    params?: ConversationListParams,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Conversation>> {
    return this.request<HalCollectionResponse<Conversation>>('GET', '/v2/conversations', params, options)
  }

  /**
   * Search conversations
   */
  async search(
    params: ConversationSearchParams,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Conversation>> {
    return this.request<HalCollectionResponse<Conversation>>('GET', '/v2/search/conversations', params, options)
  }

  /**
   * List threads for a conversation
   */
  async listThreads(
    conversationId: number,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Thread>> {
    return this.request<HalCollectionResponse<Thread>>(
      'GET',
      `/v2/conversations/${conversationId}/threads`,
      undefined,
      options
    )
  }

  /**
   * Create a customer thread (incoming message)
   */
  async createCustomerThread(
    conversationId: number,
    params: { text: string; customer?: { id?: number; email?: string }; imported?: boolean; createdAt?: string },
    options?: RequestOptions
  ): Promise<Thread> {
    return this.request<Thread>('POST', `/v2/conversations/${conversationId}/customer`, params, options)
  }

  /**
   * Create a reply thread (outgoing message)
   */
  async createReply(
    conversationId: number,
    params: { text: string; user: number; imported?: boolean; createdAt?: string; cc?: string[]; bcc?: string[] },
    options?: RequestOptions
  ): Promise<Thread> {
    return this.request<Thread>('POST', `/v2/conversations/${conversationId}/reply`, params, options)
  }

  /**
   * Create a note (internal)
   */
  async createNote(
    conversationId: number,
    params: { text: string; user: number; imported?: boolean; createdAt?: string },
    options?: RequestOptions
  ): Promise<Thread> {
    return this.request<Thread>('POST', `/v2/conversations/${conversationId}/notes`, params, options)
  }

  /**
   * Update conversation tags
   */
  async updateTags(conversationId: number, tags: string[], options?: RequestOptions): Promise<void> {
    await this.request<void>('PUT', `/v2/conversations/${conversationId}/tags`, { tags }, options)
  }

  /**
   * Update conversation custom fields
   */
  async updateCustomFields(
    conversationId: number,
    fields: { id: number; value: string | number | boolean }[],
    options?: RequestOptions
  ): Promise<void> {
    await this.request<void>('PUT', `/v2/conversations/${conversationId}/fields`, { fields }, options)
  }
}

// =============================================================================
// Customers Resource
// =============================================================================

/**
 * Customers resource for managing Help Scout customers
 */
export class CustomersResource extends HelpScoutResource {
  /**
   * Create a new customer
   */
  async create(params: CustomerCreateParams, options?: RequestOptions): Promise<Customer> {
    return this.request<Customer>('POST', '/v2/customers', params, options)
  }

  /**
   * Get a customer by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Customer> {
    return this.request<Customer>('GET', `/v2/customers/${id}`, undefined, options)
  }

  /**
   * Update a customer
   */
  async update(id: number, params: CustomerUpdateParams, options?: RequestOptions): Promise<Customer> {
    return this.request<Customer>('PUT', `/v2/customers/${id}`, params, options)
  }

  /**
   * Delete a customer
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/customers/${id}`, undefined, options)
  }

  /**
   * List customers
   */
  async list(
    params?: CustomerListParams,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Customer>> {
    return this.request<HalCollectionResponse<Customer>>('GET', '/v2/customers', params, options)
  }

  /**
   * Search customers
   */
  async search(
    params: { query: string; page?: number; pageSize?: number },
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Customer>> {
    return this.request<HalCollectionResponse<Customer>>('GET', '/v2/search/customers', params, options)
  }

  /**
   * Get conversations for a customer
   */
  async listConversations(
    customerId: number,
    params?: { mailbox?: number; status?: string; page?: number },
    options?: RequestOptions
  ): Promise<HalCollectionResponse<Conversation>> {
    return this.request<HalCollectionResponse<Conversation>>(
      'GET',
      `/v2/customers/${customerId}/conversations`,
      params,
      options
    )
  }

  /**
   * Add an email to a customer
   */
  async addEmail(
    customerId: number,
    email: { type: 'home' | 'work' | 'other'; value: string },
    options?: RequestOptions
  ): Promise<void> {
    await this.request<void>('POST', `/v2/customers/${customerId}/emails`, email, options)
  }

  /**
   * Delete an email from a customer
   */
  async deleteEmail(customerId: number, emailId: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/customers/${customerId}/emails/${emailId}`, undefined, options)
  }
}

// =============================================================================
// Mailboxes Resource
// =============================================================================

/**
 * Mailboxes resource for managing Help Scout mailboxes
 */
export class MailboxesResource extends HelpScoutResource {
  /**
   * List mailboxes
   */
  async list(options?: RequestOptions): Promise<HalCollectionResponse<Mailbox>> {
    return this.request<HalCollectionResponse<Mailbox>>('GET', '/v2/mailboxes', undefined, options)
  }

  /**
   * Get a mailbox by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Mailbox> {
    return this.request<Mailbox>('GET', `/v2/mailboxes/${id}`, undefined, options)
  }

  /**
   * List folders for a mailbox
   */
  async listFolders(mailboxId: number, options?: RequestOptions): Promise<HalCollectionResponse<Folder>> {
    return this.request<HalCollectionResponse<Folder>>(
      'GET',
      `/v2/mailboxes/${mailboxId}/folders`,
      undefined,
      options
    )
  }

  /**
   * List custom fields for a mailbox
   */
  async listFields(mailboxId: number, options?: RequestOptions): Promise<HalCollectionResponse<MailboxField>> {
    return this.request<HalCollectionResponse<MailboxField>>(
      'GET',
      `/v2/mailboxes/${mailboxId}/fields`,
      undefined,
      options
    )
  }
}

// =============================================================================
// Users Resource
// =============================================================================

/**
 * Users resource for managing Help Scout users (agents)
 */
export class UsersResource extends HelpScoutResource {
  /**
   * List users
   */
  async list(params?: UserListParams, options?: RequestOptions): Promise<HalCollectionResponse<User>> {
    return this.request<HalCollectionResponse<User>>('GET', '/v2/users', params, options)
  }

  /**
   * Get a user by ID
   */
  async get(id: number, options?: RequestOptions): Promise<User> {
    return this.request<User>('GET', `/v2/users/${id}`, undefined, options)
  }

  /**
   * Get the current authenticated user
   */
  async me(options?: RequestOptions): Promise<User> {
    return this.request<User>('GET', '/v2/users/me', undefined, options)
  }

  /**
   * List users in a mailbox
   */
  async listByMailbox(
    mailboxId: number,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<User>> {
    return this.request<HalCollectionResponse<User>>('GET', `/v2/mailboxes/${mailboxId}/users`, undefined, options)
  }
}

// =============================================================================
// Saved Replies Resource
// =============================================================================

/**
 * Saved Replies resource for managing macros
 */
export class SavedRepliesResource extends HelpScoutResource {
  /**
   * List saved replies for a mailbox
   */
  async list(
    mailboxId: number,
    options?: RequestOptions
  ): Promise<HalCollectionResponse<SavedReply>> {
    return this.request<HalCollectionResponse<SavedReply>>(
      'GET',
      `/v2/mailboxes/${mailboxId}/saved-replies`,
      undefined,
      options
    )
  }

  /**
   * Get a saved reply by ID
   */
  async get(mailboxId: number, id: number, options?: RequestOptions): Promise<SavedReply> {
    return this.request<SavedReply>('GET', `/v2/mailboxes/${mailboxId}/saved-replies/${id}`, undefined, options)
  }

  /**
   * Create a saved reply
   */
  async create(params: SavedReplyCreateParams, options?: RequestOptions): Promise<SavedReply> {
    return this.request<SavedReply>('POST', '/v2/saved-replies', params, options)
  }

  /**
   * Update a saved reply
   */
  async update(id: number, params: SavedReplyUpdateParams, options?: RequestOptions): Promise<SavedReply> {
    return this.request<SavedReply>('PUT', `/v2/saved-replies/${id}`, params, options)
  }

  /**
   * Delete a saved reply
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/saved-replies/${id}`, undefined, options)
  }
}

// =============================================================================
// Tags Resource
// =============================================================================

/**
 * Tags resource for managing Help Scout tags
 */
export class TagsResource extends HelpScoutResource {
  /**
   * List tags
   */
  async list(options?: RequestOptions): Promise<HalCollectionResponse<Tag>> {
    return this.request<HalCollectionResponse<Tag>>('GET', '/v2/tags', undefined, options)
  }

  /**
   * Create a tag
   */
  async create(params: TagCreateParams, options?: RequestOptions): Promise<Tag> {
    return this.request<Tag>('POST', '/v2/tags', params, options)
  }

  /**
   * Delete a tag
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/tags/${id}`, undefined, options)
  }
}

// =============================================================================
// Webhooks Resource
// =============================================================================

/**
 * Webhooks resource for managing Help Scout webhooks
 */
export class WebhooksResource extends HelpScoutResource {
  /**
   * List webhooks
   */
  async list(options?: RequestOptions): Promise<HalCollectionResponse<Webhook>> {
    return this.request<HalCollectionResponse<Webhook>>('GET', '/v2/webhooks', undefined, options)
  }

  /**
   * Get a webhook by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>('GET', `/v2/webhooks/${id}`, undefined, options)
  }

  /**
   * Create a webhook
   */
  async create(params: WebhookCreateParams, options?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>('POST', '/v2/webhooks', params, options)
  }

  /**
   * Update a webhook
   */
  async update(id: number, params: Partial<WebhookCreateParams>, options?: RequestOptions): Promise<Webhook> {
    return this.request<Webhook>('PUT', `/v2/webhooks/${id}`, params, options)
  }

  /**
   * Delete a webhook
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v2/webhooks/${id}`, undefined, options)
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * Help Scout client for API interactions
 */
export class Client {
  private accessToken: string
  private baseUrl: string
  private _fetch: typeof fetch | FetchFunction

  // Resources
  readonly conversations: ConversationsResource
  readonly customers: CustomersResource
  readonly mailboxes: MailboxesResource
  readonly users: UsersResource
  readonly savedReplies: SavedRepliesResource
  readonly tags: TagsResource
  readonly webhooks: WebhooksResource

  constructor(config: ClientConfig) {
    if (!config.oauth) {
      throw new Error('OAuth credentials are required')
    }

    if (!config.oauth.accessToken) {
      throw new Error('Access token is required')
    }

    this.accessToken = config.oauth.accessToken
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.conversations = new ConversationsResource(this)
    this.customers = new CustomersResource(this)
    this.mailboxes = new MailboxesResource(this)
    this.users = new UsersResource(this)
    this.savedReplies = new SavedRepliesResource(this)
    this.tags = new TagsResource(this)
    this.webhooks = new WebhooksResource(this)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params?: Record<string, unknown> | unknown[],
    _options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params && !Array.isArray(params)) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // Build request body for POST/PUT/PATCH/DELETE with params
    let body: string | undefined
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && params) {
      body = JSON.stringify(params)
    }

    const response = await this._fetch(url.toString(), {
      method,
      headers,
      body,
    })

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T
    }

    const data = await response.json()

    if (!response.ok) {
      throw new HelpScoutError(data as HelpScoutErrorResponse, response.status)
    }

    return data as T
  }
}

// =============================================================================
// Exports
// =============================================================================

export default { Client }
