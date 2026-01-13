/**
 * API Source Connectors - Stubs
 *
 * REST and GraphQL source connectors for the connector framework.
 * These stubs define the interface - full implementation pending.
 *
 * @module db/primitives/connector-framework/sources/api
 */

import type { Source, SourceState, Record as SourceRecord } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Pagination configuration for API sources
 */
export interface PaginationConfig {
  /** Pagination strategy */
  strategy: 'cursor' | 'offset' | 'page' | 'link'
  /** Field name for page size parameter */
  pageSizeParam?: string
  /** Default page size */
  pageSize?: number
  /** Max page size */
  maxPageSize?: number
  /** Field name for cursor/offset parameter */
  cursorParam?: string
  /** Path to next cursor in response */
  nextCursorPath?: string
  /** Path to data array in response */
  dataPath?: string
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Auth type */
  type: 'none' | 'api-key' | 'bearer' | 'basic' | 'oauth2'
  /** Header name for API key auth */
  headerName?: string
  /** API key value */
  apiKey?: string
  /** Bearer token */
  token?: string
  /** Basic auth username */
  username?: string
  /** Basic auth password */
  password?: string
  /** OAuth2 configuration */
  oauth2?: {
    clientId: string
    clientSecret: string
    tokenUrl: string
    scopes?: string[]
  }
}

/**
 * REST API source configuration
 */
export interface RestApiSourceConfig {
  /** Base URL for the API */
  baseUrl: string
  /** Endpoint path */
  endpoint: string
  /** HTTP method */
  method?: 'GET' | 'POST'
  /** Request headers */
  headers?: Record<string, string>
  /** Query parameters */
  params?: Record<string, string>
  /** Authentication config */
  auth?: AuthConfig
  /** Pagination config */
  pagination?: PaginationConfig
  /** Rate limiting - requests per second */
  rateLimit?: number
  /** Timeout in ms */
  timeout?: number
  /** ID field path in records */
  idField?: string
  /** Updated at field path */
  updatedAtField?: string
}

/**
 * GraphQL source configuration
 */
export interface GraphQLSourceConfig {
  /** GraphQL endpoint URL */
  endpoint: string
  /** GraphQL query */
  query: string
  /** Query variables */
  variables?: Record<string, unknown>
  /** Request headers */
  headers?: Record<string, string>
  /** Authentication config */
  auth?: AuthConfig
  /** Pagination config */
  pagination?: PaginationConfig
  /** Rate limiting - requests per second */
  rateLimit?: number
  /** Timeout in ms */
  timeout?: number
  /** Path to data in response */
  dataPath?: string
  /** ID field path in records */
  idField?: string
}

// ============================================================================
// Factory Functions (Stubs)
// ============================================================================

/**
 * Create a REST API source connector
 */
export function createRestApiSource(_config: RestApiSourceConfig): Source {
  return {
    name: 'rest-api',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op for API sources
    },
  }
}

/**
 * Create a GraphQL source connector
 */
export function createGraphQLSource(_config: GraphQLSourceConfig): Source {
  return {
    name: 'graphql',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op for GraphQL sources
    },
  }
}
