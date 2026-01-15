/**
 * Unified Pipeline Interface
 *
 * This module defines the canonical Pipeline interface used across the
 * unified-storage system. The batch-oriented design (send(events: unknown[]))
 * is the canonical form because:
 *
 * 1. It's compatible with Cloudflare Pipeline's native batch API
 * 2. It enables efficient batching in PipelineEmitter
 * 3. Single-event callers (like MultiMasterManager) can easily wrap in an array
 *
 * Components that need single-event semantics should use the `sendOne()` helper
 * or wrap their event in an array when calling `send()`.
 *
 * @module unified-storage/types/pipeline
 */

// ============================================================================
// Core Pipeline Interface
// ============================================================================

/**
 * Pipeline interface - batch-oriented event sending
 *
 * This is the canonical interface for Pipeline across unified-storage.
 * All Pipeline implementations MUST support batch sending.
 *
 * @example
 * ```typescript
 * // Batch sending (native)
 * await pipeline.send([event1, event2, event3])
 *
 * // Single event sending
 * await pipeline.send([event])
 * ```
 */
export interface Pipeline {
  /**
   * Send events to the pipeline in batch
   * @param events - Array of events to send
   */
  send(events: unknown[]): Promise<void>
}

/**
 * Extended Pipeline interface with subscription support
 *
 * Used by components that need to receive events (e.g., MultiMasterManager,
 * LeaderFollowerManager). The subscribe method is optional because not all
 * Pipeline implementations support it (e.g., Cloudflare Pipeline is write-only).
 */
export interface SubscribablePipeline extends Pipeline {
  /**
   * Subscribe to receive events
   * @param subscriberId - Unique identifier for the subscriber (e.g., masterId, namespace)
   * @param handler - Callback invoked for each received event
   * @returns Unsubscribe function
   */
  subscribe(subscriberId: string, handler: (event: unknown) => Promise<void> | void): () => void
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Send a single event to a Pipeline
 *
 * Helper function that wraps a single event in an array for callers
 * that work with individual events.
 *
 * @example
 * ```typescript
 * import { sendOne } from './types/pipeline'
 *
 * // Instead of: await pipeline.send([event])
 * await sendOne(pipeline, event)
 * ```
 */
export async function sendOne(pipeline: Pipeline, event: unknown): Promise<void> {
  await pipeline.send([event])
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a Pipeline supports subscription
 */
export function isSubscribablePipeline(pipeline: Pipeline): pipeline is SubscribablePipeline {
  return 'subscribe' in pipeline && typeof (pipeline as SubscribablePipeline).subscribe === 'function'
}
