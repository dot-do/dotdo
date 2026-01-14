/**
 * @dotdo/emails - Resend API Compatibility Layer
 *
 * Drop-in replacement for Resend's /emails endpoint.
 *
 * @example
 * ```typescript
 * import { Resend } from '@dotdo/emails'
 *
 * const resend = new Resend('re_xxx')
 *
 * await resend.emails.send({
 *   from: 'noreply@example.com',
 *   to: 'user@example.com',
 *   subject: 'Hello',
 *   html: '<p>Hello World</p>',
 * })
 * ```
 */

import type {
  ResendEmailRequest,
  ResendEmailResponse,
  ResendErrorResponse,
  EmailMessage,
  EmailAddress,
  EmailStatus,
} from './types'
import { ProviderRouter, type ProviderRouterConfig } from './providers'

// ============================================================================
// Resend Client
// ============================================================================

export interface ResendConfig {
  apiKey?: string
  providers?: ProviderRouterConfig
}

export class Resend {
  public readonly emails: ResendEmails
  private router: ProviderRouter

  constructor(apiKeyOrConfig?: string | ResendConfig) {
    const config =
      typeof apiKeyOrConfig === 'string'
        ? { apiKey: apiKeyOrConfig }
        : apiKeyOrConfig || {}

    // Default to MailChannels if no providers configured
    this.router = new ProviderRouter(
      config.providers || {
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          ...(config.apiKey
            ? [
                {
                  provider: 'resend' as const,
                  apiKey: config.apiKey,
                  enabled: true,
                  priority: 2,
                },
              ]
            : []),
        ],
        defaultProvider: 'mailchannels',
        retryOnFail: true,
      }
    )

    this.emails = new ResendEmails(this.router)
  }
}

// ============================================================================
// Emails API
// ============================================================================

export class ResendEmails {
  private router: ProviderRouter

  constructor(router: ProviderRouter) {
    this.router = router
  }

  /**
   * Send an email using Resend API format
   */
  async send(request: ResendEmailRequest): Promise<ResendEmailResponse> {
    const validation = validateResendRequest(request)
    if (!validation.valid) {
      throw new ResendAPIError(validation.error!)
    }

    const message = convertResendToMessage(request)
    const result = await this.router.send(message)

    if (!result.success) {
      throw new ResendAPIError({
        statusCode: 500,
        message: result.error || 'Failed to send email',
        name: 'internal_server_error',
      })
    }

    return {
      id: result.message_id || message.id,
    }
  }

  /**
   * Get email by ID (mock implementation - would need storage in real impl)
   */
  async get(_id: string): Promise<EmailMessage | null> {
    // In a real implementation, this would fetch from storage
    return null
  }
}

// ============================================================================
// Error Handling
// ============================================================================

export class ResendAPIError extends Error {
  public readonly statusCode: number
  public readonly code: string

  constructor(error: ResendErrorResponse) {
    super(error.message)
    this.name = 'ResendAPIError'
    this.statusCode = error.statusCode
    this.code = error.name
  }
}

// ============================================================================
// Request Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  error?: ResendErrorResponse
}

export function validateResendRequest(request: ResendEmailRequest): ValidationResult {
  // Required: from
  if (!request.from) {
    return {
      valid: false,
      error: {
        statusCode: 422,
        message: 'The `from` field is required.',
        name: 'validation_error',
      },
    }
  }

  // Required: to
  if (!request.to) {
    return {
      valid: false,
      error: {
        statusCode: 422,
        message: 'The `to` field is required.',
        name: 'validation_error',
      },
    }
  }

  // Required: subject
  if (!request.subject) {
    return {
      valid: false,
      error: {
        statusCode: 422,
        message: 'The `subject` field is required.',
        name: 'validation_error',
      },
    }
  }

  // Required: html, text, or react
  if (!request.html && !request.text && !request.react) {
    return {
      valid: false,
      error: {
        statusCode: 422,
        message: 'At least one of `html`, `text`, or `react` is required.',
        name: 'validation_error',
      },
    }
  }

  // Validate email format
  if (!isValidEmailString(request.from)) {
    return {
      valid: false,
      error: {
        statusCode: 422,
        message: 'The `from` field must be a valid email address.',
        name: 'validation_error',
      },
    }
  }

  return { valid: true }
}

function isValidEmailString(emailString: string): boolean {
  // Extract email from "Name <email>" format or plain email
  const email = extractEmail(emailString)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function extractEmail(emailString: string): string {
  const match = emailString.match(/<([^>]+)>/)
  return match ? match[1] : emailString
}

// ============================================================================
// Message Conversion
// ============================================================================

export function convertResendToMessage(request: ResendEmailRequest): EmailMessage {
  const id = crypto.randomUUID()

  // Parse from address
  const from = parseEmailAddress(request.from)

  // Parse to addresses
  const toAddresses = Array.isArray(request.to) ? request.to : [request.to]
  const to = toAddresses.map(parseEmailAddress)

  // Parse optional addresses
  const cc = request.cc
    ? (Array.isArray(request.cc) ? request.cc : [request.cc]).map(parseEmailAddress)
    : undefined

  const bcc = request.bcc
    ? (Array.isArray(request.bcc) ? request.bcc : [request.bcc]).map(parseEmailAddress)
    : undefined

  const reply_to = request.reply_to
    ? (Array.isArray(request.reply_to) ? request.reply_to : [request.reply_to]).map(
        parseEmailAddress
      )
    : undefined

  // Convert attachments
  const attachments = request.attachments?.map((att) => ({
    content: att.content || '',
    filename: att.filename,
    type: att.content_type,
  }))

  // Convert tags
  const tags = request.tags
    ? Object.fromEntries(request.tags.map((t) => [t.name, t.value]))
    : undefined

  // Parse scheduled time
  const scheduled_at = request.scheduled_at
    ? new Date(request.scheduled_at)
    : undefined

  return {
    id,
    from,
    to,
    cc,
    bcc,
    reply_to,
    subject: request.subject,
    text: request.text,
    html: request.html,
    attachments,
    headers: request.headers,
    tags,
    scheduled_at,
    created_at: new Date(),
    status: 'queued' as EmailStatus,
  }
}

function parseEmailAddress(emailString: string): EmailAddress {
  // Handle "Name <email>" format
  const match = emailString.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) {
    return {
      name: match[1].trim(),
      email: match[2].trim(),
    }
  }
  return { email: emailString.trim() }
}

// ============================================================================
// Hono Route Handler
// ============================================================================

import { Hono } from 'hono'

export interface ResendEnv {
  RESEND_API_KEY?: string
  SENDGRID_API_KEY?: string
}

/**
 * Create a Hono router with Resend-compatible endpoints
 */
export function createResendRouter(): Hono<{ Bindings: ResendEnv }> {
  const router = new Hono<{ Bindings: ResendEnv }>()

  // POST /emails - Send email (Resend compatible)
  router.post('/emails', async (c) => {
    // Validate authorization
    const authHeader = c.req.header('Authorization')
    const apiKey = authHeader?.replace('Bearer ', '')

    // Create client with available providers
    const resend = new Resend({
      apiKey: c.env.RESEND_API_KEY || apiKey,
      providers: {
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          ...(c.env.RESEND_API_KEY || apiKey
            ? [{ provider: 'resend' as const, apiKey: c.env.RESEND_API_KEY || apiKey || '', enabled: true, priority: 2 }]
            : []),
          ...(c.env.SENDGRID_API_KEY
            ? [{ provider: 'sendgrid' as const, apiKey: c.env.SENDGRID_API_KEY, enabled: true, priority: 3 }]
            : []),
        ],
        defaultProvider: 'mailchannels',
        retryOnFail: true,
      },
    })

    try {
      const request = (await c.req.json()) as ResendEmailRequest
      const result = await resend.emails.send(request)
      return c.json(result, 200)
    } catch (error) {
      if (error instanceof ResendAPIError) {
        return c.json(
          { statusCode: error.statusCode, message: error.message, name: error.code },
          error.statusCode as 400 | 401 | 403 | 404 | 422 | 500
        )
      }
      return c.json(
        { statusCode: 500, message: 'Internal server error', name: 'internal_server_error' },
        500
      )
    }
  })

  // GET /emails/:id - Get email by ID
  router.get('/emails/:id', async (c) => {
    const id = c.req.param('id')
    // In real implementation, fetch from storage
    return c.json({ statusCode: 404, message: 'Not found', name: 'not_found' }, 404)
  })

  return router
}

// ============================================================================
// Exports
// ============================================================================

export { Resend as default }
