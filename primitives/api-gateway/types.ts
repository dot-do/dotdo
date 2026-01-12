/**
 * API Gateway Types
 *
 * Core type definitions for the API Gateway primitive.
 */

/** HTTP Methods supported by the gateway */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD'

/** Route handler function */
export type RouteHandler = (request: APIRequest) => APIResponse | Promise<APIResponse>

/** Route definition */
export interface Route {
  method: HTTPMethod
  path: string
  handler: RouteHandler
  middleware?: Middleware[]
  rateLimit?: RateLimitConfig
}

/** Result of matching a route */
export interface RouteMatch {
  route: Route
  params: Record<string, string>
  query: Record<string, string>
}

/** Middleware function - can modify request/response */
export interface Middleware {
  name?: string
  before?: (request: APIRequest) => APIRequest | Promise<APIRequest> | APIResponse | Promise<APIResponse>
  after?: (request: APIRequest, response: APIResponse) => APIResponse | Promise<APIResponse>
}

/** Incoming API request */
export interface APIRequest {
  method: HTTPMethod
  path: string
  headers: Record<string, string>
  body?: unknown
  params: Record<string, string>
  query: Record<string, string>
  /** Raw URL for parsing */
  url?: string
  /** Context for passing data through middleware */
  context?: Record<string, unknown>
}

/** Outgoing API response */
export interface APIResponse {
  status: number
  headers: Record<string, string>
  body?: unknown
}

/** Rate limiting configuration */
export interface RateLimitConfig {
  /** Maximum requests allowed */
  requests: number
  /** Time window in milliseconds */
  window: number
  /** Key to use for rate limiting (e.g., 'ip', 'user', or a custom extractor) */
  key: string | ((request: APIRequest) => string)
}

/** CORS configuration */
export interface CORSConfig {
  /** Allowed origins (* for all) */
  origins: string[] | '*'
  /** Allowed HTTP methods */
  methods: HTTPMethod[]
  /** Allowed headers */
  headers: string[]
  /** Exposed headers */
  exposedHeaders?: string[]
  /** Allow credentials */
  credentials?: boolean
  /** Max age for preflight cache (seconds) */
  maxAge?: number
}

/** Authentication configuration */
export interface AuthConfig {
  /** Auth type: 'jwt', 'api-key', or 'custom' */
  type: 'jwt' | 'api-key' | 'custom'
  /** Validation function */
  validate: (token: string, request: APIRequest) => boolean | Promise<boolean> | AuthResult | Promise<AuthResult>
  /** Header to extract token from (default: Authorization) */
  header?: string
  /** Scheme for Authorization header (default: Bearer) */
  scheme?: string
}

/** Authentication result */
export interface AuthResult {
  valid: boolean
  user?: Record<string, unknown>
  error?: string
}

/** API Gateway configuration */
export interface APIGatewayConfig {
  /** Base path prefix for all routes */
  basePath?: string
  /** Global middleware */
  middleware?: Middleware[]
  /** CORS configuration */
  cors?: CORSConfig
  /** Default rate limit */
  rateLimit?: RateLimitConfig
  /** Authentication configuration */
  auth?: AuthConfig
}

/** Route group configuration */
export interface RouteGroup {
  prefix: string
  middleware?: Middleware[]
  routes: Array<{
    method: HTTPMethod
    path: string
    handler: RouteHandler
    middleware?: Middleware[]
    rateLimit?: RateLimitConfig
  }>
}
