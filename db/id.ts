// ID generation utilities for @dotdo/db
// Single source of truth for ID generation across the codebase (do-y5ko)
// Branded types added per do-e3my

import type { ThingId, EventId } from './branded-types'

/**
 * Generate a unique ID using timestamp and random suffix
 * Format: {timestamp-base36}-{random-6-chars}
 * Example: "m5x7y2z-a1b2c3"
 * Returns a branded ThingId for type safety
 */
export function generateId(): ThingId {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as ThingId
}

/**
 * Generate a unique event ID with 'evt-' prefix
 * Format: evt-{timestamp-base36}-{random-4-chars}
 * Example: "evt-m5x7y2z-a1b2"
 * Returns a branded EventId for type safety
 */
export function generateEventId(): EventId {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` as EventId
}
