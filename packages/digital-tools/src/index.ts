/**
 * @dotdo/digital-tools
 *
 * Tool, Integration, and Capability type definitions for AI primitives.
 * Provides standardized interfaces for connecting AI workers to external
 * services and internal capabilities.
 *
 * @packageDocumentation
 */

// Types
export type { Tool, Integration, Capability } from './types'

// Factory functions
export { createTool, createIntegration, createCapability } from './types'

// Re-export everything (for consumers who prefer * imports)
export * from './types'
