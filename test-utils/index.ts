// test-utils - Custom test utilities for @dotdo
// See do-xewn - Add custom assertion helpers for testing

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
