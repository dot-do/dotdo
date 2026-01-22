/**
 * Type definitions for Parent DO Architecture
 *
 * This module defines the interfaces for:
 * - Parent DO events
 * - R2 buffer configuration
 * - Global query options
 * - Child DO information
 * - Parent context shared with children
 *
 * @module examples/example.com.ai/src/types
 */

/**
 * Event structure for parent DO events
 */
export interface ParentDOEvent {
  $id: string
  type: string
  payload: unknown
  source: string
  childId?: string
  $timestamp: number
}

/**
 * Configuration for R2 buffer behavior
 */
export interface R2BufferConfig {
  maxBufferSize: number
  flushIntervalMs: number
  batchSize: number
}

/**
 * Options for global queries across child DOs
 */
export interface GlobalQueryOptions {
  $type?: string
  filters?: Record<string, unknown>
  limit?: number
  offset?: number
}

/**
 * Information about a registered child DO
 */
export interface ChildDOInfo {
  id: string
  name: string
  domain: string
  lastSeen: number
  eventCount: number
}

/**
 * Parent context that children can access
 */
export interface ParentContext {
  config: Record<string, unknown>
  secrets: Record<string, string>
  metadata: Record<string, unknown>
}

/**
 * R2 flush result
 */
export interface R2FlushResult {
  written: number
  batchId: string
}

/**
 * R2 buffer statistics
 */
export interface R2BufferStats {
  count: number
  oldestTimestamp: number | null
}
