/**
 * Mock Model Support for @dotdo/ai
 *
 * Provides mock model functionality for testing when ai-providers is not installed:
 * - Configurable mock behavior (allow/disallow, warnings)
 * - Environment detection (production, test, development)
 * - Mock model creation for generateText, generateObject, streaming
 * - Mock embedding generation
 *
 * @module @dotdo/ai/mock
 */

import { MockModelNotAllowedError } from './errors'
import { createScopedLogger, LogLevel } from '@dotdo/utils'

// Create a scoped logger for the mock module
const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[ai-mock]' })

// ============================================================================
// Internal Type Definitions
// ============================================================================

/**
 * Type for global environment variables in different runtimes.
 * Cloudflare Workers use globalThis.ENVIRONMENT, Node.js uses process.env.
 */
interface GlobalWithEnv {
  ENVIRONMENT?: string
  __vitest_worker__?: unknown
  jest?: unknown
}

/**
 * Type for Node.js process.env (used for environment detection without @types/node)
 */
declare const process: {
  env: Record<string, string | undefined>
} | undefined

/**
 * Minimal interface for mock model generate options.
 * The actual AI SDK uses complex types, but our mock only needs basic compatibility.
 */
export interface MockGenerateOptions {
  prompt?: string
  messages?: Array<{ role: string; content: string }>
  maxTokens?: number
  temperature?: number
}

/**
 * Minimal interface for mock model generate result.
 */
export interface MockGenerateResult {
  text: string
  finishReason: 'stop' | 'length' | 'error'
  usage: { promptTokens: number; completionTokens: number }
}

/**
 * Minimal interface for mock model stream result.
 */
export interface MockStreamResult {
  stream: AsyncGenerator<
    | { type: 'text-delta'; textDelta: string }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'error'; usage: { promptTokens: number; completionTokens: number } }
  >
}

/**
 * Internal mock model interface for testing.
 * This is separate from the external LanguageModel type to avoid coupling.
 */
export interface MockLanguageModel {
  provider: 'mock'
  modelId: string
  specificationVersion: string
  doGenerate(options: MockGenerateOptions): Promise<MockGenerateResult>
  doStream(options: MockGenerateOptions): Promise<MockStreamResult>
}

// ============================================================================
// Mock Model Configuration
// ============================================================================

/**
 * Configuration options for mock model behavior
 */
export interface MockModelConfig {
  /**
   * Whether mock models are allowed. Defaults based on environment:
   * - 'auto': Allow in test/development, disallow in production (default)
   * - true: Always allow mock models (use with caution)
   * - false: Never allow mock models (throws if ai-providers unavailable)
   */
  allowMock?: 'auto' | boolean

  /**
   * Whether to log warnings when mock model is used.
   * Default: true
   */
  warnOnMock?: boolean

  /**
   * Custom warning handler. Defaults to console.warn.
   */
  onMockWarning?: (message: string, context: { model: string; operation: string }) => void
}

// Global mock model configuration
let mockConfig: MockModelConfig = {
  allowMock: 'auto',
  warnOnMock: true,
}

// Track if we've warned about mock usage (to avoid spamming)
let mockWarningIssued = false

/**
 * Configure mock model behavior
 *
 * @example
 * ```ts
 * // Disable mock models entirely (fail if ai-providers unavailable)
 * configureMockModel({ allowMock: false })
 *
 * // Enable mock models with custom warning handler
 * configureMockModel({
 *   allowMock: true,
 *   warnOnMock: true,
 *   onMockWarning: (msg, ctx) => logger.warn(msg, ctx),
 * })
 * ```
 */
export function configureMockModel(config: MockModelConfig): void {
  mockConfig = { ...mockConfig, ...config }
  // Reset warning flag when config changes
  mockWarningIssued = false
}

/**
 * Get current mock model configuration
 */
export function getMockConfig(): MockModelConfig {
  return { ...mockConfig }
}

/**
 * Reset mock model configuration to defaults (useful for testing)
 */
export function resetMockConfig(): void {
  mockConfig = {
    allowMock: 'auto',
    warnOnMock: true,
  }
  mockWarningIssued = false
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detect if we're running in a production environment
 */
export function isProduction(): boolean {
  // Check common environment variables
  if (typeof process !== 'undefined' && process.env) {
    const env = process.env['NODE_ENV'] || process.env['ENVIRONMENT'] || ''
    if (env.toLowerCase() === 'production' || env.toLowerCase() === 'prod') {
      return true
    }
  }
  // Check Cloudflare Workers environment
  if (typeof globalThis !== 'undefined' && (globalThis as GlobalWithEnv).ENVIRONMENT === 'production') {
    return true
  }
  return false
}

/**
 * Detect if we're running in a test environment
 */
export function isTestEnvironment(): boolean {
  // Check common test environment indicators
  if (typeof process !== 'undefined' && process.env) {
    // NODE_ENV=test
    if (process.env['NODE_ENV'] === 'test') return true
    // Vitest
    if (process.env['VITEST'] === 'true') return true
    // Jest
    if (process.env['JEST_WORKER_ID'] !== undefined) return true
    // CI environments often set this
    if (process.env['CI'] === 'true') return true
  }
  // Check if vitest/jest globals are present
  if (typeof globalThis !== 'undefined') {
    if ((globalThis as GlobalWithEnv).__vitest_worker__) return true
    if ((globalThis as GlobalWithEnv).jest) return true
  }
  return false
}

/**
 * Check if mock models should be allowed based on configuration and environment
 */
export function shouldAllowMock(): boolean {
  if (mockConfig.allowMock === true) return true
  if (mockConfig.allowMock === false) return false

  // 'auto' mode: allow in test/dev, disallow in production
  if (isTestEnvironment()) return true
  if (isProduction()) return false

  // Default to allowing in development
  return true
}

/**
 * Log a warning about mock model usage
 */
export function warnMockUsage(model: string, operation: string): void {
  if (!mockConfig.warnOnMock) return
  if (mockWarningIssued && operation === 'resolve') return // Only warn once per session for model resolution

  const message = `[dotdo/ai] Using MOCK model for "${model}" because ai-providers is not installed. ` +
    `This returns fake responses and should NOT be used in production. ` +
    `Install ai-providers or configure a real provider to use actual AI models.`

  if (mockConfig.onMockWarning) {
    mockConfig.onMockWarning(message, { model, operation })
  } else {
    logger.warn(message)
  }

  if (operation === 'resolve') {
    mockWarningIssued = true
  }
}

// ============================================================================
// Mock Model Type Guards
// ============================================================================

/**
 * Type guard to check if a model is our internal mock model.
 */
export function isMockModel(model: unknown): model is MockLanguageModel {
  return (
    typeof model === 'object' &&
    model !== null &&
    'provider' in model &&
    (model as { provider: unknown }).provider === 'mock'
  )
}

// ============================================================================
// Mock Model Creation
// ============================================================================

// Type alias for AI SDK models (using any due to complex type resolution issues)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageModel = any

/**
 * Create a mock LanguageModel for testing when ai-providers is not installed.
 *
 * IMPORTANT: This should only be used when the ai-providers module is genuinely
 * not available (development/testing without the optional dependency).
 * Real errors from ai-providers should propagate to the caller.
 *
 * @throws {MockModelNotAllowedError} If mock models are not allowed in current environment
 */
export function createMockModel(modelId: string): LanguageModel {
  // Check if mock models are allowed
  if (!shouldAllowMock()) {
    throw new MockModelNotAllowedError(modelId)
  }

  // Warn about mock usage
  warnMockUsage(modelId, 'resolve')

  const mockModel: MockLanguageModel = {
    provider: 'mock',
    modelId,
    specificationVersion: 'v1',
    async doGenerate(_options: MockGenerateOptions): Promise<MockGenerateResult> {
      return {
        text: `Mock response for model: ${modelId}`,
        finishReason: 'stop' as const,
        usage: { promptTokens: 10, completionTokens: 20 },
      }
    },
    async doStream(_options: MockGenerateOptions): Promise<MockStreamResult> {
      return {
        stream: (async function* () {
          yield { type: 'text-delta' as const, textDelta: 'Mock response' }
          yield { type: 'finish' as const, finishReason: 'stop' as const, usage: { promptTokens: 10, completionTokens: 20 } }
        })(),
      }
    },
  }
  return mockModel as unknown as LanguageModel
}

// ============================================================================
// Mock Embeddings
// ============================================================================

/**
 * Generate mock embeddings for testing when ai-providers is not installed.
 * Returns deterministic mock embeddings based on text length.
 */
export function generateMockEmbedding(text: string, dimensions: number = 1536): number[] {
  // Use a simple deterministic algorithm based on text
  // This ensures tests get consistent results
  const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return Array.from({ length: dimensions }, (_, i) =>
    Math.sin(seed * (i + 1) * 0.001) * 0.5
  )
}

// ============================================================================
// Module Detection Utilities
// ============================================================================

/**
 * Check if an error is a module not found error
 */
export function isModuleNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    // Node.js/Vite MODULE_NOT_FOUND error codes
    if ('code' in error && (
      error.code === 'MODULE_NOT_FOUND' ||
      error.code === 'ERR_MODULE_NOT_FOUND'
    )) {
      return true
    }
    // Bundler/ESM import errors - various message formats
    if (error.message.includes('Cannot find module') ||
        error.message.includes('Cannot find package') ||
        error.message.includes('Failed to resolve') ||
        error.message.includes('Cannot resolve module') ||
        error.message.includes('Failed to load url')) {
      return true
    }
  }
  return false
}
