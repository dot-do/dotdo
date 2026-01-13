/**
 * @dotdo/intercom - Main Client
 *
 * Drop-in replacement for intercom-client SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * const client = new Intercom.Client({ tokenAuth: { token: 'access_token' } })
 *
 * // Create a contact
 * const contact = await client.contacts.create({
 *   role: 'user',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Create a conversation
 * const conversation = await client.conversations.create({
 *   from: { type: 'user', id: contact.id },
 *   body: 'Hello, I need help!',
 * })
 * ```
 *
 * @module @dotdo/intercom/client
 */

import type {
  ClientConfig,
  RequestOptions,
  IntercomErrorResponse,
  IntercomErrorDetail,
  FetchFunction,
} from './types'

import { ContactsResource, type IntercomClientInterface } from './contacts'
import { ConversationsResource, MessagesResource } from './conversations'
import { ArticlesResource } from './articles'
import { EventsResource } from './events'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_VERSION = '2.11'
const DEFAULT_BASE_URL = 'https://api.intercom.io'

// =============================================================================
// Intercom Error Class
// =============================================================================

/**
 * Intercom API Error
 *
 * Thrown when the Intercom API returns an error response.
 *
 * @example
 * ```typescript
 * try {
 *   await client.contacts.find('nonexistent')
 * } catch (error) {
 *   if (error instanceof IntercomError) {
 *     console.log(error.code)        // 'not_found'
 *     console.log(error.statusCode)  // 404
 *     console.log(error.errors)      // Array of error details
 *   }
 * }
 * ```
 */
export class IntercomError extends Error {
  /** Error code from Intercom */
  code: string
  /** HTTP status code */
  statusCode: number
  /** Request ID for debugging */
  requestId?: string
  /** Array of error details */
  errors: IntercomErrorDetail[]

  constructor(errors: IntercomErrorDetail[], statusCode: number, requestId?: string) {
    const message = errors[0]?.message ?? 'Unknown error'
    super(message)
    this.name = 'IntercomError'
    this.code = errors[0]?.code ?? 'unknown'
    this.statusCode = statusCode
    this.requestId = requestId
    this.errors = errors
  }
}

// =============================================================================
// Main Client
// =============================================================================

/**
 * Intercom client for API interactions
 *
 * Provides access to all Intercom API resources through a unified interface.
 *
 * @example
 * ```typescript
 * import Intercom from '@dotdo/intercom'
 *
 * // Create client with token auth
 * const client = new Intercom.Client({
 *   tokenAuth: { token: 'your_access_token' },
 * })
 *
 * // Or with custom API version
 * const client = new Intercom.Client({
 *   tokenAuth: { token: 'your_access_token' },
 *   apiVersion: '2.11',
 * })
 *
 * // Access resources
 * client.contacts    // Manage contacts
 * client.conversations  // Manage conversations
 * client.messages    // Send messages
 * client.events      // Track events
 * client.articles    // Manage articles
 * ```
 */
export class Client implements IntercomClientInterface {
  private token: string
  private apiVersion: string
  private baseUrl: string
  private _fetch: typeof fetch | FetchFunction

  /** Contacts resource for managing users and leads */
  readonly contacts: ContactsResource
  /** Conversations resource for managing conversations */
  readonly conversations: ConversationsResource
  /** Messages resource for sending messages */
  readonly messages: MessagesResource
  /** Events resource for tracking custom events */
  readonly events: EventsResource
  /** Articles resource for managing help center articles */
  readonly articles: ArticlesResource

  constructor(config: ClientConfig) {
    if (!config.tokenAuth?.token) {
      throw new Error('Authentication is required')
    }

    this.token = config.tokenAuth.token
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
    this.baseUrl = DEFAULT_BASE_URL
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.contacts = new ContactsResource(this)
    this.conversations = new ConversationsResource(this)
    this.messages = new MessagesResource(this)
    this.events = new EventsResource(this)
    this.articles = new ArticlesResource(this)
  }

  /**
   * Make a raw API request
   *
   * @internal This method is for internal use by resource classes.
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Intercom-Version': this.apiVersion,
    }

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    // Build request body for POST/PUT/DELETE with params
    let body: string | undefined
    if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && params) {
      body = JSON.stringify(params)
    }

    const response = await this._fetch(url.toString(), {
      method,
      headers,
      body,
    })

    // Handle empty responses (202 Accepted for events)
    if (response.status === 202) {
      return {} as T
    }

    const data = await response.json()

    if (!response.ok) {
      const errorResponse = data as IntercomErrorResponse
      throw new IntercomError(
        errorResponse.errors ?? [{ code: 'unknown', message: 'Unknown error' }],
        response.status,
        errorResponse.request_id
      )
    }

    return data as T
  }
}

// =============================================================================
// Exports
// =============================================================================

export default { Client }
