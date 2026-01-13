/**
 * Introspection Types for DO Schema Discovery
 *
 * These types define the structure of the $introspect RPC method response,
 * which provides auto-discovery of DO classes, stores, and storage capabilities
 * filtered by user role.
 *
 * @see {@link DOSchema} for the main introspection response type
 */

// ============================================================================
// VISIBILITY ROLE
// ============================================================================

/**
 * Visibility roles for access control
 * - public: Anyone can access
 * - user: Authenticated users
 * - admin: Administrators
 * - system: System-level access only
 */
export type VisibilityRole = 'public' | 'user' | 'admin' | 'system'

// ============================================================================
// DOSCHEMA - Main Introspection Response
// ============================================================================

/**
 * DOSchema - The response type for $introspect
 * This is the complete schema of a Durable Object, filtered by caller's role.
 */
export interface DOSchema {
  /** Namespace (domain identity) */
  ns: string

  /** Caller's effective permissions */
  permissions: {
    role: VisibilityRole
    scopes: string[]
  }

  /** Available DO classes (filtered by role) */
  classes: DOClassSchema[]

  /** Registered Nouns */
  nouns: IntrospectNounSchema[]

  /** Registered Verbs */
  verbs: VerbSchema[]

  /** Available stores */
  stores: StoreSchema[]

  /** Storage capabilities */
  storage: StorageCapabilities
}

// ============================================================================
// DO CLASS SCHEMA
// ============================================================================

/**
 * DOClassSchema - Describes a Durable Object class
 */
export interface DOClassSchema {
  /** Class name (from static $type) */
  name: string
  /** Type: 'thing' for single-instance, 'collection' for multi-instance */
  type: 'thing' | 'collection'
  /** URL pattern for accessing this class */
  pattern: string // /:type/:id or /:id
  /** Visibility level required to access this class */
  visibility: VisibilityRole
  /** MCP tools exposed by this class */
  tools: MCPToolSchema[]
  /** REST endpoints exposed by this class */
  endpoints: RESTEndpointSchema[]
  /** Properties/fields of this class */
  properties: PropertySchema[]
  /** Actions available on this class */
  actions: ActionSchema[]
}

// ============================================================================
// MCP TOOL SCHEMA
// ============================================================================

import type { McpTool } from './mcp'

/**
 * MCP Tool schema from static $mcp config
 * @description Alias for McpTool for introspection API compatibility
 */
export type MCPToolSchema = McpTool

// ============================================================================
// REST ENDPOINT SCHEMA
// ============================================================================

/**
 * REST endpoint schema from static $rest config
 */
export interface RESTEndpointSchema {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** URL path */
  path: string
  /** Endpoint description */
  description?: string
}

// ============================================================================
// PROPERTY SCHEMA
// ============================================================================

/**
 * Property schema for a DO class
 */
export interface PropertySchema {
  /** Property name */
  name: string
  /** Property type (TypeScript type string) */
  type: string
  /** Whether property is required */
  required?: boolean
  /** Property description */
  description?: string
}

// ============================================================================
// ACTION SCHEMA
// ============================================================================

/**
 * Action schema for a DO class
 */
export interface ActionSchema {
  /** Action name */
  name: string
  /** Action description */
  description?: string
  /** Visibility level required to invoke this action */
  visibility: VisibilityRole
}

// ============================================================================
// NOUN SCHEMA (Introspection)
// ============================================================================

/**
 * Noun schema from the nouns table (for introspection)
 *
 * Note: This is different from NounSchema in Noun.ts which defines field schemas.
 * This type describes noun metadata for introspection responses.
 */
export interface IntrospectNounSchema {
  /** Singular noun name (PascalCase) */
  noun: string
  /** Plural form */
  plural: string
  /** Description */
  description?: string
  /** Associated DO class */
  doClass?: string
}

// ============================================================================
// VERB SCHEMA
// ============================================================================

/**
 * Verb schema from the verbs table
 */
export interface VerbSchema {
  /** Verb name */
  verb: string
  /** Description */
  description?: string
  /** Category (e.g., 'crud', 'lifecycle', 'workflow') */
  category?: string
}

// ============================================================================
// STORE SCHEMA
// ============================================================================

/**
 * Store types available in DO
 */
export type StoreType = 'things' | 'relationships' | 'actions' | 'events' | 'search' | 'objects' | 'dlq'

/**
 * Store schema describing a data store
 */
export interface StoreSchema {
  /** Store name */
  name: string
  /** Store type */
  type: StoreType
  /** Visibility level required to access this store */
  visibility: VisibilityRole
}

// ============================================================================
// STORAGE CAPABILITIES
// ============================================================================

/**
 * Storage capabilities available in the DO
 */
export interface StorageCapabilities {
  /** Filesystem on SQLite (fsx) */
  fsx: boolean
  /** Git on R2 (gitx) */
  gitx: boolean
  /** Shell without VMs (bashx) */
  bashx: boolean
  /** R2 object storage */
  r2: {
    enabled: boolean
    buckets?: string[]
  }
  /** SQL/SQLite storage */
  sql: {
    enabled: boolean
    tables?: string[]
  }
  /** Apache Iceberg analytics */
  iceberg: boolean
  /** Edge vector search */
  edgevec: boolean
}

// ============================================================================
// STORE VISIBILITY DEFINITIONS
// ============================================================================

/**
 * Default visibility levels for each store type
 */
export const STORE_VISIBILITY: Record<StoreType, VisibilityRole> = {
  things: 'user',
  relationships: 'user',
  actions: 'admin',
  events: 'admin',
  search: 'user',
  objects: 'system',
  dlq: 'system',
}

// ============================================================================
// ROLE HIERARCHY
// ============================================================================

/**
 * Role hierarchy for visibility checking
 * Higher index = more access
 */
export const ROLE_HIERARCHY: VisibilityRole[] = ['public', 'user', 'admin', 'system']

/**
 * Check if a role can access a visibility level
 */
export function canAccessVisibility(role: VisibilityRole, visibility: VisibilityRole): boolean {
  const roleIndex = ROLE_HIERARCHY.indexOf(role)
  const visibilityIndex = ROLE_HIERARCHY.indexOf(visibility)
  return roleIndex >= visibilityIndex
}

/**
 * Get the highest role from a list of roles
 */
export function getHighestRole(roles: string[]): VisibilityRole {
  // Priority order: system > admin > user > public
  if (roles.includes('system')) return 'system'
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('user')) return 'user'
  return 'public'
}
