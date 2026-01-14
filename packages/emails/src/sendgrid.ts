/**
 * @dotdo/emails - SendGrid API Compatibility Layer
 *
 * Drop-in replacement for SendGrid's /v3/mail/send endpoint.
 *
 * @example
 * ```typescript
 * import { SendGridClient } from '@dotdo/emails'
 *
 * const client = new SendGridClient({ apiKey: 'SG.xxx' })
 *
 * await client.send({
 *   personalizations: [{ to: [{ email: 'user@example.com' }] }],
 *   from: { email: 'noreply@example.com' },
 *   subject: 'Hello',
 *   content: [{ type: 'text/html', value: '<p>Hello World</p>' }],
 * })
 * ```
 */

import type {
  SendGridMailRequest,
  SendGridMailResponse,
  SendGridErrorResponse,
  SendGridPersonalization,
  EmailMessage,
  EmailAddress,
  EmailStatus,
} from './types'
import { ProviderRouter, InMemoryProvider, type ProviderRouterConfig, type EmailProviderAdapter } from './providers'

// ============================================================================
// SendGrid Client
// ============================================================================

export interface SendGridClientConfig {
  apiKey?: string
  providers?: ProviderRouterConfig
  testMode?: boolean // Use InMemoryProvider for testing
}

export class SendGridClient {
  private router: ProviderRouter
  private testProvider?: InMemoryProvider

  constructor(config: SendGridClientConfig = {}) {
    if (config.testMode) {
      this.testProvider = new InMemoryProvider()
      this.router = new ProviderRouter({
        providers: [
          { provider: 'memory', enabled: true, priority: 1 },
        ],
        defaultProvider: 'memory',
      })
    } else {
      // Default to MailChannels if no providers configured
      this.router = new ProviderRouter(
        config.providers || {
          providers: [
            { provider: 'mailchannels', enabled: true, priority: 1 },
            ...(config.apiKey
              ? [
                  {
                    provider: 'sendgrid' as const,
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
    }
  }

  /**
   * Send an email using SendGrid API format
   */
  async send(request: SendGridMailRequest): Promise<SendGridMailResponse> {
    const validation = validateSendGridRequest(request)
    if (!validation.valid) {
      return {
        statusCode: 400,
      }
    }

    const messages = convertSendGridToMessages(request)

    for (const message of messages) {
      const result = await this.router.send(message)
      if (!result.success) {
        return {
          statusCode: 500,
        }
      }
    }

    return {
      statusCode: 202,
      headers: {
        'x-message-id': messages[0]?.id,
      },
    }
  }

  /**
   * Get sent emails (only available in test mode)
   */
  getSentEmails(): EmailMessage[] {
    if (!this.testProvider) {
      throw new Error('getSentEmails() is only available in test mode')
    }
    return this.testProvider.getSentEmails()
  }
}

// ============================================================================
// Request Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors?: SendGridErrorResponse
}

export function validateSendGridRequest(request: SendGridMailRequest): ValidationResult {
  const errors: { message: string; field: string }[] = []

  // Required: personalizations
  if (!request.personalizations?.length) {
    errors.push({
      message: 'The personalizations field is required.',
      field: 'personalizations',
    })
  } else {
    // Validate each personalization has at least one recipient
    request.personalizations.forEach((p, i) => {
      if (!p.to?.length) {
        errors.push({
          message: 'The personalizations.to field is required.',
          field: `personalizations.${i}.to`,
        })
      }
    })
  }

  // Required: from
  if (!request.from?.email) {
    errors.push({
      message: 'The from field is required.',
      field: 'from',
    })
  }

  // Required: subject or personalizations[].subject
  const hasSubject =
    request.subject ||
    request.personalizations?.some((p) => p.subject) ||
    request.template_id

  if (!hasSubject) {
    errors.push({
      message: 'The subject field is required unless using a template.',
      field: 'subject',
    })
  }

  // Required: content or template_id
  if (!request.content?.length && !request.template_id) {
    errors.push({
      message: 'The content field is required unless using a template.',
      field: 'content',
    })
  }

  // Validate email addresses
  if (request.from?.email && !isValidEmail(request.from.email)) {
    errors.push({
      message: 'The from email address is invalid.',
      field: 'from.email',
    })
  }

  if (errors.length > 0) {
    return { valid: false, errors: { errors } }
  }

  return { valid: true }
}

function isValidEmail(email: string): boolean {
  // Basic email validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ============================================================================
// Message Conversion
// ============================================================================

export function convertSendGridToMessages(request: SendGridMailRequest): EmailMessage[] {
  const messages: EmailMessage[] = []

  for (const personalization of request.personalizations) {
    const message = convertPersonalizationToMessage(request, personalization)
    messages.push(message)
  }

  return messages
}

function convertPersonalizationToMessage(
  request: SendGridMailRequest,
  personalization: SendGridPersonalization
): EmailMessage {
  const id = crypto.randomUUID()

  // Get subject (personalization overrides main)
  const subject = personalization.subject || request.subject || ''

  // Get content
  let text: string | undefined
  let html: string | undefined

  if (request.content) {
    for (const content of request.content) {
      if (content.type === 'text/plain') {
        text = applySubstitutions(content.value, personalization.substitutions)
      } else if (content.type === 'text/html') {
        html = applySubstitutions(content.value, personalization.substitutions)
      }
    }
  }

  // Convert addresses
  const to: EmailAddress[] = personalization.to.map((addr) => ({
    email: addr.email,
    name: addr.name,
  }))

  const cc = personalization.cc?.map((addr) => ({
    email: addr.email,
    name: addr.name,
  }))

  const bcc = personalization.bcc?.map((addr) => ({
    email: addr.email,
    name: addr.name,
  }))

  // Reply-to
  const reply_to = request.reply_to_list?.map((addr) => ({
    email: addr.email,
    name: addr.name,
  })) || (request.reply_to ? [request.reply_to] : undefined)

  // Merge headers
  const headers = {
    ...request.headers,
    ...personalization.headers,
  }

  // Tags from categories and custom_args
  const tags: Record<string, string> = {
    ...request.custom_args,
    ...personalization.custom_args,
  }
  if (request.categories) {
    request.categories.forEach((cat, i) => {
      tags[`category_${i}`] = cat
    })
  }

  // Scheduled time
  const send_at = personalization.send_at || request.send_at
  const scheduled_at = send_at ? new Date(send_at * 1000) : undefined

  return {
    id,
    from: request.from,
    to,
    cc,
    bcc,
    reply_to,
    subject: applySubstitutions(subject, personalization.substitutions),
    text,
    html,
    attachments: request.attachments,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    tags: Object.keys(tags).length > 0 ? tags : undefined,
    template_id: request.template_id,
    template_data: personalization.dynamic_template_data,
    scheduled_at,
    created_at: new Date(),
    status: 'queued' as EmailStatus,
  }
}

function applySubstitutions(
  text: string,
  substitutions?: Record<string, string>
): string {
  if (!substitutions) return text

  let result = text
  for (const [key, value] of Object.entries(substitutions)) {
    result = result.replace(new RegExp(escapeRegex(key), 'g'), value)
  }
  return result
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// Hono Route Handler
// ============================================================================

import { Hono } from 'hono'

export interface SendGridEnv {
  SENDGRID_API_KEY?: string
  RESEND_API_KEY?: string
}

/**
 * Create a Hono router with SendGrid-compatible endpoints
 */
export function createSendGridRouter(): Hono<{ Bindings: SendGridEnv }> {
  const router = new Hono<{ Bindings: SendGridEnv }>()

  // POST /v3/mail/send - Send email (SendGrid compatible)
  router.post('/v3/mail/send', async (c) => {
    // Validate authorization
    const authHeader = c.req.header('Authorization')
    const apiKey = authHeader?.replace('Bearer ', '')

    // Create client with available providers
    const client = new SendGridClient({
      apiKey: c.env.SENDGRID_API_KEY || apiKey,
      providers: {
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          ...(c.env.RESEND_API_KEY
            ? [{ provider: 'resend' as const, apiKey: c.env.RESEND_API_KEY, enabled: true, priority: 2 }]
            : []),
          ...(c.env.SENDGRID_API_KEY || apiKey
            ? [{ provider: 'sendgrid' as const, apiKey: c.env.SENDGRID_API_KEY || apiKey || '', enabled: true, priority: 3 }]
            : []),
        ],
        defaultProvider: 'mailchannels',
        retryOnFail: true,
      },
    })

    const request = (await c.req.json()) as SendGridMailRequest
    const result = await client.send(request)

    if (result.statusCode === 202) {
      return c.body(null, 202, {
        'x-message-id': result.headers?.['x-message-id'] || '',
      })
    }

    return c.json(
      { errors: [{ message: 'Failed to send email' }] },
      result.statusCode
    )
  })

  return router
}

// ============================================================================
// Exports
// ============================================================================

export { SendGridClient as default }
