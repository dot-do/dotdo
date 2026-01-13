/**
 * Tamper Alert Notifier - Integration between tamper detection and notification system
 *
 * Bridges the audit log tamper detection system with the human notification channels,
 * enabling multi-channel alerting when tampering or anomalies are detected:
 * - **Slack/Discord/Email/SMS**: Route critical alerts to security team
 * - **Priority mapping**: Severity levels map to notification priorities
 * - **Customizable routing**: Configure which channels receive which alert types
 * - **Alert batching**: Group rapid-fire alerts to prevent notification fatigue
 *
 * @module db/primitives/audit-log/tamper-alert-notifier
 * @see dotdo-p2ulg - [REFACTOR] Tamper detection alerts
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import {
  type TamperAlert,
  type AlertSeverity,
  type AlertHandler,
  type TamperType,
} from './tamper-detection'
import {
  HumanNotificationChannel,
  type HumanNotificationChannelConfig,
  type NotificationPriority,
  type HumanChannelType,
  type DeliveryResult,
  type NotificationRecipient,
} from '../../../lib/humans/notification-channel'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Notification channel configuration for tamper alerts
 */
export interface NotificationChannelConfig {
  /** Channel type */
  type: HumanChannelType
  /** Channel-specific configuration */
  config: Record<string, unknown>
}

/**
 * Routing rules for tamper alerts
 */
export interface TamperAlertRouting {
  /** Channels for critical alerts (hash chain broken, deletion detected) */
  critical?: HumanChannelType[]
  /** Channels for high severity alerts */
  high?: HumanChannelType[]
  /** Channels for medium severity alerts */
  medium?: HumanChannelType[]
  /** Channels for low severity alerts */
  low?: HumanChannelType[]
  /** Channels for info level alerts */
  info?: HumanChannelType[]
}

/**
 * Recipients for tamper alerts (security team)
 */
export interface SecurityTeamRecipients {
  /** Default recipient for all alerts */
  default: NotificationRecipient
  /** Override recipients by severity */
  bySeverity?: Partial<Record<AlertSeverity, NotificationRecipient>>
  /** Override recipients by tamper type */
  byType?: Partial<Record<TamperType, NotificationRecipient>>
}

/**
 * Options for configuring the tamper alert notifier
 */
export interface TamperAlertNotifierOptions {
  /** Notification channel configuration */
  channels: HumanNotificationChannelConfig
  /** Security team recipients */
  recipients: SecurityTeamRecipients
  /** Base URL for links in notifications */
  baseUrl?: string
  /** Custom routing rules (default: all channels for critical) */
  routing?: TamperAlertRouting
  /** Enable alert batching to prevent notification fatigue */
  enableBatching?: boolean
  /** Batching window in milliseconds (default: 5000) */
  batchWindowMs?: number
  /** Maximum alerts per batch (default: 10) */
  maxBatchSize?: number
  /** Custom subject line prefix */
  subjectPrefix?: string
}

/**
 * Result of sending a tamper alert notification
 */
export interface AlertNotificationResult {
  /** Whether the notification was sent successfully */
  success: boolean
  /** Alert that was sent */
  alert: TamperAlert
  /** Delivery result from notification channel */
  deliveryResult?: DeliveryResult
  /** Error message if failed */
  error?: string
  /** Whether the alert was batched (deferred) */
  batched?: boolean
}

/**
 * Batch of alerts waiting to be sent
 */
interface AlertBatch {
  alerts: TamperAlert[]
  timer: ReturnType<typeof setTimeout> | null
  startedAt: number
}

/**
 * TamperAlertNotifier - Sends tamper detection alerts to notification channels
 */
export interface TamperAlertNotifier {
  /**
   * Create an alert handler that can be registered with TamperDetector
   */
  createHandler(): AlertHandler

  /**
   * Create handlers for each severity level
   */
  createHandlersBySeverity(): Record<AlertSeverity, AlertHandler>

  /**
   * Send a single tamper alert immediately
   */
  sendAlert(alert: TamperAlert): Promise<AlertNotificationResult>

  /**
   * Send multiple alerts as a batch
   */
  sendBatch(alerts: TamperAlert[]): Promise<AlertNotificationResult[]>

  /**
   * Flush any pending batched alerts immediately
   */
  flushBatch(): Promise<AlertNotificationResult[]>

  /**
   * Get count of pending batched alerts
   */
  getPendingCount(): number

  /**
   * Dispose of the notifier and flush pending alerts
   */
  dispose(): Promise<void>
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_ROUTING: TamperAlertRouting = {
  critical: ['slack', 'email', 'sms'],
  high: ['slack', 'email'],
  medium: ['slack', 'email'],
  low: ['email'],
  info: ['email'],
}

const DEFAULT_BATCH_WINDOW_MS = 5000
const DEFAULT_MAX_BATCH_SIZE = 10
const DEFAULT_SUBJECT_PREFIX = '[Security Alert]'

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Map alert severity to notification priority
 */
export function getSeverityPriority(severity: AlertSeverity): NotificationPriority {
  const mapping: Record<AlertSeverity, NotificationPriority> = {
    critical: 'urgent',
    high: 'high',
    medium: 'normal',
    low: 'low',
    info: 'low',
  }
  return mapping[severity]
}

/**
 * Get human-readable tamper type description
 */
function getTamperTypeDescription(type: TamperType): string {
  const descriptions: Record<TamperType, string> = {
    hash_chain_broken: 'Hash chain integrity broken',
    hash_mismatch: 'Entry hash mismatch detected',
    index_gap: 'Sequential index gap detected',
    index_duplicate: 'Duplicate index detected',
    timestamp_anomaly: 'Timestamp anomaly detected',
    timestamp_future: 'Future timestamp detected',
    actor_anomaly: 'Suspicious actor pattern detected',
    rate_anomaly: 'Unusual activity rate detected',
    deletion_detected: 'Entry deletion detected',
    modification_detected: 'Entry modification detected',
  }
  return descriptions[type] || type
}

/**
 * Build notification payload from a tamper alert
 */
export function buildTamperNotificationPayload(
  alert: TamperAlert,
  options?: {
    subjectPrefix?: string
    baseUrl?: string
  }
): {
  subject: string
  message: string
  metadata: Record<string, string>
} {
  const prefix = options?.subjectPrefix ?? DEFAULT_SUBJECT_PREFIX
  const typeDescription = getTamperTypeDescription(alert.type)

  const subject = `${prefix} ${typeDescription}`

  const messageParts = [
    `**Alert Type:** ${typeDescription}`,
    `**Severity:** ${alert.severity.toUpperCase()}`,
    `**Message:** ${alert.message}`,
  ]

  if (alert.index !== undefined) {
    messageParts.push(`**Entry Index:** ${alert.index}`)
  }

  if (alert.entryId) {
    messageParts.push(`**Entry ID:** ${alert.entryId}`)
  }

  if (alert.expected && alert.actual) {
    messageParts.push(`**Expected:** ${alert.expected}`)
    messageParts.push(`**Actual:** ${alert.actual}`)
  }

  messageParts.push(`**Detected At:** ${new Date(alert.detectedAt).toISOString()}`)
  messageParts.push(`**Alert ID:** ${alert.id}`)

  const metadata: Record<string, string> = {
    alertId: alert.id,
    alertType: alert.type,
    severity: alert.severity,
    detectedAt: new Date(alert.detectedAt).toISOString(),
  }

  if (alert.index !== undefined) {
    metadata.entryIndex = String(alert.index)
  }

  if (alert.entryId) {
    metadata.entryId = alert.entryId
  }

  return {
    subject,
    message: messageParts.join('\n'),
    metadata,
  }
}

/**
 * Build batch notification payload from multiple alerts
 */
function buildBatchNotificationPayload(
  alerts: TamperAlert[],
  options?: {
    subjectPrefix?: string
    baseUrl?: string
  }
): {
  subject: string
  message: string
  metadata: Record<string, string>
} {
  const prefix = options?.subjectPrefix ?? DEFAULT_SUBJECT_PREFIX
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length
  const highCount = alerts.filter((a) => a.severity === 'high').length

  let severityLabel = 'Multiple'
  if (criticalCount > 0) {
    severityLabel = 'CRITICAL'
  } else if (highCount > 0) {
    severityLabel = 'HIGH'
  }

  const subject = `${prefix} ${severityLabel} - ${alerts.length} tamper alerts detected`

  const messageParts = [
    `**${alerts.length} Tamper Alerts Detected**`,
    '',
    `**Critical:** ${criticalCount}`,
    `**High:** ${highCount}`,
    `**Medium:** ${alerts.filter((a) => a.severity === 'medium').length}`,
    `**Low:** ${alerts.filter((a) => a.severity === 'low').length}`,
    '',
    '**Alert Summary:**',
  ]

  // Add summary of each alert
  for (const alert of alerts.slice(0, 5)) {
    messageParts.push(`- [${alert.severity.toUpperCase()}] ${getTamperTypeDescription(alert.type)}: ${alert.message}`)
  }

  if (alerts.length > 5) {
    messageParts.push(`- ... and ${alerts.length - 5} more alerts`)
  }

  const metadata: Record<string, string> = {
    alertCount: String(alerts.length),
    criticalCount: String(criticalCount),
    highCount: String(highCount),
    firstAlertId: alerts[0]?.id ?? '',
    batchTime: new Date().toISOString(),
  }

  return {
    subject,
    message: messageParts.join('\n'),
    metadata,
  }
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Internal implementation of TamperAlertNotifier
 */
class TamperAlertNotifierImpl implements TamperAlertNotifier {
  private readonly notificationChannel: HumanNotificationChannel
  private readonly recipients: SecurityTeamRecipients
  private readonly routing: TamperAlertRouting
  private readonly enableBatching: boolean
  private readonly batchWindowMs: number
  private readonly maxBatchSize: number
  private readonly subjectPrefix: string
  private readonly baseUrl?: string

  private batch: AlertBatch = {
    alerts: [],
    timer: null,
    startedAt: 0,
  }

  constructor(options: TamperAlertNotifierOptions) {
    this.notificationChannel = new HumanNotificationChannel(options.channels)
    this.recipients = options.recipients
    this.routing = options.routing ?? DEFAULT_ROUTING
    this.enableBatching = options.enableBatching ?? false
    this.batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.subjectPrefix = options.subjectPrefix ?? DEFAULT_SUBJECT_PREFIX
    this.baseUrl = options.baseUrl
  }

  /**
   * Create a single alert handler for all severities
   */
  createHandler(): AlertHandler {
    return async (alert: TamperAlert) => {
      await this.handleAlert(alert)
    }
  }

  /**
   * Create handlers for each severity level
   */
  createHandlersBySeverity(): Record<AlertSeverity, AlertHandler> {
    const handler = this.createHandler()
    return {
      critical: handler,
      high: handler,
      medium: handler,
      low: handler,
      info: handler,
    }
  }

  /**
   * Send a single alert immediately
   */
  async sendAlert(alert: TamperAlert): Promise<AlertNotificationResult> {
    const recipient = this.getRecipient(alert)
    const priority = getSeverityPriority(alert.severity)
    const payload = buildTamperNotificationPayload(alert, {
      subjectPrefix: this.subjectPrefix,
      baseUrl: this.baseUrl,
    })

    try {
      const result = await this.notificationChannel.send({
        requestId: alert.id,
        type: 'escalation',
        message: payload.message,
        subject: payload.subject,
        recipient,
        priority,
        metadata: payload.metadata,
        actions: [
          { label: 'Acknowledge', value: 'acknowledge', style: 'primary' },
          { label: 'Investigate', value: 'investigate', style: 'danger' },
          { label: 'Dismiss', value: 'dismiss', style: 'secondary' },
        ],
      })

      return {
        success: result.success,
        alert,
        deliveryResult: result,
      }
    } catch (error) {
      return {
        success: false,
        alert,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Send multiple alerts as a batch
   */
  async sendBatch(alerts: TamperAlert[]): Promise<AlertNotificationResult[]> {
    if (alerts.length === 0) {
      return []
    }

    if (alerts.length === 1) {
      return [await this.sendAlert(alerts[0]!)]
    }

    // Find highest severity for recipient/priority selection
    const highestSeverity = this.getHighestSeverity(alerts)
    const recipient = this.getRecipientBySeverity(highestSeverity)
    const priority = getSeverityPriority(highestSeverity)

    const payload = buildBatchNotificationPayload(alerts, {
      subjectPrefix: this.subjectPrefix,
      baseUrl: this.baseUrl,
    })

    try {
      const result = await this.notificationChannel.send({
        requestId: `batch-${Date.now()}`,
        type: 'escalation',
        message: payload.message,
        subject: payload.subject,
        recipient,
        priority,
        metadata: payload.metadata,
        actions: [
          { label: 'Acknowledge All', value: 'acknowledge_all', style: 'primary' },
          { label: 'Investigate', value: 'investigate', style: 'danger' },
        ],
      })

      // Return results for each alert in the batch
      return alerts.map((alert) => ({
        success: result.success,
        alert,
        deliveryResult: result,
      }))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return alerts.map((alert) => ({
        success: false,
        alert,
        error: errorMessage,
      }))
    }
  }

  /**
   * Flush any pending batched alerts
   */
  async flushBatch(): Promise<AlertNotificationResult[]> {
    if (this.batch.timer) {
      clearTimeout(this.batch.timer)
      this.batch.timer = null
    }

    const alerts = [...this.batch.alerts]
    this.batch.alerts = []
    this.batch.startedAt = 0

    if (alerts.length === 0) {
      return []
    }

    return this.sendBatch(alerts)
  }

  /**
   * Get count of pending batched alerts
   */
  getPendingCount(): number {
    return this.batch.alerts.length
  }

  /**
   * Dispose and flush pending
   */
  async dispose(): Promise<void> {
    await this.flushBatch()
  }

  /**
   * Internal handler for alerts (handles batching)
   */
  private async handleAlert(alert: TamperAlert): Promise<void> {
    // Critical alerts are never batched - send immediately
    if (alert.severity === 'critical' || !this.enableBatching) {
      await this.sendAlert(alert)
      return
    }

    // Add to batch
    this.batch.alerts.push(alert)

    // Start batch timer if not already running
    if (this.batch.timer === null) {
      this.batch.startedAt = Date.now()
      this.batch.timer = setTimeout(() => {
        this.flushBatch().catch(console.error)
      }, this.batchWindowMs)
    }

    // Flush if batch is full
    if (this.batch.alerts.length >= this.maxBatchSize) {
      await this.flushBatch()
    }
  }

  /**
   * Get recipient based on alert severity and type
   */
  private getRecipient(alert: TamperAlert): NotificationRecipient {
    // Check for type-specific override
    if (this.recipients.byType?.[alert.type]) {
      return this.recipients.byType[alert.type]!
    }

    // Check for severity-specific override
    if (this.recipients.bySeverity?.[alert.severity]) {
      return this.recipients.bySeverity[alert.severity]!
    }

    return this.recipients.default
  }

  /**
   * Get recipient based on severity only (for batches)
   */
  private getRecipientBySeverity(severity: AlertSeverity): NotificationRecipient {
    return this.recipients.bySeverity?.[severity] ?? this.recipients.default
  }

  /**
   * Get highest severity from a list of alerts
   */
  private getHighestSeverity(alerts: TamperAlert[]): AlertSeverity {
    const severityOrder: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

    for (const severity of severityOrder) {
      if (alerts.some((a) => a.severity === severity)) {
        return severity
      }
    }

    return 'info'
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TamperAlertNotifier instance
 *
 * @example
 * ```typescript
 * import { createTamperDetector, createTamperAlertNotifier } from 'db/primitives/audit-log'
 *
 * // Create the notifier
 * const notifier = createTamperAlertNotifier({
 *   channels: {
 *     channels: [
 *       { type: 'slack', webhookUrl: 'https://hooks.slack.com/...' },
 *       { type: 'email', provider: 'sendgrid', apiKey: '...', from: 'alerts@dotdo.dev' },
 *     ],
 *   },
 *   recipients: {
 *     default: { email: 'security@company.com', slackChannel: '#security-alerts' },
 *     bySeverity: {
 *       critical: { email: 'security@company.com', phone: '+15551234567' },
 *     },
 *   },
 *   enableBatching: true,
 *   batchWindowMs: 5000,
 * })
 *
 * // Create detector with notifier handlers
 * const detector = createTamperDetector({
 *   defaultHandler: notifier.createHandler(),
 * })
 *
 * // Or use severity-specific handlers
 * const detector2 = createTamperDetector({
 *   alertHandlers: notifier.createHandlersBySeverity(),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Manual alert sending
 * const result = await notifier.sendAlert({
 *   id: 'alert-123',
 *   type: 'hash_chain_broken',
 *   severity: 'critical',
 *   message: 'Hash chain broken at index 42',
 *   index: 42,
 *   detectedAt: Date.now(),
 * })
 *
 * if (result.success) {
 *   console.log('Alert sent to channels:', result.deliveryResult?.successfulChannels)
 * }
 * ```
 */
export function createTamperAlertNotifier(
  options: TamperAlertNotifierOptions
): TamperAlertNotifier {
  return new TamperAlertNotifierImpl(options)
}
