/**
 * @dotdo/mixpanel - Mixpanel SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for mixpanel npm package backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with mixpanel npm package
 * - Track events with batching
 * - People API for user profiles
 * - Groups API for group analytics
 * - JQL queries
 * - Funnels analytics
 * - Cohorts management
 * - Data Export API
 * - Segmentation and Retention
 *
 * @example Basic Usage
 * ```typescript
 * import { Mixpanel, init } from '@dotdo/mixpanel'
 *
 * const mixpanel = init('your-token')
 *
 * // Track an event
 * mixpanel.track('Button Clicked', {
 *   distinct_id: 'user123',
 *   button_name: 'signup',
 * })
 *
 * // Update user profile
 * mixpanel.people.set('user123', {
 *   $name: 'John Doe',
 *   $email: 'john@example.com',
 *   plan: 'premium',
 * })
 *
 * // Flush events
 * await mixpanel.flush()
 * ```
 *
 * @example With Query APIs (requires secret)
 * ```typescript
 * import { Mixpanel } from '@dotdo/mixpanel'
 *
 * const mixpanel = new Mixpanel({
 *   token: 'your-token',
 *   secret: 'your-secret',
 * })
 *
 * // Run a JQL query
 * const result = await mixpanel.jql?.query({
 *   script: `
 *     function main() {
 *       return Events({ from_date: '2024-01-01', to_date: '2024-01-31' })
 *         .groupBy(['name'], mixpanel.reducer.count())
 *     }
 *   `,
 * })
 *
 * // Get funnel data
 * const funnel = await mixpanel.funnels?.get({
 *   funnel_id: 123,
 *   from_date: '2024-01-01',
 *   to_date: '2024-01-31',
 * })
 *
 * // Export raw data
 * for await (const event of mixpanel.export?.export({
 *   from_date: '2024-01-01',
 *   to_date: '2024-01-31',
 * }) ?? []) {
 *   console.log(event)
 * }
 * ```
 *
 * @see https://developer.mixpanel.com/docs/nodejs
 */

// =============================================================================
// Core API
// =============================================================================

export {
  // Main client class
  Mixpanel,
  createMixpanel,
  init,

  // Sub-APIs
  People,
  Groups,
  DataExport,
  JQL,
  Funnels,
  Segmentation,
  Retention,
  Cohorts,
  Import,

  // Transports
  InMemoryTransport,
  HttpTransport,

  // Result types
  type FunnelResult,
  type FunnelStepData,
  type FunnelMeta,
  type SegmentationResult,
  type RetentionResult,
  type CohortMeta,
  type CohortMembers,
  type RecordingTransport,
} from './mixpanel.js'

// =============================================================================
// Types
// =============================================================================

export type {
  // Configuration
  MixpanelConfig,

  // Track types
  TrackProperties,
  TrackEvent,
  Callback,

  // People types
  PeopleProperties,
  PeopleUpdate,

  // Group types
  GroupProperties,
  GroupUpdate,

  // Import types
  ImportEvent,
  ImportResponse,

  // Query types
  ExportOptions,
  JQLOptions,
  FunnelOptions,
  SegmentationOptions,
  RetentionOptions,
  QueryResult,

  // Response types
  TrackResponse,
  EngageResponse,

  // Transport types
  Transport,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

export { Mixpanel as default } from './mixpanel.js'
