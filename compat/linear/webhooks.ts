/**
 * Linear Webhooks Resource - Local Implementation
 *
 * Handles webhook configuration, signature verification, and event delivery.
 */

import type {
  Webhook,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookPayload,
  WebhookResourceType,
  WebhookAction,
  WebhookDeliveryPayload,
  Connection,
  PageInfo,
  ID,
  DateTime,
  Team,
  User,
  SuccessPayload,
  PaginationArgs,
} from './types'

export interface WebhooksResourceOptions {
  onDeliver?: (endpoint: Webhook, event: WebhookDeliveryPayload) => Promise<{ status: number; body: string }>
  getTeam?: (id: ID) => Promise<Team | null>
  getUser?: (id: ID) => Promise<User | null>
  organizationId: ID
}

interface StoredWebhook {
  id: ID
  createdAt: DateTime
  updatedAt: DateTime
  archivedAt?: DateTime | null
  url: string
  label?: string | null
  enabled: boolean
  secret: string
  resourceTypes: WebhookResourceType[]
  allPublicTeams: boolean
  teamId?: ID | null
  creatorId?: ID | null
}

interface WebhookEventRecord {
  id: ID
  type: WebhookResourceType
  action: WebhookAction
  createdAt: DateTime
  url: string
  webhookTimestamp: number
  webhookId: ID
  organizationId: ID
  data: Record<string, unknown>
  updatedFrom?: Record<string, unknown>
  deliveryAttempts: number
  lastDeliveryStatus?: number
  lastDeliveryError?: string
}

/**
 * Local Webhooks Resource
 */
export class LocalWebhooksResource {
  private webhooks: Map<ID, StoredWebhook> = new Map()
  private events: Map<ID, WebhookEventRecord> = new Map()
  private options: WebhooksResourceOptions

  constructor(options: WebhooksResourceOptions) {
    this.options = options
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private generateSecret(): string {
    // Generate a webhook secret
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return 'lin_wh_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Convert stored webhook to full Webhook type
   */
  private async hydrate(stored: StoredWebhook): Promise<Webhook> {
    const team = stored.teamId && this.options.getTeam
      ? await this.options.getTeam(stored.teamId)
      : null
    const creator = stored.creatorId && this.options.getUser
      ? await this.options.getUser(stored.creatorId)
      : null

    return {
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      archivedAt: stored.archivedAt,
      url: stored.url,
      label: stored.label,
      enabled: stored.enabled,
      secret: stored.secret,
      resourceTypes: stored.resourceTypes,
      allPublicTeams: stored.allPublicTeams,
      team: team ?? undefined,
      creator: creator ?? undefined,
    }
  }

  /**
   * Create a new webhook
   */
  async create(input: WebhookCreateInput, creatorId?: ID): Promise<WebhookPayload> {
    const now = new Date().toISOString()
    const id = this.generateId()
    const secret = input.secret ?? this.generateSecret()

    const stored: StoredWebhook = {
      id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      url: input.url,
      label: input.label ?? null,
      enabled: input.enabled ?? true,
      secret,
      resourceTypes: input.resourceTypes,
      allPublicTeams: input.allPublicTeams ?? false,
      teamId: input.teamId ?? null,
      creatorId: creatorId ?? null,
    }

    this.webhooks.set(id, stored)
    const webhook = await this.hydrate(stored)

    return {
      success: true,
      webhook,
    }
  }

  /**
   * Retrieve a webhook by ID
   */
  async retrieve(id: ID): Promise<Webhook> {
    const stored = this.webhooks.get(id)
    if (!stored || stored.archivedAt) {
      throw this.createError('NotFound', `Webhook not found: ${id}`)
    }
    return this.hydrate(stored)
  }

  /**
   * Update a webhook
   */
  async update(id: ID, input: WebhookUpdateInput): Promise<WebhookPayload> {
    const existing = this.webhooks.get(id)
    if (!existing || existing.archivedAt) {
      throw this.createError('NotFound', `Webhook not found: ${id}`)
    }

    const now = new Date().toISOString()

    const updated: StoredWebhook = {
      ...existing,
      updatedAt: now,
      url: input.url ?? existing.url,
      label: input.label !== undefined ? input.label : existing.label,
      enabled: input.enabled ?? existing.enabled,
      resourceTypes: input.resourceTypes ?? existing.resourceTypes,
      secret: input.secret !== undefined ? (input.secret ?? existing.secret) : existing.secret,
    }

    this.webhooks.set(id, updated)
    const webhook = await this.hydrate(updated)

    return {
      success: true,
      webhook,
    }
  }

  /**
   * Delete a webhook
   */
  async delete(id: ID): Promise<SuccessPayload> {
    const existing = this.webhooks.get(id)
    if (!existing) {
      throw this.createError('NotFound', `Webhook not found: ${id}`)
    }

    this.webhooks.delete(id)

    return {
      success: true,
    }
  }

  /**
   * List webhooks with pagination
   */
  async list(args?: PaginationArgs): Promise<Connection<Webhook>> {
    const all = Array.from(this.webhooks.values()).filter((w) => !w.archivedAt)
    const hydrated = await Promise.all(all.map((w) => this.hydrate(w)))

    return this.paginateResults(hydrated, args)
  }

  /**
   * Get webhooks for a specific team
   */
  async listByTeam(teamId: ID, args?: PaginationArgs): Promise<Connection<Webhook>> {
    const filtered = Array.from(this.webhooks.values()).filter(
      (w) => !w.archivedAt && (w.teamId === teamId || w.allPublicTeams)
    )
    const hydrated = await Promise.all(filtered.map((w) => this.hydrate(w)))

    return this.paginateResults(hydrated, args)
  }

  /**
   * Create and deliver a webhook event
   */
  async createEvent(
    type: WebhookResourceType,
    action: WebhookAction,
    data: Record<string, unknown>,
    teamId?: ID,
    updatedFrom?: Record<string, unknown>
  ): Promise<WebhookDeliveryPayload> {
    const now = new Date()
    const eventId = this.generateId()

    const payload: WebhookDeliveryPayload = {
      action,
      type,
      createdAt: now.toISOString(),
      url: '', // Will be set per webhook
      webhookTimestamp: now.getTime(),
      webhookId: '', // Will be set per webhook
      organizationId: this.options.organizationId,
      data,
      updatedFrom,
    }

    // Store the event
    const eventRecord: WebhookEventRecord = {
      id: eventId,
      ...payload,
      deliveryAttempts: 0,
    }
    this.events.set(eventId, eventRecord)

    // Deliver to matching webhooks
    await this.deliverEvent(payload, type, teamId)

    return payload
  }

  /**
   * Deliver event to matching webhooks
   */
  private async deliverEvent(
    payload: WebhookDeliveryPayload,
    type: WebhookResourceType,
    teamId?: ID
  ): Promise<void> {
    for (const [id, webhook] of this.webhooks) {
      if (!webhook.enabled || webhook.archivedAt) continue

      // Check if webhook is interested in this event type
      if (!webhook.resourceTypes.includes(type)) continue

      // Check team matching
      if (teamId) {
        if (!webhook.allPublicTeams && webhook.teamId !== teamId) continue
      }

      // Create delivery payload with webhook-specific data
      const deliveryPayload: WebhookDeliveryPayload = {
        ...payload,
        url: webhook.url,
        webhookId: id,
      }

      // Deliver the event
      try {
        if (this.options.onDeliver) {
          const hydratedWebhook = await this.hydrate(webhook)
          await this.options.onDeliver(hydratedWebhook, deliveryPayload)
        }
      } catch (error) {
        // Log delivery failure but don't throw
        console.error(`Webhook delivery failed for ${webhook.url}:`, error)
      }
    }
  }

  /**
   * Retrieve a specific event
   */
  async retrieveEvent(id: ID): Promise<WebhookEventRecord> {
    const event = this.events.get(id)
    if (!event) {
      throw this.createError('NotFound', `Webhook event not found: ${id}`)
    }
    return event
  }

  /**
   * List webhook events
   */
  async listEvents(args?: PaginationArgs & {
    type?: WebhookResourceType
    action?: WebhookAction
  }): Promise<Connection<WebhookEventRecord>> {
    let all = Array.from(this.events.values())

    if (args?.type) {
      all = all.filter((e) => e.type === args.type)
    }

    if (args?.action) {
      all = all.filter((e) => e.action === args.action)
    }

    // Sort by created at descending
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return this.paginateResults(all, args)
  }

  private paginateResults<T extends { id: string }>(
    items: T[],
    args?: PaginationArgs
  ): Connection<T> {
    const first = args?.first ?? 50
    let startIndex = 0

    if (args?.after) {
      const afterIndex = items.findIndex((i) => i.id === args.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const page = items.slice(startIndex, startIndex + first)
    const hasNextPage = startIndex + first < items.length
    const hasPreviousPage = startIndex > 0

    const pageInfo: PageInfo = {
      hasNextPage,
      hasPreviousPage,
      startCursor: page[0]?.id,
      endCursor: page[page.length - 1]?.id,
    }

    return {
      nodes: page,
      pageInfo,
    }
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    return error
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.webhooks.clear()
    this.events.clear()
  }
}

// =============================================================================
// Webhook Signature Utilities
// =============================================================================

/**
 * Static webhook utilities for signature verification
 */
export const WebhookUtils = {
  /**
   * Sign a webhook payload
   */
  async sign(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(payload)
    const keyData = encoder.encode(secret)

    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ])

    const signature = await crypto.subtle.sign('HMAC', key, data)
    const bytes = new Uint8Array(signature)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  },

  /**
   * Verify a webhook signature
   */
  async verify(payload: string, signature: string, secret: string): Promise<boolean> {
    try {
      const expectedSignature = await this.sign(payload, secret)
      return expectedSignature === signature
    } catch {
      return false
    }
  },

  /**
   * Create Linear-style webhook header
   */
  async createHeader(
    payload: string,
    secret: string,
    timestamp?: number
  ): Promise<{ 'linear-signature': string; 'linear-timestamp': string }> {
    const ts = timestamp ?? Date.now()
    const signaturePayload = `${ts}.${payload}`
    const signature = await this.sign(signaturePayload, secret)

    return {
      'linear-signature': signature,
      'linear-timestamp': ts.toString(),
    }
  },

  /**
   * Verify Linear webhook with timestamp tolerance
   */
  async verifyRequest(
    payload: string,
    headers: { 'linear-signature': string; 'linear-timestamp': string },
    secret: string,
    toleranceMs: number = 300000 // 5 minutes
  ): Promise<boolean> {
    const timestamp = parseInt(headers['linear-timestamp'], 10)
    if (isNaN(timestamp)) return false

    // Check timestamp freshness
    const now = Date.now()
    if (Math.abs(now - timestamp) > toleranceMs) {
      return false
    }

    const signaturePayload = `${timestamp}.${payload}`
    return this.verify(signaturePayload, headers['linear-signature'], secret)
  },
}
