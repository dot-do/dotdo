/**
 * @dotdo/test-utils - Shared test utilities for dotdo packages
 *
 * This module provides common utilities to reduce duplication across test files:
 * - DO stub helpers (getTestDO, generateTestId)
 * - RPC helpers for calling DO methods
 * - Test data factories for Things, Events, Relationships
 * - Custom assertion helpers
 * - Async utilities (sleep, waitFor, retry)
 * - Miniflare setup utilities
 *
 * Following the NO MOCKS philosophy - these utilities work with real Miniflare/DO instances.
 *
 * @module @dotdo/test-utils
 *
 * @example
 * ```typescript
 * import { env } from 'cloudflare:test'
 * import {
 *   getTestDO,
 *   generateTestId,
 *   rpc,
 *   createCustomerInput,
 *   expectValidEntity
 * } from '@dotdo/test-utils'
 *
 * it('should create a customer', async () => {
 *   const stub = getTestDO(env)
 *   const input = createCustomerInput({ name: 'Alice' })
 *   const customer = await rpc(stub, 'things.create', [input])
 *   expectValidEntity(customer)
 *   expect(customer.name).toBe('Alice')
 * })
 * ```
 */

// ============================================================================
// Helpers - DO stub helpers, RPC utilities, async helpers
// ============================================================================
export {
  // ID Generation
  generateTestId,
  generateDeterministicId,

  // DO Stub Helpers
  getTestDO,
  createTestId,

  // RPC Helpers
  rpc,
  rpcMayFail,

  // Request Helpers
  createJsonRequest,
  createRpcRequest,

  // Async Test Utilities
  sleep,
  waitFor,
  retry,

  // Types
  type HealthResponse,
  type InfoResponse,
  type ErrorResponse,
} from './helpers'

// ============================================================================
// Factories - Test data creation utilities
// ============================================================================
export {
  // Thing Factories
  createThingInput,
  createThing,
  createThingInputs,

  // Event Factories
  createEventInput,
  createEvent,
  createEventInputs,

  // Relationship Factories
  createRelationshipInput,
  createRelationship,
  createRelationshipInputs,

  // Domain-Specific Factories
  createCustomerInput,
  createOrderInput,
  createUserInput,

  // Batch Creation
  createTestBatch,

  // Types
  type ThingInput,
  type Thing,
  type EventInput,
  type Event,
  type RelationshipInput,
  type Relationship,
} from './factories'

// ============================================================================
// Assertions - Custom test assertion helpers
// ============================================================================
export {
  // Entity assertions
  expectValidEntity,
  expectValidEvent,
  expectValidRelationship,
  expectValidEntityList,
  expectValidEventList,
  expectValidRelationshipList,

  // RPC assertions
  expectRPCError,
  expectRPCErrorType,

  // Response assertions
  expectJsonResponse,
  expectHATEOASResponse,
  expectErrorResponse,

  // Link assertions
  expectValidLink,

  // Timestamp assertions
  expectValidTimestamp,
  expectTimestampNear,

  // ID assertions
  expectValidId,
  expectIdPattern,

  // Types from assertions (canonical definitions)
  type RPCError,
  type Link,
  type HATEOASResponse,
} from './assertions'

// ============================================================================
// Miniflare - Real DO testing utilities
// ============================================================================
export {
  // Miniflare Setup
  createTestMiniflare,
  getDoStub,

  // Types
  type TestMiniflareOptions,
  type TestMiniflareResult,
  type WaitForOptions,
} from './miniflare-utils'
