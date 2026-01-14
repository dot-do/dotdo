/**
 * @packageDocumentation
 * @module @dotdo/digital-tools
 *
 * Digital tools, integrations, and capabilities for schema.org.ai
 *
 * This package provides standardized type definitions and utilities for
 * connecting AI workers to external services and internal capabilities.
 * All types follow the schema.org.ai specification for interoperability.
 *
 * ## Core Types
 *
 * - {@link Tool} - Generic tool definition for actions workers can perform
 * - {@link Integration} - External service connection (Stripe, Slack, GitHub)
 * - {@link Capability} - Permission and ability definition (fsx, gitx, bashx)
 *
 * ## Validation
 *
 * Each type has a corresponding Zod schema for runtime validation:
 * - {@link ToolSchema}, {@link IntegrationSchema}, {@link CapabilitySchema}
 *
 * ## Type Guards
 *
 * Type guards for runtime type checking with TypeScript narrowing:
 * - {@link isTool}, {@link isIntegration}, {@link isCapability}
 *
 * ## Factory Functions
 *
 * Factory functions that automatically set the `$type` field:
 * - {@link createTool}, {@link createIntegration}, {@link createCapability}
 *
 * @example
 * ```typescript
 * import {
 *   createTool,
 *   createIntegration,
 *   createCapability,
 *   isTool,
 *   isIntegration,
 *   isCapability
 * } from '@dotdo/digital-tools'
 *
 * // Create a tool
 * const searchTool = createTool({
 *   $id: 'https://schema.org.ai/tools/web-search',
 *   name: 'Web Search',
 *   description: 'Search the web for information'
 * })
 *
 * // Create an integration
 * const stripe = createIntegration({
 *   $id: 'https://schema.org.ai/integrations/stripe',
 *   name: 'Stripe',
 *   description: 'Payment processing',
 *   provider: 'stripe',
 *   authType: 'api_key'
 * })
 *
 * // Create a capability
 * const fsx = createCapability({
 *   $id: 'https://schema.org.ai/capabilities/fsx',
 *   name: 'File System Extended',
 *   description: 'Sandboxed file operations',
 *   permissions: ['read', 'write']
 * })
 *
 * // Validate unknown data
 * if (isTool(unknownData)) {
 *   console.log(unknownData.name) // TypeScript knows it's a Tool
 * }
 * ```
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Core type definitions exported as TypeScript types.
 * Use these for type annotations in your code.
 */
export type { Tool, Integration, Capability } from './types'

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schemas for runtime validation.
 * Use these to validate untrusted input or API responses.
 */
export { ToolSchema, IntegrationSchema, CapabilitySchema } from './types'

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard functions for runtime type checking.
 * These narrow TypeScript types when used in conditionals.
 */
export { isTool, isIntegration, isCapability } from './types'

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Factory functions for creating type-safe instances.
 * These automatically set the `$type` field to the correct schema.org.ai URL.
 */
export { createTool, createIntegration, createCapability } from './types'

// ============================================================================
// Wildcard Re-export
// ============================================================================

/**
 * Re-export everything for consumers who prefer `* as` imports.
 * @example
 * ```typescript
 * import * as digitalTools from '@dotdo/digital-tools'
 * const tool = digitalTools.createTool({ ... })
 * ```
 */
export * from './types'
