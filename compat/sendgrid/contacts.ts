/**
 * @dotdo/sendgrid - Contact Management
 *
 * SendGrid-compatible contact and list management with local storage.
 * Provides CRUD operations for marketing contacts and lists.
 *
 * @example
 * ```typescript
 * import { ContactManager } from '@dotdo/sendgrid/contacts'
 *
 * const manager = new ContactManager({ storage: kv })
 *
 * // Add contacts
 * await manager.addContacts([
 *   { email: 'user1@example.com', first_name: 'John' },
 *   { email: 'user2@example.com', first_name: 'Jane' },
 * ])
 *
 * // Create list
 * const list = await manager.createList({ name: 'Newsletter' })
 *
 * // Add contacts to list
 * await manager.addContactsToList(list.id, ['contact-1', 'contact-2'])
 *
 * // Search contacts
 * const results = await manager.searchContacts({ query: "first_name = 'John'" })
 * ```
 */

/// <reference types="@cloudflare/workers-types" />

// =============================================================================
// Types
// =============================================================================

export interface Contact {
  id: string
  email: string
  first_name?: string
  last_name?: string
  alternate_emails?: string[]
  address_line_1?: string
  address_line_2?: string
  city?: string
  state_province_region?: string
  postal_code?: string
  country?: string
  phone_number?: string
  whatsapp?: string
  line?: string
  facebook?: string
  unique_name?: string
  custom_fields?: Record<string, string | number>
  created_at: string
  updated_at: string
  list_ids: string[]
}

export interface ContactCreateParams {
  email: string
  first_name?: string
  last_name?: string
  alternate_emails?: string[]
  address_line_1?: string
  address_line_2?: string
  city?: string
  state_province_region?: string
  postal_code?: string
  country?: string
  phone_number?: string
  whatsapp?: string
  line?: string
  facebook?: string
  unique_name?: string
  custom_fields?: Record<string, string | number>
}

export interface ContactList {
  id: string
  name: string
  contact_count: number
  created_at: string
  updated_at: string
}

export interface ContactListCreateParams {
  name: string
}

export interface ContactListUpdateParams {
  name?: string
}

export interface ContactSearchParams {
  query: string
}

export interface ContactExportOptions {
  list_ids?: string[]
  segment_ids?: string[]
  file_type?: 'csv' | 'json'
  max_file_size?: number
}

export interface JobResult {
  job_id: string
  status?: 'pending' | 'completed' | 'failed'
  result_url?: string
}

export interface ContactManagerConfig {
  /** KVNamespace for contact storage */
  kv?: KVNamespace
  /** Custom storage adapter */
  storage?: ContactStorage
  /** Prefix for storage keys */
  prefix?: string
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface ContactStorage {
  getContact(id: string): Promise<Contact | null>
  setContact(contact: Contact): Promise<void>
  deleteContact(id: string): Promise<void>
  listContacts(options?: { limit?: number; cursor?: string }): Promise<{ contacts: Contact[]; cursor?: string }>
  searchContacts(query: string): Promise<Contact[]>

  getList(id: string): Promise<ContactList | null>
  setList(list: ContactList): Promise<void>
  deleteList(id: string): Promise<void>
  listLists(): Promise<ContactList[]>
}

// =============================================================================
// In-Memory Storage
// =============================================================================

export class InMemoryContactStorage implements ContactStorage {
  private contacts: Map<string, Contact> = new Map()
  private emailIndex: Map<string, string> = new Map() // email -> contact id
  private lists: Map<string, ContactList> = new Map()

  async getContact(id: string): Promise<Contact | null> {
    return this.contacts.get(id) || null
  }

  async setContact(contact: Contact): Promise<void> {
    // Update email index
    const existing = this.contacts.get(contact.id)
    if (existing && existing.email !== contact.email) {
      this.emailIndex.delete(existing.email)
    }
    this.emailIndex.set(contact.email, contact.id)
    this.contacts.set(contact.id, contact)
  }

  async deleteContact(id: string): Promise<void> {
    const contact = this.contacts.get(id)
    if (contact) {
      this.emailIndex.delete(contact.email)
      this.contacts.delete(id)
    }
  }

  async listContacts(options?: { limit?: number; cursor?: string }): Promise<{ contacts: Contact[]; cursor?: string }> {
    const contacts = Array.from(this.contacts.values())
    const limit = options?.limit || 100
    const startIdx = options?.cursor ? parseInt(options.cursor, 10) : 0

    const slice = contacts.slice(startIdx, startIdx + limit)
    const nextCursor = startIdx + limit < contacts.length ? String(startIdx + limit) : undefined

    return { contacts: slice, cursor: nextCursor }
  }

  async searchContacts(query: string): Promise<Contact[]> {
    // Simple query parsing: field = 'value' or field LIKE 'value%'
    const match = query.match(/(\w+)\s*(=|LIKE)\s*'([^']*)'/)
    if (!match) return []

    const [, field, operator, value] = match
    const contacts = Array.from(this.contacts.values())

    return contacts.filter((c) => {
      const fieldValue = (c as unknown as Record<string, unknown>)[field]
      if (fieldValue === undefined) return false

      const strValue = String(fieldValue).toLowerCase()
      const searchValue = value.toLowerCase().replace(/%/g, '')

      if (operator === '=') {
        return strValue === searchValue
      }
      // LIKE
      if (value.startsWith('%') && value.endsWith('%')) {
        return strValue.includes(searchValue)
      }
      if (value.endsWith('%')) {
        return strValue.startsWith(searchValue)
      }
      if (value.startsWith('%')) {
        return strValue.endsWith(searchValue)
      }
      return strValue === searchValue
    })
  }

  getContactByEmail(email: string): Contact | null {
    const id = this.emailIndex.get(email)
    return id ? this.contacts.get(id) || null : null
  }

  async getList(id: string): Promise<ContactList | null> {
    return this.lists.get(id) || null
  }

  async setList(list: ContactList): Promise<void> {
    this.lists.set(list.id, list)
  }

  async deleteList(id: string): Promise<void> {
    this.lists.delete(id)
  }

  async listLists(): Promise<ContactList[]> {
    return Array.from(this.lists.values())
  }

  clear(): void {
    this.contacts.clear()
    this.emailIndex.clear()
    this.lists.clear()
  }
}

// =============================================================================
// KV Storage
// =============================================================================

export class KVContactStorage implements ContactStorage {
  private kv: KVNamespace
  private prefix: string

  constructor(kv: KVNamespace, prefix = 'contacts:') {
    this.kv = kv
    this.prefix = prefix
  }

  async getContact(id: string): Promise<Contact | null> {
    const data = await this.kv.get(`${this.prefix}contact:${id}`, 'json')
    return data as Contact | null
  }

  async setContact(contact: Contact): Promise<void> {
    await Promise.all([
      this.kv.put(`${this.prefix}contact:${contact.id}`, JSON.stringify(contact)),
      this.kv.put(`${this.prefix}email:${contact.email}`, contact.id),
    ])
  }

  async deleteContact(id: string): Promise<void> {
    const contact = await this.getContact(id)
    if (contact) {
      await Promise.all([
        this.kv.delete(`${this.prefix}contact:${id}`),
        this.kv.delete(`${this.prefix}email:${contact.email}`),
      ])
    }
  }

  async listContacts(options?: { limit?: number; cursor?: string }): Promise<{ contacts: Contact[]; cursor?: string }> {
    const result = await this.kv.list({
      prefix: `${this.prefix}contact:`,
      limit: options?.limit || 100,
      cursor: options?.cursor,
    })

    const contacts = await Promise.all(
      result.keys.map(async (key) => {
        const contact = await this.kv.get(key.name, 'json')
        return contact as Contact
      })
    )

    return {
      contacts: contacts.filter((c): c is Contact => c !== null),
      cursor: result.list_complete ? undefined : result.keys[result.keys.length - 1]?.name,
    }
  }

  async searchContacts(query: string): Promise<Contact[]> {
    // KV doesn't support complex queries, so we fetch all and filter
    const { contacts } = await this.listContacts({ limit: 1000 })

    const match = query.match(/(\w+)\s*(=|LIKE)\s*'([^']*)'/)
    if (!match) return []

    const [, field, operator, value] = match

    return contacts.filter((c) => {
      const fieldValue = (c as unknown as Record<string, unknown>)[field]
      if (fieldValue === undefined) return false

      const strValue = String(fieldValue).toLowerCase()
      const searchValue = value.toLowerCase().replace(/%/g, '')

      if (operator === '=') {
        return strValue === searchValue
      }
      if (value.endsWith('%')) {
        return strValue.startsWith(searchValue)
      }
      if (value.startsWith('%')) {
        return strValue.endsWith(searchValue)
      }
      return strValue.includes(searchValue)
    })
  }

  async getContactByEmail(email: string): Promise<Contact | null> {
    const id = await this.kv.get(`${this.prefix}email:${email}`)
    return id ? this.getContact(id) : null
  }

  async getList(id: string): Promise<ContactList | null> {
    const data = await this.kv.get(`${this.prefix}list:${id}`, 'json')
    return data as ContactList | null
  }

  async setList(list: ContactList): Promise<void> {
    await this.kv.put(`${this.prefix}list:${list.id}`, JSON.stringify(list))
  }

  async deleteList(id: string): Promise<void> {
    await this.kv.delete(`${this.prefix}list:${id}`)
  }

  async listLists(): Promise<ContactList[]> {
    const result = await this.kv.list({ prefix: `${this.prefix}list:` })

    const lists = await Promise.all(
      result.keys.map(async (key) => {
        const list = await this.kv.get(key.name, 'json')
        return list as ContactList
      })
    )

    return lists.filter((l): l is ContactList => l !== null)
  }
}

// =============================================================================
// Contact Manager
// =============================================================================

export class ContactManager {
  private storage: ContactStorage & { getContactByEmail?: (email: string) => Promise<Contact | null> | Contact | null }
  private pendingJobs: Map<string, JobResult> = new Map()

  constructor(config: ContactManagerConfig = {}) {
    if (config.storage) {
      this.storage = config.storage
    } else if (config.kv) {
      this.storage = new KVContactStorage(config.kv, config.prefix)
    } else {
      this.storage = new InMemoryContactStorage()
    }
  }

  // ===========================================================================
  // Contact Operations
  // ===========================================================================

  /**
   * Add or update contacts
   */
  async addContacts(contacts: ContactCreateParams[], options?: { list_ids?: string[] }): Promise<JobResult> {
    const jobId = `job-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    for (const params of contacts) {
      // Check if contact exists by email
      const existing = await this.getContactByEmail(params.email)
      const id = existing?.id || `contact-${crypto.randomUUID()}`

      const contact: Contact = {
        id,
        email: params.email,
        first_name: params.first_name ?? existing?.first_name,
        last_name: params.last_name ?? existing?.last_name,
        alternate_emails: params.alternate_emails ?? existing?.alternate_emails,
        address_line_1: params.address_line_1 ?? existing?.address_line_1,
        address_line_2: params.address_line_2 ?? existing?.address_line_2,
        city: params.city ?? existing?.city,
        state_province_region: params.state_province_region ?? existing?.state_province_region,
        postal_code: params.postal_code ?? existing?.postal_code,
        country: params.country ?? existing?.country,
        phone_number: params.phone_number ?? existing?.phone_number,
        whatsapp: params.whatsapp ?? existing?.whatsapp,
        line: params.line ?? existing?.line,
        facebook: params.facebook ?? existing?.facebook,
        unique_name: params.unique_name ?? existing?.unique_name,
        custom_fields: { ...existing?.custom_fields, ...params.custom_fields },
        created_at: existing?.created_at || now,
        updated_at: now,
        list_ids: Array.from(new Set([...(existing?.list_ids || []), ...(options?.list_ids || [])])),
      }

      await this.storage.setContact(contact)

      // Update list contact counts
      if (options?.list_ids) {
        for (const listId of options.list_ids) {
          await this.updateListCount(listId)
        }
      }
    }

    this.pendingJobs.set(jobId, { job_id: jobId, status: 'completed' })
    return { job_id: jobId }
  }

  /**
   * Get contact by ID
   */
  async getContact(id: string): Promise<Contact | null> {
    return this.storage.getContact(id)
  }

  /**
   * Get contacts by email
   */
  async getContactsByEmail(emails: string[]): Promise<Record<string, { contact: Contact }>> {
    const result: Record<string, { contact: Contact }> = {}

    for (const email of emails) {
      const contact = await this.getContactByEmail(email)
      if (contact) {
        result[email] = { contact }
      }
    }

    return result
  }

  /**
   * Delete contacts
   */
  async deleteContacts(params: { ids?: string[]; delete_all_contacts?: boolean }): Promise<JobResult> {
    const jobId = `job-${crypto.randomUUID()}`

    if (params.delete_all_contacts) {
      // Delete all contacts
      const { contacts } = await this.storage.listContacts({ limit: 10000 })
      for (const contact of contacts) {
        await this.storage.deleteContact(contact.id)
      }
    } else if (params.ids) {
      for (const id of params.ids) {
        const contact = await this.storage.getContact(id)
        if (contact) {
          // Update list counts before deleting
          for (const listId of contact.list_ids) {
            await this.updateListCount(listId, -1)
          }
          await this.storage.deleteContact(id)
        }
      }
    }

    this.pendingJobs.set(jobId, { job_id: jobId, status: 'completed' })
    return { job_id: jobId }
  }

  /**
   * Search contacts
   */
  async searchContacts(params: ContactSearchParams): Promise<{ result: Contact[]; contact_count: number }> {
    const contacts = await this.storage.searchContacts(params.query)
    return {
      result: contacts,
      contact_count: contacts.length,
    }
  }

  /**
   * Get contact count
   */
  async getContactCount(): Promise<{ contact_count: number; billable_count: number }> {
    const { contacts } = await this.storage.listContacts({ limit: 10000 })
    return {
      contact_count: contacts.length,
      billable_count: contacts.length,
    }
  }

  /**
   * Export contacts
   */
  async exportContacts(options?: ContactExportOptions): Promise<JobResult> {
    const jobId = `export-${crypto.randomUUID()}`

    // In a real implementation, this would create a background job
    // For now, we simulate immediate completion
    this.pendingJobs.set(jobId, {
      job_id: jobId,
      status: 'completed',
      result_url: `https://api.sendgrid.com/v3/marketing/contacts/exports/${jobId}/file`,
    })

    return { job_id: jobId }
  }

  // ===========================================================================
  // List Operations
  // ===========================================================================

  /**
   * Create a new contact list
   */
  async createList(params: ContactListCreateParams): Promise<ContactList> {
    const id = `list-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    const list: ContactList = {
      id,
      name: params.name,
      contact_count: 0,
      created_at: now,
      updated_at: now,
    }

    await this.storage.setList(list)
    return list
  }

  /**
   * Get a list by ID
   */
  async getList(id: string): Promise<ContactList | null> {
    return this.storage.getList(id)
  }

  /**
   * Update a list
   */
  async updateList(id: string, params: ContactListUpdateParams): Promise<ContactList> {
    const list = await this.storage.getList(id)
    if (!list) {
      throw new Error(`List not found: ${id}`)
    }

    if (params.name !== undefined) {
      list.name = params.name
    }
    list.updated_at = new Date().toISOString()

    await this.storage.setList(list)
    return list
  }

  /**
   * Delete a list
   */
  async deleteList(id: string, deleteContacts = false): Promise<void> {
    const list = await this.storage.getList(id)
    if (!list) {
      throw new Error(`List not found: ${id}`)
    }

    // Remove list from all contacts
    const { contacts } = await this.storage.listContacts({ limit: 10000 })
    for (const contact of contacts) {
      if (contact.list_ids.includes(id)) {
        contact.list_ids = contact.list_ids.filter((lid) => lid !== id)
        if (deleteContacts && contact.list_ids.length === 0) {
          await this.storage.deleteContact(contact.id)
        } else {
          await this.storage.setContact(contact)
        }
      }
    }

    await this.storage.deleteList(id)
  }

  /**
   * List all lists
   */
  async listLists(): Promise<{ result: ContactList[] }> {
    const lists = await this.storage.listLists()
    return { result: lists }
  }

  /**
   * Add contacts to a list
   */
  async addContactsToList(listId: string, contactIds: string[]): Promise<JobResult> {
    const jobId = `job-${crypto.randomUUID()}`
    const list = await this.storage.getList(listId)
    if (!list) {
      throw new Error(`List not found: ${listId}`)
    }

    for (const contactId of contactIds) {
      const contact = await this.storage.getContact(contactId)
      if (contact && !contact.list_ids.includes(listId)) {
        contact.list_ids.push(listId)
        await this.storage.setContact(contact)
      }
    }

    await this.updateListCount(listId)

    this.pendingJobs.set(jobId, { job_id: jobId, status: 'completed' })
    return { job_id: jobId }
  }

  /**
   * Remove contacts from a list
   */
  async removeContactsFromList(listId: string, contactIds: string[]): Promise<JobResult> {
    const jobId = `job-${crypto.randomUUID()}`

    for (const contactId of contactIds) {
      const contact = await this.storage.getContact(contactId)
      if (contact) {
        contact.list_ids = contact.list_ids.filter((id) => id !== listId)
        await this.storage.setContact(contact)
      }
    }

    await this.updateListCount(listId)

    this.pendingJobs.set(jobId, { job_id: jobId, status: 'completed' })
    return { job_id: jobId }
  }

  /**
   * Get contacts in a list
   */
  async getContactsInList(listId: string): Promise<Contact[]> {
    const { contacts } = await this.storage.listContacts({ limit: 10000 })
    return contacts.filter((c) => c.list_ids.includes(listId))
  }

  // ===========================================================================
  // Job Operations
  // ===========================================================================

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobResult | null> {
    return this.pendingJobs.get(jobId) || null
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async getContactByEmail(email: string): Promise<Contact | null> {
    if ('getContactByEmail' in this.storage && typeof this.storage.getContactByEmail === 'function') {
      const result = this.storage.getContactByEmail(email)
      return result instanceof Promise ? await result : result
    }
    // Fallback to search
    const results = await this.storage.searchContacts(`email = '${email}'`)
    return results[0] || null
  }

  private async updateListCount(listId: string, delta?: number): Promise<void> {
    const list = await this.storage.getList(listId)
    if (!list) return

    if (delta !== undefined) {
      list.contact_count = Math.max(0, list.contact_count + delta)
    } else {
      // Recalculate count
      const contacts = await this.getContactsInList(listId)
      list.contact_count = contacts.length
    }

    list.updated_at = new Date().toISOString()
    await this.storage.setList(list)
  }
}

// =============================================================================
// Exports
// =============================================================================

export default ContactManager
