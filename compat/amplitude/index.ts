/**
 * @dotdo/amplitude - Amplitude SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @amplitude/analytics-node backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with @amplitude/analytics-node
 * - Event tracking with automatic batching
 * - User properties with $set, $setOnce, $add, $append, etc.
 * - Revenue tracking
 * - Group analytics
 * - Session management
 * - Plugin system
 *
 * @example Basic Usage
 * ```typescript
 * import { Amplitude, createIdentify, createRevenue } from '@dotdo/amplitude'
 *
 * const client = new Amplitude({ apiKey: 'your-api-key' })
 *
 * // Set user ID
 * client.setUserId('user123')
 *
 * // Track an event
 * await client.track('Button Clicked', { button_name: 'signup' })
 *
 * // Identify user properties
 * const identify = createIdentify()
 *   .set('name', 'John Doe')
 *   .set('email', 'john@example.com')
 *   .add('login_count', 1)
 * await client.identify(identify)
 *
 * // Track revenue
 * const revenue = createRevenue()
 *   .setPrice(29.99)
 *   .setProductId('premium_plan')
 *   .setRevenueType('subscription')
 * await client.revenue(revenue)
 *
 * // Flush events
 * await client.flush()
 * ```
 *
 * @example Group Analytics
 * ```typescript
 * import { Amplitude, createIdentify } from '@dotdo/amplitude'
 *
 * const client = new Amplitude({ apiKey: 'your-api-key' })
 * client.setUserId('user123')
 *
 * // Set group membership
 * await client.setGroup('company', 'acme-inc')
 *
 * // Set group properties
 * const groupIdentify = createIdentify()
 *   .set('name', 'Acme Inc')
 *   .set('industry', 'Technology')
 *   .set('employees', 500)
 * await client.groupIdentify('company', 'acme-inc', groupIdentify)
 *
 * // Track event with group context
 * await client.track('Feature Used', { feature: 'export' }, {
 *   groups: { company: 'acme-inc' }
 * })
 * ```
 *
 * @example With Plugins
 * ```typescript
 * import { Amplitude } from '@dotdo/amplitude'
 *
 * const client = new Amplitude({ apiKey: 'your-api-key' })
 *
 * // Add an enrichment plugin
 * await client.add({
 *   name: 'Enricher',
 *   type: 'enrichment',
 *   setup: async () => {},
 *   execute: async (event) => ({
 *     ...event,
 *     event_properties: {
 *       ...event.event_properties,
 *       app_version: '1.0.0',
 *     },
 *   }),
 * })
 *
 * await client.track('Test Event', {}, { user_id: 'u1' })
 * ```
 *
 * @see https://www.docs.developers.amplitude.com/analytics/sdks/typescript-node/
 */

// =============================================================================
// Core API
// =============================================================================

export {
  // Main client class
  Amplitude,
  createAmplitudeClient,

  // Identify builder
  Identify,
  createIdentify,

  // Revenue builder
  Revenue,
  createRevenue,

  // Transports
  InMemoryTransport,
  FetchTransport,

  // Types
  type ResolvedConfig,
} from './amplitude.js'

// =============================================================================
// Types
// =============================================================================

export type {
  // Configuration
  AmplitudeOptions,
  LogLevel,
  Logger,
  DefaultTrackingOptions,
  Plan,

  // Events
  BaseEvent,
  TrackEventOptions,
  UserPropertyOperations,
  IngestionMetadata,

  // Identify
  Identify as IdentifyInterface,
  GroupIdentify,

  // Cohorts
  CohortDefinition,
  PropertyFilter,
  PropertyOperator,
  EventFilter,
  TimeRange,

  // Analytics
  FunnelStep,
  FunnelConfig,
  FunnelResult,
  FunnelStepResult,
  RetentionConfig,
  RetentionResult,
  RetentionCohort,

  // API
  AmplitudeResponse,
  BatchResponse,
  Plugin,
  Transport,
  ResultCallback,

  // Revenue type from types (distinct from class)
  Revenue as RevenueType,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

export { Amplitude as default } from './amplitude.js'
