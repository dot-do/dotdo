# `as unknown as` Pattern Audit

**Generated**: 2026-01-13
**Issue**: dotdo-l61ui
**Current Count**: 3,278 occurrences across 431 files

## Executive Summary

The codebase contains 3,278 uses of `as unknown as` double assertion across 431 files. This pattern bypasses TypeScript's type checker entirely, hiding potential bugs until runtime. However, the distribution reveals that most usage is concentrated in test files (primarily mocking) and follows a small number of repeated patterns that can be systematically addressed.

### Distribution Breakdown

| Category | Files | Occurrences | Priority |
|----------|-------|-------------|----------|
| Test files (mocking Cloudflare primitives) | ~242 | ~1,800 | Medium |
| Test files (accessing internal methods) | ~100 | ~600 | Low |
| Compat layer (store deletion pattern) | ~40 | ~300 | High |
| Proxy type coercion | ~15 | ~50 | Medium |
| Core framework (DOBase, transport) | ~12 | ~30 | Critical |
| External data parsing | ~20 | ~100 | High |

---

## Pattern Categories

### Category 1: Test Mocking (Cloudflare Primitives) - 1,800+ occurrences

**Examples**:
```typescript
// DurableObjectState mocking
const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

// KVNamespace mocking
const cache = new KVSessionCache(mockKV as unknown as KVNamespace)

// R2Bucket mocking
const client = new AuthorizedR2Client(mockClaims, mockR2 as unknown as R2Bucket)

// DurableObjectNamespace mocking
BROWSER_DO: createMockNamespace(stubOverrides) as unknown as DurableObjectNamespace
```

**Why it happens**: Cloudflare Workers runtime types are complex interfaces that are difficult to fully mock. Tests create partial implementations that satisfy the methods being tested.

**Risk level**: Low - Tests fail loudly if mocks are wrong.

**Fix strategy**:
1. Create comprehensive mock factories in `testing/mocks/` that return properly typed objects
2. Use `Partial<T> & Required<Pick<T, K>>` patterns for partial mocks
3. Consider using `@cloudflare/vitest-pool-workers` for integration tests

---

### Category 2: Compat Layer Store Deletion (`null as unknown as T`) - 300+ occurrences

**Examples**:
```typescript
// compat/auth/clerk/organizations.ts
await slugToOrgStore.put(`slug:${oldSlug}`, null as unknown as string, now)
await membershipStore.put(`membership:${membershipId}`, null as unknown as StoredMembership, now)
await organizationStore.put(`org:${organizationId}`, null as unknown as StoredOrganization, now)
```

**Why it happens**: Store interfaces use generic `put(key, value, ttl)` signatures where `null` signals deletion but TypeScript expects the value type.

**Risk level**: High - Silently storing `null` instead of deleting could cause data corruption.

**Fix strategy**:
1. Add explicit `delete(key)` method to store interfaces
2. Or use union type: `put<T>(key: string, value: T | null, ttl?: number)`
3. Create type guard: `function isStoreDeletion<T>(v: T | null): v is null`

**Recommended approach**:
```typescript
// Before
await store.put(`key:${id}`, null as unknown as T, now)

// After - Option A: Explicit delete
await store.delete(`key:${id}`)

// After - Option B: Union type in interface
interface Store<T> {
  put(key: string, value: T | null, ttl?: number): Promise<void>
}
```

---

### Category 3: Proxy Type Coercion - 50+ occurrences

**Examples**:
```typescript
// workflows/on.ts
return new Proxy((() => {}) as unknown as EveryTimeProxy, { ... })
export const every: EveryFunction = new Proxy((() => {}) as unknown as EveryFunction, everyHandler)

// workflows/proxy.ts
const fn = function () {} as unknown as PipelineProxy

// objects/DOBase.ts
return createScheduleBuilderProxy(config) as unknown as ScheduleBuilder
```

**Why it happens**: JavaScript Proxies are used to create fluent APIs (e.g., `$.every.Monday.at9am()`). The proxy target doesn't match the public interface.

**Risk level**: Medium - Type safety is lost for proxy consumers.

**Fix strategy**:
1. Use proper generic proxy factory with return type inference
2. Define branded types that carry the proxy semantics

**Recommended approach**:
```typescript
// Type-safe proxy factory
function createTypedProxy<TTarget extends object, TInterface>(
  target: TTarget,
  handler: ProxyHandler<TTarget>
): TInterface {
  return new Proxy(target, handler) as unknown as TInterface
}

// Alternatively, use declaration merging
declare function createProxy(): EveryFunction
```

---

### Category 4: Test Access to Internal Methods - 600+ occurrences

**Examples**:
```typescript
// Accessing emitEvent method
const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (...) => { ... }

// Accessing internal handlers
const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]

// Accessing internal properties
const dlq = (doInstance as unknown as { dlq: unknown }).dlq
```

**Why it happens**: Tests need to spy on or invoke internal methods not exposed in public types.

**Risk level**: Low - Tests document implicit contracts.

**Fix strategy**:
1. Export test-specific interfaces with internal methods
2. Use `@internal` JSDoc + separate `.internal.d.ts` declarations
3. Create test utilities that encapsulate internal access

**Recommended approach**:
```typescript
// testing/types.d.ts
export interface DOTestHelpers {
  emitEvent(verb: string, data: unknown): Promise<void>
  dlq: DLQStore
  // ... other internal methods
}

// Usage in tests
import type { DOTestHelpers } from '@/testing/types'
const instance = result.instance as unknown as DOTestHelpers
```

---

### Category 5: External Data Parsing - 100+ occurrences

**Examples**:
```typescript
// objects/transport/auth-layer.ts
claims: payload as unknown as Record<string, unknown>

// api/tests/middleware/auth-api-keys.test.ts
const apiKeys = loadApiKeysFromEnv(env as unknown as Record<string, unknown>)
```

**Why it happens**: JWT payloads, API responses, and environment variables are `unknown` at runtime but need to be used as structured data.

**Risk level**: High - Runtime type mismatches cause crashes.

**Fix strategy**:
1. Use Zod schemas for validation
2. Create type guards for each expected shape
3. Validate at system boundaries

**Recommended approach**:
```typescript
// lib/validation/jwt.ts
import { z } from 'zod'

const JWTClaimsSchema = z.object({
  sub: z.string(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  roles: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  org: z.string().optional(),
}).passthrough()

export type JWTClaims = z.infer<typeof JWTClaimsSchema>

export function parseJWTClaims(payload: unknown): JWTClaims {
  return JWTClaimsSchema.parse(payload)
}
```

---

### Category 6: Static Property Access on Classes - 30+ occurrences

**Examples**:
```typescript
// objects/transport/rest-autowire.ts
const staticRest = (DOClass as unknown as { $rest?: Record<string, RestMethodConfig> }).$rest

// objects/DOBase.ts
DOClass as unknown as { $rest?: ... }
```

**Why it happens**: TypeScript constructors don't carry static property types in `new (...args) => T` signatures.

**Risk level**: Medium - Wrong static access fails at runtime.

**Fix strategy**:
1. Define explicit static interfaces
2. Use `typeof DOClass & { $rest?: ... }` intersection

**Recommended approach**:
```typescript
// types/DOStatic.ts
export interface DOClassWithRest<T = unknown> {
  new (...args: unknown[]): T
  $rest?: Record<string, RestMethodConfig>
}

// Usage
export function getRestRoutes(DOClass: DOClassWithRest): RestRouteConfig[] {
  const staticRest = DOClass.$rest // No cast needed!
}
```

---

## Priority Files for Remediation

### Critical Priority (Core Framework)

| File | Count | Pattern |
|------|-------|---------|
| `objects/DOBase.ts` | 4 | Proxy coercion, dynamic method access |
| `objects/transport/auth-layer.ts` | 2 | JWT claims parsing |
| `objects/transport/rest-autowire.ts` | 2 | Static property access |
| `objects/transport/mcp-server.ts` | 1 | Handler attachment |
| `workflows/on.ts` | 2 | Proxy coercion |
| `workflows/domain.ts` | 1 | Registry widening |

**Total critical files**: 6 files, ~12 occurrences

### High Priority (Compat Layers)

| Directory | Files | Pattern |
|-----------|-------|---------|
| `compat/auth/clerk/` | 4 | Store deletion pattern |
| `compat/auth/shared/` | 4 | Store deletion pattern |
| `compat/auth/auth0/` | 2 | API response handling |

**Total high-priority files**: ~10 files, ~100+ occurrences

### Medium Priority (Production Code)

| Directory | Files | Pattern |
|-----------|-------|---------|
| `lib/` | 5 | Various (executors, mixins) |
| `workflows/` | 4 | Proxy coercion |
| `examples/` | ~20 | Clerk compat usage |

---

## Recommended Implementation Plan

### Phase 1: Critical Framework (Week 1)
1. Create `types/DOStatic.ts` with static interfaces
2. Add Zod validation for JWT claims in auth-layer.ts
3. Create typed proxy factory for workflows

### Phase 2: Store Interface Fix (Week 2)
1. Add `delete()` method to store interfaces
2. Update compat/auth/* to use new interface
3. Run full test suite

### Phase 3: Test Infrastructure (Week 3-4)
1. Create comprehensive mock factories in `testing/mocks/cloudflare/`
2. Export `DOTestHelpers` interface
3. Update top 20 test files with most occurrences

### Phase 4: Remaining Cleanup (Ongoing)
1. Add ESLint rule to flag new `as unknown as` usage
2. Document acceptable patterns in CONTRIBUTING.md
3. Address remaining files opportunistically

---

## ESLint Rule Recommendation

Add to `.eslintrc`:

```json
{
  "rules": {
    "@typescript-eslint/no-unsafe-type-assertion": "warn",
    "no-restricted-syntax": [
      "error",
      {
        "selector": "TSAsExpression[typeAnnotation.typeName.name='unknown'] > TSAsExpression",
        "message": "Avoid 'as unknown as' double assertion. Use type guards or proper generic constraints instead."
      }
    ]
  }
}
```

---

## Metrics for Success

| Metric | Current | Target (3 months) | Target (6 months) |
|--------|---------|-------------------|-------------------|
| Total occurrences | 3,278 | 2,000 | 500 |
| Production code | 189 | 50 | 10 |
| Core framework | 12 | 0 | 0 |
| Compat layers | ~100 | 20 | 0 |

---

## Appendix: Common Safe Patterns

### Acceptable Uses

1. **Test mocking with comprehensive mock factories** - When the mock is validated
2. **Generic constraint bypass for internal code** - When immediately validated
3. **Proxy return types** - When the proxy handler is thoroughly tested

### Never Acceptable

1. **External data without validation** - Always use Zod or type guards
2. **Store operations with null** - Use explicit delete methods
3. **Class static access** - Define proper static interfaces

---

## See Also

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - Module interfaces addressing type safety

### Related Code

- `objects/DOBase.ts` - Core framework type patterns
- `objects/transport/` - Transport layer type handling
- `workflows/` - Proxy type coercion patterns
- `compat/` - Compat layer store patterns

### Spikes Index

- [All Spikes](../spikes/README.md) - Complete index of research spikes
