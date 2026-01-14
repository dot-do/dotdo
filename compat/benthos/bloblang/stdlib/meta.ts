/**
 * GREEN Phase: Bloblang stdlib meta functions implementation
 * Issue: dotdo-l9m3f (Milestone 2)
 *
 * Implements metadata, error handling, counters, and time functions for Bloblang.
 */

import { BenthosMessage } from '../../core/message'

export interface BloblangContext {
  message: BenthosMessage
  [key: string]: unknown
}

// Per-context counter storage
const counterStore = new WeakMap<BloblangContext, Map<string, number>>()

/**
 * Get metadata value from message
 * @param key - The metadata key to retrieve
 * @returns The metadata value or undefined if not found
 */
export function meta(this: BloblangContext, key: string): string | undefined {
  if (!this || !this.message) {
    throw new Error('meta() requires a valid context with message')
  }
  return this.message.metadata.get(key)
}

/**
 * Set metadata key-value pair, returns new message with updated metadata
 * @param key - The metadata key to set
 * @param value - The metadata value to set
 * @returns New BenthosMessage with updated metadata
 */
export function meta_set(this: BloblangContext, key: string, value: string): BenthosMessage {
  if (!this || !this.message) {
    throw new Error('meta_set() requires a valid context with message')
  }
  return this.message.withMetadata({ [key]: value })
}

/**
 * Get the current error message
 * @returns The error message string or undefined if no error
 */
export function error(this: BloblangContext): string | undefined {
  if (!this || !this.message) {
    throw new Error('error() requires a valid context with message')
  }
  const err = this.message.getError()
  return err?.message
}

/**
 * Check if the message is in an error state
 * @returns true if message has an error, false otherwise
 */
export function errored(this: BloblangContext): boolean {
  if (!this || !this.message) {
    throw new Error('errored() requires a valid context with message')
  }
  return this.message.hasError()
}

/**
 * Increment and return a counter value
 * Per-context counter that increments on each call
 * @param name - The counter name
 * @returns The incremented counter value
 */
export function count(this: BloblangContext, name: string): number {
  if (!this || !this.message) {
    throw new Error('count() requires a valid context with message')
  }

  // Get or create counter map for this context
  let counters = counterStore.get(this)
  if (!counters) {
    counters = new Map<string, number>()
    counterStore.set(this, counters)
  }

  // Increment counter
  const currentValue = counters.get(name) ?? 0
  const newValue = currentValue + 1
  counters.set(name, newValue)

  return newValue
}

/**
 * Generate a random RFC 4122 version 4 UUID
 * @returns A UUID v4 string in the format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function uuid_v4(this: BloblangContext): string {
  if (!this || !this.message) {
    throw new Error('uuid_v4() requires a valid context with message')
  }

  // Generate random bytes
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // Set version (4) in the 7th byte, bits 12-15
  bytes[6] = (bytes[6] & 0x0f) | 0x40

  // Set variant (10xx) in the 9th byte, bits 6-7
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  // Convert to hex string with dashes
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Get current timestamp as ISO 8601 string
 * @returns ISO 8601 formatted timestamp string
 */
export function now(this: BloblangContext): string {
  if (!this || !this.message) {
    throw new Error('now() requires a valid context with message')
  }
  return new Date().toISOString()
}

/**
 * Get current Unix timestamp in seconds
 * @returns Unix timestamp as integer seconds
 */
export function timestamp_unix(this: BloblangContext): number {
  if (!this || !this.message) {
    throw new Error('timestamp_unix() requires a valid context with message')
  }
  return Math.floor(Date.now() / 1000)
}

/**
 * Get current Unix timestamp in nanoseconds
 * @returns Unix timestamp as bigint nanoseconds
 */
export function timestamp_unix_nano(this: BloblangContext): bigint {
  if (!this || !this.message) {
    throw new Error('timestamp_unix_nano() requires a valid context with message')
  }
  // JavaScript Date.now() gives milliseconds
  // Convert to nanoseconds: ms * 1,000,000
  return BigInt(Date.now()) * BigInt(1_000_000)
}
