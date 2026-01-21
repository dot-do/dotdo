# Error Handling Strategy

This document defines the error handling strategy and propagation contracts for dotdo.

## Error Hierarchy

### Base Classes

dotdo uses a hierarchical error system centered around the `RPCError` base class. All errors in the system inherit from standard JavaScript `Error` with additional structured properties.

```
Error (JavaScript native)
  |
  +-- RPCError (base for all RPC/API errors)
  |     |
  |     +-- NotFoundError (404)
  |     +-- ValidationError (400)
  |     +-- AuthenticationError (401)
  |     +-- AuthorizationError (403)
  |     +-- ConflictError (409)
  |     +-- RateLimitError (429)
  |     +-- TimeoutError (504)
  |     +-- NetworkError (503)
  |     +-- InternalError (500)
  |     +-- ServiceUnavailableError (503)
  |     +-- TransportError (503)
  |     +-- CircuitOpenError (503)
  |
  +-- DigitalObjectsError (base for digital-objects package)
  |     |
  |     +-- NotFoundError
  |     +-- ValidationError
  |     +-- ConflictError
  |     +-- ServerError
  |     +-- NetworkError
  |
  +-- NotImplementedError (for unimplemented functions)
```

### Error Codes

Standard RPC error codes map to HTTP status codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `AUTHENTICATION_ERROR` | 401 | Missing or invalid credentials |
| `AUTHORIZATION_ERROR` | 403 | Insufficient permissions |
| `CONFLICT` | 409 | Resource conflict (e.g., duplicate) |
| `RATE_LIMIT` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `TIMEOUT` | 504 | Operation timed out |
| `NETWORK_ERROR` | 503 | Network connectivity failure |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |
| `CIRCUIT_OPEN` | 503 | Circuit breaker is open |

## When to Throw vs Return Errors

### Throw Errors

Throw exceptions for:

1. **Unrecoverable failures** - Conditions the caller cannot reasonably handle inline
2. **Contract violations** - Invalid parameters, missing required data
3. **Authentication/Authorization failures** - Security boundaries
4. **Resource not found** - When absence is exceptional, not expected

```typescript
// Throw for contract violations
function getUser(id: string): User {
  if (!id) {
    throw new ValidationError('User ID is required', { field: 'id', constraint: 'required' })
  }

  const user = storage.get(id)
  if (!user) {
    throw NotFoundError.forResource('User', id)
  }

  return user
}
```

### Return Errors (Result Pattern)

Return errors as values for:

1. **Expected failure cases** - Operations that commonly fail
2. **Partial success** - Batch operations where some items fail
3. **Validation with multiple errors** - Collecting all validation issues

```typescript
// Return for expected failures
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

function parseConfig(input: string): Result<Config, ValidationError[]> {
  const errors: ValidationError[] = []

  // Collect all errors rather than failing on first
  if (!input.trim()) {
    errors.push(ValidationError.forField('input', 'must not be empty'))
  }

  if (errors.length > 0) {
    return { ok: false, error: errors }
  }

  return { ok: true, value: parseValidConfig(input) }
}
```

### Decision Guide

| Scenario | Strategy | Rationale |
|----------|----------|-----------|
| Missing required parameter | Throw | Contract violation |
| Invalid input format | Throw | Caller should validate |
| User not found | Throw | Usually unexpected |
| Search returns empty | Return `[]` | Expected empty result |
| Batch operation partial failure | Return errors array | Allow caller to handle |
| Network timeout | Throw | Transient, retryable |
| Circuit breaker open | Throw | Caller should know |

## Error Serialization for RPC

### Serialization Format

All errors serialize to a standard JSON format for cross-boundary transmission:

```typescript
interface SerializedError {
  type: string                      // Error class name (e.g., 'NotFoundError')
  code: string                      // Error code (e.g., 'NOT_FOUND')
  message: string                   // Human-readable message
  details?: Record<string, unknown> // Structured details
  httpStatus?: number               // HTTP status code
  stack?: string                    // Stack trace (optional, dev only)
}
```

### Serializing Errors

Use the provided serialization utilities from `@dotdo/rpc`:

```typescript
import {
  serializeError,
  serializeUnknownError,
  deserializeError,
  isSerializedError
} from '@dotdo/rpc'

// Serialize known errors
const serialized = serializeError(new NotFoundError('User not found'))

// Serialize any caught value
try {
  await operation()
} catch (error) {
  return c.json(serializeUnknownError(error), 500)
}

// Deserialize received errors
const errorBody = await response.json()
if (isSerializedError(errorBody)) {
  throw deserializeError(errorBody)
}
```

### Cross-DO RPC Error Handling

When making cross-DO RPC calls, errors are automatically serialized and deserialized:

```typescript
// DO-to-DO call
try {
  await $.Order(orderId).ship()
} catch (error) {
  if (isNotFoundError(error)) {
    // Handle missing order
  } else if (isTransportError(error)) {
    // Handle network issues
  }
}
```

### Error Propagation Chain

```
Client -> Worker -> DO (Source)
              |
              v
         Worker -> DO (Target)
              |
              v
         Error occurs
              |
              v
         serialize(error) -> JSON
              |
              v
         Response (with error body)
              |
              v
         isSerializedError(body) -> deserialize(body)
              |
              v
         Re-throw as typed error
```

## Logging and Monitoring Integration

### Structured Logging

Use the structured logger from `observability/logger.ts` for error logging:

```typescript
import { createStructuredLogger } from '@dotdo/observability/logger'

const logger = createStructuredLogger({ service: 'my-service' })

try {
  await riskyOperation()
} catch (error) {
  logger.error('Operation failed', error)
  // Logs: {
  //   timestamp: "...",
  //   level: "error",
  //   message: "Operation failed",
  //   service: "my-service",
  //   error: { name: "...", message: "...", stack: "..." }
  // }
}
```

### Request Context

Always include request context in error logs:

```typescript
// API middleware adds requestId automatically
baseApp.onError((error, c) => {
  const requestId = c.get('requestId') || 'unknown'

  console.error('Unhandled error:', {
    requestId,
    error: getErrorMessage(error),
    path: c.req.path,
    method: c.req.method
  })

  return c.json({ error: getErrorMessage(error), requestId }, 500)
})
```

### Sensitive Data Redaction

The structured logger automatically redacts sensitive fields:

- `password`, `passwd`, `secret`
- `apikey`, `api_key`, `apiKey`
- `token`, `accesstoken`, `access_token`
- `authorization`, `auth`
- `credential`, `credentials`
- `privatekey`, `private_key`, `privateKey`

JWT tokens and Bearer tokens are also detected and redacted by pattern.

### Fire-and-Forget Error Tracking

For non-awaited operations, use the fire-and-forget error tracking system:

```typescript
import {
  createInMemoryErrorStore,
  trackFireAndForget
} from '@dotdo/do/fire-and-forget-errors'

const errorStore = createInMemoryErrorStore()

// Track errors from fire-and-forget operations
trackFireAndForget(
  errorStore,
  doSomethingAsync(),
  'my-operation',
  { eventType: 'Order.placed', context: { orderId } }
)

// Query tracked errors
const recentErrors = errorStore.getRecent(10)
const stats = errorStore.getStats()
```

### Metrics and Alerting

Error monitoring integration points:

1. **Error counts by type** - Track via `errorStore.getStats().byErrorType`
2. **Recovery rate** - Monitor `errorStore.getStats().recoveryRate`
3. **Circuit breaker state** - Alert on `CircuitOpenError` occurrences
4. **Retry queue depth** - Monitor `retryQueue.getStats().pending`

## User-Facing vs Internal Errors

### User-Facing Errors

User-facing errors should:

1. **Be actionable** - Tell users what they can do
2. **Be safe** - Never expose internal details
3. **Have consistent format** - Always include error code

```typescript
// Good: User-facing error
return c.json({
  error: 'NOT_FOUND',
  message: 'The requested customer was not found',
  requestId: c.get('requestId')
}, 404)

// Bad: Exposes internals
return c.json({
  error: 'Query failed: SELECT * FROM customers WHERE id = ?',
  stack: error.stack  // Never expose stack traces
}, 500)
```

### Internal Errors

Internal errors (500) should:

1. **Log full details** - Stack trace, context, correlation IDs
2. **Return generic message** - "An internal error occurred"
3. **Include request ID** - For support correlation

```typescript
// Internal error handling
if (error instanceof RPCError && error.httpStatus >= 400 && error.httpStatus < 500) {
  // Client error - return details
  return c.json(error.toJSON(), error.httpStatus)
}

// Server error - log details, return generic message
console.error('Internal error:', {
  requestId,
  error: serializeUnknownError(error, { includeStack: true })
})

return c.json({
  error: 'INTERNAL_ERROR',
  message: 'An internal error occurred',
  requestId
}, 500)
```

### Error Response Contract

All error responses follow this contract:

```typescript
interface ErrorResponse {
  // Required
  error: string          // Machine-readable error code
  message: string        // Human-readable message

  // Recommended
  requestId?: string     // Correlation ID

  // Optional (client errors only)
  details?: {
    field?: string       // Field that failed validation
    constraint?: string  // What constraint was violated
    [key: string]: unknown
  }

  // Never include in production
  // stack?: string      // Stack trace (dev only)
}
```

## Retryability

### Retryable Errors

The following error types are automatically retryable:

- `NetworkError` - Transient network failures
- `TimeoutError` - Request timeouts
- `RateLimitError` - Rate limits (with backoff)
- `ServiceUnavailableError` - Temporary service issues
- `CircuitOpenError` - Circuit breaker (wait for reset)

### Non-Retryable Errors

The following should NOT be retried:

- `ValidationError` - Input won't change
- `AuthenticationError` - Credentials won't change
- `AuthorizationError` - Permissions won't change
- `NotFoundError` - Resource doesn't exist
- `ConflictError` - State conflict requires resolution

### Checking Retryability

```typescript
import { isRetryableError } from '@dotdo/rpc'

if (isRetryableError(error)) {
  // Safe to retry with backoff
  await retry(operation, { maxAttempts: 3 })
} else {
  // Don't retry - report failure
  throw error
}
```

### Custom Retryability

Set explicit retryability on custom errors:

```typescript
class CustomError extends Error {
  retriable = true  // or false
}

// isRetryableError checks this property first
```

## When to Use Plain Error vs Typed Error

### Use Typed Errors (Preferred)

Use typed errors from `@dotdo/rpc` or `@dotdo/db` for all errors that:

1. **Cross package/module boundaries** - Any error that might propagate outside the current module
2. **Are user-facing** - Errors returned in API responses
3. **Need retry handling** - Errors where retryability matters
4. **Need HTTP status mapping** - Errors translated to HTTP responses
5. **Represent domain conditions** - Not found, validation, auth errors

```typescript
// Good: Typed errors for cross-boundary operations
import { NotFoundError, ValidationError } from '@dotdo/rpc'

throw NotFoundError.forResource('Customer', customerId)
throw ValidationError.forField('email', 'must be a valid email address')
```

### Acceptable Use of Plain Error

Plain `throw new Error(...)` is acceptable ONLY for:

1. **Internal invariant violations** - Programming errors that should never happen in production
2. **Configuration errors at startup** - Environment setup failures before the app is running
3. **Test code** - Simulating failures in test scenarios

```typescript
// Acceptable: Internal invariant (programming error)
if (!this.state) {
  throw new Error('AlarmHandler: state not set. Call setState() first.')
}

// Acceptable: Configuration error at startup
if (secret.length < 32) {
  throw new Error('DO_INTERNAL_SECRET must be at least 32 characters')
}

// Should be converted: Cross-boundary error
// Bad:
throw new Error(`DO namespace not found: ${namespace}`)
// Good:
throw NotFoundError.forResource('DONamespace', namespace)
```

### Migration Guide

When converting plain errors to typed errors:

| Plain Error Pattern | Typed Error Replacement |
|---------------------|-------------------------|
| `throw new Error('Not found')` | `throw NotFoundError.forResource(type, id)` |
| `throw new Error('Invalid input')` | `throw ValidationError.forField(field, constraint)` |
| `throw new Error('Unauthorized')` | `throw AuthenticationError.missingToken()` |
| `throw new Error('Access denied')` | `throw AuthorizationError.insufficientPermissions(action, resource)` |
| `throw new Error('Already exists')` | `throw ConflictError.resourceExists(type, field, value)` |
| `throw new Error('Timeout')` | `throw TimeoutError.afterMs(timeout)` |
| `throw new Error('Network error')` | `throw NetworkError.connectionRefused(host, port)` |

## Best Practices

### 1. Use Typed Errors

Always use the appropriate error type:

```typescript
// Good
throw NotFoundError.forResource('User', userId)
throw ValidationError.withErrors([{ field: 'email', message: 'Invalid format' }])
throw AuthorizationError.insufficientPermissions('delete', 'Order', ['admin'])

// Bad
throw new Error('Not found')  // No type information
throw new Error('Invalid')    // No context
```

### 2. Preserve Error Chains

Use the `cause` option to preserve error chains:

```typescript
try {
  await externalService.call()
} catch (error) {
  throw new NetworkError('External service failed', undefined, { cause: error })
}
```

### 3. Include Actionable Details

Provide details that help resolve the issue:

```typescript
throw new ValidationError(
  'Email format is invalid',
  {
    field: 'email',
    constraint: 'must be a valid email address',
    value: email,  // Be careful with sensitive data
    suggestion: 'Try format: user@domain.com'
  }
)
```

### 4. Handle All Error Paths

Use type guards for exhaustive error handling:

```typescript
try {
  await operation()
} catch (error) {
  if (isNotFoundError(error)) {
    return notFoundResponse()
  }
  if (isValidationError(error)) {
    return validationResponse(error.details)
  }
  if (isAuthenticationError(error)) {
    return unauthorizedResponse()
  }
  if (isRetryableError(error)) {
    return retryLaterResponse()
  }
  // Unknown error - log and return generic
  logger.error('Unexpected error', error)
  return internalErrorResponse()
}
```

### 5. Circuit Breaker for External Services

Use circuit breakers for external service calls:

```typescript
import { CircuitOpenError } from '@dotdo/rpc'

const circuit = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000
})

async function callExternalService() {
  if (circuit.isOpen()) {
    throw CircuitOpenError.withMetrics(circuit.getMetrics())
  }

  try {
    const result = await externalService.call()
    circuit.recordSuccess()
    return result
  } catch (error) {
    circuit.recordFailure()
    throw error
  }
}
```

## Related Documentation

- [RPC Errors](/rpc/errors/base.ts) - Error class implementations
- [Fire-and-Forget Errors](/do/fire-and-forget-errors.ts) - Async error tracking
- [Observability Logger](/observability/logger.ts) - Structured logging
- [Digital Objects Errors](/primitives/packages/digital-objects/src/errors.ts) - Domain errors
