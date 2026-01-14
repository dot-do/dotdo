/**
 * @dotdo/resend - Resend SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for the Resend SDK that runs on Cloudflare Workers.
 *
 * Features:
 * - API-compatible with `resend` npm package
 * - emails.send() for single email
 * - emails.batch() for batch sending
 * - domains API for domain management
 * - apiKeys API for key management
 * - audiences API for contact management
 * - contacts API for audience contacts
 *
 * @example Basic Usage
 * ```typescript
 * import { Resend } from '@dotdo/resend'
 *
 * const resend = new Resend('re_xxx')
 *
 * await resend.emails.send({
 *   from: 'noreply@example.com',
 *   to: 'user@example.com',
 *   subject: 'Hello',
 *   html: '<h1>Hello World</h1>',
 * })
 * ```
 *
 * @example Batch Sending
 * ```typescript
 * const { data, error } = await resend.batch.send([
 *   {
 *     from: 'sender@example.com',
 *     to: 'user1@example.com',
 *     subject: 'Hello User 1',
 *     html: '<p>Hello!</p>',
 *   },
 *   {
 *     from: 'sender@example.com',
 *     to: 'user2@example.com',
 *     subject: 'Hello User 2',
 *     html: '<p>Hello!</p>',
 *   },
 * ])
 * ```
 *
 * @see https://resend.com/docs/api-reference
 */

import { ResendClient, type ResendClientConfig } from './client'

// Re-export client and types
export { ResendClient } from './client'
export type {
  ResendClientConfig,
  SendEmailRequest,
  SendEmailResponse,
  BatchEmailRequest,
  BatchEmailResponse,
  Domain,
  DomainCreateRequest,
  DomainVerifyResponse,
  ApiKey,
  ApiKeyCreateRequest,
  Audience,
  AudienceCreateRequest,
  Contact,
  ContactCreateRequest,
  ContactUpdateRequest,
} from './client'

// Re-export error types
export { ResendError } from './client'

// =============================================================================
// Resend Class (SDK-compatible wrapper)
// =============================================================================

/**
 * Resend SDK-compatible client
 */
export class Resend extends ResendClient {
  constructor(apiKey?: string) {
    super({ apiKey: apiKey || '' })
  }
}

// Default export
export default Resend
