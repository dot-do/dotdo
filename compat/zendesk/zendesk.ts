/**
 * @dotdo/zendesk - Zendesk API Compatibility Layer
 *
 * Drop-in replacement for node-zendesk SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import Zendesk from '@dotdo/zendesk'
 *
 * const client = new Zendesk.Client({
 *   subdomain: 'mycompany',
 *   email: 'admin@example.com',
 *   token: 'api_token',
 * })
 *
 * // Create a ticket
 * const ticket = await client.tickets.create({
 *   subject: 'Help needed',
 *   description: 'I need help with...',
 *   priority: 'high',
 *   type: 'incident',
 *   requester: { email: 'user@example.com' },
 * })
 * ```
 *
 * @module @dotdo/zendesk
 */

import type {
  ClientConfig,
  RequestOptions,
  ZendeskErrorResponse,
  FetchFunction,
  // Ticket types
  Ticket,
  TicketCreateParams,
  TicketUpdateParams,
  TicketListParams,
  TicketListResponse,
  SearchResponse,
  CommentCreateParams,
  CommentListParams,
  CommentListResponse,
  // User types
  User,
  UserCreateParams,
  UserUpdateParams,
  UserSearchParams,
  UserListParams,
  UserListResponse,
  // Organization types
  Organization,
  OrganizationCreateParams,
  OrganizationUpdateParams,
  OrganizationListParams,
  OrganizationListResponse,
  // Attachment types
  Attachment,
  AttachmentUploadParams,
  UploadResponse,
  // Trigger types
  Trigger,
  TriggerCreateParams,
  TriggerUpdateParams,
  TriggerListParams,
  TriggerListResponse,
  // Automation types
  Automation,
  AutomationCreateParams,
  AutomationUpdateParams,
  AutomationListParams,
  AutomationListResponse,
  // Ticket Field types
  TicketField,
  TicketFieldCreateParams,
  TicketFieldUpdateParams,
  TicketFieldListParams,
  TicketFieldListResponse,
  // Ticket Form types
  TicketForm,
  TicketFormCreateParams,
  TicketFormUpdateParams,
  TicketFormListResponse,
  // View types
  View,
  ViewCreateParams,
  ViewUpdateParams,
  ViewListParams,
  ViewListResponse,
  ViewCountResponse,
  ViewTicketsResponse,
  // Macro types
  Macro,
  MacroCreateParams,
  MacroUpdateParams,
  MacroListParams,
  MacroListResponse,
  MacroApplyResult,
  // Group types
  Group,
  GroupCreateParams,
  GroupUpdateParams,
  GroupListResponse,
  GroupMembership,
  GroupMembershipListResponse,
  // Webhook types
  Webhook,
  WebhookCreateParams,
  WebhookUpdateParams,
  WebhookListResponse,
  // Target types
  Target,
  TargetCreateParams,
  TargetUpdateParams,
  TargetListResponse,
} from './types'

// =============================================================================
// Zendesk Error Class
// =============================================================================

/**
 * Zendesk API Error
 */
export class ZendeskError extends Error {
  error: string
  statusCode: number
  description?: string
  details?: Record<string, unknown>

  constructor(response: ZendeskErrorResponse, statusCode: number) {
    const message = response.description ?? response.message ?? response.error ?? 'Unknown error'
    super(message)
    this.name = 'ZendeskError'
    this.error = response.error ?? 'unknown'
    this.statusCode = statusCode
    this.description = response.description
    this.details = response.details
  }
}

// =============================================================================
// Resource Base Class
// =============================================================================

/**
 * Base class for Zendesk API resources
 */
abstract class ZendeskResource {
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
// Tickets Resource
// =============================================================================

/**
 * Tickets resource for managing Zendesk tickets
 */
export class TicketsResource extends ZendeskResource {
  /**
   * Create a new ticket
   */
  async create(params: TicketCreateParams, options?: RequestOptions): Promise<Ticket> {
    const response = await this.request<{ ticket: Ticket }>('POST', '/api/v2/tickets', { ticket: params }, options)
    return response.ticket
  }

  /**
   * Get a ticket by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Ticket> {
    const response = await this.request<{ ticket: Ticket }>('GET', `/api/v2/tickets/${id}`, undefined, options)
    return response.ticket
  }

  /**
   * Update a ticket
   */
  async update(id: number, params: TicketUpdateParams, options?: RequestOptions): Promise<Ticket> {
    const response = await this.request<{ ticket: Ticket }>('PUT', `/api/v2/tickets/${id}`, { ticket: params }, options)
    return response.ticket
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
  async list(params?: TicketListParams, options?: RequestOptions): Promise<TicketListResponse> {
    return this.request<TicketListResponse>('GET', '/api/v2/tickets', params, options)
  }

  /**
   * Search tickets by query string
   */
  async search(query: string, options?: RequestOptions): Promise<SearchResponse<Ticket>> {
    return this.request<SearchResponse<Ticket>>('GET', '/api/v2/search', { query: `type:ticket ${query}` }, options)
  }

  /**
   * Create a comment on a ticket
   */
  async createComment(ticketId: number, params: CommentCreateParams, options?: RequestOptions): Promise<Ticket> {
    const response = await this.request<{ ticket: Ticket }>(
      'PUT',
      `/api/v2/tickets/${ticketId}`,
      { ticket: { comment: params } },
      options
    )
    return response.ticket
  }

  /**
   * List comments for a ticket
   */
  async listComments(ticketId: number, params?: CommentListParams, options?: RequestOptions): Promise<CommentListResponse> {
    return this.request<CommentListResponse>('GET', `/api/v2/tickets/${ticketId}/comments`, params, options)
  }
}

// =============================================================================
// Users Resource
// =============================================================================

/**
 * Users resource for managing Zendesk users
 */
export class UsersResource extends ZendeskResource {
  /**
   * Create a new user
   */
  async create(params: UserCreateParams, options?: RequestOptions): Promise<User> {
    const response = await this.request<{ user: User }>('POST', '/api/v2/users', { user: params }, options)
    return response.user
  }

  /**
   * Get a user by ID
   */
  async get(id: number, options?: RequestOptions): Promise<User> {
    const response = await this.request<{ user: User }>('GET', `/api/v2/users/${id}`, undefined, options)
    return response.user
  }

  /**
   * Update a user
   */
  async update(id: number, params: UserUpdateParams, options?: RequestOptions): Promise<User> {
    const response = await this.request<{ user: User }>('PUT', `/api/v2/users/${id}`, { user: params }, options)
    return response.user
  }

  /**
   * Delete a user
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/users/${id}`, undefined, options)
  }

  /**
   * List users
   */
  async list(params?: UserListParams, options?: RequestOptions): Promise<UserListResponse> {
    return this.request<UserListResponse>('GET', '/api/v2/users', params, options)
  }

  /**
   * Search users
   */
  async search(params: UserSearchParams, options?: RequestOptions): Promise<UserListResponse> {
    return this.request<UserListResponse>('GET', '/api/v2/users/search', params, options)
  }

  /**
   * Merge two users (merge source into target)
   */
  async merge(targetUserId: number, sourceUserId: number, options?: RequestOptions): Promise<User> {
    const response = await this.request<{ user: User }>(
      'PUT',
      `/api/v2/users/${targetUserId}/merge`,
      { user: { id: sourceUserId } },
      options
    )
    return response.user
  }
}

// =============================================================================
// Organizations Resource
// =============================================================================

/**
 * Organizations resource for managing Zendesk organizations
 */
export class OrganizationsResource extends ZendeskResource {
  /**
   * Create a new organization
   */
  async create(params: OrganizationCreateParams, options?: RequestOptions): Promise<Organization> {
    const response = await this.request<{ organization: Organization }>(
      'POST',
      '/api/v2/organizations',
      { organization: params },
      options
    )
    return response.organization
  }

  /**
   * Get an organization by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Organization> {
    const response = await this.request<{ organization: Organization }>(
      'GET',
      `/api/v2/organizations/${id}`,
      undefined,
      options
    )
    return response.organization
  }

  /**
   * Update an organization
   */
  async update(id: number, params: OrganizationUpdateParams, options?: RequestOptions): Promise<Organization> {
    const response = await this.request<{ organization: Organization }>(
      'PUT',
      `/api/v2/organizations/${id}`,
      { organization: params },
      options
    )
    return response.organization
  }

  /**
   * Delete an organization
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/organizations/${id}`, undefined, options)
  }

  /**
   * List organizations
   */
  async list(params?: OrganizationListParams, options?: RequestOptions): Promise<OrganizationListResponse> {
    return this.request<OrganizationListResponse>('GET', '/api/v2/organizations', params, options)
  }
}

// =============================================================================
// Attachments Resource
// =============================================================================

/**
 * Attachments resource for managing Zendesk attachments
 */
export class AttachmentsResource extends ZendeskResource {
  /**
   * Upload an attachment
   */
  async upload(params: AttachmentUploadParams, options?: RequestOptions): Promise<UploadResponse> {
    const response = await this.request<{ upload: UploadResponse }>(
      'POST',
      '/api/v2/uploads',
      {
        filename: params.filename,
        content_type: params.contentType,
        data: params.data,
        token: params.token,
      },
      options
    )
    return response.upload
  }

  /**
   * Get an attachment by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Attachment> {
    const response = await this.request<{ attachment: Attachment }>(
      'GET',
      `/api/v2/attachments/${id}`,
      undefined,
      options
    )
    return response.attachment
  }

  /**
   * Delete an attachment
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/attachments/${id}`, undefined, options)
  }
}

// =============================================================================
// Triggers Resource
// =============================================================================

/**
 * Triggers resource for managing Zendesk triggers
 */
export class TriggersResource extends ZendeskResource {
  /**
   * Create a new trigger
   */
  async create(params: TriggerCreateParams, options?: RequestOptions): Promise<Trigger> {
    const response = await this.request<{ trigger: Trigger }>(
      'POST',
      '/api/v2/triggers',
      { trigger: params },
      options
    )
    return response.trigger
  }

  /**
   * Get a trigger by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Trigger> {
    const response = await this.request<{ trigger: Trigger }>(
      'GET',
      `/api/v2/triggers/${id}`,
      undefined,
      options
    )
    return response.trigger
  }

  /**
   * Update a trigger
   */
  async update(id: number, params: TriggerUpdateParams, options?: RequestOptions): Promise<Trigger> {
    const response = await this.request<{ trigger: Trigger }>(
      'PUT',
      `/api/v2/triggers/${id}`,
      { trigger: params },
      options
    )
    return response.trigger
  }

  /**
   * Delete a trigger
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/triggers/${id}`, undefined, options)
  }

  /**
   * List triggers
   */
  async list(params?: TriggerListParams, options?: RequestOptions): Promise<TriggerListResponse> {
    return this.request<TriggerListResponse>('GET', '/api/v2/triggers', params, options)
  }

  /**
   * List active triggers only
   */
  async listActive(params?: TriggerListParams, options?: RequestOptions): Promise<TriggerListResponse> {
    return this.request<TriggerListResponse>('GET', '/api/v2/triggers/active', params, options)
  }
}

// =============================================================================
// Automations Resource
// =============================================================================

/**
 * Automations resource for managing Zendesk automations
 */
export class AutomationsResource extends ZendeskResource {
  /**
   * Create a new automation
   */
  async create(params: AutomationCreateParams, options?: RequestOptions): Promise<Automation> {
    const response = await this.request<{ automation: Automation }>(
      'POST',
      '/api/v2/automations',
      { automation: params },
      options
    )
    return response.automation
  }

  /**
   * Get an automation by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Automation> {
    const response = await this.request<{ automation: Automation }>(
      'GET',
      `/api/v2/automations/${id}`,
      undefined,
      options
    )
    return response.automation
  }

  /**
   * Update an automation
   */
  async update(id: number, params: AutomationUpdateParams, options?: RequestOptions): Promise<Automation> {
    const response = await this.request<{ automation: Automation }>(
      'PUT',
      `/api/v2/automations/${id}`,
      { automation: params },
      options
    )
    return response.automation
  }

  /**
   * Delete an automation
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/automations/${id}`, undefined, options)
  }

  /**
   * List automations
   */
  async list(params?: AutomationListParams, options?: RequestOptions): Promise<AutomationListResponse> {
    return this.request<AutomationListResponse>('GET', '/api/v2/automations', params, options)
  }
}

// =============================================================================
// Ticket Fields Resource
// =============================================================================

/**
 * Ticket Fields resource for managing custom fields
 */
export class TicketFieldsResource extends ZendeskResource {
  /**
   * Create a new ticket field
   */
  async create(params: TicketFieldCreateParams, options?: RequestOptions): Promise<TicketField> {
    const response = await this.request<{ ticket_field: TicketField }>(
      'POST',
      '/api/v2/ticket_fields',
      { ticket_field: params },
      options
    )
    return response.ticket_field
  }

  /**
   * Get a ticket field by ID
   */
  async get(id: number, options?: RequestOptions): Promise<TicketField> {
    const response = await this.request<{ ticket_field: TicketField }>(
      'GET',
      `/api/v2/ticket_fields/${id}`,
      undefined,
      options
    )
    return response.ticket_field
  }

  /**
   * Update a ticket field
   */
  async update(id: number, params: TicketFieldUpdateParams, options?: RequestOptions): Promise<TicketField> {
    const response = await this.request<{ ticket_field: TicketField }>(
      'PUT',
      `/api/v2/ticket_fields/${id}`,
      { ticket_field: params },
      options
    )
    return response.ticket_field
  }

  /**
   * Delete a ticket field
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/ticket_fields/${id}`, undefined, options)
  }

  /**
   * List all ticket fields
   */
  async list(params?: TicketFieldListParams, options?: RequestOptions): Promise<TicketFieldListResponse> {
    return this.request<TicketFieldListResponse>('GET', '/api/v2/ticket_fields', params, options)
  }
}

// =============================================================================
// Ticket Forms Resource
// =============================================================================

/**
 * Ticket Forms resource for managing ticket forms
 */
export class TicketFormsResource extends ZendeskResource {
  /**
   * Create a new ticket form
   */
  async create(params: TicketFormCreateParams, options?: RequestOptions): Promise<TicketForm> {
    const response = await this.request<{ ticket_form: TicketForm }>(
      'POST',
      '/api/v2/ticket_forms',
      { ticket_form: params },
      options
    )
    return response.ticket_form
  }

  /**
   * Get a ticket form by ID
   */
  async get(id: number, options?: RequestOptions): Promise<TicketForm> {
    const response = await this.request<{ ticket_form: TicketForm }>(
      'GET',
      `/api/v2/ticket_forms/${id}`,
      undefined,
      options
    )
    return response.ticket_form
  }

  /**
   * Update a ticket form
   */
  async update(id: number, params: TicketFormUpdateParams, options?: RequestOptions): Promise<TicketForm> {
    const response = await this.request<{ ticket_form: TicketForm }>(
      'PUT',
      `/api/v2/ticket_forms/${id}`,
      { ticket_form: params },
      options
    )
    return response.ticket_form
  }

  /**
   * Delete a ticket form
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/ticket_forms/${id}`, undefined, options)
  }

  /**
   * List all ticket forms
   */
  async list(options?: RequestOptions): Promise<TicketFormListResponse> {
    return this.request<TicketFormListResponse>('GET', '/api/v2/ticket_forms', undefined, options)
  }

  /**
   * Clone a ticket form
   */
  async clone(id: number, options?: RequestOptions): Promise<TicketForm> {
    const response = await this.request<{ ticket_form: TicketForm }>(
      'POST',
      `/api/v2/ticket_forms/${id}/clone`,
      undefined,
      options
    )
    return response.ticket_form
  }

  /**
   * Reorder ticket forms
   */
  async reorder(ticketFormIds: number[], options?: RequestOptions): Promise<TicketForm[]> {
    const response = await this.request<{ ticket_forms: TicketForm[] }>(
      'PUT',
      '/api/v2/ticket_forms/reorder',
      { ticket_form_ids: ticketFormIds },
      options
    )
    return response.ticket_forms
  }
}

// =============================================================================
// Views Resource
// =============================================================================

/**
 * Views resource for managing ticket views
 */
export class ViewsResource extends ZendeskResource {
  /**
   * Create a new view
   */
  async create(params: ViewCreateParams, options?: RequestOptions): Promise<View> {
    const response = await this.request<{ view: View }>('POST', '/api/v2/views', { view: params }, options)
    return response.view
  }

  /**
   * Get a view by ID
   */
  async get(id: number, options?: RequestOptions): Promise<View> {
    const response = await this.request<{ view: View }>('GET', `/api/v2/views/${id}`, undefined, options)
    return response.view
  }

  /**
   * Update a view
   */
  async update(id: number, params: ViewUpdateParams, options?: RequestOptions): Promise<View> {
    const response = await this.request<{ view: View }>('PUT', `/api/v2/views/${id}`, { view: params }, options)
    return response.view
  }

  /**
   * Delete a view
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/views/${id}`, undefined, options)
  }

  /**
   * List all views
   */
  async list(params?: ViewListParams, options?: RequestOptions): Promise<ViewListResponse> {
    return this.request<ViewListResponse>('GET', '/api/v2/views', params, options)
  }

  /**
   * List active views
   */
  async listActive(params?: ViewListParams, options?: RequestOptions): Promise<ViewListResponse> {
    return this.request<ViewListResponse>('GET', '/api/v2/views/active', params, options)
  }

  /**
   * List compact views (lightweight)
   */
  async listCompact(options?: RequestOptions): Promise<ViewListResponse> {
    return this.request<ViewListResponse>('GET', '/api/v2/views/compact', undefined, options)
  }

  /**
   * Get ticket count for a view
   */
  async count(id: number, options?: RequestOptions): Promise<ViewCountResponse> {
    return this.request<ViewCountResponse>('GET', `/api/v2/views/${id}/count`, undefined, options)
  }

  /**
   * Get tickets from a view
   */
  async tickets(id: number, options?: RequestOptions): Promise<ViewTicketsResponse> {
    return this.request<ViewTicketsResponse>('GET', `/api/v2/views/${id}/tickets`, undefined, options)
  }

  /**
   * Execute a view (get tickets matching view conditions)
   */
  async execute(id: number, params?: { sort_by?: string; sort_order?: 'asc' | 'desc' }, options?: RequestOptions): Promise<ViewTicketsResponse> {
    return this.request<ViewTicketsResponse>('GET', `/api/v2/views/${id}/execute`, params, options)
  }

  /**
   * Preview a view (test conditions without saving)
   */
  async preview(params: ViewCreateParams, options?: RequestOptions): Promise<ViewTicketsResponse> {
    return this.request<ViewTicketsResponse>('POST', '/api/v2/views/preview', { view: params }, options)
  }
}

// =============================================================================
// Macros Resource
// =============================================================================

/**
 * Macros resource for managing ticket macros
 */
export class MacrosResource extends ZendeskResource {
  /**
   * Create a new macro
   */
  async create(params: MacroCreateParams, options?: RequestOptions): Promise<Macro> {
    const response = await this.request<{ macro: Macro }>('POST', '/api/v2/macros', { macro: params }, options)
    return response.macro
  }

  /**
   * Get a macro by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Macro> {
    const response = await this.request<{ macro: Macro }>('GET', `/api/v2/macros/${id}`, undefined, options)
    return response.macro
  }

  /**
   * Update a macro
   */
  async update(id: number, params: MacroUpdateParams, options?: RequestOptions): Promise<Macro> {
    const response = await this.request<{ macro: Macro }>('PUT', `/api/v2/macros/${id}`, { macro: params }, options)
    return response.macro
  }

  /**
   * Delete a macro
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/macros/${id}`, undefined, options)
  }

  /**
   * List all macros
   */
  async list(params?: MacroListParams, options?: RequestOptions): Promise<MacroListResponse> {
    return this.request<MacroListResponse>('GET', '/api/v2/macros', params, options)
  }

  /**
   * List active macros
   */
  async listActive(params?: MacroListParams, options?: RequestOptions): Promise<MacroListResponse> {
    return this.request<MacroListResponse>('GET', '/api/v2/macros/active', params, options)
  }

  /**
   * Apply a macro to a ticket (preview changes)
   */
  async apply(id: number, ticketId: number, options?: RequestOptions): Promise<MacroApplyResult> {
    return this.request<MacroApplyResult>('GET', `/api/v2/tickets/${ticketId}/macros/${id}/apply`, undefined, options)
  }

  /**
   * Search macros
   */
  async search(query: string, options?: RequestOptions): Promise<MacroListResponse> {
    return this.request<MacroListResponse>('GET', '/api/v2/macros/search', { query }, options)
  }
}

// =============================================================================
// Groups Resource
// =============================================================================

/**
 * Groups resource for managing agent groups
 */
export class GroupsResource extends ZendeskResource {
  /**
   * Create a new group
   */
  async create(params: GroupCreateParams, options?: RequestOptions): Promise<Group> {
    const response = await this.request<{ group: Group }>('POST', '/api/v2/groups', { group: params }, options)
    return response.group
  }

  /**
   * Get a group by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Group> {
    const response = await this.request<{ group: Group }>('GET', `/api/v2/groups/${id}`, undefined, options)
    return response.group
  }

  /**
   * Update a group
   */
  async update(id: number, params: GroupUpdateParams, options?: RequestOptions): Promise<Group> {
    const response = await this.request<{ group: Group }>('PUT', `/api/v2/groups/${id}`, { group: params }, options)
    return response.group
  }

  /**
   * Delete a group
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/groups/${id}`, undefined, options)
  }

  /**
   * List all groups
   */
  async list(options?: RequestOptions): Promise<GroupListResponse> {
    return this.request<GroupListResponse>('GET', '/api/v2/groups', undefined, options)
  }

  /**
   * List assignable groups
   */
  async listAssignable(options?: RequestOptions): Promise<GroupListResponse> {
    return this.request<GroupListResponse>('GET', '/api/v2/groups/assignable', undefined, options)
  }

  /**
   * Get group memberships
   */
  async memberships(groupId: number, options?: RequestOptions): Promise<GroupMembershipListResponse> {
    return this.request<GroupMembershipListResponse>('GET', `/api/v2/groups/${groupId}/memberships`, undefined, options)
  }

  /**
   * Add a user to a group
   */
  async addMember(groupId: number, userId: number, options?: RequestOptions): Promise<GroupMembership> {
    const response = await this.request<{ group_membership: GroupMembership }>(
      'POST',
      '/api/v2/group_memberships',
      { group_membership: { user_id: userId, group_id: groupId } },
      options
    )
    return response.group_membership
  }

  /**
   * Remove a user from a group
   */
  async removeMember(membershipId: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/group_memberships/${membershipId}`, undefined, options)
  }

  /**
   * Set default group for a user
   */
  async setDefaultForUser(userId: number, membershipId: number, options?: RequestOptions): Promise<GroupMembership[]> {
    const response = await this.request<{ group_memberships: GroupMembership[] }>(
      'PUT',
      `/api/v2/users/${userId}/group_memberships/${membershipId}/make_default`,
      undefined,
      options
    )
    return response.group_memberships
  }
}

// =============================================================================
// Webhooks Resource
// =============================================================================

/**
 * Webhooks resource for managing webhooks
 */
export class WebhooksResource extends ZendeskResource {
  /**
   * Create a new webhook
   */
  async create(params: WebhookCreateParams, options?: RequestOptions): Promise<Webhook> {
    const response = await this.request<{ webhook: Webhook }>(
      'POST',
      '/api/v2/webhooks',
      { webhook: params },
      options
    )
    return response.webhook
  }

  /**
   * Get a webhook by ID
   */
  async get(id: string, options?: RequestOptions): Promise<Webhook> {
    const response = await this.request<{ webhook: Webhook }>('GET', `/api/v2/webhooks/${id}`, undefined, options)
    return response.webhook
  }

  /**
   * Update a webhook
   */
  async update(id: string, params: WebhookUpdateParams, options?: RequestOptions): Promise<Webhook> {
    const response = await this.request<{ webhook: Webhook }>(
      'PATCH',
      `/api/v2/webhooks/${id}`,
      { webhook: params },
      options
    )
    return response.webhook
  }

  /**
   * Delete a webhook
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/webhooks/${id}`, undefined, options)
  }

  /**
   * List all webhooks
   */
  async list(options?: RequestOptions): Promise<WebhookListResponse> {
    return this.request<WebhookListResponse>('GET', '/api/v2/webhooks', undefined, options)
  }

  /**
   * Test a webhook
   */
  async test(id: string, options?: RequestOptions): Promise<{ status: string }> {
    return this.request<{ status: string }>('POST', `/api/v2/webhooks/${id}/test`, undefined, options)
  }

  /**
   * Get signing secret for a webhook
   */
  async getSigningSecret(id: string, options?: RequestOptions): Promise<{ signing_secret: { algorithm: string; secret: string } }> {
    return this.request<{ signing_secret: { algorithm: string; secret: string } }>(
      'GET',
      `/api/v2/webhooks/${id}/signing_secret`,
      undefined,
      options
    )
  }

  /**
   * Rotate signing secret for a webhook
   */
  async rotateSigningSecret(id: string, options?: RequestOptions): Promise<{ signing_secret: { algorithm: string; secret: string } }> {
    return this.request<{ signing_secret: { algorithm: string; secret: string } }>(
      'POST',
      `/api/v2/webhooks/${id}/signing_secret/rotate`,
      undefined,
      options
    )
  }
}

// =============================================================================
// Targets Resource (Legacy, being replaced by Webhooks)
// =============================================================================

/**
 * Targets resource for managing legacy targets
 */
export class TargetsResource extends ZendeskResource {
  /**
   * Create a new target
   */
  async create(params: TargetCreateParams, options?: RequestOptions): Promise<Target> {
    const response = await this.request<{ target: Target }>('POST', '/api/v2/targets', { target: params }, options)
    return response.target
  }

  /**
   * Get a target by ID
   */
  async get(id: number, options?: RequestOptions): Promise<Target> {
    const response = await this.request<{ target: Target }>('GET', `/api/v2/targets/${id}`, undefined, options)
    return response.target
  }

  /**
   * Update a target
   */
  async update(id: number, params: TargetUpdateParams, options?: RequestOptions): Promise<Target> {
    const response = await this.request<{ target: Target }>('PUT', `/api/v2/targets/${id}`, { target: params }, options)
    return response.target
  }

  /**
   * Delete a target
   */
  async delete(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/api/v2/targets/${id}`, undefined, options)
  }

  /**
   * List all targets
   */
  async list(options?: RequestOptions): Promise<TargetListResponse> {
    return this.request<TargetListResponse>('GET', '/api/v2/targets', undefined, options)
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * Zendesk client for API interactions
 */
export class Client {
  private subdomain: string
  private authHeader: string
  private _fetch: typeof fetch | FetchFunction

  // Resources
  readonly tickets: TicketsResource
  readonly users: UsersResource
  readonly organizations: OrganizationsResource
  readonly attachments: AttachmentsResource
  readonly triggers: TriggersResource
  readonly automations: AutomationsResource
  readonly ticketFields: TicketFieldsResource
  readonly ticketForms: TicketFormsResource
  readonly views: ViewsResource
  readonly macros: MacrosResource
  readonly groups: GroupsResource
  readonly webhooks: WebhooksResource
  readonly targets: TargetsResource

  constructor(config: ClientConfig) {
    if (!config.subdomain) {
      throw new Error('Subdomain is required')
    }

    if (!config.token && !config.password && !config.oauthToken) {
      throw new Error('Authentication is required (token, password, or oauthToken)')
    }

    this.subdomain = config.subdomain
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Set up authentication header
    if (config.oauthToken) {
      this.authHeader = `Bearer ${config.oauthToken}`
    } else if (config.token && config.email) {
      // Token auth uses email/token with /token suffix
      const credentials = btoa(`${config.email}/token:${config.token}`)
      this.authHeader = `Basic ${credentials}`
    } else if (config.password && config.email) {
      // Password auth
      const credentials = btoa(`${config.email}:${config.password}`)
      this.authHeader = `Basic ${credentials}`
    } else {
      throw new Error('Authentication is required (token, password, or oauthToken)')
    }

    // Initialize resources
    this.tickets = new TicketsResource(this)
    this.users = new UsersResource(this)
    this.organizations = new OrganizationsResource(this)
    this.attachments = new AttachmentsResource(this)
    this.triggers = new TriggersResource(this)
    this.automations = new AutomationsResource(this)
    this.ticketFields = new TicketFieldsResource(this)
    this.ticketForms = new TicketFormsResource(this)
    this.views = new ViewsResource(this)
    this.macros = new MacrosResource(this)
    this.groups = new GroupsResource(this)
    this.webhooks = new WebhooksResource(this)
    this.targets = new TargetsResource(this)
  }

  /**
   * Get base URL for API requests
   */
  private get baseUrl(): string {
    return `https://${this.subdomain}.zendesk.com`
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // Build request body for POST/PUT/PATCH with params
    let body: string | undefined
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && params) {
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
      throw new ZendeskError(data as ZendeskErrorResponse, response.status)
    }

    return data as T
  }
}

// =============================================================================
// Exports
// =============================================================================

export default { Client }
