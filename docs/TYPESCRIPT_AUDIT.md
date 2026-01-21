# TypeScript Non-Null Assertion Audit

## Summary

This document audits the use of non-null assertions (`!.` operator) across the dotdo codebase. Non-null assertions tell TypeScript to trust that a value is not `null` or `undefined`, bypassing type checking. While sometimes necessary, overuse can lead to runtime crashes.

**Audit Date:** 2026-01-21
**Issue:** do-fba4

## Statistics

### Overall Count

| Category | Count | Percentage |
|----------|-------|------------|
| **Total Non-Null Assertions** | 2,491 | 100% |
| Test Files (.test.ts/.spec.ts) | 2,177 | 87.4% |
| Production Code | 314 | 12.6% |

### By Package (Production Code Only)

Excluding the `primitives/` submodule:

| Package | Count | Priority |
|---------|-------|----------|
| fsx | 53 | P1 - High |
| bashx | 76 | P1 - High |
| gitx | 35 | P2 - Medium |
| npmx | 9 | P3 - Low |
| do | 5 | P3 - Low |
| tests | 3 | P4 - Ignore |
| db | 2 | P4 - Ignore |
| mcp | 1 | P4 - Ignore |
| app | 1 | P4 - Ignore |

### By Package (Test Code)

Test assertions are generally acceptable since test environments are controlled:

| Package | Count |
|---------|-------|
| gitx | 640 |
| fsx | 544 |
| primitives | 506 |
| bashx | 182 |
| do | 94 |
| observability | 61 |
| db | 29 |
| integrations | 21 |
| api | 21 |
| rpc.do | 19 |
| rpc | 17 |
| ai | 15 |
| app | 13 |
| auth | 7 |
| e2e | 5 |
| npmx | 3 |

## Categories of Usage

### Category 1: Array Index Access After Length Check (SAFE)

```typescript
// Pattern: blob[0]! after checking blob.length > 0
if (blob.length > 0) {
  const item = blob[0]!  // Safe - we know array has elements
}
```

**Files with this pattern:**
- `fsx/do/module.ts` (22 instances) - SQLite query results after existence checks
- `fsx/storage/extent-storage.ts` (8 instances)
- `fsx/vfs/branch-manager.ts` (6 instances)
- `do/shard.ts` (2 instances)

**Assessment:** These are generally safe when a length/existence check precedes the access. However, they could be improved with pattern matching or type narrowing.

### Category 2: Map.get() After Has Check (SAFE)

```typescript
// Pattern: map.get(key)! after map.has(key)
if (map.has(key)) {
  const value = map.get(key)!  // Safe - we know key exists
}
```

**Files with this pattern:**
- `gitx/src/pack/full-generation.ts` (9 instances)
- `gitx/src/cli/fs-adapter.ts` (1 instance)
- `primitives/.../topological-sort.ts` (6 instances)

**Assessment:** Safe but could use early return patterns or non-null assertion functions.

### Category 3: Argument Parsing (NEEDS REVIEW)

```typescript
// Pattern: args[i]! in loops
for (let i = 0; i < args.length; i++) {
  if (args[i]!.startsWith('-F')) {
    // ...
  }
}
```

**Files with this pattern:**
- `bashx/src/do/commands/text-processing.ts` (7 instances)
- `bashx/src/do/commands/data-processing.ts` (5 instances)
- `bashx/core/safety/analyze.ts` (4 instances)

**Assessment:** These could fail if array is modified during iteration. Should use `for...of` loops instead.

### Category 4: Iterator .next().value (NEEDS REVIEW)

```typescript
// Pattern: iterator.next().value! without done check
const firstKey = this.cache.keys().next().value!
```

**Files with this pattern:**
- `npmx/core/resolver/tree.ts` (1 instance)
- `bashx/src/do/commands/text-processing.ts` (1 instance)

**Assessment:** Dangerous - should check `.done` before accessing `.value`.

### Category 5: Regex Match Groups (NEEDS REVIEW)

```typescript
// Pattern: match[1]! after .match() returns non-null
const match = text.match(/pattern/)
if (match) {
  const group = match[1]!  // May fail if no capture group
}
```

**Assessment:** Capture groups may not exist even when match succeeds. Should use optional chaining.

### Category 6: Options/Flags Access (SAFE with guards)

```typescript
// Pattern: options.expressions! after initialization
options.expressions = options.expressions || []
// later...
options.expressions!.push(item)
```

**Files with this pattern:**
- `bashx/src/do/commands/text-processing.ts` (multiple)

**Assessment:** Safe when initialization is guaranteed, but refactoring to avoid optional properties would be cleaner.

## Priority Files for Cleanup

### P0 - Critical (Production, High Usage)

1. **`/Users/nathanclevenger/projects/dotdo/fsx/do/module.ts`** (21 assertions)
   - Core filesystem module
   - Pattern: SQLite query result access
   - Risk: Runtime crash on empty query results
   - Fix: Use array destructuring with defaults or early returns

2. **`/Users/nathanclevenger/projects/dotdo/bashx/src/do/commands/text-processing.ts`** (19 assertions)
   - sed/awk/diff implementation
   - Pattern: args array access, regex flags
   - Risk: Runtime crash on malformed input
   - Fix: Use for...of loops, optional chaining

3. **`/Users/nathanclevenger/projects/dotdo/bashx/src/do/commands/data-processing.ts`** (18 assertions)
   - Data processing commands
   - Pattern: args array access
   - Risk: Similar to text-processing
   - Fix: Same approach

### P1 - High (Production, Medium Usage)

4. **`/Users/nathanclevenger/projects/dotdo/fsx/vfs/branch-manager.ts`** (9 assertions)
5. **`/Users/nathanclevenger/projects/dotdo/gitx/src/pack/full-generation.ts`** (8 assertions)
6. **`/Users/nathanclevenger/projects/dotdo/gitx/src/cli/fs-adapter.ts`** (8 assertions)
7. **`/Users/nathanclevenger/projects/dotdo/bashx/src/do/commands/od-command.ts`** (8 assertions)
8. **`/Users/nathanclevenger/projects/dotdo/fsx/storage/extent-storage.ts`** (7 assertions)

### P2 - Medium (Production, Low Usage)

9. **`/Users/nathanclevenger/projects/dotdo/npmx/do/NpmDO.ts`** (6 assertions)
10. **`/Users/nathanclevenger/projects/dotdo/bashx/src/core/mock-backend.ts`** (6 assertions)
11. **`/Users/nathanclevenger/projects/dotdo/gitx/src/do/container-executor.ts`** (4 assertions)
12. **`/Users/nathanclevenger/projects/dotdo/fsx/core/glob/glob.ts`** (4 assertions)
13. **`/Users/nathanclevenger/projects/dotdo/fsx/core/find/find.ts`** (4 assertions)

### P3 - Low (Test Files)

Test files use assertions in controlled environments where test data is predictable. These are acceptable and do not require immediate attention.

## Recommended Fixes

### 1. Array Access After Length Check

**Before:**
```typescript
const result = query.exec()
if (result.length > 0) {
  return result[0]!.value
}
```

**After:**
```typescript
const result = query.exec()
const [first] = result
if (first) {
  return first.value
}
```

### 2. Map.get() After Has Check

**Before:**
```typescript
if (map.has(key)) {
  process(map.get(key)!)
}
```

**After:**
```typescript
const value = map.get(key)
if (value !== undefined) {
  process(value)
}
```

### 3. Args Array Loop

**Before:**
```typescript
for (let i = 0; i < args.length; i++) {
  if (args[i]!.startsWith('-')) {
    // ...
  }
}
```

**After:**
```typescript
for (const arg of args) {
  if (arg.startsWith('-')) {
    // ...
  }
}
```

### 4. Iterator Access

**Before:**
```typescript
const firstKey = map.keys().next().value!
```

**After:**
```typescript
const iter = map.keys().next()
const firstKey = iter.done ? undefined : iter.value
```

### 5. Optional Property After Assignment

**Before:**
```typescript
interface Options {
  items?: string[]
}
options.items = options.items || []
// later...
options.items!.push(item)
```

**After:**
```typescript
interface Options {
  items: string[]  // Make required with default
}
const items = options.items ?? []
items.push(item)
```

## Tracking Progress

This audit establishes the baseline. Future cleanup should:

1. Start with P0 files (3 files, ~58 assertions)
2. Create separate issues for each priority level
3. Add runtime assertions or null checks
4. Update tests to verify edge cases
5. Re-run audit to measure progress

## Notes

- The `primitives/` directory is a git submodule with its own development lifecycle
- Primitives has 128 production and 506 test assertions
- Primitives cleanup should be coordinated with that repository
- Test file assertions (87% of total) are acceptable in controlled test environments

---

# 'any' Type Usage Audit

## Summary

This section audits the use of `any` type across the dotdo codebase. The `any` type bypasses TypeScript's type checking entirely, which can lead to runtime errors and makes code harder to maintain. This audit overlaps with and complements issue do-ogac.

**Audit Date:** 2026-01-21
**Related Issues:** do-om3u, do-ogac

## Statistics

### Overall Count

| Category | Count | Percentage |
|----------|-------|------------|
| **Total 'any' Usages** | 1,931 | 100% |
| Production Code | 833 | 43.1% |
| Test Files | 1,098 | 56.9% |

### By Package (Production Code Only)

Excluding test files, node_modules, and dist directories:

| Package | Count | Priority |
|---------|-------|----------|
| primitives | 629 | P3 - Submodule (separate lifecycle) |
| db | 27 | P1 - High (core storage layer) |
| gitx | 24 | P2 - Medium |
| api | 24 | P2 - Medium |
| do | 22 | P1 - High (core DO class) |
| bashx | 19 | P2 - Medium |
| ai | 12 | P2 - Medium |
| fsx | 9 | P3 - Low |
| app | 7 | P3 - Low |
| mcp | 2 | P4 - Ignore |
| npmx | 1 | P4 - Ignore |
| auth | 1 | P4 - Ignore |
| rpc | 0 | N/A |

## Categories of 'any' Usage

### Category 1: Mixin Constructor Patterns (NECESSARY)

```typescript
// Pattern: Mixin class constructors
export function withEntities<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args)
    }
  }
}
```

**Files with this pattern:**
- `do/entities.ts`
- `do/mixins/storage.ts`
- `do/mixins/rpc.ts`
- `do/mixins/auth.ts`
- `do/mixins/websocket.ts`

**Assessment:** These are largely unavoidable in TypeScript mixin patterns. The `any[]` for constructor args is a known limitation. Could potentially use `unknown[]` with careful typing, but benefit is minimal.

### Category 2: Dynamic Property Access (NEEDS REVIEW)

```typescript
// Pattern: Accessing unknown properties
const env = (this as any).env ?? (this as any)._env
let current: any = this
```

**Assessment:** These should be replaced with proper type assertions or interface definitions.

### Category 3: Callback/Filter Type Inference (NEEDS REVIEW)

```typescript
// Pattern: Array callback with untyped rows
rows.find((r: any) => r.type === typeValue)
rows.filter((r: any) => r.subject === subjectValue)
```

**Files with this pattern:**
- `db/tests/sqlite-test-utils.ts` (20+ instances)

**Assessment:** Should define proper row interfaces and use typed callbacks.

### Category 4: Generic Proxy/Builder Functions (COMPLEX)

```typescript
// Pattern: Dynamic proxy-based APIs
function createBuilder(state: BuilderState): any {
  const builder = function(arg?: any) {
    // ...
  }
  return new Proxy(builder, handler)
}
```

**Files with this pattern:**
- `do/workflow/schedule.ts`

**Assessment:** Complex to type due to dynamic nature. Consider branded types or more specific generics.

### Category 5: External API Integration (ACCEPTABLE)

```typescript
// Pattern: Third-party library types
export type AnyDurableObjectNamespace = DurableObjectNamespace<any>
```

**Assessment:** Often necessary when working with external APIs that have generic type parameters.

## Reduction Strategy

### Phase 1: Low-Hanging Fruit (Immediate)

1. **Add explicit interfaces for database rows**
   - Create `EventRow`, `ThingRow`, `RelationshipRow` interfaces
   - Replace `(r: any) =>` with typed callbacks

2. **Use `unknown` with type guards**
   ```typescript
   // Before
   function process(data: any) {
     return data.value
   }

   // After
   function process(data: unknown): string {
     if (typeof data === 'object' && data !== null && 'value' in data) {
       return String((data as { value: unknown }).value)
     }
     throw new Error('Invalid data')
   }
   ```

3. **Replace `as any` with specific type assertions**
   ```typescript
   // Before
   const env = (this as any).env

   // After
   const env = (this as { env?: Env }).env
   ```

### Phase 2: Structural Improvements (Short-term)

1. **Define proper generic constraints for mixins**
   ```typescript
   type AnyConstructor = new (...args: unknown[]) => object
   ```

2. **Create utility types for common patterns**
   ```typescript
   type RecordLike = Record<string, unknown>
   type AnyFunction = (...args: unknown[]) => unknown
   ```

3. **Use branded types for dynamic APIs**
   ```typescript
   type ScheduleBuilder = {
     readonly __brand: 'ScheduleBuilder'
   } & ((arg: string | Handler) => Schedule | ScheduleBuilder)
   ```

### Phase 3: Deep Refactoring (Long-term)

1. Refactor proxy-based APIs to use more explicit typing
2. Consider code generation for highly dynamic APIs
3. Add runtime validation at boundaries where types are `unknown`

## ESLint Configuration

Add these rules to enforce type safety:

```javascript
// eslint.config.js or .eslintrc
{
  rules: {
    // Error on explicit 'any' usage
    '@typescript-eslint/no-explicit-any': 'error',

    // Warn on implicit 'any' (requires tsconfig strict)
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',

    // Require explicit return types on exports
    '@typescript-eslint/explicit-module-boundary-types': 'warn'
  }
}
```

### Incremental Adoption

For existing codebases, use per-file overrides:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
// Legacy file - TODO: refactor to remove 'any' usage
```

Or configure as warnings during migration:

```javascript
{
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn' // Upgrade to 'error' after cleanup
  }
}
```

## Priority Files for Cleanup

### P0 - Critical (Core Infrastructure)

1. **`/Users/nathanclevenger/projects/dotdo/do/mixins/rpc.ts`**
   - Core RPC functionality
   - Pattern: Dynamic property access, env casting
   - Fix: Define proper interface for mixin state

2. **`/Users/nathanclevenger/projects/dotdo/do/workflow/schedule.ts`**
   - Scheduling DSL
   - Pattern: Proxy-based builder returns `any`
   - Fix: Use branded types or explicit union types

### P1 - High (Data Layer)

3. **`/Users/nathanclevenger/projects/dotdo/db/tests/sqlite-test-utils.ts`**
   - Test utilities with untyped row callbacks
   - Fix: Define row interfaces

4. **`/Users/nathanclevenger/projects/dotdo/api/src/routes/*.ts`**
   - API endpoints
   - Fix: Ensure all handlers have typed request/response

### P2 - Medium (Utility Packages)

5. **`/Users/nathanclevenger/projects/dotdo/gitx/src/do/*.ts`**
6. **`/Users/nathanclevenger/projects/dotdo/bashx/src/do/*.ts`**
7. **`/Users/nathanclevenger/projects/dotdo/ai/*.ts`**

## Tooling Recommendations

### 1. TypeScript Compiler Options

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### 2. IDE Integration

- Enable TypeScript strict mode in VS Code settings
- Install ESLint extension with TypeScript support
- Configure auto-fix on save for trivial `any` replacements

### 3. CI Integration

```yaml
# In CI pipeline
- name: Check for 'any' usage
  run: |
    count=$(grep -rE ': any\b|<any>|as any' --include='*.ts' src/ | wc -l)
    echo "Found $count 'any' usages"
    if [ $count -gt 100 ]; then
      echo "::warning::High 'any' usage detected"
    fi
```

### 4. Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.ts$')
if [ -n "$files" ]; then
  any_count=$(grep -E ': any\b|<any>|as any' $files | wc -l)
  if [ $any_count -gt 0 ]; then
    echo "Warning: $any_count 'any' usages in staged files"
    grep -n -E ': any\b|<any>|as any' $files
  fi
fi
```

## Tracking Progress

Track reduction over time:

```bash
# Run monthly
echo "$(date): $(grep -rE ': any\b|<any>|as any' --include='*.ts' src/ | grep -v node_modules | wc -l) any usages" >> docs/any-audit-history.txt
```

Target milestones:
- **Current:** 833 production, 1098 test
- **Phase 1 Complete:** <500 production
- **Phase 2 Complete:** <200 production
- **Phase 3 Complete:** <50 production (mostly mixin patterns)

## Notes

- The `primitives/` directory is a git submodule with 629 `any` usages
- Primitives cleanup should be coordinated with that repository
- Test file `any` usage is lower priority but should still be reduced
- Some mixin patterns may always require `any` - document these as exceptions

---

# Type Assertion Audit (`as any` / `as unknown`)

## Summary

This section audits the use of type assertions (`as any` and `as unknown`) across the dotdo codebase. Type assertions override TypeScript's type inference and can mask type errors, leading to runtime issues.

**Audit Date:** 2026-01-21
**Issue:** do-7wsc

## Statistics

### Overall Count

| Assertion Type | Total Instances | Files |
|----------------|-----------------|-------|
| `as any` | 1,167 | 220 |
| `as unknown` | 1,265 | 258 |
| **Combined Total** | 2,432 | ~350 unique |

### Test vs Production Code

| Category | Count | Percentage |
|----------|-------|------------|
| Test Files (.test.ts, .bench.ts) | 1,868 | 76.8% |
| Production Code | 562 | 23.1% |

### By Package (All Files)

| Package | Files with Assertions | Priority |
|---------|----------------------|----------|
| primitives | 163 | P3 - Submodule (separate lifecycle) |
| fsx | 54 | P1 - High (core filesystem) |
| do | 44 | P1 - High (core DO class) |
| bashx | 43 | P2 - Medium |
| gitx | 29 | P2 - Medium |
| db | 25 | P1 - High (core storage) |
| rpc | 18 | P2 - Medium |
| ai | 9 | P2 - Medium |
| tests | 8 | P3 - Benchmark code |
| npmx | 8 | P3 - Low |
| api | 8 | P2 - Medium |
| examples | 7 | P4 - Example code |
| mcp | 5 | P3 - Low |
| dotdo | 4 | P2 - CLI |
| app | 4 | P3 - Low |

## Top 10 Files Needing Attention

### Production Source Files (Non-Test)

| Rank | File | Count | Category |
|------|------|-------|----------|
| 1 | `/Users/nathanclevenger/projects/dotdo/examples/auth-patterns/AuthDO.ts` | 37 | Example code - Entity type casting |
| 2 | `/Users/nathanclevenger/projects/dotdo/examples/websocket-chat/ChatDO.ts` | 24 | Example code - Entity type casting |
| 3 | `/Users/nathanclevenger/projects/dotdo/examples/scheduled-jobs/SchedulerDO.ts` | 22 | Example code - Entity type casting |
| 4 | `/Users/nathanclevenger/projects/dotdo/examples/ecommerce/EcommerceDO.ts` | 21 | Example code - Entity type casting |
| 5 | `/Users/nathanclevenger/projects/dotdo/examples/ai-agent/AgentDO.ts` | 20 | Example code - Entity type casting |
| 6 | `/Users/nathanclevenger/projects/dotdo/dotdo/cli.ts` | 15 | CLI - Dynamic command handling |
| 7 | `/Users/nathanclevenger/projects/dotdo/primitives/packages/ai-core/src/ai-promise.ts` | 12 | AI Promise - Type widening |
| 8 | `/Users/nathanclevenger/projects/dotdo/ai/ai-core.ts` | 10 | AI Core - Mock detection, dynamic imports |
| 9 | `/Users/nathanclevenger/projects/dotdo/primitives/packages/digital-tools/src/providers/email/resend.ts` | 9 | Provider - API response handling |
| 10 | `/Users/nathanclevenger/projects/dotdo/examples/rest-crud/TasksDO.ts` | 8 | Example code - Entity type casting |

### Test Files (Highest Counts)

| Rank | File | Count | Pattern |
|------|------|-------|---------|
| 1 | `/Users/nathanclevenger/projects/dotdo/fsx/core/watch/subscription.test.ts` | 118 | Mock state setup |
| 2 | `/Users/nathanclevenger/projects/dotdo/primitives/packages/ai-functions/test/ai-promise.test.ts` | 62 | Type narrowing tests |
| 3 | `/Users/nathanclevenger/projects/dotdo/fsx/test/storage/transactions.test.ts` | 62 | Storage mocking |
| 4 | `/Users/nathanclevenger/projects/dotdo/fsx/tests/watch/glob-subscriptions.test.ts` | 61 | Mock state setup |
| 5 | `/Users/nathanclevenger/projects/dotdo/npmx/test/do/rpc.test.ts` | 51 | RPC stub casting |
| 6 | `/Users/nathanclevenger/projects/dotdo/fsx/tests/watch/do-integration.test.ts` | 51 | Integration mocking |
| 7 | `/Users/nathanclevenger/projects/dotdo/ai/tests/ai-functions-integration.test.ts` | 51 | AI mock setup |
| 8 | `/Users/nathanclevenger/projects/dotdo/ai/tests/ai-props-integration.test.ts` | 49 | AI mock setup |
| 9 | `/Users/nathanclevenger/projects/dotdo/fsx/tests/tiered.test.ts` | 47 | Storage tier mocking |
| 10 | `/Users/nathanclevenger/projects/dotdo/do/tests/event-retention.test.ts` | 44 | Event system mocking |

## Categories by Safety Level

### Level 1: SAFE - Controlled Type Narrowing

Pattern: Using `as unknown as T` to access known internal properties in tests.

```typescript
// Example from do/tests/context.test.ts
const $ = (instance as unknown as { $: WorkflowContext }).$
```

**Assessment:** Safe when accessing internal/private properties in test code. The property is known to exist at runtime.

**Files:** 34 test files with this pattern (primarily in `do/tests/`)

### Level 2: SAFE WITH GUARDS - Entity Type Casting

Pattern: Casting generic entity results to specific types.

```typescript
// Example from examples/auth-patterns/AuthDO.ts
const user = await this.things.get(userId) as unknown as User & { $id: string }
if ((session as unknown as Session).expiresAt < now) { ... }
```

**Assessment:** Safe when preceded by type validation or existence checks. The examples directory shows the common pattern of casting `things` results to domain-specific types.

**Files:** All example DOs (37+ assertions total), core `db/digital-objects.ts`

### Level 3: NEEDS REVIEW - Environment/Runtime Detection

Pattern: Checking global or runtime-specific properties.

```typescript
// Example from ai/ai-core.ts
if (typeof globalThis !== 'undefined' && (globalThis as any).ENVIRONMENT === 'production') { ... }
if ((globalThis as any).__vitest_worker__) return true
if ((globalThis as any).jest) return true
```

**Assessment:** Necessary for cross-environment compatibility but should be centralized into utility functions with proper type definitions.

**Files:** `ai/ai-core.ts`, `observability/context.ts`, `do/workflow/async-context.ts`, benchmark files

### Level 4: NEEDS REVIEW - Dynamic Import/Module Handling

Pattern: Handling dynamically imported modules.

```typescript
// Example from ai/ai-core.ts
const aiModule = await import('ai') as any
```

**Assessment:** Often necessary when TypeScript can't infer types from dynamic imports. Consider using explicit type imports.

**Files:** `ai/ai-core.ts`, `dotdo/cli.ts`

### Level 5: CAUTION - Mock Object Creation

Pattern: Creating mock objects for testing.

```typescript
// Example pattern in test files
const mockState = { ... } as any
const mockEnv = { DO: mockNamespace } as unknown as Env
```

**Assessment:** Common in tests but can mask missing mock properties. Consider using proper mock utilities like `vi.mocked()` or dedicated mock factories.

**Files:** Widespread in test files (118 instances in `fsx/core/watch/subscription.test.ts` alone)

### Level 6: CAUTION - Proxy/Dynamic API Returns

Pattern: Returning `any` from dynamic APIs.

```typescript
// Pattern seen in workflow/schedule DSL
return new Proxy(builder, handler) as any
```

**Assessment:** Required for highly dynamic APIs. Document expected runtime types and consider branded types.

**Files:** `do/workflow/context.ts`, CLI tools

### Level 7: DANGEROUS - Silencing Type Errors

Pattern: Using `as any` to bypass type checker errors.

```typescript
// Anti-pattern
someFunction(incompatibleArg as any)
```

**Assessment:** Should be investigated case-by-case. May indicate:
- Missing type definitions
- Design issues requiring refactoring
- Temporary workarounds that became permanent

**Prevalence:** Scattered across codebase, needs manual review

## Recommended Actions

### Immediate (P0)

1. **Review example DOs** - The examples directory has the highest concentration of type assertions. Since these serve as documentation, they should demonstrate proper typing patterns.

2. **Centralize globalThis checks** - Create utility module for runtime/environment detection:
   ```typescript
   // utils/runtime.ts
   export const isVitest = (): boolean => '__vitest_worker__' in globalThis
   export const isJest = (): boolean => 'jest' in globalThis
   export const isProduction = (): boolean => process.env.NODE_ENV === 'production'
   ```

### Short-term (P1)

3. **Define entity type guards** - Create type guard utilities for `things` results:
   ```typescript
   function isUser(thing: unknown): thing is User {
     return thing !== null && typeof thing === 'object' && 'email' in thing
   }
   ```

4. **Improve test mock utilities** - Create typed mock factories instead of inline `as any` casts.

### Long-term (P2)

5. **Review primitives submodule** - Coordinate with primitives repo on reducing assertions in AI packages.

6. **Add ESLint rule** - Enforce `@typescript-eslint/no-explicit-any` with allowances for documented exceptions.

## Notes

- The `primitives/` directory is a git submodule with 163 files containing assertions
- Example code (7 files) accounts for 130+ assertions - these should demonstrate best practices
- Test file assertions (76.8% of total) are generally acceptable but high concentrations indicate mock infrastructure could be improved
- The `as unknown as T` pattern is preferred over `as any` when type narrowing is intentional

---

# Record<string, unknown> Usage Audit

## Summary

This section audits the use of `Record<string, unknown>` across the dotdo codebase. While `Record<string, unknown>` is safer than `any`, overuse can indicate missing type definitions. This audit categorizes legitimate uses vs. opportunities for more specific typing.

**Audit Date:** 2026-01-21
**Issue:** do-jwte

## Statistics

### Overall Count

| Category | Count | Notes |
|----------|-------|-------|
| **Total Usages** | 1000+ | Across entire codebase |
| **Core packages (do, db, api, rpc, ai)** | ~180 | Primary focus of this audit |
| **Test files** | ~200 | Generally acceptable |
| **Primitives submodule** | ~350 | Separate lifecycle |
| **dist/ directories** | ~100 | Generated, mirrors source |

## Categories of Legitimate Use

### Category 1: SQL Result Rows (LEGITIMATE)

```typescript
// Pattern: SqlStorage interface returns dynamic columns
interface SqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Record<string, unknown> | null
      all(): { results: Array<Record<string, unknown>> }
    }
  }
}
```

**Location:** `db/types.ts`

**Assessment:** Raw SQL queries can return any column types. Callers should cast to appropriate types after retrieval. This is documented in db/types.ts.

### Category 2: Error Details (LEGITIMATE - Now Typed)

```typescript
// Pattern: Error context/details are inherently open-ended
export type ErrorDetails = Record<string, unknown>

class DotdoError extends Error {
  public readonly details?: ErrorDetails
}
```

**Location:** `db/errors.ts`, `rpc/errors/base.ts`

**Assessment:** Error details vary by error type - may include field names, IDs, URLs, counts, etc. A dedicated `ErrorDetails` type alias was created to document this legitimate use while providing a semantic type name.

**Action Taken:** Created `ErrorDetails` type alias in `db/errors.ts` and updated all error classes to use it.

### Category 3: Logger Context (LEGITIMATE)

```typescript
// Pattern: Log context is arbitrary metadata
interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}
```

**Locations:** `observability/logger.ts`, `gitx/src/do/logger.ts`

**Assessment:** Logging context is intentionally open-ended to support arbitrary metadata. This is a standard pattern across logging libraries.

### Category 4: JSON Parsing / Type Guards (LEGITIMATE)

```typescript
// Pattern: Safe property access on unknown objects
function isSerializedDotdoError(value: unknown): value is SerializedDotdoError {
  const obj = value as Record<string, unknown>
  return typeof obj['message'] === 'string'
}
```

**Assessment:** When checking arbitrary JSON data, `Record<string, unknown>` provides safe property access without `any`. This is the recommended pattern.

### Category 5: Metadata Fields (LEGITIMATE)

```typescript
// Pattern: Entity metadata is user-defined
interface Thing {
  $id: string
  $type: string
  metadata?: Record<string, unknown>
}
```

**Assessment:** Metadata fields are intentionally schemaless to support arbitrary user data. This is a design decision, not a typing gap.

### Category 6: MCP Tool Parameters (LEGITIMATE)

```typescript
// Pattern: MCP tools accept dynamic parameters
type MCPToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>
```

**Locations:** `mcp/tools.ts`, `fsx/core/mcp/tool-registry.ts`

**Assessment:** MCP (Model Context Protocol) tools receive parameters from AI models. The shape varies per tool and is validated at runtime.

## Categories Requiring Improvement

### Category 1: Proxy Target Access (NEEDS REVIEW)

```typescript
// Pattern: Dynamic property access via proxy
let current = target as Record<string, unknown>
current = next as Record<string, unknown>
```

**Locations:** `rpc/server.ts`, `do/handlers/rpc.ts`

**Assessment:** These support dynamic RPC method resolution. Could potentially use more specific interface types.

### Category 2: Eval Interpreter Scope (NEEDS REVIEW)

```typescript
// Pattern: Dynamic expression evaluation
evaluateSimpleExpression(expr: string, scope: Record<string, unknown>): unknown
```

**Location:** `do/eval/interpreter.ts`

**Assessment:** The eval interpreter deals with dynamic scope objects. May benefit from a more specific `EvalScope` type.

### Category 3: Workflow Event Payloads (COULD IMPROVE)

```typescript
// Pattern: Event payload in workflow context
? payload as Record<string, unknown>
```

**Location:** `do/workflow/context.ts`

**Assessment:** Could use the event schema types already defined in `do/types.ts`.

## Type Aliases Created

The following type aliases were created to provide semantic meaning to legitimate `Record<string, unknown>` uses:

### db/types.ts (Pre-existing)

```typescript
// For database storage
export type JsonValue = string | number | boolean | null | JsonArray | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type StorableData = Record<string, JsonValue>
export type WhereConditions<T extends StorableData = StorableData> = Partial<T>
```

### db/errors.ts (Added in this audit)

```typescript
/**
 * Type alias for error details/context.
 * This is a legitimate use of Record<string, unknown> because error details
 * are inherently open-ended.
 */
export type ErrorDetails = Record<string, unknown>
```

## Files Updated

| File | Changes |
|------|---------|
| `db/errors.ts` | Added `ErrorDetails` type alias, updated 7 usages |
| `rpc/errors/base.ts` | Imported and used `ErrorDetails`, updated 14 usages |

## Recommendations

### Do Use Record<string, unknown> For:

1. **SQL query results** - Raw SQL returns arbitrary columns
2. **Error details** - Error context varies by type (use `ErrorDetails` alias)
3. **Logger context** - Logging metadata is open-ended
4. **Type guards** - Safe property access on `unknown` values
5. **Metadata fields** - User-defined schemaless data
6. **External API responses** - When shape is unpredictable
7. **MCP/RPC parameters** - Dynamic protocol data validated at runtime

### Consider More Specific Types For:

1. **Internal state objects** - Define explicit interfaces
2. **Configuration objects** - Create typed config schemas
3. **Event payloads** - Use the event schema system
4. **Known API responses** - Define response interfaces

### Migration Strategy

1. **Don't bulk replace** - `Record<string, unknown>` is often correct
2. **Add type aliases** - Create semantic names like `ErrorDetails`
3. **Document legitimate uses** - Add JSDoc explaining why `Record<string, unknown>` is appropriate
4. **Use bounded generics** - `StorableData = Record<string, JsonValue>` is more restrictive than `Record<string, unknown>`

## Notes

- The `primitives/` directory is a git submodule with ~350 usages (separate lifecycle)
- Many usages in `dist/` directories mirror source files
- Test files often use `Record<string, unknown>` for mock state (acceptable)
- The existing `db/types.ts` provides good type infrastructure for data layer
