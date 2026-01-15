/**
 * MCP Fetch Tool
 *
 * Fetches data from URLs, Durable Objects, or internal resources.
 *
 * Features:
 * - External URL fetching with timeout
 * - DO references: do://Noun/id -> Route to DO RPC
 * - Internal resource paths: /things/Type/id
 * - Response transformations (json, text, html, markdown, extract)
 * - KV-based response caching with configurable TTL
 * - Retry logic for transient failures
 *
 * @module mcp/tools/fetch
 */

import { z } from 'zod'

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Cache configuration schema
 */
export const cacheConfigSchema = z.object({
  ttl: z.number().optional().describe('Cache TTL in seconds'),
  key: z.string().optional().describe('Custom cache key'),
})

/**
 * Fetch tool input schema
 */
export const fetchToolSchema = z.object({
  url: z.string().describe('URL, DO reference (do://Noun/id), or resource path (/things/Type/id)'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('GET'),
  headers: z.record(z.string()).optional().describe('Custom HTTP headers'),
  body: z.unknown().optional().describe('Request body (for POST/PUT)'),
  transform: z
    .enum(['json', 'text', 'html', 'markdown', 'extract'])
    .optional()
    .default('json')
    .describe('Response transformation type'),
  cache: cacheConfigSchema.optional().describe('Caching configuration'),
  timeout: z.number().optional().default(30000).describe('Request timeout in milliseconds'),
  retries: z.number().optional().default(0).describe('Number of retries on transient failures'),
  retryDelay: z.number().optional().default(1000).describe('Base delay between retries in ms'),
})

export type FetchParams = z.infer<typeof fetchToolSchema>
/** Input type for FetchParams (before defaults are applied) */
export type FetchInput = z.input<typeof fetchToolSchema>
export type CacheConfig = z.infer<typeof cacheConfigSchema>

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a fetch operation
 */
export interface FetchResult {
  /** HTTP status code (200 for successful DO/resource lookups) */
  status: number
  /** Response headers */
  headers: Record<string, string>
  /** Transformed response data */
  data: unknown
  /** Whether result came from cache */
  cached: boolean
  /** Request duration in milliseconds */
  duration: number
  /** Source type: external, do, or resource */
  source: 'external' | 'do' | 'resource'
}

/**
 * URL parse result
 */
interface ParsedUrl {
  type: 'external' | 'do' | 'resource'
  /** Original URL or path */
  original: string
  /** For DO: the noun type (e.g., "Customer") */
  noun?: string
  /** For DO/resource: the entity ID */
  id?: string
  /** For external: the full URL */
  externalUrl?: string
  /** For resource: the resource type */
  resourceType?: string
}

/**
 * Environment bindings required for fetch tool
 */
export interface FetchEnv {
  /** KV namespace for caching */
  CACHE?: KVNamespace
  /** DO namespace binding (dynamic based on noun type) */
  [key: string]: unknown
}

/**
 * Tool execution context
 */
export interface FetchContext {
  /** Permitted operations */
  permissions: string[]
  /** Environment bindings */
  env: FetchEnv
  /** AI extraction function (for 'extract' transform) */
  aiExtract?: (content: string, schema?: unknown) => Promise<unknown>
}

// ============================================================================
// URL PARSING
// ============================================================================

/**
 * Parse URL into its components
 *
 * Supports:
 * - External URLs: https://example.com/path
 * - DO references: do://Customer/cust-123
 * - Resource paths: /things/Customer/cust-123
 */
export function parseUrl(url: string): ParsedUrl {
  // DO reference: do://Noun/id
  if (url.startsWith('do://')) {
    const match = url.match(/^do:\/\/(\w+)\/(.+)$/)
    if (!match) {
      throw new Error(`Invalid DO reference format: ${url}. Expected do://Noun/id`)
    }
    return {
      type: 'do',
      original: url,
      noun: match[1],
      id: match[2],
    }
  }

  // Resource path: /things/Type/id or /Type/id
  if (url.startsWith('/')) {
    // /things/Customer/cust-123
    const thingsMatch = url.match(/^\/things\/(\w+)\/(.+)$/)
    if (thingsMatch) {
      return {
        type: 'resource',
        original: url,
        resourceType: thingsMatch[1],
        id: thingsMatch[2],
      }
    }

    // /Customer/cust-123 (shorthand)
    const shortMatch = url.match(/^\/(\w+)\/(.+)$/)
    if (shortMatch) {
      return {
        type: 'resource',
        original: url,
        resourceType: shortMatch[1],
        id: shortMatch[2],
      }
    }

    throw new Error(`Invalid resource path format: ${url}. Expected /things/Type/id or /Type/id`)
  }

  // External URL
  try {
    new URL(url)
    return {
      type: 'external',
      original: url,
      externalUrl: url,
    }
  } catch {
    throw new Error(`Invalid URL format: ${url}`)
  }
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Generate cache key from request parameters
 */
export function generateCacheKey(params: FetchInput): string {
  if (params.cache?.key) {
    return `fetch:${params.cache.key}`
  }

  // Default key: hash of URL + method + body
  const parts = [params.url, params.method ?? 'GET']
  if (params.body) {
    parts.push(JSON.stringify(params.body))
  }
  return `fetch:${simpleHash(parts.join('|'))}`
}

/**
 * Simple hash function for cache keys
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Try to get cached response
 */
async function getCachedResponse(
  cacheKey: string,
  env: FetchEnv,
): Promise<FetchResult | null> {
  if (!env.CACHE) return null

  try {
    const cached = await env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return {
        ...(cached as FetchResult),
        cached: true,
      }
    }
  } catch {
    // Cache miss or error - proceed without cache
  }
  return null
}

/**
 * Store response in cache
 */
async function cacheResponse(
  cacheKey: string,
  result: FetchResult,
  config: CacheConfig,
  env: FetchEnv,
): Promise<void> {
  if (!env.CACHE || !config.ttl) return

  try {
    await env.CACHE.put(cacheKey, JSON.stringify({ ...result, cached: false }), {
      expirationTtl: config.ttl,
    })
  } catch {
    // Cache write failure - non-fatal
  }
}

// ============================================================================
// TRANSFORMATIONS
// ============================================================================

/**
 * Transform response based on requested format
 */
export async function transformResponse(
  response: Response,
  transform: FetchParams['transform'],
  context: FetchContext,
): Promise<unknown> {
  switch (transform) {
    case 'json':
      return response.json()

    case 'text':
      return response.text()

    case 'html': {
      const html = await response.text()
      return parseHtml(html)
    }

    case 'markdown': {
      const html = await response.text()
      return htmlToMarkdown(html)
    }

    case 'extract': {
      if (!context.aiExtract) {
        throw new Error('AI extraction not available - aiExtract function not provided')
      }
      const content = await response.text()
      return context.aiExtract(content)
    }

    default:
      return response.json()
  }
}

/**
 * Parse HTML content and extract useful information
 */
function parseHtml(html: string): { title: string; content: string; links: string[] } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ''

  // Remove script and style tags
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Extract links
  const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)
  const links = Array.from(linkMatches, (m) => m[1])

  return { title, content, links }
}

/**
 * Convert HTML to Markdown (simplified)
 */
function htmlToMarkdown(html: string): string {
  return (
    html
      // Headers
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n')
      // Paragraphs and breaks
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      // Lists
      .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
      .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
      // Formatting
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      // Links
      .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      // Images
      .replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*?)["'][^>]*>/gi, '![$2]($1)')
      .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, '![]($1)')
      // Remove remaining tags
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// ============================================================================
// FETCHERS
// ============================================================================

/**
 * Fetch from external URL with timeout
 */
async function fetchExternal(
  parsed: ParsedUrl,
  params: FetchParams,
  context: FetchContext,
): Promise<FetchResult> {
  const startTime = Date.now()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), params.timeout)

  try {
    const response = await fetch(parsed.externalUrl!, {
      method: params.method,
      headers: params.headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const data = await transformResponse(response, params.transform, context)

    return {
      status: response.status,
      headers,
      data,
      cached: false,
      duration: Date.now() - startTime,
      source: 'external',
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${params.timeout}ms: ${parsed.original}`)
    }
    throw error
  }
}

/**
 * Fetch from Durable Object via RPC
 */
async function fetchDO(
  parsed: ParsedUrl,
  params: FetchParams,
  context: FetchContext,
): Promise<FetchResult> {
  const startTime = Date.now()

  // Get DO namespace binding
  const doNamespace = context.env[parsed.noun!] as DurableObjectNamespace | undefined
  if (!doNamespace) {
    throw new Error(`DO namespace not found: ${parsed.noun}`)
  }

  // Get DO stub
  const id = doNamespace.idFromName(parsed.id!)
  const stub = doNamespace.get(id)

  // Build request URL
  const url = new URL(`https://do.internal/${params.method === 'GET' ? '' : 'rpc'}`)

  // Execute fetch
  const response = await stub.fetch(url.toString(), {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      ...params.headers,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  })

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  const data = await transformResponse(response, params.transform, context)

  return {
    status: response.status,
    headers,
    data,
    cached: false,
    duration: Date.now() - startTime,
    source: 'do',
  }
}

/**
 * Fetch internal resource (from current DO's storage)
 */
async function fetchResource(
  parsed: ParsedUrl,
  params: FetchParams,
  context: FetchContext,
): Promise<FetchResult> {
  const startTime = Date.now()

  // Route to the appropriate DO based on resource type
  const doNamespace = context.env[parsed.resourceType!] as DurableObjectNamespace | undefined

  if (!doNamespace) {
    // If no DO namespace, try to fetch from current context
    // This would typically be handled by the DO that's running this tool
    throw new Error(
      `Resource type not found: ${parsed.resourceType}. Ensure the DO namespace is bound.`,
    )
  }

  // Get DO stub and fetch
  const id = doNamespace.idFromName(parsed.id!)
  const stub = doNamespace.get(id)

  const response = await stub.fetch(`https://do.internal/things/${parsed.resourceType}/${parsed.id}`, {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      ...params.headers,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  })

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  const data = await transformResponse(response, params.transform, context)

  return {
    status: response.status,
    headers,
    data,
    cached: false,
    duration: Date.now() - startTime,
    source: 'resource',
  }
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

/**
 * Check if error is transient and should be retried
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    // Timeout errors
    if (error.message.includes('timeout')) return true
    // Network errors
    if (error.message.includes('network') || error.message.includes('ECONNRESET')) return true
    // 5xx errors (handled separately via status)
  }
  return false
}

/**
 * Execute fetch with retry logic
 */
async function fetchWithRetry(
  fetcher: () => Promise<FetchResult>,
  retries: number,
  retryDelay: number,
): Promise<FetchResult> {
  let lastError: Error | null = null
  let attempt = 0

  while (attempt <= retries) {
    try {
      const result = await fetcher()

      // Retry on 5xx errors
      if (result.status >= 500 && attempt < retries) {
        attempt++
        await sleep(retryDelay * Math.pow(2, attempt - 1)) // Exponential backoff
        continue
      }

      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (isTransientError(error) && attempt < retries) {
        attempt++
        await sleep(retryDelay * Math.pow(2, attempt - 1)) // Exponential backoff
        continue
      }

      throw error
    }
  }

  throw lastError || new Error('Fetch failed after retries')
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// MAIN TOOL FUNCTION
// ============================================================================

/**
 * MCP Fetch Tool
 *
 * Fetches data from URLs, DOs, or internal resources with support for
 * caching, transformations, and retry logic.
 *
 * @example
 * ```typescript
 * // Fetch external URL
 * const result = await fetchTool({
 *   url: 'https://api.example.com/data',
 *   transform: 'json',
 *   cache: { ttl: 300 }
 * }, context)
 *
 * // Fetch from DO
 * const result = await fetchTool({
 *   url: 'do://Customer/cust-123',
 *   transform: 'json'
 * }, context)
 *
 * // Fetch internal resource
 * const result = await fetchTool({
 *   url: '/things/Customer/cust-123',
 *   transform: 'json'
 * }, context)
 * ```
 */
export async function fetchTool(
  rawParams: FetchInput,
  context: FetchContext,
): Promise<FetchResult> {
  // Check permission
  if (!context.permissions.includes('fetch')) {
    throw new Error('Permission denied: fetch')
  }

  // Parse and apply defaults
  const params = fetchToolSchema.parse(rawParams)

  // Parse URL
  const parsed = parseUrl(params.url)

  // Check cache
  if (params.cache && params.method === 'GET') {
    const cacheKey = generateCacheKey(params)
    const cached = await getCachedResponse(cacheKey, context.env)
    if (cached) {
      return cached
    }
  }

  // Select fetcher based on URL type
  const fetcher = async (): Promise<FetchResult> => {
    switch (parsed.type) {
      case 'external':
        return fetchExternal(parsed, params, context)
      case 'do':
        return fetchDO(parsed, params, context)
      case 'resource':
        return fetchResource(parsed, params, context)
      default:
        throw new Error(`Unknown URL type: ${parsed.type}`)
    }
  }

  // Execute with retry logic
  const result = await fetchWithRetry(fetcher, params.retries ?? 0, params.retryDelay ?? 1000)

  // Cache result if configured (only for GET requests)
  if (params.cache && params.method === 'GET' && result.status >= 200 && result.status < 300) {
    const cacheKey = generateCacheKey(params)
    await cacheResponse(cacheKey, result, params.cache, context.env)
  }

  return result
}

// ============================================================================
// MCP TOOL REGISTRATION
// ============================================================================

/**
 * Tool metadata for MCP registration
 */
export const fetchToolMeta = {
  name: 'fetch',
  description:
    'Fetch data from URLs, Durable Objects (do://Noun/id), or internal resources (/things/Type/id). ' +
    'Supports response transformations (json, text, html, markdown, extract) and caching.',
  schema: fetchToolSchema,
}

/**
 * Register fetch tool with MCP server
 *
 * @example
 * ```typescript
 * import { registerFetchTool } from './mcp/tools/fetch'
 *
 * const server = new McpServer()
 * registerFetchTool(server, env)
 * ```
 */
export function registerFetchTool(
  server: { tool: (name: string, schema: unknown, handler: unknown) => void },
  env: FetchEnv,
  aiExtract?: (content: string, schema?: unknown) => Promise<unknown>,
): void {
  server.tool(fetchToolMeta.name, fetchToolMeta.schema, async (params: FetchParams) => {
    const context: FetchContext = {
      permissions: ['fetch'], // Default: grant fetch permission
      env,
      aiExtract,
    }
    return fetchTool(params, context)
  })
}

// Note: KVNamespace, DurableObjectNamespace, DurableObjectId, and DurableObjectStub
// types are provided by @cloudflare/workers-types
