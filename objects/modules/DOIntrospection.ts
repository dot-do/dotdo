/**
 * DOIntrospection Module - Schema discovery
 *
 * This module extracts introspection-related functionality from DOBase:
 * - $introspect() method
 * - introspectClasses() - class/method discovery
 * - introspectStores() - store availability
 * - introspectStorage() - storage capabilities
 * - introspectNouns() / introspectVerbs()
 * - Role-based visibility filtering
 *
 * @module DOIntrospection
 */

import type { AuthContext } from '../transport/auth-layer'
import type {
  DOSchema,
  DOClassSchema,
  MCPToolSchema,
  RESTEndpointSchema,
  StoreSchema,
  StorageCapabilities,
  IntrospectNounSchema,
  VerbSchema,
  VisibilityRole,
} from '../../types/introspect'
import {
  STORE_VISIBILITY,
  canAccessVisibility,
  getHighestRole,
} from '../../types/introspect'

// Re-export types for consumers
export type { AuthContext, DOSchema, VisibilityRole }

/**
 * MCP tool configuration type
 */
interface McpToolConfig {
  description: string
  inputSchema: Record<string, unknown>
  visibility?: VisibilityRole
}

/**
 * REST endpoint configuration type
 */
interface RestEndpointConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description?: string
  visibility?: VisibilityRole
}

/**
 * Introspection context interface
 */
export interface IntrospectContext {
  ns: string
  $type?: string
  $mcp?: {
    tools?: Record<string, McpToolConfig>
    resources?: string[]
  }
  $rest?: {
    endpoints?: RestEndpointConfig[]
  }
}

/**
 * DOIntrospection - Manages schema discovery and introspection
 */
export class DOIntrospection {
  private readonly _context: IntrospectContext

  constructor(context: IntrospectContext) {
    this._context = context
  }

  /**
   * Introspect the DO schema, filtered by user role.
   *
   * Returns information about:
   * - Available classes and their methods
   * - MCP tools from static $mcp config
   * - REST endpoints from static $rest config
   * - Available stores (filtered by role)
   * - Storage capabilities (filtered by role)
   * - Registered nouns and verbs
   */
  async $introspect(authContext?: AuthContext): Promise<DOSchema> {
    // Determine role from auth context
    const role = this.determineRole(authContext)
    const scopes = authContext?.user?.permissions || []

    // Build the schema response
    const schema: DOSchema = {
      ns: this._context.ns,
      permissions: {
        role,
        scopes,
      },
      classes: this.introspectClasses(role),
      nouns: await this.introspectNouns(),
      verbs: await this.introspectVerbs(),
      stores: this.introspectStores(role),
      storage: this.introspectStorage(role),
    }

    return schema
  }

  /**
   * Determine the effective role from auth context
   */
  determineRole(authContext?: AuthContext): VisibilityRole {
    if (!authContext || !authContext.authenticated) {
      return 'guest'
    }

    const roles = authContext.user?.roles || []

    if (roles.length === 0) {
      // Authenticated but no specific roles - default to 'user'
      return 'user'
    }

    return getHighestRole(roles)
  }

  /**
   * Introspect available classes
   */
  introspectClasses(role: VisibilityRole): DOClassSchema[] {
    const classes: DOClassSchema[] = []

    const className = this._context.$type || 'DOBase'

    // Determine class visibility based on config
    const classVisibility: VisibilityRole = 'user'

    // Only include class if caller can access it
    if (!canAccessVisibility(role, classVisibility)) {
      return classes
    }

    // Build tools list from $mcp config, filtered by role
    const tools: MCPToolSchema[] = []
    if (this._context.$mcp?.tools) {
      for (const [name, config] of Object.entries(this._context.$mcp.tools)) {
        const toolVisibility = config.visibility || 'user'
        if (canAccessVisibility(role, toolVisibility)) {
          tools.push({
            name,
            description: config.description,
            inputSchema: config.inputSchema,
          })
        }
      }
    }

    // Build endpoints list from $rest config, filtered by role
    const endpoints: RESTEndpointSchema[] = []
    if (this._context.$rest?.endpoints) {
      for (const endpoint of this._context.$rest.endpoints) {
        const endpointVisibility = endpoint.visibility || 'user'
        if (canAccessVisibility(role, endpointVisibility)) {
          endpoints.push({
            method: endpoint.method,
            path: endpoint.path,
            description: endpoint.description,
          })
        }
      }
    }

    // Build class schema
    classes.push({
      name: className,
      type: 'thing',
      pattern: `/:type/:id`,
      visibility: classVisibility,
      tools,
      endpoints,
      properties: [],
      actions: [],
    })

    return classes
  }

  /**
   * Introspect available stores, filtered by role
   */
  introspectStores(role: VisibilityRole): StoreSchema[] {
    const stores: StoreSchema[] = []

    const storeDefinitions: Array<{ name: string; type: StoreSchema['type'] }> = [
      { name: 'things', type: 'things' },
      { name: 'relationships', type: 'relationships' },
      { name: 'actions', type: 'actions' },
      { name: 'events', type: 'events' },
      { name: 'search', type: 'search' },
      { name: 'objects', type: 'objects' },
      { name: 'dlq', type: 'dlq' },
    ]

    for (const store of storeDefinitions) {
      const storeVisibility = STORE_VISIBILITY[store.type]
      if (canAccessVisibility(role, storeVisibility)) {
        stores.push({
          name: store.name,
          type: store.type,
          visibility: storeVisibility,
        })
      }
    }

    return stores
  }

  /**
   * Introspect storage capabilities, filtered by role
   */
  introspectStorage(role: VisibilityRole): StorageCapabilities {
    // Capability visibility levels:
    // - fsx, gitx: user and above
    // - bashx, r2, sql: admin and above
    // - iceberg, edgevec: system only

    const isUser = canAccessVisibility(role, 'user')
    const isAdmin = canAccessVisibility(role, 'admin')
    const isSystem = canAccessVisibility(role, 'system')

    return {
      fsx: isUser,
      gitx: isUser,
      bashx: isAdmin,
      r2: {
        enabled: isAdmin,
        buckets: isAdmin ? [] : undefined,
      },
      sql: {
        enabled: isAdmin,
        tables: isAdmin ? [] : undefined,
      },
      iceberg: isSystem,
      edgevec: isSystem,
    }
  }

  /**
   * Introspect registered nouns
   */
  async introspectNouns(): Promise<IntrospectNounSchema[]> {
    // TODO: Query nouns from the database
    return []
  }

  /**
   * Introspect registered verbs
   */
  async introspectVerbs(): Promise<VerbSchema[]> {
    // TODO: Query verbs from the database
    return []
  }
}
