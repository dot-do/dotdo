# Test Infrastructure Cleanup Report

Generated: 2026-01-14
Task: do-y7x REFACTOR Phase - Clean up test infrastructure

## Executive Summary

This report identifies deprecated test files, duplicate test utilities, and patterns that should be consolidated or removed. The dotdo project has a well-organized vitest workspace configuration with 100+ workspaces, but there are several areas that could benefit from cleanup.

## 1. Deprecated Test Files Using Mocks

Per CLAUDE.md: "Durable Objects require NO MOCKING. Miniflare runs real DOs with real SQLite locally."

The following test files are explicitly marked as `@deprecated` and should be removed:

### High Priority (Explicitly Deprecated)

| File | Replacement | Recommendation |
|------|-------------|----------------|
| `objects/tests/browser-lifecycle.test.ts` | `objects/tests/browser-do-lifecycle.test.ts` | DELETE - superseded by real DO tests |
| `objects/tests/browser-screencast.test.ts` | `objects/tests/browser-do-screencast.test.ts` (if exists) | DELETE - superseded by real DO tests |
| `objects/tests/browser-routes.test.ts` | `objects/tests/browser-do-routes.test.ts` | DELETE - superseded by real DO tests |

All three files contain the header:
```
@deprecated DEPRECATED - These tests use vi.mock and are superseded by the real DO tests.
Use the NO MOCKS tests instead:
- Run: npx vitest run --project=browser-do
```

### Medium Priority (Using vi.mock for DO-related code)

These files use `vi.mock` but may have legitimate reasons (mocking external dependencies, not DO internals):

| File | Pattern | Assessment |
|------|---------|------------|
| `do/capabilities/bashx/tests/do/bash-module.test.ts` | Mocks `../../src/ast/parser.js` and `../../src/ast/analyze.js` | KEEP - mocking internal AST modules, not DO storage |
| `do/capabilities/bashx/tests/sdk-client.test.ts` | Mocks `rpc.do` external module | KEEP - mocking external SDK |
| `objects/tests/sandbox-lifecycle.test.ts` | Mocks `../../sandbox` | REVIEW - may need real miniflare tests |
| `objects/tests/sandbox-routes.test.ts` | Mocks `../../sandbox` | REVIEW - may need real miniflare tests |
| `cli/tests/auth-commands.test.ts` | Mocks `oauth.do/node` | KEEP - mocking external auth module |
| `snippets/tests/e2e/artifacts-e2e.test.ts` | Uses `vi.mocked()` | KEEP - mocking pipeline handlers for retry testing |

## 2. Duplicate Test Utilities

### Test Utility Locations

The project has test utilities scattered across multiple directories:

| Location | Purpose | Status |
|----------|---------|--------|
| `tests/utils/index.ts` | Shared test utilities (createMockRequest, waitFor, retry, etc.) | PRIMARY |
| `tests/harness/index.ts` | Testing harness (createTestClient, workflow testing) | PRIMARY |
| `tests/mocks/*.ts` | Mock implementations (19 files) | CENTRALIZED |
| `tests/config/*.ts` | Vitest configuration | CENTRALIZED |
| `objects/tests/test-utils.ts` | Capability module testing utilities | KEEP - specialized for capabilities |
| `do/capabilities/fsx/tests/test-utils.ts` | FSX-specific test utilities (InMemoryStorage, MockDurableObjectStub) | KEEP - specialized for fsx |
| `do/capabilities/bashx/core/pty/test-helpers.ts` | PTY-specific test helpers | KEEP - specialized for pty |

### Recommendation

The test utilities are reasonably well-organized. The specialized utilities in submodules (`fsx`, `bashx`) make sense to keep separate as they contain domain-specific mocks. No consolidation needed.

## 3. Duplicate Test Files (Same Name, Different Locations)

These test files share names but test different functionality:

### Legitimate Duplicates (Different Modules)

| Filename | Locations | Assessment |
|----------|-----------|------------|
| `agent.test.ts` | `cli/tests/`, `ai/primitives/packages/autonomous-agents/test/` | KEEP - different modules |
| `api.test.ts` | `tests/harness/`, `api/tests/routes/`, `workers/`, `ai/primitives/` | KEEP - different modules |
| `auth.test.ts` | `do/capabilities/bashx/tests/rpc/`, `cli/tests/`, `examples/compat-supabase-auth/tests/`, `api/tests/middleware/` | KEEP - different modules |
| `cache.test.ts` | `do/capabilities/fsx/core/cas/`, `ai/primitives/packages/ai-functions/test/`, `ai/primitives/packages/ai-props/test/` | KEEP - different modules |
| `client.test.ts` | `do/capabilities/npmx/test/core/registry/`, `lib/sdk/` | KEEP - different modules |

### Potentially Redundant Tests

| Filename | Locations | Assessment |
|----------|-----------|------------|
| `config-loading.test.ts` | `snippets/tests/`, `snippets/tests/proxy/` | REVIEW - may be RED/GREEN phases of same tests |
| `integration.test.ts` | `snippets/tests/`, `snippets/tests/proxy/` | REVIEW - may be redundant |
| `policies.test.ts` | `snippets/tests/`, `snippets/tests/proxy/` | REVIEW - may be redundant |
| `route-matching.test.ts` | `snippets/tests/`, `snippets/tests/proxy/` | REVIEW - may be redundant |
| `transforms.test.ts` | `snippets/tests/`, `snippets/tests/proxy/` | REVIEW - may be redundant |

The `snippets/tests/proxy/` directory appears to contain GREEN phase implementations of tests that have RED phase counterparts in `snippets/tests/`. These should be reviewed for consolidation.

## 4. Vitest Workspace Configuration

The `vitest.workspace.ts` is well-organized with:
- 100+ test workspaces
- Clear separation between Node and Workers environments
- Shared configuration via `tests/config/vitest.shared.ts`
- Proper timeout presets for different test types
- Centralized Workers pool options

### Workspace Configuration Issues

None found. The configuration is exemplary.

## 5. Mock Files Analysis

Located in `tests/mocks/`:

| File | Purpose | Status |
|------|---------|--------|
| `cloudflare-workers.ts` | Mock for `cloudflare:workers` module | KEEP |
| `pipeline.ts` | Mock for Pipelines API | KEEP |
| `iceberg.ts` | Mock for Iceberg metadata | KEEP |
| `usage-pipeline.ts` | Mock for usage tracking | KEEP |
| `session-store.ts` | Mock for session storage | KEEP |
| `do-infrastructure.ts` | Mock for DO infrastructure | REVIEW - may conflict with "no mocks" philosophy |
| `chdb.ts` | Mock for chdb native module | KEEP |
| `analytics.ts` | Mock for analytics | KEEP |
| `chaos.ts` | Mock for chaos testing | KEEP |
| `cloudflare-sandbox.ts` | Mock for @cloudflare/sandbox | KEEP |
| `cloudflare-containers.ts` | Mock for @cloudflare/containers | KEEP |
| `drizzle-durable-sqlite.ts` | Mock for drizzle ORM | KEEP |
| `tanstack-db.ts` | Mock for TanStack DB | KEEP |
| `dotdo-tanstack-sync.ts` | Mock for sync engine | KEEP |
| `user.ts` | Mock user data | KEEP |
| `approval.ts` | Mock approval system | KEEP |
| `capnweb.ts` | Mock for Cap'n Web RPC | KEEP |

### Note on `do-infrastructure.ts`

This file should be reviewed to ensure it's only used for:
- Testing worker logic that doesn't need real DOs
- Node environment tests where miniflare isn't available

It should NOT be used where real miniflare tests are possible.

## 6. Recommended Actions

### Immediate Actions (Safe to Do)

1. **DELETE deprecated browser test files:**
   ```bash
   rm objects/tests/browser-lifecycle.test.ts
   rm objects/tests/browser-screencast.test.ts
   rm objects/tests/browser-routes.test.ts
   ```

### Review Actions (Require Verification)

2. **Review snippets/tests/proxy/ directory:**
   - Compare with `snippets/tests/` for redundancy
   - Consolidate if tests cover same functionality

3. **Review sandbox mock tests:**
   - `objects/tests/sandbox-lifecycle.test.ts`
   - `objects/tests/sandbox-routes.test.ts`
   - Consider creating real miniflare tests if feasible

4. **Review do-infrastructure.ts usage:**
   - Ensure it's not used where real DOs should be tested
   - Document its legitimate use cases

### No Action Needed

- Test utilities are appropriately specialized
- Vitest workspace configuration is well-organized
- Duplicate filenames are legitimate (different modules)
- Most vi.mock usage is for external dependencies, not DO internals

## 7. Test Count by Category

| Category | Count | Notes |
|----------|-------|-------|
| Deprecated (DELETE) | 3 | Browser mock tests |
| Review Needed | ~10 | Proxy duplicates, sandbox mocks |
| Legitimate Mocks | ~15 | External dependencies |
| Total Test Files | 500+ | Healthy test suite |

## Appendix: Files Using vi.mock

Full list of files with `vi.mock` patterns (136 files found). Most are legitimate external dependency mocks. Key files to focus on are those mocking DO-related code:

- `objects/tests/browser-*.test.ts` (3 files - DEPRECATED)
- `objects/tests/sandbox-*.test.ts` (2 files - REVIEW)

All other vi.mock usage appears to be for:
- External SDKs (rpc.do, oauth.do, etc.)
- Native modules (chdb, tree-sitter)
- Infrastructure services (R2, KV, etc.)
- Test isolation (console, fetch)

These are acceptable patterns per the testing philosophy.
