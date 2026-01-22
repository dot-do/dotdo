/**
 * @dotdo/clickhouse - ClickHouse WASM Analytics
 *
 * High-performance analytics for dotdo using ClickHouse compiled to WebAssembly.
 * Provides a unified analytics API with support for:
 *
 * - Event tracking (page views, custom events)
 * - SQL query execution
 * - Pre-built analytics (funnels, cohorts, retention)
 * - SaaS metrics calculation
 * - Web analytics
 * - Product analytics
 * - Experiments and A/B testing
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { createClickHouseClient } from '@dotdo/clickhouse'
 *
 * // In a Durable Object
 * class BusinessDO extends DO {
 *   private analytics?: AnalyticsClient
 *
 *   get analytics(): AnalyticsClient {
 *     if (!this._analytics) {
 *       this._analytics = await createClickHouseClient(this.state.storage, {
 *         profile: 'standard',
 *         r2: this.env.ANALYTICS_BUCKET
 *       })
 *     }
 *     return this._analytics
 *   }
 *
 *   async trackEvent(input: AnalyticsEventInput) {
 *     await this.analytics.track(input)
 *   }
 *
 *   async getMetrics(period: DateRange) {
 *     return this.analytics.calculateSaaSMetrics(period)
 *   }
 * }
 * ```
 */

// =============================================================================
// Client
// =============================================================================

export {
  createClickHouseClient,
  type AnalyticsClient,
  type RetentionResult,
  type SegmentResult,
  type MemoryStats
} from './client'

// =============================================================================
// Types
// =============================================================================

export type {
  // Configuration
  BuildProfile,
  ClickHouseConfig,

  // Events
  AnalyticsEvent,
  AnalyticsEventInput,
  PageViewInput,
  PageView,
  DeviceInfo,
  GeoInfo,

  // Query
  QueryOptions,
  QueryResult,
  ColumnMeta,
  QueryStatistics,

  // Analytics
  FunnelStep,
  FunnelResult,
  DateRange,
  MetricPeriod,

  // SaaS Metrics
  SaaSMetrics,
  MRRMetrics,
  ChurnMetrics,
  LTVMetrics,

  // Web Analytics
  WebAnalyticsMetrics,

  // Product Analytics
  ProductAnalytics,

  // Experiments
  Experiment,
  Variant,
  ExperimentResults,

  // Storage
  VFSStorageProvider,
  FileStat,
  DirEntry
} from './types'

// =============================================================================
// Providers
// =============================================================================

export { R2Provider, type R2ProviderConfig, type StorageStats } from './providers'
