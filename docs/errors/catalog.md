---
title: Error Catalog
description: Complete reference of error codes and resolution steps
---

# Error Catalog

This document provides a comprehensive reference of all error codes in the dotdo runtime, their meanings, common causes, and resolution steps.

## RPC Errors

Remote Procedure Call errors occur when communicating between Durable Objects or external services.

| Code | Message | Cause | Resolution |
|------|---------|-------|------------|
| `RPC_ERROR` | General RPC failure | Unspecified RPC communication failure | Check network connectivity and target availability |
| `VALIDATION_ERROR` | Invalid arguments | Method called with invalid or missing parameters | Verify all required parameters are provided with correct types |
| `METHOD_NOT_FOUND` | Method not found | Attempting to call a non-existent method on the target | Check method name spelling and ensure method exists on target interface |
| `TIMEOUT` | Request timeout | RPC call exceeded the configured timeout (default: 30s) | Increase timeout or optimize the target method's execution time |
| `UNAUTHORIZED` | Unauthorized access | Missing or invalid authentication token | Provide valid Bearer token in Authorization header |
| `REVOKED` | Capability revoked | The capability token has been revoked | Request a new capability token |
| `EXPIRED` | Capability expired | The capability token has passed its expiration time | Request a new capability token |
| `VERSION_MISMATCH` | Protocol version mismatch | Client and server RPC protocol versions are incompatible | Update client or server to compatible versions |

### RPCError Class

```typescript
import { RPCError, RPCErrorCodes } from 'dotdo/rpc'

// Throwing an RPC error
throw new RPCError('Method validation failed', {
  code: 'VALIDATION_ERROR',
  method: 'createThing',
  target: 'https://customer.api.dotdo.dev'
})

// Catching and handling
try {
  await client.someMethod()
} catch (error) {
  if (error instanceof RPCError) {
    console.log(`RPC Error [${error.code}]: ${error.message}`)
    console.log(`Method: ${error.method}`)
    console.log(`Target: ${error.target}`)
  }
}
```

## MCP (Model Context Protocol) Errors

Errors related to the MCP server and tool execution.

| Code | Message | Cause | Resolution |
|------|---------|-------|------------|
| `UNAUTHORIZED` | Authentication required | Missing or invalid authentication for MCP request | Provide valid JWT token or session credentials |
| `FORBIDDEN` | Insufficient permissions | User lacks required permissions for the operation | Request appropriate permissions from administrator |
| `INVALID_REQUEST` | Invalid request format | Malformed MCP request structure | Verify request conforms to MCP protocol specification |
| `TOOL_NOT_FOUND` | Tool not found | Requested tool is not registered | Check tool name and ensure it's registered with the MCP server |
| `TOOL_EXECUTION_FAILED` | Tool execution failed | Tool threw an error during execution | Check tool logs and input parameters |
| `INTERNAL_ERROR` | Internal server error | Unhandled exception in MCP server | Check server logs for stack trace |

### McpErrorCode Enum

```typescript
import { McpErrorCode } from 'dotdo/mcp/types'

// Available error codes
McpErrorCode.Unauthorized       // 'UNAUTHORIZED'
McpErrorCode.Forbidden          // 'FORBIDDEN'
McpErrorCode.InvalidRequest     // 'INVALID_REQUEST'
McpErrorCode.ToolNotFound       // 'TOOL_NOT_FOUND'
McpErrorCode.ToolExecutionFailed // 'TOOL_EXECUTION_FAILED'
McpErrorCode.InternalError      // 'INTERNAL_ERROR'
```

## Authentication Errors

Errors related to authentication and authorization.

| Code | Message | Cause | Resolution |
|------|---------|-------|------------|
| `UNAUTHORIZED` | Authentication required | No valid authentication credentials provided | Include Bearer token in Authorization header |
| `INVALID_TOKEN` | Invalid or expired token | Token is malformed, expired, or has invalid signature | Request a new token from the authentication service |
| `FORBIDDEN` | Insufficient permissions | User authenticated but lacks required permissions | Request additional permissions or use different account |
| `DECODE_ERROR` | Token decode failed | JWT token cannot be decoded (malformed structure) | Ensure token is valid JWT format with proper encoding |
| `EMPTY_TOKEN` | Empty token provided | Authorization header present but token is empty | Provide non-empty token value |
| `MALFORMED_TOKEN` | Malformed token | Token structure is invalid | Ensure token has three dot-separated Base64 segments |

### HTTP Status Codes

| Status | Name | Description |
|--------|------|-------------|
| 400 | Bad Request | Invalid request parameters or body |
| 401 | Unauthorized | Authentication required or invalid credentials |
| 403 | Forbidden | Authenticated but insufficient permissions |
| 404 | Not Found | Requested resource does not exist |
| 426 | Upgrade Required | WebSocket upgrade required for this endpoint |
| 500 | Internal Server Error | Unhandled server error |

## Storage Errors

Errors related to Durable Object storage operations.

| Error | Message | Cause | Resolution |
|-------|---------|-------|------------|
| `Thing not found` | Thing not found: {id} | Requested Thing ID does not exist in storage | Verify the ID exists before accessing, or handle the error gracefully |
| `Type mismatch` | Type mismatch: expected {type}, got {actual} | Thing exists but has different $type than expected | Verify $type before operations or use type-agnostic methods |
| `Invalid time format` | Invalid time format: {time} | Time string doesn't match expected format | Use valid formats: "9am", "5:30pm", "noon", "midnight" |
| `Transaction failed` | Transaction operation error | One or more transaction operations failed | Check individual operation results for specific errors |

### Thing Store Operations

```typescript
// Safe pattern for handling "not found"
const thing = await $.things.get(id)
if (!thing) {
  // Handle missing thing
  return null
}

// Or use try/catch
try {
  const thing = await $.things.getOrThrow(id)
} catch (error) {
  if (error.message.includes('Thing not found')) {
    // Handle missing thing
  }
}
```

## Workflow Errors

Errors related to the WorkflowContext ($) and event handling.

| Error | Message | Cause | Resolution |
|-------|---------|-------|------------|
| `Invalid time format` | Invalid time format: {time} | Schedule time string is invalid | Use formats: "9am", "5pm", "9:30am", "noon", "midnight" |
| `Circuit is open` | Circuit is open | Circuit breaker has tripped due to failures | Wait for circuit to recover or check downstream service |
| `Cascade queue is full` | Cascade queue is full | Too many cascade operations queued | Wait for queue to drain or increase queue size |
| `Timeout` | Timeout | Operation exceeded configured timeout | Increase timeout or optimize operation |
| `RPC Timeout` | RPC Timeout | Cross-DO RPC call exceeded timeout | Increase RPC timeout or optimize target method |
| `Method not found` | Method {method} not found on {noun} | RPC method doesn't exist on target DO | Verify method name and target DO interface |
| `No stubResolver` | No stubResolver configured for {prop}({id}) | Attempting cross-DO call without resolver | Configure stubResolver in WorkflowContext options |

### CascadeError Class

```typescript
import { CascadeError } from 'dotdo/workflow'

// CascadeError includes errors from each tier
try {
  await $.cascade(event)
} catch (error) {
  if (error instanceof CascadeError) {
    console.log('Tier errors:', error.tierErrors)
    // { code: Error, generative: Error, agentic: Error, human: Error }
  }
}
```

## AI Errors

Errors related to AI/LLM operations.

| Error | Message | Cause | Resolution |
|-------|---------|-------|------------|
| `AIBudgetExceededError` | Budget exceeded | AI operation would exceed configured budget | Increase budget limit or use lower-cost model |
| `Unknown provider` | Unknown provider: {name} | AI provider not registered | Register provider or use supported provider name |
| `List extraction failed` | List extraction failed: {message} | Failed to parse AI response as list | Check prompt and response format |
| `Code generation failed` | Code generation failed: {message} | AI code generation encountered error | Verify prompt and check AI service availability |
| `Batch failed` | Batch {id} failed: {message} | Batch AI operation failed | Check individual batch items for errors |

### AIBudgetExceededError Class

```typescript
import { AIBudgetExceededError } from 'dotdo/ai'

try {
  await ai.generate({ prompt, budget: 100 })
} catch (error) {
  if (error instanceof AIBudgetExceededError) {
    console.log(`Spent: ${error.spent}`)
    console.log(`Limit: ${error.limit}`)
    console.log(`Requested: ${error.requested}`)
  }
}
```

## Reliability Pattern Errors

Errors from reliability patterns like circuit breakers and retries.

| Pattern | Error | Cause | Resolution |
|---------|-------|-------|------------|
| Circuit Breaker | Circuit is open | Failure threshold exceeded | Wait for half-open state or fix underlying issue |
| Retry | Max retries exceeded | All retry attempts failed | Check underlying service or increase retry limit |
| Timeout | Operation timed out | Operation exceeded timeout | Increase timeout or optimize operation |

### Circuit Breaker States

```
CLOSED → OPEN → HALF_OPEN → CLOSED
          ↑                   ↓
          └───────────────────┘ (on failure in HALF_OPEN)
```

- **CLOSED**: Normal operation, failures are counted
- **OPEN**: Failures exceeded threshold, requests immediately fail
- **HALF_OPEN**: Testing if service recovered, single request allowed

## Error Handling Best Practices

### 1. Use Specific Error Types

```typescript
import { RPCError } from 'dotdo/rpc'
import { AIBudgetExceededError } from 'dotdo/ai'

try {
  await operation()
} catch (error) {
  if (error instanceof RPCError) {
    // Handle RPC-specific error
  } else if (error instanceof AIBudgetExceededError) {
    // Handle budget error
  } else {
    // Handle generic error
  }
}
```

### 2. Check Error Codes

```typescript
try {
  await rpcClient.method()
} catch (error) {
  if (error instanceof RPCError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        // Fix input parameters
        break
      case 'TIMEOUT':
        // Retry with longer timeout
        break
      case 'UNAUTHORIZED':
        // Refresh auth token
        break
    }
  }
}
```

### 3. Log Errors with Context

```typescript
try {
  await operation()
} catch (error) {
  console.error('Operation failed', {
    error: error.message,
    code: error instanceof RPCError ? error.code : undefined,
    method: error instanceof RPCError ? error.method : undefined,
    timestamp: new Date().toISOString(),
  })
}
```

### 4. Use Graceful Degradation

```typescript
// Use cascade tiers for graceful fallback
const result = await $.cascade({
  code: async () => db.query(sql),      // Try database first
  generative: async () => ai.generate(),  // Fall back to AI
  human: async () => notifyOperator(),   // Escalate to human
})
```

## See Also

- [RPC Protocol Reference](/docs/api/rpc)
- [Workflow Context API](/docs/api/workflow-context)
- [Authentication Guide](/docs/security/authentication)
- [Reliability Patterns](/docs/patterns/reliability)
