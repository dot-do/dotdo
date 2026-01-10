/**
 * Shared Types for Transport Layer
 *
 * Common type definitions used across multiple transport modules.
 * Centralizes shared types to avoid duplication and ensure consistency.
 */

import type { DurableObjectState } from './handler'

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
 * Used by mixins like `withRpcServer` and `withAuth` to ensure type safety
 * when extending DO classes.
 *
 * @example
 * ```typescript
 * // Use in a mixin function
 * function withMyFeature<T extends DOConstructor>(Base: T) {
 *   return class extends Base {
 *     // Add features...
 *   }
 * }
 *
 * // Apply to a DO class
 * class MyDO extends withMyFeature(DO) {
 *   // ...
 * }
 * ```
 */
export type DOConstructor = new (
  state: DurableObjectState,
  env: Record<string, unknown>
) => any
