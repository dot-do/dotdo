/**
 * @dotdo/intercom - Events Resource
 *
 * Manages Intercom event tracking with support for:
 * - Track custom events
 * - List events for a user
 * - Get event summaries
 *
 * @module @dotdo/intercom/events
 */

import type {
  RequestOptions,
  EventCreateParams,
  EventListParams,
  EventListResponse,
  EventSummaryParams,
  EventSummaryResponse,
} from './types'

import type { IntercomClientInterface } from './contacts'

/**
 * Events resource for tracking custom events
 *
 * @example
 * ```typescript
 * // Track an event
 * await client.events.create({
 *   event_name: 'order-completed',
 *   user_id: 'contact_123',
 *   metadata: { order_id: '123', total: 99.99 },
 * })
 *
 * // List events for a user
 * const events = await client.events.list({
 *   type: 'user',
 *   user_id: 'contact_123',
 * })
 *
 * // Get event summaries
 * const summaries = await client.events.summaries({
 *   user_id: 'contact_123',
 * })
 * ```
 */
export class EventsResource {
  private client: IntercomClientInterface

  constructor(client: IntercomClientInterface) {
    this.client = client
  }

  /**
   * Track an event
   *
   * Events are used to track user behavior and can be used for:
   * - Triggering automated messages
   * - Segmenting users
   * - Understanding user behavior
   *
   * @param params - Event parameters
   * @param options - Request options
   */
  async create(params: EventCreateParams, options?: RequestOptions): Promise<void> {
    const eventParams = {
      ...params,
      created_at: params.created_at ?? Math.floor(Date.now() / 1000),
    }
    await this.client._request('POST', '/events', eventParams as Record<string, unknown>, options)
  }

  /**
   * List events for a user
   *
   * @param params - List parameters
   * @param options - Request options
   * @returns Event list
   */
  async list(params: EventListParams, options?: RequestOptions): Promise<EventListResponse> {
    return this.client._request('GET', '/events', params as Record<string, unknown>, options)
  }

  /**
   * Get event summaries for a user
   *
   * Returns aggregated event counts for a user.
   *
   * @param params - Summary parameters
   * @param options - Request options
   * @returns Event summaries
   */
  async summaries(params: EventSummaryParams, options?: RequestOptions): Promise<EventSummaryResponse> {
    return this.client._request('GET', '/events/summaries', params as Record<string, unknown>, options)
  }
}
