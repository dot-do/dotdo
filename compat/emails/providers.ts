/**
 * @dotdo/emails - Email Providers
 *
 * Multi-provider email backend supporting MailChannels, Resend, and SendGrid.
 */

import type {
  EmailMessage,
  EmailProvider,
  EmailProviderConfig,
  EmailAddress,
  EmailAttachment,
} from './types'

// ============================================================================
// Provider Interface
// ============================================================================

export interface EmailProviderAdapter {
  name: EmailProvider
  send(message: EmailMessage): Promise<ProviderSendResult>
  validateConfig(): Promise<boolean>
}

export interface ProviderSendResult {
  success: boolean
  message_id?: string
  error?: string
  provider: EmailProvider
}

// ============================================================================
// MailChannels Provider (Free for CF Workers)
// ============================================================================

export interface MailChannelsConfig {
  dkim?: {
    domain: string
    selector: string
    private_key: string
  }
}

export class MailChannelsProvider implements EmailProviderAdapter {
  readonly name: EmailProvider = 'mailchannels'
  private config: MailChannelsConfig

  constructor(config: MailChannelsConfig = {}) {
    this.config = config
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    const payload = this.buildPayload(message)

    try {
      const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.status === 202) {
        return {
          success: true,
          message_id: message.id,
          provider: 'mailchannels',
        }
      }

      const error = await response.text()
      return {
        success: false,
        error: `MailChannels error: ${response.status} - ${error}`,
        provider: 'mailchannels',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'mailchannels',
      }
    }
  }

  async validateConfig(): Promise<boolean> {
    // MailChannels doesn't require API keys for CF Workers
    return true
  }

  private buildPayload(message: EmailMessage): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      personalizations: [
        {
          to: message.to.map((addr) => ({
            email: addr.email,
            name: addr.name,
          })),
          ...(message.cc?.length && {
            cc: message.cc.map((addr) => ({
              email: addr.email,
              name: addr.name,
            })),
          }),
          ...(message.bcc?.length && {
            bcc: message.bcc.map((addr) => ({
              email: addr.email,
              name: addr.name,
            })),
          }),
          ...(message.template_data && {
            dkim_domain: this.config.dkim?.domain,
            dkim_selector: this.config.dkim?.selector,
            dkim_private_key: this.config.dkim?.private_key,
          }),
        },
      ],
      from: {
        email: message.from.email,
        name: message.from.name,
      },
      subject: message.subject,
      content: [],
    }

    // Add content
    const content: Array<{ type: string; value: string }> = []
    if (message.text) {
      content.push({ type: 'text/plain', value: message.text })
    }
    if (message.html) {
      content.push({ type: 'text/html', value: message.html })
    }
    payload.content = content

    // Add reply-to
    if (message.reply_to?.length) {
      payload.reply_to = {
        email: message.reply_to[0].email,
        name: message.reply_to[0].name,
      }
    }

    // Add headers
    if (message.headers && Object.keys(message.headers).length > 0) {
      payload.headers = message.headers
    }

    // Add DKIM if configured
    if (this.config.dkim) {
      ;(payload.personalizations as Array<Record<string, unknown>>)[0].dkim_domain = this.config.dkim.domain
      ;(payload.personalizations as Array<Record<string, unknown>>)[0].dkim_selector = this.config.dkim.selector
      ;(payload.personalizations as Array<Record<string, unknown>>)[0].dkim_private_key = this.config.dkim.private_key
    }

    return payload
  }
}

// ============================================================================
// Resend Provider
// ============================================================================

export interface ResendConfig {
  apiKey: string
}

export class ResendProvider implements EmailProviderAdapter {
  readonly name: EmailProvider = 'resend'
  private apiKey: string

  constructor(config: ResendConfig) {
    this.apiKey = config.apiKey
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    const payload = this.buildPayload(message)

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as { id?: string; message?: string }

      if (response.ok && data.id) {
        return {
          success: true,
          message_id: data.id,
          provider: 'resend',
        }
      }

      return {
        success: false,
        error: data.message || `Resend error: ${response.status}`,
        provider: 'resend',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'resend',
      }
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.apiKey || !this.apiKey.startsWith('re_')) {
      return false
    }
    return true
  }

  private buildPayload(message: EmailMessage): Record<string, unknown> {
    return {
      from: message.from.name
        ? `${message.from.name} <${message.from.email}>`
        : message.from.email,
      to: message.to.map((addr) =>
        addr.name ? `${addr.name} <${addr.email}>` : addr.email
      ),
      subject: message.subject,
      ...(message.html && { html: message.html }),
      ...(message.text && { text: message.text }),
      ...(message.cc?.length && {
        cc: message.cc.map((addr) =>
          addr.name ? `${addr.name} <${addr.email}>` : addr.email
        ),
      }),
      ...(message.bcc?.length && {
        bcc: message.bcc.map((addr) =>
          addr.name ? `${addr.name} <${addr.email}>` : addr.email
        ),
      }),
      ...(message.reply_to?.length && {
        reply_to: message.reply_to.map((addr) =>
          addr.name ? `${addr.name} <${addr.email}>` : addr.email
        ),
      }),
      ...(message.headers && { headers: message.headers }),
      ...(message.attachments?.length && {
        attachments: message.attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
          content_type: att.type,
        })),
      }),
      ...(message.tags && {
        tags: Object.entries(message.tags).map(([name, value]) => ({
          name,
          value,
        })),
      }),
      ...(message.scheduled_at && {
        scheduled_at: message.scheduled_at.toISOString(),
      }),
    }
  }
}

// ============================================================================
// SendGrid Provider
// ============================================================================

export interface SendGridConfig {
  apiKey: string
}

export class SendGridProvider implements EmailProviderAdapter {
  readonly name: EmailProvider = 'sendgrid'
  private apiKey: string

  constructor(config: SendGridConfig) {
    this.apiKey = config.apiKey
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    const payload = this.buildPayload(message)

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.status === 202) {
        return {
          success: true,
          message_id: response.headers.get('x-message-id') || message.id,
          provider: 'sendgrid',
        }
      }

      const error = await response.text()
      return {
        success: false,
        error: `SendGrid error: ${response.status} - ${error}`,
        provider: 'sendgrid',
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'sendgrid',
      }
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.apiKey || !this.apiKey.startsWith('SG.')) {
      return false
    }
    return true
  }

  private buildPayload(message: EmailMessage): Record<string, unknown> {
    return {
      personalizations: [
        {
          to: message.to.map((addr) => ({
            email: addr.email,
            name: addr.name,
          })),
          ...(message.cc?.length && {
            cc: message.cc.map((addr) => ({
              email: addr.email,
              name: addr.name,
            })),
          }),
          ...(message.bcc?.length && {
            bcc: message.bcc.map((addr) => ({
              email: addr.email,
              name: addr.name,
            })),
          }),
          ...(message.template_data && {
            dynamic_template_data: message.template_data,
          }),
        },
      ],
      from: {
        email: message.from.email,
        name: message.from.name,
      },
      ...(message.reply_to?.length && {
        reply_to: {
          email: message.reply_to[0].email,
          name: message.reply_to[0].name,
        },
      }),
      subject: message.subject,
      content: [
        ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
      ...(message.template_id && { template_id: message.template_id }),
      ...(message.headers && { headers: message.headers }),
      ...(message.attachments?.length && {
        attachments: message.attachments.map((att) => ({
          content: att.content,
          filename: att.filename,
          type: att.type,
          disposition: att.disposition || 'attachment',
          content_id: att.content_id,
        })),
      }),
      ...(message.tags && {
        categories: Object.keys(message.tags),
        custom_args: message.tags,
      }),
      ...(message.scheduled_at && {
        send_at: Math.floor(message.scheduled_at.getTime() / 1000),
      }),
    }
  }
}

// ============================================================================
// Provider Router (Multi-provider with failover)
// ============================================================================

export interface ProviderRouterConfig {
  providers: EmailProviderConfig[]
  defaultProvider?: EmailProvider
  retryOnFail?: boolean
}

export class ProviderRouter {
  private providers: Map<EmailProvider, EmailProviderAdapter> = new Map()
  private config: ProviderRouterConfig

  constructor(config: ProviderRouterConfig) {
    this.config = config
    this.initializeProviders()
  }

  private initializeProviders() {
    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) continue

      switch (providerConfig.provider) {
        case 'mailchannels':
          this.providers.set('mailchannels', new MailChannelsProvider())
          break
        case 'resend':
          if (providerConfig.apiKey) {
            this.providers.set(
              'resend',
              new ResendProvider({ apiKey: providerConfig.apiKey })
            )
          }
          break
        case 'sendgrid':
          if (providerConfig.apiKey) {
            this.providers.set(
              'sendgrid',
              new SendGridProvider({ apiKey: providerConfig.apiKey })
            )
          }
          break
      }
    }
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    // Get sorted providers by priority
    const sortedConfigs = [...this.config.providers]
      .filter((p) => p.enabled && this.providers.has(p.provider))
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))

    // Use specified provider or default
    const preferredProvider = message.provider || this.config.defaultProvider
    if (preferredProvider && this.providers.has(preferredProvider)) {
      const provider = this.providers.get(preferredProvider)!
      const result = await provider.send(message)
      if (result.success || !this.config.retryOnFail) {
        return result
      }
    }

    // Try providers in priority order
    for (const config of sortedConfigs) {
      if (config.provider === preferredProvider) continue // Already tried

      const provider = this.providers.get(config.provider)
      if (!provider) continue

      const result = await provider.send(message)
      if (result.success) {
        return result
      }
    }

    return {
      success: false,
      error: 'All providers failed',
      provider: preferredProvider || sortedConfigs[0]?.provider || 'mailchannels',
    }
  }

  getProvider(name: EmailProvider): EmailProviderAdapter | undefined {
    return this.providers.get(name)
  }

  listProviders(): EmailProvider[] {
    return Array.from(this.providers.keys())
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProvider(config: EmailProviderConfig): EmailProviderAdapter | null {
  switch (config.provider) {
    case 'mailchannels':
      return new MailChannelsProvider()
    case 'resend':
      if (!config.apiKey) return null
      return new ResendProvider({ apiKey: config.apiKey })
    case 'sendgrid':
      if (!config.apiKey) return null
      return new SendGridProvider({ apiKey: config.apiKey })
    default:
      return null
  }
}
