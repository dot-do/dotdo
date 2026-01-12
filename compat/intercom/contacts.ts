/**
 * @dotdo/intercom - Contacts Resource
 *
 * Manages Intercom contacts (users and leads) with support for:
 * - Create, update, delete contacts
 * - List and search contacts
 * - Merge contacts
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

/**
 * Contacts resource for managing Intercom contacts (users and leads)
 *
 * @example
 * ```typescript
 * // Create a user
 * const user = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   custom_attributes: { plan: 'premium' },
 * })
 *
 * // Create a lead
 * const lead = await client.contacts.create({
 *   role: 'lead',
 *   email: 'lead@example.com',
 * })
 *
 * // Search contacts
 * const results = await client.contacts.search({
 *   query: { field: 'email', operator: '=', value: 'user@example.com' },
 * })
 * ```
 */
export class ContactsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create a new contact
   *
   * @param params - Contact creation parameters
   * @param options - Request options
   * @returns The created contact
   */
  async create(params: ContactCreateParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('POST', '/contacts', params as Record<string, unknown>, options)
  }

  /**
   * Find a contact by ID
   *
   * @param id - Contact ID
   * @param options - Request options
   * @returns The contact
   */
  async find(id: string, options?: RequestOptions): Promise<Contact> {
    return this.client._request('GET', `/contacts/${id}`, undefined, options)
  }

  /**
   * Update a contact
   *
   * @param id - Contact ID
   * @param params - Contact update parameters
   * @param options - Request options
   * @returns The updated contact
   */
  async update(id: string, params: ContactUpdateParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('PUT', `/contacts/${id}`, params as Record<string, unknown>, options)
  }

  /**
   * Delete a contact
   *
   * @param id - Contact ID
   * @param options - Request options
   * @returns Deletion confirmation
   */
  async delete(id: string, options?: RequestOptions): Promise<DeletedContact> {
    return this.client._request('DELETE', `/contacts/${id}`, undefined, options)
  }

  /**
   * List all contacts
   *
   * @param params - Pagination parameters
   * @param options - Request options
   * @returns Paginated list of contacts
   */
  async list(params?: ContactListParams, options?: RequestOptions): Promise<ListResponse<Contact>> {
    return this.client._request('GET', '/contacts', params as Record<string, unknown>, options)
  }

  /**
   * Search for contacts
   *
   * Supports nested queries with AND/OR operators.
   *
   * @example
   * ```typescript
   * // Simple query
   * await client.contacts.search({
   *   query: { field: 'email', operator: '=', value: 'user@example.com' },
   * })
   *
   * // Nested query
   * await client.contacts.search({
   *   query: {
   *     operator: 'AND',
   *     value: [
   *       { field: 'email', operator: '~', value: '@company.com' },
   *       { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
   *     ],
   *   },
   * })
   * ```
   *
   * @param params - Search parameters
   * @param options - Request options
   * @returns Paginated search results
   */
  async search(params: ContactSearchParams, options?: RequestOptions): Promise<SearchResponse<Contact>> {
    return this.client._request('POST', '/contacts/search', params as Record<string, unknown>, options)
  }

  /**
   * Merge two contacts
   *
   * The contact specified in `from` will be merged into the contact specified in `into`.
   * The `from` contact will be deleted.
   *
   * @param params - Merge parameters
   * @param options - Request options
   * @returns The merged contact
   */
  async merge(params: ContactMergeParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('POST', '/contacts/merge', params as Record<string, unknown>, options)
  }
}
