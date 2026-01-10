/**
 * Hostname-based DO Proxy Worker
 *
 * Routes requests to Durable Objects based on hostname (subdomain),
 * path segment, or fixed namespace with configurable basepath stripping.
 *
 * Routing modes:
 * - hostname: `{ns}.api.dotdo.dev/path` → DO(ns).fetch('/path')
 * - path: `api.dotdo.dev/{ns}/path` → DO(ns).fetch('/path')
 * - fixed: `api.dotdo.dev/path` → DO(config.fixed.namespace).fetch('/path')
 *
 * @module workers/hostname-proxy
 */

import type { CloudflareEnv } from '../types/CloudflareBindings'

/**
 * Configuration for the hostname-based proxy
 */
export interface ProxyConfig {
  /** Namespace resolution mode */
  mode: 'hostname' | 'path' | 'fixed'
  /** Path prefix to strip before forwarding (e.g., '/api/v1') */
  basepath?: string
  /** Fallback namespace when resolution fails */
  defaultNs?: string
  /** Hostname mode configuration */
  hostname?: {
    /** Number of subdomain levels to use as namespace (default: 1) */
    stripLevels?: number
    /** Root domain to match against (e.g., 'api.dotdo.dev') */
    rootDomain: string
  }
  /** Fixed mode configuration */
  fixed?: {
    /** The namespace to always route to */
    namespace: string
  }
}

/**
 * Resolve namespace from request based on config mode
 */
function resolveNamespace(request: Request, config: ProxyConfig): string | null {
  switch (config.mode) {
    case 'fixed':
      return config.fixed?.namespace || null

    case 'hostname': {
      const url = new URL(request.url)
      const host = url.hostname
      const root = config.hostname?.rootDomain || ''

      // Check if host ends with root domain
      if (!host.endsWith(root)) {
        return config.defaultNs || null
      }

      // Extract prefix before root domain
      // e.g., 'tenant.api.dotdo.dev' with root 'api.dotdo.dev' → 'tenant'
      const prefixLength = host.length - root.length
      if (prefixLength <= 1) {
        // Apex domain (no subdomain prefix) or just the dot
        return config.defaultNs || null
      }

      // Remove trailing dot from prefix
      const prefix = host.slice(0, prefixLength - 1)
      if (!prefix) {
        return config.defaultNs || null
      }

      const levels = config.hostname?.stripLevels || 1
      const parts = prefix.split('.')

      // Extract specified number of levels
      const ns = parts.slice(0, levels).join('.')
      return ns || config.defaultNs || null
    }

    case 'path': {
      const url = new URL(request.url)
      let pathname = url.pathname

      // Apply basepath stripping first for path mode
      if (config.basepath && pathname.startsWith(config.basepath)) {
        pathname = pathname.slice(config.basepath.length) || '/'
      }

      const segments = pathname.split('/').filter(Boolean)
      return segments[0] || config.defaultNs || null
    }

    default:
      return null
  }
}

/**
 * Get the path to forward to DO after namespace extraction and basepath stripping
 */
function getForwardPath(request: Request, config: ProxyConfig): string {
  const url = new URL(request.url)
  let pathname = url.pathname

  // Strip basepath if configured
  if (config.basepath && pathname.startsWith(config.basepath)) {
    pathname = pathname.slice(config.basepath.length)
  }

  // For path mode, also strip the namespace segment
  if (config.mode === 'path') {
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length > 0) {
      pathname = '/' + segments.slice(1).join('/')
    }
  }

  // Ensure path starts with /
  if (!pathname || pathname === '') {
    pathname = '/'
  } else if (!pathname.startsWith('/')) {
    pathname = '/' + pathname
  }

  return pathname
}

/**
 * Create a proxy handler with the given configuration
 */
export function createProxyHandler(config: ProxyConfig) {
  return async function handler(request: Request, env: CloudflareEnv): Promise<Response> {
    // 1. Resolve namespace based on mode
    const ns = resolveNamespace(request, config)
    if (!ns) {
      return new Response('Not Found', { status: 404 })
    }

    // 2. Check if DO binding exists
    if (!env?.DO) {
      return new Response(JSON.stringify({ error: 'DO binding not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3. Get forward path
    const url = new URL(request.url)
    const forwardPath = getForwardPath(request, config)

    try {
      // 4. Get DO stub
      const doId = env.DO.idFromName(ns)
      const stub = env.DO.get(doId)

      // 5. Create new URL for DO request
      const doUrl = new URL(forwardPath + url.search, url.origin)

      // 6. Forward request to DO
      const doRequest = new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      } as RequestInit)

      return await stub.fetch(doRequest)
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Service Unavailable' }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }
}

/**
 * Default export for direct worker usage with hostname mode
 *
 * Configure via environment variables or wrangler.toml vars:
 * - PROXY_MODE: 'hostname' | 'path' | 'fixed' (default: 'hostname')
 * - PROXY_ROOT_DOMAIN: root domain for hostname mode (e.g., 'api.dotdo.dev')
 * - PROXY_BASEPATH: optional path prefix to strip
 * - PROXY_DEFAULT_NS: fallback namespace
 * - PROXY_FIXED_NS: namespace for fixed mode
 */
export default {
  async fetch(request: Request, env: CloudflareEnv & {
    PROXY_MODE?: string
    PROXY_ROOT_DOMAIN?: string
    PROXY_BASEPATH?: string
    PROXY_DEFAULT_NS?: string
    PROXY_FIXED_NS?: string
  }): Promise<Response> {
    const config: ProxyConfig = {
      mode: (env.PROXY_MODE as ProxyConfig['mode']) || 'hostname',
      basepath: env.PROXY_BASEPATH,
      defaultNs: env.PROXY_DEFAULT_NS,
      hostname: env.PROXY_ROOT_DOMAIN
        ? { rootDomain: env.PROXY_ROOT_DOMAIN }
        : undefined,
      fixed: env.PROXY_FIXED_NS
        ? { namespace: env.PROXY_FIXED_NS }
        : undefined,
    }

    const handler = createProxyHandler(config)
    return handler(request, env)
  },
}
