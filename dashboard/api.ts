/**
 * DO Dashboard API Factory
 *
 * Creates a Hono-compatible request handler that serves the DO Dashboard
 * as a JSON REST API with HATEOAS links.
 *
 * Three outputs from one codebase:
 * - REST API (JSON + HATEOAS links)
 * - CLI Dashboard (terminal UI)
 * - Web Admin (browser UI)
 *
 * @example
 * ```typescript
 * import { API } from 'dotdo/dashboard'
 *
 * // Basic usage
 * export default API()
 *
 * // With configuration
 * export default API({
 *   config: './do.config.ts',
 *   ns: 'my-namespace',
 *   debug: true,
 * })
 * ```
 *
 * @module dashboard/api
 */

import { Hono } from 'hono'

/**
 * Configuration options for the Dashboard API
 */
export interface APIOptions {
  /**
   * Path to do.config.ts file
   * Defaults to looking in CWD for do.config.ts
   */
  config?: string

  /**
   * Namespace for the dashboard
   * Used for generating links and context
   */
  ns?: string

  /**
   * Enable debug mode
   * Adds additional logging and debug endpoints
   */
  debug?: boolean
}

/**
 * HATEOAS Link object
 */
export interface Link {
  href: string
  rel?: string
  type?: string
  title?: string
  templated?: boolean
}

/**
 * Links collection for HATEOAS responses
 */
export interface Links {
  self: Link
  schema?: Link
  data?: Link
  collection?: Link
  items?: Link[]
  next?: Link
  prev?: Link
  first?: Link
  last?: Link
  [key: string]: Link | Link[] | undefined
}

/**
 * Base HATEOAS response format
 */
export interface HATEOASResponse {
  _links: Links
  [key: string]: unknown
}

/**
 * Root resource response
 */
export interface RootResource extends HATEOASResponse {
  name: string
  version: string
  description?: string
}

/**
 * Schema type definition
 */
export interface SchemaType {
  name: string
  type: 'thing' | 'collection'
  properties: Record<string, PropertySchema>
  actions?: string[]
}

/**
 * Property schema
 */
export interface PropertySchema {
  type: string
  required?: boolean
  description?: string
  format?: string
}

/**
 * Schema collection response
 */
export interface SchemaResponse extends HATEOASResponse {
  types: SchemaType[]
}

/**
 * Single type schema response
 */
export interface TypeSchemaResponse extends HATEOASResponse, SchemaType {}

/**
 * Data collection response
 */
export interface DataCollectionResponse extends HATEOASResponse {
  collections: Array<{
    name: string
    count: number
    _links: Links
  }>
}

/**
 * Items collection response (paginated)
 */
export interface ItemsResponse extends HATEOASResponse {
  items: Array<Record<string, unknown> & { _links: Links }>
  total: number
  limit: number
  offset: number
}

/**
 * Single item response
 */
export interface ItemResponse extends HATEOASResponse {
  [key: string]: unknown
}

/**
 * OpenAPI 3.0 Specification
 */
export interface OpenAPISpec {
  openapi: '3.0.0'
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
  }
  security?: Array<Record<string, string[]>>
}

/**
 * Create a DO Dashboard API handler
 *
 * @param options - Configuration options
 * @returns Hono application instance
 */
export function API(options?: APIOptions): Hono {
  throw new Error('Not implemented: API')
}

// Default export for convenience
export default API
