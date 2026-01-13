/**
 * @module lib/executors/CascadeExecutorWithNotifications
 *
 * CascadeExecutorWithNotifications - Extends CascadeExecutor with human notification support.
 *
 * This executor adds notification channel integration for human escalation,
 * supporting multiple notification channels (Slack, Email, SMS) with priority.
 */

import {
  CascadeExecutor,
  CascadeExhaustedError,
  CascadeTimeoutError,
  CascadeSkippedError,
  type CascadeResult,
  type CascadeOptions,
  type CascadeExecutorOptions,
  type FunctionType,
} from './CascadeExecutor'

export interface NotificationChannel {
  type: 'slack' | 'email' | 'sms' | 'discord' | 'webhook'
  target: string
  priority?: 'normal' | 'high' | 'urgent'
}

export interface NotificationConfig {
  escalationChannel?: string
  escalationTarget?: string
  escalationChannels?: NotificationChannel[]
}

export interface NotificationPayload {
  channel: string
  target: string
  message?: string
  priority?: string
  context?: Record<string, unknown>
}

export interface NotificationsService {
  send: (payload: NotificationPayload) => Promise<{ success: boolean }>
}

export interface CascadeExecutorWithNotificationsOptions extends CascadeExecutorOptions {
  notificationConfig?: NotificationConfig
}

/**
 * CascadeExecutorWithNotifications - Cascade executor with human notification support
 */
export class CascadeExecutorWithNotifications extends CascadeExecutor {
  private notificationConfig: NotificationConfig

  constructor(options: CascadeExecutorWithNotificationsOptions) {
    super(options)
    this.notificationConfig = options.notificationConfig || {}
  }

  /**
   * Execute cascade with notification support for human escalation
   */
  async execute<TInput = unknown, TOutput = unknown>(
    options: CascadeOptions<TInput>
  ): Promise<CascadeResult<TOutput>> {
    // Track original human handler
    const originalHumanHandler = options.handlers.human

    // Wrap human handler to send notifications
    if (originalHumanHandler) {
      options.handlers.human = async (input, context) => {
        // Send notifications before calling human handler
        await this.sendEscalationNotifications(input, context)

        // Call original human handler
        return originalHumanHandler(input, context)
      }
    }

    // Execute the cascade
    return super.execute<TInput, TOutput>(options)
  }

  /**
   * Send escalation notifications to configured channels
   */
  private async sendEscalationNotifications(
    input: unknown,
    context: Record<string, unknown>
  ): Promise<void> {
    const notifications = this.getNotificationsService()
    if (!notifications) return

    const channels = this.getNotificationChannels()
    if (channels.length === 0) return

    // Send to all configured channels
    await Promise.all(
      channels.map(async (channel) => {
        try {
          await notifications.send({
            channel: channel.type,
            target: channel.target,
            priority: channel.priority,
            message: `Cascade escalation to human required`,
            context: {
              input,
              ...context,
            },
          })
        } catch (error) {
          // Log but don't fail on notification errors
          console.warn(`Failed to send notification to ${channel.type}:${channel.target}`, error)
        }
      })
    )
  }

  /**
   * Get the notifications service from env
   */
  private getNotificationsService(): NotificationsService | undefined {
    return (this as any).env?.NOTIFICATIONS as NotificationsService | undefined
  }

  /**
   * Get notification channels from config
   */
  private getNotificationChannels(): NotificationChannel[] {
    const { escalationChannel, escalationTarget, escalationChannels } = this.notificationConfig

    // If explicit channels array is provided, use it
    if (escalationChannels && escalationChannels.length > 0) {
      return escalationChannels
    }

    // Otherwise, create single channel from simple config
    if (escalationChannel && escalationTarget) {
      return [
        {
          type: escalationChannel as NotificationChannel['type'],
          target: escalationTarget,
          priority: 'normal',
        },
      ]
    }

    return []
  }
}

// Re-export error classes and types from base module
export {
  CascadeExhaustedError,
  CascadeTimeoutError,
  CascadeSkippedError,
  type CascadeResult,
  type CascadeOptions,
  type FunctionType,
}

export default CascadeExecutorWithNotifications
