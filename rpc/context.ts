/**
 * $Context - Request-scoped context for RPC and WebSocket calls
 *
 * Carries tenant, auth, and request metadata through the entire call chain:
 * - Client -> Worker -> DO (via headers)
 * - DO -> DO (via cross-DO RPC headers)
 * - WebSocket connection (associated on upgrade, available in message handlers)
 *
 * The context is **immutable** once created. All properties are deeply readonly.
 *
 * @module rpc/context
 */

import { generateCorrelationId, CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from './headers'

// ============================================================================
// Constants
// ============================================================================

/** Header prefix for $Context fields */
export const CONTEXT_HEADER_PREFIX = 'X-Context-'

/** Header names for context propagation */
export const CONTEXT_HEADERS = {
  TENANT_ID: `${CONTEXT_HEADER_PREFIX}Tenant-ID`,
  USER_ID: `${CONTEXT_HEADER_PREFIX}User-ID`,
  AGENT_ID: `${CONTEXT_HEADER_PREFIX}Agent-ID`,
  SESSION_ID: `${CONTEXT_HEADER_PREFIX}Session-ID`,
  PERMISSIONS: `${CONTEXT_HEADER_PREFIX}Permissions`,
  CAPABILITIES: `${CONTEXT_HEADER_PREFIX}Capabilities`,
} as const

// ============================================================================
// Types
// ============================================================================

/**
 * Permission level for the caller
 */
export type PermissionLevel = 'read' | 'write' | 'admin' | 'owner'

/**
 * Request metadata extracted from the incoming request
 */
export interface RequestMeta {
  /** Client IP address */
  readonly ip?: string
  /** User-Agent header */
  readonly userAgent?: string
  /** Request origin */
  readonly origin?: string
  /** Cloudflare colo where the request was processed */
  readonly colo?: string
  /** ISO 8601 timestamp when the context was created */
  readonly timestamp: string
  /** Country code from CF headers */
  readonly country?: string
}

/**
 * $Context — the typed, immutable context that flows through RPC and WebSocket calls.
 *
 * Created once per request/connection. Passed via headers for RPC, and associated
 * with the WebSocket connection for message handlers.
 *
 * All properties are readonly to enforce immutability.
 *
 * @example
 * ```typescript
 * // Extract from incoming Hono request
 * const ctx = extractContext(c)
 *
 * // Available in RPC handlers
 * async function handleCreateCustomer($ctx: $Context, data: CustomerData) {
 *   console.log($ctx.tenantId)  // 'acme'
 *   console.log($ctx.userId)    // 'user_abc123'
 * }
 *
 * // Propagated through cross-DO calls
 * const headers = contextToHeaders($ctx)
 * ```
 */
export interface $Context {
  /** Correlation ID for distributed tracing */
  readonly correlationId: string
  /** Tenant identifier (from URL path or subdomain) */
  readonly tenantId: string
  /** Authenticated user ID (from JWT or session) */
  readonly userId?: string
  /** Agent ID if the caller is an AI agent */
  readonly agentId?: string
  /** Session identifier for grouping related requests */
  readonly sessionId?: string
  /** Caller's permission level */
  readonly permissions: readonly PermissionLevel[]
  /** Specific capabilities granted to the caller */
  readonly capabilities: readonly string[]
  /** Whether this is a trusted internal call (DO-to-DO or Worker-to-DO) */
  readonly trusted: boolean
  /** Source DO ID for DO-to-DO calls */
  readonly sourceDoId?: string
  /** Request metadata */
  readonly request: RequestMeta
}

/**
 * Input for creating a $Context. Unlike $Context itself, fields are optional
 * and mutable — the factory freezes them.
 */
export interface $ContextInput {
  correlationId?: string
  tenantId: string
  userId?: string
  agentId?: string
  sessionId?: string
  permissions?: PermissionLevel[]
  capabilities?: string[]
  trusted?: boolean
  sourceDoId?: string
  request?: Partial<RequestMeta>
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an immutable $Context from input.
 *
 * Generates a correlationId if not provided, and deep-freezes the result
 * so it cannot be mutated after creation.
 *
 * @param input - The context input
 * @returns A frozen, immutable $Context
 *
 * @example
 * ```typescript
 * const ctx = createContext({
 *   tenantId: 'acme',
 *   userId: 'user_abc123',
 *   permissions: ['read', 'write'],
 * })
 *
 * ctx.tenantId = 'other' // TypeError: Cannot assign to read-only property
 * ```
 */
export function createContext(input: $ContextInput): $Context {
  const requestMeta: RequestMeta = Object.freeze({
    ip: input.request?.ip,
    userAgent: input.request?.userAgent,
    origin: input.request?.origin,
    colo: input.request?.colo,
    timestamp: input.request?.timestamp ?? new Date().toISOString(),
    country: input.request?.country,
  })

  const context: $Context = {
    correlationId: input.correlationId ?? generateCorrelationId(),
    tenantId: input.tenantId,
    userId: input.userId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    permissions: Object.freeze([...(input.permissions ?? [])]),
    capabilities: Object.freeze([...(input.capabilities ?? [])]),
    trusted: input.trusted ?? false,
    sourceDoId: input.sourceDoId,
    request: requestMeta,
  }

  return Object.freeze(context)
}

/**
 * Create a minimal anonymous context (for unauthenticated requests).
 *
 * @param tenantId - The tenant identifier
 * @param requestMeta - Optional request metadata
 * @returns A frozen anonymous $Context with no user/agent
 */
export function createAnonymousContext(tenantId: string, requestMeta?: Partial<RequestMeta>): $Context {
  return createContext({
    tenantId,
    permissions: ['read'],
    capabilities: [],
    trusted: false,
    request: requestMeta,
  })
}

// ============================================================================
// Header Serialization / Deserialization
// ============================================================================

/**
 * Serialize a $Context into HTTP headers for propagation through RPC calls.
 *
 * The context is split across multiple headers so it flows transparently
 * through cross-DO and cross-worker communication.
 *
 * @param ctx - The context to serialize
 * @returns Headers object with context fields
 */
export function contextToHeaders(ctx: $Context): Record<string, string> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: ctx.correlationId,
    [CONTEXT_HEADERS.TENANT_ID]: ctx.tenantId,
  }

  if (ctx.userId) {
    headers[CONTEXT_HEADERS.USER_ID] = ctx.userId
  }

  if (ctx.agentId) {
    headers[CONTEXT_HEADERS.AGENT_ID] = ctx.agentId
  }

  if (ctx.sessionId) {
    headers[CONTEXT_HEADERS.SESSION_ID] = ctx.sessionId
  }

  if (ctx.permissions.length > 0) {
    headers[CONTEXT_HEADERS.PERMISSIONS] = ctx.permissions.join(',')
  }

  if (ctx.capabilities.length > 0) {
    headers[CONTEXT_HEADERS.CAPABILITIES] = ctx.capabilities.join(',')
  }

  if (ctx.trusted) {
    headers[DO_SOURCE_HEADER] = 'true'
  }

  if (ctx.sourceDoId) {
    headers[DO_SOURCE_ID_HEADER] = ctx.sourceDoId
  }

  return headers
}

/**
 * Deserialize a $Context from HTTP headers.
 *
 * This is the inverse of `contextToHeaders`. Used on the receiving side
 * of an RPC call to reconstruct the caller's context.
 *
 * @param headers - The incoming headers (Headers object or plain record)
 * @returns A frozen $Context or null if tenantId is missing
 */
export function contextFromHeaders(headers: Headers | Record<string, string>): $Context | null {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name)
    }
    // Case-insensitive lookup for plain objects
    const lower = name.toLowerCase()
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        return headers[key]
      }
    }
    return null
  }

  const tenantId = get(CONTEXT_HEADERS.TENANT_ID)
  if (!tenantId) {
    return null
  }

  const permissionsRaw = get(CONTEXT_HEADERS.PERMISSIONS)
  const capabilitiesRaw = get(CONTEXT_HEADERS.CAPABILITIES)

  return createContext({
    correlationId: get(CORRELATION_ID_HEADER) ?? undefined,
    tenantId,
    userId: get(CONTEXT_HEADERS.USER_ID) ?? undefined,
    agentId: get(CONTEXT_HEADERS.AGENT_ID) ?? undefined,
    sessionId: get(CONTEXT_HEADERS.SESSION_ID) ?? undefined,
    permissions: permissionsRaw ? permissionsRaw.split(',').filter(Boolean) as PermissionLevel[] : [],
    capabilities: capabilitiesRaw ? capabilitiesRaw.split(',').filter(Boolean) : [],
    trusted: get(DO_SOURCE_HEADER) === 'true',
    sourceDoId: get(DO_SOURCE_ID_HEADER) ?? undefined,
  })
}

// ============================================================================
// WebSocket Context Association
// ============================================================================

/**
 * WeakMap that associates a $Context with a WebSocket connection.
 *
 * Using WeakMap ensures that when the WebSocket is garbage collected,
 * the context is automatically cleaned up — no manual disposal needed.
 */
const wsContextMap = new WeakMap<WebSocket, $Context>()

/**
 * Associate a $Context with a WebSocket connection.
 *
 * Called during WebSocket upgrade to bind the request context to the
 * connection for the entire lifetime of the WebSocket.
 *
 * @param ws - The WebSocket connection
 * @param ctx - The context to associate
 */
export function setWebSocketContext(ws: WebSocket, ctx: $Context): void {
  wsContextMap.set(ws, ctx)
}

/**
 * Retrieve the $Context associated with a WebSocket connection.
 *
 * @param ws - The WebSocket connection
 * @returns The associated context, or undefined if none
 */
export function getWebSocketContext(ws: WebSocket): $Context | undefined {
  return wsContextMap.get(ws)
}

/**
 * Remove the $Context association for a WebSocket connection.
 *
 * Usually not needed (WeakMap handles cleanup), but available for
 * explicit cleanup in tests or special scenarios.
 *
 * @param ws - The WebSocket connection
 * @returns true if a context was removed, false if none existed
 */
export function clearWebSocketContext(ws: WebSocket): boolean {
  return wsContextMap.delete(ws)
}

// ============================================================================
// Context Utilities
// ============================================================================

/**
 * Create a child context for a sub-operation, preserving the parent's
 * correlation ID and tenant but optionally overriding other fields.
 *
 * Useful for DO-to-DO calls where the calling DO needs to forward
 * context but add its own sourceDoId.
 *
 * @param parent - The parent context
 * @param overrides - Fields to override in the child context
 * @returns A new frozen $Context
 */
export function deriveContext(parent: $Context, overrides: Partial<$ContextInput>): $Context {
  return createContext({
    correlationId: parent.correlationId,
    tenantId: overrides.tenantId ?? parent.tenantId,
    userId: overrides.userId ?? parent.userId,
    agentId: overrides.agentId ?? parent.agentId,
    sessionId: overrides.sessionId ?? parent.sessionId,
    permissions: overrides.permissions ?? [...parent.permissions],
    capabilities: overrides.capabilities ?? [...parent.capabilities],
    trusted: overrides.trusted ?? parent.trusted,
    sourceDoId: overrides.sourceDoId ?? parent.sourceDoId,
    request: {
      ...parent.request,
      ...overrides.request,
    },
  })
}

/**
 * Check if a context has a specific permission level.
 *
 * @param ctx - The context to check
 * @param permission - The permission level to check for
 * @returns true if the context has the permission
 */
export function hasPermission(ctx: $Context, permission: PermissionLevel): boolean {
  return ctx.permissions.includes(permission)
}

/**
 * Check if a context has a specific capability.
 *
 * @param ctx - The context to check
 * @param capability - The capability string to check for
 * @returns true if the context has the capability
 */
export function hasCapability(ctx: $Context, capability: string): boolean {
  return ctx.capabilities.includes(capability)
}
