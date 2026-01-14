/**
 * Schema.org.ai Type Registry
 * Maps schema.org.ai URLs to types and DO classes
 */

export const SCHEMA_BASE = 'https://schema.org.ai'

// Type URL helpers
export function schemaUrl(type: string): string {
  return `${SCHEMA_BASE}/${type}`
}

// Registry of known types
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
  Startup: schemaUrl('Startup'),
  ICP: schemaUrl('ICP'),
} as const

export type SchemaType = keyof typeof TypeRegistry
export type SchemaUrl = typeof TypeRegistry[SchemaType]

// Reverse lookup
export function typeFromUrl(url: string): SchemaType | undefined {
  for (const [type, typeUrl] of Object.entries(TypeRegistry)) {
    if (typeUrl === url) return type as SchemaType
  }
  return undefined
}
