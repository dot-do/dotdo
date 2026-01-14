/**
 * RPC.do Gateway Types
 *
 * Core type definitions for the unified gateway that routes all *.do services.
 *
 * @module services/rpc/types
 */

// ============================================================================
// Service Registry Types
// ============================================================================

/**
 * Service definition for a *.do service
 */
export interface ServiceDefinition {
  /** Service name (e.g., 'agents', 'workers', 'functions') */
  name: string
  /** Service domain (e.g., 'agents.do', 'workers.do') */
  domain: string
  /** Service description */
  description?: string
  /** Available methods on this service */
  methods: ServiceMethod[]
  /** Service version */
  version?: string
  /** Whether the service is active */
  active: boolean
}

/**
 * Method definition for a service
 */
export interface ServiceMethod {
  /** Method name */
  name: string
  /** Method description */
  description?: string
  /** Input schema (JSON Schema) */
  input?: Record<string, unknown>
  /** Output schema (JSON Schema) */
  output?: Record<string, unknown>
  /** Whether the method supports streaming */
  streaming?: boolean
  /** Rate limit tier for this method */
  rateLimitTier?: 'low' | 'medium' | 'high' | 'unlimited'
  /** Cost units for metering */
  costUnits?: number
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Gateway RPC request format
 */
export interface GatewayRequest {
  /** Request ID for correlation */
  id: string
  /** Target service (e.g., 'agents.do', 'workers.do') */
  service: string
  /** Method to invoke */
  method: string
  /** Method parameters */
  params?: unknown
  /** Request metadata */
  meta?: RequestMetadata
}

/**
 * Request metadata
 */
export interface RequestMetadata {
  /** Timeout in milliseconds */
  timeout?: number
  /** Whether to enable tracing */
  trace?: boolean
  /** Custom headers to forward */
  headers?: Record<string, string>
  /** Idempotency key for retry-safe operations */
  idempotencyKey?: string
}

/**
 * Batched request for promise pipelining
 */
export interface BatchedRequest {
  /** Batch ID */
  id: string
  /** Array of requests in the batch */
  requests: GatewayRequest[]
  /** Whether to execute in parallel or sequential */
  parallel?: boolean
  /** Pipeline references between requests */
  pipeline?: PipelineReference[]
}

/**
 * Pipeline reference for promise pipelining
 */
export interface PipelineReference {
  /** Source request ID */
  sourceId: string
  /** Property path to extract from source result */
  sourcePath?: string
  /** Target request ID */
  targetId: string
  /** Parameter name to inject into target */
  targetParam: string
}

/**
 * Gateway response format
 */
export interface GatewayResponse<T = unknown> {
  /** Request ID for correlation */
  id: string
  /** Response status */
  status: 'success' | 'error'
  /** Result data on success */
  result?: T
  /** Error details on failure */
  error?: GatewayError
  /** Response metadata */
  meta?: ResponseMetadata
}

/**
 * Gateway error structure
 */
export interface GatewayError {
  /** Error code */
  code: string
  /** Human-readable error message */
  message: string
  /** Optional error details */
  details?: unknown
  /** Whether the error is retryable */
  retryable?: boolean
  /** Service that generated the error */
  service?: string
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** Request duration in milliseconds */
  durationMs: number
  /** Service that handled the request */
  service: string
  /** Service response time */
  serviceTimeMs?: number
  /** Whether response was cached */
  cached?: boolean
  /** Trace ID for distributed tracing */
  traceId?: string
}

/**
 * Batched response
 */
export interface BatchedResponse {
  /** Batch ID */
  id: string
  /** Array of responses */
  responses: GatewayResponse[]
  /** Total duration for the batch */
  durationMs: number
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Authentication context from id.org.ai
 */
export interface AuthContext {
  /** User ID */
  userId: string
  /** Organization ID */
  orgId?: string
  /** Tenant ID for multi-tenant isolation */
  tenantId: string
  /** Agent ID if request is from an agent */
  agentId?: string
  /** Authentication method used */
  method: 'jwt' | 'api_key' | 'session' | 'oauth'
  /** User role */
  role: 'admin' | 'user' | 'agent'
  /** Granted permissions/scopes */
  permissions: string[]
  /** Token expiration time */
  expiresAt?: Date
}

/**
 * API key configuration
 */
export interface ApiKeyConfig {
  /** Key ID */
  id: string
  /** Associated user ID */
  userId: string
  /** Associated tenant ID */
  tenantId: string
  /** Key name/description */
  name: string
  /** Key permissions/scopes */
  permissions: string[]
  /** Rate limit tier */
  rateLimitTier: 'free' | 'pro' | 'enterprise' | 'unlimited'
  /** Key creation date */
  createdAt: Date
  /** Key expiration date */
  expiresAt?: Date
  /** Last used timestamp */
  lastUsedAt?: Date
  /** Whether the key is active */
  active: boolean
}

// ============================================================================
// Rate Limiting Types
// ============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Requests per second */
  rps?: number
  /** Requests per minute */
  rpm?: number
  /** Requests per hour */
  rph?: number
  /** Requests per day */
  rpd?: number
  /** Concurrent request limit */
  concurrency?: number
  /** Burst allowance */
  burst?: number
}

/**
 * Rate limit tiers
 */
export const RATE_LIMIT_TIERS: Record<string, RateLimitConfig> = {
  free: { rpm: 60, rph: 1000, rpd: 10000, concurrency: 5 },
  pro: { rpm: 300, rph: 10000, rpd: 100000, concurrency: 20 },
  enterprise: { rpm: 1000, rph: 50000, rpd: 500000, concurrency: 100 },
  unlimited: { concurrency: 1000 },
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Time until reset (seconds) */
  resetIn: number
  /** Which limit was hit (if any) */
  limitType?: 'rps' | 'rpm' | 'rph' | 'rpd' | 'concurrency'
  /** Retry after (seconds) */
  retryAfter?: number
}

// ============================================================================
// Metering Types
// ============================================================================

/**
 * Usage event for metering
 */
export interface UsageEvent {
  /** Event ID */
  id: string
  /** Timestamp */
  timestamp: Date
  /** Tenant ID */
  tenantId: string
  /** User ID */
  userId?: string
  /** Agent ID */
  agentId?: string
  /** API key ID */
  apiKeyId?: string
  /** Service called */
  service: string
  /** Method called */
  method: string
  /** Request duration in ms */
  durationMs: number
  /** Response status */
  status: 'success' | 'error'
  /** Cost units consumed */
  costUnits: number
  /** Input tokens (for AI services) */
  inputTokens?: number
  /** Output tokens (for AI services) */
  outputTokens?: number
  /** Request size in bytes */
  requestSize?: number
  /** Response size in bytes */
  responseSize?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Usage summary for billing
 */
export interface UsageSummary {
  /** Period start */
  periodStart: Date
  /** Period end */
  periodEnd: Date
  /** Tenant ID */
  tenantId: string
  /** Total requests */
  totalRequests: number
  /** Successful requests */
  successfulRequests: number
  /** Failed requests */
  failedRequests: number
  /** Total cost units */
  totalCostUnits: number
  /** Total input tokens */
  totalInputTokens: number
  /** Total output tokens */
  totalOutputTokens: number
  /** Breakdown by service */
  byService: Record<string, ServiceUsage>
}

/**
 * Per-service usage
 */
export interface ServiceUsage {
  /** Service name */
  service: string
  /** Request count */
  requests: number
  /** Cost units */
  costUnits: number
  /** Error count */
  errors: number
  /** Average latency */
  avgLatencyMs: number
}

// ============================================================================
// Audit Log Types
// ============================================================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Entry ID */
  id: string
  /** Timestamp */
  timestamp: Date
  /** Tenant ID */
  tenantId: string
  /** User ID (if authenticated) */
  userId?: string
  /** Agent ID (if from agent) */
  agentId?: string
  /** API key ID (if authenticated via API key) */
  apiKeyId?: string
  /** Action performed */
  action: string
  /** Resource type */
  resourceType: string
  /** Resource ID */
  resourceId?: string
  /** Service that handled the request */
  service: string
  /** Request method */
  method: string
  /** IP address (hashed for privacy) */
  ipHash?: string
  /** User agent */
  userAgent?: string
  /** Request ID for correlation */
  requestId: string
  /** Response status */
  status: 'success' | 'error'
  /** Error code (if error) */
  errorCode?: string
  /** Duration in ms */
  durationMs: number
  /** Additional context */
  context?: Record<string, unknown>
}

// ============================================================================
// Service Discovery Types
// ============================================================================

/**
 * Service endpoint configuration
 */
export interface ServiceEndpoint {
  /** Service domain */
  domain: string
  /** Service binding (for internal routing) */
  binding?: string
  /** External URL (for external services) */
  url?: string
  /** Health check path */
  healthPath?: string
  /** Whether the service is healthy */
  healthy: boolean
  /** Last health check timestamp */
  lastHealthCheck?: Date
}

/**
 * Service registry for discovery
 */
export interface ServiceRegistry {
  /** Get service definition by name */
  getService(name: string): ServiceDefinition | undefined
  /** Get service endpoint */
  getEndpoint(name: string): ServiceEndpoint | undefined
  /** List all services */
  listServices(): ServiceDefinition[]
  /** Check if service exists */
  hasService(name: string): boolean
  /** Refresh service registry */
  refresh(): Promise<void>
}

// ============================================================================
// Gateway Configuration
// ============================================================================

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  /** Gateway name */
  name: string
  /** Gateway version */
  version: string
  /** Default timeout in ms */
  defaultTimeout: number
  /** Maximum batch size */
  maxBatchSize: number
  /** Enable request logging */
  enableLogging: boolean
  /** Enable metrics */
  enableMetrics: boolean
  /** Enable tracing */
  enableTracing: boolean
  /** CORS configuration */
  cors?: CorsConfig
  /** Authentication configuration */
  auth?: AuthConfig
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  /** Allowed origins */
  origins: string[]
  /** Allowed methods */
  methods: string[]
  /** Allowed headers */
  headers: string[]
  /** Whether to allow credentials */
  credentials: boolean
  /** Max age for preflight cache */
  maxAge: number
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** id.org.ai JWKS URL */
  jwksUrl?: string
  /** JWT secret for local validation */
  jwtSecret?: string
  /** API key validation endpoint */
  apiKeyValidationUrl?: string
  /** Public paths that don't require auth */
  publicPaths: string[]
  /** Session cookie name */
  sessionCookieName?: string
}
