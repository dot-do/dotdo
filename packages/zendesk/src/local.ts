/**
 * @dotdo/zendesk - Local/Edge Implementation
 *
 * Durable Object-backed implementation of Zendesk API using local state.
 * Provides local storage for tickets, users, organizations without
 * requiring a connection to Zendesk's servers.
 *
 * Features:
 * - Full ticket lifecycle management with comments
 * - User and organization management with relationships
 * - Custom field support
 * - Trigger and automation execution
 * - Search with filtering
 *
 * @example
 * ```typescript
 * import { ZendeskLocal } from '@dotdo/zendesk'
 *
 * const client = new ZendeskLocal({
 *   subdomain: 'mycompany',
 * })
 *
 * // Create a ticket (stored locally)
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need assistance',
 *   priority: 'high',
 * })
 *
 * // Search tickets
 * const results = await client.tickets.search('priority:high')
 * ```
 *
 * @module @dotdo/zendesk/local
 */

import type {
  Ticket,
  TicketCreateParams,
  TicketUpdateParams,
  TicketListParams,
  TicketListResponse,
  SearchResponse,
  User,
  UserCreateParams,
  UserUpdateParams,
  UserSearchParams,
  UserListParams,
  UserListResponse,
  Organization,
  OrganizationCreateParams,
  OrganizationUpdateParams,
  OrganizationListParams,
  OrganizationListResponse,
  Comment,
  CommentCreateParams,
  CommentListParams,
  CommentListResponse,
  Attachment,
  AttachmentUploadParams,
  UploadResponse,
  Trigger,
  TriggerCreateParams,
  TriggerUpdateParams,
  TriggerListParams,
  TriggerListResponse,
  Automation,
  AutomationCreateParams,
  AutomationUpdateParams,
  AutomationListParams,
  AutomationListResponse,
  TicketField,
  TicketFieldCreateParams,
  TicketFieldUpdateParams,
  TicketFieldListParams,
  TicketFieldListResponse,
  TicketForm,
  TicketFormCreateParams,
  TicketFormUpdateParams,
  TicketFormListResponse,
  View,
  ViewCreateParams,
  ViewUpdateParams,
  ViewListParams,
  ViewListResponse,
  ViewCountResponse,
  ViewTicketsResponse,
  Macro,
  MacroCreateParams,
  MacroUpdateParams,
  MacroListParams,
  MacroListResponse,
  MacroApplyResult,
  Group,
  GroupCreateParams,
  GroupUpdateParams,
  GroupListResponse,
  GroupMembership,
  GroupMembershipListResponse,
  Webhook,
  WebhookCreateParams,
  WebhookUpdateParams,
  WebhookListResponse,
  Target,
  TargetCreateParams,
  TargetUpdateParams,
  TargetListResponse,
  CustomField,
  Via,
} from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for ZendeskLocal
 */
export interface ZendeskLocalConfig {
  /** Subdomain for URL generation */
  subdomain: string
  /** Webhook callback for trigger actions */
  onWebhook?: (webhook: Webhook, payload: unknown) => Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

let nextId = 1000

function generateId(): number {
  return nextId++
}

function generateStringId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function createDefaultVia(): Via {
  return {
    channel: 'api',
    source: {
      from: {},
      to: {},
      rel: null,
    },
  }
}

// =============================================================================
// Local Tickets Resource
// =============================================================================

class LocalTicketsResource {
  private tickets: Map<number, Ticket> = new Map()
  private comments: Map<number, Comment[]> = new Map() // ticketId -> comments
  private subdomain: string
  private triggers: LocalTriggersResource
  private users: LocalUsersResource

  constructor(subdomain: string, triggers: LocalTriggersResource, users: LocalUsersResource) {
    this.subdomain = subdomain
    this.triggers = triggers
    this.users = users
  }

  async create(params: TicketCreateParams): Promise<Ticket> {
    const id = generateId()
    const now = new Date().toISOString()

    // Resolve or create requester
    let requesterId = params.requester_id
    if (!requesterId && params.requester?.email) {
      const existingUser = await this.users.findByEmail(params.requester.email)
      if (existingUser) {
        requesterId = existingUser.id
      } else {
        const newUser = await this.users.create({
          name: params.requester.name ?? 'Unknown',
          email: params.requester.email,
          role: 'end-user',
        })
        requesterId = newUser.id
      }
    }
    requesterId = requesterId ?? 1 // Default system user

    const ticket: Ticket = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/tickets/${id}.json`,
      external_id: params.external_id ?? null,
      type: params.type ?? null,
      subject: params.subject ?? '',
      raw_subject: params.subject ?? '',
      description: params.description ?? params.comment?.body ?? '',
      priority: params.priority ?? null,
      status: params.status ?? 'new',
      recipient: null,
      requester_id: requesterId,
      submitter_id: params.submitter_id ?? requesterId,
      assignee_id: params.assignee_id ?? null,
      organization_id: params.organization_id ?? null,
      group_id: params.group_id ?? null,
      collaborator_ids: params.collaborator_ids ?? [],
      follower_ids: params.follower_ids ?? [],
      email_cc_ids: [],
      forum_topic_id: null,
      problem_id: params.problem_id ?? null,
      has_incidents: false,
      is_public: true,
      due_at: params.due_at ?? null,
      tags: params.tags ?? [],
      custom_fields: params.custom_fields ?? [],
      satisfaction_rating: null,
      sharing_agreement_ids: [],
      fields: params.custom_fields ?? [],
      followup_ids: [],
      brand_id: params.brand_id ?? null,
      allow_channelback: false,
      allow_attachments: true,
      created_at: now,
      updated_at: now,
      via: createDefaultVia(),
    }

    this.tickets.set(id, ticket)

    // Create initial comment if provided
    if (params.comment?.body || params.description) {
      const comment: Comment = {
        id: generateId(),
        type: 'Comment',
        body: params.comment?.body ?? params.description ?? '',
        html_body: `<p>${params.comment?.body ?? params.description ?? ''}</p>`,
        plain_body: params.comment?.body ?? params.description ?? '',
        public: params.comment?.public ?? true,
        author_id: requesterId,
        attachments: [],
        audit_id: generateId(),
        via: createDefaultVia(),
        created_at: now,
      }
      this.comments.set(id, [comment])
    } else {
      this.comments.set(id, [])
    }

    // Execute triggers
    await this.executeTriggers(ticket, 'create')

    return ticket
  }

  async get(id: number): Promise<Ticket> {
    const ticket = this.tickets.get(id)
    if (!ticket) {
      throw new Error(`Ticket not found: ${id}`)
    }
    return ticket
  }

  async update(id: number, params: TicketUpdateParams): Promise<Ticket> {
    const ticket = this.tickets.get(id)
    if (!ticket) {
      throw new Error(`Ticket not found: ${id}`)
    }

    const now = new Date().toISOString()
    const oldStatus = ticket.status

    const updated: Ticket = {
      ...ticket,
      ...params,
      subject: params.subject ?? ticket.subject,
      status: params.status ?? ticket.status,
      priority: params.priority ?? ticket.priority,
      assignee_id: params.assignee_id !== undefined ? params.assignee_id : ticket.assignee_id,
      tags: params.tags ?? ticket.tags,
      custom_fields: params.custom_fields ?? ticket.custom_fields,
      updated_at: now,
    }

    // Handle tag additions/removals
    if (params.additional_tags) {
      updated.tags = [...new Set([...updated.tags, ...params.additional_tags])]
    }
    if (params.remove_tags) {
      updated.tags = updated.tags.filter((t) => !params.remove_tags!.includes(t))
    }

    this.tickets.set(id, updated)

    // Add comment if provided
    if (params.comment) {
      await this.addComment(id, params.comment)
    }

    // Execute triggers on status change
    if (oldStatus !== updated.status) {
      await this.executeTriggers(updated, 'update')
    }

    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.tickets.has(id)) {
      throw new Error(`Ticket not found: ${id}`)
    }
    this.tickets.delete(id)
    this.comments.delete(id)
  }

  async list(params?: TicketListParams): Promise<TicketListResponse> {
    let tickets = Array.from(this.tickets.values())

    // Filter by status
    if (params?.status) {
      tickets = tickets.filter((t) => t.status === params.status)
    }

    // Filter by external_id
    if (params?.external_id) {
      tickets = tickets.filter((t) => t.external_id === params.external_id)
    }

    // Sort
    const sortBy = params?.sort_by ?? 'created_at'
    const sortOrder = params?.sort_order ?? 'desc'
    tickets.sort((a, b) => {
      const aVal = (a as any)[sortBy]
      const bVal = (b as any)[sortBy]
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortOrder === 'desc' ? -cmp : cmp
    })

    // Paginate
    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedTickets = tickets.slice(start, start + perPage)

    return {
      tickets: paginatedTickets,
      count: tickets.length,
      next_page: start + perPage < tickets.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async search(query: string): Promise<SearchResponse<Ticket>> {
    let tickets = Array.from(this.tickets.values())

    // Parse simple query syntax
    const conditions = query.split(/\s+/)
    for (const condition of conditions) {
      if (condition.includes(':')) {
        const [field, value] = condition.split(':')
        switch (field) {
          case 'status':
            tickets = tickets.filter((t) => t.status === value)
            break
          case 'priority':
            tickets = tickets.filter((t) => t.priority === value)
            break
          case 'type':
            if (value !== 'ticket') {
              tickets = tickets.filter((t) => t.type === value)
            }
            break
          case 'assignee':
            tickets = tickets.filter((t) => t.assignee_id === parseInt(value, 10))
            break
          case 'requester':
            tickets = tickets.filter((t) => t.requester_id === parseInt(value, 10))
            break
          case 'tags':
            tickets = tickets.filter((t) => t.tags.includes(value))
            break
        }
      } else {
        // Full-text search in subject and description
        const searchTerm = condition.toLowerCase()
        tickets = tickets.filter(
          (t) =>
            t.subject.toLowerCase().includes(searchTerm) || t.description.toLowerCase().includes(searchTerm)
        )
      }
    }

    return {
      results: tickets,
      count: tickets.length,
      next_page: null,
      previous_page: null,
      facets: null,
    }
  }

  async addComment(ticketId: number, params: CommentCreateParams): Promise<Comment> {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`)
    }

    const now = new Date().toISOString()
    const comment: Comment = {
      id: generateId(),
      type: 'Comment',
      body: params.body,
      html_body: params.html_body ?? `<p>${params.body}</p>`,
      plain_body: params.body,
      public: params.public ?? true,
      author_id: params.author_id ?? ticket.requester_id,
      attachments: [],
      audit_id: generateId(),
      via: createDefaultVia(),
      created_at: now,
    }

    const ticketComments = this.comments.get(ticketId) ?? []
    ticketComments.push(comment)
    this.comments.set(ticketId, ticketComments)

    // Update ticket timestamp
    ticket.updated_at = now
    this.tickets.set(ticketId, ticket)

    return comment
  }

  async listComments(ticketId: number, params?: CommentListParams): Promise<CommentListResponse> {
    const comments = this.comments.get(ticketId) ?? []
    const sortedComments =
      params?.sort_order === 'desc' ? [...comments].reverse() : comments

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedComments = sortedComments.slice(start, start + perPage)

    return {
      comments: paginatedComments,
      count: comments.length,
      next_page: start + perPage < comments.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  private async executeTriggers(ticket: Ticket, event: 'create' | 'update'): Promise<void> {
    const triggers = await this.triggers.list({ active: true })
    for (const trigger of triggers.triggers) {
      if (this.triggerMatches(trigger, ticket)) {
        await this.executeTriggerActions(trigger, ticket)
      }
    }
  }

  private triggerMatches(trigger: Trigger, ticket: Ticket): boolean {
    const { all, any } = trigger.conditions

    // All conditions must match
    const allMatch = all.every((cond) => this.conditionMatches(cond, ticket))

    // At least one of any conditions must match (if any exist)
    const anyMatch = any.length === 0 || any.some((cond) => this.conditionMatches(cond, ticket))

    return allMatch && anyMatch
  }

  private conditionMatches(condition: { field: string; operator: string; value: unknown }, ticket: Ticket): boolean {
    const ticketValue = (ticket as any)[condition.field]
    const condValue = condition.value

    switch (condition.operator) {
      case 'is':
        return ticketValue === condValue
      case 'is_not':
        return ticketValue !== condValue
      case 'greater_than':
        return ticketValue > (condValue as number)
      case 'less_than':
        return ticketValue < (condValue as number)
      case 'includes':
        return Array.isArray(ticketValue) && ticketValue.includes(condValue)
      case 'not_includes':
        return !Array.isArray(ticketValue) || !ticketValue.includes(condValue)
      default:
        return false
    }
  }

  private async executeTriggerActions(trigger: Trigger, ticket: Ticket): Promise<void> {
    for (const action of trigger.actions) {
      switch (action.field) {
        case 'status':
          ticket.status = action.value as Ticket['status']
          break
        case 'priority':
          ticket.priority = action.value as Ticket['priority']
          break
        case 'assignee_id':
          ticket.assignee_id = action.value as number | null
          break
        case 'group_id':
          ticket.group_id = action.value as number | null
          break
        case 'add_tags':
          if (Array.isArray(action.value)) {
            ticket.tags = [...new Set([...ticket.tags, ...action.value])]
          }
          break
        case 'remove_tags':
          if (Array.isArray(action.value)) {
            ticket.tags = ticket.tags.filter((t) => !(action.value as string[]).includes(t))
          }
          break
        // Other actions could trigger webhooks, send emails, etc.
      }
    }
    ticket.updated_at = new Date().toISOString()
    this.tickets.set(ticket.id, ticket)
  }
}

// =============================================================================
// Local Users Resource
// =============================================================================

class LocalUsersResource {
  private users: Map<number, User> = new Map()
  private emailIndex: Map<string, number> = new Map()
  private externalIdIndex: Map<string, number> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: UserCreateParams): Promise<User> {
    const id = generateId()
    const now = new Date().toISOString()

    const user: User = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/users/${id}.json`,
      name: params.name,
      email: params.email,
      created_at: now,
      updated_at: now,
      time_zone: params.time_zone ?? 'America/New_York',
      iana_time_zone: params.time_zone ?? 'America/New_York',
      phone: params.phone ?? null,
      shared_phone_number: null,
      photo: null,
      locale_id: params.locale_id ?? 1,
      locale: params.locale ?? 'en-US',
      organization_id: params.organization_id ?? null,
      role: params.role ?? 'end-user',
      verified: params.verified ?? false,
      external_id: params.external_id ?? null,
      tags: params.tags ?? [],
      alias: params.alias ?? null,
      active: true,
      shared: false,
      shared_agent: false,
      last_login_at: null,
      two_factor_auth_enabled: null,
      signature: params.signature ?? null,
      details: params.details ?? null,
      notes: params.notes ?? null,
      role_type: null,
      custom_role_id: params.custom_role_id ?? null,
      moderator: params.moderator ?? false,
      ticket_restriction: params.ticket_restriction ?? 'requested',
      only_private_comments: params.only_private_comments ?? false,
      restricted_agent: params.restricted_agent ?? false,
      suspended: false,
      default_group_id: params.default_group_id ?? null,
      report_csv: false,
      user_fields: params.user_fields ?? {},
    }

    this.users.set(id, user)
    this.emailIndex.set(user.email.toLowerCase(), id)
    if (user.external_id) {
      this.externalIdIndex.set(user.external_id, id)
    }

    return user
  }

  async get(id: number): Promise<User> {
    const user = this.users.get(id)
    if (!user) {
      throw new Error(`User not found: ${id}`)
    }
    return user
  }

  async findByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase())
    if (!id) return null
    return this.users.get(id) ?? null
  }

  async update(id: number, params: UserUpdateParams): Promise<User> {
    const user = this.users.get(id)
    if (!user) {
      throw new Error(`User not found: ${id}`)
    }

    // Update email index
    if (params.email && params.email !== user.email) {
      this.emailIndex.delete(user.email.toLowerCase())
      this.emailIndex.set(params.email.toLowerCase(), id)
    }

    // Update external_id index
    if (params.external_id !== undefined && params.external_id !== user.external_id) {
      if (user.external_id) {
        this.externalIdIndex.delete(user.external_id)
      }
      if (params.external_id) {
        this.externalIdIndex.set(params.external_id, id)
      }
    }

    const updated: User = {
      ...user,
      ...params,
      updated_at: new Date().toISOString(),
      user_fields: { ...user.user_fields, ...(params.user_fields ?? {}) },
    }

    this.users.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    const user = this.users.get(id)
    if (!user) {
      throw new Error(`User not found: ${id}`)
    }

    this.emailIndex.delete(user.email.toLowerCase())
    if (user.external_id) {
      this.externalIdIndex.delete(user.external_id)
    }
    this.users.delete(id)
  }

  async list(params?: UserListParams): Promise<UserListResponse> {
    let users = Array.from(this.users.values())

    // Filter by role
    if (params?.role) {
      const roles = params.role.split(',') as User['role'][]
      users = users.filter((u) => roles.includes(u.role))
    }

    // Filter by external_id
    if (params?.external_id) {
      users = users.filter((u) => u.external_id === params.external_id)
    }

    // Paginate
    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedUsers = users.slice(start, start + perPage)

    return {
      users: paginatedUsers,
      count: users.length,
      next_page: start + perPage < users.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async search(params: UserSearchParams): Promise<UserListResponse> {
    let users = Array.from(this.users.values())

    if (params.query) {
      const query = params.query.toLowerCase()
      users = users.filter(
        (u) =>
          u.name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query)
      )
    }

    if (params.external_id) {
      users = users.filter((u) => u.external_id === params.external_id)
    }

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedUsers = users.slice(start, start + perPage)

    return {
      users: paginatedUsers,
      count: users.length,
      next_page: start + perPage < users.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async merge(targetId: number, sourceId: number): Promise<User> {
    const target = this.users.get(targetId)
    const source = this.users.get(sourceId)

    if (!target) throw new Error(`User not found: ${targetId}`)
    if (!source) throw new Error(`User not found: ${sourceId}`)

    // Merge user fields
    const merged: User = {
      ...target,
      user_fields: { ...source.user_fields, ...target.user_fields },
      tags: [...new Set([...target.tags, ...source.tags])],
      updated_at: new Date().toISOString(),
    }

    this.users.set(targetId, merged)
    await this.delete(sourceId)

    return merged
  }
}

// =============================================================================
// Local Organizations Resource
// =============================================================================

class LocalOrganizationsResource {
  private organizations: Map<number, Organization> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: OrganizationCreateParams): Promise<Organization> {
    const id = generateId()
    const now = new Date().toISOString()

    const org: Organization = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/organizations/${id}.json`,
      name: params.name,
      shared_tickets: params.shared_tickets ?? false,
      shared_comments: params.shared_comments ?? false,
      external_id: params.external_id ?? null,
      created_at: now,
      updated_at: now,
      domain_names: params.domain_names ?? [],
      details: params.details ?? null,
      notes: params.notes ?? null,
      group_id: params.group_id ?? null,
      tags: params.tags ?? [],
      organization_fields: params.organization_fields ?? {},
    }

    this.organizations.set(id, org)
    return org
  }

  async get(id: number): Promise<Organization> {
    const org = this.organizations.get(id)
    if (!org) {
      throw new Error(`Organization not found: ${id}`)
    }
    return org
  }

  async update(id: number, params: OrganizationUpdateParams): Promise<Organization> {
    const org = this.organizations.get(id)
    if (!org) {
      throw new Error(`Organization not found: ${id}`)
    }

    const updated: Organization = {
      ...org,
      ...params,
      updated_at: new Date().toISOString(),
      organization_fields: { ...org.organization_fields, ...(params.organization_fields ?? {}) },
    }

    this.organizations.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.organizations.has(id)) {
      throw new Error(`Organization not found: ${id}`)
    }
    this.organizations.delete(id)
  }

  async list(params?: OrganizationListParams): Promise<OrganizationListResponse> {
    const organizations = Array.from(this.organizations.values())

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedOrgs = organizations.slice(start, start + perPage)

    return {
      organizations: paginatedOrgs,
      count: organizations.length,
      next_page: start + perPage < organizations.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }
}

// =============================================================================
// Local Attachments Resource
// =============================================================================

class LocalAttachmentsResource {
  private attachments: Map<number, Attachment> = new Map()
  private uploads: Map<string, UploadResponse> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async upload(params: AttachmentUploadParams): Promise<UploadResponse> {
    const id = generateId()
    const token = params.token ?? generateStringId('upload')

    const attachment: Attachment = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/attachments/${id}.json`,
      file_name: params.filename,
      content_url: `https://${this.subdomain}.zendesk.com/attachments/token/${token}/${params.filename}`,
      content_type: params.contentType,
      size: typeof params.data === 'string' ? params.data.length : params.data.byteLength,
      thumbnails: [],
      inline: false,
    }

    this.attachments.set(id, attachment)

    const response: UploadResponse = {
      token,
      attachment,
      attachments: [attachment],
    }

    this.uploads.set(token, response)
    return response
  }

  async get(id: number): Promise<Attachment> {
    const attachment = this.attachments.get(id)
    if (!attachment) {
      throw new Error(`Attachment not found: ${id}`)
    }
    return attachment
  }

  async delete(id: number): Promise<void> {
    if (!this.attachments.has(id)) {
      throw new Error(`Attachment not found: ${id}`)
    }
    this.attachments.delete(id)
  }
}

// =============================================================================
// Local Triggers Resource
// =============================================================================

class LocalTriggersResource {
  private triggers: Map<number, Trigger> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: TriggerCreateParams): Promise<Trigger> {
    const id = generateId()
    const now = new Date().toISOString()

    const trigger: Trigger = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/triggers/${id}.json`,
      title: params.title,
      active: params.active ?? true,
      position: params.position ?? this.triggers.size + 1,
      conditions: params.conditions,
      actions: params.actions,
      description: params.description ?? null,
      created_at: now,
      updated_at: now,
      category_id: params.category_id ?? null,
    }

    this.triggers.set(id, trigger)
    return trigger
  }

  async get(id: number): Promise<Trigger> {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Trigger not found: ${id}`)
    }
    return trigger
  }

  async update(id: number, params: TriggerUpdateParams): Promise<Trigger> {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Trigger not found: ${id}`)
    }

    const updated: Trigger = {
      ...trigger,
      ...params,
      updated_at: new Date().toISOString(),
    }

    this.triggers.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.triggers.has(id)) {
      throw new Error(`Trigger not found: ${id}`)
    }
    this.triggers.delete(id)
  }

  async list(params?: TriggerListParams): Promise<TriggerListResponse> {
    let triggers = Array.from(this.triggers.values())

    if (params?.active !== undefined) {
      triggers = triggers.filter((t) => t.active === params.active)
    }

    // Sort by position
    triggers.sort((a, b) => a.position - b.position)

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedTriggers = triggers.slice(start, start + perPage)

    return {
      triggers: paginatedTriggers,
      count: triggers.length,
      next_page: start + perPage < triggers.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async listActive(params?: TriggerListParams): Promise<TriggerListResponse> {
    return this.list({ ...params, active: true })
  }
}

// =============================================================================
// Local Automations Resource
// =============================================================================

class LocalAutomationsResource {
  private automations: Map<number, Automation> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: AutomationCreateParams): Promise<Automation> {
    const id = generateId()
    const now = new Date().toISOString()

    const automation: Automation = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/automations/${id}.json`,
      title: params.title,
      active: params.active ?? true,
      position: params.position ?? this.automations.size + 1,
      conditions: params.conditions,
      actions: params.actions,
      created_at: now,
      updated_at: now,
    }

    this.automations.set(id, automation)
    return automation
  }

  async get(id: number): Promise<Automation> {
    const automation = this.automations.get(id)
    if (!automation) {
      throw new Error(`Automation not found: ${id}`)
    }
    return automation
  }

  async update(id: number, params: AutomationUpdateParams): Promise<Automation> {
    const automation = this.automations.get(id)
    if (!automation) {
      throw new Error(`Automation not found: ${id}`)
    }

    const updated: Automation = {
      ...automation,
      ...params,
      updated_at: new Date().toISOString(),
    }

    this.automations.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.automations.has(id)) {
      throw new Error(`Automation not found: ${id}`)
    }
    this.automations.delete(id)
  }

  async list(params?: AutomationListParams): Promise<AutomationListResponse> {
    let automations = Array.from(this.automations.values())

    if (params?.active !== undefined) {
      automations = automations.filter((a) => a.active === params.active)
    }

    automations.sort((a, b) => a.position - b.position)

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedAutomations = automations.slice(start, start + perPage)

    return {
      automations: paginatedAutomations,
      count: automations.length,
      next_page: start + perPage < automations.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }
}

// =============================================================================
// Local Views Resource
// =============================================================================

class LocalViewsResource {
  private views: Map<number, View> = new Map()
  private subdomain: string
  private ticketsResource: LocalTicketsResource

  constructor(subdomain: string, ticketsResource: LocalTicketsResource) {
    this.subdomain = subdomain
    this.ticketsResource = ticketsResource
  }

  async create(params: ViewCreateParams): Promise<View> {
    const id = generateId()
    const now = new Date().toISOString()

    const view: View = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/views/${id}.json`,
      title: params.title,
      active: params.active ?? true,
      position: this.views.size + 1,
      created_at: now,
      updated_at: now,
      restriction: params.restriction ?? null,
      execution: {
        group_by: params.output?.group_by ?? null,
        group_order: params.output?.group_order ?? 'desc',
        sort_by: params.output?.sort_by ?? 'created_at',
        sort_order: params.output?.sort_order ?? 'desc',
      },
      conditions: params.conditions,
      output: {
        columns: params.output?.columns ?? ['subject', 'requester', 'status'],
        group_by: params.output?.group_by ?? null,
        group_order: params.output?.group_order ?? 'desc',
        sort_by: params.output?.sort_by ?? 'created_at',
        sort_order: params.output?.sort_order ?? 'desc',
      },
    }

    this.views.set(id, view)
    return view
  }

  async get(id: number): Promise<View> {
    const view = this.views.get(id)
    if (!view) {
      throw new Error(`View not found: ${id}`)
    }
    return view
  }

  async update(id: number, params: ViewUpdateParams): Promise<View> {
    const view = this.views.get(id)
    if (!view) {
      throw new Error(`View not found: ${id}`)
    }

    const updated: View = {
      ...view,
      ...params,
      updated_at: new Date().toISOString(),
    }

    this.views.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.views.has(id)) {
      throw new Error(`View not found: ${id}`)
    }
    this.views.delete(id)
  }

  async list(params?: ViewListParams): Promise<ViewListResponse> {
    let views = Array.from(this.views.values())

    if (params?.active !== undefined) {
      views = views.filter((v) => v.active === params.active)
    }

    views.sort((a, b) => a.position - b.position)

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedViews = views.slice(start, start + perPage)

    return {
      views: paginatedViews,
      count: views.length,
      next_page: start + perPage < views.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async listActive(params?: ViewListParams): Promise<ViewListResponse> {
    return this.list({ ...params, active: true })
  }

  async listCompact(): Promise<ViewListResponse> {
    return this.list()
  }

  async count(id: number): Promise<ViewCountResponse> {
    const view = await this.get(id)
    const tickets = await this.execute(id)

    return {
      view_count: {
        view_id: id,
        url: `https://${this.subdomain}.zendesk.com/api/v2/views/${id}/count.json`,
        value: tickets.count,
        pretty: String(tickets.count),
        fresh: true,
      },
    }
  }

  async tickets(id: number): Promise<ViewTicketsResponse> {
    return this.execute(id)
  }

  async execute(id: number, params?: { sort_by?: string; sort_order?: 'asc' | 'desc' }): Promise<ViewTicketsResponse> {
    const view = await this.get(id)

    // Get all tickets and filter by view conditions
    const allTickets = await this.ticketsResource.list()
    const filteredTickets = allTickets.tickets.filter((ticket) => this.matchesViewConditions(view, ticket))

    return {
      tickets: filteredTickets,
      count: filteredTickets.length,
      next_page: null,
      previous_page: null,
    }
  }

  async preview(params: ViewCreateParams): Promise<ViewTicketsResponse> {
    // Create a temporary view and execute it
    const tempView: View = {
      id: 0,
      url: '',
      title: 'Preview',
      active: true,
      position: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      restriction: null,
      execution: {
        group_by: null,
        group_order: 'desc',
        sort_by: 'created_at',
        sort_order: 'desc',
      },
      conditions: params.conditions,
      output: {
        columns: ['subject', 'requester', 'status'],
        group_by: null,
        group_order: 'desc',
        sort_by: 'created_at',
        sort_order: 'desc',
      },
    }

    const allTickets = await this.ticketsResource.list()
    const filteredTickets = allTickets.tickets.filter((ticket) => this.matchesViewConditions(tempView, ticket))

    return {
      tickets: filteredTickets,
      count: filteredTickets.length,
      next_page: null,
      previous_page: null,
    }
  }

  private matchesViewConditions(view: View, ticket: Ticket): boolean {
    const { all, any } = view.conditions

    const allMatch = all.every((cond) => this.conditionMatches(cond, ticket))
    const anyMatch = any.length === 0 || any.some((cond) => this.conditionMatches(cond, ticket))

    return allMatch && anyMatch
  }

  private conditionMatches(condition: { field: string; operator: string; value: unknown }, ticket: Ticket): boolean {
    const ticketValue = (ticket as any)[condition.field]

    switch (condition.operator) {
      case 'is':
        return ticketValue === condition.value
      case 'is_not':
        return ticketValue !== condition.value
      case 'greater_than':
        return ticketValue > (condition.value as number)
      case 'less_than':
        return ticketValue < (condition.value as number)
      default:
        return false
    }
  }
}

// =============================================================================
// Local Macros Resource
// =============================================================================

class LocalMacrosResource {
  private macros: Map<number, Macro> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: MacroCreateParams): Promise<Macro> {
    const id = generateId()
    const now = new Date().toISOString()

    const macro: Macro = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/macros/${id}.json`,
      title: params.title,
      active: params.active ?? true,
      position: this.macros.size + 1,
      created_at: now,
      updated_at: now,
      description: params.description ?? null,
      actions: params.actions,
      restriction: params.restriction ?? null,
    }

    this.macros.set(id, macro)
    return macro
  }

  async get(id: number): Promise<Macro> {
    const macro = this.macros.get(id)
    if (!macro) {
      throw new Error(`Macro not found: ${id}`)
    }
    return macro
  }

  async update(id: number, params: MacroUpdateParams): Promise<Macro> {
    const macro = this.macros.get(id)
    if (!macro) {
      throw new Error(`Macro not found: ${id}`)
    }

    const updated: Macro = {
      ...macro,
      ...params,
      updated_at: new Date().toISOString(),
    }

    this.macros.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.macros.has(id)) {
      throw new Error(`Macro not found: ${id}`)
    }
    this.macros.delete(id)
  }

  async list(params?: MacroListParams): Promise<MacroListResponse> {
    let macros = Array.from(this.macros.values())

    if (params?.active !== undefined) {
      macros = macros.filter((m) => m.active === params.active)
    }

    macros.sort((a, b) => a.position - b.position)

    const perPage = params?.per_page ?? 100
    const page = params?.page ?? 1
    const start = (page - 1) * perPage
    const paginatedMacros = macros.slice(start, start + perPage)

    return {
      macros: paginatedMacros,
      count: macros.length,
      next_page: start + perPage < macros.length ? `page=${page + 1}` : null,
      previous_page: page > 1 ? `page=${page - 1}` : null,
    }
  }

  async listActive(params?: MacroListParams): Promise<MacroListResponse> {
    return this.list({ ...params, active: true })
  }

  async apply(id: number, _ticketId: number): Promise<MacroApplyResult> {
    const macro = await this.get(id)

    // Simulate applying macro actions
    const ticketChanges: Partial<Ticket> = {}
    let comment: { body: string; html_body: string; public: boolean } | undefined

    for (const action of macro.actions) {
      if (action.field === 'comment_value' || action.field === 'comment_value_html') {
        comment = {
          body: String(action.value),
          html_body: `<p>${String(action.value)}</p>`,
          public: true,
        }
      } else {
        (ticketChanges as any)[action.field] = action.value
      }
    }

    return {
      result: {
        ticket: ticketChanges,
        comment,
      },
    }
  }

  async search(query: string): Promise<MacroListResponse> {
    const macros = Array.from(this.macros.values()).filter((m) =>
      m.title.toLowerCase().includes(query.toLowerCase())
    )

    return {
      macros,
      count: macros.length,
      next_page: null,
      previous_page: null,
    }
  }
}

// =============================================================================
// Local Groups Resource
// =============================================================================

class LocalGroupsResource {
  private groups: Map<number, Group> = new Map()
  private membershipStore: Map<number, GroupMembership> = new Map()
  private subdomain: string

  constructor(subdomain: string) {
    this.subdomain = subdomain
  }

  async create(params: GroupCreateParams): Promise<Group> {
    const id = generateId()
    const now = new Date().toISOString()

    const group: Group = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/groups/${id}.json`,
      name: params.name,
      description: params.description ?? null,
      default: false,
      deleted: false,
      created_at: now,
      updated_at: now,
    }

    this.groups.set(id, group)
    return group
  }

  async get(id: number): Promise<Group> {
    const group = this.groups.get(id)
    if (!group) {
      throw new Error(`Group not found: ${id}`)
    }
    return group
  }

  async update(id: number, params: GroupUpdateParams): Promise<Group> {
    const group = this.groups.get(id)
    if (!group) {
      throw new Error(`Group not found: ${id}`)
    }

    const updated: Group = {
      ...group,
      ...params,
      updated_at: new Date().toISOString(),
    }

    this.groups.set(id, updated)
    return updated
  }

  async delete(id: number): Promise<void> {
    if (!this.groups.has(id)) {
      throw new Error(`Group not found: ${id}`)
    }
    this.groups.delete(id)
  }

  async list(): Promise<GroupListResponse> {
    const groups = Array.from(this.groups.values())

    return {
      groups,
      count: groups.length,
      next_page: null,
      previous_page: null,
    }
  }

  async listAssignable(): Promise<GroupListResponse> {
    return this.list()
  }

  async memberships(groupId: number): Promise<GroupMembershipListResponse> {
    const memberships = Array.from(this.membershipStore.values()).filter((m) => m.group_id === groupId)

    return {
      group_memberships: memberships,
      count: memberships.length,
      next_page: null,
      previous_page: null,
    }
  }

  async addMember(groupId: number, userId: number): Promise<GroupMembership> {
    const id = generateId()
    const now = new Date().toISOString()

    const membership: GroupMembership = {
      id,
      url: `https://${this.subdomain}.zendesk.com/api/v2/group_memberships/${id}.json`,
      user_id: userId,
      group_id: groupId,
      default: false,
      created_at: now,
      updated_at: now,
    }

    this.membershipStore.set(id, membership)
    return membership
  }

  async removeMember(membershipId: number): Promise<void> {
    if (!this.membershipStore.has(membershipId)) {
      throw new Error(`Group membership not found: ${membershipId}`)
    }
    this.membershipStore.delete(membershipId)
  }

  async setDefaultForUser(userId: number, membershipId: number): Promise<GroupMembership[]> {
    const membership = this.membershipStore.get(membershipId)
    if (!membership) {
      throw new Error(`Group membership not found: ${membershipId}`)
    }

    // Unset all other defaults for this user
    for (const [id, m] of this.membershipStore) {
      if (m.user_id === userId) {
        m.default = id === membershipId
        this.membershipStore.set(id, m)
      }
    }

    return Array.from(this.membershipStore.values()).filter((m) => m.user_id === userId)
  }
}

// =============================================================================
// ZendeskLocal Client
// =============================================================================

/**
 * Local Zendesk implementation backed by in-memory state
 *
 * This provides a fully functional Zendesk-compatible API without requiring
 * a connection to Zendesk's servers. Data is stored locally using Maps
 * which can be backed by Durable Object storage in production.
 *
 * @example
 * ```typescript
 * import { ZendeskLocal } from '@dotdo/zendesk'
 *
 * const client = new ZendeskLocal({
 *   subdomain: 'my-company',
 * })
 *
 * // Use exactly like the regular client
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need assistance',
 * })
 * ```
 */
export class ZendeskLocal {
  /** Tickets resource for managing support tickets */
  readonly tickets: LocalTicketsResource
  /** Users resource for managing customers and agents */
  readonly users: LocalUsersResource
  /** Organizations resource for managing customer organizations */
  readonly organizations: LocalOrganizationsResource
  /** Attachments resource for file uploads */
  readonly attachments: LocalAttachmentsResource
  /** Triggers resource for automation rules */
  readonly triggers: LocalTriggersResource
  /** Automations resource for time-based rules */
  readonly automations: LocalAutomationsResource
  /** Views resource for saved ticket filters */
  readonly views: LocalViewsResource
  /** Macros resource for ticket action shortcuts */
  readonly macros: LocalMacrosResource
  /** Groups resource for agent team management */
  readonly groups: LocalGroupsResource

  constructor(config: ZendeskLocalConfig) {
    this.users = new LocalUsersResource(config.subdomain)
    this.organizations = new LocalOrganizationsResource(config.subdomain)
    this.attachments = new LocalAttachmentsResource(config.subdomain)
    this.triggers = new LocalTriggersResource(config.subdomain)
    this.automations = new LocalAutomationsResource(config.subdomain)
    this.macros = new LocalMacrosResource(config.subdomain)
    this.groups = new LocalGroupsResource(config.subdomain)
    this.tickets = new LocalTicketsResource(config.subdomain, this.triggers, this.users)
    this.views = new LocalViewsResource(config.subdomain, this.tickets)
  }
}
