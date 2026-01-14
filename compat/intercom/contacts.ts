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
 * @example Basic CRUD
 * ```typescript
 * // Create a user
 * const user = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   custom_attributes: { plan: 'premium' },
 * })
 *
 * // Update contact
 * await client.contacts.update(user.id, { name: 'Jane Doe' })
 *
 * // Delete contact
 * await client.contacts.delete(user.id)
 * ```
 *
 * @example Search
 * ```typescript
 * // Simple search
 * const results = await client.contacts.search({
 *   query: { field: 'email', operator: '=', value: 'user@example.com' },
 * })
 *
 * // Nested query
 * const enterprise = await client.contacts.search({
 *   query: {
 *     operator: 'AND',
 *     value: [
 *       { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
 *       { field: 'role', operator: '=', value: 'user' },
 *     ],
 *   },
 * })
 * ```
 *
 * @example Tags
 * ```typescript
 * // Add tag to contact
 * await client.contacts.tags.add(contactId, { id: 'tag_123' })
 *
 * // Remove tag from contact
 * await client.contacts.tags.remove(contactId, 'tag_123')
 *
 * // List all tags on contact
 * const tags = await client.contacts.tags.list(contactId)
 * ```
 *
 * @example Companies
 * ```typescript
 * // Attach contact to company
 * await client.contacts.companies.attach(contactId, { id: 'company_123' })
 *
 * // Detach contact from company
 * await client.contacts.companies.detach(contactId, 'company_123')
 *
 * // List all companies for contact
 * const companies = await client.contacts.companies.list(contactId)
 * ```
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
 *
 * @example
 * ```typescript
 * // Add a tag
 * const tag = await client.contacts.tags.add(contactId, { id: 'tag_123' })
 *
 * // Remove a tag
 * await client.contacts.tags.remove(contactId, 'tag_123')
 *
 * // List all tags
 * const tags = await client.contacts.tags.list(contactId)
 * ```
 */
export class ContactTagsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Add a tag to a contact
   *
   * @param contactId - The contact ID
   * @param params - Tag parameters (id of the tag to add)
   * @param options - Request options
   * @returns The added tag
   */
  async add(contactId: string, params: ContactTagParams, options?: RequestOptions): Promise<Tag> {
    return this.client._request('POST', `/contacts/${contactId}/tags`, params as Record<string, unknown>, options)
  }

  /**
   * Remove a tag from a contact
   *
   * @param contactId - The contact ID
   * @param tagId - The tag ID to remove
   * @param options - Request options
   * @returns The removed tag
   */
  async remove(contactId: string, tagId: string, options?: RequestOptions): Promise<Tag> {
    return this.client._request('DELETE', `/contacts/${contactId}/tags/${tagId}`, undefined, options)
  }

  /**
   * List all tags on a contact
   *
   * @param contactId - The contact ID
   * @param options - Request options
   * @returns List of tags
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
 *
 * @example
 * ```typescript
 * // Attach to company
 * const company = await client.contacts.companies.attach(contactId, { id: 'company_123' })
 *
 * // Detach from company
 * await client.contacts.companies.detach(contactId, 'company_123')
 *
 * // List all companies
 * const companies = await client.contacts.companies.list(contactId)
 * ```
 */
export class ContactCompaniesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Attach a contact to a company
   *
   * @param contactId - The contact ID
   * @param params - Company parameters (id of the company to attach)
   * @param options - Request options
   * @returns The attached company
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
   *
   * @param contactId - The contact ID
   * @param companyId - The company ID to detach
   * @param options - Request options
   * @returns Detach confirmation
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
   *
   * @param contactId - The contact ID
   * @param options - Request options
   * @returns List of company references
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
 *
 * @example
 * ```typescript
 * // Create a note
 * const note = await client.contacts.notes.create(contactId, {
 *   body: 'Spoke with customer about their issue',
 *   admin_id: 'admin_123',
 * })
 *
 * // List notes
 * const notes = await client.contacts.notes.list(contactId)
 * ```
 */
export class ContactNotesResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Create a note on a contact
   *
   * @param contactId - The contact ID
   * @param params - Note creation parameters
   * @param options - Request options
   * @returns The created note
   */
  async create(contactId: string, params: NoteCreateParams, options?: RequestOptions): Promise<Note> {
    return this.client._request('POST', `/contacts/${contactId}/notes`, params as Record<string, unknown>, options)
  }

  /**
   * List all notes on a contact
   *
   * @param contactId - The contact ID
   * @param options - Request options
   * @returns List of notes
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
 *
 * @example
 * ```typescript
 * const segments = await client.contacts.segments.list(contactId)
 * ```
 */
export class ContactSegmentsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * List all segments for a contact
   *
   * @param contactId - The contact ID
   * @param options - Request options
   * @returns List of segments
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
 *
 * @example
 * ```typescript
 * // List subscriptions
 * const subs = await client.contacts.subscriptions.list(contactId)
 *
 * // Update subscription
 * await client.contacts.subscriptions.update(contactId, subscriptionId, {
 *   consent_type: 'opt_out',
 * })
 * ```
 */
export class ContactSubscriptionsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * List all subscription types and contact's preferences
   *
   * @param contactId - The contact ID
   * @param options - Request options
   * @returns List of subscriptions
   */
  async list(contactId: string, options?: RequestOptions): Promise<ListResponse<ContactSubscription>> {
    return this.client._request('GET', `/contacts/${contactId}/subscriptions`, undefined, options)
  }

  /**
   * Update a contact's subscription preference
   *
   * @param contactId - The contact ID
   * @param subscriptionId - The subscription type ID
   * @param params - Subscription update parameters
   * @param options - Request options
   * @returns Updated subscription
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
 *
 * Provides comprehensive contact management including:
 * - CRUD operations (create, find, update, delete)
 * - Search with nested AND/OR queries
 * - Merge duplicate contacts
 * - Tag management
 * - Company associations
 * - Notes
 * - Segments
 * - Subscriptions
 * - Archive/unarchive
 *
 * @example Basic operations
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
 * // Find by ID
 * const contact = await client.contacts.find('contact_123')
 *
 * // Find by email
 * const byEmail = await client.contacts.findByEmail('user@example.com')
 *
 * // Find by external ID
 * const byExternal = await client.contacts.findByExternalId('ext_123')
 *
 * // Update
 * await client.contacts.update('contact_123', {
 *   name: 'Jane Doe',
 *   custom_attributes: { plan: 'enterprise' },
 * })
 *
 * // Delete
 * await client.contacts.delete('contact_123')
 * ```
 *
 * @example Search
 * ```typescript
 * // Simple query
 * const results = await client.contacts.search({
 *   query: { field: 'email', operator: '=', value: 'user@example.com' },
 * })
 *
 * // Nested query with AND
 * const enterprise = await client.contacts.search({
 *   query: {
 *     operator: 'AND',
 *     value: [
 *       { field: 'email', operator: '~', value: '@company.com' },
 *       { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
 *     ],
 *   },
 * })
 *
 * // Nested query with OR
 * const vips = await client.contacts.search({
 *   query: {
 *     operator: 'OR',
 *     value: [
 *       { field: 'custom_attributes.vip', operator: '=', value: true },
 *       { field: 'custom_attributes.monthly_spend', operator: '>', value: 10000 },
 *     ],
 *   },
 *   sort: { field: 'created_at', order: 'descending' },
 * })
 * ```
 *
 * @example Merge duplicates
 * ```typescript
 * // Merge contact B into contact A (B is deleted)
 * const merged = await client.contacts.merge({
 *   from: 'contact_b_id',
 *   into: 'contact_a_id',
 * })
 * ```
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

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Create a new contact
   *
   * Creates a new user or lead in Intercom. The role field determines the contact type.
   *
   * @param params - Contact creation parameters
   * @param options - Request options
   * @returns The created contact
   *
   * @example Create user
   * ```typescript
   * const user = await client.contacts.create({
   *   role: 'user',
   *   email: 'user@example.com',
   *   name: 'John Doe',
   *   phone: '+1234567890',
   *   custom_attributes: {
   *     plan: 'premium',
   *     signup_source: 'website',
   *   },
   * })
   * ```
   *
   * @example Create lead
   * ```typescript
   * const lead = await client.contacts.create({
   *   role: 'lead',
   *   email: 'prospect@example.com',
   * })
   * ```
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
   *
   * @example
   * ```typescript
   * const contact = await client.contacts.find('contact_123')
   * console.log(contact.email, contact.name)
   * ```
   */
  async find(id: string, options?: RequestOptions): Promise<Contact> {
    return this.client._request('GET', `/contacts/${id}`, undefined, options)
  }

  /**
   * Find a contact by email
   *
   * Searches for a contact with the exact email address.
   *
   * @param email - Email address to search for
   * @param options - Request options
   * @returns The contact or null if not found
   *
   * @example
   * ```typescript
   * const contact = await client.contacts.findByEmail('user@example.com')
   * if (contact) {
   *   console.log('Found:', contact.id)
   * }
   * ```
   */
  async findByEmail(email: string, options?: RequestOptions): Promise<Contact | null> {
    const result = await this.search({
      query: { field: 'email', operator: '=', value: email },
    }, options)
    return result.data[0] ?? null
  }

  /**
   * Find a contact by external ID
   *
   * Searches for a contact with the specified external_id.
   *
   * @param externalId - External ID to search for
   * @param options - Request options
   * @returns The contact or null if not found
   *
   * @example
   * ```typescript
   * const contact = await client.contacts.findByExternalId('user_12345')
   * if (contact) {
   *   console.log('Found:', contact.id)
   * }
   * ```
   */
  async findByExternalId(externalId: string, options?: RequestOptions): Promise<Contact | null> {
    const result = await this.search({
      query: { field: 'external_id', operator: '=', value: externalId },
    }, options)
    return result.data[0] ?? null
  }

  /**
   * Update a contact
   *
   * Updates the specified contact with the provided parameters.
   * Only the fields specified will be updated.
   *
   * @param id - Contact ID
   * @param params - Contact update parameters
   * @param options - Request options
   * @returns The updated contact
   *
   * @example
   * ```typescript
   * const updated = await client.contacts.update('contact_123', {
   *   name: 'Jane Doe',
   *   custom_attributes: {
   *     plan: 'enterprise',
   *     upgraded_at: Date.now(),
   *   },
   * })
   * ```
   */
  async update(id: string, params: ContactUpdateParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('PUT', `/contacts/${id}`, params as Record<string, unknown>, options)
  }

  /**
   * Delete a contact
   *
   * Permanently deletes the contact. This action cannot be undone.
   *
   * @param id - Contact ID
   * @param options - Request options
   * @returns Deletion confirmation
   *
   * @example
   * ```typescript
   * const result = await client.contacts.delete('contact_123')
   * console.log(result.deleted) // true
   * ```
   */
  async delete(id: string, options?: RequestOptions): Promise<DeletedContact> {
    return this.client._request('DELETE', `/contacts/${id}`, undefined, options)
  }

  /**
   * Archive a contact
   *
   * Archives the contact. Archived contacts can be unarchived later.
   *
   * @param id - Contact ID
   * @param options - Request options
   * @returns Archive confirmation
   *
   * @example
   * ```typescript
   * const result = await client.contacts.archive('contact_123')
   * console.log(result.archived) // true
   * ```
   */
  async archive(id: string, options?: RequestOptions): Promise<{ type: 'contact'; id: string; archived: true }> {
    return this.client._request('POST', `/contacts/${id}/archive`, undefined, options)
  }

  /**
   * Unarchive a contact
   *
   * Restores an archived contact.
   *
   * @param id - Contact ID
   * @param options - Request options
   * @returns Unarchive confirmation
   *
   * @example
   * ```typescript
   * const result = await client.contacts.unarchive('contact_123')
   * console.log(result.archived) // false
   * ```
   */
  async unarchive(id: string, options?: RequestOptions): Promise<{ type: 'contact'; id: string; archived: false }> {
    return this.client._request('POST', `/contacts/${id}/unarchive`, undefined, options)
  }

  // ===========================================================================
  // List and Search
  // ===========================================================================

  /**
   * List all contacts
   *
   * Returns a paginated list of all contacts in the workspace.
   *
   * @param params - Pagination parameters
   * @param options - Request options
   * @returns Paginated list of contacts
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = await client.contacts.list({ per_page: 50 })
   *
   * // Next page
   * if (page1.pages.next) {
   *   const page2 = await client.contacts.list({
   *     per_page: 50,
   *     starting_after: page1.data[page1.data.length - 1].id,
   *   })
   * }
   * ```
   */
  async list(params?: ContactListParams, options?: RequestOptions): Promise<ListResponse<Contact>> {
    return this.client._request('GET', '/contacts', params as Record<string, unknown>, options)
  }

  /**
   * Search for contacts
   *
   * Searches contacts using the Intercom query language. Supports nested
   * queries with AND/OR operators.
   *
   * ## Query Operators
   *
   * - `=` - Equals
   * - `!=` - Not equals
   * - `>` - Greater than
   * - `<` - Less than
   * - `~` - Contains (substring match)
   * - `!~` - Does not contain
   * - `IN` - Value in array
   * - `NIN` - Value not in array
   * - `contains` - Contains (same as ~)
   * - `starts_with` - Starts with prefix
   *
   * ## Searchable Fields
   *
   * - `email` - Contact email
   * - `name` - Contact name
   * - `phone` - Phone number
   * - `role` - "user" or "lead"
   * - `external_id` - External ID
   * - `created_at` - Unix timestamp
   * - `updated_at` - Unix timestamp
   * - `signed_up_at` - Unix timestamp
   * - `last_seen_at` - Unix timestamp
   * - `custom_attributes.*` - Any custom attribute
   *
   * @param params - Search parameters
   * @param options - Request options
   * @returns Paginated search results
   *
   * @example Simple query
   * ```typescript
   * const results = await client.contacts.search({
   *   query: { field: 'email', operator: '=', value: 'user@example.com' },
   * })
   * ```
   *
   * @example Nested AND query
   * ```typescript
   * const results = await client.contacts.search({
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
   * @example Nested OR query with sorting
   * ```typescript
   * const results = await client.contacts.search({
   *   query: {
   *     operator: 'OR',
   *     value: [
   *       { field: 'custom_attributes.vip', operator: '=', value: true },
   *       { field: 'custom_attributes.spend', operator: '>', value: 10000 },
   *     ],
   *   },
   *   sort: { field: 'created_at', order: 'descending' },
   *   pagination: { per_page: 25 },
   * })
   * ```
   *
   * @example Complex nested query
   * ```typescript
   * const results = await client.contacts.search({
   *   query: {
   *     operator: 'AND',
   *     value: [
   *       { field: 'role', operator: '=', value: 'user' },
   *       {
   *         operator: 'OR',
   *         value: [
   *           { field: 'custom_attributes.plan', operator: '=', value: 'enterprise' },
   *           { field: 'custom_attributes.trial_ended', operator: '=', value: true },
   *         ],
   *       },
   *     ],
   *   },
   * })
   * ```
   */
  async search(params: ContactSearchParams, options?: RequestOptions): Promise<SearchResponse<Contact>> {
    return this.client._request('POST', '/contacts/search', params as Record<string, unknown>, options)
  }

  // ===========================================================================
  // Merge
  // ===========================================================================

  /**
   * Merge two contacts
   *
   * Merges the contact specified in `from` into the contact specified in `into`.
   * The `from` contact will be deleted after the merge.
   *
   * Data from both contacts is combined:
   * - Custom attributes from `from` are merged (with `into` taking precedence)
   * - Tags are combined
   * - Notes are combined
   * - Company associations are combined
   * - Conversations are moved to the merged contact
   *
   * @param params - Merge parameters
   * @param options - Request options
   * @returns The merged contact
   *
   * @example
   * ```typescript
   * // Merge contact B into contact A
   * const merged = await client.contacts.merge({
   *   from: 'contact_b_id',  // This contact will be deleted
   *   into: 'contact_a_id',  // This contact will remain
   * })
   *
   * // The merged contact has combined data
   * console.log(merged.id)  // contact_a_id
   * console.log(merged.tags.data)  // Tags from both contacts
   * ```
   */
  async merge(params: ContactMergeParams, options?: RequestOptions): Promise<Contact> {
    return this.client._request('POST', '/contacts/merge', params as Record<string, unknown>, options)
  }

  // ===========================================================================
  // Convert Lead to User
  // ===========================================================================

  /**
   * Convert a lead to a user
   *
   * Converts a lead contact to a user contact. Optionally merges with an
   * existing user.
   *
   * @param leadId - The lead contact ID to convert
   * @param params - Conversion parameters
   * @param options - Request options
   * @returns The converted user contact
   *
   * @example Convert without merging
   * ```typescript
   * const user = await client.contacts.convertToUser('lead_123', {})
   * console.log(user.role)  // 'user'
   * ```
   *
   * @example Convert and merge with existing user
   * ```typescript
   * const user = await client.contacts.convertToUser('lead_123', {
   *   user: { id: 'existing_user_id' },
   * })
   * ```
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
