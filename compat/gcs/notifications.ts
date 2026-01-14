/**
 * @dotdo/gcs/notifications - Pub/Sub Notifications
 *
 * Google Cloud Storage compatible notification system for bucket events.
 * Integrates with Pub/Sub for event delivery.
 *
 * @example
 * ```typescript
 * import { NotificationManager, NotificationBuilder } from '@dotdo/gcs/notifications'
 *
 * // Create a notification
 * const notification = await bucket.createNotification({
 *   topic: 'projects/my-project/topics/my-topic',
 *   eventTypes: ['OBJECT_FINALIZE', 'OBJECT_DELETE'],
 *   objectNamePrefix: 'uploads/',
 * })
 *
 * // Use the builder
 * const config = new NotificationBuilder()
 *   .topic('projects/my-project/topics/my-topic')
 *   .onObjectFinalize()
 *   .onObjectDelete()
 *   .withPrefix('uploads/')
 *   .build()
 * ```
 */

import type {
  NotificationConfig,
  NotificationMetadata,
  NotificationEventType,
} from './types'

import { StorageBackend } from './backend'
import {
  BucketNotFoundError,
  NotificationNotFoundError,
  BadRequestError,
} from './errors'

// =============================================================================
// Notification Builder
// =============================================================================

/**
 * Fluent builder for notification configurations
 */
export class NotificationBuilder {
  private config: NotificationConfig = {
    topic: '',
    eventTypes: [],
  }

  /**
   * Set the Pub/Sub topic
   */
  topic(topicName: string): this {
    this.config.topic = topicName
    return this
  }

  /**
   * Subscribe to object finalization events (upload complete)
   */
  onObjectFinalize(): this {
    if (!this.config.eventTypes) this.config.eventTypes = []
    if (!this.config.eventTypes.includes('OBJECT_FINALIZE')) {
      this.config.eventTypes.push('OBJECT_FINALIZE')
    }
    return this
  }

  /**
   * Subscribe to object metadata update events
   */
  onObjectMetadataUpdate(): this {
    if (!this.config.eventTypes) this.config.eventTypes = []
    if (!this.config.eventTypes.includes('OBJECT_METADATA_UPDATE')) {
      this.config.eventTypes.push('OBJECT_METADATA_UPDATE')
    }
    return this
  }

  /**
   * Subscribe to object deletion events
   */
  onObjectDelete(): this {
    if (!this.config.eventTypes) this.config.eventTypes = []
    if (!this.config.eventTypes.includes('OBJECT_DELETE')) {
      this.config.eventTypes.push('OBJECT_DELETE')
    }
    return this
  }

  /**
   * Subscribe to object archive events
   */
  onObjectArchive(): this {
    if (!this.config.eventTypes) this.config.eventTypes = []
    if (!this.config.eventTypes.includes('OBJECT_ARCHIVE')) {
      this.config.eventTypes.push('OBJECT_ARCHIVE')
    }
    return this
  }

  /**
   * Subscribe to all events
   */
  onAllEvents(): this {
    this.config.eventTypes = [
      'OBJECT_FINALIZE',
      'OBJECT_METADATA_UPDATE',
      'OBJECT_DELETE',
      'OBJECT_ARCHIVE',
    ]
    return this
  }

  /**
   * Set event types directly
   */
  events(eventTypes: NotificationEventType[]): this {
    this.config.eventTypes = [...eventTypes]
    return this
  }

  /**
   * Filter by object name prefix
   */
  withPrefix(prefix: string): this {
    this.config.objectNamePrefix = prefix
    return this
  }

  /**
   * Add custom attributes to messages
   */
  withAttributes(attributes: Record<string, string>): this {
    this.config.customAttributes = { ...this.config.customAttributes, ...attributes }
    return this
  }

  /**
   * Set payload format
   */
  payloadFormat(format: 'JSON_API_V1' | 'NONE'): this {
    this.config.payloadFormat = format
    return this
  }

  /**
   * Use JSON payload format (default)
   */
  jsonPayload(): this {
    return this.payloadFormat('JSON_API_V1')
  }

  /**
   * Use no payload (metadata only in attributes)
   */
  noPayload(): this {
    return this.payloadFormat('NONE')
  }

  /**
   * Build the notification configuration
   */
  build(): NotificationConfig {
    if (!this.config.topic) {
      throw new BadRequestError('Topic is required')
    }
    return { ...this.config }
  }

  /**
   * Reset the builder
   */
  reset(): this {
    this.config = { topic: '', eventTypes: [] }
    return this
  }
}

// =============================================================================
// Notification Manager
// =============================================================================

/**
 * Manages notifications for a bucket
 */
export class NotificationManager {
  private bucketName: string
  private backend: StorageBackend
  private projectId?: string

  constructor(bucketName: string, backend: StorageBackend, projectId?: string) {
    this.bucketName = bucketName
    this.backend = backend
    this.projectId = projectId
  }

  /**
   * Create a new notification configuration
   */
  async create(config: NotificationConfig): Promise<NotificationMetadata> {
    // Validate bucket exists
    if (!(await this.backend.bucketExists(this.bucketName))) {
      throw new BucketNotFoundError(this.bucketName)
    }

    // Validate topic format
    if (!config.topic.startsWith('projects/')) {
      throw new BadRequestError(
        'Topic must be in the format: projects/{project}/topics/{topic}'
      )
    }

    const notificationId = `${Date.now()}`
    const notification: NotificationMetadata = {
      id: notificationId,
      topic: config.topic,
      eventTypes: config.eventTypes || [
        'OBJECT_FINALIZE',
        'OBJECT_METADATA_UPDATE',
        'OBJECT_DELETE',
        'OBJECT_ARCHIVE',
      ],
      objectNamePrefix: config.objectNamePrefix,
      customAttributes: config.customAttributes,
      payloadFormat: config.payloadFormat || 'JSON_API_V1',
      etag: crypto.randomUUID(),
      selfLink: `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/notificationConfigs/${notificationId}`,
    }

    await this.backend.createNotification(this.bucketName, notification)
    return notification
  }

  /**
   * Get a notification by ID
   */
  async get(notificationId: string): Promise<NotificationMetadata> {
    const notification = await this.backend.getNotification(this.bucketName, notificationId)
    if (!notification) {
      throw new NotificationNotFoundError(this.bucketName, notificationId)
    }
    return notification
  }

  /**
   * List all notifications for the bucket
   */
  async list(): Promise<NotificationMetadata[]> {
    if (!(await this.backend.bucketExists(this.bucketName))) {
      throw new BucketNotFoundError(this.bucketName)
    }
    return this.backend.listNotifications(this.bucketName)
  }

  /**
   * Delete a notification
   */
  async delete(notificationId: string): Promise<void> {
    const notification = await this.backend.getNotification(this.bucketName, notificationId)
    if (!notification) {
      throw new NotificationNotFoundError(this.bucketName, notificationId)
    }
    await this.backend.deleteNotification(this.bucketName, notificationId)
  }

  /**
   * Delete all notifications for the bucket
   */
  async deleteAll(): Promise<number> {
    const notifications = await this.list()
    for (const notification of notifications) {
      await this.backend.deleteNotification(this.bucketName, notification.id!)
    }
    return notifications.length
  }
}

// =============================================================================
// Notification Event Types
// =============================================================================

/**
 * Event payload for Pub/Sub notifications
 */
export interface NotificationEvent {
  /** Event type */
  kind: 'storage#object'
  /** Bucket name */
  bucket: string
  /** Object name */
  name: string
  /** Object generation */
  generation: string
  /** Content type */
  contentType?: string
  /** Object size in bytes */
  size?: string
  /** MD5 hash */
  md5Hash?: string
  /** CRC32c checksum */
  crc32c?: string
  /** ETag */
  etag?: string
  /** Time created */
  timeCreated?: string
  /** Time updated */
  updated?: string
  /** Storage class */
  storageClass?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Media link */
  mediaLink?: string
  /** Self link */
  selfLink?: string
  /** Event time */
  eventTime?: string
  /** Event type */
  eventType?: NotificationEventType
  /** Notification config ID */
  notificationConfig?: string
}

/**
 * Pub/Sub message wrapper for notification events
 */
export interface PubSubMessage {
  /** Message data (base64 encoded NotificationEvent) */
  data: string
  /** Message attributes */
  attributes: {
    /** Bucket name */
    bucketId: string
    /** Object name */
    objectId: string
    /** Object generation */
    objectGeneration: string
    /** Event type */
    eventType: NotificationEventType
    /** Event time */
    eventTime: string
    /** Notification config ID */
    notificationConfig: string
    /** Payload format */
    payloadFormat: 'JSON_API_V1' | 'NONE'
    /** Custom attributes */
    [key: string]: string
  }
  /** Message ID */
  messageId: string
  /** Publish time */
  publishTime: string
}

// =============================================================================
// Notification Emitter
// =============================================================================

/**
 * Emits notification events to registered handlers
 * Used internally to trigger notifications on storage operations
 */
export class NotificationEmitter {
  private handlers: Map<string, NotificationHandler[]> = new Map()

  /**
   * Register a handler for notifications
   */
  on(bucketName: string, handler: NotificationHandler): void {
    const handlers = this.handlers.get(bucketName) || []
    handlers.push(handler)
    this.handlers.set(bucketName, handlers)
  }

  /**
   * Remove a handler
   */
  off(bucketName: string, handler: NotificationHandler): void {
    const handlers = this.handlers.get(bucketName) || []
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
      this.handlers.set(bucketName, handlers)
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  async emit(
    bucketName: string,
    eventType: NotificationEventType,
    event: NotificationEvent,
    notifications: NotificationMetadata[]
  ): Promise<void> {
    // Check which notifications match this event
    const matchingNotifications = notifications.filter((n) => {
      // Check event type
      if (n.eventTypes && n.eventTypes.length > 0) {
        if (!n.eventTypes.includes(eventType)) {
          return false
        }
      }

      // Check prefix filter
      if (n.objectNamePrefix) {
        if (!event.name.startsWith(n.objectNamePrefix)) {
          return false
        }
      }

      return true
    })

    if (matchingNotifications.length === 0) {
      return
    }

    // Call handlers
    const handlers = this.handlers.get(bucketName) || []
    for (const handler of handlers) {
      for (const notification of matchingNotifications) {
        try {
          await handler(eventType, event, notification)
        } catch (error) {
          console.error('Notification handler error:', error)
        }
      }
    }
  }

  /**
   * Clear all handlers for a bucket
   */
  clear(bucketName?: string): void {
    if (bucketName) {
      this.handlers.delete(bucketName)
    } else {
      this.handlers.clear()
    }
  }
}

export type NotificationHandler = (
  eventType: NotificationEventType,
  event: NotificationEvent,
  notification: NotificationMetadata
) => void | Promise<void>

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a notification event from file metadata
 */
export function createNotificationEvent(
  bucketName: string,
  objectName: string,
  eventType: NotificationEventType,
  metadata: {
    generation?: string
    contentType?: string
    size?: string
    md5Hash?: string
    crc32c?: string
    etag?: string
    timeCreated?: string
    updated?: string
    storageClass?: string
    metadata?: Record<string, string>
  }
): NotificationEvent {
  return {
    kind: 'storage#object',
    bucket: bucketName,
    name: objectName,
    generation: metadata.generation || String(Date.now()),
    contentType: metadata.contentType,
    size: metadata.size,
    md5Hash: metadata.md5Hash,
    crc32c: metadata.crc32c,
    etag: metadata.etag,
    timeCreated: metadata.timeCreated,
    updated: metadata.updated,
    storageClass: metadata.storageClass,
    metadata: metadata.metadata,
    mediaLink: `https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${encodeURIComponent(objectName)}?alt=media`,
    selfLink: `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(objectName)}`,
    eventTime: new Date().toISOString(),
    eventType,
  }
}

/**
 * Create a Pub/Sub message from a notification event
 */
export function createPubSubMessage(
  event: NotificationEvent,
  notification: NotificationMetadata
): PubSubMessage {
  const attributes: PubSubMessage['attributes'] = {
    bucketId: event.bucket,
    objectId: event.name,
    objectGeneration: event.generation,
    eventType: event.eventType!,
    eventTime: event.eventTime || new Date().toISOString(),
    notificationConfig: notification.id || '',
    payloadFormat: notification.payloadFormat || 'JSON_API_V1',
    ...(notification.customAttributes || {}),
  }

  const data = notification.payloadFormat === 'NONE'
    ? ''
    : btoa(JSON.stringify(event))

  return {
    data,
    attributes,
    messageId: crypto.randomUUID(),
    publishTime: new Date().toISOString(),
  }
}

/**
 * Parse a Pub/Sub message to extract the notification event
 */
export function parsePubSubMessage(message: PubSubMessage): NotificationEvent | null {
  if (!message.data || message.attributes.payloadFormat === 'NONE') {
    // Create minimal event from attributes
    return {
      kind: 'storage#object',
      bucket: message.attributes.bucketId,
      name: message.attributes.objectId,
      generation: message.attributes.objectGeneration,
      eventType: message.attributes.eventType,
      eventTime: message.attributes.eventTime,
    }
  }

  try {
    return JSON.parse(atob(message.data))
  } catch {
    return null
  }
}

// =============================================================================
// Default Emitter Instance
// =============================================================================

/**
 * Global notification emitter instance
 */
export const globalNotificationEmitter = new NotificationEmitter()
