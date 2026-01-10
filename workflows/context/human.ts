/**
 * Human Proxy Context API for $.human.*
 *
 * Provides a workflow context API for human-in-the-loop interactions:
 * - $.human.approve(message) - Request approval (returns boolean)
 * - $.human.ask(question) - Get human input (returns string)
 * - $.human.review(content) - Get review feedback (returns structured review)
 *
 * Plus support for:
 * - Timeout handling for human response
 * - Escalation routing by role (e.g., 'senior-accountant')
 * - SLA tracking
 * - Notification delivery (email, slack, push)
 * - Response persistence
 * - Concurrent approval requests
 *
 * Routes to Human DO class in objects/
 *
 * @module workflows/context/human
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for creating a human proxy
 */
export interface HumanProxyConfig {
  /** Environment with DO bindings */
  env: HumanProxyEnv
  /** Notification service for sending alerts */
  notificationService?: NotificationService
  /** Default timeout for human responses (ms) */
  defaultTimeout?: number
  /** Default role for routing */
  defaultRole?: string
  /** Default notification channels */
  defaultNotify?: NotificationChannel[]
  /** Event handler for SLA warnings */
  onSLAWarning?: (event: SLAWarningEvent) => void
  /** Event handler for approval requests */
  onApprovalRequest?: (request: HumanRequest) => void
  /** Event handler for approval responses */
  onApprovalResponse?: (response: ApprovalResult) => void
}

/**
 * Environment bindings for Human DO
 */
export interface HumanProxyEnv {
  HUMAN_DO: DurableObjectNamespace
  NOTIFICATION_SERVICE_URL?: string
  SLACK_WEBHOOK_URL?: string
  SENDGRID_API_KEY?: string
}

/**
 * Durable Object namespace interface
 */
interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub
  idFromName(name: string): DurableObjectId
}

/**
 * Durable Object ID interface
 */
interface DurableObjectId {
  toString(): string
}

/**
 * Durable Object stub interface
 */
interface DurableObjectStub {
  id: DurableObjectId
  fetch(request: Request): Promise<Response>
}

/**
 * Notification service interface
 */
export interface NotificationService {
  sendEmail(options: EmailNotification): Promise<NotificationResult>
  sendSlack(options: SlackNotification): Promise<NotificationResult>
  sendPush(options: PushNotification): Promise<NotificationResult>
  getDeliveryStatus(messageId: string): Promise<{ status: string }>
}

/**
 * Email notification options
 */
export interface EmailNotification {
  to: string
  subject: string
  body: string
  actions?: Array<{ label: string; url: string }>
}

/**
 * Slack notification options
 */
export interface SlackNotification {
  channel: string
  text?: string
  blocks?: SlackBlock[]
}

/**
 * Slack block structure
 */
interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: Array<{ text: { text: string }; [key: string]: unknown }>
}

/**
 * Push notification options
 */
export interface PushNotification {
  userId: string
  title: string
  body?: string
  priority?: 'low' | 'normal' | 'high'
}

/**
 * Notification result
 */
export interface NotificationResult {
  messageId: string
  delivered: boolean
}

/**
 * Notification channel configuration
 */
export type NotificationChannel =
  | { type: 'email'; to: string }
  | { type: 'slack'; channel: string; mention?: string[] }
  | { type: 'push'; userId: string; priority?: 'low' | 'normal' | 'high' }

/**
 * SLA configuration
 */
export interface SLAConfig {
  /** Target response time (ms) */
  target: number
  /** Critical threshold (ms) */
  critical?: number
}

/**
 * SLA status in pending requests
 */
export interface SLAStatus {
  target: number
  critical?: number
  status: 'on-track' | 'warning' | 'breached'
  remainingTarget?: number
  breachedAt?: string
}

/**
 * SLA warning event
 */
export interface SLAWarningEvent {
  requestId: string
  remainingTime: number
  target: number
}

/**
 * Escalation configuration
 */
export interface EscalationConfig {
  /** Role to escalate to after timeout */
  afterTimeout: string
  /** Timeout for this escalation level (ms) */
  timeout: number
  /** Next level escalation */
  next?: EscalationConfig
}

/**
 * Options for approve method
 */
export interface ApprovalOptions {
  timeout?: number
  role?: string
  escalation?: EscalationConfig
  sla?: SLAConfig
  notify?: NotificationChannel[]
  metadata?: Record<string, unknown>
}

/**
 * Options for ask method
 */
export interface AskOptions {
  timeout?: number
  role?: string
  placeholder?: string
  validation?: (answer: string) => boolean | string
  notify?: NotificationChannel[]
}

/**
 * Options for review method
 */
export interface ReviewOptions {
  timeout?: number
  role?: string
  criteria?: string[]
  notify?: NotificationChannel[]
}

/**
 * Approval result from Human DO
 */
export interface ApprovalResult {
  approved: boolean
  requestId?: string
  respondedBy?: string
  respondedAt?: string
  audit?: {
    requestedAt: string
    requestedBy: string
    respondedAt: string
    respondedBy: string
    ipAddress?: string
    userAgent?: string
  }
}

/**
 * Review result from Human DO
 */
export interface ReviewResult {
  approved: boolean
  feedback: string
  score: number
  criteria?: Record<string, number>
  reviewerId?: string
  reviewedAt?: string
}

/**
 * Human request object
 */
export interface HumanRequest {
  requestId: string
  type: 'approval' | 'question' | 'review'
  message?: string
  question?: string
  content?: unknown
  role?: string
  status: 'pending' | 'completed' | 'cancelled'
  createdAt?: string
  sla?: SLAStatus
  response?: ApprovalResult | { answer: string } | ReviewResult
}

/**
 * Human proxy context returned by factory
 */
export interface HumanProxyContext {
  human: {
    approve: (message: string, options?: ApprovalOptions) => Promise<boolean>
    ask: (question: string, options?: AskOptions) => Promise<string>
    review: (content: unknown, options?: ReviewOptions) => Promise<ReviewResult>
    escalate: (request: HumanRequest, role: string) => Promise<unknown>
    pending: () => Promise<HumanRequest[]>
    cancel: (requestId: string) => Promise<boolean>
    getResponse?: (requestId: string) => Promise<ApprovalResult | null>
  }
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when human response times out
 */
export class HumanTimeoutError extends Error {
  constructor(timeout: number, requestType: string = 'request') {
    super(`Human ${requestType} timed out after ${timeout}ms`)
    this.name = 'HumanTimeoutError'
  }
}

/**
 * Error thrown when all escalation levels fail
 */
export class HumanEscalationError extends Error {
  constructor(message: string = 'All escalation levels exhausted') {
    super(message)
    this.name = 'HumanEscalationError'
  }
}

/**
 * Error thrown when all notification channels fail
 */
export class HumanNotificationError extends Error {
  constructor(message: string = 'All notification channels failed') {
    super(message)
    this.name = 'HumanNotificationError'
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_MESSAGE_LENGTH = 10000
const DEFAULT_TIMEOUT = 300000 // 5 minutes

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Sanitize HTML to prevent XSS attacks
 */
function sanitizeHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
}

/**
 * Create a timeout promise
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new HumanTimeoutError(ms))
    }, ms)
  })
}

/**
 * Race a promise against a timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  if (timeout <= 0) {
    throw new HumanTimeoutError(timeout)
  }
  return Promise.race([promise, createTimeout(timeout)])
}

// ============================================================================
// NOTIFICATION HELPERS
// ============================================================================

/**
 * Send notifications to all configured channels
 */
async function sendNotifications(
  notificationService: NotificationService | undefined,
  channels: NotificationChannel[],
  request: {
    requestId: string
    message: string
    type: 'approval' | 'question' | 'review'
  }
): Promise<void> {
  if (!notificationService || channels.length === 0) {
    return
  }

  const results: Array<{ channel: NotificationChannel; success: boolean }> = []

  for (const channel of channels) {
    try {
      if (channel.type === 'email') {
        await notificationService.sendEmail({
          to: channel.to,
          subject: `Approval Request: ${request.message.slice(0, 50)}`,
          body: request.message,
          actions: [
            { label: 'Approve', url: `https://dotdo.dev/approve/${request.requestId}?action=approve` },
            { label: 'Reject', url: `https://dotdo.dev/approve/${request.requestId}?action=reject` },
          ],
        })
        results.push({ channel, success: true })
      } else if (channel.type === 'slack') {
        const mentions = channel.mention?.map((u) => `<@${u}>`).join(' ') ?? ''
        await notificationService.sendSlack({
          channel: channel.channel,
          text: mentions ? `${mentions} ${request.message}` : request.message,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: request.message },
            },
            {
              type: 'actions',
              elements: [
                { text: { text: 'Approve' }, type: 'button', action_id: 'approve' },
                { text: { text: 'Reject' }, type: 'button', action_id: 'reject' },
              ],
            },
          ],
        })
        results.push({ channel, success: true })
      } else if (channel.type === 'push') {
        await notificationService.sendPush({
          userId: channel.userId,
          title: `Approval Request`,
          body: request.message,
          priority: channel.priority,
        })
        results.push({ channel, success: true })
      }
    } catch {
      results.push({ channel, success: false })
    }
  }

  // Check if all channels failed
  const successCount = results.filter((r) => r.success).length
  if (results.length > 0 && successCount === 0) {
    throw new HumanNotificationError()
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a human proxy context for human-in-the-loop workflows
 *
 * @param config - Configuration options
 * @returns HumanProxyContext with human methods
 */
export function createHumanProxy(config: HumanProxyConfig): HumanProxyContext {
  const {
    env,
    notificationService,
    defaultTimeout = DEFAULT_TIMEOUT,
    defaultRole,
    defaultNotify,
  } = config

  /**
   * Get DO stub for a specific role
   */
  function getDOStub(role?: string): DurableObjectStub {
    const targetRole = role ?? defaultRole ?? 'default'
    const id = env.HUMAN_DO.idFromName(targetRole)
    return env.HUMAN_DO.get(id)
  }

  /**
   * Make a request to Human DO
   */
  async function makeRequest(
    path: string,
    method: string,
    body: Record<string, unknown>,
    role?: string
  ): Promise<Response> {
    const stub = getDOStub(role)
    const url = new URL(`https://human.do${path}`)
    if (role) {
      url.searchParams.set('role', role)
    }

    const request = new Request(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    return stub.fetch(request)
  }

  /**
   * Execute approval with escalation support
   */
  async function executeWithEscalation(
    message: string,
    options: ApprovalOptions,
    currentRole: string,
    escalation?: EscalationConfig
  ): Promise<boolean> {
    const requestId = generateRequestId()
    const timeout = options.timeout ?? escalation?.timeout ?? defaultTimeout

    try {
      const response = await withTimeout(
        makeRequest(
          '/approve',
          'POST',
          {
            requestId,
            message: sanitizeHtml(message),
            type: 'approval',
            role: currentRole,
            metadata: options.metadata,
            sla: options.sla,
          },
          currentRole
        ),
        timeout
      )

      const result = (await response.json()) as ApprovalResult
      return result.approved
    } catch (error) {
      // If there's an escalation path, try the next level
      if (escalation) {
        return executeWithEscalation(
          message,
          { ...options, timeout: escalation.timeout },
          escalation.afterTimeout,
          escalation.next
        )
      }

      // If this was a timeout and we had an escalation config but it failed, throw escalation error
      if (error instanceof HumanTimeoutError && options.escalation) {
        throw new HumanEscalationError()
      }

      throw error
    }
  }

  /**
   * Execute ask with validation retry
   */
  async function executeAsk(
    question: string,
    options: AskOptions,
    role: string
  ): Promise<string> {
    const requestId = generateRequestId()
    const timeout = options.timeout ?? defaultTimeout

    const response = await withTimeout(
      makeRequest(
        '/ask',
        'POST',
        {
          requestId,
          question,
          type: 'question',
          role,
          placeholder: options.placeholder,
          hasValidation: !!options.validation,
        },
        role
      ),
      timeout
    )

    const result = (await response.json()) as { answer: string }
    const answer = (result.answer ?? '').trim()

    // If validation is provided, check and potentially retry
    if (options.validation) {
      const validationResult = options.validation(answer)
      if (validationResult !== true) {
        // Retry with validation error message
        return executeAsk(question, options, role)
      }
    }

    return answer
  }

  return {
    human: {
      /**
       * Request approval from a human
       */
      async approve(message: string, options: ApprovalOptions = {}): Promise<boolean> {
        // Validate input
        if (!message || message.trim() === '') {
          throw new Error('Message is required')
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
          throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH}`)
        }
        if (options.timeout !== undefined && options.timeout < 0) {
          throw new Error('Timeout must be non-negative')
        }

        const role = options.role ?? defaultRole ?? 'default'
        const notify = options.notify ?? defaultNotify ?? []
        const requestId = generateRequestId()
        const sanitizedMessage = sanitizeHtml(message)

        // Send notifications
        await sendNotifications(notificationService, notify, {
          requestId,
          message: sanitizedMessage,
          type: 'approval',
        })

        // Execute with potential escalation
        if (options.escalation) {
          return executeWithEscalation(sanitizedMessage, options, role, options.escalation)
        }

        const timeout = options.timeout ?? defaultTimeout

        const response = await withTimeout(
          makeRequest(
            '/approve',
            'POST',
            {
              requestId,
              message: sanitizedMessage,
              type: 'approval',
              role,
              metadata: options.metadata,
              sla: options.sla,
            },
            role
          ),
          timeout
        )

        // Handle malformed response
        const contentType = response.headers.get('Content-Type')
        if (!contentType?.includes('application/json')) {
          throw new Error('Invalid response from Human DO')
        }

        const result = (await response.json()) as ApprovalResult
        return result.approved
      },

      /**
       * Ask a question and get human input
       */
      async ask(question: string, options: AskOptions = {}): Promise<string> {
        // Validate input
        if (!question || question.trim() === '') {
          throw new Error('Question is required')
        }
        if (options.timeout !== undefined && options.timeout < 0) {
          throw new Error('Timeout must be non-negative')
        }

        const role = options.role ?? defaultRole ?? 'default'
        const notify = options.notify ?? defaultNotify ?? []
        const requestId = generateRequestId()

        // Send notifications
        await sendNotifications(notificationService, notify, {
          requestId,
          message: question,
          type: 'question',
        })

        return executeAsk(question, options, role)
      },

      /**
       * Request a review from a human
       */
      async review(content: unknown, options: ReviewOptions = {}): Promise<ReviewResult> {
        // Validate input
        if (content === null || content === undefined) {
          throw new Error('Content is required')
        }
        if (options.timeout !== undefined && options.timeout < 0) {
          throw new Error('Timeout must be non-negative')
        }

        const role = options.role ?? defaultRole ?? 'default'
        const notify = options.notify ?? defaultNotify ?? []
        const requestId = generateRequestId()
        const timeout = options.timeout ?? defaultTimeout

        // Send notifications
        await sendNotifications(notificationService, notify, {
          requestId,
          message: typeof content === 'string' ? content : JSON.stringify(content),
          type: 'review',
        })

        const response = await withTimeout(
          makeRequest(
            '/review',
            'POST',
            {
              requestId,
              content,
              type: 'review',
              role,
              criteria: options.criteria,
            },
            role
          ),
          timeout
        )

        // Handle malformed response
        const contentType = response.headers.get('Content-Type')
        if (!contentType?.includes('application/json')) {
          throw new Error('Invalid response from Human DO')
        }

        return (await response.json()) as ReviewResult
      },

      /**
       * Escalate a request to a specific role
       */
      async escalate(request: HumanRequest, role: string): Promise<unknown> {
        const response = await makeRequest(
          '/escalate',
          'POST',
          {
            ...request,
            role,
          },
          role
        )

        return response.json()
      },

      /**
       * Get all pending human requests
       */
      async pending(): Promise<HumanRequest[]> {
        const stub = getDOStub()
        const request = new Request('https://human.do/pending', {
          method: 'GET',
        })

        const response = await stub.fetch(request)
        return (await response.json()) as HumanRequest[]
      },

      /**
       * Cancel a pending request
       */
      async cancel(requestId: string): Promise<boolean> {
        const stub = getDOStub()
        const request = new Request(`https://human.do/request/${requestId}`, {
          method: 'DELETE',
        })

        const response = await stub.fetch(request)
        const result = (await response.json()) as { cancelled: boolean }
        return result.cancelled
      },

      /**
       * Get response for a specific request
       */
      async getResponse(requestId: string): Promise<ApprovalResult | null> {
        const stub = getDOStub()
        const request = new Request(`https://human.do/request/${requestId}`, {
          method: 'GET',
        })

        const response = await stub.fetch(request)
        const result = (await response.json()) as { response?: ApprovalResult }
        return result.response ?? null
      },
    },
  }
}
