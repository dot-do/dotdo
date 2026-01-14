/**
 * @dotdo/emails - Email Service with SendGrid/Resend Compatibility
 *
 * Transactional email service with multi-provider backend support.
 *
 * Features:
 * - SendGrid API compatibility (POST /v3/mail/send)
 * - Resend API compatibility (POST /emails)
 * - Multi-provider backend (MailChannels, Resend, SendGrid, InMemory)
 * - Template storage and rendering
 * - Webhook support (delivered, bounced, opened, clicked, complained)
 * - Per-agent email addresses (priya@agents.startup.do)
 *
 * @example SendGrid-compatible API
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
 *
 * @example Resend-compatible API
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
 *
 * @example Multi-provider with failover
 * ```typescript
 * import { ProviderRouter } from '@dotdo/emails'
 *
 * const router = new ProviderRouter({
 *   providers: [
 *     { provider: 'mailchannels', enabled: true, priority: 1 },
 *     { provider: 'resend', apiKey: 're_xxx', enabled: true, priority: 2 },
 *     { provider: 'sendgrid', apiKey: 'SG.xxx', enabled: true, priority: 3 },
 *   ],
 *   defaultProvider: 'mailchannels',
 *   retryOnFail: true,
 * })
 *
 * await router.send(message)
 * ```
 *
 * @example In-memory provider for testing
 * ```typescript
 * import { InMemoryProvider, SendGridClient } from '@dotdo/emails'
 *
 * // Option 1: Use InMemoryProvider directly
 * const provider = new InMemoryProvider()
 * await provider.send(message)
 * const sentEmails = provider.getSentEmails()
 *
 * // Option 2: Use test mode in clients
 * const client = new SendGridClient({ testMode: true })
 * await client.send(request)
 * ```
 *
 * @example Template rendering
 * ```typescript
 * import { TemplateRenderer, InMemoryTemplateStorage, BUILT_IN_TEMPLATES } from '@dotdo/emails'
 *
 * const storage = new InMemoryTemplateStorage()
 * for (const template of BUILT_IN_TEMPLATES) {
 *   await storage.set(template)
 * }
 *
 * const renderer = new TemplateRenderer(storage)
 * const result = await renderer.render('welcome', {
 *   name: 'John',
 *   company_name: 'Acme Corp',
 * })
 * ```
 *
 * @example Webhooks
 * ```typescript
 * import { WebhookDispatcher, InMemoryWebhookStorage } from '@dotdo/emails'
 *
 * const storage = new InMemoryWebhookStorage()
 * await storage.setSubscription({
 *   id: 'sub-1',
 *   url: 'https://example.com/webhooks',
 *   events: ['delivered', 'bounced', 'opened'],
 *   enabled: true,
 *   created_at: new Date(),
 * })
 *
 * const dispatcher = new WebhookDispatcher({ storage })
 * await dispatcher.dispatch({
 *   id: 'event-1',
 *   type: 'delivered',
 *   email_id: 'msg-123',
 *   recipient: 'user@example.com',
 *   timestamp: new Date(),
 * })
 * ```
 *
 * @example Hono integration
 * ```typescript
 * import { Hono } from 'hono'
 * import { createSendGridRouter, createResendRouter, createWebhookRouter, InMemoryWebhookStorage } from '@dotdo/emails'
 *
 * const app = new Hono()
 *
 * // Mount SendGrid-compatible API
 * app.route('/', createSendGridRouter())
 *
 * // Mount Resend-compatible API
 * app.route('/', createResendRouter())
 *
 * // Mount webhook management
 * const webhookStorage = new InMemoryWebhookStorage()
 * app.route('/', createWebhookRouter(webhookStorage))
 *
 * export default app
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Email types
  EmailAddress,
  EmailAttachment,
  EmailHeaders,
  EmailMessage,
  EmailStatus,
  EmailProvider,
  EmailProviderConfig,
  EmailTemplate,

  // SendGrid types
  SendGridMailRequest,
  SendGridMailResponse,
  SendGridPersonalization,
  SendGridContent,
  SendGridASM,
  SendGridMailSettings,
  SendGridTrackingSettings,
  SendGridError,
  SendGridErrorResponse,

  // Resend types
  ResendEmailRequest,
  ResendEmailResponse,
  ResendAttachment,
  ResendTag,
  ResendErrorResponse,

  // Webhook types
  WebhookEvent,
  WebhookEventType,
  WebhookSubscription,

  // Agent email types
  AgentEmailConfig,
  InboundEmail,
} from './types'

// ============================================================================
// SendGrid Compatibility
// ============================================================================

export {
  SendGridClient,
  validateSendGridRequest,
  convertSendGridToMessages,
  createSendGridRouter,
} from './sendgrid'

export type { SendGridClientConfig, ValidationResult as SendGridValidationResult } from './sendgrid'

// ============================================================================
// Resend Compatibility
// ============================================================================

export {
  Resend,
  ResendEmails,
  ResendAPIError,
  validateResendRequest,
  convertResendToMessage,
  createResendRouter,
} from './resend'

export type { ResendConfig, ValidationResult as ResendValidationResult } from './resend'

// ============================================================================
// Providers
// ============================================================================

export {
  InMemoryProvider,
  MailChannelsProvider,
  ResendProvider,
  SendGridProvider,
  ProviderRouter,
  createProvider,
} from './providers'

export type {
  EmailProviderAdapter,
  ProviderSendResult,
  MailChannelsConfig,
  ResendConfig as ResendProviderConfig,
  SendGridConfig,
  ProviderRouterConfig,
} from './providers'

// ============================================================================
// Templates
// ============================================================================

export {
  InMemoryTemplateStorage,
  KVTemplateStorage,
  SQLiteTemplateStorage,
  TemplateRenderer,
  BUILT_IN_TEMPLATES,
  initializeBuiltInTemplates,
  extractVariables,
  validateTemplateData,
} from './templates'

export type { TemplateStorage, RenderOptions } from './templates'

// ============================================================================
// Webhooks
// ============================================================================

export {
  InMemoryWebhookStorage,
  SQLiteWebhookStorage,
  WebhookDispatcher,
  parseSendGridWebhook,
  parseResendWebhook,
  createWebhookRouter,
} from './webhooks'

export type {
  WebhookStorage,
  WebhookDispatcherConfig,
  WebhookDispatchResult,
  WebhookPayload,
} from './webhooks'

// ============================================================================
// Default Exports
// ============================================================================

// Re-export main clients as named exports for convenience
import { SendGridClient as _SendGridClient } from './sendgrid'
import { Resend as _Resend } from './resend'

export { _SendGridClient as default }
