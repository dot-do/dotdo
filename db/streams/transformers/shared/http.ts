/**
 * HTTP Context Extraction Utilities
 *
 * Extracts HTTP request/response information and maps
 * to the unified event schema HTTP fields.
 */

/**
 * HTTP request structure from various sources.
 */
export interface HttpRequest {
  url?: string
  method?: string
  headers?: Record<string, string>
}

/**
 * HTTP response structure.
 */
export interface HttpResponse {
  status?: number
}

/**
 * Unified event HTTP context fields.
 */
export interface HttpFields {
  http_method: string | null
  http_url: string | null
  http_host: string | null
  http_path: string | null
  http_query: string | null
  http_status: number | null
  http_protocol: string | null
  http_referrer: string | null
  http_user_agent: string | null
  http_content_type: string | null
}

/**
 * Parsed URL components.
 */
export interface UrlComponents {
  host: string | null
  path: string | null
  query: string | null
  protocol: string | null
}

/**
 * Parses a URL string into its components.
 *
 * @param url - The URL string to parse
 * @returns URL components with nulls for invalid/missing parts
 */
export function parseUrl(url: string | undefined): UrlComponents {
  if (!url) {
    return { host: null, path: null, query: null, protocol: null }
  }

  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || null,
      path: parsed.pathname || null,
      query: parsed.search || null,
      protocol: parsed.protocol?.replace(':', '') || null,
    }
  } catch {
    return { host: null, path: null, query: null, protocol: null }
  }
}

/**
 * Extracts a header value from a headers object (case-insensitive).
 *
 * @param headers - The headers object
 * @param name - The header name to find
 * @returns The header value or null
 */
export function getHeader(
  headers: Record<string, string> | undefined,
  name: string
): string | null {
  if (!headers) return null

  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value
    }
  }
  return null
}

/**
 * Extracts HTTP context fields from request and response objects.
 *
 * @param request - The HTTP request object
 * @param response - The HTTP response object
 * @param httpProtocol - The HTTP protocol version (e.g., 'HTTP/2')
 * @returns Unified HTTP context fields
 */
export function extractHttpContext(
  request: HttpRequest | undefined,
  response: HttpResponse | undefined,
  httpProtocol?: string
): HttpFields {
  if (!request) {
    return emptyHttpFields()
  }

  const urlParts = parseUrl(request.url)

  return {
    http_method: request.method ?? null,
    http_url: request.url ?? null,
    http_host: urlParts.host,
    http_path: urlParts.path,
    http_query: urlParts.query,
    http_status: response?.status ?? null,
    http_protocol: httpProtocol ?? null,
    http_referrer: getHeader(request.headers, 'referer') ?? getHeader(request.headers, 'referrer'),
    http_user_agent: getHeader(request.headers, 'user-agent'),
    http_content_type: getHeader(request.headers, 'content-type'),
  }
}

/**
 * Creates a null-filled HTTP fields object.
 *
 * @returns HttpFields with all values set to null
 */
export function emptyHttpFields(): HttpFields {
  return {
    http_method: null,
    http_url: null,
    http_host: null,
    http_path: null,
    http_query: null,
    http_status: null,
    http_protocol: null,
    http_referrer: null,
    http_user_agent: null,
    http_content_type: null,
  }
}
