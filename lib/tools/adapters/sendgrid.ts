/**
 * @dotdo/lib/tools/adapters/sendgrid.ts - SendGrid Provider Adapter
 *
 * Exposes SendGrid compat SDK as Tool Things.
 *
 * @example
 * ```typescript
 * import { sendgridAdapter } from 'lib/tools/adapters/sendgrid'
 * import { globalRegistry } from 'lib/tools'
 *
 * globalRegistry.register(sendgridAdapter)
 *
 * await globalRegistry.execute(
 *   'sendgrid',
 *   'send_email',
 *   {
 *     to: 'user@example.com',
 *     from: 'sender@example.com',
 *     subject: 'Hello',
 *     text: 'Hello world!',
 *   },
 *   { apiKey: 'SG.xxx' }
 * )
 * ```
 */

import {
  createProviderAdapter,
  type ProviderToolAdapter,
  type RuntimeCredentials,
  type ToolContext,
  ProviderError,
} from '../provider-adapter'

// =============================================================================
// Types
// =============================================================================

interface SendEmailParams {
  to: string | string[]
  from: string
  subject: string
  text?: string
  html?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  templateId?: string
  dynamicTemplateData?: Record<string, unknown>
  attachments?: Array<{
    content: string
    filename: string
    type?: string
    disposition?: 'attachment' | 'inline'
  }>
  sendAt?: number
  categories?: string[]
}

interface SendEmailResult {
  messageId: string
  statusCode: number
}

// =============================================================================
// Handlers
// =============================================================================

async function sendEmail(
  params: SendEmailParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<SendEmailResult> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'SendGrid API key is required',
      provider: 'sendgrid',
      toolId: 'send_email',
    })
  }

  // Dynamic import to avoid bundling when not used
  const { MailService } = await import('../../../compat/sendgrid')

  const client = new MailService()
  client.setApiKey(credentials.apiKey)

  try {
    const [response] = await client.send({
      to: params.to,
      from: params.from,
      subject: params.subject,
      text: params.text,
      html: params.html,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo,
      templateId: params.templateId,
      dynamicTemplateData: params.dynamicTemplateData,
      attachments: params.attachments,
      sendAt: params.sendAt,
      categories: params.categories,
    })

    return {
      messageId: response.headers['x-message-id'] ?? '',
      statusCode: response.statusCode,
    }
  } catch (error) {
    throw new ProviderError({
      code: 'SEND_EMAIL_FAILED',
      message: error instanceof Error ? error.message : 'Failed to send email',
      provider: 'sendgrid',
      toolId: 'send_email',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

// =============================================================================
// Adapter Definition
// =============================================================================

/**
 * SendGrid provider adapter
 */
export const sendgridAdapter: ProviderToolAdapter = createProviderAdapter({
  name: 'sendgrid',
  displayName: 'SendGrid',
  description: 'Email delivery service for transactional and marketing emails',
  category: 'communication',
  credential: {
    type: 'api_key',
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
    envVar: 'SENDGRID_API_KEY',
    required: true,
  },
  baseUrl: 'https://api.sendgrid.com',
  timeout: 60000,
  maxRetries: 2,
  iconUrl: 'https://sendgrid.com/favicon.ico',
  docsUrl: 'https://docs.sendgrid.com/api-reference',
  version: '1.0.0',
  tools: [
    {
      id: 'send_email',
      name: 'Send Email',
      description: 'Send an email via SendGrid. Supports plain text, HTML, templates, and attachments.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address or array of addresses',
          },
          from: {
            type: 'string',
            description: 'Sender email address',
          },
          subject: {
            type: 'string',
            description: 'Email subject line',
          },
          text: {
            type: 'string',
            description: 'Plain text email body',
          },
          html: {
            type: 'string',
            description: 'HTML email body',
          },
          cc: {
            type: 'string',
            description: 'CC recipient email address or array of addresses',
          },
          bcc: {
            type: 'string',
            description: 'BCC recipient email address or array of addresses',
          },
          replyTo: {
            type: 'string',
            description: 'Reply-to email address',
          },
          templateId: {
            type: 'string',
            description: 'SendGrid dynamic template ID',
          },
          dynamicTemplateData: {
            type: 'object',
            description: 'Data to populate template variables',
          },
          attachments: {
            type: 'array',
            description: 'File attachments',
            items: { type: 'object' },
          },
          sendAt: {
            type: 'number',
            description: 'Unix timestamp to schedule the email',
          },
          categories: {
            type: 'array',
            description: 'Categories for email analytics',
            items: { type: 'string' },
          },
        },
        required: ['to', 'from', 'subject'],
      },
      handler: sendEmail,
      tags: ['email', 'transactional', 'marketing'],
      rateLimitTier: 'medium',
      examples: [
        {
          name: 'Simple Email',
          description: 'Send a plain text email',
          input: {
            to: 'recipient@example.com',
            from: 'sender@example.com',
            subject: 'Hello',
            text: 'Hello, World!',
          },
        },
        {
          name: 'HTML Email with Template',
          description: 'Send an email using a dynamic template',
          input: {
            to: 'recipient@example.com',
            from: 'sender@example.com',
            subject: 'Welcome!',
            templateId: 'd-xxxxxxxxxxxxx',
            dynamicTemplateData: {
              name: 'John',
              company: 'Acme Inc',
            },
          },
        },
      ],
    },
  ],
})

export default sendgridAdapter
