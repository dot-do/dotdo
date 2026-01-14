/**
 * @dotdo/analytics - Analytics SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Mixpanel, Amplitude, and PostHog SDKs backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with Mixpanel, Amplitude, and PostHog SDKs
 * - Track, identify, alias, group, revenue APIs
 * - User profile operations ($set, $set_once, $add, etc.)
 * - Super properties (global event properties)
 * - Feature flags support
 * - Primitives integration (TemporalStore, WindowManager)
 *
 * @example Basic Usage (Unified API)
 * ```typescript
 * import { Analytics } from '@dotdo/analytics'
 *
 * const analytics = new Analytics({ projectToken: 'your-token' })
 *
 * // Identify a user
 * analytics.identify('user123', {
 *   name: 'John Doe',
 *   email: 'john@example.com',
 * })
 *
 * // Track an event
 * analytics.track('Order Completed', {
 *   orderId: 'order_123',
 *   total: 99.99,
 * })
 *
 * // Flush events
 * await analytics.flush()
 * ```
 *
 * @example Mixpanel-compatible API
 * ```typescript
 * import { Mixpanel } from '@dotdo/analytics'
 *
 * const mixpanel = new Mixpanel({ token: 'your-token' })
 *
 * mixpanel.identify('user123')
 * mixpanel.track('Button Clicked', { button_id: 'signup' })
 *
 * // People API
 * mixpanel.people.set({ plan: 'premium' })
 * mixpanel.people.increment('login_count', 1)
 * ```
 *
 * @example Amplitude-compatible API
 * ```typescript
 * import { Amplitude } from '@dotdo/analytics'
 *
 * const amplitude = new Amplitude({ apiKey: 'your-api-key' })
 *
 * amplitude.setUserId('user123')
 * amplitude.track('Purchase', { product_id: 'prod_123' })
 *
 * // Identify API
 * const identify = new amplitude.Identify()
 * identify.set('plan', 'premium')
 * amplitude.identify(identify)
 *
 * // Revenue API
 * const revenue = new amplitude.Revenue()
 * revenue.setProductId('prod_123').setPrice(9.99).setQuantity(2)
 * amplitude.revenue(revenue)
 * ```
 *
 * @example PostHog-compatible API
 * ```typescript
 * import { PostHog } from '@dotdo/analytics'
 *
 * const posthog = new PostHog({ apiKey: 'phc_your_key' })
 *
 * posthog.identify('user123', { name: 'John Doe' })
 * posthog.capture('Button Clicked', { button_id: 'signup' })
 *
 * // Feature flags
 * if (posthog.isFeatureEnabled('new-checkout')) {
 *   // Show new checkout
 * }
 * ```
 *
 * @see https://developer.mixpanel.com/docs/javascript
 * @see https://amplitude.github.io/Amplitude-TypeScript/
 * @see https://posthog.com/docs/libraries/js
 */

// =============================================================================
// Core Unified API
// =============================================================================

export {
  // Main class
  Analytics,
  createAnalytics,

  // Utilities
  generateMessageId,
  generateAnonymousId,
  getTimestamp,
  buildLibraryContext,
  deepMerge,

  // Transport
  InMemoryTransport,
  type RecordingTransport,

  // Global state
  setAnalytics,
  getAnalytics,
  _clear,
} from './client.js'

// =============================================================================
// Mixpanel-compatible API
// =============================================================================

export {
  // Main class
  Mixpanel,
  createMixpanel,
} from './mixpanel.js'

// =============================================================================
// Amplitude-compatible API
// =============================================================================

export {
  // Main class
  Amplitude,
  createAmplitude,

  // Identify and Revenue classes
  Identify,
  Revenue,
} from './amplitude.js'

// =============================================================================
// PostHog-compatible API
// =============================================================================

export {
  // Main class
  PostHog,
  createPostHog,
} from './posthog.js'

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  Properties,
  UserTraits,
  GroupTraits,
  Context,

  // Event types
  AnalyticsEvent,
  Revenue as RevenueData,
  UserProfile,
  GroupProfile,

  // Batch types
  BatchPayload,

  // Transport types
  TransportResult,
  Transport,
  TransportFactory,

  // Options types
  BaseAnalyticsOptions,
  AnalyticsOptions,
  MixpanelOptions,
  AmplitudeOptions,
  PostHogOptions,

  // Plugin types
  PluginType,
  Plugin,

  // Callback types
  Callback,
  FeatureFlagCallback,

  // Platform-specific types
  AmplitudeEventOptions,
  AmplitudeEvent,
  MixpanelEvent,
  PostHogEvent,

  // Stats types
  EventStats,
  PropertyStats,

  // Survey types
  Survey,
  SurveyQuestion,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

export { Analytics as default } from './client.js'
