/**
 * API Types - Shared type definitions for the API layer
 *
 * This module exists to break circular dependencies between api/index.ts
 * and the route files in api/routes/*.
 *
 * By extracting the Env type here, both the main index and routes can
 * import from this shared module without creating import cycles.
 */

// Import and re-export the unified CloudflareEnv type
import type { CloudflareEnv } from '../types/CloudflareBindings'
export type { CloudflareEnv }

/**
 * Env - API-specific environment type extending CloudflareEnv
 *
 * This type ensures the API has access to all required bindings
 * for routing and handling requests. The unified CloudflareEnv
 * provides all optional bindings, while this interface specifies
 * which are required for the API layer.
 *
 * @see CloudflareEnv in types/CloudflareBindings.ts for all available bindings
 */
export interface Env extends CloudflareEnv {
  /** KV namespace - required for sessions and caching */
  KV: KVNamespace
  /** Main Durable Object namespace - required for Things */
  DO: DurableObjectNamespace
  /** Browser Durable Object namespace */
  BROWSER_DO: DurableObjectNamespace
  /** Sandbox Durable Object namespace */
  SANDBOX_DO: DurableObjectNamespace
  /** Collection Durable Object namespace (for test-collection) */
  COLLECTION_DO: DurableObjectNamespace
  /** Observability Broadcaster DO namespace */
  OBS_BROADCASTER: DurableObjectNamespace
  /** Test KV namespace (dev/test only) */
  TEST_KV: KVNamespace
  /** Test DO namespace (dev/test only) */
  TEST_DO: DurableObjectNamespace
  /** Static assets fetcher */
  ASSETS: Fetcher
}
