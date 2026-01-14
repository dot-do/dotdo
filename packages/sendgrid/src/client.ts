/**
 * @dotdo/sendgrid - SendGrid SDK Compatible Client
 *
 * Full SendGrid API compatible client with resources for:
 * - Mail: Email sending (single, batch, templates)
 * - Templates: CRUD operations for dynamic templates
 * - Contacts: Marketing contacts management
 * - Lists: Contact list management
 * - Stats: Email statistics and analytics
 *
 * @example
 * ```typescript
 * import { SendGridClient } from '@dotdo/sendgrid'
 *
 * const client = new SendGridClient({ apiKey: 'SG.xxx' })
 *
 * // Send email
 * await client.mail.send({
 *   to: 'user@example.com',
 *   from: 'noreply@example.com',
 *   subject: 'Hello',
 *   text: 'Hello World',
 * })
 *
 * // Create template
 * const template = await client.templates.create({
 *   name: 'Welcome Email',
 *   generation: 'dynamic',
 * })
 * ```
 */

import type {
  SendGridMailRequest,
  SendGridPersonalization,
  EmailAddress,
  EmailMessage,
  EmailStatus,
} from './types'
import { ProviderRouter, type ProviderRouterConfig } from './providers'

// =============================================================================
// Types
// =============================================================================

export interface SendGridClientConfig {
  apiKey: string
  host?: string
  timeout?: number
  providers?: ProviderRouterConfig
}

export interface RequestOptions {
  headers?: Record<string, string>
  onBehalfOf?: string
  timeout?: number
}

// Mail Types
export type EmailAddressInput = string | { email: string; name?: string }

export interface MailData {
  to?: EmailAddressInput | EmailAddressInput[]
  from: EmailAddressInput
  cc?: EmailAddressInput | EmailAddressInput[]
  bcc?: EmailAddressInput | EmailAddressInput[]
  subject?: string
  text?: string
  html?: string
  templateId?: string
  dynamicTemplateData?: Record<string, unknown>
  personalizations?: Array<{
    to: EmailAddressInput | EmailAddressInput[]
    cc?: EmailAddressInput | EmailAddressInput[]
    bcc?: EmailAddressInput | EmailAddressInput[]
    subject?: string
    dynamicTemplateData?: Record<string, unknown>
  }>
  attachments?: Array<{
    content: string
    filename: string
    type?: string
    disposition?: 'attachment' | 'inline'
    contentId?: string
  }>
  categories?: string[]
  headers?: Record<string, string>
  customArgs?: Record<string, string>
  sendAt?: number
  isMultiple?: boolean
}

export interface MailSendResponse {
  statusCode: number
  headers: Record<string, string>
  messageId?: string
}

// Template Types
export interface Template {
  id: string
  name: string
  generation: 'legacy' | 'dynamic'
  updated_at?: string
  versions?: TemplateVersion[]
}

export interface TemplateCreateParams {
  name: string
  generation?: 'legacy' | 'dynamic'
}

export interface TemplateUpdateParams {
  name?: string
}

export interface TemplateVersion {
  id: string
  template_id: string
  name: string
  subject?: string
  html_content?: string
  plain_content?: string
  active: 0 | 1
  editor?: 'code' | 'design'
  generate_plain_content?: boolean
  updated_at?: string
}

export interface TemplateVersionCreateParams {
  name: string
  subject?: string
  html_content?: string
  plain_content?: string
  active?: 0 | 1
  editor?: 'code' | 'design'
  generate_plain_content?: boolean
}

export interface TemplateVersionUpdateParams {
  name?: string
  subject?: string
  html_content?: string
  plain_content?: string
  active?: 0 | 1
}

export interface TemplateListParams {
  generations?: 'legacy' | 'dynamic' | 'legacy,dynamic'
  page_size?: number
  page_token?: string
}

export interface TemplateListResponse {
  result: Template[]
  _metadata?: {
    self?: string
    prev?: string
    next?: string
    count?: number
  }
}

// Contact Types
export interface Contact {
  id: string
  email: string
  first_name?: string
  last_name?: string
  alternate_emails?: string[]
  address_line_1?: string
  address_line_2?: string
  city?: string
  state_province_region?: string
  postal_code?: string
  country?: string
  phone_number?: string
  whatsapp?: string
  line?: string
  facebook?: string
  unique_name?: string
  custom_fields?: Record<string, string | number>
  created_at?: string
  updated_at?: string
  list_ids?: string[]
}

export interface ContactCreateParams {
  email: string
  first_name?: string
  last_name?: string
  alternate_emails?: string[]
  address_line_1?: string
  address_line_2?: string
  city?: string
  state_province_region?: string
  postal_code?: string
  country?: string
  phone_number?: string
  whatsapp?: string
  line?: string
  facebook?: string
  unique_name?: string
  custom_fields?: Record<string, string | number>
}

export interface ContactAddOptions {
  list_ids?: string[]
}

export interface ContactAddResponse {
  job_id: string
}

export interface ContactGetByEmailResponse {
  result: Record<string, {
    contact: Contact
  }>
}

export interface ContactSearchParams {
  query: string
}

export interface ContactSearchResponse {
  result: Contact[]
  contact_count: number
}

export interface ContactCountResponse {
  contact_count: number
  billable_count: number
}

export interface ContactExportResponse {
  id: string
  status?: string
  urls?: string[]
}

export interface ContactDeleteParams {
  ids?: string[]
  delete_all_contacts?: boolean
}

export interface ContactDeleteResponse {
  job_id: string
}

// Contact List Types
export interface ContactList {
  id: string
  name: string
  contact_count: number
  _metadata?: {
    self?: string
  }
}

export interface ContactListCreateParams {
  name: string
}

export interface ContactListUpdateParams {
  name?: string
}

export interface ContactListListResponse {
  result: ContactList[]
  _metadata?: {
    count?: number
  }
}

// Stats Types
export interface StatsParams {
  start_date: string
  end_date?: string
  aggregated_by?: 'day' | 'week' | 'month'
}

export interface CategoryStatsParams extends StatsParams {
  categories: string[]
}

export interface SubuserStatsParams extends StatsParams {
  subusers: string[]
}

export interface EmailMetrics {
  requests?: number
  delivered?: number
  opens?: number
  unique_opens?: number
  clicks?: number
  unique_clicks?: number
  bounces?: number
  bounce_drops?: number
  deferred?: number
  blocked?: number
  spam_reports?: number
  spam_report_drops?: number
  unsubscribes?: number
  unsubscribe_drops?: number
  invalid_emails?: number
  processed?: number
}

export interface StatEntry {
  date: string
  stats: Array<{
    type?: string
    name?: string
    metrics: EmailMetrics
  }>
}

export type EmailStats = StatEntry[]

// Error Types
export interface SendGridErrorDetail {
  message: string
  field?: string | null
  error_id?: string
  help?: string
}

// =============================================================================
// SendGridError
// =============================================================================

export class SendGridError extends Error {
  statusCode: number
  errors: SendGridErrorDetail[]

  constructor(message: string, statusCode: number, errors: SendGridErrorDetail[] = []) {
    super(message)
    this.name = 'SendGridError'
    this.statusCode = statusCode
    this.errors = errors
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeEmail(input: EmailAddressInput): { email: string; name?: string } {
  if (typeof input === 'string') {
    const match = input.match(/^(.+?)\s*<(.+)>$/)
    return match ? { email: match[2].trim(), name: match[1].trim() } : { email: input }
  }
  return { email: input.email, name: input.name }
}

function normalizeEmails(input?: EmailAddressInput | EmailAddressInput[]): Array<{ email: string; name?: string }> | undefined {
  if (!input) return undefined
  return (Array.isArray(input) ? input : [input]).map(normalizeEmail)
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationResult {
  valid: boolean
  errors?: { errors: SendGridErrorDetail[] }
}

export function validateSendGridRequest(request: SendGridMailRequest): ValidationResult {
  const errors: SendGridErrorDetail[] = []

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// =============================================================================
// Message Conversion
// =============================================================================

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

// =============================================================================
// Base Resource
// =============================================================================

abstract class SendGridResource {
  protected client: SendGridClient

  constructor(client: SendGridClient) {
    this.client = client
  }

  protected async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    return this.client._request<T>(method, path, params, options)
  }
}

// =============================================================================
// Mail Resource
// =============================================================================

export class MailResource extends SendGridResource {
  private router?: ProviderRouter

  constructor(client: SendGridClient, router?: ProviderRouter) {
    super(client)
    this.router = router
  }

  /**
   * Send a single email
   */
  async send(data: MailData, options?: RequestOptions): Promise<MailSendResponse> {
    const request = this.buildRequest(data)

    // If we have a provider router, use it for sending
    if (this.router) {
      const validation = validateSendGridRequest(request)
      if (!validation.valid) {
        throw new SendGridError(
          validation.errors?.errors[0]?.message || 'Invalid request',
          400,
          validation.errors?.errors
        )
      }

      const messages = convertSendGridToMessages(request)
      for (const message of messages) {
        const result = await this.router.send(message)
        if (!result.success) {
          throw new SendGridError(result.error || 'Failed to send', 500)
        }
      }

      return {
        statusCode: 202,
        headers: { 'x-message-id': messages[0]?.id || crypto.randomUUID() },
        messageId: messages[0]?.id,
      }
    }

    // Otherwise, use the native SendGrid API
    const response = await this.client._sendRaw('/v3/mail/send', request as unknown as Record<string, unknown>, options)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      statusCode: response.status,
      headers,
      messageId: response.headers.get('x-message-id') || undefined,
    }
  }

  /**
   * Send separate emails to multiple recipients
   */
  async sendMultiple(data: MailData, options?: RequestOptions): Promise<MailSendResponse> {
    const recipients = normalizeEmails(data.to) || []
    let lastResponse: MailSendResponse = { statusCode: 202, headers: {} }

    for (const recipient of recipients) {
      const singleData = { ...data, to: recipient }
      lastResponse = await this.send(singleData, options)
    }

    return lastResponse
  }

  private buildRequest(data: MailData): SendGridMailRequest {
    const personalizations = data.personalizations?.map((p) => ({
      to: normalizeEmails(p.to) as EmailAddress[],
      cc: normalizeEmails(p.cc) as EmailAddress[] | undefined,
      bcc: normalizeEmails(p.bcc) as EmailAddress[] | undefined,
      subject: p.subject,
      dynamic_template_data: p.dynamicTemplateData,
    })) || [{
      to: normalizeEmails(data.to) as EmailAddress[],
      cc: normalizeEmails(data.cc) as EmailAddress[] | undefined,
      bcc: normalizeEmails(data.bcc) as EmailAddress[] | undefined,
      dynamic_template_data: data.dynamicTemplateData,
    }]

    const content = data.text || data.html ? [
      ...(data.text ? [{ type: 'text/plain', value: data.text }] : []),
      ...(data.html ? [{ type: 'text/html', value: data.html }] : []),
    ] : undefined

    return {
      personalizations,
      from: normalizeEmail(data.from),
      subject: data.subject,
      content,
      template_id: data.templateId,
      attachments: data.attachments?.map(a => ({
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: a.disposition,
        content_id: a.contentId,
      })),
      categories: data.categories,
      headers: data.headers,
      custom_args: data.customArgs,
      send_at: data.sendAt,
    }
  }
}

// =============================================================================
// Templates Resource
// =============================================================================

export class TemplatesResource extends SendGridResource {
  /**
   * Create a new template
   */
  async create(params: TemplateCreateParams, options?: RequestOptions): Promise<Template> {
    return this.request<Template>('POST', '/v3/templates', {
      name: params.name,
      generation: params.generation || 'dynamic',
    }, options)
  }

  /**
   * Retrieve a template by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Template> {
    return this.request<Template>('GET', `/v3/templates/${id}`, undefined, options)
  }

  /**
   * Update a template
   */
  async update(id: string, params: TemplateUpdateParams, options?: RequestOptions): Promise<Template> {
    return this.request<Template>('PATCH', `/v3/templates/${id}`, params as unknown as Record<string, unknown>, options)
  }

  /**
   * Delete a template
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v3/templates/${id}`, undefined, options)
  }

  /**
   * List all templates
   */
  async list(params?: TemplateListParams, options?: RequestOptions): Promise<TemplateListResponse> {
    return this.request<TemplateListResponse>('GET', '/v3/templates', params as Record<string, unknown>, options)
  }

  /**
   * Create a template version
   */
  async createVersion(
    templateId: string,
    params: TemplateVersionCreateParams,
    options?: RequestOptions
  ): Promise<TemplateVersion> {
    return this.request<TemplateVersion>('POST', `/v3/templates/${templateId}/versions`, params as unknown as Record<string, unknown>, options)
  }

  /**
   * Update a template version
   */
  async updateVersion(
    templateId: string,
    versionId: string,
    params: TemplateVersionUpdateParams,
    options?: RequestOptions
  ): Promise<TemplateVersion> {
    return this.request<TemplateVersion>('PATCH', `/v3/templates/${templateId}/versions/${versionId}`, params as unknown as Record<string, unknown>, options)
  }

  /**
   * Activate a template version
   */
  async activateVersion(templateId: string, versionId: string, options?: RequestOptions): Promise<TemplateVersion> {
    return this.request<TemplateVersion>('POST', `/v3/templates/${templateId}/versions/${versionId}/activate`, undefined, options)
  }

  /**
   * Delete a template version
   */
  async deleteVersion(templateId: string, versionId: string, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v3/templates/${templateId}/versions/${versionId}`, undefined, options)
  }
}

// =============================================================================
// Contacts Resource
// =============================================================================

export class ContactsResource extends SendGridResource {
  /**
   * Add or update contacts
   */
  async add(contacts: ContactCreateParams[], addOptions?: ContactAddOptions, options?: RequestOptions): Promise<ContactAddResponse> {
    return this.request<ContactAddResponse>('PUT', '/v3/marketing/contacts', {
      list_ids: addOptions?.list_ids,
      contacts,
    }, options)
  }

  /**
   * Update contacts (alias for add)
   */
  async update(contacts: ContactCreateParams[], options?: RequestOptions): Promise<ContactAddResponse> {
    return this.add(contacts, undefined, options)
  }

  /**
   * Get contact by ID
   */
  async get(id: string, options?: RequestOptions): Promise<Contact> {
    return this.request<Contact>('GET', `/v3/marketing/contacts/${id}`, undefined, options)
  }

  /**
   * Get contacts by email
   */
  async getByEmail(emails: string[], options?: RequestOptions): Promise<ContactGetByEmailResponse> {
    return this.request<ContactGetByEmailResponse>('POST', '/v3/marketing/contacts/search/emails', {
      emails,
    }, options)
  }

  /**
   * Delete contacts
   */
  async delete(params: ContactDeleteParams, options?: RequestOptions): Promise<ContactDeleteResponse> {
    if (params.delete_all_contacts) {
      return this.request<ContactDeleteResponse>('DELETE', '/v3/marketing/contacts', {
        delete_all_contacts: 'true',
      }, options)
    }
    return this.request<ContactDeleteResponse>('DELETE', '/v3/marketing/contacts', {
      ids: params.ids?.join(','),
    }, options)
  }

  /**
   * Search contacts
   */
  async search(params: ContactSearchParams, options?: RequestOptions): Promise<ContactSearchResponse> {
    return this.request<ContactSearchResponse>('POST', '/v3/marketing/contacts/search', params as unknown as Record<string, unknown>, options)
  }

  /**
   * Get contact count
   */
  async count(options?: RequestOptions): Promise<ContactCountResponse> {
    return this.request<ContactCountResponse>('GET', '/v3/marketing/contacts/count', undefined, options)
  }

  /**
   * Export contacts
   */
  async export(params?: { list_ids?: string[]; segment_ids?: string[] }, options?: RequestOptions): Promise<ContactExportResponse> {
    return this.request<ContactExportResponse>('POST', '/v3/marketing/contacts/exports', params || {}, options)
  }
}

// =============================================================================
// Lists Resource
// =============================================================================

export class ListsResource extends SendGridResource {
  /**
   * Create a new list
   */
  async create(params: ContactListCreateParams, options?: RequestOptions): Promise<ContactList> {
    return this.request<ContactList>('POST', '/v3/marketing/lists', params as unknown as Record<string, unknown>, options)
  }

  /**
   * Get a list by ID
   */
  async get(id: string, options?: RequestOptions): Promise<ContactList> {
    return this.request<ContactList>('GET', `/v3/marketing/lists/${id}`, undefined, options)
  }

  /**
   * Update a list
   */
  async update(id: string, params: ContactListUpdateParams, options?: RequestOptions): Promise<ContactList> {
    return this.request<ContactList>('PATCH', `/v3/marketing/lists/${id}`, params as unknown as Record<string, unknown>, options)
  }

  /**
   * Delete a list
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.request<void>('DELETE', `/v3/marketing/lists/${id}`, undefined, options)
  }

  /**
   * List all lists
   */
  async list(params?: { page_size?: number; page_token?: string }, options?: RequestOptions): Promise<ContactListListResponse> {
    return this.request<ContactListListResponse>('GET', '/v3/marketing/lists', params as Record<string, unknown>, options)
  }

  /**
   * Add contacts to a list
   */
  async addContacts(listId: string, contactIds: string[], options?: RequestOptions): Promise<ContactAddResponse> {
    return this.request<ContactAddResponse>('PUT', `/v3/marketing/lists/${listId}/contacts`, {
      contact_ids: contactIds,
    }, options)
  }

  /**
   * Remove contacts from a list
   */
  async removeContacts(listId: string, contactIds: string[], options?: RequestOptions): Promise<ContactAddResponse> {
    return this.request<ContactAddResponse>('DELETE', `/v3/marketing/lists/${listId}/contacts`, {
      contact_ids: contactIds.join(','),
    }, options)
  }
}

// =============================================================================
// Stats Resource
// =============================================================================

export class StatsResource extends SendGridResource {
  /**
   * Get global email stats
   */
  async global(params: StatsParams, options?: RequestOptions): Promise<EmailStats> {
    return this.request<EmailStats>('GET', '/v3/stats', params as unknown as Record<string, unknown>, options)
  }

  /**
   * Get stats by category
   */
  async categories(params: CategoryStatsParams, options?: RequestOptions): Promise<EmailStats> {
    return this.request<EmailStats>('GET', '/v3/categories/stats', {
      ...params,
      categories: params.categories.join(','),
    } as Record<string, unknown>, options)
  }

  /**
   * Get stats by subuser
   */
  async subusers(params: SubuserStatsParams, options?: RequestOptions): Promise<EmailStats> {
    return this.request<EmailStats>('GET', '/v3/subusers/stats', {
      ...params,
      subusers: params.subusers.join(','),
    } as Record<string, unknown>, options)
  }
}

// =============================================================================
// SendGridClient
// =============================================================================

const DEFAULT_HOST = 'https://api.sendgrid.com'
const DEFAULT_TIMEOUT = 60000

export class SendGridClient {
  private apiKey: string
  private host: string
  private timeout: number
  private router?: ProviderRouter

  // Resources
  readonly mail: MailResource
  readonly templates: TemplatesResource
  readonly contacts: ContactsResource
  readonly lists: ListsResource
  readonly stats: StatsResource

  constructor(config: SendGridClientConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required')
    }

    this.apiKey = config.apiKey
    this.host = config.host || DEFAULT_HOST
    this.timeout = config.timeout || DEFAULT_TIMEOUT

    // Initialize provider router if configured
    if (config.providers) {
      this.router = new ProviderRouter(config.providers)
    }

    // Initialize resources
    this.mail = new MailResource(this, this.router)
    this.templates = new TemplatesResource(this)
    this.contacts = new ContactsResource(this)
    this.lists = new ListsResource(this)
    this.stats = new StatsResource(this)
  }

  /**
   * Internal method for making API requests
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.host)

    // Add query params for GET/DELETE requests
    if ((method === 'GET' || method === 'DELETE') && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    }

    if (options?.onBehalfOf) {
      headers['on-behalf-of'] = options.onBehalfOf
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    // Add body for POST/PATCH/PUT requests
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && params) {
      fetchOptions.body = JSON.stringify(params)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout)
    fetchOptions.signal = controller.signal

    try {
      const response = await fetch(url.toString(), fetchOptions)
      clearTimeout(timeoutId)

      // Handle empty responses (204)
      if (response.status === 204) {
        return undefined as T
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errorData = data as { errors?: SendGridErrorDetail[] }
        throw new SendGridError(
          errorData.errors?.[0]?.message || `HTTP ${response.status}`,
          response.status,
          errorData.errors || []
        )
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof SendGridError) {
        throw error
      }
      throw error
    }
  }

  /**
   * Internal method for sending raw requests (for mail API)
   * @internal
   */
  async _sendRaw(path: string, body: Record<string, unknown>, options?: RequestOptions): Promise<Response> {
    const url = new URL(path, this.host)

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    }

    if (options?.onBehalfOf) {
      headers['on-behalf-of'] = options.onBehalfOf
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options?.timeout || this.timeout)

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const errorData = data as { errors?: SendGridErrorDetail[] }
        throw new SendGridError(
          errorData.errors?.[0]?.message || `HTTP ${response.status}`,
          response.status,
          errorData.errors || []
        )
      }

      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export default SendGridClient
