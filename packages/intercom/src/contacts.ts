/**
 * @dotdo/intercom - Contacts Resource
 *
 * Comprehensive Intercom contacts (users and leads) management with support for:
 * - Create, read, update, delete (CRUD) operations
 * - Search contacts by attributes with nested AND/OR queries
 * - Merge duplicate contacts
 * - Tag management (add/remove tags)
 * - Company associations (attach/detach)
 * - Custom attributes
 * - Notes
 * - Archive/unarchive contacts
 * - Subscriptions management
 *
 * @module @dotdo/intercom/contacts
 */

import type {
  RequestOptions,
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,
  ContactMergeParams,
  DeletedContact,
  ListResponse,
  SearchResponse,
  Tag,
  TagRef,
  ContactTagParams,
  Company,
  CompanyRef,
  ContactCompanyAttachParams,
  Note,
  NoteCreateParams,
  Segment,
  ContactSubscription,
  ContactSubscriptionUpdateParams,
} from './types'

/**
 * Base client interface for making API requests
 */
export interface IntercomClientInterface {
  _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T>
}

// =============================================================================
// Contact Tags Sub-Resource
// =============================================================================

/**
 * Manages tags on a contact
 */
export class ContactTagsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Add a tag to a contact
   */
  async add(contactId: string, params: ContactTagParams, options?: RequestOptions): Promise<Tag> {
    return this.client._request('POST', `/contacts/${contactId}/tags`, params as Record<string, unknown>, options)
  }

  /**
   * Remove a tag from a contact
   */
  async remove(contactId: string, tagId: string, options?: RequestOptions): Promise<Tag> {
    return this.client._request('DELETE', `/contacts/${contactId}/tags/${tagId}`, undefined, options)
  }

  /**
   * List all tags on a contact
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<TagRef>> {
    return this.client._request('GET', `/contacts/${contactId}/tags`, undefined, options)
  }
}

// =============================================================================
// Contact Companies Sub-Resource
// =============================================================================

/**
 * Manages company associations for a contact
 */
export class ContactCompaniesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Attach a contact to a company
   */
  async attach(
    contactId: string,
    params: ContactCompanyAttachParams,
    options?: RequestOptions
  ): Promise<Company> {
    return this.client._request('POST', `/contacts/${contactId}/companies`, params as Record<string, unknown>, options)
  }

  /**
   * Detach a contact from a company
   */
  async detach(
    contactId: string,
    companyId: string,
    options?: RequestOptions
  ): Promise<{ type: 'company'; id: string; deleted: true }> {
    return this.client._request(
      'DELETE',
      `/contacts/${contactId}/companies/${companyId}`,
      undefined,
      options
    )
  }

  /**
   * List all companies for a contact
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<CompanyRef>> {
    return this.client._request('GET', `/contacts/${contactId}/companies`, undefined, options)
  }
}

// =============================================================================
// Contact Notes Sub-Resource
// =============================================================================

/**
 * Manages notes on a contact
 */
export class ContactNotesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create a note on a contact
   */
  async create(contactId: string, params: NoteCreateParams, options?: RequestOptions): Promise<Note> {
    return this.client._request('POST', `/contacts/${contactId}/notes`, params as Record<string, unknown>, options)
  }

  /**
   * List all notes on a contact
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<Note>> {
    return this.client._request('GET', `/contacts/${contactId}/notes`, undefined, options)
  }
}

// =============================================================================
// Contact Segments Sub-Resource
// =============================================================================

/**
 * Lists segments for a contact
 */
export class ContactSegmentsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * List all segments for a contact
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<Segment>> {
    return this.client._request('GET', `/contacts/${contactId}/segments`, undefined, options)
  }
}

// =============================================================================
// Contact Subscriptions Sub-Resource
// =============================================================================

/**
 * Manages subscription preferences for a contact
 */
export class ContactSubscriptionsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * List all subscription types and contact's preferences
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<ContactSubscription>> {
    return this.client._request('GET', `/contacts/${contactId}/subscriptions`, undefined, options)
  }

  /**
   * Update a contact's subscription preference
   */
  async update(
    contactId: string,
    subscriptionId: string,
    params: ContactSubscriptionUpdateParams,
    options?: RequestOptions
  ): Promise<ContactSubscription> {
    return this.client._request(
      'PUT',
      `/contacts/${contactId}/subscriptions/${subscriptionId}`,
      params as Record<string, unknown>,
      options
    )
  }
}

// =============================================================================
// Main Contacts Resource
// =============================================================================

/**
 * Contacts resource for managing Intercom contacts (users and leads)
 */
export class ContactsResource {
  private client: IntercomClientInterface

  /** Tag management for contacts */
  readonly tags: ContactTagsResource
  /** Company associations for contacts */
  readonly companies: ContactCompaniesResource
  /** Notes on contacts */
  readonly notes: ContactNotesResource
  /** Segments containing the contact */
  readonly segments: ContactSegmentsResource
  /** Subscription preferences for contacts */
  readonly subscriptions: ContactSubscriptionsResource

  constructor(client: IntercomClientInterface) {
    this.client = client
    this.tags = new ContactTagsResource(client)
    this.companies = new ContactCompaniesResource(client)
    this.notes = new ContactNotesResource(client)
    this.segments = new ContactSegmentsResource(client)
    this.subscriptions = new ContactSubscriptionsResource(client)
  }

  /**
   * Create a new contact
   */
  async create(params: ContactCreateParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('POST', '/contacts', params as Record<string, unknown>, options)
  }

  /**
   * Find a contact by ID
   */
  async find(id: string, options?: RequestOptions): Promise<Contact> {
    return this.client._request('GET', `/contacts/${id}`, undefined, options)
  }

  /**
   * Find a contact by email
   */
  async findByEmail(email: string, options?: RequestOptions): Promise<Contact | null> {
    const result = await this.search({
      query: { field: 'email', operator: '=', value: email },
    }, options)
    return result.data[0] ?? null
  }

  /**
   * Find a contact by external ID
   */
  async findByExternalId(externalId: string, options?: RequestOptions): Promise<Contact | null> {
    const result = await this.search({
      query: { field: 'external_id', operator: '=', value: externalId },
    }, options)
    return result.data[0] ?? null
  }

  /**
   * Update a contact
   */
  async update(id: string, params: ContactUpdateParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('PUT', `/contacts/${id}`, params as Record<string, unknown>, options)
  }

  /**
   * Delete a contact
   */
  async delete(id: string, options?: RequestOptions): Promise<DeletedContact> {
    return this.client._request('DELETE', `/contacts/${id}`, undefined, options)
  }

  /**
   * Archive a contact
   */
  async archive(id: string, options?: RequestOptions): Promise<{ type: 'contact'; id: string; archived: true }> {
    return this.client._request('POST', `/contacts/${id}/archive`, undefined, options)
  }

  /**
   * Unarchive a contact
   */
  async unarchive(id: string, options?: RequestOptions): Promise<{ type: 'contact'; id: string; archived: false }> {
    return this.client._request('POST', `/contacts/${id}/unarchive`, undefined, options)
  }

  /**
   * List all contacts
   */
  async list(params?: ContactListParams, options?: RequestOptions): Promise<ListResponse<Contact>> {
    return this.client._request('GET', '/contacts', params as Record<string, unknown>, options)
  }

  /**
   * Search for contacts
   */
  async search(params: ContactSearchParams, options?: RequestOptions): Promise<SearchResponse<Contact>> {
    return this.client._request('POST', '/contacts/search', params as Record<string, unknown>, options)
  }

  /**
   * Merge two contacts
   */
  async merge(params: ContactMergeParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('POST', '/contacts/merge', params as Record<string, unknown>, options)
  }

  /**
   * Convert a lead to a user
   */
  async convertToUser(
    leadId: string,
    params: { user?: { id?: string; user_id?: string; email?: string } },
    options?: RequestOptions
  ): Promise<Contact> {
    return this.client._request(
      'POST',
      `/contacts/${leadId}/convert`,
      { contact: { role: 'user' }, ...params } as Record<string, unknown>,
      options
    )
  }
}
