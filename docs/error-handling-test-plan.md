# Error Handling Standards - Test Plan (do-3haz Wave 5)

## Overview

This document describes the RED phase test suite for error handling consistency across dotdo. The tests define the desired interface for standardized error handling across the codebase.

**Status**: RED - 26 failing tests define desired behavior
**Issue**: do-3haz (Wave 5 - Error Handling Consistency)
**Test Files**:
- `/lib/tests/error-handling-coverage.test.ts` - Core error interface tests
- `/lib/tests/error-serialization.test.ts` - RPC serialization tests

## Current State

The codebase has several error types that lack standardization:

### Error Types Currently in Use

1. **QueryValidationError** (`core/query-validation.ts`)
   - Has: `message`, `field`, `operator`, `details`
   - Missing: `code`, `context`, `toJSON()`, `toClientError()`

2. **SqlSecurityError** (`core/sql-security.ts`)
   - Has: `message`, `code`, `query`
   - Missing: `context` property, `toJSON()`, `toClientError()`
   - Issue: `query` field leaks sensitive SQL in error serialization

3. **CapabilityError** (`rpc/capability-token.ts`)
   - Has: `message`, `code`
   - Missing: `context`, `toJSON()`, `toClientError()`, `cause` support

4. **RPCError** (`rpc/proxy.ts`)
   - Has: `message`, `code`, `method`, `target`, `partialResults`
   - Missing: `context` property aggregation, `toJSON()`, `toClientError()`, `cause` support

5. **HTTP Errors** (`packages/middleware/src/error/index.ts`)
   - Various classes like `BadRequestError`, `UnauthorizedError`, etc.
   - Have: `code`, `message`, `status`
   - Missing: `context`, `toJSON()`, `toClientError()`, standardized structure

## Desired Interface

All error types should implement the `DotdoError` interface:

```typescript
interface DotdoError extends Error {
  // Standard properties
  name: string              // Error class name for debugging
  message: string           // Human-readable error message
  code: string              // Machine-readable error code

  // Structured context
  context?: Record<string, unknown>  // Aggregates domain-specific properties

  // Error chaining (ES2022)
  cause?: Error | null

  // Serialization support
  toJSON?(): {
    name: string
    message: string
    code: string
    context?: Record<string, unknown>
    stack?: string
  }

  // Client-safe transformation
  toClientError?(): {
    code: string
    message: string
    context?: Record<string, unknown>
  }
}
```

## Test Coverage

### 1. Type Consistency (5 test suites, 21 tests)

Tests that all error types:
- Extend `Error` class
- Have `code` property with documented error code
- Have `context` property with domain-specific metadata
- Have `toJSON()` serialization method
- Have `toClientError()` for safe transmission

**Current Status**: ✗ FAILING - No error classes have standardized `code`, `context`, `toJSON()`, or `toClientError()` properties

### 2. Code Consistency (3 test suites, 7 tests)

Tests that verify:
- All error codes are documented in central registry
- Error codes are used consistently across error types
- No undocumented error codes are introduced

**Documented Error Codes**:
```
General:          INTERNAL_ERROR, UNKNOWN_ERROR, NOT_IMPLEMENTED
Validation:       VALIDATION_ERROR, INVALID_INPUT, MISSING_REQUIRED, TYPE_MISMATCH
Not Found:        NOT_FOUND, THING_NOT_FOUND, METHOD_NOT_FOUND
Request:          BAD_REQUEST, METHOD_NOT_ALLOWED, CONFLICT, UNPROCESSABLE_ENTITY
Security:         UNAUTHORIZED, FORBIDDEN, INSUFFICIENT_SCOPE, SECRET_REQUIRED,
                  EXPIRED, INVALID_SIGNATURE, WRONG_TARGET
SQL:              EMPTY_QUERY, INVALID_QUERY, WRITE_OPERATION_FORBIDDEN,
                  MULTI_STATEMENT_FORBIDDEN, COMMENT_FORBIDDEN, PRAGMA_FORBIDDEN,
                  COMMAND_FORBIDDEN
RPC:              RPC_ERROR, TIMEOUT, VERSION_MISMATCH, REVOKED
Storage:          VERSION_CONFLICT, CONDITION_FAILED
```

**Current Status**: ✓ PASSING - Existing error codes map to documented registry

### 3. Context Standardization (2 test suites, 7 tests)

Tests that:
- All errors have a `context` property
- Context contains domain-specific metadata (field, operator, query, method, target, etc.)
- Context never contains sensitive information
- Context is JSON-serializable

**Current Status**: ✗ FAILING - No error classes have `context` property

### 4. Error Serialization (3 test suites, 7 tests)

Tests that:
- All errors have `toJSON()` method
- Serialized errors include `name`, `message`, `code`, and `context`
- Serialized errors survive JSON round-trip
- Sensitive information is stripped from serialization
- Stack traces are included in development but stripped in production

**Current Status**: ✗ FAILING - No error classes have `toJSON()` method

### 5. Error Chaining (2 test suites, 6 tests)

Tests that:
- Errors support ES2022 `cause` property
- Error chains preserve original messages
- Multiple levels of wrapping are supported
- Cause chains survive JSON serialization

**Current Status**: ✗ FAILING - No error classes properly support `cause` property

### 6. RPC Serialization (4 test suites, 15 tests)

Tests that:
- Errors serialize with `$type` marker for reconstruction
- Error types are preserved through serialization round-trip
- Error messages survive encoding/decoding
- Multi-level cause chains are preserved
- Stack traces are handled safely
- Sensitive information is never exposed

**Current Status**: ✗ FAILING - Mock serialization partially works but lacks error-specific handling

### 7. Client Safety (3 test suites, 10 tests)

Tests that:
- Errors have `toClientError()` method
- Client errors never expose sensitive information
- Client errors never include stack traces
- Stack traces are preserved in development
- Stack traces identify error location

**Current Status**: ✗ PARTIALLY PASSING - Stack traces work, but no `toClientError()` method exists

## Test Results Summary

```
Test Files:  2 failed (2)
Tests:       26 failed | 65 passed (91)
Pass Rate:   71.4%
```

### Passing Tests (65)
- Error code registry validation
- Code usage consistency
- Stack trace capture
- Basic error instantiation
- Type guards and assertions

### Failing Tests (26)
- Missing `code` property on QueryValidationError
- Missing `context` property on all error types
- Missing `toJSON()` method on all error types
- Missing `toClientError()` method on all error types
- Missing proper `cause` property support
- Missing serialization support for error chains

## Implementation Phases

### Phase: GREEN (Next)

1. **Add `code` property to QueryValidationError**
   - Should map to `VALIDATION_ERROR` or similar
   - Should be readonly

2. **Add `context` property to all error types**
   - Aggregate existing properties into context
   - Example for RPCError: `{ method, target, partialResults }`
   - Example for SqlSecurityError: `{ query }` (but query is stripped in serialization)

3. **Implement `toJSON()` method**
   - Return object with `name`, `message`, `code`, `context`, optional `stack`
   - Strip sensitive information
   - Strip stack in production environments

4. **Implement `toClientError()` method**
   - Return safe subset of error info for transmission
   - Never include stack trace
   - Never include sensitive data
   - Include code and message only

5. **Add `cause` property support**
   - Accept optional cause in constructor or via property
   - Support ES2022 error chaining pattern
   - Preserve cause through serialization

### Phase: REFACTOR

1. Create `lib/errors/base.ts` with base `DotdoError` class
2. Create `lib/errors/registry.ts` with centralized error code definitions
3. Create `lib/errors/serialization.ts` with serialize/deserialize utilities
4. Migrate all error types to extend base class

### Phase: VERIFY

1. Run full test suite
2. Update error handling middleware
3. Update RPC transport layer
4. Add integration tests

## Error Code Registry

The central error code registry serves as the source of truth:

**Location**: `lib/errors/registry.ts` (to be created in GREEN phase)

Example structure:
```typescript
export const ERROR_CODES = {
  // General
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
  UNKNOWN_ERROR: { code: 'UNKNOWN_ERROR', status: 500 },

  // Validation
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  INVALID_INPUT: { code: 'INVALID_INPUT', status: 400 },

  // SQL
  WRITE_OPERATION_FORBIDDEN: { code: 'WRITE_OPERATION_FORBIDDEN', status: 403 },

  // RPC
  TIMEOUT: { code: 'TIMEOUT', status: 504 },
  METHOD_NOT_FOUND: { code: 'METHOD_NOT_FOUND', status: 404 },

  // Auth
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  EXPIRED: { code: 'EXPIRED', status: 401 },
} as const
```

## Testing Guidelines

### Running Tests

```bash
# Run all error handling tests
npx vitest run lib/tests/error-*.test.ts

# Run with coverage
npx vitest run --coverage lib/tests/error-*.test.ts

# Run in watch mode
npx vitest lib/tests/error-*.test.ts
```

### Test Naming Convention

RED phase tests use prefix: `RED: should ...`
- Indicates desired but not-yet-implemented behavior
- Tests serve as executable specification
- Tests fail until implementation is complete

GREEN phase tests use prefix: `should ...` or `GREEN: should ...`
- Indicate implemented behavior
- Tests should pass in GREEN phase

REFACTOR phase tests use prefix: `REFACTOR: should ...`
- Indicate behavior that needs restructuring
- Tests validate refactoring doesn't break functionality

## Integration Points

### 1. Middleware Error Handling
- `packages/middleware/src/error/index.ts` uses error codes for HTTP responses
- Should map `DotdoError.code` → HTTP status codes

### 2. RPC Transport
- `rpc/transport.ts` serializes/deserializes errors
- Should use `DotdoError.toJSON()` for transmission
- Should use `DotdoError.toClientError()` for external APIs

### 3. DO Error Wrapping
- `objects/DO.ts` wraps SQLite and RPC errors
- Should wrap all errors in consistent `DotdoError` subclasses
- Should preserve original error as `cause`

### 4. API Responses
- `api/index.ts` catches errors and returns responses
- Should call `error.toClientError()` for HTTP responses
- Should include correlation ID for tracing

## Success Criteria (GREEN Phase)

- [x] All test files created and passing lint checks
- [ ] All 26 failing tests pass
- [ ] No sensitive information exposed in error serialization
- [ ] Error codes are centralized and documented
- [ ] All error types implement `DotdoError` interface
- [ ] Stack traces work correctly in development/production
- [ ] RPC error transmission preserves error types
- [ ] Error chains survive multiple serialization round-trips

## References

- **Issue**: do-3haz (Wave 5 - Error Handling Consistency)
- **Test Files**:
  - `/lib/tests/error-handling-coverage.test.ts`
  - `/lib/tests/error-serialization.test.ts`
- **Existing Error Classes**:
  - `core/query-validation.ts` - QueryValidationError
  - `core/sql-security.ts` - SqlSecurityError
  - `rpc/capability-token.ts` - CapabilityError
  - `rpc/proxy.ts` - RPCError
  - `packages/middleware/src/error/index.ts` - HTTP errors
- **Related**: do-ld03 (SQL Security), RPC transport layer

## Notes

- All tests follow the TEST-DRIVEN DEVELOPMENT pattern (RED → GREEN → REFACTOR)
- RED phase tests document the desired interface without implementation
- Tests are designed to be non-mocking (real error instances)
- Security is paramount: no sensitive data in serialized errors
- Stack trace handling differs by environment (dev vs production)
