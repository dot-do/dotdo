# DotdoError Interface - Reference Guide

This document describes the standardized error interface that all errors in dotdo should implement.

## Overview

The `DotdoError` interface provides:
1. **Consistent error structure** - All errors have `name`, `message`, `code`, `context`
2. **Machine-readable codes** - Programmatic error handling via centralized codes
3. **Structured context** - Domain-specific metadata in a single `context` object
4. **Error chaining** - Support for ES2022 `cause` property
5. **Safe serialization** - JSON-safe transmission without sensitive data
6. **Client safety** - Separate methods for internal vs. external error transmission

## Interface Definition

```typescript
/**
 * DotdoError - Standardized error interface for dotdo
 *
 * All error types in dotdo should implement this interface.
 * This ensures consistent error handling across the codebase.
 */
interface DotdoError extends Error {
  /**
   * Error class name for debugging and error handling
   * Examples: 'QueryValidationError', 'SqlSecurityError', 'RPCError'
   */
  name: string

  /**
   * Human-readable error message for end users
   * Should not contain sensitive information
   * Examples: 'Invalid operator', 'Token expired'
   */
  message: string

  /**
   * Machine-readable error code for programmatic handling
   * Must be from the documented error codes registry
   * Examples: 'VALIDATION_ERROR', 'TIMEOUT', 'NOT_FOUND'
   */
  code: string

  /**
   * Structured context with domain-specific metadata
   * Replaces scattered error properties
   * Always JSON-serializable, never contains sensitive data
   *
   * @example
   * // QueryValidationError context
   * { field: 'price', operator: '$invalid', details: { ... } }
   *
   * @example
   * // RPCError context
   * { method: 'getOrders', target: 'customer-123', partialResults: [...] }
   */
  context?: Record<string, unknown>

  /**
   * Original error that caused this error (ES2022 Error Cause)
   * Supports error chaining for better debugging
   * Can be null or undefined
   */
  cause?: Error | null

  /**
   * Stack trace for debugging
   * Preserved in development, stripped in production
   */
  stack?: string

  /**
   * Serialize error to JSON-compatible object
   * Used for internal transmission over RPC and storage
   *
   * Returns object with:
   * - name: Error class name
   * - message: Error message
   * - code: Error code
   * - context: Structured metadata (if present)
   * - stack: Stack trace (development only, stripped in production)
   *
   * MUST NOT include sensitive information (passwords, secrets, etc.)
   * MUST NOT include query content for SQL errors
   * MUST be JSON.stringify() compatible
   */
  toJSON?(): {
    name: string
    message: string
    code: string
    context?: Record<string, unknown>
    stack?: string
  }

  /**
   * Transform error for safe client transmission
   * Used for HTTP responses and external APIs
   *
   * Returns object with:
   * - code: Error code for client-side error handling
   * - message: Safe error message for end users
   * - context: Non-sensitive context (if applicable)
   *
   * MUST NOT include stack traces
   * MUST NOT include any sensitive information
   * MUST NOT expose internal implementation details
   */
  toClientError?(): {
    code: string
    message: string
    context?: Record<string, unknown>
  }
}
```

## Usage Examples

### Creating Errors with Context

```typescript
// QueryValidationError - context aggregates field and operator
const error = new QueryValidationError('Invalid operator', 'price', '$invalid')
error.context = {
  field: 'price',
  operator: '$invalid',
  allowedOperators: ['$gt', '$lt', '$eq', '$ne'],
  details: { reason: 'unknown operator' }
}

// RPCError - context includes method and target
const rpcError = new RPCError('Method timeout', {
  code: 'TIMEOUT',
  method: 'processPayment',
  target: 'payment-service-1'
})
rpcError.context = {
  method: 'processPayment',
  target: 'payment-service-1',
  timeout: 5000,
  elapsed: 4987
}

// SqlSecurityError - context includes query info (but NOT the actual query)
const sqlError = new SqlSecurityError('Write operations not allowed', 'WRITE_OPERATION_FORBIDDEN')
sqlError.context = {
  queryType: 'INSERT',
  reason: 'Read-only mode'
}
```

### Error Chaining

```typescript
try {
  await database.query('SELECT ...')
} catch (cause) {
  const error = new RPCError('Failed to fetch orders', {
    code: 'RPC_ERROR',
    method: 'getOrders'
  })
  // Set cause for error chain (ES2022)
  Object.defineProperty(error, 'cause', { value: cause })
  throw error
}

// When caught:
// error.message = 'Failed to fetch orders'
// error.code = 'RPC_ERROR'
// error.cause = Error from database query
// error.context = { method: 'getOrders' }
```

### Serialization for RPC

```typescript
// Internal transmission - use toJSON()
const error = new QueryValidationError('Invalid', 'price', '$gt')
error.context = { field: 'price', operator: '$gt' }

// Serialize for RPC transmission
const json = JSON.stringify(error.toJSON?.() ?? error)
// Result: {"name":"QueryValidationError","message":"Invalid","code":"...","context":{...}}

// Transmit over RPC...

// Deserialize on receiving side
const received = JSON.parse(json)
// Reconstruct error instance based on $type or name
```

### Client-Safe Error Responses

```typescript
// HTTP endpoint catches error
try {
  await processPayment(request)
} catch (error) {
  if (error instanceof Error && 'toClientError' in error) {
    // Safe for sending to client
    const clientError = (error as DotdoError).toClientError()
    return response.json({
      error: clientError
    }, { status: 400 })
  }
}

// Client receives:
// {
//   "error": {
//     "code": "VALIDATION_ERROR",
//     "message": "Invalid payment amount",
//     "context": { "field": "amount", "constraint": "must be > 0" }
//   }
// }
//
// Client does NOT see:
// - Stack traces
// - Internal implementation details
// - Sensitive information (passwords, API keys, etc.)
```

## Error Code Registry

All error codes must come from the documented registry:

### General Errors (5xx Internal)
- `INTERNAL_ERROR` - Unexpected internal failure
- `UNKNOWN_ERROR` - Error type couldn't be determined
- `NOT_IMPLEMENTED` - Feature not yet implemented

### Validation Errors (400 Bad Request)
- `VALIDATION_ERROR` - Generic validation failure
- `INVALID_INPUT` - Input doesn't match expected format
- `MISSING_REQUIRED` - Required field is missing
- `TYPE_MISMATCH` - Value type doesn't match schema

### Not Found Errors (404 Not Found)
- `NOT_FOUND` - Generic resource not found
- `THING_NOT_FOUND` - Thing object doesn't exist
- `METHOD_NOT_FOUND` - RPC method doesn't exist

### Request Errors (4xx)
- `BAD_REQUEST` - Invalid HTTP request
- `METHOD_NOT_ALLOWED` - HTTP method not allowed (405)
- `CONFLICT` - Resource conflict (409)
- `UNPROCESSABLE_ENTITY` - Semantic validation failed (422)

### Security/Auth Errors (401/403)
- `UNAUTHORIZED` - Authentication required (401)
- `FORBIDDEN` - Authenticated but not authorized (403)
- `INSUFFICIENT_SCOPE` - Token/capability lacks required scope
- `SECRET_REQUIRED` - No capability secret configured
- `EXPIRED` - Token or capability has expired
- `INVALID_SIGNATURE` - Cryptographic signature verification failed
- `WRONG_TARGET` - Capability targets wrong resource

### SQL/Query Errors (400)
- `EMPTY_QUERY` - SQL query is empty
- `INVALID_QUERY` - SQL query is malformed
- `WRITE_OPERATION_FORBIDDEN` - Attempting write in read-only mode
- `MULTI_STATEMENT_FORBIDDEN` - Multiple SQL statements not allowed
- `COMMENT_FORBIDDEN` - SQL comments not allowed
- `PRAGMA_FORBIDDEN` - PRAGMA statements not allowed
- `COMMAND_FORBIDDEN` - General command not allowed

### RPC Errors (5xx)
- `RPC_ERROR` - Generic RPC failure
- `TIMEOUT` - RPC call exceeded timeout
- `VERSION_MISMATCH` - RPC protocol version incompatibility
- `REVOKED` - Token has been revoked

### Storage Errors (409)
- `VERSION_CONFLICT` - Optimistic lock version mismatch
- `CONDITION_FAILED` - Conditional write failed

## Migration Guide

### Before (Inconsistent)

```typescript
// Different error structure in each class
class QueryValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public operator?: string,
    public details?: unknown
  ) {
    super(message)
  }
}

// Different error structure elsewhere
class RPCError extends Error {
  code: RPCErrorCode
  method?: string
  target?: string
}

// No toJSON, no toClientError, no context aggregation
```

### After (Standardized)

```typescript
// All errors implement DotdoError interface
class QueryValidationError extends Error implements DotdoError {
  name = 'QueryValidationError'
  code: string = 'VALIDATION_ERROR'
  context: Record<string, unknown>

  constructor(
    message: string,
    field: string,
    operator?: string,
    details?: unknown
  ) {
    super(message)
    this.context = {
      field,
      operator,
      details
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack
    }
  }

  toClientError() {
    return {
      code: this.code,
      message: this.message,
      context: {
        field: this.context.field,
        // Don't expose internal details
      }
    }
  }
}
```

## Security Considerations

### Never Include in `toJSON()` Output
- SQL queries or query fragments
- Database connection strings
- API keys or secrets
- Password hashes
- Cryptographic keys
- Internal file paths
- Sensitive user data

### Never Include in `toClientError()` Output
- Stack traces
- Internal error details
- System information
- Database structure information
- Any information from `toJSON()`

### Safe Things to Include
- Error codes (machine-readable)
- Generic error messages (human-readable)
- Non-sensitive field names
- Request IDs / correlation IDs
- HTTP status codes
- User-safe constraint violations (e.g., "field must be > 0")

### Production vs Development
- **Development**: Include full stack traces and context
- **Production**: Strip stack traces, sanitize messages

```typescript
toJSON() {
  const json = {
    name: this.name,
    message: this.message,
    code: this.code,
    context: this.context
  }

  // Include stack only in development
  if (process.env.NODE_ENV !== 'production') {
    json.stack = this.stack
  }

  return json
}
```

## Testing Errors

```typescript
import { describe, it, expect } from 'vitest'

describe('CustomError', () => {
  it('should implement DotdoError interface', () => {
    const error = new CustomError('Test message', 'MY_ERROR_CODE')

    expect(error.name).toBeDefined()
    expect(error.message).toBe('Test message')
    expect(error.code).toBe('MY_ERROR_CODE')
    expect(error.context).toBeDefined()
    expect(typeof error.toJSON).toBe('function')
    expect(typeof error.toClientError).toBe('function')
  })

  it('should serialize safely', () => {
    const error = new CustomError('Test', 'TEST_CODE')
    const json = error.toJSON()

    expect(JSON.stringify(json)).not.toContain('SECRET')
    expect(JSON.stringify(json)).not.toThrow()
  })

  it('should not expose sensitive info to client', () => {
    const error = new CustomError('DB: password=secret', 'TEST_CODE')
    const clientError = error.toClientError()

    expect(JSON.stringify(clientError)).not.toContain('secret')
    expect(clientError.stack).toBeUndefined()
  })
})
```

## Related Files

- Test suite: `/lib/tests/error-handling-coverage.test.ts`
- Serialization tests: `/lib/tests/error-serialization.test.ts`
- Test plan: `/docs/error-handling-test-plan.md`
- Query validation: `/core/query-validation.ts`
- SQL security: `/core/sql-security.ts`
- Capability tokens: `/rpc/capability-token.ts`
- RPC proxy: `/rpc/proxy.ts`
- Middleware errors: `/packages/middleware/src/error/index.ts`
- Issue: do-3haz (Wave 5 - Error Handling Consistency)
