/**
 * Shared Types for Transport Layer
 *
 * Common type definitions used across multiple transport modules.
 * Centralizes shared types to avoid duplication and ensure consistency.
 */

import type { DurableObjectState } from './handler'

// ============================================================================
// DO INSTANCE INTERFACE
// ============================================================================

/**
 * Base interface for Durable Object instances.
 *
 * Defines the minimum contract that a DO instance must implement to be
 * compatible with transport layer mixins like `withAuth` and capnweb RPC handlers.
 *
 * The `fetch` method is the standard entry point for DO HTTP handling.
 */
export interface DOInstance {
  /**
   * Handle incoming HTTP requests to the Durable Object.
   * This is the standard Cloudflare Workers DO entry point.
   */
  fetch(request: Request): Promise<Response>
}

// ============================================================================
// DO CONSTRUCTOR TYPES
// ============================================================================

/**
 * Constructor type for Durable Object-compatible classes.
 *
 * This type ensures that mixins and factory functions only accept classes
 * that follow the standard Durable Object constructor signature with:
 * - `state`: The DurableObjectState providing access to storage and ID
 * - `env`: Environment bindings configured in wrangler.toml
 *
 * The generic parameter `T` specifies the instance type, defaulting to
 * `DOInstance` which requires a `fetch` method. This enables type-safe
 * mixin patterns without unsafe casts.
 *
 * Used by mixins like `withAuth` and capnweb RPC handlers to ensure type safety
 * when extending DO classes.
 *
 * @example
 * ```typescript
 * // Use in a mixin function - type-safe, no casts needed
 * function withMyFeature<T extends DOConstructor>(Base: T) {
 *   return class extends Base {
 *     async fetch(request: Request): Promise<Response> {
 *       // Can safely call super.fetch because DOInstance has fetch()
 *       return super.fetch(request)
 *     }
 *   }
 * }
 *
 * // Apply to a DO class
 * class MyDO extends withMyFeature(DO) {
 *   // ...
 * }
 * ```
 */
export type DOConstructor<T extends DOInstance = DOInstance> = new (
  state: DurableObjectState,
  env: Record<string, unknown>
) => T
