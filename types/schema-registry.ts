/**
 * Schema.org.ai Type Registry
 *
 * Provides a registry of known schema.org.ai types with URL generation
 * and reverse lookup utilities. All types in the dotdo ecosystem use
 * schema.org.ai URLs for interoperability.
 *
 * @module types/schema-registry
 *
 * @example
 * ```typescript
 * import { TypeRegistry, schemaUrl, typeFromUrl, SCHEMA_BASE } from 'dotdo/types'
 *
 * // Get the URL for a type
 * const url = schemaUrl('Startup') // 'https://schema.org.ai/Startup'
 *
 * // Use pre-defined type URLs
 * const agentUrl = TypeRegistry.Agent // 'https://schema.org.ai/Agent'
 *
 * // Reverse lookup from URL to type name
 * const typeName = typeFromUrl('https://schema.org.ai/Business') // 'Business'
 * ```
 */

/**
 * Base URL for schema.org.ai types
 */
export const SCHEMA_BASE = 'https://schema.org.ai'

/**
 * Generate a full schema.org.ai URL for a type name
 *
 * @param type - The type name (e.g., 'Startup', 'Agent')
 * @returns The full schema.org.ai URL
 *
 * @example
 * ```typescript
 * schemaUrl('Startup') // 'https://schema.org.ai/Startup'
 * schemaUrl('Tool')    // 'https://schema.org.ai/Tool'
 * ```
 */
export function schemaUrl(type: string): string {
  return `${SCHEMA_BASE}/${type}`
}

/**
 * TypeRegistry - Pre-defined schema.org.ai type URLs
 *
 * Registry of commonly used types across the dotdo ecosystem.
 * Use these constants instead of hardcoding URLs for consistency.
 */
export const TypeRegistry = {
  // From @org.ai/types
  Thing: schemaUrl('Thing'),

  // From digital-workers
  Worker: schemaUrl('Worker'),
  Agent: schemaUrl('Agent'),
  Human: schemaUrl('Human'),

  // From digital-products
  Product: schemaUrl('Product'),
  App: schemaUrl('App'),
  API: schemaUrl('API'),
  Site: schemaUrl('Site'),

  // From digital-tools
  Tool: schemaUrl('Tool'),
  Integration: schemaUrl('Integration'),
  Capability: schemaUrl('Capability'),

  // From business-as-code
  Organization: schemaUrl('Organization'),
  Business: schemaUrl('Business'),
  Company: schemaUrl('Company'),
  Org: schemaUrl('Org'),
  Goal: schemaUrl('Goal'),

  // From @saaskit/core
  SaaS: schemaUrl('SaaS'),
  Plan: schemaUrl('Plan'),
  Subscription: schemaUrl('Subscription'),

  // From startup-builder
  /** Startup entity type */
  Startup: schemaUrl('Startup'),
  /** Ideal Customer Profile type */
  ICP: schemaUrl('ICP'),
} as const

/**
 * Union type of all registered type names
 *
 * @example
 * ```typescript
 * const typeName: SchemaType = 'Agent' // OK
 * const invalid: SchemaType = 'Unknown' // Type error
 * ```
 */
export type SchemaType = keyof typeof TypeRegistry

/**
 * Union type of all registered schema.org.ai URLs
 */
export type SchemaUrl = typeof TypeRegistry[SchemaType]

/**
 * Reverse lookup: Get the type name from a schema.org.ai URL
 *
 * @param url - The full schema.org.ai URL
 * @returns The type name if found, undefined otherwise
 *
 * @example
 * ```typescript
 * typeFromUrl('https://schema.org.ai/Business') // 'Business'
 * typeFromUrl('https://schema.org.ai/Agent')    // 'Agent'
 * typeFromUrl('https://example.com/Unknown')    // undefined
 * ```
 */
export function typeFromUrl(url: string): SchemaType | undefined {
  for (const [type, typeUrl] of Object.entries(TypeRegistry)) {
    if (typeUrl === url) return type as SchemaType
  }
  return undefined
}
