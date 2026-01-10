/**
 * Simple JSON Worker
 *
 * Returns plain JSON responses without HATEOAS envelope.
 * Just the data with $type and $id identifiers.
 *
 * Collection Response:
 * [
 *   { "$type": "Startup", "$id": "headless.ly", "name": "Headless.ly", "stage": "seed" },
 *   { "$type": "Startup", "$id": "agents.do", "name": "Agents.do", "stage": "growth" }
 * ]
 *
 * Single Resource Response:
 * {
 *   "$type": "Startup",
 *   "$id": "headless.ly",
 *   "name": "Headless.ly",
 *   "stage": "seed",
 *   "founded": "2024-01-01"
 * }
 *
 * No `api`, `links`, `discover`, `actions` envelope. Just the data.
 *
 * @module workers/simple
 */

import { createProxyHandler, type ProxyConfig } from './hostname-proxy'
import type { CloudflareEnv } from '../types/CloudflareBindings'

// ============================================================================
// Types
// ============================================================================

export interface SimpleConfig {
  /** Routing mode (defaults to 'path') */
  mode?: 'hostname' | 'path' | 'fixed'
  /** Root domain for hostname mode */
  rootDomain?: string
  /** Fixed namespace for fixed mode */
  namespace?: string
  /** Base path to strip */
  basepath?: string
  /** Default namespace fallback */
  defaultNs?: string
}

/**
 * HATEOAS envelope structure (what we strip)
 */
interface HATEOASResponse {
  api?: {
    $context?: string
    $type?: string
    $id?: string
    name?: string
    version?: string
  }
  links?: Record<string, string>
  discover?: Record<string, string>
  collections?: Record<string, string>
  schema?: Record<string, string>
  actions?: Record<string, unknown>
  relationships?: Record<string, string>
  verbs?: string[]
  user?: unknown
  error?: string
  data?: unknown
}

// ============================================================================
// stripEnvelope - Core envelope stripping logic
// ============================================================================

/**
 * Strip HATEOAS envelope and return just the data with $type and $id
 *
 * @param response The response object (potentially with HATEOAS envelope)
 * @returns Plain data with $type and $id injected
 */
export function stripEnvelope(response: unknown): unknown {
  // Handle primitive types
  if (response === null || response === undefined) {
    return response
  }

  if (typeof response !== 'object') {
    return response
  }

  // Handle arrays (passthrough, not HATEOAS envelope)
  if (Array.isArray(response)) {
    return response
  }

  const obj = response as Record<string, unknown>

  // Check if this looks like a HATEOAS envelope (has api and data properties)
  if (!isHATEOASEnvelope(obj)) {
    return response
  }

  const envelope = obj as HATEOASResponse
  const $type = envelope.api?.$type
  const $id = envelope.api?.$id
  const data = envelope.data

  // Handle null/undefined data
  if (data === null || data === undefined) {
    return data
  }

  // Handle array data (collection response)
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === 'object' && item !== null) {
        const enriched = { ...item } as Record<string, unknown>
        // Inject $type if not already present
        if ($type && !enriched.$type) {
          enriched.$type = $type
        }
        return enriched
      }
      return item
    })
  }

  // Handle object data (single resource response)
  if (typeof data === 'object') {
    const enriched = { ...data } as Record<string, unknown>
    // Inject $type if not already present
    if ($type && !enriched.$type) {
      enriched.$type = $type
    }
    // Inject $id if not already present
    if ($id && !enriched.$id) {
      enriched.$id = $id
    }
    return enriched
  }

  // Return data as-is for primitives
  return data
}

/**
 * Check if an object looks like a HATEOAS envelope
 */
function isHATEOASEnvelope(obj: Record<string, unknown>): boolean {
  // Must have 'api' or 'links' to be considered HATEOAS
  // and must have 'data' property (even if null)
  return (
    ('api' in obj || 'links' in obj) &&
    'data' in obj
  )
}

/**
 * Strip error envelope for error responses
 */
function stripErrorEnvelope(response: unknown): unknown {
  if (response === null || response === undefined) {
    return response
  }

  if (typeof response !== 'object' || Array.isArray(response)) {
    return response
  }

  const obj = response as Record<string, unknown>

  // If it has HATEOAS envelope properties, strip them
  if ('api' in obj || 'links' in obj) {
    const result: Record<string, unknown> = {}

    // Keep error if present
    if (obj.error) {
      result.error = obj.error
    }

    // Keep any non-envelope properties
    for (const [key, value] of Object.entries(obj)) {
      if (!['api', 'links', 'discover', 'collections', 'schema', 'actions', 'relationships', 'verbs', 'user', 'data'].includes(key)) {
        result[key] = value
      }
    }

    return result
  }

  return response
}

// ============================================================================
// createSimpleHandler - Main handler factory
// ============================================================================

/**
 * Create a simple JSON handler that strips HATEOAS envelope
 *
 * @param config Configuration for routing
 * @returns Handler function
 */
export function createSimpleHandler(config: SimpleConfig = {}) {
  // Build proxy config
  const proxyConfig: ProxyConfig = {
    mode: config.mode || 'path',
    basepath: config.basepath,
    defaultNs: config.defaultNs,
  }

  // Add hostname config if needed
  if (config.mode === 'hostname' && config.rootDomain) {
    proxyConfig.hostname = { rootDomain: config.rootDomain }
  }

  // Add fixed config if needed
  if (config.mode === 'fixed' && config.namespace) {
    proxyConfig.fixed = { namespace: config.namespace }
  }

  // Create the underlying proxy handler
  const proxyHandler = createProxyHandler(proxyConfig)

  return async function handler(request: Request, env: CloudflareEnv): Promise<Response> {
    // Forward request to DO via proxy
    const doResponse = await proxyHandler(request, env)

    // For non-2xx or 204 responses, handle errors
    if (!doResponse.ok || doResponse.status === 204) {
      // For 204 No Content, return as-is
      if (doResponse.status === 204) {
        return doResponse
      }

      // For error responses, try to strip envelope
      const contentType = doResponse.headers.get('Content-Type')
      if (contentType?.includes('application/json')) {
        try {
          const errorBody = await doResponse.json()
          const strippedError = stripErrorEnvelope(errorBody)

          return new Response(JSON.stringify(strippedError), {
            status: doResponse.status,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch {
          // If JSON parsing fails, return original response
          return doResponse
        }
      }

      return doResponse
    }

    // Check if response is JSON
    const contentType = doResponse.headers.get('Content-Type')
    if (!contentType?.includes('application/json')) {
      return doResponse
    }

    // Parse response body
    let body: unknown
    try {
      body = await doResponse.json()
    } catch {
      return doResponse
    }

    // Strip HATEOAS envelope
    const strippedBody = stripEnvelope(body)

    // Return simplified response
    return new Response(JSON.stringify(strippedBody), {
      status: doResponse.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ============================================================================
// Default Export - Simple path-based handler
// ============================================================================

const defaultHandler = createSimpleHandler({ mode: 'path' })

export default {
  fetch: defaultHandler,
}
