/**
 * @dotdo/intercom - Local/Edge Implementation
 *
 * Durable Object-backed implementation of Intercom API using dotdo primitives.
 * Provides local storage for contacts, conversations, and articles without
 * requiring a connection to Intercom's servers.
 *
 * Features:
 * - TemporalStore for conversation history with time-travel queries
 * - InvertedIndex for article full-text search
 * - ExactlyOnceContext for reliable message delivery
 *
 * @example
 * ```typescript
 * import { IntercomLocal } from '@dotdo/intercom'
 *
 * const client = new IntercomLocal({
 *   workspaceId: 'workspace_abc',
 * })
 *
 * // Create a contact (stored locally)
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Search articles with full-text search
 * const results = await client.articles.search({
 *   phrase: 'getting started',
 * })
 * ```
 *
 * @module @dotdo/intercom/local
 */

import {
  createTemporalStore,
  type TemporalStore,
  type TemporalStoreOptions,
} from '../../db/primitives/temporal-store'

import { createExactlyOnceContext, type ExactlyOnceContext } from '../../db/primitives/exactly-once-context'

import {
  InvertedIndexWriter,
  InvertedIndexReader,
  simpleTokenize,
} from '../../db/iceberg/inverted-index'

import { MessengerLocal } from './messenger'

import {
  InboxRouter,
  type InboxRouterConfig,
  type Inbox,
  type CreateInboxInput,
  type UpdateInboxInput,
  type TeamMember,
  type AssignmentRule,
  type CreateAssignmentRuleInput,
  type UpdateAssignmentRuleInput,
  type EnableRoundRobinInput,
  type RoundRobinStatus,
  type RoundRobinConfig,
  type SLAPolicy,
  type CreateSLAPolicyInput,
  type AdminWorkload,
  type TeamWorkload,
  type WorkloadBalanceResult,
  type LocalConversationContext,
  type PriorityLevel,
  type ConversationPriority,
  type SLAStatus,
  InboxNotFoundError,
  InboxError,
} from './inbox'

import type {
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactListParams,
  ContactSearchParams,
  ContactMergeParams,
  DeletedContact,
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
  ConversationPart,
  Message,
  MessageCreateParams,
  EventCreateParams,
  EventListParams,
  EventListResponse,
  EventSummaryParams,
  EventSummaryResponse,
  Event,
  EventSummaryItem,
  Article,
  ArticleCreateParams,
  ArticleUpdateParams,
  ArticleListParams,
  ArticleSearchParams,
  ArticleSearchResponse,
  DeletedArticle,
  ListResponse,
  SearchResponse,
  Pages,
  CustomAttributes,
} from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for IntercomLocal
 */
export interface IntercomLocalConfig {
  /** Workspace ID for this instance */
  workspaceId: string
  /** Optional temporal store options */
  temporalStoreOptions?: TemporalStoreOptions
  /** Callback for message delivery (webhooks, etc.) */
  onMessageDelivery?: (messages: Message[]) => Promise<void>
}

/**
 * Internal contact storage
 */
interface StoredContact extends Omit<Contact, 'tags' | 'notes' | 'companies' | 'social_profiles'> {
  tags: string[]
  notes: string[]
  companies: string[]
}

/**
 * Internal conversation storage
 */
interface StoredConversation {
  id: string
  contactIds: string[]
  state: 'open' | 'closed' | 'snoozed'
  adminAssigneeId: string | null
  teamAssigneeId: string | null
  snoozedUntil: number | null
  waitingSince: number | null
  priority: 'priority' | 'not_priority'
  customAttributes: CustomAttributes
  createdAt: number
  updatedAt: number
  statistics: {
    time_to_assignment: number | null
    time_to_admin_reply: number | null
    time_to_first_close: number | null
    time_to_last_close: number | null
    first_assignment_at: number | null
    first_admin_reply_at: number | null
    first_close_at: number | null
    last_admin_reply_at: number | null
    last_close_at: number | null
    count_reopens: number
    count_assignments: number
    count_conversation_parts: number
  }
  tags: string[]
}

/**
 * Internal article storage
 */
interface StoredArticle extends Article {}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function createPages(page: number, perPage: number, total: number): Pages {
  const totalPages = Math.ceil(total / perPage)
  return {
    type: 'pages',
    page,
    per_page: perPage,
    total_pages: totalPages,
    ...(page < totalPages ? { next: { page: page + 1 } } : {}),
  }
}

function storedToContact(stored: StoredContact, workspaceId: string): Contact {
  return {
    ...stored,
    workspace_id: workspaceId,
    tags: { type: 'list', data: stored.tags.map((id) => ({ type: 'tag', id })) },
    notes: { type: 'list', data: stored.notes.map((id) => ({ type: 'note', id })) },
    companies: { type: 'list', data: stored.companies.map((id) => ({ type: 'company', id })) },
    social_profiles: { type: 'list', data: [] },
  }
}

// =============================================================================
// Local Contacts Resource
// =============================================================================

class LocalContactsResource {
  private contacts: Map<string, StoredContact> = new Map()
  private emailIndex: Map<string, string> = new Map() // email -> id
  private externalIdIndex: Map<string, string> = new Map() // external_id -> id
  private workspaceId: string

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId
  }

  async create(params: ContactCreateParams): Promise<Contact> {
    const id = generateId('contact')
    const now = Math.floor(Date.now() / 1000)

    const contact: StoredContact = {
      type: 'contact',
      id,
      workspace_id: this.workspaceId,
      external_id: params.external_id ?? null,
      role: params.role,
      email: params.email ?? null,
      name: params.name ?? null,
      phone: params.phone ?? null,
      avatar: params.avatar ?? null,
      signed_up_at: params.signed_up_at ?? null,
      last_seen_at: params.last_seen_at ?? null,
      created_at: now,
      updated_at: now,
      custom_attributes: params.custom_attributes ?? {},
      tags: [],
      notes: [],
      companies: [],
      location: {},
      unsubscribed_from_emails: params.unsubscribed_from_emails ?? false,
      owner_id: params.owner_id ?? null,
    }

    this.contacts.set(id, contact)

    if (contact.email) {
      this.emailIndex.set(contact.email, id)
    }
    if (contact.external_id) {
      this.externalIdIndex.set(contact.external_id, id)
    }

    return storedToContact(contact, this.workspaceId)
  }

  async find(id: string): Promise<Contact> {
    const contact = this.contacts.get(id)
    if (!contact) {
      throw new Error(`Contact not found: ${id}`)
    }
    return storedToContact(contact, this.workspaceId)
  }

  async findByEmail(email: string): Promise<Contact | null> {
    const id = this.emailIndex.get(email)
    if (!id) return null
    return this.find(id)
  }

  async update(id: string, params: ContactUpdateParams): Promise<Contact> {
    const contact = this.contacts.get(id)
    if (!contact) {
      throw new Error(`Contact not found: ${id}`)
    }

    // Update email index
    if (params.email !== undefined && params.email !== contact.email) {
      if (contact.email) {
        this.emailIndex.delete(contact.email)
      }
      if (params.email) {
        this.emailIndex.set(params.email, id)
      }
    }

    // Update external_id index
    if (params.external_id !== undefined && params.external_id !== contact.external_id) {
      if (contact.external_id) {
        this.externalIdIndex.delete(contact.external_id)
      }
      if (params.external_id) {
        this.externalIdIndex.set(params.external_id, id)
      }
    }

    const updated: StoredContact = {
      ...contact,
      ...params,
      updated_at: Math.floor(Date.now() / 1000),
      custom_attributes: {
        ...contact.custom_attributes,
        ...(params.custom_attributes ?? {}),
      },
    }

    this.contacts.set(id, updated)
    return storedToContact(updated, this.workspaceId)
  }

  async delete(id: string): Promise<DeletedContact> {
    const contact = this.contacts.get(id)
    if (!contact) {
      throw new Error(`Contact not found: ${id}`)
    }

    if (contact.email) {
      this.emailIndex.delete(contact.email)
    }
    if (contact.external_id) {
      this.externalIdIndex.delete(contact.external_id)
    }
    this.contacts.delete(id)

    return { type: 'contact', id, deleted: true }
  }

  async list(params?: ContactListParams): Promise<ListResponse<Contact>> {
    const perPage = params?.per_page ?? 50
    const contacts = Array.from(this.contacts.values())

    // Find starting index
    let startIndex = 0
    if (params?.starting_after) {
      const idx = contacts.findIndex((c) => c.id === params.starting_after)
      if (idx !== -1) {
        startIndex = idx + 1
      }
    }

    const page = contacts.slice(startIndex, startIndex + perPage)

    return {
      type: 'list',
      data: page.map((c) => storedToContact(c, this.workspaceId)),
      total_count: contacts.length,
      pages: createPages(1, perPage, contacts.length),
    }
  }

  async search(params: ContactSearchParams): Promise<SearchResponse<Contact>> {
    const contacts = Array.from(this.contacts.values())
    const filtered = contacts.filter((contact) => this.matchesQuery(contact, params.query))
    const perPage = params.pagination?.per_page ?? 50

    return {
      type: 'list',
      data: filtered.slice(0, perPage).map((c) => storedToContact(c, this.workspaceId)),
      total_count: filtered.length,
      pages: createPages(1, perPage, filtered.length),
    }
  }

  private matchesQuery(contact: StoredContact, query: any): boolean {
    if ('operator' in query && (query.operator === 'AND' || query.operator === 'OR')) {
      const results = query.value.map((q: any) => this.matchesQuery(contact, q))
      return query.operator === 'AND' ? results.every(Boolean) : results.some(Boolean)
    }

    const { field, operator, value } = query
    const fieldValue = this.getFieldValue(contact, field)

    switch (operator) {
      case '=':
        return fieldValue === value
      case '!=':
        return fieldValue !== value
      case '>':
        return typeof fieldValue === 'number' && fieldValue > value
      case '<':
        return typeof fieldValue === 'number' && fieldValue < value
      case '~':
        return typeof fieldValue === 'string' && fieldValue.includes(String(value))
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(String(value))
      case 'starts_with':
        return typeof fieldValue === 'string' && fieldValue.startsWith(String(value))
      case 'IN':
        return Array.isArray(value) && value.includes(fieldValue)
      default:
        return false
    }
  }

  private getFieldValue(contact: StoredContact, field: string): unknown {
    if (field.startsWith('custom_attributes.')) {
      const key = field.slice('custom_attributes.'.length)
      return contact.custom_attributes[key]
    }
    return (contact as any)[field]
  }

  async merge(params: ContactMergeParams): Promise<Contact> {
    const fromContact = this.contacts.get(params.from)
    const intoContact = this.contacts.get(params.into)

    if (!fromContact) throw new Error(`Contact not found: ${params.from}`)
    if (!intoContact) throw new Error(`Contact not found: ${params.into}`)

    // Merge data
    const merged: StoredContact = {
      ...intoContact,
      custom_attributes: {
        ...fromContact.custom_attributes,
        ...intoContact.custom_attributes,
      },
      tags: [...new Set([...intoContact.tags, ...fromContact.tags])],
      notes: [...intoContact.notes, ...fromContact.notes],
      companies: [...new Set([...intoContact.companies, ...fromContact.companies])],
      updated_at: Math.floor(Date.now() / 1000),
    }

    this.contacts.set(params.into, merged)
    await this.delete(params.from)

    return storedToContact(merged, this.workspaceId)
  }
}

// =============================================================================
// Local Conversations Resource (with TemporalStore)
// =============================================================================

/**
 * Extended list params with filtering
 */
interface ExtendedConversationListParams extends ConversationListParams {
  state?: 'open' | 'closed' | 'snoozed'
  assigned_to?: string
  unassigned?: boolean
}

class LocalConversationsResource {
  private conversations: Map<string, StoredConversation> = new Map()
  private conversationStore: TemporalStore<ConversationPart>
  private workspaceId: string
  private contacts: LocalContactsResource
  private emailIndex: Map<string, string> = new Map() // email -> contactId
  private externalIdIndex: Map<string, string> = new Map() // external_id -> contactId

  constructor(
    workspaceId: string,
    contacts: LocalContactsResource,
    storeOptions?: TemporalStoreOptions
  ) {
    this.workspaceId = workspaceId
    this.contacts = contacts
    this.conversationStore = createTemporalStore<ConversationPart>(storeOptions)
  }

  private createInitialStatistics(): StoredConversation['statistics'] {
    return {
      time_to_assignment: null,
      time_to_admin_reply: null,
      time_to_first_close: null,
      time_to_last_close: null,
      first_assignment_at: null,
      first_admin_reply_at: null,
      first_close_at: null,
      last_admin_reply_at: null,
      last_close_at: null,
      count_reopens: 0,
      count_assignments: 0,
      count_conversation_parts: 1, // Initial message
    }
  }

  async create(params: ConversationCreateParams): Promise<Conversation> {
    const id = generateId('conv')
    const now = Math.floor(Date.now() / 1000)

    // Resolve contact ID
    let contactId = params.from.id
    if (!contactId && params.from.email) {
      const contact = await this.contacts.findByEmail(params.from.email)
      if (contact) {
        contactId = contact.id
      }
    }
    if (!contactId) {
      throw new Error('Contact not found')
    }

    const stored: StoredConversation = {
      id,
      contactIds: [contactId],
      state: 'open',
      adminAssigneeId: null,
      teamAssigneeId: null,
      snoozedUntil: null,
      waitingSince: null,
      priority: 'not_priority',
      customAttributes: {},
      createdAt: now,
      updatedAt: now,
      statistics: this.createInitialStatistics(),
      tags: [],
    }

    this.conversations.set(id, stored)

    // Store the initial message in TemporalStore
    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'comment',
      body: params.body,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: {
        type: params.from.type as 'user' | 'lead',
        id: contactId,
      },
    }

    await this.conversationStore.put(`${id}:${part.id}`, part, now)

    return this.buildConversation(stored, [part])
  }

  async find(id: string): Promise<Conversation> {
    const stored = this.conversations.get(id)
    if (!stored) {
      throw new Error(`Conversation not found: ${id}`)
    }

    const parts = await this.getConversationParts(id)
    return this.buildConversation(stored, parts)
  }

  async list(params?: ExtendedConversationListParams): Promise<ConversationListResponse> {
    const perPage = params?.per_page ?? 20
    let conversations = Array.from(this.conversations.values())

    // Apply filters
    if (params?.state) {
      conversations = conversations.filter((c) => c.state === params.state)
    }
    if (params?.assigned_to) {
      conversations = conversations.filter((c) => c.adminAssigneeId === params.assigned_to)
    }
    if (params?.unassigned) {
      conversations = conversations.filter((c) => c.adminAssigneeId === null && c.teamAssigneeId === null)
    }

    // Apply starting_after pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = conversations.findIndex((c) => c.id === params.starting_after)
      if (idx !== -1) {
        startIndex = idx + 1
      }
    }

    const page = conversations.slice(startIndex, startIndex + perPage)
    const result: Conversation[] = []
    for (const stored of page) {
      const parts = await this.getConversationParts(stored.id)
      result.push(this.buildConversation(stored, parts))
    }

    return {
      type: 'conversation.list',
      conversations: result,
      total_count: conversations.length,
      pages: createPages(1, perPage, conversations.length),
    }
  }

  async reply(params: ConversationReplyParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)

    // Resolve author ID for user replies
    let authorId = params.admin_id ?? params.intercom_user_id ?? stored.contactIds[0]
    if (params.type === 'user') {
      if (params.email) {
        const contact = await this.contacts.findByEmail(params.email)
        if (contact) authorId = contact.id
      } else if (params.user_id) {
        // Look up by external_id
        try {
          const contacts = await this.contacts.search({
            query: { field: 'external_id', operator: '=', value: params.user_id },
          })
          if (contacts.data.length > 0) {
            authorId = contacts.data[0].id
          }
        } catch {
          // Keep default authorId
        }
      }
    }

    // Build attachments from URLs or files
    let attachments: ConversationAttachment[] | undefined
    if (params.attachment_urls && params.attachment_urls.length > 0) {
      attachments = params.attachment_urls.map((url) => ({
        type: 'upload' as const,
        name: url.split('/').pop() || 'file',
        url,
        content_type: 'application/octet-stream',
        filesize: 0,
      }))
    } else if (params.attachment_files && params.attachment_files.length > 0) {
      attachments = params.attachment_files.map((f) => ({
        type: 'upload' as const,
        name: f.name,
        url: `data:${f.content_type};base64,${f.data}`,
        content_type: f.content_type,
        filesize: f.data.length,
      }))
    }

    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: params.message_type ?? 'comment',
      body: params.body,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: {
        type: params.type,
        id: authorId,
      },
      attachments,
    }

    // Store in TemporalStore
    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)

    // Update statistics
    stored.statistics.count_conversation_parts++

    // Handle waiting_since and auto-reopen
    if (params.type === 'user') {
      // User reply sets waiting_since
      stored.waitingSince = now
      // Auto-reopen closed conversations on user reply
      if (stored.state === 'closed') {
        stored.state = 'open'
        stored.statistics.count_reopens++
      }
    } else if (params.type === 'admin') {
      // Admin reply clears waiting_since
      stored.waitingSince = null
      // Track first admin reply time
      if (!stored.statistics.first_admin_reply_at) {
        stored.statistics.first_admin_reply_at = now
        stored.statistics.time_to_admin_reply = now - stored.createdAt
      }
      stored.statistics.last_admin_reply_at = now
    }

    // Update conversation
    stored.updatedAt = now
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  async assign(params: ConversationAssignParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)

    // Handle unassignment (assignee_id = '0')
    const isUnassign = params.assignee_id === '0'

    if (params.type === 'admin') {
      stored.adminAssigneeId = isUnassign ? null : params.assignee_id
    } else {
      stored.teamAssigneeId = isUnassign ? null : params.assignee_id
    }
    stored.updatedAt = now

    // Update statistics
    if (!isUnassign) {
      stored.statistics.count_assignments++
      if (!stored.statistics.first_assignment_at) {
        stored.statistics.first_assignment_at = now
        stored.statistics.time_to_assignment = now - stored.createdAt
      }
    }

    // Record assignment part
    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'assignment',
      body: params.body ?? null,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: { type: 'admin', id: params.admin_id },
      assigned_to: isUnassign ? null : { type: params.type as 'admin' | 'team', id: params.assignee_id },
    }

    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)
    stored.statistics.count_conversation_parts++
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  async close(params: ConversationCloseParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    stored.state = 'closed'
    stored.waitingSince = null
    stored.updatedAt = now

    // Track close statistics
    if (!stored.statistics.first_close_at) {
      stored.statistics.first_close_at = now
      stored.statistics.time_to_first_close = now - stored.createdAt
    }
    stored.statistics.last_close_at = now
    stored.statistics.time_to_last_close = now - stored.createdAt

    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'close',
      body: params.body ?? null,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: { type: 'admin', id: params.admin_id },
    }

    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)
    stored.statistics.count_conversation_parts++
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  async open(params: ConversationOpenParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    const wasNotOpen = stored.state !== 'open'
    stored.state = 'open'
    stored.snoozedUntil = null
    stored.updatedAt = now

    // Track reopens
    if (wasNotOpen) {
      stored.statistics.count_reopens++
    }

    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'open',
      body: null,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: { type: 'admin', id: params.admin_id },
    }

    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)
    stored.statistics.count_conversation_parts++
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  async snooze(params: ConversationSnoozeParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    stored.state = 'snoozed'
    stored.snoozedUntil = params.snoozed_until
    stored.updatedAt = now

    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'snoozed',
      body: null,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: { type: 'admin', id: params.admin_id },
    }

    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)
    stored.statistics.count_conversation_parts++
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  async search(params: ConversationSearchParams): Promise<ConversationListResponse> {
    let conversations = Array.from(this.conversations.values())
    const perPage = params.pagination?.per_page ?? 20

    // Filter by query
    const filtered: StoredConversation[] = []
    for (const stored of conversations) {
      if (this.matchesQuery(stored, params.query)) {
        filtered.push(stored)
      }
    }

    // Sort results
    if (params.sort) {
      filtered.sort((a, b) => {
        let aVal: number
        let bVal: number
        switch (params.sort!.field) {
          case 'created_at':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'updated_at':
            aVal = a.updatedAt
            bVal = b.updatedAt
            break
          default:
            aVal = a.createdAt
            bVal = b.createdAt
        }
        return params.sort!.order === 'ascending' ? aVal - bVal : bVal - aVal
      })
    }

    const result: Conversation[] = []
    for (const stored of filtered.slice(0, perPage)) {
      const parts = await this.getConversationParts(stored.id)
      result.push(this.buildConversation(stored, parts))
    }

    return {
      type: 'conversation.list',
      conversations: result,
      total_count: filtered.length,
      pages: createPages(1, perPage, filtered.length),
    }
  }

  private matchesQuery(stored: StoredConversation, query: any): boolean {
    if ('operator' in query && (query.operator === 'AND' || query.operator === 'OR')) {
      const results = query.value.map((q: any) => this.matchesQuery(stored, q))
      return query.operator === 'AND' ? results.every(Boolean) : results.some(Boolean)
    }

    const { field, operator, value } = query
    const fieldValue = this.getFieldValue(stored, field)

    switch (operator) {
      case '=':
        return fieldValue === value
      case '!=':
        return fieldValue !== value
      case '>':
        return typeof fieldValue === 'number' && fieldValue > value
      case '<':
        return typeof fieldValue === 'number' && fieldValue < value
      case '~':
      case 'contains':
        return typeof fieldValue === 'string' && fieldValue.includes(String(value))
      case 'IN':
        return Array.isArray(value) && value.includes(fieldValue)
      default:
        return false
    }
  }

  private getFieldValue(stored: StoredConversation, field: string): unknown {
    switch (field) {
      case 'state':
        return stored.state
      case 'admin_assignee_id':
        return stored.adminAssigneeId
      case 'team_assignee_id':
        return stored.teamAssigneeId
      case 'contact_ids':
        // Return first contact ID for simple equality check
        return stored.contactIds[0]
      case 'created_at':
        return stored.createdAt
      case 'updated_at':
        return stored.updatedAt
      case 'priority':
        return stored.priority
      default:
        if (field.startsWith('custom_attributes.')) {
          const key = field.slice('custom_attributes.'.length)
          return stored.customAttributes[key]
        }
        return undefined
    }
  }

  /**
   * Run assignment rules for a conversation
   */
  async runAssignmentRules(conversationId: string): Promise<Conversation> {
    const stored = this.conversations.get(conversationId)
    if (!stored) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }
    // In a real implementation, this would run through assignment rules
    // For now, just return the conversation
    const parts = await this.getConversationParts(conversationId)
    return this.buildConversation(stored, parts)
  }

  /**
   * Add a tag to a conversation
   */
  async addTag(params: { id: string; admin_id: string; tag_id: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }
    if (!stored.tags.includes(params.tag_id)) {
      stored.tags.push(params.tag_id)
    }
    stored.updatedAt = Math.floor(Date.now() / 1000)
    this.conversations.set(params.id, stored)
    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Remove a tag from a conversation
   */
  async removeTag(params: { id: string; admin_id: string; tag_id: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }
    stored.tags = stored.tags.filter((t) => t !== params.tag_id)
    stored.updatedAt = Math.floor(Date.now() / 1000)
    this.conversations.set(params.id, stored)
    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Add a note to a conversation
   */
  async addNote(params: { id: string; admin_id: string; body: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    const part: ConversationPart = {
      type: 'conversation_part',
      id: generateId('part'),
      part_type: 'note',
      body: params.body,
      created_at: now,
      updated_at: now,
      notified_at: now,
      author: { type: 'admin', id: params.admin_id },
    }

    await this.conversationStore.put(`${params.id}:${part.id}`, part, now)
    stored.statistics.count_conversation_parts++
    stored.updatedAt = now
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Redact a conversation part
   */
  async redact(params: { conversation_id: string; conversation_part_id?: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.conversation_id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.conversation_id}`)
    }
    // In a real implementation, we would mark the part as redacted
    const parts = await this.getConversationParts(params.conversation_id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Set conversation priority
   */
  async setPriority(params: { id: string; admin_id: string; priority: 'priority' | 'not_priority' }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }
    stored.priority = params.priority
    stored.updatedAt = Math.floor(Date.now() / 1000)
    this.conversations.set(params.id, stored)
    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Attach a contact to a conversation
   */
  async attachContact(params: { id: string; admin_id: string; contact_id?: string; email?: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    let contactId = params.contact_id
    if (!contactId && params.email) {
      const contact = await this.contacts.findByEmail(params.email)
      if (contact) contactId = contact.id
    }
    if (!contactId) {
      throw new Error('Contact not found')
    }

    if (!stored.contactIds.includes(contactId)) {
      stored.contactIds.push(contactId)
    }
    stored.updatedAt = Math.floor(Date.now() / 1000)
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Detach a contact from a conversation
   */
  async detachContact(params: { id: string; admin_id: string; contact_id: string }): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    // Cannot remove the last contact
    if (stored.contactIds.length <= 1) {
      throw new Error('Cannot remove the last contact from a conversation')
    }

    stored.contactIds = stored.contactIds.filter((id) => id !== params.contact_id)
    stored.updatedAt = Math.floor(Date.now() / 1000)
    this.conversations.set(params.id, stored)

    const parts = await this.getConversationParts(params.id)
    return this.buildConversation(stored, parts)
  }

  /**
   * Get conversation parts with pagination
   */
  async listParts(conversationId: string, params?: { per_page?: number; page?: number }): Promise<{
    parts: ConversationPart[]
    total_count: number
    pages: Pages
  }> {
    const stored = this.conversations.get(conversationId)
    if (!stored) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    const parts = await this.getConversationParts(conversationId)
    const perPage = params?.per_page ?? 20
    const page = params?.page ?? 1
    const startIndex = (page - 1) * perPage

    return {
      parts: parts.slice(startIndex, startIndex + perPage),
      total_count: parts.length,
      pages: createPages(page, perPage, parts.length),
    }
  }

  /**
   * Get conversation state as of a specific timestamp (time-travel query)
   */
  async getAsOf(conversationId: string, timestamp: number): Promise<Conversation | null> {
    const stored = this.conversations.get(conversationId)
    if (!stored) return null

    const parts: ConversationPart[] = []
    const iterator = this.conversationStore.range(`${conversationId}:`, { end: timestamp })

    let result = await iterator.next()
    while (!result.done) {
      parts.push(result.value)
      result = await iterator.next()
    }

    return this.buildConversation(stored, parts)
  }

  private async getConversationParts(conversationId: string): Promise<ConversationPart[]> {
    const parts: ConversationPart[] = []
    const iterator = this.conversationStore.range(`${conversationId}:`, {})

    let result = await iterator.next()
    while (!result.done) {
      parts.push(result.value)
      result = await iterator.next()
    }

    return parts.sort((a, b) => a.created_at - b.created_at)
  }

  private buildConversation(stored: StoredConversation, parts: ConversationPart[]): Conversation {
    const firstPart = parts[0]
    const primaryContactId = stored.contactIds[0]

    return {
      type: 'conversation',
      id: stored.id,
      created_at: stored.createdAt,
      updated_at: stored.updatedAt,
      title: null,
      admin_assignee_id: stored.adminAssigneeId,
      team_assignee_id: stored.teamAssigneeId,
      open: stored.state === 'open',
      state: stored.state,
      read: true,
      waiting_since: stored.waitingSince,
      snoozed_until: stored.snoozedUntil,
      source: {
        type: 'conversation',
        id: firstPart?.id ?? stored.id,
        delivered_as: 'customer_initiated',
        body: firstPart?.body ?? '',
        author: firstPart?.author ?? { type: 'user', id: primaryContactId },
      },
      contacts: {
        type: 'contact.list',
        contacts: stored.contactIds.map((id) => ({ type: 'contact' as const, id })),
      },
      teammates: {
        type: 'admin.list',
        admins: stored.adminAssigneeId ? [{ type: 'admin' as const, id: stored.adminAssigneeId }] : [],
      },
      conversation_parts: {
        type: 'conversation_part.list',
        conversation_parts: parts,
        total_count: parts.length,
      },
      tags: {
        type: 'tag.list',
        tags: stored.tags.map((id) => ({ type: 'tag' as const, id })),
      },
      first_contact_reply: null,
      priority: stored.priority,
      sla_applied: null,
      statistics: {
        type: 'conversation_statistics',
        time_to_assignment: stored.statistics.time_to_assignment,
        time_to_admin_reply: stored.statistics.time_to_admin_reply,
        time_to_first_close: stored.statistics.time_to_first_close,
        time_to_last_close: stored.statistics.time_to_last_close,
        first_assignment_at: stored.statistics.first_assignment_at,
        first_admin_reply_at: stored.statistics.first_admin_reply_at,
        first_close_at: stored.statistics.first_close_at,
        last_admin_reply_at: stored.statistics.last_admin_reply_at,
        last_close_at: stored.statistics.last_close_at,
        count_reopens: stored.statistics.count_reopens,
        count_assignments: stored.statistics.count_assignments,
        count_conversation_parts: stored.statistics.count_conversation_parts,
      },
      conversation_rating: null,
      custom_attributes: stored.customAttributes,
    }
  }
}

// =============================================================================
// Local Messages Resource (with ExactlyOnceContext)
// =============================================================================

class LocalMessagesResource {
  private exactlyOnce: ExactlyOnceContext
  private onDelivery?: (messages: Message[]) => Promise<void>

  constructor(onDelivery?: (messages: Message[]) => Promise<void>) {
    this.onDelivery = onDelivery
    this.exactlyOnce = createExactlyOnceContext({
      onDeliver: async (events) => {
        if (this.onDelivery) {
          await this.onDelivery(events as Message[])
        }
      },
    })
  }

  async create(params: MessageCreateParams): Promise<Message> {
    const messageId = generateId('msg')
    const now = Math.floor(Date.now() / 1000)

    // Use ExactlyOnceContext to ensure exactly-once delivery
    return this.exactlyOnce.processOnce(messageId, async () => {
      const message: Message = {
        type: params.from.type === 'admin' ? 'admin_message' : 'user_message',
        id: messageId,
        created_at: now,
        body: params.body,
        message_type: params.message_type,
        subject: params.subject ?? null,
      }

      // Emit for delivery
      this.exactlyOnce.emit(message)

      return message
    })
  }

  async flush(): Promise<void> {
    await this.exactlyOnce.flush()
  }
}

// =============================================================================
// Local Events Resource
// =============================================================================

class LocalEventsResource {
  private events: Map<string, Event[]> = new Map() // userId -> events

  async create(params: EventCreateParams): Promise<void> {
    const event: Event = {
      type: 'event',
      id: generateId('event'),
      event_name: params.event_name,
      created_at: params.created_at ?? Math.floor(Date.now() / 1000),
      user_id: params.user_id,
      email: params.email,
      metadata: params.metadata,
    }

    const userId = params.user_id ?? params.email ?? 'anonymous'
    const userEvents = this.events.get(userId) ?? []
    userEvents.push(event)
    this.events.set(userId, userEvents)
  }

  async list(params: EventListParams): Promise<EventListResponse> {
    const userId = params.user_id ?? params.intercom_user_id ?? params.email ?? 'anonymous'
    const userEvents = this.events.get(userId) ?? []

    return {
      type: 'event.list',
      events: userEvents.slice(0, params.per_page ?? 50),
      pages: { next: null },
    }
  }

  async summaries(params: EventSummaryParams): Promise<EventSummaryResponse> {
    const userId = params.user_id ?? params.intercom_user_id ?? params.email ?? 'anonymous'
    const userEvents = this.events.get(userId) ?? []

    // Aggregate by event name
    const counts = new Map<string, EventSummaryItem>()
    for (const event of userEvents) {
      const existing = counts.get(event.event_name)
      if (existing) {
        existing.count++
        if (!existing.first || event.created_at < existing.first) {
          existing.first = event.created_at
        }
        if (!existing.last || event.created_at > existing.last) {
          existing.last = event.created_at
        }
      } else {
        counts.set(event.event_name, {
          event_name: event.event_name,
          count: 1,
          first: event.created_at,
          last: event.created_at,
        })
      }
    }

    return {
      type: 'event.summary',
      events: Array.from(counts.values()),
    }
  }
}

// =============================================================================
// Local Articles Resource (with InvertedIndex)
// =============================================================================

class LocalArticlesResource {
  private articles: Map<string, StoredArticle> = new Map()
  private articleDocIds: Map<string, number> = new Map() // article.id -> doc ID for index
  private invertedIndex: InvertedIndexReader | null = null
  private indexWriter: InvertedIndexWriter = new InvertedIndexWriter()
  private nextDocId = 1
  private workspaceId: string

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId
  }

  async create(params: ArticleCreateParams): Promise<Article> {
    const id = generateId('article')
    const now = Math.floor(Date.now() / 1000)

    const article: StoredArticle = {
      type: 'article',
      id,
      workspace_id: this.workspaceId,
      title: params.title,
      description: params.description ?? null,
      body: params.body ?? '',
      author_id: params.author_id,
      state: params.state ?? 'draft',
      created_at: now,
      updated_at: now,
      url: null,
      parent_id: params.parent_id ?? null,
      parent_type: params.parent_type ?? null,
      default_locale: 'en',
      statistics: {
        type: 'article_statistics',
        views: 0,
        conversations: 0,
        reactions: 0,
        happy_reaction_percentage: 0,
        neutral_reaction_percentage: 0,
        sad_reaction_percentage: 0,
      },
    }

    this.articles.set(id, article)

    // Index for search
    const docId = this.nextDocId++
    this.articleDocIds.set(id, docId)
    this.indexArticle(article, docId)

    return article
  }

  async find(id: string): Promise<Article> {
    const article = this.articles.get(id)
    if (!article) {
      throw new Error(`Article not found: ${id}`)
    }
    return article
  }

  async update(id: string, params: ArticleUpdateParams): Promise<Article> {
    const article = this.articles.get(id)
    if (!article) {
      throw new Error(`Article not found: ${id}`)
    }

    const updated: StoredArticle = {
      ...article,
      ...params,
      updated_at: Math.floor(Date.now() / 1000),
    }

    this.articles.set(id, updated)

    // Re-index
    const docId = this.articleDocIds.get(id) ?? this.nextDocId++
    this.articleDocIds.set(id, docId)
    this.indexArticle(updated, docId)

    return updated
  }

  async delete(id: string): Promise<DeletedArticle> {
    const article = this.articles.get(id)
    if (!article) {
      throw new Error(`Article not found: ${id}`)
    }

    this.articles.delete(id)
    this.articleDocIds.delete(id)

    // Rebuild index without this article
    this.rebuildIndex()

    return { type: 'article', id, deleted: true }
  }

  async list(params?: ArticleListParams): Promise<ListResponse<Article>> {
    const perPage = params?.per_page ?? 50
    const articles = Array.from(this.articles.values())

    return {
      type: 'list',
      data: articles.slice(0, perPage),
      total_count: articles.length,
      pages: createPages(1, perPage, articles.length),
    }
  }

  async search(params: ArticleSearchParams): Promise<ArticleSearchResponse> {
    // Ensure index is built
    if (!this.invertedIndex) {
      this.rebuildIndex()
    }

    if (!this.invertedIndex || this.articles.size === 0) {
      return {
        type: 'article.list',
        articles: {
          type: 'list',
          data: [],
          total_count: 0,
        },
        pages: createPages(1, 20, 0),
      }
    }

    // Tokenize search phrase
    const tokens = simpleTokenize(params.phrase)
    if (tokens.length === 0) {
      return {
        type: 'article.list',
        articles: {
          type: 'list',
          data: Array.from(this.articles.values()),
          total_count: this.articles.size,
        },
        pages: createPages(1, 20, this.articles.size),
      }
    }

    // Find documents containing all tokens (AND query)
    const docIds = this.invertedIndex.intersect(tokens)

    // Map doc IDs back to articles
    const docIdToArticleId = new Map<number, string>()
    for (const [articleId, docId] of this.articleDocIds) {
      docIdToArticleId.set(docId, articleId)
    }

    const matchingArticles: Article[] = []
    for (const docId of docIds) {
      const articleId = docIdToArticleId.get(docId)
      if (articleId) {
        const article = this.articles.get(articleId)
        if (article) {
          // Filter by state if specified
          if (!params.state || article.state === params.state) {
            matchingArticles.push(article)
          }
        }
      }
    }

    return {
      type: 'article.list',
      articles: {
        type: 'list',
        data: matchingArticles,
        total_count: matchingArticles.length,
      },
      pages: createPages(1, 20, matchingArticles.length),
    }
  }

  private indexArticle(article: StoredArticle, docId: number): void {
    // Tokenize title and body
    const text = `${article.title} ${article.description ?? ''} ${this.stripHtml(article.body)}`
    const tokens = simpleTokenize(text)

    for (const token of tokens) {
      this.indexWriter.addPosting(token, docId)
    }

    // Rebuild the reader
    this.rebuildIndex()
  }

  private rebuildIndex(): void {
    this.indexWriter = new InvertedIndexWriter()

    for (const [articleId, article] of this.articles) {
      const docId = this.articleDocIds.get(articleId)
      if (docId !== undefined) {
        const text = `${article.title} ${article.description ?? ''} ${this.stripHtml(article.body)}`
        const tokens = simpleTokenize(text)
        for (const token of tokens) {
          this.indexWriter.addPosting(token, docId)
        }
      }
    }

    if (this.indexWriter.termCount > 0) {
      const bytes = this.indexWriter.serialize()
      this.invertedIndex = InvertedIndexReader.deserialize(bytes)
    } else {
      this.invertedIndex = null
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ')
  }
}

// =============================================================================
// Local Inbox Resources (adapters for InboxRouter)
// =============================================================================

/**
 * Inbox object for test interface compatibility
 */
interface TestInbox {
  type: 'inbox'
  id: string
  name: string
  team_id: string | null
  is_default: boolean
  conversation_counts: {
    open: number
    pending: number
    closed: number
  }
  created_at: number
  updated_at: number
}

/**
 * Team inbox with members and settings
 */
interface TestTeamInbox extends TestInbox {
  members: TestTeamMember[]
  settings: TestTeamInboxSettings
}

/**
 * Team member for test interface
 */
interface TestTeamMember {
  admin_id: string
  name: string
  email: string
  availability: 'available' | 'away' | 'busy'
  max_open_conversations: number
  current_open_conversations: number
  paused_from_rotation: boolean
  joined_at: number
}

/**
 * Team inbox settings
 */
interface TestTeamInboxSettings {
  round_robin_enabled: boolean
  max_open_per_member: number
  auto_assignment_enabled: boolean
  assignment_rules: TestAssignmentRule[]
}

/**
 * Assignment rule for test interface
 */
interface TestAssignmentRule {
  id: string
  name: string
  priority: number
  enabled: boolean
  conditions: TestAssignmentCondition[]
  condition_operator: 'AND' | 'OR'
  assignee_type: 'admin' | 'team' | 'round_robin'
  assignee_id: string | null
  created_at: number
  updated_at: number
}

/**
 * Assignment condition for test interface
 */
interface TestAssignmentCondition {
  field: 'subject' | 'body' | 'email_domain' | 'tag' | 'company_size' | 'custom_attribute'
  operator: 'contains' | 'equals' | 'regex' | 'greater_than' | 'less_than' | 'starts_with'
  value: string | number
  custom_attribute_key?: string
}

/**
 * VIP condition for test interface
 */
interface TestVIPCondition {
  id: string
  type: 'email_domain' | 'company_size' | 'tag' | 'custom_attribute'
  value: string | number
  priority: PriorityLevel
}

/**
 * Escalation rule for test interface
 */
interface TestEscalationRule {
  id: string
  trigger: 'time_waiting' | 'sla_breach' | 'manual'
  threshold_minutes?: number
  escalate_to: 'team' | 'admin'
  escalate_to_id: string
  enabled: boolean
}

/**
 * Priority routing config for test interface
 */
interface TestPriorityRouting {
  vip_conditions: TestVIPCondition[]
  urgent_keywords: string[]
  escalation_rules: TestEscalationRule[]
  sla_based_priority: boolean
}

/**
 * Admin workload for test interface
 */
interface TestAdminWorkload {
  admin_id: string
  name: string
  open_conversations: number
  pending_conversations: number
  closed_today: number
  average_response_time: number
  capacity_percentage: number
}

/**
 * Team workload for test interface
 */
interface TestTeamWorkload {
  team_id: string
  name: string
  total_open: number
  total_pending: number
  members: TestAdminWorkload[]
  bottleneck_admin_id: string | null
}

function inboxToTestInbox(inbox: Inbox): TestInbox {
  return {
    type: 'inbox',
    id: inbox.id,
    name: inbox.name,
    team_id: inbox.team_id ?? null,
    is_default: inbox.is_default,
    conversation_counts: {
      open: 0,
      pending: 0,
      closed: 0,
    },
    created_at: Math.floor(inbox.created_at.getTime() / 1000),
    updated_at: Math.floor(inbox.updated_at.getTime() / 1000),
  }
}

function teamMemberToTestMember(member: TeamMember): TestTeamMember {
  return {
    admin_id: member.admin_id,
    name: member.admin_id, // Default name from ID
    email: `${member.admin_id}@example.com`,
    availability: member.is_paused ? 'away' : 'available',
    max_open_conversations: member.max_open_conversations ?? 50,
    current_open_conversations: member.current_open_conversations,
    paused_from_rotation: member.is_paused,
    joined_at: Math.floor(member.joined_at.getTime() / 1000),
  }
}

/**
 * Local Inbox Resource - wraps InboxRouter for test compatibility
 */
class LocalInboxResource {
  private router: InboxRouter
  private conversationInboxMap: Map<string, string> = new Map() // conversationId -> inboxId

  constructor(router: InboxRouter) {
    this.router = router
  }

  async create(params: { name: string; team_id?: string; is_default?: boolean }): Promise<TestInbox> {
    const inbox = await this.router.createInbox({
      name: params.name,
      teamId: params.team_id,
      isDefault: params.is_default,
    })
    return inboxToTestInbox(inbox)
  }

  async find(id: string): Promise<TestInbox> {
    const inbox = await this.router.getInbox(id)
    return inboxToTestInbox(inbox)
  }

  async update(id: string, params: { name?: string }): Promise<TestInbox> {
    const inbox = await this.router.updateInbox(id, { name: params.name })
    return inboxToTestInbox(inbox)
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const inbox = await this.router.getInbox(id)

    // Check if inbox has open conversations
    const hasOpenConversations = Array.from(this.conversationInboxMap.values()).some((inboxId) => inboxId === id)
    if (hasOpenConversations) {
      throw new InboxError('Cannot delete inbox with open conversations', 'has_open_conversations', 400)
    }

    // Check if default
    if (inbox.is_default) {
      throw new InboxError('Cannot delete default inbox', 'is_default_inbox', 400)
    }

    await this.router.deleteInbox(id)
    return { id, deleted: true }
  }

  async list(params?: { team_id?: string }): Promise<{ inboxes: TestInbox[]; total_count: number }> {
    const inboxes = await this.router.listInboxes({ teamId: params?.team_id })
    return {
      inboxes: inboxes.map(inboxToTestInbox),
      total_count: inboxes.length,
    }
  }

  async getConversationCounts(id: string): Promise<{ open: number; pending: number; closed: number }> {
    await this.router.getInbox(id) // Validate exists
    return { open: 0, pending: 0, closed: 0 }
  }

  assignConversation(conversationId: string, inboxId: string): void {
    this.conversationInboxMap.set(conversationId, inboxId)
  }

  unassignConversation(conversationId: string): void {
    this.conversationInboxMap.delete(conversationId)
  }
}

/**
 * Local Team Inbox Resource
 */
class LocalTeamInboxResource {
  private router: InboxRouter

  constructor(router: InboxRouter) {
    this.router = router
  }

  async create(params: { name: string; members?: string[] }): Promise<TestTeamInbox> {
    const teamId = generateId('team')
    const inbox = await this.router.createTeamInbox(teamId, {
      name: params.name,
      members: params.members ?? [],
    })

    const members = await this.router.listTeamMembers(inbox.id)
    const testMembers = members.map(teamMemberToTestMember)

    return {
      ...inboxToTestInbox(inbox),
      members: testMembers,
      settings: {
        round_robin_enabled: inbox.round_robin_enabled,
        max_open_per_member: inbox.round_robin_config?.max_open_conversations_per_member ?? 50,
        auto_assignment_enabled: true,
        assignment_rules: [],
      },
    }
  }

  async find(id: string): Promise<TestTeamInbox> {
    const inbox = await this.router.getInbox(id)
    const members = await this.router.listTeamMembers(id)
    const rules = await this.router.listAssignmentRules(id)

    return {
      ...inboxToTestInbox(inbox),
      members: members.map(teamMemberToTestMember),
      settings: {
        round_robin_enabled: inbox.round_robin_enabled,
        max_open_per_member: inbox.round_robin_config?.max_open_conversations_per_member ?? 50,
        auto_assignment_enabled: true,
        assignment_rules: rules.map((r) => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          enabled: r.is_active,
          conditions: [],
          condition_operator: r.condition_logic === 'and' ? 'AND' : 'OR',
          assignee_type: r.assign_to.type === 'round_robin' ? 'round_robin' : r.assign_to.type,
          assignee_id: r.assign_to.type === 'admin' ? r.assign_to.admin_id : r.assign_to.type === 'team' ? r.assign_to.team_id : null,
          created_at: Math.floor(r.created_at.getTime() / 1000),
          updated_at: Math.floor(r.updated_at.getTime() / 1000),
        })),
      },
    }
  }

  async addMember(inboxId: string, adminId: string): Promise<TestTeamMember> {
    const member = await this.router.addTeamMember(inboxId, adminId)
    return teamMemberToTestMember(member)
  }

  async removeMember(inboxId: string, adminId: string): Promise<{ removed: true }> {
    const members = await this.router.listTeamMembers(inboxId)
    if (members.length <= 1) {
      throw new InboxError('Cannot remove last member from team inbox', 'last_member', 400)
    }
    await this.router.removeTeamMember(inboxId, adminId)
    return { removed: true }
  }

  async listMembers(inboxId: string): Promise<{ members: TestTeamMember[] }> {
    const members = await this.router.listTeamMembers(inboxId)
    return { members: members.map(teamMemberToTestMember) }
  }

  async getStats(inboxId: string): Promise<{ open: number; pending: number; closed: number }> {
    const stats = await this.router.getTeamInboxStats(inboxId)
    return {
      open: stats.total_open,
      pending: stats.total_pending,
      closed: stats.total_closed_today,
    }
  }

  async getMemberWorkload(inboxId: string, adminId: string): Promise<TestAdminWorkload> {
    await this.router.getInbox(inboxId) // Validate inbox exists
    const workload = await this.router.getAdminWorkload(adminId)
    return {
      admin_id: adminId,
      name: adminId,
      open_conversations: workload.total_open,
      pending_conversations: workload.total_pending,
      closed_today: workload.new_today,
      average_response_time: workload.average_response_time,
      capacity_percentage: workload.is_at_capacity ? 100 : Math.floor((workload.total_open / (workload.max_open ?? 50)) * 100),
    }
  }

  async setMemberAvailability(inboxId: string, adminId: string, availability: 'available' | 'away' | 'busy'): Promise<TestTeamMember> {
    if (availability === 'away' || availability === 'busy') {
      await this.router.pauseRoundRobinMember(inboxId, adminId).catch(() => {})
    } else {
      await this.router.resumeRoundRobinMember(inboxId, adminId).catch(() => {})
    }
    const members = await this.router.listTeamMembers(inboxId)
    const member = members.find((m) => m.admin_id === adminId)
    if (!member) {
      throw new InboxError('Member not found', 'member_not_found', 404)
    }
    return {
      ...teamMemberToTestMember(member),
      availability,
    }
  }

  async transferConversation(conversationId: string, fromTeamId: string, toTeamId: string): Promise<void> {
    // This would involve reassigning the conversation - placeholder
  }

  async setCapacityLimit(inboxId: string, limit: number): Promise<TestTeamInboxSettings> {
    const inbox = await this.router.getInbox(inboxId)
    if (inbox.round_robin_config) {
      await this.router.setRoundRobinLimits(inboxId, { perMember: limit })
    }
    const teamInbox = await this.find(inboxId)
    return teamInbox.settings
  }
}

/**
 * Local Assignment Rules Resource
 */
class LocalAssignmentRulesResource {
  private router: InboxRouter

  constructor(router: InboxRouter) {
    this.router = router
  }

  async create(
    inboxId: string,
    params: {
      name: string
      priority?: number
      enabled?: boolean
      conditions: TestAssignmentCondition[]
      condition_operator?: 'AND' | 'OR'
      assignee_type: 'admin' | 'team' | 'round_robin'
      assignee_id: string | null
    }
  ): Promise<TestAssignmentRule> {
    // Map test conditions to router conditions
    const conditions = params.conditions.map((c) => ({
      field: this.mapConditionField(c.field, c.custom_attribute_key),
      operator: this.mapConditionOperator(c.operator),
      value: c.value,
    }))

    const assignTo =
      params.assignee_type === 'admin'
        ? { type: 'admin' as const, admin_id: params.assignee_id! }
        : params.assignee_type === 'team'
          ? { type: 'team' as const, team_id: params.assignee_id! }
          : { type: 'round_robin' as const, inbox_id: inboxId }

    const rule = await this.router.createAssignmentRule(inboxId, {
      name: params.name,
      conditions: conditions as any,
      assignTo,
      priority: params.priority,
      conditionLogic: params.condition_operator === 'OR' ? 'or' : 'and',
    })

    if (params.enabled === false) {
      await this.router.updateAssignmentRule(rule.id, { isActive: false })
    }

    return this.ruleToTestRule(rule, params.conditions, params.assignee_type, params.assignee_id)
  }

  async update(ruleId: string, params: Partial<TestAssignmentRule>): Promise<TestAssignmentRule> {
    const rule = await this.router.updateAssignmentRule(ruleId, {
      name: params.name,
      priority: params.priority,
      isActive: params.enabled,
      conditionLogic: params.condition_operator === 'OR' ? 'or' : 'and',
    })
    return this.ruleToTestRule(rule, params.conditions ?? [], params.assignee_type ?? 'admin', params.assignee_id ?? null)
  }

  async delete(ruleId: string): Promise<{ id: string; deleted: true }> {
    await this.router.deleteAssignmentRule(ruleId)
    return { id: ruleId, deleted: true }
  }

  async list(inboxId: string): Promise<{ rules: TestAssignmentRule[] }> {
    const rules = await this.router.listAssignmentRules(inboxId)
    return {
      rules: rules.map((r) => this.ruleToTestRule(r, [], r.assign_to.type === 'round_robin' ? 'round_robin' : r.assign_to.type, null)),
    }
  }

  async test(ruleId: string, conversationId: string): Promise<{ matches: boolean; matched_conditions: string[] }> {
    // Would need conversation context - placeholder
    return { matches: false, matched_conditions: [] }
  }

  async updatePriority(ruleId: string, priority: number): Promise<TestAssignmentRule> {
    const rule = await this.router.updateAssignmentRule(ruleId, { priority })
    return this.ruleToTestRule(rule, [], 'admin', null)
  }

  async setDefault(inboxId: string, assigneeType: 'admin' | 'team', assigneeId: string): Promise<void> {
    // Create a catch-all rule with lowest priority
  }

  private mapConditionField(field: string, customKey?: string): string {
    switch (field) {
      case 'subject':
        return 'message.subject'
      case 'body':
        return 'message.body'
      case 'email_domain':
        return 'contact.email'
      case 'tag':
        return 'conversation.tags'
      case 'company_size':
        return 'contact.custom_attributes'
      case 'custom_attribute':
        return 'contact.custom_attributes'
      default:
        return field
    }
  }

  private mapConditionOperator(op: string): string {
    switch (op) {
      case 'contains':
        return 'contains'
      case 'equals':
        return 'equals'
      case 'regex':
        return 'matches_regex'
      case 'greater_than':
        return 'greater_than'
      case 'less_than':
        return 'less_than'
      case 'starts_with':
        return 'starts_with'
      default:
        return op
    }
  }

  private ruleToTestRule(
    rule: AssignmentRule,
    conditions: TestAssignmentCondition[],
    assigneeType: 'admin' | 'team' | 'round_robin',
    assigneeId: string | null
  ): TestAssignmentRule {
    return {
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      enabled: rule.is_active,
      conditions,
      condition_operator: rule.condition_logic === 'and' ? 'AND' : 'OR',
      assignee_type: assigneeType,
      assignee_id: assigneeId,
      created_at: Math.floor(rule.created_at.getTime() / 1000),
      updated_at: Math.floor(rule.updated_at.getTime() / 1000),
    }
  }
}

/**
 * Local Round Robin Resource
 */
class LocalRoundRobinResource {
  private router: InboxRouter

  constructor(router: InboxRouter) {
    this.router = router
  }

  async enable(inboxId: string): Promise<TestTeamInboxSettings> {
    const members = await this.router.listTeamMembers(inboxId)
    await this.router.enableRoundRobin(inboxId, {
      members: members.map((m) => m.admin_id),
    })
    const inbox = await this.router.getInbox(inboxId)
    return {
      round_robin_enabled: true,
      max_open_per_member: inbox.round_robin_config?.max_open_conversations_per_member ?? 50,
      auto_assignment_enabled: true,
      assignment_rules: [],
    }
  }

  async disable(inboxId: string): Promise<TestTeamInboxSettings> {
    await this.router.disableRoundRobin(inboxId)
    return {
      round_robin_enabled: false,
      max_open_per_member: 50,
      auto_assignment_enabled: true,
      assignment_rules: [],
    }
  }

  async setMaxOpenPerMember(inboxId: string, max: number): Promise<TestTeamInboxSettings> {
    await this.router.setRoundRobinLimits(inboxId, { perMember: max })
    const inbox = await this.router.getInbox(inboxId)
    return {
      round_robin_enabled: inbox.round_robin_enabled,
      max_open_per_member: max,
      auto_assignment_enabled: true,
      assignment_rules: [],
    }
  }

  async getStatus(inboxId: string): Promise<{ enabled: boolean; current_member_index: number; members: string[] }> {
    const status = await this.router.getRoundRobinStatus(inboxId)
    return {
      enabled: status.enabled,
      current_member_index: status.current_index,
      members: status.members.map((m) => m.admin_id),
    }
  }

  async pauseMember(inboxId: string, adminId: string): Promise<TestTeamMember> {
    await this.router.pauseRoundRobinMember(inboxId, adminId)
    const members = await this.router.listTeamMembers(inboxId)
    const member = members.find((m) => m.admin_id === adminId)
    return teamMemberToTestMember(member!)
  }

  async resumeMember(inboxId: string, adminId: string): Promise<TestTeamMember> {
    await this.router.resumeRoundRobinMember(inboxId, adminId)
    const members = await this.router.listTeamMembers(inboxId)
    const member = members.find((m) => m.admin_id === adminId)
    return teamMemberToTestMember(member!)
  }

  async getNextAssignee(inboxId: string): Promise<{ admin_id: string; reason: string }> {
    const status = await this.router.getRoundRobinStatus(inboxId)
    if (!status.enabled || !status.next_assignee) {
      throw new InboxError('No available assignee', 'no_assignee', 400)
    }
    return {
      admin_id: status.next_assignee,
      reason: 'round_robin',
    }
  }

  async validateDistribution(inboxId: string): Promise<{ even: boolean; max_diff: number; distribution: Record<string, number> }> {
    const status = await this.router.getRoundRobinStatus(inboxId)
    const distribution: Record<string, number> = {}
    let min = Infinity
    let max = 0
    for (const member of status.members) {
      distribution[member.admin_id] = member.current_open_conversations
      min = Math.min(min, member.current_open_conversations)
      max = Math.max(max, member.current_open_conversations)
    }
    return {
      even: max - min <= 1,
      max_diff: max - min,
      distribution,
    }
  }

  async resetOnMemberChange(inboxId: string): Promise<void> {
    // Reset the round-robin index when members change
    const inbox = await this.router.getInbox(inboxId)
    if (inbox.round_robin_config) {
      inbox.round_robin_config.current_index = 0
    }
  }
}

/**
 * Local Priority Routing Resource
 */
class LocalPriorityRoutingResource {
  private router: InboxRouter
  private vipConditions: Map<string, TestVIPCondition> = new Map()
  private escalationRules: Map<string, TestEscalationRule> = new Map()
  private urgentKeywords: string[] = []
  private slaBasedPriority = false

  constructor(router: InboxRouter) {
    this.router = router
  }

  async setVIPCondition(condition: Omit<TestVIPCondition, 'id'>): Promise<TestVIPCondition> {
    const id = generateId('vip')
    const vipCondition: TestVIPCondition = { ...condition, id }
    this.vipConditions.set(id, vipCondition)

    // Update router priority rules
    await this.router.setPriorityRules({
      vip_conditions: Array.from(this.vipConditions.values()).map((c) => ({
        field: this.mapVIPField(c.type),
        operator: 'equals' as const,
        value: c.value,
      })),
      urgent_keywords: this.urgentKeywords,
    })

    return vipCondition
  }

  async removeVIPCondition(conditionId: string): Promise<{ id: string; deleted: true }> {
    this.vipConditions.delete(conditionId)
    await this.router.setPriorityRules({
      vip_conditions: Array.from(this.vipConditions.values()).map((c) => ({
        field: this.mapVIPField(c.type),
        operator: 'equals' as const,
        value: c.value,
      })),
      urgent_keywords: this.urgentKeywords,
    })
    return { id: conditionId, deleted: true }
  }

  async setUrgentKeywords(keywords: string[]): Promise<{ keywords: string[] }> {
    this.urgentKeywords = keywords
    await this.router.setPriorityRules({
      vip_conditions: Array.from(this.vipConditions.values()).map((c) => ({
        field: this.mapVIPField(c.type),
        operator: 'equals' as const,
        value: c.value,
      })),
      urgent_keywords: keywords,
    })
    return { keywords }
  }

  async getPriorityForConversation(conversationId: string): Promise<{ priority: PriorityLevel; reasons: string[] }> {
    const priority = await this.router.getPriorityForConversation(conversationId)
    const reasons: string[] = []
    if (priority.is_vip) reasons.push('VIP customer')
    if (priority.is_urgent) reasons.push('Urgent keywords detected')
    return { priority: priority.priority, reasons }
  }

  async escalate(conversationId: string, reason: string): Promise<void> {
    await this.router.escalateConversation(conversationId, { reason })
  }

  async setEscalationRule(rule: Omit<TestEscalationRule, 'id'>): Promise<TestEscalationRule> {
    const id = generateId('esc_rule')
    const escRule: TestEscalationRule = { ...rule, id }
    this.escalationRules.set(id, escRule)
    return escRule
  }

  async removeEscalationRule(ruleId: string): Promise<{ id: string; deleted: true }> {
    this.escalationRules.delete(ruleId)
    return { id: ruleId, deleted: true }
  }

  async enableSLABasedPriority(enabled: boolean): Promise<TestPriorityRouting> {
    this.slaBasedPriority = enabled
    return {
      vip_conditions: Array.from(this.vipConditions.values()),
      urgent_keywords: this.urgentKeywords,
      escalation_rules: Array.from(this.escalationRules.values()),
      sla_based_priority: enabled,
    }
  }

  private mapVIPField(type: string): 'contact.email' | 'contact.company' | 'conversation.tags' | 'contact.custom_attributes' {
    switch (type) {
      case 'email_domain':
        return 'contact.email'
      case 'company_size':
        return 'contact.custom_attributes'
      case 'tag':
        return 'conversation.tags'
      case 'custom_attribute':
        return 'contact.custom_attributes'
      default:
        return 'contact.custom_attributes'
    }
  }
}

/**
 * Local Workload Resource
 */
class LocalWorkloadResource {
  private router: InboxRouter

  constructor(router: InboxRouter) {
    this.router = router
  }

  async getAdminWorkload(adminId: string): Promise<TestAdminWorkload> {
    const workload = await this.router.getAdminWorkload(adminId)
    return {
      admin_id: adminId,
      name: adminId,
      open_conversations: workload.total_open,
      pending_conversations: workload.total_pending,
      closed_today: workload.new_today,
      average_response_time: workload.average_response_time,
      capacity_percentage: workload.is_at_capacity ? 100 : Math.floor((workload.total_open / (workload.max_open ?? 50)) * 100),
    }
  }

  async getTeamWorkload(teamId: string): Promise<TestTeamWorkload> {
    const workload = await this.router.getTeamWorkload(teamId)
    const members = workload.member_workloads.map((w) => ({
      admin_id: w.admin_id,
      name: w.admin_id,
      open_conversations: w.total_open,
      pending_conversations: w.total_pending,
      closed_today: w.new_today,
      average_response_time: w.average_response_time,
      capacity_percentage: w.is_at_capacity ? 100 : Math.floor((w.total_open / (w.max_open ?? 50)) * 100),
    }))

    const bottleneck = workload.overloaded_members[0] ?? null

    return {
      team_id: teamId,
      name: teamId,
      total_open: workload.total_open,
      total_pending: workload.total_pending,
      members,
      bottleneck_admin_id: bottleneck,
    }
  }

  async autoBalance(teamId: string): Promise<{ rebalanced: number; moves: Array<{ conversation_id: string; from: string; to: string }> }> {
    // Find inbox for this team
    const inboxes = await this.router.listInboxes({ teamId })
    if (inboxes.length === 0) {
      return { rebalanced: 0, moves: [] }
    }

    const result = await this.router.autoBalanceWorkload(inboxes[0].id)
    return {
      rebalanced: result.moves.length,
      moves: result.moves.map((m) => ({
        conversation_id: m.conversation_id,
        from: m.from_admin_id,
        to: m.to_admin_id,
      })),
    }
  }

  async setWorkloadLimit(adminId: string, limit: number): Promise<{ admin_id: string; limit: number }> {
    await this.router.setWorkloadLimits(adminId, { maxOpen: limit })
    return { admin_id: adminId, limit }
  }

  async *getRealtimeUpdates(teamId: string): AsyncIterable<TestTeamWorkload> {
    // Yield current workload - in a real implementation this would be a live stream
    yield await this.getTeamWorkload(teamId)
  }

  async getHistoricalData(
    teamId: string,
    startDate: number,
    endDate: number
  ): Promise<Array<{ timestamp: number; workload: TestTeamWorkload }>> {
    // Historical data placeholder
    const current = await this.getTeamWorkload(teamId)
    return [{ timestamp: Math.floor(Date.now() / 1000), workload: current }]
  }
}

// =============================================================================
// IntercomLocal Client
// =============================================================================

/**
 * Local Intercom implementation backed by dotdo primitives
 *
 * This provides a fully functional Intercom-compatible API without requiring
 * a connection to Intercom's servers. Data is stored locally using:
 *
 * - TemporalStore for conversation history (supports time-travel queries)
 * - InvertedIndex for article full-text search
 * - ExactlyOnceContext for reliable message delivery
 *
 * @example
 * ```typescript
 * import { IntercomLocal } from '@dotdo/intercom'
 *
 * const client = new IntercomLocal({
 *   workspaceId: 'my-workspace',
 *   onMessageDelivery: async (messages) => {
 *     // Handle message delivery (webhook, email, etc.)
 *   },
 * })
 *
 * // Use exactly like the regular client
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 * })
 * ```
 */
export class IntercomLocal {
  /** Contacts resource for managing users and leads */
  readonly contacts: LocalContactsResource
  /** Conversations resource with TemporalStore for history */
  readonly conversations: LocalConversationsResource
  /** Messages resource with ExactlyOnceContext for delivery */
  readonly messages: LocalMessagesResource
  /** Events resource for tracking custom events */
  readonly events: LocalEventsResource
  /** Articles resource with InvertedIndex for search */
  readonly articles: LocalArticlesResource
  /** Messenger resource for widget customization */
  readonly messenger: MessengerLocal
  /** Inbox resource for managing inboxes */
  readonly inboxes: LocalInboxResource
  /** Team inbox resource for team management */
  readonly teamInboxes: LocalTeamInboxResource
  /** Assignment rules resource for routing */
  readonly assignmentRules: LocalAssignmentRulesResource
  /** Round-robin resource for load balancing */
  readonly roundRobin: LocalRoundRobinResource
  /** Priority routing resource for VIP handling */
  readonly priorityRouting: LocalPriorityRoutingResource
  /** Workload resource for capacity management */
  readonly workload: LocalWorkloadResource

  /** Internal inbox router instance */
  private router: InboxRouter

  constructor(config: IntercomLocalConfig) {
    this.contacts = new LocalContactsResource(config.workspaceId)
    this.conversations = new LocalConversationsResource(
      config.workspaceId,
      this.contacts,
      config.temporalStoreOptions
    )
    this.messages = new LocalMessagesResource(config.onMessageDelivery)
    this.events = new LocalEventsResource()
    this.articles = new LocalArticlesResource(config.workspaceId)
    this.messenger = new MessengerLocal(config.workspaceId)

    // Initialize inbox router and related resources
    this.router = new InboxRouter({ workspaceId: config.workspaceId })
    this.inboxes = new LocalInboxResource(this.router)
    this.teamInboxes = new LocalTeamInboxResource(this.router)
    this.assignmentRules = new LocalAssignmentRulesResource(this.router)
    this.roundRobin = new LocalRoundRobinResource(this.router)
    this.priorityRouting = new LocalPriorityRoutingResource(this.router)
    this.workload = new LocalWorkloadResource(this.router)
  }
}
