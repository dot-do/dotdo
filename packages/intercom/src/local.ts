/**
 * @dotdo/intercom - Local/In-Memory Implementation
 *
 * In-memory implementation of Intercom API for testing and local development.
 * Provides the same API surface as the real Intercom client but stores all
 * data in memory.
 *
 * Features:
 * - Full contacts CRUD with search
 * - Conversations with reply history
 * - Events tracking with summaries
 * - Articles with full-text search
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
  contactId: string
  state: 'open' | 'closed' | 'snoozed'
  adminAssigneeId: string | null
  teamAssigneeId: string | null
  snoozedUntil: number | null
  priority: 'priority' | 'not_priority'
  customAttributes: CustomAttributes
  createdAt: number
  updatedAt: number
  parts: ConversationPart[]
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

function simpleTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
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
// Local Conversations Resource
// =============================================================================

class LocalConversationsResource {
  private conversations: Map<string, StoredConversation> = new Map()
  private workspaceId: string
  private contacts: LocalContactsResource

  constructor(
    workspaceId: string,
    contacts: LocalContactsResource
  ) {
    this.workspaceId = workspaceId
    this.contacts = contacts
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

    // Create the initial message part
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

    const stored: StoredConversation = {
      id,
      contactId,
      state: 'open',
      adminAssigneeId: null,
      teamAssigneeId: null,
      snoozedUntil: null,
      priority: 'not_priority',
      customAttributes: {},
      createdAt: now,
      updatedAt: now,
      parts: [part],
    }

    this.conversations.set(id, stored)

    return this.buildConversation(stored)
  }

  async find(id: string): Promise<Conversation> {
    const stored = this.conversations.get(id)
    if (!stored) {
      throw new Error(`Conversation not found: ${id}`)
    }

    return this.buildConversation(stored)
  }

  async list(params?: ConversationListParams): Promise<ConversationListResponse> {
    const perPage = params?.per_page ?? 20
    const conversations = Array.from(this.conversations.values())

    const result: Conversation[] = conversations
      .slice(0, perPage)
      .map((stored) => this.buildConversation(stored))

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
        id: params.admin_id ?? params.intercom_user_id ?? stored.contactId,
      },
    }

    stored.parts.push(part)
    stored.updatedAt = now
    this.conversations.set(params.id, stored)

    return this.buildConversation(stored)
  }

  async assign(params: ConversationAssignParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)

    if (params.type === 'admin') {
      stored.adminAssigneeId = params.assignee_id
    } else {
      stored.teamAssigneeId = params.assignee_id
    }
    stored.updatedAt = now

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
      assigned_to: { type: params.type as 'admin' | 'team', id: params.assignee_id },
    }

    stored.parts.push(part)
    this.conversations.set(params.id, stored)

    return this.buildConversation(stored)
  }

  async close(params: ConversationCloseParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    stored.state = 'closed'
    stored.updatedAt = now

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

    stored.parts.push(part)
    this.conversations.set(params.id, stored)

    return this.buildConversation(stored)
  }

  async open(params: ConversationOpenParams): Promise<Conversation> {
    const stored = this.conversations.get(params.id)
    if (!stored) {
      throw new Error(`Conversation not found: ${params.id}`)
    }

    const now = Math.floor(Date.now() / 1000)
    stored.state = 'open'
    stored.snoozedUntil = null
    stored.updatedAt = now

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

    stored.parts.push(part)
    this.conversations.set(params.id, stored)

    return this.buildConversation(stored)
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

    stored.parts.push(part)
    this.conversations.set(params.id, stored)

    return this.buildConversation(stored)
  }

  async search(params: ConversationSearchParams): Promise<ConversationListResponse> {
    const conversations = Array.from(this.conversations.values())
    const perPage = params.pagination?.per_page ?? 20

    const result: Conversation[] = conversations
      .slice(0, perPage)
      .map((stored) => this.buildConversation(stored))

    return {
      type: 'conversation.list',
      conversations: result,
      total_count: conversations.length,
      pages: createPages(1, perPage, conversations.length),
    }
  }

  private buildConversation(stored: StoredConversation): Conversation {
    const firstPart = stored.parts[0]
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
      waiting_since: null,
      snoozed_until: stored.snoozedUntil,
      source: {
        type: 'conversation',
        id: firstPart?.id ?? stored.id,
        delivered_as: 'customer_initiated',
        body: firstPart?.body ?? '',
        author: firstPart?.author ?? { type: 'user', id: stored.contactId },
      },
      contacts: {
        type: 'contact.list',
        contacts: [{ type: 'contact', id: stored.contactId }],
      },
      teammates: {
        type: 'admin.list',
        admins: stored.adminAssigneeId ? [{ type: 'admin', id: stored.adminAssigneeId }] : [],
      },
      conversation_parts: {
        type: 'conversation_part.list',
        conversation_parts: stored.parts,
        total_count: stored.parts.length,
      },
      tags: { type: 'tag.list', tags: [] },
      first_contact_reply: null,
      priority: stored.priority,
      sla_applied: null,
      statistics: null,
      conversation_rating: null,
      custom_attributes: stored.customAttributes,
    }
  }
}

// =============================================================================
// Local Messages Resource
// =============================================================================

class LocalMessagesResource {
  private onDelivery?: (messages: Message[]) => Promise<void>

  constructor(onDelivery?: (messages: Message[]) => Promise<void>) {
    this.onDelivery = onDelivery
  }

  async create(params: MessageCreateParams): Promise<Message> {
    const messageId = generateId('msg')
    const now = Math.floor(Date.now() / 1000)

    const message: Message = {
      type: params.from.type === 'admin' ? 'admin_message' : 'user_message',
      id: messageId,
      created_at: now,
      body: params.body,
      message_type: params.message_type,
      subject: params.subject ?? null,
    }

    // Emit for delivery
    if (this.onDelivery) {
      await this.onDelivery([message])
    }

    return message
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
// Local Articles Resource
// =============================================================================

class LocalArticlesResource {
  private articles: Map<string, StoredArticle> = new Map()
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

    return updated
  }

  async delete(id: string): Promise<DeletedArticle> {
    const article = this.articles.get(id)
    if (!article) {
      throw new Error(`Article not found: ${id}`)
    }

    this.articles.delete(id)

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
    const articles = Array.from(this.articles.values())

    // Tokenize search phrase
    const tokens = simpleTokenize(params.phrase)
    if (tokens.length === 0) {
      return {
        type: 'article.list',
        articles: {
          type: 'list',
          data: articles,
          total_count: articles.length,
        },
        pages: createPages(1, 20, articles.length),
      }
    }

    // Find articles containing all tokens
    const matchingArticles = articles.filter((article) => {
      const text = `${article.title} ${article.description ?? ''} ${this.stripHtml(article.body)}`
      const articleTokens = new Set(simpleTokenize(text))
      return tokens.every(token => articleTokens.has(token))
    })

    // Filter by state if specified
    const filtered = params.state
      ? matchingArticles.filter(a => a.state === params.state)
      : matchingArticles

    return {
      type: 'article.list',
      articles: {
        type: 'list',
        data: filtered,
        total_count: filtered.length,
      },
      pages: createPages(1, 20, filtered.length),
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ')
  }
}

// =============================================================================
// IntercomLocal Client
// =============================================================================

/**
 * Local Intercom implementation backed by in-memory storage
 *
 * This provides a fully functional Intercom-compatible API without requiring
 * a connection to Intercom's servers. Data is stored locally in memory.
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
  /** Conversations resource for managing conversations */
  readonly conversations: LocalConversationsResource
  /** Messages resource for sending messages */
  readonly messages: LocalMessagesResource
  /** Events resource for tracking custom events */
  readonly events: LocalEventsResource
  /** Articles resource for managing help center articles */
  readonly articles: LocalArticlesResource

  constructor(config: IntercomLocalConfig) {
    this.contacts = new LocalContactsResource(config.workspaceId)
    this.conversations = new LocalConversationsResource(
      config.workspaceId,
      this.contacts
    )
    this.messages = new LocalMessagesResource(config.onMessageDelivery)
    this.events = new LocalEventsResource()
    this.articles = new LocalArticlesResource(config.workspaceId)
  }
}
