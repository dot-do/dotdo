// test-utils - Custom test utilities for @dotdo
// See do-xewn - Add custom assertion helpers for testing
// See do-fhng.8 - Add shared test utilities library

// Assertion helpers
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
} from './assertions'

// Miniflare test utilities
export {
  // Miniflare setup
  createTestMiniflare,
  getDoStub,
  generateTestId,

  // Async utilities
  waitFor,
  sleep,
  retry,

  // Request helpers
  createJsonRequest,
  createRpcRequest,

  // Types
  type TestMiniflareOptions,
  type TestMiniflareResult,
  type WaitForOptions,
} from './miniflare'
