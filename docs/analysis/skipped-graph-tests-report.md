# Skipped Graph Tests Analysis Report (do-chxw)

## Summary

The file `db/graph/tests/lean-graph-columns.test.ts` contains **27 tests** with **16 skipped** (59% skipped).

## Test Breakdown

| Suite | Status | Count | Description |
|-------|--------|-------|-------------|
| LeafGraphColumns Module Exports | PASSING | 5 | Tests module exports (functions exist) |
| is_root Column | SKIPPED | 3 | Tests root node identification |
| is_leaf Column | SKIPPED | 3 | Tests leaf node identification |
| depth Column | SKIPPED | 4 | Tests depth computation |
| Combined NodeHierarchyInfo | SKIPPED | 2 | Tests combined hierarchy queries |
| LeanGraphColumns Store Integration | PASSING | 6 | Tests via RelationshipsStore |
| AdjacencyIndex Hierarchy Extensions | SKIPPED | 4 | Tests AdjacencyIndex hierarchy methods |

## Why Tests Are Skipped

All skipped tests use `describe.skip()` with the annotation:

```typescript
describe.skip('is_root Column (requires better-sqlite3)', () => {
```

### The Root Cause

The skipped tests require **direct SQLite access** using `better-sqlite3`:

```typescript
beforeEach(async () => {
  try {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')
    // Create tables and test raw SQL
  } catch {
    // Skip if better-sqlite3 not available
  }
})
```

### Dependency Status

`better-sqlite3` **IS** installed in the project:
- `package.json`: `"better-sqlite3": "^12.6.0"`
- `package.json`: `"@types/better-sqlite3": "^7.6.13"`

### Why It Still Gets Skipped

The tests are **intentionally skipped** to demonstrate the NO MOCKS testing philosophy. The tests were written to:

1. **Show the raw SQL queries** needed for hierarchy operations (depth, is_leaf, is_root)
2. **Document the expected behavior** using real SQLite
3. **Serve as reference implementations** that will be replaced by DO SQLite tests

The `describe.skip()` is a design decision, not a dependency issue.

## Proposed Solutions

### Option 1: Convert to Miniflare DO SQLite Tests (RECOMMENDED)

Convert skipped tests to use real Durable Object SQLite via Miniflare, consistent with the NO MOCKS philosophy:

```typescript
import { env } from 'cloudflare:test'

describe('LeanGraphColumns with real DO SQLite', () => {
  it('computes depth correctly', async () => {
    const stub = env.TEST_DO.get(env.TEST_DO.idFromName('test'))
    // Test via RPC calls to RelationshipsStore
    await stub.relsCreate({ verb: 'manages', from: 'ceo', to: 'manager' })
    // ... verify depth computation
  })
})
```

**Pros:**
- Follows NO MOCKS philosophy perfectly
- Tests actual DO storage behavior
- Verifies real SQLite queries work in Workers runtime

**Cons:**
- Requires new wrangler config for graph tests
- Slightly more setup overhead

### Option 2: Remove `describe.skip()` and Run with better-sqlite3

Since `better-sqlite3` is already installed, simply remove the `.skip()`:

```typescript
describe('is_root Column', () => {  // Remove .skip
  // Tests run directly with better-sqlite3
})
```

**Pros:**
- Immediate fix, no new infrastructure
- Tests run in Node.js environment

**Cons:**
- Runs in Node.js, not Workers runtime
- Doesn't verify DO SQLite compatibility
- May mask runtime-specific issues

### Option 3: Keep as Reference Documentation

Keep tests skipped but rename to indicate their purpose:

```typescript
describe.skip('is_root Column (REFERENCE - see do-graph-columns.test.ts)', () => {
  // Reference implementation showing expected SQL queries
})
```

**Pros:**
- Documents expected behavior
- Clear that real tests are elsewhere
- No maintenance burden

**Cons:**
- Tests never run
- Documentation may drift from implementation

## Recommendation

**Implement Option 1** - Create a new Workers test file `db/graph/tests/lean-graph-columns-do.test.ts` that:

1. Uses `@cloudflare/vitest-pool-workers` with real Miniflare DOs
2. Tests the same scenarios via DO RPC
3. Keeps the existing skipped tests as SQL reference documentation

### Implementation Steps

1. Create `workers/wrangler.graph-test.jsonc` with TEST_DO binding
2. Create `db/graph/tests/lean-graph-columns-do.test.ts` with Miniflare tests
3. Add `graph-do` workspace to `vitest.workspace.ts`
4. Rename skipped tests to indicate they are reference documentation

## Files Involved

- `/Users/nathanclevenger/projects/dotdo/db/graph/tests/lean-graph-columns.test.ts` - Current test file (16 skipped)
- `/Users/nathanclevenger/projects/dotdo/db/graph/lean-graph-columns.ts` - Implementation (working)
- `/Users/nathanclevenger/projects/dotdo/db/graph/adjacency-index.ts` - AdjacencyIndex (not directly used by skipped tests)
- `/Users/nathanclevenger/projects/dotdo/db/graph/relationships.ts` - RelationshipsStore (used by passing tests)

## Conclusion

The 16 skipped tests are **intentional** and serve as SQL reference implementations. The actual functionality is tested via the 11 passing tests that use `RelationshipsStore` and `LeanGraphColumns` class methods.

To achieve 100% test coverage following the NO MOCKS philosophy, the recommended approach is to create new Miniflare-based tests that verify the same hierarchy operations through real DO SQLite storage.
