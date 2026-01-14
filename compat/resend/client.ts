/**
 * @dotdo/resend - Resend SDK Compatible Client
 *
 * Full Resend API compatible client with resources for:
 * - Emails: Single and batch email sending
 * - Domains: Domain verification and management
 * - API Keys: Key creation and management
 * - Audiences: Contact list management
 * - Contacts: Audience contact management
 *
 * @example
 * ```typescript
 * import { ResendClient } from '@dotdo/resend'
 *
 * const client = new ResendClient({ apiKey: 're_xxx' })
 *
 * // Send email
 * const { data, error } = await client.emails.send({
 *   from: 'noreply@example.com',
 *   to: 'user@example.com',
 *   subject: 'Hello',
 *   html: '<p>Hello World</p>',
 * })
 *
 * // Create domain
 * const domain = await client.domains.create({
 *   name: 'example.com',
 * })
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export interface ResendClientConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

// Email Types
export type EmailAddressInput = string | string[]

export interface SendEmailRequest {
  from: string
  to: EmailAddressInput
  subject: string
  cc?: EmailAddressInput
  bcc?: EmailAddressInput
  reply_to?: EmailAddressInput
  html?: string
  text?: string
  react?: unknown // React Email component
  headers?: Record<string, string>
  attachments?: EmailAttachment[]
  tags?: EmailTag[]
  scheduled_at?: string // ISO 8601
}

export interface EmailAttachment {
  content?: string // Base64 encoded
  filename: string
  path?: string // URL to fetch
  content_type?: string
}

export interface EmailTag {
  name: string
  value: string
}

export interface SendEmailResponse {
  id: string
}

export interface BatchEmailRequest {
  emails: SendEmailRequest[]
}

export interface BatchEmailResponse {
  data: Array<{ id: string }>
}

export interface GetEmailResponse {
  id: string
  object: 'email'
  to: string[]
  from: string
  created_at: string
  subject: string
  html?: string
  text?: string
  bcc?: string[]
  cc?: string[]
  reply_to?: string[]
  last_event: string
}

// Domain Types
export interface Domain {
  id: string
  name: string
  status: 'pending' | 'verified' | 'failed'
  created_at: string
  region: string
  records?: DomainRecord[]
}

export interface DomainRecord {
  record: string
  name: string
  type: string
  ttl?: string
  status: string
  value: string
  priority?: number
}

export interface DomainCreateRequest {
  name: string
  region?: 'us-east-1' | 'eu-west-1' | 'sa-east-1'
}

export interface DomainVerifyResponse {
  id: string
  status: 'pending' | 'verified' | 'failed'
}

export interface DomainUpdateRequest {
  click_tracking?: boolean
  open_tracking?: boolean
}

// API Key Types
export interface ApiKey {
  id: string
  name: string
  created_at: string
  token?: string // Only returned on creation
}

export interface ApiKeyCreateRequest {
  name: string
  permission?: 'full_access' | 'sending_access'
  domain_id?: string
}

// Audience Types
export interface Audience {
  id: string
  name: string
  created_at: string
}

export interface AudienceCreateRequest {
  name: string
}

// Contact Types
export interface Contact {
  id: string
  email: string
  first_name?: string
  last_name?: string
  unsubscribed: boolean
  created_at: string
}

export interface ContactCreateRequest {
  email: string
  first_name?: string
  last_name?: string
  unsubscribed?: boolean
  audience_id: string
}

export interface ContactUpdateRequest {
  first_name?: string
  last_name?: string
  unsubscribed?: boolean
}

// Response wrapper (Resend SDK style)
export interface ResendResponse<T> {
  data: T | null
  error: ResendErrorDetail | null
}

export interface ResendErrorDetail {
  statusCode: number
  message: string
  name: string
}

// =============================================================================
// ResendError
// =============================================================================

export class ResendError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode: number, code: string = 'resend_error') {
    super(message)
    this.name = 'ResendError'
    this.statusCode = statusCode
    this.code = code
  }
}

// =============================================================================
// Base Resource
// =============================================================================

abstract class ResendResource {
  protected client: ResendClient

  constructor(client: ResendClient) {
    this.client = client
  }

  protected async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<ResendResponse<T>> {
    return this.client._request<T>(method, path, body)
  }
}

// =============================================================================
// Emails Resource
// =============================================================================

export class EmailsResource extends ResendResource {
  /**
   * Send a single email
   */
  async send(request: SendEmailRequest): Promise<ResendResponse<SendEmailResponse>> {
    const validation = this.validateRequest(request)
    if (validation.error) {
      return { data: null, error: validation.error }
    }

    return this.request<SendEmailResponse>('POST', '/emails', request as unknown as Record<string, unknown>)
  }

  /**
   * Get email by ID
   */
  async get(id: string): Promise<ResendResponse<GetEmailResponse>> {
    return this.request<GetEmailResponse>('GET', `/emails/${id}`)
  }

  /**
   * Update email (cancel scheduled)
   */
  async update(id: string, params: { scheduled_at?: string }): Promise<ResendResponse<GetEmailResponse>> {
    return this.request<GetEmailResponse>('PATCH', `/emails/${id}`, params)
  }

  /**
   * Cancel scheduled email
   */
  async cancel(id: string): Promise<ResendResponse<GetEmailResponse>> {
    return this.request<GetEmailResponse>('POST', `/emails/${id}/cancel`)
  }

  private validateRequest(request: SendEmailRequest): { error: ResendErrorDetail | null } {
    if (!request.from) {
      return {
        error: {
          statusCode: 422,
          message: 'The `from` field is required.',
          name: 'validation_error',
        },
      }
    }

    if (!request.to) {
      return {
        error: {
          statusCode: 422,
          message: 'The `to` field is required.',
          name: 'validation_error',
        },
      }
    }

    if (!request.subject) {
      return {
        error: {
          statusCode: 422,
          message: 'The `subject` field is required.',
          name: 'validation_error',
        },
      }
    }

    if (!request.html && !request.text && !request.react) {
      return {
        error: {
          statusCode: 422,
          message: 'At least one of `html`, `text`, or `react` is required.',
          name: 'validation_error',
        },
      }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const fromEmail = request.from.includes('<')
      ? request.from.match(/<([^>]+)>/)?.[1] || request.from
      : request.from

    if (!emailRegex.test(fromEmail)) {
      return {
        error: {
          statusCode: 422,
          message: 'The `from` field must be a valid email address.',
          name: 'validation_error',
        },
      }
    }

    return { error: null }
  }
}

// =============================================================================
// Batch Resource
// =============================================================================

export class BatchResource extends ResendResource {
  /**
   * Send batch emails
   */
  async send(emails: SendEmailRequest[]): Promise<ResendResponse<BatchEmailResponse>> {
    if (!emails || emails.length === 0) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'At least one email is required.',
          name: 'validation_error',
        },
      }
    }

    if (emails.length > 100) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'Maximum 100 emails per batch.',
          name: 'validation_error',
        },
      }
    }

    return this.request<BatchEmailResponse>('POST', '/emails/batch', { emails })
  }
}

// =============================================================================
// Domains Resource
// =============================================================================

export class DomainsResource extends ResendResource {
  /**
   * Create a new domain
   */
  async create(request: DomainCreateRequest): Promise<ResendResponse<Domain>> {
    if (!request.name) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'The `name` field is required.',
          name: 'validation_error',
        },
      }
    }

    return this.request<Domain>('POST', '/domains', request as unknown as Record<string, unknown>)
  }

  /**
   * Get domain by ID
   */
  async get(id: string): Promise<ResendResponse<Domain>> {
    return this.request<Domain>('GET', `/domains/${id}`)
  }

  /**
   * List all domains
   */
  async list(): Promise<ResendResponse<{ data: Domain[] }>> {
    return this.request<{ data: Domain[] }>('GET', '/domains')
  }

  /**
   * Update domain settings
   */
  async update(id: string, params: DomainUpdateRequest): Promise<ResendResponse<Domain>> {
    return this.request<Domain>('PATCH', `/domains/${id}`, params)
  }

  /**
   * Delete domain
   */
  async remove(id: string): Promise<ResendResponse<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>('DELETE', `/domains/${id}`)
  }

  /**
   * Verify domain
   */
  async verify(id: string): Promise<ResendResponse<DomainVerifyResponse>> {
    return this.request<DomainVerifyResponse>('POST', `/domains/${id}/verify`)
  }
}

// =============================================================================
// API Keys Resource
// =============================================================================

export class ApiKeysResource extends ResendResource {
  /**
   * Create a new API key
   */
  async create(request: ApiKeyCreateRequest): Promise<ResendResponse<ApiKey>> {
    if (!request.name) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'The `name` field is required.',
          name: 'validation_error',
        },
      }
    }

    return this.request<ApiKey>('POST', '/api-keys', request as unknown as Record<string, unknown>)
  }

  /**
   * List all API keys
   */
  async list(): Promise<ResendResponse<{ data: ApiKey[] }>> {
    return this.request<{ data: ApiKey[] }>('GET', '/api-keys')
  }

  /**
   * Delete API key
   */
  async remove(id: string): Promise<ResendResponse<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>('DELETE', `/api-keys/${id}`)
  }
}

// =============================================================================
// Audiences Resource
// =============================================================================

export class AudiencesResource extends ResendResource {
  /**
   * Create a new audience
   */
  async create(request: AudienceCreateRequest): Promise<ResendResponse<Audience>> {
    if (!request.name) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'The `name` field is required.',
          name: 'validation_error',
        },
      }
    }

    return this.request<Audience>('POST', '/audiences', request as unknown as Record<string, unknown>)
  }

  /**
   * Get audience by ID
   */
  async get(id: string): Promise<ResendResponse<Audience>> {
    return this.request<Audience>('GET', `/audiences/${id}`)
  }

  /**
   * List all audiences
   */
  async list(): Promise<ResendResponse<{ data: Audience[] }>> {
    return this.request<{ data: Audience[] }>('GET', '/audiences')
  }

  /**
   * Delete audience
   */
  async remove(id: string): Promise<ResendResponse<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>('DELETE', `/audiences/${id}`)
  }
}

// =============================================================================
// Contacts Resource
// =============================================================================

export class ContactsResource extends ResendResource {
  /**
   * Create a new contact
   */
  async create(request: ContactCreateRequest): Promise<ResendResponse<Contact>> {
    if (!request.email) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'The `email` field is required.',
          name: 'validation_error',
        },
      }
    }

    if (!request.audience_id) {
      return {
        data: null,
        error: {
          statusCode: 422,
          message: 'The `audience_id` field is required.',
          name: 'validation_error',
        },
      }
    }

    return this.request<Contact>(
      'POST',
      `/audiences/${request.audience_id}/contacts`,
      request as unknown as Record<string, unknown>
    )
  }

  /**
   * Get contact by ID
   */
  async get(audienceId: string, contactId: string): Promise<ResendResponse<Contact>> {
    return this.request<Contact>('GET', `/audiences/${audienceId}/contacts/${contactId}`)
  }

  /**
   * List contacts in an audience
   */
  async list(audienceId: string): Promise<ResendResponse<{ data: Contact[] }>> {
    return this.request<{ data: Contact[] }>('GET', `/audiences/${audienceId}/contacts`)
  }

  /**
   * Update contact
   */
  async update(audienceId: string, contactId: string, params: ContactUpdateRequest): Promise<ResendResponse<Contact>> {
    return this.request<Contact>('PATCH', `/audiences/${audienceId}/contacts/${contactId}`, params)
  }

  /**
   * Delete contact
   */
  async remove(audienceId: string, contactId: string): Promise<ResendResponse<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>('DELETE', `/audiences/${audienceId}/contacts/${contactId}`)
  }
}

// =============================================================================
// ResendClient
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.resend.com'
const DEFAULT_TIMEOUT = 60000

export class ResendClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number

  // Resources
  readonly emails: EmailsResource
  readonly batch: BatchResource
  readonly domains: DomainsResource
  readonly apiKeys: ApiKeysResource
  readonly audiences: AudiencesResource
  readonly contacts: ContactsResource

  constructor(config: ResendClientConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL
    this.timeout = config.timeout || DEFAULT_TIMEOUT

    // Initialize resources
    this.emails = new EmailsResource(this)
    this.batch = new BatchResource(this)
    this.domains = new DomainsResource(this)
    this.apiKeys = new ApiKeysResource(this)
    this.audiences = new AudiencesResource(this)
    this.contacts = new ContactsResource(this)
  }

  /**
   * Internal method for making API requests
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<ResendResponse<T>> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(body)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)
    fetchOptions.signal = controller.signal

    try {
      const response = await fetch(url, fetchOptions)
      clearTimeout(timeoutId)

      // Handle empty responses
      if (response.status === 204) {
        return { data: null, error: null }
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errorData = data as { statusCode?: number; message?: string; name?: string }
        return {
          data: null,
          error: {
            statusCode: errorData.statusCode || response.status,
            message: errorData.message || `HTTP ${response.status}`,
            name: errorData.name || 'api_error',
          },
        }
      }

      return { data: data as T, error: null }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          data: null,
          error: {
            statusCode: 408,
            message: 'Request timeout',
            name: 'timeout_error',
          },
        }
      }

      return {
        data: null,
        error: {
          statusCode: 500,
          message: error instanceof Error ? error.message : 'Unknown error',
          name: 'network_error',
        },
      }
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export default ResendClient
