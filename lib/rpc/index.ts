/**
 * RPC Binding Architecture for Capability Modules
 *
 * This module provides type-safe RPC bindings for Cloudflare Workers service bindings,
 * enabling capability modules (AI, KV, R2, D1, etc.) to run as separate Workers.
 *
 * @module lib/rpc
 *
 * @example
 * ```typescript
 * import {
 *   RPCBinding,
 *   createAIBinding,
 *   createCapabilityProxy,
 *   BindingRegistry,
 * } from 'lib/rpc'
 *
 * // Create typed binding for AI service
 * const ai = createAIBinding(env.AI_SERVICE)
 *
 * // Call methods with type safety
 * const result = await ai.call('ai.generate', {
 *   prompt: 'Hello',
 *   temperature: 0.7,
 * })
 *
 * // Or use proxy pattern with auto-fallback
 * const proxy = createCapabilityProxy({
 *   binding: env.AI_SERVICE,
 *   fallback: {
 *     'ai.generate': async (params) => inlineImplementation(params)
 *   }
 * })
 * ```
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Request/Response
  RPCRequest,
  RPCResponse,
  RPCError,
  RPCStreamChunk,

  // Configuration
  RPCBindingConfig,
  RetryPolicy,
  ServiceBinding,

  // Method Definitions
  MethodDefinition,
  CapabilityModule,

  // Proxy Options
  CapabilityProxyOptions,
} from './bindings'

// ============================================================================
// Capability Method Types
// ============================================================================

export type {
  // AI
  AICapabilityMethods,

  // Storage
  KVCapabilityMethods,
  R2CapabilityMethods,
  D1CapabilityMethods,

  // Messaging
  QueueCapabilityMethods,

  // Vector Search
  VectorizeCapabilityMethods,

  // Tools
  ToolCapabilityMethods,

  // Combined
  AllCapabilityMethods,
} from './bindings'

// ============================================================================
// Core Classes
// ============================================================================

export {
  // Main binding class
  RPCBinding,

  // Error classes
  RPCBindingError,
  RPCTimeoutError,
  RPCNetworkError,

  // Registry for managing multiple bindings
  BindingRegistry,
} from './bindings'

// ============================================================================
// Factory Functions
// ============================================================================

export {
  // Capability-specific factories
  createAIBinding,
  createKVBinding,
  createR2Binding,
  createD1Binding,
  createQueueBinding,
  createVectorizeBinding,
  createToolBinding,
  createUnifiedBinding,

  // Proxy pattern for auto-detection
  createCapabilityProxy,
} from './bindings'

// ============================================================================
// Utility Functions
// ============================================================================

export {
  // ID generation
  generateRequestId,

  // Retry utilities
  calculateBackoffDelay,
  isRetryableError,

  // Default configuration
  DEFAULT_RETRY_POLICY,
} from './bindings'
