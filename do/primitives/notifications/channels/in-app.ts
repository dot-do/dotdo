/**
 * In-App Channel Adapter
 *
 * Provides in-app notification delivery:
 * - Real-time notifications via WebSocket/SSE
 * - Notification inbox storage
 * - Read/unread tracking
 * - Badge count management
 *
 * @example
 * ```typescript
 * import { createInAppAdapter } from 'db/primitives/notifications/channels/in-app'
 *
 * const inAppAdapter = createInAppAdapter({
 *   onNotification: async (userId, notification) => {
 *     // Push to real-time channel (e.g., WebSocket)
 *     websocketServer.sendToUser(userId, notification)
 *   },
 *   storage: notificationStorage
 * })
 *
 * router.registerChannel(inAppAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/in-app
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export interface InAppConfig {
  /** Handler called when notification is sent */
  onNotification?: (userId: string, notification: InAppNotification) => Promise<void>
  /** Storage for persisting notifications */
  storage?: InAppStorage
  /** Maximum notifications to store per user */
  maxNotificationsPerUser?: number
  /** Auto-expire notifications after this many days */
  expirationDays?: number
  // Custom send function (for testing or custom providers)
  customSend?: (payload: InAppPayload) => Promise<{ messageId: string }>
}

export interface InAppNotification {
  id: string
  userId: string
  title?: string
  body: string
  category?: string
  priority?: 'low' | 'normal' | 'high' | 'critical'
  data?: Record<string, unknown>
  read: boolean
  createdAt: Date
  expiresAt?: Date
}

export interface InAppPayload {
  userId: string
  notification: InAppNotification
}

export interface InAppStorage {
  save(notification: InAppNotification): Promise<void>
  getByUser(userId: string, options?: { limit?: number; unreadOnly?: boolean }): Promise<InAppNotification[]>
  markRead(notificationId: string): Promise<void>
  markAllRead(userId: string): Promise<void>
  delete(notificationId: string): Promise<void>
  deleteExpired(): Promise<number>
  getUnreadCount(userId: string): Promise<number>
}

// =============================================================================
// In-App Adapter Implementation
// =============================================================================

export function createInAppAdapter(config: InAppConfig): ChannelAdapter {
  return {
    type: 'in-app',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      const userId = notification.userId

      if (!userId) {
        const error = new Error('User ID is required for in-app notifications')
        ;(error as any).retryable = false
        throw error
      }

      const notificationId = `inapp_${Date.now()}_${Math.random().toString(36).slice(2)}`

      const inAppNotification: InAppNotification = {
        id: notificationId,
        userId,
        title: notification.subject,
        body: notification.body,
        category: notification.category,
        priority: notification.priority,
        data: notification.metadata,
        read: false,
        createdAt: new Date(),
        expiresAt: config.expirationDays
          ? new Date(Date.now() + config.expirationDays * 24 * 60 * 60 * 1000)
          : undefined,
      }

      const payload: InAppPayload = {
        userId,
        notification: inAppNotification,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      // Store notification
      if (config.storage) {
        await config.storage.save(inAppNotification)

        // Enforce max notifications limit
        if (config.maxNotificationsPerUser) {
          const existing = await config.storage.getByUser(userId)
          if (existing.length > config.maxNotificationsPerUser) {
            // Delete oldest notifications
            const toDelete = existing
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
              .slice(0, existing.length - config.maxNotificationsPerUser)

            for (const n of toDelete) {
              await config.storage.delete(n.id)
            }
          }
        }
      }

      // Send real-time notification
      if (config.onNotification) {
        try {
          await config.onNotification(userId, inAppNotification)
        } catch (error) {
          // Real-time delivery failure is not fatal
          console.warn('Failed to send real-time in-app notification:', error)
        }
      }

      return { messageId: notificationId }
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      // In-app notifications only need a user ID from the notification payload
      return true
    },
  }
}

// =============================================================================
// In-Memory Storage Implementation
// =============================================================================

export class InMemoryInAppStorage implements InAppStorage {
  private notifications = new Map<string, InAppNotification>()
  private userIndex = new Map<string, Set<string>>()

  async save(notification: InAppNotification): Promise<void> {
    this.notifications.set(notification.id, notification)

    let userNotifications = this.userIndex.get(notification.userId)
    if (!userNotifications) {
      userNotifications = new Set()
      this.userIndex.set(notification.userId, userNotifications)
    }
    userNotifications.add(notification.id)
  }

  async getByUser(
    userId: string,
    options?: { limit?: number; unreadOnly?: boolean }
  ): Promise<InAppNotification[]> {
    const userNotificationIds = this.userIndex.get(userId) ?? new Set()
    let notifications: InAppNotification[] = []

    for (const id of userNotificationIds) {
      const notification = this.notifications.get(id)
      if (notification) {
        // Skip expired notifications
        if (notification.expiresAt && notification.expiresAt < new Date()) {
          continue
        }

        // Filter unread only
        if (options?.unreadOnly && notification.read) {
          continue
        }

        notifications.push(notification)
      }
    }

    // Sort by created date (newest first)
    notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Apply limit
    if (options?.limit) {
      notifications = notifications.slice(0, options.limit)
    }

    return notifications
  }

  async markRead(notificationId: string): Promise<void> {
    const notification = this.notifications.get(notificationId)
    if (notification) {
      notification.read = true
    }
  }

  async markAllRead(userId: string): Promise<void> {
    const userNotificationIds = this.userIndex.get(userId) ?? new Set()

    for (const id of userNotificationIds) {
      const notification = this.notifications.get(id)
      if (notification) {
        notification.read = true
      }
    }
  }

  async delete(notificationId: string): Promise<void> {
    const notification = this.notifications.get(notificationId)
    if (notification) {
      this.notifications.delete(notificationId)
      this.userIndex.get(notification.userId)?.delete(notificationId)
    }
  }

  async deleteExpired(): Promise<number> {
    const now = new Date()
    let deletedCount = 0

    for (const [id, notification] of this.notifications) {
      if (notification.expiresAt && notification.expiresAt < now) {
        await this.delete(id)
        deletedCount++
      }
    }

    return deletedCount
  }

  async getUnreadCount(userId: string): Promise<number> {
    const notifications = await this.getByUser(userId, { unreadOnly: true })
    return notifications.length
  }

  // Helper method for clearing all data (useful for testing)
  clear(): void {
    this.notifications.clear()
    this.userIndex.clear()
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
