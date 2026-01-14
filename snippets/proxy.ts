/**
 * Universal Proxy Snippet
 *
 * A config-driven proxy that runs at the edge before Worker invocation.
 * Reads configuration from /proxy-config.json (static assets, globally cached).
 *
 * Features:
 * - Multi-layer config caching (isolate memory + Cache API)
 * - Route matching with regex patterns and method filtering
 * - Request/response transformations
 * - Policy execution (JWT, rate limiting, CORS, geo blocking, bot filtering)
 * - Variable resolution ($requestId, $jwt.*, $cf.*, etc.)
 *
 * @see docs/concepts/snippets.mdx for usage documentation
 */

// Cloudflare Workers types (when not using @cloudflare/workers-types)
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
  }

  // Note: CacheStorage.default is already declared in @cloudflare/workers-types
}

// ============================================================================
// Types
// ============================================================================

/**
 * Proxy configuration schema
 */
export interface ProxyConfig {
  version: string
  ttl: number
  routes: Route[]
  policies: Record<string, Policy>
  variables?: Record<string, string>
}

/**
 * Route configuration
 */
export interface Route {
  id: string
  priority?: number
  enabled?: boolean
  match: RouteMatch
  target?: RouteTarget
  transforms?: RouteTransforms
  policies?: string[]
}

export interface RouteMatch {
  path: string
  methods?: string[]
  headers?: Record<string, string>
}

export interface RouteTarget {
  type: 'passthrough' | 'redirect' | 'fixed'
  url?: string
  status?: number
  body?: string
}

export interface RouteTransforms {
  request?: RequestTransform[]
  response?: ResponseTransform[]
}

/**
 * Request transform operations
 */
export type RequestTransform =
  | { op: 'setHeader'; name: string; value: string }
  | { op: 'removeHeader'; name: string }
  | { op: 'rewritePath'; pattern: string; replacement: string }
  | { op: 'setQuery'; name: string; value: string }
  | { op: 'removeQuery'; name: string }

/**
 * Response transform operations
 */
export type ResponseTransform =
  | { op: 'setHeader'; name: string; value: string }
  | { op: 'removeHeader'; name: string }
  | { op: 'setStatus'; value: string }

/**
 * Combined transform type (for tests expecting a unified type)
 */
export type Transform = RequestTransform | ResponseTransform

/**
 * Policy types
 */
export type Policy = JwtPolicy | RateLimitCachePolicy | CorsPolicy | GeoBlockPolicy | BotFilterPolicy

export interface JwtPolicy {
  type: 'jwt'
  publicKey: string
  algorithm?: 'RS256'
}

export interface RateLimitCachePolicy {
  type: 'rateLimitCache'
  keyFrom: string
}

export interface CorsPolicy {
  type: 'cors'
  origins: string[]
  methods: string[]
  headers: string[]
  maxAge?: number
}

export interface GeoBlockPolicy {
  type: 'geoBlock'
  blockedCountries?: string[]
  allowedCountries?: string[]
}

export interface BotFilterPolicy {
  type: 'botFilter'
  minScore: number
}

/**
 * Proxy execution context
 */
export interface ProxyContext {
  requestId: string
  timestamp: number
  ip: string | null
  cf: Record<string, unknown>
  jwt: Record<string, unknown> | null
  config: Record<string, string>
}

/**
 * Policy result
 */
export interface PolicyResult {
  allowed: boolean
  response?: Response
  headers?: Headers
  preflightResponse?: Response
}

// ============================================================================
// Config Caching
// ============================================================================

let cachedConfig: ProxyConfig | null = null
let configExpiry = 0

/**
 * Cache key used for storing config in Cache API
 */
export const CONFIG_CACHE_KEY = 'https://proxy-config/'

/**
 * Reset the config cache (for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null
  configExpiry = 0
}

/**
 * Alias for resetConfigCache (for backwards compatibility with tests)
 */
export const clearConfigCache = resetConfigCache

/**
 * Get the proxy configuration with multi-layer caching
 *
 * Layer 1: Isolate memory (fastest, per-isolate)
 * Layer 2: Cache API (cross-isolate, global)
 * Layer 3: Fetch from static assets
 */
export async function getConfig(ctx: ExecutionContext): Promise<ProxyConfig> {
  const now = Date.now()

  // Layer 1: Isolate memory cache hit
  if (cachedConfig && now < configExpiry) {
    return cachedConfig
  }

  // Layer 2: Cache API
  const cacheKey = new Request('https://proxy-config/')
  const cached = await caches.default.match(cacheKey)
  if (cached) {
    cachedConfig = (await cached.json()) as ProxyConfig
    configExpiry = now + ((cachedConfig.ttl || 60) * 1000)
    return cachedConfig
  }

  // Layer 3: Fetch from static assets
  const response = await fetch('/proxy-config.json')
  if (!response.ok) {
    throw new Error(`Config fetch failed: ${response.status}`)
  }

  cachedConfig = (await response.json()) as ProxyConfig
  configExpiry = now + ((cachedConfig.ttl || 60) * 1000)

  // Populate Cache API in background
  ctx.waitUntil(
    caches.default.put(
      cacheKey,
      new Response(JSON.stringify(cachedConfig), {
        headers: { 'Cache-Control': `max-age=${cachedConfig.ttl || 60}` },
      })
    )
  )

  return cachedConfig
}

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Find the first matching route for a request
 */
export function findRoute(url: URL, method: string, routes: Route[] | undefined): Route | null {
  if (!routes || routes.length === 0) {
    return null
  }

  // Sort by priority (descending) and filter disabled routes
  const sorted = [...routes]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  for (const route of sorted) {
    const { match } = route

    // Path matching (regex)
    const pathRegex = new RegExp(match.path)
    if (!pathRegex.test(url.pathname)) continue

    // Method matching
    if (match.methods && !match.methods.includes(method)) continue

    // Header matching (if specified)
    // TODO: Implement header matching in REFACTOR ticket

    return route
  }

  return null
}

// ============================================================================
// Variable Resolution
// ============================================================================

/**
 * Resolve a variable template to its value
 *
 * Variables start with $ and support dot notation:
 * - $requestId - Generated UUID
 * - $timestamp - Current timestamp
 * - $method - Request method
 * - $path - URL pathname
 * - $query.{name} - Query parameter
 * - $header.{name} - Request header
 * - $cf.{field} - Cloudflare properties
 * - $jwt.{claim} - JWT claim (after auth)
 * - $config.{key} - Config variable
 */
export function resolveVar(template: string, context: ProxyContext, request: Request): string {
  if (!template.startsWith('$')) {
    return template
  }

  const [prefix, ...rest] = template.slice(1).split('.')
  const key = rest.join('.')

  switch (prefix) {
    case 'requestId':
      return context.requestId
    case 'timestamp':
      return String(context.timestamp)
    case 'method':
      return request.method
    case 'path':
      return new URL(request.url).pathname
    case 'query':
      return new URL(request.url).searchParams.get(key) || ''
    case 'header':
      return request.headers.get(key) || ''
    case 'cf':
      return String(context.cf[key] || '')
    case 'jwt':
      return context.jwt?.[key] !== undefined ? String(context.jwt[key]) : ''
    case 'config':
      return context.config[key] || ''
    default:
      return template
  }
}

// ============================================================================
// Request Transforms
// ============================================================================

/**
 * Apply request transformations
 */
export function applyRequestTransforms(
  request: Request,
  transforms: RequestTransform[],
  context: ProxyContext
): Request {
  const headers = new Headers(request.headers)
  let url = new URL(request.url)

  for (const t of transforms) {
    switch (t.op) {
      case 'setHeader': {
        const value = resolveVar(t.value, context, request)
        headers.set(t.name, value)
        break
      }
      case 'removeHeader':
        headers.delete(t.name)
        break
      case 'rewritePath':
        url = new URL(request.url)
        url.pathname = url.pathname.replace(new RegExp(t.pattern), t.replacement)
        break
      case 'setQuery': {
        const value = resolveVar(t.value, context, request)
        url.searchParams.set(t.name, value)
        break
      }
      case 'removeQuery':
        url.searchParams.delete(t.name)
        break
    }
  }

  return new Request(url.toString(), {
    method: request.method,
    headers,
    body: request.body,
    cf: (request as Request & { cf?: unknown }).cf,
  } as RequestInit)
}

// ============================================================================
// Response Transforms
// ============================================================================

/**
 * Apply response transformations
 */
export function applyResponseTransforms(
  response: Response,
  transforms: ResponseTransform[],
  context: ProxyContext
): Response {
  const headers = new Headers(response.headers)
  let status = response.status

  // Create a mock request for variable resolution (used for response transforms)
  const mockRequest = new Request('https://example.com.ai')

  for (const t of transforms) {
    switch (t.op) {
      case 'setHeader': {
        const value = resolveVar(t.value, context, mockRequest)
        headers.set(t.name, value)
        break
      }
      case 'removeHeader':
        headers.delete(t.name)
        break
      case 'setStatus':
        status = parseInt(t.value, 10)
        break
    }
  }

  return new Response(response.body, { status, headers })
}

// ============================================================================
// Policy Execution
// ============================================================================

/**
 * Apply a policy and return the result
 */
export async function applyPolicy(
  request: Request,
  policy: Policy,
  context: ProxyContext,
  _ctx: ExecutionContext
): Promise<PolicyResult> {
  switch (policy.type) {
    case 'jwt':
      return await applyJwtPolicy(request, policy, context)
    case 'rateLimitCache':
      return await applyRateLimitCachePolicy(request, policy, context)
    case 'cors':
      return applyCorsPolicy(request, policy, context)
    case 'geoBlock':
      return applyGeoBlockPolicy(request, policy, context)
    case 'botFilter':
      return applyBotFilterPolicy(request, policy, context)
    default:
      return { allowed: true }
  }
}

// ============================================================================
// JWT Policy
// ============================================================================

/**
 * Get JWT from request (Authorization header or cookie)
 */
function getJwtFromRequest(request: Request): string | null {
  // Check Authorization header
  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7)
  }

  // Check cookie
  const cookies = request.headers.get('Cookie') || ''
  const match = cookies.match(/__auth_token=([^;]+)/)
  return match?.[1] || null
}

/**
 * Convert PEM to ArrayBuffer for crypto.subtle
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Convert base64url to ArrayBuffer
 */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Verify JWT signature (RS256)
 */
async function verifyJwt(
  token: string,
  publicKeyPem: string
): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { valid: false, error: 'Invalid token format' }
    }

    // Decode payload
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return { valid: false, error: 'Token expired' }
    }

    // Import public key
    const keyData = pemToArrayBuffer(publicKeyPem)
    const key = await crypto.subtle.importKey(
      'spki',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Verify signature
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signature = base64UrlToArrayBuffer(signatureB64)
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)

    return valid ? { valid: true, payload } : { valid: false, error: 'Invalid signature' }
  } catch (e) {
    return { valid: false, error: (e as Error).message }
  }
}

/**
 * Apply JWT authentication policy
 */
export async function applyJwtPolicy(
  request: Request,
  policy: JwtPolicy,
  context: ProxyContext
): Promise<PolicyResult> {
  const token = getJwtFromRequest(request)
  if (!token) {
    return {
      allowed: false,
      response: new Response('Unauthorized', { status: 401 }),
    }
  }

  const verified = await verifyJwt(token, policy.publicKey)
  if (!verified.valid) {
    return {
      allowed: false,
      response: new Response(verified.error || 'Invalid token', { status: 401 }),
    }
  }

  // Store claims in context for variable resolution
  context.jwt = verified.payload || null
  return { allowed: true }
}

// ============================================================================
// Rate Limit Cache Policy
// ============================================================================

/**
 * Apply rate limit cache policy
 * Checks Cache API for existing 429 responses
 */
export async function applyRateLimitCachePolicy(
  request: Request,
  policy: RateLimitCachePolicy,
  context: ProxyContext
): Promise<PolicyResult> {
  const keySource = policy.keyFrom || '$cf.ip'
  const keyValue = resolveVar(keySource, context, request)
  const cacheKey = new Request(`https://rl-cache/${keyValue}`)

  const cached = await caches.default.match(cacheKey)
  if (cached?.status === 429) {
    return { allowed: false, response: cached.clone() }
  }

  return { allowed: true }
}

// ============================================================================
// CORS Policy
// ============================================================================

/**
 * Apply CORS policy
 */
export function applyCorsPolicy(
  request: Request,
  policy: CorsPolicy,
  _context: ProxyContext
): PolicyResult {
  const origin = request.headers.get('Origin')
  const headers = new Headers()

  // Check if origin is allowed
  const isAllowed = !origin || policy.origins.includes('*') || policy.origins.includes(origin)

  if (isAllowed && origin) {
    headers.set('Access-Control-Allow-Origin', policy.origins.includes('*') ? '*' : origin)

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', policy.methods.join(', '))
      headers.set('Access-Control-Allow-Headers', policy.headers.join(', '))
      if (policy.maxAge) {
        headers.set('Access-Control-Max-Age', String(policy.maxAge))
      }

      return {
        allowed: true,
        headers,
        preflightResponse: new Response(null, { status: 204, headers }),
      }
    }
  }

  return { allowed: true, headers: isAllowed && origin ? headers : undefined }
}

// ============================================================================
// Geo Block Policy
// ============================================================================

/**
 * Apply geo blocking policy
 */
export function applyGeoBlockPolicy(
  _request: Request,
  policy: GeoBlockPolicy,
  context: ProxyContext
): PolicyResult {
  const country = context.cf.country as string | undefined

  // If country is unknown, allow (fail open)
  if (!country) {
    return { allowed: true }
  }

  // Blocklist mode
  if (policy.blockedCountries && policy.blockedCountries.includes(country)) {
    return {
      allowed: false,
      response: new Response('Access denied', { status: 403 }),
    }
  }

  // Allowlist mode
  if (policy.allowedCountries && !policy.allowedCountries.includes(country)) {
    return {
      allowed: false,
      response: new Response('Access denied', { status: 403 }),
    }
  }

  return { allowed: true }
}

// ============================================================================
// Bot Filter Policy
// ============================================================================

/**
 * Apply bot filtering policy
 */
export function applyBotFilterPolicy(
  _request: Request,
  policy: BotFilterPolicy,
  context: ProxyContext
): PolicyResult {
  const botScore = context.cf.botScore as number | undefined

  // If bot score is unknown, allow (fail open)
  if (botScore === undefined) {
    return { allowed: true }
  }

  if (botScore < policy.minScore) {
    return {
      allowed: false,
      response: new Response('Access denied', { status: 403 }),
    }
  }

  return { allowed: true }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Proxy snippet handler
 */
const proxyHandler = {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Block access to config file
    if (url.pathname === '/proxy-config.json') {
      return new Response('Not Found', { status: 404 })
    }

    // Build execution context
    const context: ProxyContext = {
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      ip: request.headers.get('CF-Connecting-IP'),
      cf: ((request as Request & { cf?: Record<string, unknown> }).cf) || {},
      jwt: null,
      config: {},
    }

    // Load config (with caching)
    let config: ProxyConfig
    try {
      config = await getConfig(ctx)
      context.config = config.variables || {}
    } catch {
      // Config load failed - passthrough
      return fetch(request)
    }

    // Find matching route
    const route = findRoute(url, request.method, config.routes)
    if (!route) {
      // No matching route - passthrough
      return fetch(request)
    }

    // Clone request for transformation
    let req = new Request(request)

    // Apply request transforms
    if (route.transforms?.request) {
      req = applyRequestTransforms(req, route.transforms.request, context)
    }

    // Apply policies
    if (route.policies) {
      for (const policyId of route.policies) {
        const policy = config.policies[policyId]
        if (!policy) continue

        const result = await applyPolicy(req, policy, context, ctx)

        // Handle CORS preflight
        if (result.preflightResponse) {
          return result.preflightResponse
        }

        // Handle policy rejection
        if (!result.allowed && result.response) {
          return result.response
        }
      }
    }

    // Forward to target
    const response = await fetch(req)

    // Apply response transforms
    if (route.transforms?.response) {
      return applyResponseTransforms(response, route.transforms.response, context)
    }

    return response
  },
}

export default proxyHandler
