# Code Review: dotdo v2 Branch

**Date**: 2026-01-17
**Reviewer**: Claude Opus 4.5
**Scope**: core/, rpc/, objects/, lib/

---

## Executive Summary

The dotdo v2 codebase demonstrates a well-architected Durable Objects framework with strong security foundations and good separation of concerns. The code is professionally written with comprehensive documentation and thoughtful module organization.

**Overall Grade: B+**

---

## Category Grades

### 1. Code Quality: A-

**Readability, consistency, patterns**

**Strengths:**
- Excellent JSDoc documentation throughout (e.g., `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts` has thorough module and method documentation)
- Consistent naming conventions (PascalCase for classes/types, camelCase for methods)
- Good use of TypeScript features (generics, discriminated unions, type guards)
- Clean module organization with clear separation of concerns

**Areas for Improvement:**
- DOCore.ts at 3,335 lines is oversized - consider further module extraction
- Some methods have multiple responsibilities (e.g., `listThingsInternal` handles SQL building, validation, and filtering)

### 2. Error Handling: A

**Try-catch, error propagation, recovery**

**Strengths:**
- Centralized error system in `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/errors/index.ts` with standardized error codes and HTTP status mapping
- Custom error classes extend `DotdoError` with consistent structure:
  ```typescript
  // lib/errors/index.ts:203-284
  export class DotdoError extends Error {
    readonly code: ErrorCode
    readonly context?: Record<string, unknown>
    readonly cause?: Error

    toJSON() { ... }
    toClientError() { ... }  // Sanitized for client responses
    getStatusCode() { ... }
  }
  ```
- Error chaining via `cause` property preserves stack traces
- Client-safe error serialization prevents information leakage

**Areas for Improvement:**
- Some error handlers use generic catch blocks without logging (e.g., WebSocket handlers)

### 3. Security: A-

**Input validation, injection prevention, auth**

**Strengths:**
- **SQL Injection Prevention**: Comprehensive SQL security module (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/sql-security.ts:112-147`) blocks:
  - Write operations (INSERT, UPDATE, DELETE)
  - Multi-statement injection
  - SQL comments
  - Administrative commands (PRAGMA, VACUUM)
  - Error message sanitization to prevent schema leakage

- **Authentication Middleware**: Well-designed auth system (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/auth-middleware.ts`) with:
  - JWT validation
  - Permission hierarchies with wildcards (`admin:*`, `*`)
  - Proper 401/403 response handling

- **Capability Token System**: HMAC-signed tokens (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/rpc/capability-token.ts`) for three-party handoff:
  - Scope-based permissions (read < write < admin)
  - Expiry timestamps
  - Attenuation (can only reduce permissions, never escalate)

- **Critical Security Fix Documented**: Line 1379-1387 in DOCore.ts shows a fixed security bug where missing capability secret would grant wildcard admin access

**Areas for Improvement:**
- JWT validation uses `decodeJwtPayload` without signature verification in some paths (line 117-145 in auth-middleware.ts) - relies on secret validation elsewhere
- Path validation exists (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/validation.ts`) but should be more prominently enforced

### 4. Performance: B+

**Hot paths, memory usage, caching**

**Strengths:**
- **LRU Cache Implementation**: Clean O(1) cache (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/lru-cache.ts`) using Map insertion order
- **SQL Pushdown Optimization**: Query operators pushed to SQLite where possible (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/query-validation.ts:431-495`):
  ```typescript
  // Operators pushed to SQLite: $eq, $ne, $gt, $lt, $gte, $lte, $in, $nin
  // Operators requiring in-memory: $regex, $exists
  ```
- **Pipeline Batching**: RPC supports batch requests to reduce round-trips (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts:605-632`)

**Areas for Improvement:**
- Default cache size (1000 entries) may be insufficient for high-throughput workloads
- No connection pooling documented for cross-DO RPC calls
- Missing explicit pagination enforcement on list operations

### 5. Maintainability: B+

**Modularity, coupling, documentation**

**Strengths:**
- **Clean Module Architecture**: Core functionality extracted into focused modules:
  - `DOCoreEvents` - Event handling
  - `DOCoreSchedule` - Scheduling
  - `DOCoreStorage` - Thing CRUD
  - `StateManager` - State access
  - `WebSocketManager` - WebSocket handling

- **Migration System**: Versioned, idempotent schema migrations (`/Users/nathanclevenger/projects/dotdo/.worktrees/v2/db/migrations/index.ts`)
- **Comprehensive Test Suite**: 154 test files with dedicated tests for security, error handling, RPC
- **Deprecation Warnings**: Proper deprecation annotations with migration paths

**Areas for Improvement:**
- DOCore.ts is a God Object - should be further decomposed
- Some circular-looking dependencies between core/ and lib/
- Missing architecture decision records (ADRs)

---

## Top 5 Strengths

1. **Security-First Design**
   - SQL injection prevention is comprehensive and well-tested
   - Capability tokens implement proper attenuation (can only reduce, never escalate permissions)
   - Error messages sanitized before client exposure
   - File: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/sql-security.ts`

2. **Standardized Error Handling**
   - All errors extend DotdoError with consistent structure
   - HTTP status mapping is centralized
   - Error cause chaining preserves debugging context
   - File: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/errors/index.ts`

3. **Cap'n Web Style RPC**
   - Promise pipelining reduces network round-trips
   - Bidirectional callbacks via WebSocket
   - Clean serialization of function references as callback stubs
   - File: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/rpc/websocket-rpc.ts`

4. **Durable Execution Semantics**
   - `$.do()` provides retry with exponential backoff
   - Idempotent replay from action log on restart
   - `$.try()` for single-attempt operations with timeout
   - File: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts:2087-2133`

5. **Comprehensive Validation**
   - Zod-based input validation with helpful error messages
   - Query operators validated before SQL execution
   - Thing type validation enforces PascalCase
   - Files: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/validation/thing-validation.ts`, `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/query-validation.ts`

---

## Top 5 Issues to Address

### 1. [HIGH] DOCore.ts Size and Complexity

**Location**: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts` (3,335 lines)

**Issue**: The file is too large and handles too many concerns, making it difficult to maintain and test in isolation.

**Recommendation**: Extract additional modules:
- `DOCoreRoutes` - HTTP route registration
- `DOCoreThings` - Thing CRUD operations
- `DOCoreDurableExecution` - `$.do()` and `$.try()` methods

### 2. [MEDIUM] JWT Signature Verification Gap

**Location**: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/lib/auth-middleware.ts:117-145`

**Issue**: `decodeJwtPayload` only decodes the JWT without cryptographic signature verification. While the comment mentions using jose library for full verification, this is not implemented.

**Code**:
```typescript
// Line 116-117
// Note: For full verification, use jose library with proper secret
export function decodeJwtPayload(token: string): JwtPayload | null {
```

**Recommendation**: Implement proper JWT signature verification using the jose library or similar. Add a `verifyJwtToken` function that validates the signature.

### 3. [MEDIUM] Missing Rate Limiting on Endpoints

**Location**: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts:502-710`

**Issue**: Protected endpoints have authentication but no rate limiting. The error handling infrastructure supports `RATE_LIMITED` errors but no middleware applies them.

**Recommendation**: Implement rate limiting middleware, especially for:
- `/rpc/pipeline` endpoint
- WebSocket connections
- Thing CRUD operations

### 4. [LOW] Unbounded List Operations

**Location**: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts:2460-2555`

**Issue**: `listThingsInternal` accepts optional `limit` but doesn't enforce a maximum. Large datasets could cause memory issues.

**Code**:
```typescript
// Line 2460-2467
private async listThingsInternal(type: string, query?: {
  where?: Record<string, unknown>
  limit?: number  // No max enforcement
  offset?: number
  ...
}): Promise<ThingData[]> {
```

**Recommendation**: Add a maximum limit (e.g., 1000) and document pagination patterns in the API.

### 5. [LOW] Test Helpers Exposed in Production

**Location**: `/Users/nathanclevenger/projects/dotdo/.worktrees/v2/core/DOCore.ts:1326-1328`

**Issue**: `setCapabilitySecretForTest` is a public RPC method that could be called in production:

```typescript
// Line 1326-1328
setCapabilitySecretForTest(secret: string): void {
  this.capabilitySecret = secret
}
```

**Recommendation**: Gate test methods behind an environment check or move to a separate test mixin.

---

## Detailed Findings by Directory

### /core

| File | Lines | Quality | Notes |
|------|-------|---------|-------|
| DOCore.ts | 3,335 | B | God Object - needs decomposition |
| sql-security.ts | 318 | A | Excellent SQL injection prevention |
| query-validation.ts | 553 | A | Clean operator validation with SQL pushdown |
| lru-cache.ts | 144 | A | Simple, correct LRU implementation |
| state-manager.ts | 439 | A- | Good encapsulation |
| schedule-manager.ts | 258 | A- | Clean CRON DSL |

### /rpc

| File | Lines | Quality | Notes |
|------|-------|---------|-------|
| websocket-rpc.ts | 795 | A | Well-designed bidirectional RPC |
| capability-token.ts | 399 | A | Proper HMAC token system |
| pipeline-executor.ts | 97 | A | Clean pipeline resolution |
| pipelined-stub.ts | 317 | A- | Good Proxy-based recording |

### /lib

| File | Quality | Notes |
|------|---------|-------|
| errors/index.ts | A | Excellent standardized error system |
| auth-middleware.ts | B+ | Good structure, needs JWT signature verification |
| validation/thing-validation.ts | A | Clean Zod-based validation |

---

## Test Coverage Assessment

- **154 test files** across the codebase
- Core module has dedicated test suites for:
  - Security: `capability-security.test.ts`, `sql-security.test.ts`
  - Error handling: `error-handling.test.ts`
  - RPC: `cross-do-rpc.test.ts`, `docore-broker.test.ts`
  - Durable execution: `durable-execution.test.ts`
  - Query validation: `query-validation.test.ts`, `query-validation-integration.test.ts`

**Recommendation**: Add integration tests for WebSocket RPC edge cases and rate limiting scenarios.

---

## Conclusion

The dotdo v2 codebase is well-architected with strong security foundations. The primary recommendation is to decompose DOCore.ts and add JWT signature verification. The Cap'n Web style RPC implementation is particularly impressive, and the error handling system is exemplary.

**Priority Actions**:
1. Implement JWT signature verification in auth-middleware
2. Begin extracting routes and CRUD operations from DOCore.ts
3. Add rate limiting middleware
4. Gate test methods behind environment checks

---

*Review conducted using static analysis. Runtime testing recommended for performance validation.*
