/**
 * @dotdo/sendgrid - Durable SendGrid Client
 *
 * SendGrid client with exactly-once delivery guarantees and temporal logging.
 * Uses ExactlyOnceContext for deduplication and TemporalStore for audit trails.
 *
 * Features:
 * - Idempotent email sending with deduplication
 * - Atomic transactions for batch operations
 * - Outbox pattern for reliable delivery
 * - Time-travel queries on email logs
 * - Checkpoint coordination for distributed systems
 *
 * @example
 * ```typescript
 * import { DurableSendGridClient } from '@dotdo/sendgrid/durable'
 *
 * const client = new DurableSendGridClient({ apiKey: 'SG.xxx' })
 *
 * // Idempotent send - safe to retry
 * await client.mail.send({
 *   to: 'user@example.com',
 *   from: 'noreply@example.com',
 *   subject: 'Hello',
 *   text: 'Hello World',
 * }, { idempotencyKey: 'order-123-confirmation' })
 *
 * // Transaction for batch operations
 * await client.transaction(async (tx) => {
 *   await tx.queueEmail({ ... })
 *   await tx.queueEmail({ ... })
 * })
 * await client.flush()
 * ```
 */

import {
  ExactlyOnceContext,
  createExactlyOnceContext,
  type ExactlyOnceContextOptions,
  type CheckpointBarrier,
  type CheckpointState,
  type Transaction,
} from '../../db/primitives/exactly-once-context'
import { createTemporalStore, type TemporalStore, type RetentionPolicy } from '../../db/primitives/temporal-store'
import {
  SendGridClient,
  type SendGridClientConfig,
  type MailData,
  type MailSendResponse,
  type RequestOptions,
} from './client'

// =============================================================================
// Types
// =============================================================================

export interface DurableSendGridClientConfig extends SendGridClientConfig {
  /** TTL for processed event IDs (ms) - default 24 hours */
  eventIdTtl?: number
  /** Maximum buffered emails before auto-flush */
  maxBufferedEmails?: number
  /** Retention policy for email logs */
  retention?: RetentionPolicy
}

export interface DurableSendOptions extends RequestOptions {
  /** Idempotency key for deduplication */
  idempotencyKey?: string
}

export interface EmailLog {
  idempotencyKey: string
  to: string
  from: string
  subject?: string
  status: EmailLogStatus
  timestamp: number
  messageId?: string
  provider_message_id?: string
  error?: string
  metadata?: Record<string, unknown>
}

export type EmailLogStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'opened'
  | 'clicked'
  | 'failed'
  | 'spam_report'
  | 'unsubscribed'

export interface StatusUpdateMetadata {
  timestamp?: number
  provider_message_id?: string
  error?: string
  [key: string]: unknown
}

export interface EmailTransaction {
  queueEmail(data: MailData): Promise<void>
}

// =============================================================================
// DurableMailResource
// =============================================================================

class DurableMailResource {
  constructor(private durableClient: DurableSendGridClient) {}

  /**
   * Send email with exactly-once guarantees
   */
  async send(data: MailData, options?: DurableSendOptions): Promise<MailSendResponse> {
    const idempotencyKey = options?.idempotencyKey || crypto.randomUUID()

    return this.durableClient._processOnce(idempotencyKey, async () => {
      const response = await this.durableClient._client.mail.send(data, options)

      // Log the email send
      await this.durableClient._logEmail({
        idempotencyKey,
        to: this.extractFirstEmail(data.to),
        from: this.extractFirstEmail(data.from),
        subject: data.subject,
        status: 'sent',
        timestamp: Date.now(),
        messageId: response.messageId,
      })

      return response
    })
  }

  /**
   * Send multiple emails with exactly-once guarantees
   */
  async sendMultiple(data: MailData, options?: DurableSendOptions): Promise<MailSendResponse> {
    const baseKey = options?.idempotencyKey || crypto.randomUUID()
    const recipients = this.normalizeRecipients(data.to)
    let lastResponse: MailSendResponse = { statusCode: 202, headers: {} }

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i]
      const key = `${baseKey}:${i}`

      lastResponse = await this.durableClient._processOnce(key, async () => {
        const singleData = { ...data, to: recipient }
        const response = await this.durableClient._client.mail.send(singleData, options)

        await this.durableClient._logEmail({
          idempotencyKey: key,
          to: typeof recipient === 'string' ? recipient : recipient.email,
          from: this.extractFirstEmail(data.from),
          subject: data.subject,
          status: 'sent',
          timestamp: Date.now(),
          messageId: response.messageId,
        })

        return response
      })
    }

    return lastResponse
  }

  private extractFirstEmail(input?: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>): string {
    if (!input) return ''
    if (typeof input === 'string') return input
    if (Array.isArray(input)) {
      const first = input[0]
      return typeof first === 'string' ? first : first?.email || ''
    }
    return input.email
  }

  private normalizeRecipients(input?: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>): Array<string | { email: string; name?: string }> {
    if (!input) return []
    if (Array.isArray(input)) return input
    return [input]
  }
}

// =============================================================================
// DurableSendGridClient
// =============================================================================

export class DurableSendGridClient {
  /** @internal */
  readonly _client: SendGridClient
  private exactlyOnce: ExactlyOnceContext
  private emailStore: TemporalStore<EmailLog>
  private queuedEmails: Array<{ data: MailData; options?: DurableSendOptions }> = []
  private maxBufferedEmails: number
  private autoFlushPromise: Promise<void> | null = null

  // Resources
  readonly mail: DurableMailResource

  constructor(config: DurableSendGridClientConfig) {
    this._client = new SendGridClient(config)
    this.maxBufferedEmails = config.maxBufferedEmails || 100

    // Initialize ExactlyOnceContext
    this.exactlyOnce = createExactlyOnceContext({
      eventIdTtl: config.eventIdTtl || 24 * 60 * 60 * 1000, // 24 hours default
      maxBufferedEvents: config.maxBufferedEmails,
      onDeliver: async (events) => {
        await this.deliverQueuedEmails(events as Array<{ data: MailData; options?: DurableSendOptions }>)
      },
    })

    // Initialize TemporalStore for email logs
    this.emailStore = createTemporalStore<EmailLog>({
      retention: config.retention,
    })

    // Initialize resources
    this.mail = new DurableMailResource(this)
  }

  /**
   * Process an operation exactly once (for internal use)
   * @internal
   */
  async _processOnce<T>(eventId: string, fn: () => Promise<T>): Promise<T> {
    return this.exactlyOnce.processOnce(eventId, fn)
  }

  /**
   * Log an email to the temporal store
   * @internal
   */
  async _logEmail(log: EmailLog): Promise<void> {
    const timestamp = Date.now()
    await this.emailStore.put(`email:${log.idempotencyKey}`, log, timestamp)

    // Also store status event for history tracking
    await this.emailStore.put(
      `email:${log.idempotencyKey}:status:${timestamp}`,
      { status: log.status, timestamp: log.timestamp } as EmailLog,
      timestamp
    )
  }

  /**
   * Check if an event ID has already been processed
   */
  async isProcessed(eventId: string): Promise<boolean> {
    return this.exactlyOnce.isProcessed(eventId)
  }

  /**
   * Execute operations atomically
   */
  async transaction<T>(fn: (tx: EmailTransaction) => Promise<T>): Promise<T> {
    return this.exactlyOnce.transaction(async (tx: Transaction) => {
      const emailTx: EmailTransaction = {
        queueEmail: async (data: MailData) => {
          tx.emit({ data })
        },
      }
      return fn(emailTx)
    })
  }

  /**
   * Queue an email for batch sending
   */
  queueEmail(data: MailData, options?: DurableSendOptions): void {
    this.queuedEmails.push({ data, options })
    this.exactlyOnce.emit({ data, options })

    // Auto-flush if we hit the max buffer size
    if (this.queuedEmails.length >= this.maxBufferedEmails && !this.autoFlushPromise) {
      this.autoFlushPromise = this.flush().finally(() => {
        this.autoFlushPromise = null
      })
    }
  }

  /**
   * Get the count of queued emails
   */
  getQueuedEmailCount(): number {
    return this.queuedEmails.length
  }

  /**
   * Flush all queued emails
   */
  async flush(): Promise<void> {
    await this.exactlyOnce.flush()
  }

  /**
   * Handle checkpoint barrier
   */
  async onBarrier(barrier: CheckpointBarrier): Promise<void> {
    await this.exactlyOnce.onBarrier(barrier)
  }

  /**
   * Get current epoch
   */
  getEpoch(): number {
    return this.exactlyOnce.getEpoch()
  }

  /**
   * Get checkpoint state for persistence
   */
  async getCheckpointState(): Promise<CheckpointState> {
    return this.exactlyOnce.getCheckpointState()
  }

  /**
   * Restore from checkpoint state
   */
  async restoreFromCheckpoint(state: CheckpointState): Promise<void> {
    await this.exactlyOnce.restoreFromCheckpoint(state)
  }

  /**
   * Create a snapshot of current state
   */
  async createSnapshot(): Promise<string> {
    return this.emailStore.snapshot()
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    await this.emailStore.restoreSnapshot(snapshotId)
  }

  /**
   * Get email log by idempotency key
   */
  async getEmailLog(idempotencyKey: string): Promise<EmailLog | null> {
    return this.emailStore.get(`email:${idempotencyKey}`)
  }

  /**
   * Get all email logs
   */
  async getEmailLogs(): Promise<EmailLog[]> {
    const logs: EmailLog[] = []
    const iterator = this.emailStore.range('email:', {})

    let result = await iterator.next()
    while (!result.done) {
      logs.push(result.value)
      result = await iterator.next()
    }

    return logs
  }

  /**
   * Get email logs as of a specific timestamp
   */
  async getEmailLogsAsOf(timestamp: number): Promise<EmailLog[]> {
    const logs: EmailLog[] = []
    const iterator = this.emailStore.range('email:', { end: timestamp })

    let result = await iterator.next()
    while (!result.done) {
      logs.push(result.value)
      result = await iterator.next()
    }

    return logs
  }

  /**
   * Update email status
   */
  async updateEmailStatus(
    idempotencyKey: string,
    status: EmailLogStatus,
    metadata?: StatusUpdateMetadata
  ): Promise<void> {
    const existing = await this.emailStore.get(`email:${idempotencyKey}`)
    if (!existing) {
      throw new Error(`Email log not found: ${idempotencyKey}`)
    }

    const updateTimestamp = metadata?.timestamp || Date.now()
    const updated: EmailLog = {
      ...existing,
      status,
      timestamp: updateTimestamp,
      provider_message_id: metadata?.provider_message_id || existing.provider_message_id,
      error: metadata?.error,
      metadata: { ...existing.metadata, ...metadata },
    }

    await this.emailStore.put(`email:${idempotencyKey}`, updated, Date.now())

    // Also store status event for history tracking
    await this.emailStore.put(
      `email:${idempotencyKey}:status:${Date.now()}`,
      { status, timestamp: updateTimestamp } as EmailLog,
      Date.now()
    )
  }

  /**
   * Get email status history (all versions)
   * Uses separate status event entries for full history tracking
   */
  async getEmailStatusHistory(idempotencyKey: string): Promise<Array<{ status: EmailLogStatus; timestamp: number }>> {
    const history: Array<{ status: EmailLogStatus; timestamp: number }> = []
    const prefix = `email:${idempotencyKey}:status:`

    // Iterate through all status events for this email
    const iterator = this.emailStore.range(prefix, {})
    let result = await iterator.next()
    while (!result.done) {
      const statusLog = result.value as { status: EmailLogStatus; timestamp: number }
      if (statusLog && statusLog.status) {
        history.push({ status: statusLog.status, timestamp: statusLog.timestamp })
      }
      result = await iterator.next()
    }

    // Sort by timestamp
    history.sort((a, b) => a.timestamp - b.timestamp)

    return history
  }

  /**
   * Deliver queued emails (internal)
   */
  private async deliverQueuedEmails(
    events: Array<{ data: MailData; options?: DurableSendOptions }>
  ): Promise<void> {
    for (const event of events) {
      const key = event.options?.idempotencyKey || crypto.randomUUID()

      try {
        const response = await this._client.mail.send(event.data, event.options)

        await this._logEmail({
          idempotencyKey: key,
          to: this.extractFirstEmail(event.data.to),
          from: this.extractFirstEmail(event.data.from),
          subject: event.data.subject,
          status: 'sent',
          timestamp: Date.now(),
          messageId: response.messageId,
        })

        // Remove from local queue
        const idx = this.queuedEmails.findIndex(
          (q) => q.options?.idempotencyKey === key || q.data === event.data
        )
        if (idx !== -1) {
          this.queuedEmails.splice(idx, 1)
        }
      } catch (error) {
        await this._logEmail({
          idempotencyKey: key,
          to: this.extractFirstEmail(event.data.to),
          from: this.extractFirstEmail(event.data.from),
          subject: event.data.subject,
          status: 'failed',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }
  }

  private extractFirstEmail(input?: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>): string {
    if (!input) return ''
    if (typeof input === 'string') return input
    if (Array.isArray(input)) {
      const first = input[0]
      return typeof first === 'string' ? first : first?.email || ''
    }
    return input.email
  }
}

// =============================================================================
// Exports
// =============================================================================

export default DurableSendGridClient
