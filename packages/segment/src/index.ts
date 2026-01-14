/**
 * @dotdo/segment - Segment SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @segment/analytics-node backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with @segment/analytics-node npm package
 * - Analytics APIs: identify, track, page, screen, group, alias
 * - Batch API for bulk events
 * - Automatic context enrichment
 * - Destination forwarding
 * - Source middleware support
 * - Plugin system
 * - In-memory backend for testing
 *
 * @example Basic Usage
 * ```typescript
 * import { Analytics } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * // Identify a user
 * analytics.identify({
 *   userId: 'user123',
 *   traits: {
 *     name: 'John Doe',
 *     email: 'john@example.com',
 *     plan: 'premium',
 *   },
 * })
 *
 * // Track an event
 * analytics.track({
 *   userId: 'user123',
 *   event: 'Order Completed',
 *   properties: {
 *     orderId: 'order_123',
 *     total: 99.99,
 *   },
 * })
 *
 * // Flush events
 * await analytics.flush()
 * ```
 *
 * @example Page and Screen Tracking
 * ```typescript
 * import { Analytics } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * // Page view (web)
 * analytics.page({
 *   userId: 'user123',
 *   name: 'Home',
 *   properties: {
 *     url: 'https://example.com',
 *     referrer: 'https://google.com',
 *   },
 * })
 *
 * // Screen view (mobile)
 * analytics.screen({
 *   userId: 'user123',
 *   name: 'Dashboard',
 *   properties: {
 *     section: 'Overview',
 *   },
 * })
 * ```
 *
 * @example Group and Alias
 * ```typescript
 * import { Analytics } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * // Associate user with a company
 * analytics.group({
 *   userId: 'user123',
 *   groupId: 'company_123',
 *   traits: {
 *     name: 'Acme Inc',
 *     industry: 'Technology',
 *   },
 * })
 *
 * // Alias user IDs
 * analytics.alias({
 *   userId: 'new-user-id',
 *   previousId: 'anon-123',
 * })
 * ```
 *
 * @example With In-Memory Backend (Testing)
 * ```typescript
 * import { Analytics, InMemoryBackend, createInMemoryTransport } from '@dotdo/segment'
 *
 * const backend = new InMemoryBackend()
 * const analytics = new Analytics({
 *   writeKey: 'test-key',
 *   transport: () => createInMemoryTransport(backend),
 * })
 *
 * analytics.identify({ userId: 'user123', traits: { name: 'Test' } })
 * await analytics.flush()
 *
 * const events = backend.getEvents()
 * console.log(events) // [{ type: 'identify', userId: 'user123', ... }]
 * ```
 *
 * @see https://segment.com/docs/connections/sources/catalog/libraries/server/node/
 */

// =============================================================================
// Core API
// =============================================================================

export { Analytics, FetchTransport } from './analytics.js'

// =============================================================================
// In-Memory Backend
// =============================================================================

export {
  InMemoryBackend,
  InMemoryTransport,
  createInMemoryTransport,
  type RecordingTransport,
} from './backend.js'

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  Traits,
  Address,
  Company,
  Properties,
  Integrations,
  Context,

  // Message types
  BaseMessage,
  IdentifyMessage,
  TrackMessage,
  PageMessage,
  ScreenMessage,
  GroupMessage,
  AliasMessage,
  Message,

  // Event types
  EventType,
  SegmentEvent,

  // Batch types
  BatchMessage,
  BatchPayload,

  // Transport types
  TransportResult,
  Transport,
  TransportFactory,

  // Destination types
  Destination,

  // Plugin types
  PluginType,
  Plugin,

  // Middleware types
  SourceMiddleware,
  DestinationMiddleware,

  // Options types
  AnalyticsOptions,
  Callback,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

export { Analytics as default } from './analytics.js'
