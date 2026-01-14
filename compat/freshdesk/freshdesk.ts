/**
 * @dotdo/freshdesk - Freshdesk API Compatibility Layer
 *
 * Drop-in replacement for Freshdesk API SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import Freshdesk from '@dotdo/freshdesk'
 *
 * const client = new Freshdesk.Client({
 *   domain: 'mycompany',
 *   apiKey: 'your_api_key',
 * })
 *
 * // Create a ticket
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need help with...',
 *   email: 'user@example.com',
 *   priority: 2,
 *   status: 2,
 * })
 * ```
 *
 * @module @dotdo/freshdesk
 */

import type {
  ClientConfig,
  RequestOptions,
  FreshdeskErrorResponse,
  FetchFunction,
  // Ticket types
  Ticket,
  TicketCreateParams,
  TicketUpdateParams,
  TicketListParams,
  TicketSearchParams,
  SearchResponse,
  // Conversation types
  Conversation,
  ReplyCreateParams,
  NoteCreateParams,
  // Contact types
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,
  // Company types
  Company,
  CompanyCreateParams,
  CompanyUpdateParams,
  CompanyListParams,
  // Agent types
  Agent,
  AgentCreateParams,
  AgentUpdateParams,
  AgentListParams,
  // Group types
  Group,
  GroupCreateParams,
  GroupUpdateParams,
  // Canned Response types
  CannedResponse,
} from './types'

// =============================================================================
// Freshdesk Error Class
// =============================================================================

/**
 * Freshdesk API Error
 */
export class FreshdeskError extends Error {
  code: string
  statusCode: number
  description: string
  errors: { field?: string; message: string; code: string }[]

  constructor(response: FreshdeskErrorResponse, statusCode: number) {
    const message = response.errors?.[0]?.message ?? response.description ?? 'Unknown error'
    super(message)
    this.name = 'FreshdeskError'
    this.code = response.errors?.[0]?.code ?? 'unknown'
    this.statusCode = statusCode
    this.description = response.description
    this.errors = response.errors ?? []
  }
}

// =============================================================================
// Resource Base Class
// =============================================================================

/**
 * Base class for Freshdesk API resources
 */
abstract class FreshdeskResource {
  protected client: Client

  constructor(client: Client) {
    this.client = client
  }

  protected request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.client._request(method, path, params as Record<string, unknown> | undefined, options)
  }
}

// =============================================================================
// Tickets Resource
// =============================================================================

/**
 * Tickets resource for managing Freshdesk tickets
 */
export class TicketsResource extends FreshdeskResource {
  /**
   * Create a new ticket
   */
  async create(params: TicketCreateParams, options?: RequestOptions): Promise<Ticket> {
    return this.request<Ticket>('POST', '/api/v2/tickets', params, options)
  }

  /**
   * Get a ticket by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Ticket> {
    return this.request<Ticket>('GET', `/api/v2/tickets/${id}`, undefined, options)
  }

  /**
   * Update a ticket
   */
  async update(id: number, params: TicketUpdateParams, options?: RequestOptions): Promise<Ticket> {
    return this.request<Ticket>('PUT', `/api/v2/tickets/${id}`, params, options)
  }

  /**
   * Delete a ticket
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/tickets/${id}`, undefined, options)
  }

  /**
   * List tickets
   */
  async list(params?: TicketListParams, options?: RequestOptions): Promise<Ticket[]> {
    return this.request<Ticket[]>('GET', '/api/v2/tickets', params, options)
  }

  /**
   * Search tickets by query
   */
  async search(params: TicketSearchParams, options?: RequestOptions): Promise<SearchResponse<Ticket>> {
    return this.request<SearchResponse<Ticket>>('GET', '/api/v2/search/tickets', params, options)
  }

  /**
   * Restore a deleted ticket
   */
  async restore(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('PUT', `/api/v2/tickets/${id}/restore`, undefined, options)
  }
}

// =============================================================================
// Conversations Resource
// =============================================================================

/**
 * Conversations resource for managing ticket conversations
 */
export class ConversationsResource extends FreshdeskResource {
  /**
   * List conversations for a ticket
   */
  async list(ticketId: number, options?: RequestOptions): Promise<Conversation[]> {
    return this.request<Conversation[]>('GET', `/api/v2/tickets/${ticketId}/conversations`, undefined, options)
  }

  /**
   * Create a reply to a ticket
   */
  async createReply(ticketId: number, params: ReplyCreateParams, options?: RequestOptions): Promise<Conversation> {
    return this.request<Conversation>('POST', `/api/v2/tickets/${ticketId}/reply`, params, options)
  }

  /**
   * Create a note on a ticket
   */
  async createNote(ticketId: number, params: NoteCreateParams, options?: RequestOptions): Promise<Conversation> {
    return this.request<Conversation>('POST', `/api/v2/tickets/${ticketId}/notes`, params, options)
  }

  /**
   * Update a conversation (note only)
   */
  async update(conversationId: number, params: { body: string }, options?: RequestOptions): Promise<Conversation> {
    return this.request<Conversation>('PUT', `/api/v2/conversations/${conversationId}`, params, options)
  }

  /**
   * Delete a conversation
   */
  async delete(conversationId: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/conversations/${conversationId}`, undefined, options)
  }
}

// =============================================================================
// Contacts Resource
// =============================================================================

/**
 * Contacts resource for managing Freshdesk contacts
 */
export class ContactsResource extends FreshdeskResource {
  /**
   * Create a new contact
   */
  async create(params: ContactCreateParams, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('POST', '/api/v2/contacts', params, options)
  }

  /**
   * Get a contact by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('GET', `/api/v2/contacts/${id}`, undefined, options)
  }

  /**
   * Update a contact
   */
  async update(id: number, params: ContactUpdateParams, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('PUT', `/api/v2/contacts/${id}`, params, options)
  }

  /**
   * Delete a contact (soft delete)
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/contacts/${id}`, undefined, options)
  }

  /**
   * Permanently delete a contact (hard delete)
   */
  async hardDelete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/contacts/${id}/hard_delete`, undefined, options)
  }

  /**
   * Restore a soft-deleted contact
   */
  async restore(id: number, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('PUT', `/api/v2/contacts/${id}/restore`, undefined, options)
  }

  /**
   * List contacts
   */
  async list(params?: ContactListParams, options?: RequestOptions): Promise<Contact[]> {
    return this.request<Contact[]>('GET', '/api/v2/contacts', params, options)
  }

  /**
   * Search contacts by query
   */
  async search(params: ContactSearchParams, options?: RequestOptions): Promise<SearchResponse<Contact>> {
    return this.request<SearchResponse<Contact>>('GET', '/api/v2/search/contacts', params, options)
  }

  /**
   * Make a contact an agent
   */
  async makeAgent(id: number, options?: RequestOptions): Promise<Agent> {
    return this.request<Agent>('PUT', `/api/v2/contacts/${id}/make_agent`, undefined, options)
  }

  /**
   * Merge contacts
   */
  async merge(primaryId: number, secondaryId: number, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('PUT', `/api/v2/contacts/${primaryId}/merge`, { secondary_contact_id: secondaryId }, options)
  }
}

// =============================================================================
// Companies Resource
// =============================================================================

/**
 * Companies resource for managing Freshdesk companies
 */
export class CompaniesResource extends FreshdeskResource {
  /**
   * Create a new company
   */
  async create(params: CompanyCreateParams, options?: RequestOptions): Promise<Company> {
    return this.request<Company>('POST', '/api/v2/companies', params, options)
  }

  /**
   * Get a company by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Company> {
    return this.request<Company>('GET', `/api/v2/companies/${id}`, undefined, options)
  }

  /**
   * Update a company
   */
  async update(id: number, params: CompanyUpdateParams, options?: RequestOptions): Promise<Company> {
    return this.request<Company>('PUT', `/api/v2/companies/${id}`, params, options)
  }

  /**
   * Delete a company
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/companies/${id}`, undefined, options)
  }

  /**
   * List companies
   */
  async list(params?: CompanyListParams, options?: RequestOptions): Promise<Company[]> {
    return this.request<Company[]>('GET', '/api/v2/companies', params, options)
  }

  /**
   * Search companies by query
   */
  async search(params: { query: string; page?: number }, options?: RequestOptions): Promise<SearchResponse<Company>> {
    return this.request<SearchResponse<Company>>('GET', '/api/v2/search/companies', params, options)
  }
}

// =============================================================================
// Agents Resource
// =============================================================================

/**
 * Agents resource for managing Freshdesk agents
 */
export class AgentsResource extends FreshdeskResource {
  /**
   * Create a new agent
   */
  async create(params: AgentCreateParams, options?: RequestOptions): Promise<Agent> {
    return this.request<Agent>('POST', '/api/v2/agents', params, options)
  }

  /**
   * Get an agent by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Agent> {
    return this.request<Agent>('GET', `/api/v2/agents/${id}`, undefined, options)
  }

  /**
   * Update an agent
   */
  async update(id: number, params: AgentUpdateParams, options?: RequestOptions): Promise<Agent> {
    return this.request<Agent>('PUT', `/api/v2/agents/${id}`, params, options)
  }

  /**
   * Delete an agent
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/agents/${id}`, undefined, options)
  }

  /**
   * List agents
   */
  async list(params?: AgentListParams, options?: RequestOptions): Promise<Agent[]> {
    return this.request<Agent[]>('GET', '/api/v2/agents', params, options)
  }

  /**
   * Get the currently authenticated agent
   */
  async me(options?: RequestOptions): Promise<Agent> {
    return this.request<Agent>('GET', '/api/v2/agents/me', undefined, options)
  }
}

// =============================================================================
// Groups Resource
// =============================================================================

/**
 * Groups resource for managing Freshdesk groups
 */
export class GroupsResource extends FreshdeskResource {
  /**
   * Create a new group
   */
  async create(params: GroupCreateParams, options?: RequestOptions): Promise<Group> {
    return this.request<Group>('POST', '/api/v2/groups', params, options)
  }

  /**
   * Get a group by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Group> {
    return this.request<Group>('GET', `/api/v2/groups/${id}`, undefined, options)
  }

  /**
   * Update a group
   */
  async update(id: number, params: GroupUpdateParams, options?: RequestOptions): Promise<Group> {
    return this.request<Group>('PUT', `/api/v2/groups/${id}`, params, options)
  }

  /**
   * Delete a group
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/groups/${id}`, undefined, options)
  }

  /**
   * List groups
   */
  async list(options?: RequestOptions): Promise<Group[]> {
    return this.request<Group[]>('GET', '/api/v2/groups', undefined, options)
  }
}

// =============================================================================
// Canned Responses Resource
// =============================================================================

/**
 * Canned Responses resource for managing saved replies
 */
export class CannedResponsesResource extends FreshdeskResource {
  /**
   * Get a canned response by ID
   */
  async get(id: number, options?: RequestOptions): Promise<CannedResponse> {
    return this.request<CannedResponse>('GET', `/api/v2/canned_responses/${id}`, undefined, options)
  }

  /**
   * List canned responses
   */
  async list(options?: RequestOptions): Promise<CannedResponse[]> {
    return this.request<CannedResponse[]>('GET', '/api/v2/canned_responses', undefined, options)
  }

  /**
   * List canned responses in a folder
   */
  async listInFolder(folderId: number, options?: RequestOptions): Promise<CannedResponse[]> {
    return this.request<CannedResponse[]>('GET', `/api/v2/canned_response_folders/${folderId}/responses`, undefined, options)
  }

  /**
   * List canned response folders
   */
  async listFolders(options?: RequestOptions): Promise<{ id: number; name: string; responses_count: number }[]> {
    return this.request<{ id: number; name: string; responses_count: number }[]>(
      'GET',
      '/api/v2/canned_response_folders',
      undefined,
      options
    )
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * Freshdesk client for API interactions
 */
export class Client {
  private domain: string
  private apiKey: string
  private _fetch: typeof fetch | FetchFunction

  // Resources
  readonly tickets: TicketsResource
  readonly conversations: ConversationsResource
  readonly contacts: ContactsResource
  readonly companies: CompaniesResource
  readonly agents: AgentsResource
  readonly groups: GroupsResource
  readonly cannedResponses: CannedResponsesResource

  constructor(config: ClientConfig) {
    if (!config.domain) {
      throw new Error('Domain is required')
    }

    if (!config.apiKey) {
      throw new Error('API key is required')
    }

    this.domain = config.domain
    this.apiKey = config.apiKey
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.tickets = new TicketsResource(this)
    this.conversations = new ConversationsResource(this)
    this.contacts = new ContactsResource(this)
    this.companies = new CompaniesResource(this)
    this.agents = new AgentsResource(this)
    this.groups = new GroupsResource(this)
    this.cannedResponses = new CannedResponsesResource(this)
  }

  /**
   * Get base URL for API requests
   */
  private get baseUrl(): string {
    return `https://${this.domain}.freshdesk.com`
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    _options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Freshdesk uses Basic auth with API key as username and 'X' as password
    const credentials = btoa(`${this.apiKey}:X`)
    const headers: Record<string, string> = {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // Build request body for POST/PUT with params
    let body: string | undefined
    if ((method === 'POST' || method === 'PUT') && params) {
      body = JSON.stringify(params)
    }

    const response = await this._fetch(url.toString(), {
      method,
      headers,
      body,
    })

    // Handle empty responses (204 No Content for DELETE)
    if (response.status === 204) {
      return {} as T
    }

    const data = await response.json()

    if (!response.ok) {
      throw new FreshdeskError(data as FreshdeskErrorResponse, response.status)
    }

    return data as T
  }
}

// =============================================================================
// Exports
// =============================================================================

export default { Client }
