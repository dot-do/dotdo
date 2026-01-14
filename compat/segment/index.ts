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
 * - Primitives integration (TemporalStore, KeyedRouter, WindowManager)
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
 * @example Batch API
 * ```typescript
 * import { Analytics } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * analytics.batch({
 *   batch: [
 *     { type: 'identify', userId: 'u1', traits: { name: 'Alice' } },
 *     { type: 'track', userId: 'u1', event: 'Signup' },
 *     { type: 'page', userId: 'u1', name: 'Welcome' },
 *   ],
 * })
 *
 * await analytics.flush()
 * ```
 *
 * @example With Destinations
 * ```typescript
 * import { Analytics, BufferDestination } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * // Register a buffer destination for testing
 * const buffer = new BufferDestination()
 * analytics.register(buffer)
 *
 * // Or register a custom destination
 * analytics.register({
 *   name: 'MyDestination',
 *   track: (event) => console.log('Track:', event),
 *   identify: (event) => console.log('Identify:', event),
 *   page: (event) => console.log('Page:', event),
 *   screen: (event) => console.log('Screen:', event),
 *   group: (event) => console.log('Group:', event),
 *   alias: (event) => console.log('Alias:', event),
 * })
 *
 * // Control routing with integrations
 * analytics.track({
 *   userId: 'user123',
 *   event: 'Order Completed',
 *   integrations: {
 *     All: false,
 *     MyDestination: true, // Only send to MyDestination
 *   },
 * })
 * ```
 *
 * @example With Middleware
 * ```typescript
 * import { Analytics } from '@dotdo/segment'
 *
 * const analytics = new Analytics({ writeKey: 'your-write-key' })
 *
 * // Add source middleware
 * analytics.addSourceMiddleware((event) => {
 *   // Enrich all events
 *   return {
 *     ...event,
 *     properties: {
 *       ...event.properties,
 *       enriched: true,
 *     },
 *   }
 * })
 *
 * // Filter events
 * analytics.addSourceMiddleware((event) => {
 *   if (event.event?.startsWith('_internal')) {
 *     return null // Drop internal events
 *   }
 *   return event
 * })
 * ```
 *
 * @example With AnalyticsClient (Primitives Integration)
 * ```typescript
 * import { AnalyticsClient } from '@dotdo/segment'
 *
 * const client = new AnalyticsClient({
 *   writeKey: 'your-write-key',
 *   partitionCount: 16, // For user routing
 *   enableEventStore: true, // Enable temporal event storage
 * })
 *
 * // Route users to partitions for distributed processing
 * const partition = client.getPartition('user123')
 * const userBatches = client.routeUsers(['user1', 'user2', 'user3'])
 * ```
 *
 * @see https://segment.com/docs/connections/sources/catalog/libraries/server/node/
 */

// =============================================================================
// Core API (Segment-compatible)
// =============================================================================

export {
  // Main class (Segment-compatible)
  Analytics,

  // Transport implementations
  InMemoryTransport,
  FetchTransport,

  // Global helpers
  _clear,
  getAnalytics,
  setAnalytics,

  // For testing
  type RecordingTransport,
} from './segment.js'

// =============================================================================
// Extended Client (with primitives)
// =============================================================================

export {
  // Extended client with primitives
  AnalyticsClient,
  createAnalyticsClient,
  type AnalyticsClientOptions,

  // Utilities
  generateMessageId,
  getTimestamp,
  buildLibraryContext,
  deepMerge,
} from './client.js'

// =============================================================================
// Event Tracking
// =============================================================================

export {
  // Event builder
  buildEvent,
  type EventBuilderOptions,

  // Validation
  validateIdentity,
  validateTrackMessage,
  validateGroupMessage,
  validateAliasMessage,

  // Tracker class
  Tracker,
  type EnqueueFn,

  // Standalone event creators
  createIdentifyEvent,
  createTrackEvent,
  createPageEvent,
  createScreenEvent,
  createGroupEvent,
  createAliasEvent,

  // Type guards
  isIdentifyEvent,
  isTrackEvent,
  isPageEvent,
  isScreenEvent,
  isGroupEvent,
  isAliasEvent,
} from './track.js'

// =============================================================================
// Destinations
// =============================================================================

export {
  // Destination manager
  DestinationManager,
  createDestinationManager,
  type DestinationManagerOptions,

  // Built-in destinations
  ConsoleDestination,
  createConsoleDestination,
  WebhookDestination,
  createWebhookDestination,
  BufferDestination,
  createBufferDestination,
  CallbackDestination,
  createCallbackDestination,

  // Middleware helpers
  createDestinationFilter,
  createDestinationEnricher,
  forDestinations,
} from './destinations.js'

// =============================================================================
// Protocols (Schema Validation)
// =============================================================================

export {
  // Tracking Plan
  TrackingPlan,
  createTrackingPlan,

  // Schema Validator
  SchemaValidator,
  createSchemaValidator,

  // Violation Store
  ViolationStore,
  createViolationStore,

  // Protocol Middleware
  createProtocolMiddleware,
  createValidatorWithStore,

  // Built-in tracking plans
  ecommerceTrackingPlan,
  saasTrackingPlan,

  // Types
  type FormatType,
  type PropertyType,
  type PropertySchema,
  type EventSchema,
  type IdentifySchema,
  type GroupSchema,
  type TrackingPlanConfig,
  type ViolationType,
  type Violation,
  type ValidationResult,
  type SchemaValidatorOptions,
  type ValidationStats,
  type ViolationStoreOptions,
  type ViolationSummary,
  type ViolationExport,
  type ProtocolMiddlewareOptions,
} from './protocols.js'

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
// Personas (Computed Traits & Audiences)
// =============================================================================

export {
  // Computed Traits
  ComputedTrait,
  createComputedTrait,

  // Audiences
  Audience,
  createAudience,
  createEnhancedAudience,

  // Personas Engine
  PersonasEngine,
  createPersonasEngine,

  // Audience Builder DSL
  AudienceBuilder,
  audienceBuilder,

  // Prebuilt Audiences
  highValueCustomersAudience,
  atRiskChurnAudience,
  newUsersAudience,
  enterprisePlanAudience,

  // Types
  type ComputedTraitType,
  type ComputedTraitConfig,
  type AudienceConfig,
  type UserProfile,
  type TraitResult,
  type AudienceResult,
  type PersonasEngineOptions,

  // Extended Types
  type TraitExpression,
  type ExpressionComponents,
  type ExpressionCondition,
  type AudienceOperator,
  type AudienceCondition,
  type AudienceRule,
  type EnhancedAudienceConfig,
  type TraitHistoryEntry,
  type TraitHistory,
  type ExternalId,
  type ExtendedUserProfile,
} from './personas.js'

// =============================================================================
// Identity Resolution
// =============================================================================

export {
  // Identity Resolver
  IdentityResolver,
  createIdentityResolver,

  // Types
  type IdentityType,
  type IdentityNode,
  type IdentityEdge,
  type MergedProfile,
  type MergeEvent,
  type IdentityResolverOptions,
  type IdentityExtractor,
  type ProfileQuery,
} from './identity.js'

// =============================================================================
// Source Definitions
// =============================================================================

export {
  // Source class
  Source,
  createSource,

  // Source manager
  SourceManager,
  createSourceManager,

  // Built-in source templates
  createWebsiteSource,
  createServerSource,
  createIOSSource,
  createAndroidSource,
  createCloudSource,

  // Types
  type SourceType,
  type SourcePlatform,
  type SourceConfig,
  type SchemaSettings,
  type EventTransformation,
  type SourceValidationResult,
  type SourceStats,
} from './sources.js'

// =============================================================================
// Default Export
// =============================================================================

export { Analytics as default } from './segment.js'
