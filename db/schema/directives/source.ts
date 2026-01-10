/**
 * $source Directive Handler
 *
 * Resolves external API source configurations for schema types.
 */

export interface SourceAuth {
  type: 'apiKey' | 'oauth2' | 'basic' | 'bearer'
  key?: string
  value?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
}

export interface SourceCache {
  ttl?: number
  staleWhileRevalidate?: boolean
}

export interface SourceConfig {
  url: string
  method: string
  headers?: Record<string, string>
  mapping?: Record<string, string>
  items?: string
  auth?: SourceAuth
  cache?: SourceCache
  refresh?: string
}

/**
 * Resolve the $source directive from a type definition
 */
export function resolveSource(type: Record<string, unknown>): SourceConfig {
  const source = type.$source

  // String format - simple URL
  if (typeof source === 'string') {
    return {
      url: source,
      method: 'GET',
    }
  }

  // Object format
  if (typeof source === 'object' && source !== null) {
    const config = source as Record<string, unknown>

    const result: SourceConfig = {
      url: config.url as string,
      method: (config.method as string) || 'GET',
    }

    // Headers
    if (config.headers) {
      result.headers = config.headers as Record<string, string>
    }

    // Mapping
    if (config.mapping) {
      result.mapping = config.mapping as Record<string, string>
    }

    // Items path for array responses
    if (config.items) {
      result.items = config.items as string
    }

    // Auth
    if (config.auth) {
      result.auth = config.auth as SourceAuth
    }

    // Cache
    if (config.cache) {
      result.cache = config.cache as SourceCache
    }

    // Refresh schedule
    if (config.refresh) {
      result.refresh = config.refresh as string
    }

    return result
  }

  // Fallback for unexpected types
  return {
    url: '',
    method: 'GET',
  }
}
