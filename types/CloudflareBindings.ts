/**
 * CloudflareBindings - Unified Type System for Cloudflare Bindings
 *
 * This module provides a comprehensive type system for all Cloudflare bindings
 * used in the dotdo platform. It supports type-safe access to:
 *
 * - Durable Objects (DO, BROWSER_DO, etc.)
 * - Storage (KV, R2, D1)
 * - AI Services (Workers AI, Vectorize)
 * - Messaging (Queues, Pipelines)
 * - Advanced Features (Hyperdrive, Rate Limiting, Browser Rendering)
 *
 * @module types/CloudflareBindings
 */

// ============================================================================
// DURABLE OBJECT BINDINGS
// ============================================================================

/**
 * Durable Object bindings for the dotdo platform
 *
 * These bindings provide access to persistent, stateful objects
 * that can be globally distributed across Cloudflare's network.
 */
export interface DurableObjectBindings {
  /**
   * Main Durable Object namespace for Things
   * @see ThingsDO
   */
  DO?: DurableObjectNamespace

  /**
   * Browser automation Durable Object namespace
   * @see Browser
   */
  BROWSER_DO?: DurableObjectNamespace

  /**
   * Test Durable Object namespace (dev/test only)
   */
  TEST_DO?: DurableObjectNamespace

  /**
   * Agent Durable Object namespace for AI agents
   */
  AGENT?: DurableObjectNamespace

  /**
   * Workflow Durable Object namespace for durable execution
   * @see Workflow
   */
  WORKFLOW_DO?: DurableObjectNamespace

  /**
   * Integrations Durable Object namespace for OAuth and webhooks
   * @see IntegrationsDO
   */
  INTEGRATIONS_DO?: DurableObjectNamespace

  /**
   * Sandbox Durable Object namespace for code execution
   * @see SandboxDO
   */
  SANDBOX_DO?: DurableObjectNamespace

  /**
   * Identity Durable Object namespace (id.org.ai)
   */
  IDENTITY_DO?: DurableObjectNamespace

  /**
   * Payments Durable Object namespace (payments.do)
   */
  PAYMENTS_DO?: DurableObjectNamespace

  /**
   * Legacy: Workflow binding (deprecated, use WORKFLOW_DO)
   * @deprecated Use WORKFLOW_DO instead
   */
  WORKFLOW?: DurableObjectNamespace

  /**
   * Iceberg Metadata Durable Object namespace for partition planning
   * @see IcebergMetadataDO
   */
  ICEBERG_METADATA?: DurableObjectNamespace

  /**
   * Vector Shard Durable Object namespace for similarity search
   * @see VectorShardDO
   */
  VECTOR_SHARD?: DurableObjectNamespace

  /**
   * Observability Broadcaster Durable Object namespace
   */
  OBS_BROADCASTER?: DurableObjectNamespace

  /**
   * Replica Durable Object namespace for eventual consistency reads
   * Used to route read operations to geo-local replicas
   */
  REPLICA_DO?: DurableObjectNamespace

  /**
   * Collection Durable Object namespace for test collections
   */
  COLLECTION_DO?: DurableObjectNamespace
}

// ============================================================================
// STORAGE BINDINGS
// ============================================================================

/**
 * KV (Key-Value) storage bindings
 *
 * KV provides eventually consistent, low-latency key-value storage
 * suitable for caching, session storage, and configuration.
 */
export interface KVBindings {
  /**
   * Primary KV namespace for application data
   * Used for sessions, API key caching, rate limit state
   */
  KV?: KVNamespace

  /**
   * Test KV namespace (dev/test only)
   */
  TEST_KV?: KVNamespace

  /**
   * Cache KV namespace for expensive computations
   */
  CACHE?: KVNamespace
}

/**
 * R2 (Object Storage) bindings
 *
 * R2 provides S3-compatible object storage with zero egress fees.
 * Used for archives, file uploads, and large data storage.
 */
export interface R2Bindings {
  /**
   * Primary R2 bucket for application data
   * Used for compact() archives, file uploads, Iceberg tables
   */
  R2?: R2Bucket

  /**
   * Archives R2 bucket for historical data
   */
  ARCHIVES?: R2Bucket

  /**
   * Uploads R2 bucket for user file uploads
   */
  UPLOADS?: R2Bucket
}

/**
 * D1 (SQLite Database) bindings
 *
 * D1 provides a serverless SQL database built on SQLite.
 * Used for global relational data that doesn't fit the DO model.
 */
export interface D1Bindings {
  /**
   * Primary D1 database for global data
   */
  DB?: D1Database

  /**
   * Analytics D1 database for read-heavy queries
   */
  ANALYTICS_DB?: D1Database
}

/**
 * Combined storage bindings
 */
export interface StorageBindings extends KVBindings, R2Bindings, D1Bindings {}

// ============================================================================
// AI SERVICE BINDINGS
// ============================================================================

/**
 * Workers AI bindings
 *
 * Provides access to Cloudflare's AI inference models including
 * LLMs, embeddings, image generation, and speech-to-text.
 */
export interface AIBindings {
  /**
   * Workers AI binding for inference
   *
   * Supports models:
   * - Text: @cf/meta/llama-3.1-70b-instruct, @cf/meta/llama-3.1-8b-instruct
   * - Embeddings: @cf/baai/bge-base-en-v1.5
   * - Images: @cf/black-forest-labs/flux-1-schnell
   * - Speech: @cf/openai/whisper
   *
   * @see https://developers.cloudflare.com/workers-ai/
   */
  AI?: Ai

  /**
   * Vectorize index for semantic search
   *
   * Provides vector similarity search for embeddings.
   *
   * @see https://developers.cloudflare.com/vectorize/
   */
  VECTORS?: VectorizeIndex

  /**
   * AI Gateway binding for unified AI access
   *
   * Provides routing, caching, and observability for AI requests.
   *
   * @see https://developers.cloudflare.com/ai-gateway/
   */
  AI_GATEWAY?: Fetcher
}

// ============================================================================
// MESSAGING BINDINGS
// ============================================================================

/**
 * Queue bindings for async job processing
 *
 * Queues provide reliable message delivery with retries
 * and dead letter queue support.
 *
 * Queue operations are handled by lib/cloudflare/queues.ts
 *
 * Queue Types:
 * - EVENTS_QUEUE: Domain event delivery to external systems
 * - JOBS_QUEUE: Background task processing (emails, reports, etc.)
 * - WEBHOOKS_QUEUE: External webhook delivery
 * - DLQ_QUEUE: Dead letter queue for failed messages
 */
export interface QueueBindings {
  /**
   * Events queue for domain event delivery
   * Queue: dotdo-events
   */
  EVENTS_QUEUE?: Queue

  /**
   * Jobs queue for background task processing
   * Queue: dotdo-jobs
   */
  JOBS_QUEUE?: Queue

  /**
   * Webhooks queue for external delivery
   * Queue: dotdo-webhooks
   */
  WEBHOOKS_QUEUE?: Queue

  /**
   * Dead letter queue for failed messages
   * Queue: dotdo-dlq
   */
  DLQ_QUEUE?: Queue

  /**
   * @deprecated Use EVENTS_QUEUE instead
   * Legacy binding for backward compatibility
   */
  QUEUE?: Queue

  /**
   * @deprecated Use DLQ_QUEUE instead
   * Legacy binding for backward compatibility
   */
  DLQ?: Queue
}

/**
 * Pipeline bindings for real-time event streaming
 */
export interface PipelineBindings {
  /**
   * Unified events pipeline for ALL events
   *
   * THE universal event stream for everything:
   * - Domain events (Customer.created, Order.completed)
   * - Telemetry (Request.routed, RPC.called)
   * - Analytics (Session.started, Page.viewed)
   * - Browser insights (Vitals.measured, Error.caught)
   * - DB mutations (Thing.created, Thing.updated)
   * - Workers logs (Worker.invoked, Worker.errored)
   *
   * All events use flat fields (no nesting) for R2/SQL compatibility.
   * Uses Noun.event semantic for the verb field.
   *
   * Falls back to HTTP POST to workers.do/events if not bound.
   *
   * @see lib/events/pipeline.ts
   */
  EVENTS?: Pipeline
}

/**
 * Pipeline interface for event streaming
 */
export interface Pipeline {
  /**
   * Send events to the pipeline
   * @param data - Event data to stream
   */
  send(data: unknown): Promise<void>
}

/**
 * Combined messaging bindings
 */
export interface MessagingBindings extends QueueBindings, PipelineBindings {}

// ============================================================================
// ADVANCED FEATURE BINDINGS
// ============================================================================

/**
 * Hyperdrive bindings for external database connections
 *
 * Hyperdrive provides connection pooling and caching for
 * external PostgreSQL databases.
 */
export interface HyperdriveBindings {
  /**
   * Hyperdrive connection to external database
   *
   * @see https://developers.cloudflare.com/hyperdrive/
   */
  HYPERDRIVE?: Hyperdrive
}

/**
 * Rate limiting bindings
 *
 * Provides request rate limiting with configurable tiers.
 */
export interface RateLimitBindings {
  /**
   * Rate limiter binding
   */
  RATE_LIMIT?: RateLimit
}

/**
 * Browser Rendering bindings
 *
 * Provides headless Chromium for web automation.
 */
export interface BrowserBindings {
  /**
   * Browser Rendering API binding
   *
   * @see https://developers.cloudflare.com/browser-rendering/
   */
  BROWSER?: Fetcher
}

/**
 * Assets bindings for static files
 */
export interface AssetsBindings {
  /**
   * Static assets fetcher
   */
  ASSETS?: Fetcher
}

/**
 * Analytics Engine bindings
 *
 * Provides analytics data collection and querying.
 */
export interface AnalyticsBindings {
  /**
   * Analytics Engine dataset binding
   *
   * @see https://developers.cloudflare.com/analytics/analytics-engine/
   */
  ANALYTICS?: AnalyticsEngineDataset
}

/**
 * Combined advanced feature bindings
 */
export interface AdvancedBindings
  extends HyperdriveBindings,
    RateLimitBindings,
    BrowserBindings,
    AssetsBindings,
    AnalyticsBindings {}

// ============================================================================
// SECRET BINDINGS
// ============================================================================

/**
 * Secret/environment variable bindings
 *
 * These are typically configured via wrangler secrets or environment variables.
 */
export interface SecretBindings {
  /**
   * Stripe secret key for payments
   */
  STRIPE_SECRET_KEY?: string

  /**
   * Stripe webhook secret for verification
   */
  STRIPE_WEBHOOK_SECRET?: string

  /**
   * Platform fee percentage for payments
   */
  PLATFORM_FEE_PERCENT?: string

  /**
   * Browserbase API key for browser automation
   */
  BROWSERBASE_API_KEY?: string

  /**
   * Browserbase project ID
   */
  BROWSERBASE_PROJECT_ID?: string

  // ---- Notification Channel Secrets ----

  /**
   * Slack incoming webhook URL for notifications
   */
  SLACK_WEBHOOK_URL?: string

  /**
   * SendGrid API key for email notifications
   */
  SENDGRID_API_KEY?: string

  /**
   * Default from address for email notifications
   */
  EMAIL_FROM?: string

  /**
   * Twilio account SID for SMS notifications
   */
  TWILIO_ACCOUNT_SID?: string

  /**
   * Twilio auth token for SMS notifications
   */
  TWILIO_AUTH_TOKEN?: string

  /**
   * Twilio phone number for SMS notifications
   */
  TWILIO_PHONE_NUMBER?: string

  /**
   * Discord incoming webhook URL for notifications
   */
  DISCORD_WEBHOOK_URL?: string
}

// ============================================================================
// UNIFIED ENV TYPE
// ============================================================================

/**
 * CloudflareEnv - Unified environment type for all Cloudflare bindings
 *
 * This interface combines all binding categories into a single type
 * that can be used across the application. All bindings are optional
 * to support different deployment configurations.
 *
 * @example
 * ```typescript
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: CloudflareEnv) {
 *     const kv = env.KV
 *     const ai = env.AI
 *     // ...
 *   }
 * }
 *
 * // In a Durable Object
 * class MyDO extends DurableObject<CloudflareEnv> {
 *   async fetch(request: Request) {
 *     const r2 = this.env.R2
 *     // ...
 *   }
 * }
 * ```
 */
export interface CloudflareEnv
  extends DurableObjectBindings,
    StorageBindings,
    AIBindings,
    MessagingBindings,
    AdvancedBindings,
    SecretBindings {
  /**
   * Index signature for additional custom bindings
   * Allows type-safe access to environment variables and custom bindings
   */
  [key: string]: unknown
}

// ============================================================================
// BINDING TYPE GUARDS
// ============================================================================

/**
 * Check if KV binding is available
 */
export function hasKV(env: CloudflareEnv): env is CloudflareEnv & { KV: KVNamespace } {
  return env.KV !== undefined
}

/**
 * Check if R2 binding is available
 */
export function hasR2(env: CloudflareEnv): env is CloudflareEnv & { R2: R2Bucket } {
  return env.R2 !== undefined
}

/**
 * Check if D1 binding is available
 */
export function hasD1(env: CloudflareEnv): env is CloudflareEnv & { DB: D1Database } {
  return env.DB !== undefined
}

/**
 * Check if AI binding is available
 */
export function hasAI(env: CloudflareEnv): env is CloudflareEnv & { AI: Ai } {
  return env.AI !== undefined
}

/**
 * Check if Vectorize binding is available
 */
export function hasVectorize(env: CloudflareEnv): env is CloudflareEnv & { VECTORS: VectorizeIndex } {
  return env.VECTORS !== undefined
}

/**
 * Check if Queue binding is available
 * @deprecated Use hasEventsQueue, hasJobsQueue, or hasWebhooksQueue instead
 */
export function hasQueue(env: CloudflareEnv): env is CloudflareEnv & { QUEUE: Queue } {
  return env.QUEUE !== undefined
}

/**
 * Check if Events Queue binding is available
 */
export function hasEventsQueue(env: CloudflareEnv): env is CloudflareEnv & { EVENTS_QUEUE: Queue } {
  return env.EVENTS_QUEUE !== undefined
}

/**
 * Check if Jobs Queue binding is available
 */
export function hasJobsQueue(env: CloudflareEnv): env is CloudflareEnv & { JOBS_QUEUE: Queue } {
  return env.JOBS_QUEUE !== undefined
}

/**
 * Check if Webhooks Queue binding is available
 */
export function hasWebhooksQueue(env: CloudflareEnv): env is CloudflareEnv & { WEBHOOKS_QUEUE: Queue } {
  return env.WEBHOOKS_QUEUE !== undefined
}

/**
 * Check if DLQ binding is available
 */
export function hasDLQ(env: CloudflareEnv): env is CloudflareEnv & { DLQ_QUEUE: Queue } {
  return env.DLQ_QUEUE !== undefined
}

/**
 * Check if Pipeline binding is available
 */
export function hasPipeline(env: CloudflareEnv): env is CloudflareEnv & { PIPELINE: Pipeline } {
  return env.PIPELINE !== undefined
}

/**
 * Check if Events Pipeline binding is available
 */
export function hasEvents(env: CloudflareEnv): env is CloudflareEnv & { EVENTS: Pipeline } {
  return env.EVENTS !== undefined
}

/**
 * Check if Hyperdrive binding is available
 */
export function hasHyperdrive(env: CloudflareEnv): env is CloudflareEnv & { HYPERDRIVE: Hyperdrive } {
  return env.HYPERDRIVE !== undefined
}

/**
 * Check if Browser binding is available
 */
export function hasBrowser(env: CloudflareEnv): env is CloudflareEnv & { BROWSER: Fetcher } {
  return env.BROWSER !== undefined
}

/**
 * Check if Assets binding is available
 */
export function hasAssets(env: CloudflareEnv): env is CloudflareEnv & { ASSETS: Fetcher } {
  return env.ASSETS !== undefined
}

/**
 * Check if Analytics Engine binding is available
 */
export function hasAnalytics(env: CloudflareEnv): env is CloudflareEnv & { ANALYTICS: AnalyticsEngineDataset } {
  return env.ANALYTICS !== undefined
}

/**
 * Check if Replica DO binding is available
 */
export function hasReplicaDO(env: CloudflareEnv): env is CloudflareEnv & { REPLICA_DO: DurableObjectNamespace } {
  return env.REPLICA_DO !== undefined
}

/**
 * Check if main DO binding is available
 */
export function hasDO(env: CloudflareEnv): env is CloudflareEnv & { DO: DurableObjectNamespace } {
  return env.DO !== undefined
}

// ============================================================================
// BINDING BUILDER PATTERN
// ============================================================================

/**
 * Type helper for creating environment types with required bindings
 *
 * @example
 * ```typescript
 * // Create an env type that requires KV and AI
 * type MyEnv = WithRequiredBindings<'KV' | 'AI'>
 *
 * // Use in a function
 * function processWithAI(env: MyEnv) {
 *   env.KV.put('key', 'value')  // KV is guaranteed
 *   env.AI.fetch(...)           // AI is guaranteed
 * }
 * ```
 */
export type WithRequiredBindings<K extends keyof CloudflareEnv> = CloudflareEnv & {
  [P in K]-?: NonNullable<CloudflareEnv[P]>
}

/**
 * Type helper for environment with storage bindings required
 */
export type WithStorage = WithRequiredBindings<'KV' | 'R2' | 'DB'>

/**
 * Type helper for environment with AI bindings required
 */
export type WithAI = CloudflareEnv & { AI: Ai }

/**
 * Type helper for environment with full AI stack required
 */
export type WithFullAI = WithRequiredBindings<'AI' | 'VECTORS'>

/**
 * Type helper for environment with messaging bindings required
 */
export type WithMessaging = WithRequiredBindings<'EVENTS_QUEUE' | 'JOBS_QUEUE' | 'WEBHOOKS_QUEUE'>

/**
 * Type helper for environment with all queue bindings required
 */
export type WithQueues = WithRequiredBindings<'EVENTS_QUEUE' | 'JOBS_QUEUE' | 'WEBHOOKS_QUEUE' | 'DLQ_QUEUE'>

/**
 * Type helper for environment with all core bindings required
 */
export type WithCoreBindings = WithRequiredBindings<'DO' | 'KV' | 'AI' | 'ASSETS'>

// ============================================================================
// CLOUDFLARE TYPE ALIASES
// ============================================================================

/**
 * Type aliases for Cloudflare binding types
 *
 * These provide local references to globally available types from @cloudflare/workers-types.
 * This enables importing from a single module while maintaining compatibility with
 * the global type declarations.
 *
 * Note: The actual types are declared globally by @cloudflare/workers-types
 * and are available throughout the project without explicit imports.
 */

/** Workers AI binding type - provides access to Cloudflare AI models */
export type CloudflareAi = Ai
/** KV namespace binding type - key-value storage */
export type CloudflareKV = KVNamespace
/** R2 bucket binding type - object storage */
export type CloudflareR2 = R2Bucket
/** D1 database binding type - SQLite database */
export type CloudflareD1 = D1Database
/** Durable Object namespace binding type */
export type CloudflareDO = DurableObjectNamespace
/** Queue binding type - message queues */
export type CloudflareQueue = Queue
/** Vectorize index binding type - vector search */
export type CloudflareVectorize = VectorizeIndex
/** Hyperdrive binding type - connection pooling */
export type CloudflareHyperdrive = Hyperdrive
/** Rate limit binding type - request rate limiting */
export type CloudflareRateLimit = RateLimit
/** Fetcher binding type - HTTP client for service bindings */
export type CloudflareFetcher = Fetcher
/** Analytics Engine dataset binding type */
export type CloudflareAnalytics = AnalyticsEngineDataset

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

/**
 * Env - Legacy alias for CloudflareEnv
 *
 * @deprecated Use CloudflareEnv instead
 */
export type Env = CloudflareEnv

/**
 * BaseEnv - Legacy alias for CloudflareEnv
 *
 * @deprecated Use CloudflareEnv instead
 */
export type BaseEnv = CloudflareEnv
