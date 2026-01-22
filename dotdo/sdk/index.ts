/**
 * @dotdo/sdk - Programmatic TypeScript SDK
 *
 * A complete SDK for interacting with dotdo from Node.js,
 * tests, CI/CD pipelines, and programmatic use cases.
 *
 * @module @dotdo/sdk
 *
 * @example
 * ```typescript
 * // Basic usage
 * import { DotdoClient, createDotdoClient } from 'dotdo/sdk'
 *
 * const client = createDotdoClient({
 *   baseUrl: 'https://tenant.api.dotdo.dev',
 *   apiKey: process.env.DOTDO_API_KEY
 * })
 *
 * // CRUD operations
 * const customer = await client.things.create({
 *   $type: 'Customer',
 *   name: 'Alice'
 * })
 *
 * // Testing
 * import { createMockClient, createTestFixture } from 'dotdo/sdk/testing'
 *
 * const mockClient = createMockClient()
 * const fixture = createTestFixture()
 *
 * // Deployment
 * import { deploy, waitForHealthy } from 'dotdo/sdk/deploy'
 *
 * await deploy({ environment: 'production', waitForHealthy: true })
 * ```
 */

// ============================================================================
// Client Exports
// ============================================================================

export {
  // Main client class
  DotdoClient,
  // Factory functions
  createDotdoClient,
  createDotdoClientFromEnv,
  // Error types
  DotdoSDKError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ServerError,
  NetworkError,
  // Configuration types
  type DotdoClientOptions,
  type RetryOptions,
  type ListOptions,
  type PaginatedResponse,
  type RPCOptions,
  // Resource types
  type ThingsResource,
  type EventsResource,
  type RelationshipsResource,
  type HealthResponse,
} from './client'

// ============================================================================
// Testing Exports
// ============================================================================

export {
  // Mock client
  MockDotdoClient,
  createMockClient,
  // Mock data store
  createMockDataStore,
  type MockDataStore,
  type MockClientOptions,
  // Test fixtures
  createTestFixture,
  type TestFixture,
  // Utilities
  generateTestId,
  generateMockId,
  // Assertions
  assertThing,
  assertEvent,
  assertRelationship,
  // Local development
  createLocalClient,
  type LocalServerConfig,
  // Resource tracking
  createResourceTracker,
  type ResourceTracker,
} from './testing'

// ============================================================================
// Deployment Exports
// ============================================================================

export {
  // Deployment
  deploy,
  rollback,
  type DeployConfig,
  type DeployResult,
  type DeployEnvironment,
  type RollbackConfig,
  type RollbackResult,
  // Health checks
  waitForHealthy,
  checkHealth,
  type HealthCheckResult,
  // CI/CD helpers
  detectCIEnvironment,
  determineDeployEnvironment,
  type CIEnvironment,
  // Validation
  validatePrerequisites,
  // Annotations
  createDeploymentAnnotations,
  // Migration types
  type MigrationConfig,
  type MigrationResult,
} from './deploy'
