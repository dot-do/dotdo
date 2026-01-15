/**
 * @module IntrospectionManager
 * @description Schema introspection for Durable Objects
 *
 * Handles:
 * - $introspect RPC method for schema discovery
 * - HTTP handler for /$introspect endpoint
 * - Role-based filtering of classes, stores, and capabilities
 * - JWT verification for authenticated introspection
 *
 * Extracted from DOBase.ts for better modularity.
 */

import type { AuthContext } from '../transport/auth-layer'
import { createLogger, LogLevel } from '@/lib/logging'
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
import { logBestEffortError } from '../../lib/logging/error-logger'

const introspectionLogger = createLogger({ name: 'introspection', level: LogLevel.DEBUG })

// ============================================================================
// TYPES
// ============================================================================

/**
 * MCP configuration structure for static $mcp
 */
export interface McpConfig {
  tools?: Record<string, {
    description: string
    inputSchema: Record<string, unknown>
    visibility?: VisibilityRole
  }>
  resources?: string[]
}

/**
 * REST configuration structure for static $rest
 */
export interface RestConfig {
  endpoints?: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    path: string
    description?: string
    visibility?: VisibilityRole
  }>
}

/**
 * DO class metadata for introspection
 */
export interface DOClassMetadata {
  name: string
  $type?: string
  $mcp?: McpConfig
  $rest?: RestConfig
}

/**
 * Dependencies required by IntrospectionManager
 */
export interface IntrospectionManagerDeps {
  /** Namespace identifier */
  ns: string

  /** Get the DO class constructor with metadata */
  getClassMetadata: () => DOClassMetadata

  /** Optional: Get JWT secret from environment */
  getJwtSecret?: () => string | undefined

  /** Optional: Query nouns from database */
  queryNouns?: () => Promise<IntrospectNounSchema[]>

  /** Optional: Query verbs from database */
  queryVerbs?: () => Promise<VerbSchema[]>
}

// ============================================================================
// INTROSPECTION MANAGER CLASS
// ============================================================================

/**
 * IntrospectionManager - Manages schema introspection for DOs
 *
 * This class encapsulates all introspection logic, allowing it to be
 * composed into DO classes rather than inherited.
 *
 * @example
 * ```typescript
 * class MyDO extends DOBase {
 *   private introspection = new IntrospectionManager({
 *     ns: this.ns,
 *     getClassMetadata: () => ({
 *       name: this.constructor.name,
 *       $type: (this.constructor as any).$type,
 *       $mcp: (this.constructor as any).$mcp,
 *       $rest: (this.constructor as any).$rest,
 *     }),
 *     getJwtSecret: () => this.env.JWT_SECRET,
 *   })
 *
 *   async $introspect(authContext?: AuthContext) {
 *     return this.introspection.introspect(authContext)
 *   }
 * }
 * ```
 */
export class IntrospectionManager {
  private readonly deps: IntrospectionManagerDeps

  constructor(deps: IntrospectionManagerDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle the /$introspect HTTP route.
   * Requires authentication and returns the DOSchema.
   *
   * @param request - The HTTP request
   * @returns Response with DOSchema or error
   */
  async handleIntrospectRoute(request: Request): Promise<Response> {
    // Only allow GET requests
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // Check for Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Parse JWT from Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Invalid authorization header' }, { status: 401 })
    }

    const token = authHeader.slice(7)

    // Parse and verify the JWT
    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return Response.json({ error: 'Invalid token format' }, { status: 401 })
      }

      // Verify JWT signature if JWT_SECRET is configured
      const jwtSecret = this.deps.getJwtSecret?.()
      if (jwtSecret) {
        const isValid = await this.verifyJwtSignature(token, jwtSecret)
        if (!isValid) {
          return Response.json({ error: 'Invalid token signature' }, { status: 401 })
        }
      } else {
        // In development without JWT_SECRET, log warning but allow request
        introspectionLogger.warn('JWT_SECRET not configured - skipping signature verification')
      }

      const payload = JSON.parse(atob(parts[1]!)) as {
        sub?: string
        email?: string
        name?: string
        roles?: string[]
        permissions?: string[]
        exp?: number
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && payload.exp < now) {
        return Response.json({ error: 'Token expired' }, { status: 401 })
      }

      // Build auth context from JWT claims
      const authContext: AuthContext = {
        authenticated: true,
        user: {
          id: payload.sub || 'anonymous',
          email: payload.email,
          name: payload.name,
          roles: payload.roles || [],
          permissions: payload.permissions || [],
        },
        token: {
          type: 'jwt',
          expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 3600000),
        },
      }

      // Call introspect with auth context
      const schema = await this.introspect(authContext)
      return Response.json(schema)
    } catch (error) {
      return Response.json({ error: 'Invalid token' }, { status: 401 })
    }
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
   *
   * @param authContext - Optional auth context for role-based filtering
   * @returns DOSchema object with introspection data
   */
  async introspect(authContext?: AuthContext): Promise<DOSchema> {
    // Determine role from auth context
    const role = this.determineRole(authContext)
    const scopes = authContext?.user?.permissions || []

    // Build the schema response
    const schema: DOSchema = {
      ns: this.deps.ns,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine the effective role from auth context
   */
  private determineRole(authContext?: AuthContext): VisibilityRole {
    if (!authContext || !authContext.authenticated) {
      return 'public'
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
  private introspectClasses(role: VisibilityRole): DOClassSchema[] {
    const classes: DOClassSchema[] = []

    // Get class info from metadata provider
    const metadata = this.deps.getClassMetadata()
    const className = metadata.$type || metadata.name

    // Determine class visibility based on config
    // Default to 'user' visibility for the class itself
    const classVisibility: VisibilityRole = 'user'

    // Only include class if caller can access it
    if (!canAccessVisibility(role, classVisibility)) {
      return classes
    }

    // Build tools list from $mcp config, filtered by role
    const tools: MCPToolSchema[] = []
    if (metadata.$mcp?.tools) {
      for (const [name, config] of Object.entries(metadata.$mcp.tools)) {
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
    if (metadata.$rest?.endpoints) {
      for (const endpoint of metadata.$rest.endpoints) {
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
      type: 'thing', // Default to 'thing', could be 'collection' for collection DOs
      pattern: `/:type/:id`,
      visibility: classVisibility,
      tools,
      endpoints,
      properties: [], // Could be populated from static schema
      actions: [], // Could be populated from method decorators
    })

    return classes
  }

  /**
   * Introspect available stores, filtered by role
   */
  private introspectStores(role: VisibilityRole): StoreSchema[] {
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
  private introspectStorage(role: VisibilityRole): StorageCapabilities {
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
        buckets: isAdmin ? [] : undefined, // Would list actual buckets from env
      },
      sql: {
        enabled: isAdmin,
        tables: isAdmin ? [] : undefined, // Would list actual tables from schema
      },
      iceberg: isSystem,
      edgevec: isSystem,
    }
  }

  /**
   * Introspect registered nouns
   */
  private async introspectNouns(): Promise<IntrospectNounSchema[]> {
    if (this.deps.queryNouns) {
      return this.deps.queryNouns()
    }
    // Default: return empty array
    return []
  }

  /**
   * Introspect registered verbs
   */
  private async introspectVerbs(): Promise<VerbSchema[]> {
    if (this.deps.queryVerbs) {
      return this.deps.queryVerbs()
    }
    // Default: return empty array
    return []
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JWT VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify JWT signature using HMAC-SHA256.
   *
   * @param token - The full JWT token string
   * @param secret - The secret key for verification
   * @returns true if signature is valid, false otherwise
   */
  private async verifyJwtSignature(token: string, secret: string): Promise<boolean> {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return false

      const signatureInput = `${parts[0]}.${parts[1]}`
      const signature = parts[2]

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      )

      // Base64url decode the signature
      const signatureBytes = this.base64UrlDecode(signature!)

      return await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBytes,
        encoder.encode(signatureInput)
      )
    } catch (error) {
      logBestEffortError(error, {
        operation: 'jwtVerify',
        source: 'IntrospectionManager.verifyJwtSignature',
        context: { ns: this.deps.ns },
      })
      return false
    }
  }

  /**
   * Decode a base64url-encoded string to Uint8Array.
   */
  private base64UrlDecode(str: string): Uint8Array {
    // Replace base64url chars with base64 chars
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
    // Pad with '=' to make it valid base64
    while (base64.length % 4) {
      base64 += '='
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an IntrospectionManager instance
 *
 * @param deps - Dependencies for the manager
 * @returns New IntrospectionManager instance
 */
export function createIntrospectionManager(deps: IntrospectionManagerDeps): IntrospectionManager {
  return new IntrospectionManager(deps)
}
