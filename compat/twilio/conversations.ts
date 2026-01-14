/**
 * @dotdo/twilio/conversations - Twilio Conversations API Compatibility Layer
 *
 * Production-ready multi-party messaging with cross-channel support,
 * participant management, and message handling.
 *
 * @example
 * ```typescript
 * import { TwilioConversations } from '@dotdo/twilio/conversations'
 *
 * const conversations = new TwilioConversations({
 *   accountSid: 'AC...',
 *   authToken: 'your-auth-token',
 * })
 *
 * // Create a conversation
 * const conversation = await conversations.create({
 *   friendlyName: 'Support Chat',
 * })
 *
 * // Add SMS participant
 * const smsParticipant = await conversations.participants.create(conversation.sid, {
 *   'messagingBinding.type': 'sms',
 *   'messagingBinding.address': '+15558675310',
 *   'messagingBinding.proxyAddress': '+15017122661',
 * })
 *
 * // Add WhatsApp participant
 * const whatsappParticipant = await conversations.participants.create(conversation.sid, {
 *   'messagingBinding.type': 'whatsapp',
 *   'messagingBinding.address': 'whatsapp:+15558675310',
 *   'messagingBinding.proxyAddress': 'whatsapp:+14155238886',
 * })
 *
 * // Add chat participant
 * const chatParticipant = await conversations.participants.create(conversation.sid, {
 *   identity: 'agent-123',
 * })
 *
 * // Send a message
 * const message = await conversations.messages.create(conversation.sid, {
 *   author: 'agent-123',
 *   body: 'Hello! How can I help you today?',
 * })
 * ```
 *
 * @module @dotdo/twilio/conversations
 */

import { Hono } from 'hono'
import type {
  TwilioClientConfig,
  TwilioErrorResponse,
  Conversation,
  ConversationCreateParams,
  ConversationUpdateParams,
  ConversationListParams,
  ConversationParticipant,
  ParticipantCreateParams,
  ParticipantUpdateParams,
  ConversationMessage,
  ConversationMessageCreateParams,
  ConversationMessageUpdateParams,
  ConversationMessageListParams,
  DeliveryReceipt,
  ConversationWebhook,
  ConversationWebhookCreateParams,
  ConversationWebhookUpdateParams,
  ConversationUser,
  ConversationUserCreateParams,
  ConversationUserUpdateParams,
  UserConversation,
  UserConversationUpdateParams,
  ConversationService,
  ConversationServiceCreateParams,
  ConversationServiceUpdateParams,
  ConversationWebhookPayload,
  ConversationWebhookEvent,
  ConversationState,
  ConversationBindingType,
} from './types'

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type {
  Conversation,
  ConversationCreateParams,
  ConversationUpdateParams,
  ConversationListParams,
  ConversationParticipant,
  ParticipantCreateParams,
  ParticipantUpdateParams,
  ConversationMessage,
  ConversationMessageCreateParams,
  ConversationMessageUpdateParams,
  ConversationMessageListParams,
  DeliveryReceipt,
  ConversationWebhook,
  ConversationWebhookCreateParams,
  ConversationWebhookUpdateParams,
  ConversationUser,
  ConversationUserCreateParams,
  ConversationUserUpdateParams,
  UserConversation,
  UserConversationUpdateParams,
  ConversationService,
  ConversationServiceCreateParams,
  ConversationServiceUpdateParams,
  ConversationWebhookPayload,
  ConversationWebhookEvent,
  ConversationState,
  ConversationBindingType,
}

// =============================================================================
// Response Types
// =============================================================================

/** Response when listing conversations */
export interface ConversationsListResponse {
  conversations: Conversation[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    key: string
  }
}

/** Response when listing participants */
export interface ParticipantsListResponse {
  participants: ConversationParticipant[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    key: string
  }
}

/** Response when listing messages */
export interface MessagesListResponse {
  messages: ConversationMessage[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    key: string
  }
}

/** Response when listing users */
export interface UsersListResponse {
  users: ConversationUser[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    key: string
  }
}

/** Response when listing services */
export interface ServicesListResponse {
  services: ConversationService[]
  meta: {
    page: number
    page_size: number
    first_page_url: string
    previous_page_url: string | null
    next_page_url: string | null
    key: string
  }
}

// =============================================================================
// Configuration
// =============================================================================

/** TwilioConversations client configuration */
export interface TwilioConversationsConfig extends TwilioClientConfig {
  /** Default Chat Service SID */
  defaultServiceSid?: string
  /** Webhook secret for signature verification */
  webhookSecret?: string
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Twilio Conversations API Error
 */
export class TwilioConversationsError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioErrorResponse) {
    super(response.message)
    this.name = 'TwilioConversationsError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 30000
const CONVERSATIONS_API_VERSION = 'v1'

// =============================================================================
// Participants Manager
// =============================================================================

/**
 * Manages participants in a conversation
 */
export class ParticipantsManager {
  constructor(
    private client: TwilioConversations,
    private serviceSid?: string
  ) {}

  /**
   * Create a new participant in a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - Participant creation parameters
   * @returns The created participant
   */
  async create(
    conversationSid: string,
    params: ParticipantCreateParams
  ): Promise<ConversationParticipant> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Participants`
      : `/Conversations/${conversationSid}/Participants`

    return this.client._request('POST', path, this._normalizeParams(params))
  }

  /**
   * Get a participant by SID
   *
   * @param conversationSid - The conversation SID
   * @param participantSid - The participant SID
   * @returns The participant
   */
  async get(
    conversationSid: string,
    participantSid: string
  ): Promise<ConversationParticipant> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Participants/${participantSid}`
      : `/Conversations/${conversationSid}/Participants/${participantSid}`

    return this.client._request('GET', path)
  }

  /**
   * Update a participant
   *
   * @param conversationSid - The conversation SID
   * @param participantSid - The participant SID
   * @param params - Update parameters
   * @returns The updated participant
   */
  async update(
    conversationSid: string,
    participantSid: string,
    params: ParticipantUpdateParams
  ): Promise<ConversationParticipant> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Participants/${participantSid}`
      : `/Conversations/${conversationSid}/Participants/${participantSid}`

    return this.client._request('POST', path, this._normalizeUpdateParams(params))
  }

  /**
   * Delete a participant
   *
   * @param conversationSid - The conversation SID
   * @param participantSid - The participant SID
   * @returns true if deleted
   */
  async delete(conversationSid: string, participantSid: string): Promise<boolean> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Participants/${participantSid}`
      : `/Conversations/${conversationSid}/Participants/${participantSid}`

    await this.client._request('DELETE', path)
    return true
  }

  /**
   * List participants in a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - List parameters
   * @returns List of participants
   */
  async list(
    conversationSid: string,
    params?: { pageSize?: number; pageToken?: string }
  ): Promise<ConversationParticipant[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Participants`
      : `/Conversations/${conversationSid}/Participants`

    const queryParams: Record<string, unknown> = {}
    if (params?.pageSize) queryParams.PageSize = params.pageSize
    if (params?.pageToken) queryParams.PageToken = params.pageToken

    const response = (await this.client._request(
      'GET',
      path,
      queryParams
    )) as ParticipantsListResponse
    return response.participants
  }

  private _normalizeParams(params: ParticipantCreateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.identity) normalized.Identity = params.identity
    if (params['messagingBinding.type']) normalized['MessagingBinding.Type'] = params['messagingBinding.type']
    if (params['messagingBinding.address']) normalized['MessagingBinding.Address'] = params['messagingBinding.address']
    if (params['messagingBinding.proxyAddress']) normalized['MessagingBinding.ProxyAddress'] = params['messagingBinding.proxyAddress']
    if (params['messagingBinding.projectedAddress']) normalized['MessagingBinding.ProjectedAddress'] = params['messagingBinding.projectedAddress']
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.roleSid) normalized.RoleSid = params.roleSid
    if (params.dateCreated) normalized.DateCreated = params.dateCreated.toISOString()
    if (params.dateUpdated) normalized.DateUpdated = params.dateUpdated.toISOString()

    return normalized
  }

  private _normalizeUpdateParams(params: ParticipantUpdateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.attributes) normalized.Attributes = params.attributes
    if (params.roleSid) normalized.RoleSid = params.roleSid
    if (params.lastReadMessageIndex !== undefined) normalized.LastReadMessageIndex = params.lastReadMessageIndex
    if (params.lastReadTimestamp) normalized.LastReadTimestamp = params.lastReadTimestamp
    if (params.dateCreated) normalized.DateCreated = params.dateCreated.toISOString()
    if (params.dateUpdated) normalized.DateUpdated = params.dateUpdated.toISOString()

    return normalized
  }
}

// =============================================================================
// Messages Manager
// =============================================================================

/**
 * Manages messages in a conversation
 */
export class MessagesManager {
  constructor(
    private client: TwilioConversations,
    private serviceSid?: string
  ) {}

  /**
   * Create a new message in a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - Message creation parameters
   * @returns The created message
   */
  async create(
    conversationSid: string,
    params: ConversationMessageCreateParams
  ): Promise<ConversationMessage> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages`
      : `/Conversations/${conversationSid}/Messages`

    return this.client._request('POST', path, this._normalizeParams(params))
  }

  /**
   * Get a message by SID
   *
   * @param conversationSid - The conversation SID
   * @param messageSid - The message SID
   * @returns The message
   */
  async get(conversationSid: string, messageSid: string): Promise<ConversationMessage> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages/${messageSid}`
      : `/Conversations/${conversationSid}/Messages/${messageSid}`

    return this.client._request('GET', path)
  }

  /**
   * Update a message
   *
   * @param conversationSid - The conversation SID
   * @param messageSid - The message SID
   * @param params - Update parameters
   * @returns The updated message
   */
  async update(
    conversationSid: string,
    messageSid: string,
    params: ConversationMessageUpdateParams
  ): Promise<ConversationMessage> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages/${messageSid}`
      : `/Conversations/${conversationSid}/Messages/${messageSid}`

    return this.client._request('POST', path, this._normalizeUpdateParams(params))
  }

  /**
   * Delete a message
   *
   * @param conversationSid - The conversation SID
   * @param messageSid - The message SID
   * @returns true if deleted
   */
  async delete(conversationSid: string, messageSid: string): Promise<boolean> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages/${messageSid}`
      : `/Conversations/${conversationSid}/Messages/${messageSid}`

    await this.client._request('DELETE', path)
    return true
  }

  /**
   * List messages in a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - List parameters
   * @returns List of messages
   */
  async list(
    conversationSid: string,
    params?: ConversationMessageListParams
  ): Promise<ConversationMessage[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages`
      : `/Conversations/${conversationSid}/Messages`

    const queryParams: Record<string, unknown> = {}
    if (params?.pageSize) queryParams.PageSize = params.pageSize
    if (params?.pageToken) queryParams.PageToken = params.pageToken
    if (params?.order) queryParams.Order = params.order

    const response = (await this.client._request(
      'GET',
      path,
      queryParams
    )) as MessagesListResponse
    return response.messages
  }

  /**
   * Get delivery receipts for a message
   *
   * @param conversationSid - The conversation SID
   * @param messageSid - The message SID
   * @returns List of delivery receipts
   */
  async getDeliveryReceipts(
    conversationSid: string,
    messageSid: string
  ): Promise<DeliveryReceipt[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Messages/${messageSid}/Receipts`
      : `/Conversations/${conversationSid}/Messages/${messageSid}/Receipts`

    const response = (await this.client._request('GET', path)) as {
      delivery_receipts: DeliveryReceipt[]
    }
    return response.delivery_receipts
  }

  private _normalizeParams(params: ConversationMessageCreateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.author) normalized.Author = params.author
    if (params.body) normalized.Body = params.body
    if (params.mediaSid) normalized.MediaSid = params.mediaSid
    if (params.contentSid) normalized.ContentSid = params.contentSid
    if (params.contentVariables) normalized.ContentVariables = params.contentVariables
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.dateCreated) normalized.DateCreated = params.dateCreated.toISOString()
    if (params.dateUpdated) normalized.DateUpdated = params.dateUpdated.toISOString()

    return normalized
  }

  private _normalizeUpdateParams(
    params: ConversationMessageUpdateParams
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.author) normalized.Author = params.author
    if (params.body) normalized.Body = params.body
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.dateCreated) normalized.DateCreated = params.dateCreated.toISOString()
    if (params.dateUpdated) normalized.DateUpdated = params.dateUpdated.toISOString()

    return normalized
  }
}

// =============================================================================
// Users Manager
// =============================================================================

/**
 * Manages users in a conversation service
 */
export class UsersManager {
  constructor(
    private client: TwilioConversations,
    private serviceSid?: string
  ) {}

  /**
   * Create a new user
   *
   * @param params - User creation parameters
   * @returns The created user
   */
  async create(params: ConversationUserCreateParams): Promise<ConversationUser> {
    const path = this.serviceSid ? `/Services/${this.serviceSid}/Users` : `/Users`

    return this.client._request('POST', path, this._normalizeParams(params))
  }

  /**
   * Get a user by SID or identity
   *
   * @param userSidOrIdentity - The user SID or identity
   * @returns The user
   */
  async get(userSidOrIdentity: string): Promise<ConversationUser> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Users/${userSidOrIdentity}`
      : `/Users/${userSidOrIdentity}`

    return this.client._request('GET', path)
  }

  /**
   * Update a user
   *
   * @param userSidOrIdentity - The user SID or identity
   * @param params - Update parameters
   * @returns The updated user
   */
  async update(
    userSidOrIdentity: string,
    params: ConversationUserUpdateParams
  ): Promise<ConversationUser> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Users/${userSidOrIdentity}`
      : `/Users/${userSidOrIdentity}`

    return this.client._request('POST', path, this._normalizeUpdateParams(params))
  }

  /**
   * Delete a user
   *
   * @param userSidOrIdentity - The user SID or identity
   * @returns true if deleted
   */
  async delete(userSidOrIdentity: string): Promise<boolean> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Users/${userSidOrIdentity}`
      : `/Users/${userSidOrIdentity}`

    await this.client._request('DELETE', path)
    return true
  }

  /**
   * List users
   *
   * @param params - List parameters
   * @returns List of users
   */
  async list(params?: { pageSize?: number; pageToken?: string }): Promise<ConversationUser[]> {
    const path = this.serviceSid ? `/Services/${this.serviceSid}/Users` : `/Users`

    const queryParams: Record<string, unknown> = {}
    if (params?.pageSize) queryParams.PageSize = params.pageSize
    if (params?.pageToken) queryParams.PageToken = params.pageToken

    const response = (await this.client._request('GET', path, queryParams)) as UsersListResponse
    return response.users
  }

  /**
   * Get conversations for a user
   *
   * @param userSidOrIdentity - The user SID or identity
   * @returns List of user conversations
   */
  async getConversations(userSidOrIdentity: string): Promise<UserConversation[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Users/${userSidOrIdentity}/Conversations`
      : `/Users/${userSidOrIdentity}/Conversations`

    const response = (await this.client._request('GET', path)) as {
      conversations: UserConversation[]
    }
    return response.conversations
  }

  /**
   * Update a user's conversation settings
   *
   * @param userSidOrIdentity - The user SID or identity
   * @param conversationSid - The conversation SID
   * @param params - Update parameters
   * @returns The updated user conversation
   */
  async updateConversation(
    userSidOrIdentity: string,
    conversationSid: string,
    params: UserConversationUpdateParams
  ): Promise<UserConversation> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Users/${userSidOrIdentity}/Conversations/${conversationSid}`
      : `/Users/${userSidOrIdentity}/Conversations/${conversationSid}`

    const normalized: Record<string, unknown> = {}
    if (params.notificationLevel) normalized.NotificationLevel = params.notificationLevel
    if (params.lastReadMessageIndex !== undefined) normalized.LastReadMessageIndex = params.lastReadMessageIndex
    if (params.lastReadTimestamp) normalized.LastReadTimestamp = params.lastReadTimestamp

    return this.client._request('POST', path, normalized)
  }

  private _normalizeParams(params: ConversationUserCreateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {
      Identity: params.identity,
    }

    if (params.friendlyName) normalized.FriendlyName = params.friendlyName
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.roleSid) normalized.RoleSid = params.roleSid

    return normalized
  }

  private _normalizeUpdateParams(params: ConversationUserUpdateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.friendlyName) normalized.FriendlyName = params.friendlyName
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.roleSid) normalized.RoleSid = params.roleSid

    return normalized
  }
}

// =============================================================================
// Webhooks Manager
// =============================================================================

/**
 * Manages webhooks for a conversation
 */
export class WebhooksManager {
  constructor(
    private client: TwilioConversations,
    private serviceSid?: string
  ) {}

  /**
   * Create a new webhook for a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - Webhook creation parameters
   * @returns The created webhook
   */
  async create(
    conversationSid: string,
    params: ConversationWebhookCreateParams
  ): Promise<ConversationWebhook> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Webhooks`
      : `/Conversations/${conversationSid}/Webhooks`

    return this.client._request('POST', path, this._normalizeParams(params))
  }

  /**
   * Get a webhook by SID
   *
   * @param conversationSid - The conversation SID
   * @param webhookSid - The webhook SID
   * @returns The webhook
   */
  async get(conversationSid: string, webhookSid: string): Promise<ConversationWebhook> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Webhooks/${webhookSid}`
      : `/Conversations/${conversationSid}/Webhooks/${webhookSid}`

    return this.client._request('GET', path)
  }

  /**
   * Update a webhook
   *
   * @param conversationSid - The conversation SID
   * @param webhookSid - The webhook SID
   * @param params - Update parameters
   * @returns The updated webhook
   */
  async update(
    conversationSid: string,
    webhookSid: string,
    params: ConversationWebhookUpdateParams
  ): Promise<ConversationWebhook> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Webhooks/${webhookSid}`
      : `/Conversations/${conversationSid}/Webhooks/${webhookSid}`

    return this.client._request('POST', path, this._normalizeUpdateParams(params))
  }

  /**
   * Delete a webhook
   *
   * @param conversationSid - The conversation SID
   * @param webhookSid - The webhook SID
   * @returns true if deleted
   */
  async delete(conversationSid: string, webhookSid: string): Promise<boolean> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Webhooks/${webhookSid}`
      : `/Conversations/${conversationSid}/Webhooks/${webhookSid}`

    await this.client._request('DELETE', path)
    return true
  }

  /**
   * List webhooks for a conversation
   *
   * @param conversationSid - The conversation SID
   * @returns List of webhooks
   */
  async list(conversationSid: string): Promise<ConversationWebhook[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}/Webhooks`
      : `/Conversations/${conversationSid}/Webhooks`

    const response = (await this.client._request('GET', path)) as {
      webhooks: ConversationWebhook[]
    }
    return response.webhooks
  }

  private _normalizeParams(params: ConversationWebhookCreateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {
      Target: params.target,
    }

    if (params['configuration.url']) normalized['Configuration.Url'] = params['configuration.url']
    if (params['configuration.method']) normalized['Configuration.Method'] = params['configuration.method']
    if (params['configuration.filters']) normalized['Configuration.Filters'] = params['configuration.filters']
    if (params['configuration.replayAfter'] !== undefined) normalized['Configuration.ReplayAfter'] = params['configuration.replayAfter']
    if (params['configuration.flowSid']) normalized['Configuration.FlowSid'] = params['configuration.flowSid']
    if (params['configuration.triggers']) normalized['Configuration.Triggers'] = params['configuration.triggers']

    return normalized
  }

  private _normalizeUpdateParams(
    params: ConversationWebhookUpdateParams
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params['configuration.url']) normalized['Configuration.Url'] = params['configuration.url']
    if (params['configuration.method']) normalized['Configuration.Method'] = params['configuration.method']
    if (params['configuration.filters']) normalized['Configuration.Filters'] = params['configuration.filters']

    return normalized
  }
}

// =============================================================================
// Services Manager
// =============================================================================

/**
 * Manages conversation services
 */
export class ServicesManager {
  constructor(private client: TwilioConversations) {}

  /**
   * Create a new conversation service
   *
   * @param params - Service creation parameters
   * @returns The created service
   */
  async create(params: ConversationServiceCreateParams): Promise<ConversationService> {
    return this.client._request('POST', '/Services', {
      FriendlyName: params.friendlyName,
    })
  }

  /**
   * Get a service by SID
   *
   * @param serviceSid - The service SID
   * @returns The service
   */
  async get(serviceSid: string): Promise<ConversationService> {
    return this.client._request('GET', `/Services/${serviceSid}`)
  }

  /**
   * Update a service
   *
   * @param serviceSid - The service SID
   * @param params - Update parameters
   * @returns The updated service
   */
  async update(
    serviceSid: string,
    params: ConversationServiceUpdateParams
  ): Promise<ConversationService> {
    const normalized: Record<string, unknown> = {}
    if (params.friendlyName) normalized.FriendlyName = params.friendlyName

    return this.client._request('POST', `/Services/${serviceSid}`, normalized)
  }

  /**
   * Delete a service
   *
   * @param serviceSid - The service SID
   * @returns true if deleted
   */
  async delete(serviceSid: string): Promise<boolean> {
    await this.client._request('DELETE', `/Services/${serviceSid}`)
    return true
  }

  /**
   * List all services
   *
   * @param params - List parameters
   * @returns List of services
   */
  async list(params?: { pageSize?: number; pageToken?: string }): Promise<ConversationService[]> {
    const queryParams: Record<string, unknown> = {}
    if (params?.pageSize) queryParams.PageSize = params.pageSize
    if (params?.pageToken) queryParams.PageToken = params.pageToken

    const response = (await this.client._request(
      'GET',
      '/Services',
      queryParams
    )) as ServicesListResponse
    return response.services
  }

  /**
   * Get a scoped client for a specific service
   *
   * @param serviceSid - The service SID
   * @returns A TwilioConversations client scoped to the service
   */
  service(serviceSid: string): TwilioConversations {
    return this.client._scopedToService(serviceSid)
  }
}

// =============================================================================
// Webhook Event Handlers
// =============================================================================

/** Webhook event handler type */
export type ConversationEventHandler<T = ConversationWebhookPayload> = (payload: T) => void | Promise<void>

// =============================================================================
// TwilioConversations Client
// =============================================================================

/**
 * TwilioConversations - Multi-party messaging client with cross-channel support
 */
export class TwilioConversations {
  private accountSid: string
  private authToken: string
  private config: TwilioConversationsConfig
  private baseUrl: string
  private _fetch: typeof fetch
  private serviceSid?: string

  /** Participants manager */
  readonly participants: ParticipantsManager
  /** Messages manager */
  readonly messages: MessagesManager
  /** Users manager */
  readonly users: UsersManager
  /** Webhooks manager */
  readonly webhooks: WebhooksManager
  /** Services manager */
  readonly services: ServicesManager

  // Event handlers
  private eventHandlers: Map<ConversationWebhookEvent | '*', ConversationEventHandler[]> = new Map()

  constructor(
    config: TwilioConversationsConfig & { accountSid: string; authToken: string }
  ) {
    if (!config.accountSid) {
      throw new Error('accountSid is required')
    }
    if (!config.authToken) {
      throw new Error('authToken is required')
    }

    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.serviceSid = config.defaultServiceSid

    // Build base URL
    let apiHost = 'conversations.twilio.com'
    if (config.edge) {
      apiHost = `conversations.${config.edge}.twilio.com`
    }
    if (config.region) {
      apiHost = `conversations.${config.region}.twilio.com`
    }
    this.baseUrl = `https://${apiHost}/${CONVERSATIONS_API_VERSION}`

    // Initialize managers
    this.participants = new ParticipantsManager(this, this.serviceSid)
    this.messages = new MessagesManager(this, this.serviceSid)
    this.users = new UsersManager(this, this.serviceSid)
    this.webhooks = new WebhooksManager(this, this.serviceSid)
    this.services = new ServicesManager(this)
  }

  // ===========================================================================
  // Conversation CRUD
  // ===========================================================================

  /**
   * Create a new conversation
   *
   * @param params - Conversation creation parameters
   * @returns The created conversation
   *
   * @example
   * ```typescript
   * const conversation = await conversations.create({
   *   friendlyName: 'Support Chat',
   *   uniqueName: 'support-12345',
   *   attributes: JSON.stringify({ ticketId: '12345' }),
   * })
   * ```
   */
  async create(params?: ConversationCreateParams): Promise<Conversation> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations`
      : '/Conversations'

    return this._request('POST', path, this._normalizeCreateParams(params))
  }

  /**
   * Get a conversation by SID or unique name
   *
   * @param conversationSidOrUniqueName - The conversation SID or unique name
   * @returns The conversation
   */
  async get(conversationSidOrUniqueName: string): Promise<Conversation> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSidOrUniqueName}`
      : `/Conversations/${conversationSidOrUniqueName}`

    return this._request('GET', path)
  }

  /**
   * Update a conversation
   *
   * @param conversationSid - The conversation SID
   * @param params - Update parameters
   * @returns The updated conversation
   */
  async update(
    conversationSid: string,
    params: ConversationUpdateParams
  ): Promise<Conversation> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}`
      : `/Conversations/${conversationSid}`

    return this._request('POST', path, this._normalizeUpdateParams(params))
  }

  /**
   * Delete a conversation
   *
   * @param conversationSid - The conversation SID
   * @returns true if deleted
   */
  async delete(conversationSid: string): Promise<boolean> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations/${conversationSid}`
      : `/Conversations/${conversationSid}`

    await this._request('DELETE', path)
    return true
  }

  /**
   * List conversations
   *
   * @param params - List parameters
   * @returns List of conversations
   */
  async list(params?: ConversationListParams): Promise<Conversation[]> {
    const path = this.serviceSid
      ? `/Services/${this.serviceSid}/Conversations`
      : '/Conversations'

    const queryParams: Record<string, unknown> = {}
    if (params?.pageSize) queryParams.PageSize = params.pageSize
    if (params?.pageToken) queryParams.PageToken = params.pageToken
    if (params?.startDate) queryParams.StartDate = params.startDate.toISOString()
    if (params?.endDate) queryParams.EndDate = params.endDate.toISOString()

    const response = (await this._request(
      'GET',
      path,
      queryParams
    )) as ConversationsListResponse
    return response.conversations
  }

  // ===========================================================================
  // Conversation State Management
  // ===========================================================================

  /**
   * Close a conversation
   *
   * @param conversationSid - The conversation SID
   * @returns The closed conversation
   */
  async close(conversationSid: string): Promise<Conversation> {
    return this.update(conversationSid, { state: 'closed' })
  }

  /**
   * Reopen a closed conversation
   *
   * @param conversationSid - The conversation SID
   * @returns The reopened conversation
   */
  async reopen(conversationSid: string): Promise<Conversation> {
    return this.update(conversationSid, { state: 'active' })
  }

  // ===========================================================================
  // Cross-Channel Messaging
  // ===========================================================================

  /**
   * Add an SMS participant to a conversation
   *
   * @param conversationSid - The conversation SID
   * @param address - The phone number
   * @param proxyAddress - The Twilio phone number
   * @param options - Additional options
   * @returns The created participant
   */
  async addSmsParticipant(
    conversationSid: string,
    address: string,
    proxyAddress: string,
    options?: { attributes?: string; roleSid?: string }
  ): Promise<ConversationParticipant> {
    return this.participants.create(conversationSid, {
      'messagingBinding.type': 'sms',
      'messagingBinding.address': address,
      'messagingBinding.proxyAddress': proxyAddress,
      attributes: options?.attributes,
      roleSid: options?.roleSid,
    })
  }

  /**
   * Add a WhatsApp participant to a conversation
   *
   * @param conversationSid - The conversation SID
   * @param address - The WhatsApp number (with or without whatsapp: prefix)
   * @param proxyAddress - The Twilio WhatsApp number
   * @param options - Additional options
   * @returns The created participant
   */
  async addWhatsAppParticipant(
    conversationSid: string,
    address: string,
    proxyAddress: string,
    options?: { attributes?: string; roleSid?: string }
  ): Promise<ConversationParticipant> {
    const normalizedAddress = address.startsWith('whatsapp:') ? address : `whatsapp:${address}`
    const normalizedProxy = proxyAddress.startsWith('whatsapp:')
      ? proxyAddress
      : `whatsapp:${proxyAddress}`

    return this.participants.create(conversationSid, {
      'messagingBinding.type': 'whatsapp',
      'messagingBinding.address': normalizedAddress,
      'messagingBinding.proxyAddress': normalizedProxy,
      attributes: options?.attributes,
      roleSid: options?.roleSid,
    })
  }

  /**
   * Add a chat participant to a conversation
   *
   * @param conversationSid - The conversation SID
   * @param identity - The user identity
   * @param options - Additional options
   * @returns The created participant
   */
  async addChatParticipant(
    conversationSid: string,
    identity: string,
    options?: { attributes?: string; roleSid?: string }
  ): Promise<ConversationParticipant> {
    return this.participants.create(conversationSid, {
      identity,
      attributes: options?.attributes,
      roleSid: options?.roleSid,
    })
  }

  /**
   * Send a message to a conversation
   *
   * @param conversationSid - The conversation SID
   * @param body - The message body
   * @param options - Additional options
   * @returns The created message
   */
  async sendMessage(
    conversationSid: string,
    body: string,
    options?: { author?: string; attributes?: string }
  ): Promise<ConversationMessage> {
    return this.messages.create(conversationSid, {
      body,
      author: options?.author,
      attributes: options?.attributes,
    })
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Register an event handler
   *
   * @param event - The event type or '*' for all events
   * @param handler - The handler function
   */
  on(event: ConversationWebhookEvent | '*', handler: ConversationEventHandler): void {
    const handlers = this.eventHandlers.get(event) || []
    handlers.push(handler)
    this.eventHandlers.set(event, handlers)
  }

  /**
   * Remove an event handler
   *
   * @param event - The event type
   * @param handler - The handler function to remove
   */
  off(event: ConversationWebhookEvent | '*', handler: ConversationEventHandler): void {
    const handlers = this.eventHandlers.get(event) || []
    const index = handlers.indexOf(handler)
    if (index > -1) {
      handlers.splice(index, 1)
      this.eventHandlers.set(event, handlers)
    }
  }

  /**
   * Handle an incoming webhook event
   *
   * @param payload - The webhook payload
   */
  async handleWebhook(payload: ConversationWebhookPayload): Promise<void> {
    // Get handlers for this specific event
    const eventHandlers = this.eventHandlers.get(payload.EventType) || []
    // Get handlers for all events
    const wildcardHandlers = this.eventHandlers.get('*') || []

    // Run all handlers
    const allHandlers = [...eventHandlers, ...wildcardHandlers]
    for (const handler of allHandlers) {
      await handler(payload)
    }
  }

  /**
   * Verify webhook signature
   *
   * @param signature - X-Twilio-Signature header
   * @param url - Full webhook URL
   * @param params - Request parameters
   * @returns Whether signature is valid
   */
  async verifyWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): Promise<boolean> {
    const secret = this.config.webhookSecret || this.authToken
    const expectedSignature = await this._getExpectedSignature(secret, url, params)
    return this._secureCompare(signature, expectedSignature)
  }

  /**
   * Create a Hono router for handling webhooks
   *
   * @returns Hono app with webhook routes
   */
  createWebhookHandler(): Hono {
    const router = new Hono()

    router.post('/', async (c) => {
      const contentType = c.req.header('Content-Type') || ''

      let payload: Record<string, string>
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await c.req.parseBody()
        payload = Object.fromEntries(
          Object.entries(formData).map(([k, v]) => [k, String(v)])
        )
      } else {
        payload = await c.req.json()
      }

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      // Handle webhook
      await this.handleWebhook(payload as unknown as ConversationWebhookPayload)

      return c.json({ success: true }, 200)
    })

    return router
  }

  // ===========================================================================
  // Service Scoping
  // ===========================================================================

  /**
   * Get a client scoped to a specific service
   *
   * @param serviceSid - The service SID
   * @returns A scoped client
   */
  service(serviceSid: string): TwilioConversations {
    return this._scopedToService(serviceSid)
  }

  /**
   * Internal method to create a scoped client
   * @internal
   */
  _scopedToService(serviceSid: string): TwilioConversations {
    return new TwilioConversations({
      accountSid: this.accountSid,
      authToken: this.authToken,
      ...this.config,
      defaultServiceSid: serviceSid,
      fetch: this._fetch,
    })
  }

  // ===========================================================================
  // Internal Request Method
  // ===========================================================================

  /**
   * Make API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    // Build URL by concatenating base + path (NOT using new URL with relative path,
    // which would treat absolute paths as replacing the base path)
    const url = new URL(this.baseUrl + path)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build Basic Auth header
    const auth = btoa(`${this.accountSid}:${this.authToken}`)

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    // Build request body for POST
    let body: string | undefined
    if (method === 'POST' && params) {
      body = this._encodeFormData(params)
    }

    const maxRetries = this.config.autoRetry ? (this.config.maxRetries ?? 3) : 0
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = this.config.timeout ?? DEFAULT_TIMEOUT
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        try {
          const response = await this._fetch(url.toString(), {
            method,
            headers,
            body,
            signal: controller.signal,
          })

          if (method === 'DELETE' && response.status === 204) {
            return true as unknown as T
          }

          const data = await response.json()

          if (!response.ok) {
            throw new TwilioConversationsError(data as TwilioErrorResponse)
          }

          return data as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (
          error instanceof TwilioConversationsError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          throw error
        }

        // Retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this._sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _normalizeCreateParams(params?: ConversationCreateParams): Record<string, unknown> {
    if (!params) return {}

    const normalized: Record<string, unknown> = {}

    if (params.friendlyName) normalized.FriendlyName = params.friendlyName
    if (params.uniqueName) normalized.UniqueName = params.uniqueName
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.messagingServiceSid) normalized.MessagingServiceSid = params.messagingServiceSid
    if (params.state) normalized.State = params.state
    if (params['timers.inactive']) normalized['Timers.Inactive'] = params['timers.inactive']
    if (params['timers.closed']) normalized['Timers.Closed'] = params['timers.closed']

    return normalized
  }

  private _normalizeUpdateParams(params: ConversationUpdateParams): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}

    if (params.friendlyName) normalized.FriendlyName = params.friendlyName
    if (params.uniqueName) normalized.UniqueName = params.uniqueName
    if (params.attributes) normalized.Attributes = params.attributes
    if (params.state) normalized.State = params.state
    if (params['timers.inactive']) normalized['Timers.Inactive'] = params['timers.inactive']
    if (params['timers.closed']) normalized['Timers.Closed'] = params['timers.closed']

    return normalized
  }

  private _encodeFormData(data: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue

      const fullKey = prefix ? `${prefix}[${key}]` : key

      if (value === null || value === '') {
        parts.push(`${encodeURIComponent(fullKey)}=`)
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(item))}`)
        })
      } else if (typeof value === 'object') {
        parts.push(this._encodeFormData(value as Record<string, unknown>, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }

    return parts.filter((p) => p).join('&')
  }

  private async _getExpectedSignature(
    authToken: string,
    url: string,
    params: Record<string, string>
  ): Promise<string> {
    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }

    const encoder = new TextEncoder()
    const keyData = encoder.encode(authToken)
    const messageData = encoder.encode(data)

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, messageData)
    const signatureBytes = new Uint8Array(signature)
    return btoa(Array.from(signatureBytes).map((b) => String.fromCharCode(b)).join(''))
  }

  private _secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TwilioConversations client
 *
 * @param accountSid - Twilio Account SID
 * @param authToken - Twilio Auth Token
 * @param config - Additional configuration
 * @returns TwilioConversations instance
 *
 * @example
 * ```typescript
 * import { createConversationsClient } from '@dotdo/twilio/conversations'
 *
 * const conversations = createConversationsClient('AC...', 'token', {
 *   defaultServiceSid: 'IS...',
 * })
 * ```
 */
export function createConversationsClient(
  accountSid: string,
  authToken: string,
  config?: Omit<TwilioConversationsConfig, 'accountSid' | 'authToken'>
): TwilioConversations {
  return new TwilioConversations({ accountSid, authToken, ...config })
}

// =============================================================================
// Exports
// =============================================================================

export default TwilioConversations
