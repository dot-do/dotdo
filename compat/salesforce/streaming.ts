/**
 * @dotdo/salesforce - Streaming API Compatibility Layer
 *
 * Simulates Salesforce Streaming API for Platform Events and Change Data Capture (CDC).
 * Provides publish/subscribe patterns compatible with Salesforce's streaming infrastructure.
 *
 * @example
 * ```typescript
 * import { StreamingClient, PlatformEvent, ChangeEvent } from '@dotdo/salesforce'
 *
 * // Platform Events
 * const client = new StreamingClient(connection)
 * const subscription = client.subscribe('/event/Order_Event__e', (message) => {
 *   console.log('Order event received:', message.payload)
 * })
 *
 * // Publish Platform Event
 * await connection.sobject('Order_Event__e').create({
 *   Order_Id__c: 'ORD-001',
 *   Status__c: 'Confirmed'
 * })
 *
 * // Change Data Capture
 * const cdcSub = client.subscribe('/data/AccountChangeEvent', (change) => {
 *   console.log('Account changed:', change.ChangeEventHeader)
 * })
 * ```
 *
 * @module @dotdo/salesforce/streaming
 */

import { EventEmitter } from 'events'
import type { SObject } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Streaming API channel types
 */
export type ChannelType = 'topic' | 'event' | 'data' | 'generic'

/**
 * Platform Event message structure
 */
export interface PlatformEventMessage<T extends Record<string, unknown> = Record<string, unknown>> {
  /** The event payload data */
  payload: T
  /** Replay ID for message ordering */
  replayId: number
  /** ISO timestamp when the event was created */
  createdDate: string
  /** Schema fingerprint for versioning */
  schema: string
  /** Event UUID */
  eventUuid: string
}

/**
 * CDC Change Event Header
 * @see https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_event_fields_header.htm
 */
export interface ChangeEventHeader {
  /** The entity name (e.g., 'Account', 'Contact__c') */
  entityName: string
  /** Record IDs affected by the change */
  recordIds: string[]
  /** Type of change: CREATE, UPDATE, DELETE, UNDELETE, GAP_CREATE, GAP_UPDATE, GAP_DELETE, GAP_UNDELETE, GAP_OVERFLOW */
  changeType: ChangeType
  /** Changed fields for UPDATE operations */
  changedFields: string[]
  /** Unique change origin identifier */
  changeOrigin: string
  /** Transaction key for grouping related changes */
  transactionKey: string
  /** Sequence number within transaction */
  sequenceNumber: number
  /** Commit timestamp */
  commitTimestamp: number
  /** Commit user ID */
  commitUser: string
  /** Commit number for ordering */
  commitNumber: number
  /** Null bit map for null field tracking */
  nulledFields?: string[]
  /** Diff fields for compound fields */
  diffFields?: string[]
}

/**
 * CDC Change types
 */
export type ChangeType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'UNDELETE'
  | 'GAP_CREATE'
  | 'GAP_UPDATE'
  | 'GAP_DELETE'
  | 'GAP_UNDELETE'
  | 'GAP_OVERFLOW'

/**
 * CDC Change Event structure
 */
export interface ChangeEvent<T extends SObject = SObject> {
  /** Change event header with metadata */
  ChangeEventHeader: ChangeEventHeader
  /** The record data (for CREATE, UPDATE, UNDELETE) */
  payload?: Partial<T>
  /** Replay ID for message ordering */
  replayId: number
}

/**
 * Streaming subscription
 */
export interface StreamingSubscription {
  /** Unique subscription ID */
  id: string
  /** Channel being subscribed to */
  channel: string
  /** Whether the subscription is active */
  active: boolean
  /** Unsubscribe from the channel */
  unsubscribe(): void
  /** Replay ID to start from (-1 = tip, -2 = all available) */
  replayFrom: number
}

/**
 * Streaming message handler
 */
export type StreamingMessageHandler<T = unknown> = (message: T) => void | Promise<void>

/**
 * Replay options for subscriptions
 */
export type ReplayOption = number | 'tip' | 'earliest'

/**
 * Streaming client options
 */
export interface StreamingClientOptions {
  /** Connection timeout in milliseconds */
  timeout?: number
  /** Automatic reconnection on disconnect */
  autoReconnect?: boolean
  /** Reconnection delay in milliseconds */
  reconnectDelay?: number
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Replay ID or option (-1 = tip, -2 = earliest) */
  replayFrom?: ReplayOption
  /** Filter expressions for the subscription */
  filter?: Record<string, unknown>
}

// =============================================================================
// StreamingClient Class
// =============================================================================

/**
 * Client for Salesforce Streaming API
 * Provides publish/subscribe for Platform Events and CDC
 */
export class StreamingClient extends EventEmitter {
  private subscriptions: Map<string, InternalSubscription> = new Map()
  private connected: boolean = false
  private replayIdCounter: number = 1000
  private readonly options: Required<StreamingClientOptions>

  constructor(options: StreamingClientOptions = {}) {
    super()
    this.options = {
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
    }
  }

  /**
   * Connect to the streaming endpoint
   */
  async connect(): Promise<void> {
    this.connected = true
    this.emit('connect')
  }

  /**
   * Disconnect from the streaming endpoint
   */
  async disconnect(): Promise<void> {
    // Unsubscribe from all channels
    for (const sub of this.subscriptions.values()) {
      sub.active = false
    }
    this.subscriptions.clear()
    this.connected = false
    this.emit('disconnect')
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Subscribe to a streaming channel
   */
  subscribe<T = unknown>(
    channel: string,
    handler: StreamingMessageHandler<T>,
    options: SubscriptionOptions = {}
  ): StreamingSubscription {
    const replayFrom = this.resolveReplayOption(options.replayFrom)

    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

    const internalSub: InternalSubscription = {
      id: subscriptionId,
      channel,
      handler: handler as StreamingMessageHandler,
      active: true,
      replayFrom,
      filter: options.filter,
    }

    this.subscriptions.set(subscriptionId, internalSub)

    const subscription: StreamingSubscription = {
      id: subscriptionId,
      channel,
      active: true,
      replayFrom,
      unsubscribe: () => {
        this.unsubscribe(subscriptionId)
      },
    }

    this.emit('subscribe', { channel, replayFrom })

    return subscription
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) {
      return false
    }

    sub.active = false
    this.subscriptions.delete(subscriptionId)
    this.emit('unsubscribe', { channel: sub.channel, subscriptionId })
    return true
  }

  /**
   * Publish a Platform Event
   */
  async publish<T extends Record<string, unknown>>(eventType: string, payload: T): Promise<PublishResult> {
    const channel = this.getEventChannel(eventType)
    const replayId = this.nextReplayId()

    const message: PlatformEventMessage<T> = {
      payload,
      replayId,
      createdDate: new Date().toISOString(),
      schema: this.generateSchema(eventType),
      eventUuid: this.generateUuid(),
    }

    // Deliver to subscribers
    await this.deliverToSubscribers(channel, message)

    return {
      success: true,
      id: message.eventUuid,
      replayId,
    }
  }

  /**
   * Emit a Change Data Capture event
   */
  async emitChange<T extends SObject>(
    entityName: string,
    changeType: ChangeType,
    recordIds: string[],
    payload?: Partial<T>,
    changedFields: string[] = []
  ): Promise<PublishResult> {
    const channel = this.getCDCChannel(entityName)
    const replayId = this.nextReplayId()

    const changeEvent: ChangeEvent<T> = {
      ChangeEventHeader: {
        entityName,
        recordIds,
        changeType,
        changedFields,
        changeOrigin: 'com/salesforce/api/soap/59.0',
        transactionKey: this.generateUuid(),
        sequenceNumber: 1,
        commitTimestamp: Date.now(),
        commitUser: '005xx000001SomeUser',
        commitNumber: replayId,
      },
      payload,
      replayId,
    }

    // Deliver to subscribers
    await this.deliverToSubscribers(channel, changeEvent)

    return {
      success: true,
      id: changeEvent.ChangeEventHeader.transactionKey,
      replayId,
    }
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): StreamingSubscription[] {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      id: sub.id,
      channel: sub.channel,
      active: sub.active,
      replayFrom: sub.replayFrom,
      unsubscribe: () => this.unsubscribe(sub.id),
    }))
  }

  /**
   * Parse a channel path to determine its type and entity
   */
  parseChannel(channel: string): ChannelInfo {
    const parts = channel.split('/')

    if (channel.startsWith('/event/')) {
      return {
        type: 'event',
        entity: parts.slice(2).join('/'),
        channel,
      }
    }

    if (channel.startsWith('/data/')) {
      const entity = parts[2].replace('ChangeEvent', '')
      return {
        type: 'data',
        entity,
        channel,
      }
    }

    if (channel.startsWith('/topic/')) {
      return {
        type: 'topic',
        entity: parts.slice(2).join('/'),
        channel,
      }
    }

    return {
      type: 'generic',
      entity: channel,
      channel,
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private resolveReplayOption(option?: ReplayOption): number {
    if (option === undefined || option === 'tip') {
      return -1
    }
    if (option === 'earliest') {
      return -2
    }
    return option
  }

  private getEventChannel(eventType: string): string {
    if (eventType.startsWith('/event/')) {
      return eventType
    }
    return `/event/${eventType}`
  }

  private getCDCChannel(entityName: string): string {
    if (entityName.startsWith('/data/')) {
      return entityName
    }
    return `/data/${entityName}ChangeEvent`
  }

  private nextReplayId(): number {
    return ++this.replayIdCounter
  }

  private generateSchema(eventType: string): string {
    return `${eventType}:v1:${Date.now().toString(36)}`
  }

  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  private async deliverToSubscribers(channel: string, message: unknown): Promise<void> {
    const promises: Promise<void>[] = []

    for (const sub of this.subscriptions.values()) {
      if (!sub.active) continue

      // Check channel match (exact or wildcard)
      if (this.channelMatches(sub.channel, channel)) {
        // Apply filters if present
        if (sub.filter && !this.matchesFilter(message, sub.filter)) {
          continue
        }

        const promise = Promise.resolve(sub.handler(message)).catch((error) => {
          this.emit('error', { subscription: sub.id, error })
        })
        promises.push(promise)
      }
    }

    await Promise.all(promises)
  }

  private channelMatches(pattern: string, channel: string): boolean {
    // Exact match
    if (pattern === channel) {
      return true
    }

    // Wildcard matching for /data/*
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1)
      return channel.startsWith(prefix)
    }

    return false
  }

  private matchesFilter(message: unknown, filter: Record<string, unknown>): boolean {
    if (typeof message !== 'object' || message === null) {
      return true
    }

    const msg = message as Record<string, unknown>

    for (const [key, value] of Object.entries(filter)) {
      if (msg[key] !== value) {
        // Check nested payload
        if ('payload' in msg && typeof msg.payload === 'object' && msg.payload !== null) {
          const payload = msg.payload as Record<string, unknown>
          if (payload[key] !== value) {
            return false
          }
        } else {
          return false
        }
      }
    }

    return true
  }
}

// =============================================================================
// Internal Types
// =============================================================================

interface InternalSubscription {
  id: string
  channel: string
  handler: StreamingMessageHandler
  active: boolean
  replayFrom: number
  filter?: Record<string, unknown>
}

interface ChannelInfo {
  type: ChannelType
  entity: string
  channel: string
}

interface PublishResult {
  success: boolean
  id: string
  replayId: number
}

// =============================================================================
// CDC Helper Functions
// =============================================================================

/**
 * Create a Change Event from a record operation
 */
export function createChangeEvent<T extends SObject>(
  entityName: string,
  operation: 'insert' | 'update' | 'delete' | 'undelete',
  records: T[],
  oldRecords?: T[]
): ChangeEvent<T>[] {
  const changeTypeMap: Record<string, ChangeType> = {
    insert: 'CREATE',
    update: 'UPDATE',
    delete: 'DELETE',
    undelete: 'UNDELETE',
  }

  return records.map((record, index) => {
    const changedFields: string[] = []

    // Calculate changed fields for updates
    if (operation === 'update' && oldRecords?.[index]) {
      const oldRecord = oldRecords[index]
      for (const key of Object.keys(record)) {
        if (key !== 'Id' && key !== 'attributes' && record[key] !== oldRecord[key]) {
          changedFields.push(key)
        }
      }
    }

    return {
      ChangeEventHeader: {
        entityName,
        recordIds: [record.Id!],
        changeType: changeTypeMap[operation],
        changedFields,
        changeOrigin: 'com/salesforce/api/soap/59.0',
        transactionKey: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        sequenceNumber: index + 1,
        commitTimestamp: Date.now(),
        commitUser: '005xx000001SomeUser',
        commitNumber: Date.now(),
      },
      payload: operation !== 'delete' ? record : undefined,
      replayId: Date.now() + index,
    }
  })
}

/**
 * Create a Platform Event message
 */
export function createPlatformEvent<T extends Record<string, unknown>>(
  eventType: string,
  payload: T
): PlatformEventMessage<T> {
  return {
    payload,
    replayId: Date.now(),
    createdDate: new Date().toISOString(),
    schema: `${eventType}:v1:${Date.now().toString(36)}`,
    eventUuid: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
  }
}
