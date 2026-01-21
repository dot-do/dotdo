# Deprecated API Migration Guide

This document lists all deprecated APIs in dotdo and provides migration paths to their recommended replacements. All deprecated APIs will be removed in v4.0.0.

## Table of Contents

1. [Storage APIs (@dotdo/db)](#storage-apis-dotdodb)
2. [Circuit Breaker APIs (@dotdo/do)](#circuit-breaker-apis-dotdodo)
3. [WebSocket APIs (@dotdo/do)](#websocket-apis-dotdodo)
4. [Authentication APIs (@dotdo/do)](#authentication-apis-dotdodo)
5. [Validation APIs (@dotdo/db)](#validation-apis-dotdodb)
6. [SQLite APIs (@dotdo/db)](#sqlite-apis-dotdodb)

---

## Storage APIs (@dotdo/db)

### `createThingsStore()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Creates a store with implicit in-memory storage, making it unclear where data is stored and preventing proper adapter injection for testing and production use.

**Before (deprecated)**:
```typescript
import { createThingsStore } from '@dotdo/db'

const store = createThingsStore()
```

**After (recommended)**:
```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

const adapter = new MemoryStorageAdapter()
const store = createThingsStoreWithAdapter(adapter)
```

**For Durable Objects with SQLite**:
```typescript
import { createThingsStoreWithAdapter, createSQLiteStorageAdapter } from '@dotdo/db'

// Inside Durable Object constructor
const adapter = createSQLiteStorageAdapter(ctx.storage.sql)
const store = createThingsStoreWithAdapter(adapter)
```

**For shared storage across stores**:
```typescript
import {
  createThingsStoreWithAdapter,
  createEventsStoreWithAdapter,
  createRelationshipsStoreWithAdapter,
  MemoryStorageAdapter
} from '@dotdo/db'

const adapter = new MemoryStorageAdapter()
const things = createThingsStoreWithAdapter(adapter)
const events = createEventsStoreWithAdapter(adapter)
const relationships = createRelationshipsStoreWithAdapter(adapter)
```

**API Compatibility**: The store API is identical - only initialization changes. All `store.create()`, `store.get()`, `store.update()`, `store.delete()`, and `store.list()` calls work the same way.

---

## Circuit Breaker APIs (@dotdo/do)

### `getGlobalCircuitBreakerRegistry()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Global registry causes tenant state leakage in multi-tenant environments. Circuit breaker state is shared across all requests and tenants, leading to:
- Tenant A's failures affecting Tenant B's circuit state
- Memory leaks from accumulated circuit breakers
- Unpredictable behavior in high-concurrency scenarios

**Before (deprecated)**:
```typescript
import { getGlobalCircuitBreakerRegistry } from '@dotdo/do'

const registry = getGlobalCircuitBreakerRegistry()
const circuit = registry.get('my-service')
await circuit.execute(() => fetchData())
```

**After (recommended)**:
```typescript
import { runWithCircuitBreakerRegistry, getCircuitBreaker } from '@dotdo/do'

// In middleware - wrap request handling
await runWithCircuitBreakerRegistry(async () => {
  // All circuit breaker usage is isolated to this request
  const circuit = getCircuitBreaker('my-service')
  await circuit.execute(() => fetchData())
})
```

Or use `getCurrentCircuitBreakerRegistry()` within a scoped context:
```typescript
import { runWithCircuitBreakerRegistry, getCurrentCircuitBreakerRegistry } from '@dotdo/do'

await runWithCircuitBreakerRegistry(async () => {
  const registry = getCurrentCircuitBreakerRegistry()
  const circuit = registry.get('my-service')
  await circuit.execute(() => fetchData())
})
```

### `resetGlobalCircuitBreakerRegistry()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: With request-scoped registries, cleanup happens automatically when the request context ends.

**Before (deprecated)**:
```typescript
import { resetGlobalCircuitBreakerRegistry } from '@dotdo/do'

// Manual cleanup
resetGlobalCircuitBreakerRegistry()
```

**After (recommended)**:
```typescript
// No cleanup needed - registries are automatically scoped to requests
await runWithCircuitBreakerRegistry(async () => {
  // Circuit breakers are automatically cleaned up when this context ends
})
```

---

## WebSocket APIs (@dotdo/do)

### `getWebSocketTags(ws?)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Without a WebSocket argument, relies on `lastConnectionId` which breaks isolation in concurrent scenarios.

**Before (deprecated)**:
```typescript
// Without ws argument - unreliable
const tags = this.wsModule.getWebSocketTags()
```

**After (recommended)**:
```typescript
// Always pass the WebSocket instance
const metadata = this.wsModule.getConnectionMetadata(ws)
const tags = metadata?.tags ?? []
```

### `isWebSocketHibernatable(ws?)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Same isolation issue as `getWebSocketTags()`.

**Before (deprecated)**:
```typescript
const isHibernatable = this.wsModule.isWebSocketHibernatable()
```

**After (recommended)**:
```typescript
const metadata = this.wsModule.getConnectionMetadata(ws)
const isHibernatable = metadata?.hibernatable ?? false
```

---

## Authentication APIs (@dotdo/do)

### `detectCallerType(request)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Does NOT verify DO-to-DO signatures. Should only be used for non-security-critical logging/tracing.

**Before (deprecated)**:
```typescript
import { detectCallerType } from '@dotdo/do'

const callerType = detectCallerType(request)
if (callerType === 'do') {
  // INSECURE: Trusts unverified header
}
```

**After (recommended)**:
```typescript
import { extractCallerInfoWithVerification } from '@dotdo/do'

const callerInfo = await extractCallerInfoWithVerification(request)
if (callerInfo.type === 'do' && callerInfo.trusted) {
  // SECURE: HMAC signature verified
}
```

### `extractCallerInfo(request)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: The `trusted` field for DO callers is NOT verified. For security-critical decisions, use the async version with verification.

**Before (deprecated)**:
```typescript
import { extractCallerInfo } from '@dotdo/do'

const info = extractCallerInfo(request)
if (info.trusted) {
  // INSECURE: trusted=true is NOT verified for DO callers
}
```

**After (recommended)**:
```typescript
import { extractCallerInfoWithVerification } from '@dotdo/do'

const info = await extractCallerInfoWithVerification(request)
if (info.trusted) {
  // SECURE: For DO callers, HMAC signature is verified
  // For Worker callers, cf-worker header is checked
}
```

### `addDOSourceHeaders(request, doId)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Naming confusion - this function is now async and should be called as such.

**Before (deprecated)**:
```typescript
import { addDOSourceHeaders } from '@dotdo/do'

addDOSourceHeaders(request, doId)
```

**After (recommended)**:
```typescript
import { addDOSourceHeadersAsync } from '@dotdo/do'

await addDOSourceHeadersAsync(request, doId)
```

---

## Validation APIs (@dotdo/db)

### `configureValidation(options)`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Global configuration causes issues in multi-tenant environments.

**Before (deprecated)**:
```typescript
import { configureValidation } from '@dotdo/db'

configureValidation({
  onDeprecation: 'error',
  strictMode: true
})
```

**After (recommended)**:
```typescript
import { createValidationContext } from '@dotdo/db'

const ctx = createValidationContext({
  onDeprecation: 'error',
  strictMode: true
})

// Use context-based store
const store = createThingsStoreWithContext(adapter, ctx)
```

### `getValidationConfig()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Before (deprecated)**:
```typescript
import { getValidationConfig } from '@dotdo/db'

const config = getValidationConfig()
```

**After (recommended)**:
```typescript
import { createValidationContext } from '@dotdo/db'

const ctx = createValidationContext({ /* options */ })
const config = ctx.config
```

### `resetValidationConfig()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Context-based validation does not require reset.

**Before (deprecated)**:
```typescript
import { resetValidationConfig } from '@dotdo/db'

resetValidationConfig()
```

**After (recommended)**:
```typescript
// No reset needed - each context is independent
const ctx1 = createValidationContext({ strictMode: true })
const ctx2 = createValidationContext({ strictMode: false })
// Contexts are isolated, no global state to reset
```

---

## SQLite APIs (@dotdo/db)

### `SQLiteStorage.createTables()`

**Status**: Deprecated in v3.0.0, removal in v4.0.0

**Problem**: Direct table creation bypasses the migration system.

**Before (deprecated)**:
```typescript
const storage = new SQLiteStorage(sql)
storage.createTables()
```

**After (recommended)**:
```typescript
const storage = new SQLiteStorage(sql)
await storage.migrate()  // Uses migration system
```

---

## Migration Timeline

| Version | Status |
|---------|--------|
| v3.0.0 | Deprecated APIs emit console warnings |
| v3.5.0 | Deprecated APIs throw in strict mode |
| v4.0.0 | Deprecated APIs removed |

## Detecting Deprecated API Usage

Run with `NODE_ENV=development` to see deprecation warnings in the console:

```
[DEPRECATION] createThingsStore() is deprecated and will be removed in v4.0.0.
Use createThingsStoreWithAdapter() with MemoryStorageAdapter instead.
```

To find deprecated API usage in your codebase:

```bash
# Search for deprecated function names
grep -r "createThingsStore\|getGlobalCircuitBreakerRegistry\|detectCallerType" src/
```

## Need Help?

If you encounter issues migrating from deprecated APIs:

1. Check the [Troubleshooting Guide](/docs/TROUBLESHOOTING.md)
2. Open an issue with the `migration` label
3. Join the Discord community for real-time help
