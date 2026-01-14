/**
 * ACID Test Suite - Phase 5: E2E Pipeline Configuration
 *
 * E2E test configuration with environment endpoints, timeout settings,
 * retry behavior, and cleanup configuration. Supports multiple environments
 * (local, staging, preview, production) with automatic detection.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

// ============================================================================
// ENVIRONMENT TYPES
// ============================================================================

/**
 * Supported test environments
 */
export type TestEnvironment = 'local' | 'staging' | 'preview' | 'production'

/**
 * Environment endpoint configuration
 */
export interface EnvironmentEndpoint {
  /** Base URL for the environment */
  baseUrl: string
  /** Whether E2E tests are enabled for this environment */
  e2eEnabled: boolean
  /** Whether the environment requires authentication */
  requiresAuth: boolean
  /** Read-only mode (for production) */
  readOnly: boolean
  /** Description for logging */
  description: string
}

/**
 * Timeout configuration for E2E tests
 */
export interface TimeoutConfig {
  /** Default test timeout in milliseconds */
  test: number
  /** Timeout for individual assertions */
  assertion: number
  /** Timeout for pipeline event delivery */
  pipelineDelivery: number
  /** Timeout for Iceberg sink flush */
  icebergFlush: number
  /** Timeout for health check operations */
  healthCheck: number
  /** Timeout for cleanup operations */
  cleanup: number
}

/**
 * Retry configuration for E2E tests
 */
export interface RetryConfig {
  /** Number of retries for flaky tests */
  testRetries: number
  /** Retry delay in milliseconds */
  retryDelay: number
  /** Backoff multiplier for exponential retry */
  backoffMultiplier: number
  /** Maximum retry delay */
  maxRetryDelay: number
}

/**
 * Cleanup configuration for test resources
 */
export interface CleanupConfig {
  /** Whether automatic cleanup is enabled */
  enabled: boolean
  /** Prefix for test resource names */
  prefix: string
  /** Maximum age of test resources before cleanup (seconds) */
  maxAge: number
  /** Run cleanup before tests */
  beforeTests: boolean
  /** Run cleanup after tests */
  afterTests: boolean
}

/**
 * Pipeline SLA configuration
 */
export interface PipelineSLAConfig {
  /** Maximum acceptable end-to-end latency in milliseconds */
  maxE2ELatency: number
  /** Target P50 latency */
  p50Target: number
  /** Target P95 latency */
  p95Target: number
  /** Target P99 latency */
  p99Target: number
  /** Maximum acceptable event loss rate (0-1) */
  maxEventLossRate: number
}

/**
 * Complete E2E configuration
 */
export interface E2EConfig {
  /** Current environment */
  environment: TestEnvironment
  /** Environment endpoints */
  endpoints: Record<TestEnvironment, EnvironmentEndpoint>
  /** Timeout settings */
  timeouts: TimeoutConfig
  /** Retry settings */
  retries: RetryConfig
  /** Cleanup settings */
  cleanup: CleanupConfig
  /** Pipeline SLA settings */
  pipelineSLA: PipelineSLAConfig
  /** Cloudflare credentials (from environment) */
  credentials: {
    accountId?: string
    apiToken?: string
  }
  /** Smoke test specific settings */
  smoke: {
    /** Maximum total time for all smoke tests */
    maxDuration: number
    /** Bail on first failure */
    bail: boolean
  }
}

// ============================================================================
// ENVIRONMENT DETECTION
// ============================================================================

/**
 * Detect the current test environment from environment variables
 */
export function detectEnvironment(): TestEnvironment {
  // Explicit environment override
  const explicit = process.env.E2E_ENVIRONMENT as TestEnvironment
  if (explicit && ['local', 'staging', 'preview', 'production'].includes(explicit)) {
    return explicit
  }

  // CI environment detection
  if (process.env.CI === 'true') {
    // GitHub Actions PR preview deployments
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      return 'preview'
    }
    // Main branch deployments
    if (process.env.GITHUB_REF === 'refs/heads/main') {
      return 'staging'
    }
    // Default CI to staging
    return 'staging'
  }

  // Cloudflare E2E enabled means staging or production
  if (process.env.CLOUDFLARE_E2E === 'true') {
    return 'staging'
  }

  // Default to local
  return 'local'
}

/**
 * Get preview URL from PR number
 */
export function getPreviewUrl(prNumber: string | number): string {
  return `https://pr-${prNumber}.dotdo.pages.dev`
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default endpoint configurations
 */
export const DEFAULT_ENDPOINTS: Record<TestEnvironment, EnvironmentEndpoint> = {
  local: {
    baseUrl: process.env.LOCAL_URL || 'http://localhost:8787',
    e2eEnabled: true,
    requiresAuth: false,
    readOnly: false,
    description: 'Local development server (wrangler dev)',
  },
  staging: {
    baseUrl: process.env.STAGING_URL || 'https://staging.dotdo.do',
    e2eEnabled: true,
    requiresAuth: true,
    readOnly: false,
    description: 'Staging environment for integration tests',
  },
  preview: {
    baseUrl: process.env.PREVIEW_URL || getPreviewUrl(process.env.PR_NUMBER || '0'),
    e2eEnabled: true,
    requiresAuth: false,
    readOnly: false,
    description: 'PR preview deployment',
  },
  production: {
    baseUrl: process.env.PRODUCTION_URL || 'https://dotdo.do',
    e2eEnabled: true,
    requiresAuth: true,
    readOnly: true,
    description: 'Production environment (read-only tests only)',
  },
}

/**
 * Default timeout configuration
 */
export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  test: 30000, // 30 seconds per test
  assertion: 5000, // 5 seconds per assertion
  pipelineDelivery: 60000, // 1 minute for pipeline delivery
  icebergFlush: 300000, // 5 minutes for Iceberg flush (batching delay)
  healthCheck: 10000, // 10 seconds for health checks
  cleanup: 30000, // 30 seconds for cleanup
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRIES: RetryConfig = {
  testRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  maxRetryDelay: 10000,
}

/**
 * Default cleanup configuration
 */
export const DEFAULT_CLEANUP: CleanupConfig = {
  enabled: true,
  prefix: 'e2e-test-',
  maxAge: 3600, // 1 hour
  beforeTests: true,
  afterTests: true,
}

/**
 * Default pipeline SLA configuration
 */
export const DEFAULT_PIPELINE_SLA: PipelineSLAConfig = {
  maxE2ELatency: 300000, // 5 minutes
  p50Target: 5000, // 5 seconds
  p95Target: 30000, // 30 seconds
  p99Target: 60000, // 1 minute
  maxEventLossRate: 0.001, // 0.1% loss rate
}

/**
 * Default smoke test configuration
 */
export const DEFAULT_SMOKE_CONFIG = {
  maxDuration: 60000, // 60 seconds total
  bail: true,
}

// ============================================================================
// CONFIGURATION CREATION
// ============================================================================

/**
 * Create E2E configuration with defaults and overrides
 */
export function createE2EConfig(overrides: Partial<E2EConfig> = {}): E2EConfig {
  const environment = overrides.environment || detectEnvironment()

  return {
    environment,
    endpoints: {
      ...DEFAULT_ENDPOINTS,
      ...overrides.endpoints,
    },
    timeouts: {
      ...DEFAULT_TIMEOUTS,
      ...overrides.timeouts,
    },
    retries: {
      ...DEFAULT_RETRIES,
      ...overrides.retries,
    },
    cleanup: {
      ...DEFAULT_CLEANUP,
      ...overrides.cleanup,
    },
    pipelineSLA: {
      ...DEFAULT_PIPELINE_SLA,
      ...overrides.pipelineSLA,
    },
    credentials: {
      accountId: process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
      ...overrides.credentials,
    },
    smoke: {
      ...DEFAULT_SMOKE_CONFIG,
      ...overrides.smoke,
    },
  }
}

// ============================================================================
// CONFIGURATION SINGLETON
// ============================================================================

/**
 * Global E2E configuration instance
 * Can be overridden with configureE2E()
 */
let globalConfig: E2EConfig | null = null

/**
 * Get the current E2E configuration
 */
export function getE2EConfig(): E2EConfig {
  if (!globalConfig) {
    globalConfig = createE2EConfig()
  }
  return globalConfig
}

/**
 * Configure E2E settings globally
 */
export function configureE2E(overrides: Partial<E2EConfig>): E2EConfig {
  globalConfig = createE2EConfig(overrides)
  return globalConfig
}

/**
 * Reset E2E configuration to defaults
 */
export function resetE2EConfig(): void {
  globalConfig = null
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if E2E tests are enabled for the current environment
 */
export function isE2EEnabled(): boolean {
  const config = getE2EConfig()
  const endpoint = config.endpoints[config.environment]
  return endpoint.e2eEnabled
}

/**
 * Get the base URL for the current environment
 */
export function getBaseUrl(): string {
  const config = getE2EConfig()
  return config.endpoints[config.environment].baseUrl
}

/**
 * Check if the current environment is read-only
 */
export function isReadOnly(): boolean {
  const config = getE2EConfig()
  return config.endpoints[config.environment].readOnly
}

/**
 * Check if authentication is required
 */
export function requiresAuth(): boolean {
  const config = getE2EConfig()
  return config.endpoints[config.environment].requiresAuth
}

/**
 * Check if Cloudflare credentials are available
 */
export function hasCloudflareCredentials(): boolean {
  const config = getE2EConfig()
  return !!(config.credentials.accountId && config.credentials.apiToken)
}

/**
 * Get timeout for a specific operation
 */
export function getTimeout(operation: keyof TimeoutConfig): number {
  const config = getE2EConfig()
  return config.timeouts[operation]
}

/**
 * Generate a unique test resource name
 */
export function generateTestResourceName(suffix?: string): string {
  const config = getE2EConfig()
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const base = `${config.cleanup.prefix}${timestamp}-${random}`
  return suffix ? `${base}-${suffix}` : base
}

/**
 * Check if a resource name is a test resource (for cleanup)
 */
export function isTestResource(name: string): boolean {
  const config = getE2EConfig()
  return name.startsWith(config.cleanup.prefix)
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(attempt: number): number {
  const config = getE2EConfig()
  const delay = config.retries.retryDelay * Math.pow(config.retries.backoffMultiplier, attempt - 1)
  return Math.min(delay, config.retries.maxRetryDelay)
}

// ============================================================================
// EXPORTS
// ============================================================================

export const config = {
  get: getE2EConfig,
  configure: configureE2E,
  reset: resetE2EConfig,
  isE2EEnabled,
  getBaseUrl,
  isReadOnly,
  requiresAuth,
  hasCloudflareCredentials,
  getTimeout,
  generateTestResourceName,
  isTestResource,
  calculateRetryDelay,
}

export default config
