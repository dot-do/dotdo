# Testing Guide

This document describes the testing infrastructure for `@dotdo/chdb-wasm`, including test organization, TDD practices, and configuration details.

## Test Environment Philosophy

**All tests run in the workerd runtime (Cloudflare Workers)** via `@cloudflare/vitest-pool-workers`, ensuring tests run in the same environment as production. This catches runtime-specific issues early and eliminates the need for WASM mocks.

Benefits of running all tests in workerd:
- WASM loading behavior matches production
- Memory limits enforced (128MB on Workers)
- CPU time limits enforced
- Workers-specific APIs available (R2, KV, DO bindings)
- Web Crypto API matches production
- Event loop behavior matches production
- **No WASM mocks needed** - tests use real WASM modules

## Test File Organization

```
tests/
  __mocks__/              # Mock utilities (WASM loader helpers, not fake mocks)
    wasm-loader.ts          # Real WASM file loader for testing
    cloudflare-workers.ts # Cloudflare types
    better-sqlite3.ts     # SQLite mock

  unit/                   # Unit tests (isolated, fast, run in workerd)
    sql-parser.test.ts
    formatters.test.ts
    query-cache.test.ts
    workerd-environment.test.ts
    ...

  workers/                # Workers runtime-specific tests
    runtime-environment.test.ts
    wasm-loading.test.ts
    memory-limits.test.ts
    cpu-time.test.ts
    ...

  integration/            # Integration tests (cross-component)
    parquet-s3.test.ts
    parquet-real-data.test.ts
    ...

  e2e/                    # End-to-end tests (HTTP requests)
    setup.ts              # Worker startup/teardown
    http-interface.test.ts
    deployed-worker.test.ts  # Requires WORKER_URL env var
    deployed.test.ts
    ...

  utils/                  # Test utilities and helpers
    index.ts
    test-helpers.ts

  setup.ts                # Global test setup
```

## Test Naming Conventions

### File Names
- Test files: `<feature-name>.test.ts`
- Setup files: `setup.ts`
- Mock files: Located in `__mocks__/` directory

### Test Structure
```typescript
/**
 * Feature Description Tests
 *
 * Brief description of what this test file covers.
 * Include TDD phase marker if applicable.
 *
 * TDD RED phase: Tests are written BEFORE the implementation.
 */
import { describe, it, expect } from 'vitest';

describe('Feature Name', () => {
  describe('Sub-feature or Method', () => {
    it('should do specific thing', () => {
      // Arrange
      // Act
      // Assert
    });

    it('should handle edge case', () => {
      // ...
    });
  });
});
```

### Test Descriptions
- Use `describe()` for grouping related tests
- Use `it()` with descriptions starting with "should"
- Be specific about expected behavior
- Include context for edge cases

## TDD RED/GREEN/REFACTOR Phases

This project follows Test-Driven Development. Tests include phase markers to track progress.

### RED Phase (Tests Fail)
Tests are written **before** implementation. They define expected behavior and will fail until the feature is implemented.

```typescript
/**
 * SQL Parser Module Tests
 *
 * TDD RED phase: These tests are written BEFORE the implementation.
 */
describe('SQL Parser Module', () => {
  it('should detect SELECT statements', () => {
    expect(detectStatementType('SELECT 1')).toBe(StatementType.SELECT);
  });
});
```

RED phase tests should:
- Define the expected interface/API
- Cover happy paths and edge cases
- Document expected error handling
- Be runnable (imports may need stubs)

### GREEN Phase (Tests Pass)
Minimal implementation to make tests pass. Focus on correctness, not optimization.

```typescript
/**
 * Workerd Environment Detection Tests (TDD GREEN Phase)
 *
 * These tests verify that ALL tests run in the workerd runtime.
 * Now that we've unified the vitest config, these should PASS.
 */
describe('Workerd Environment Detection (GREEN Phase)', () => {
  it('should be running in workerd', () => {
    expect(navigator.userAgent).toContain('Cloudflare-Workers');
  });
});
```

GREEN phase changes:
- Implement just enough to pass tests
- Don't add untested functionality
- Keep code simple and direct

### REFACTOR Phase
Improve code quality while keeping tests green. Extract functions, improve naming, optimize performance.

Refactor phase guidelines:
- Run tests frequently to ensure they stay green
- Improve readability and maintainability
- Extract common patterns
- Add documentation
- **Do not change test expectations**

### Phase Transitions in Beads

This project uses `bd` (beads) for issue tracking. TDD tasks are organized as:

```
bd-abc123           # Feature epic
  bd-abc123.1       # RED: Write failing tests
  bd-abc123.2       # GREEN: Implement to pass tests
  bd-abc123.3       # REFACTOR: Clean up implementation
```

## Running Tests

### Primary Commands

```bash
# Run all tests (unit, workers, integration) in workerd
pnpm test

# Watch mode
pnpm test:watch

# Run specific test categories
pnpm test:unit              # Unit tests only
pnpm test:workers           # Workers runtime tests only
pnpm test:integration       # Integration tests only

# Run E2E tests (separate config, runs in Node.js to orchestrate)
pnpm test:e2e

# Run tests against deployed worker
WORKER_URL=https://your-worker.workers.dev pnpm test:e2e:deployed-worker

# Run all test suites
pnpm test:all
```

### Running Specific Tests

```bash
# Run tests matching a pattern
pnpm test -- --grep "SQL Parser"

# Run a specific file
pnpm test tests/unit/sql-parser.test.ts

# Run with verbose output
pnpm test -- --reporter=verbose
```

## Test Configuration Files

| File | Environment | Purpose |
|------|-------------|---------|
| `vitest.config.ts` | workerd | **Primary config** - Unit, workers, and integration tests run in Cloudflare Workers runtime |
| `vitest.e2e.config.ts` | Node.js | E2E tests that orchestrate HTTP requests to local/deployed workers |
| `vitest.node.config.ts` | Node.js | Static analysis tests that need Node.js fs (currently empty) |

### vitest.config.ts (Primary)

All unit, workers, and integration tests run through this config using `@cloudflare/vitest-pool-workers`:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/workers/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['**/tests/e2e/**'],
    globals: true,
    testTimeout: 60000,
    poolOptions: {
      workers: {
        isolatedStorage: true,
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
          bindings: { CHDB_VERSION: '0.1.0', ENVIRONMENT: 'test' },
          r2Buckets: { DATA_BUCKET: 'test-bucket' },
          kvNamespaces: { CACHE: 'test-cache' },
        },
        wrangler: { configPath: './tests/workers/wrangler.test.toml' },
        main: './src/worker.ts',
      },
    },
  },
});
```

### vitest.e2e.config.ts

E2E tests run in Node.js and make HTTP requests to workers:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    setupFiles: ['./tests/e2e/setup.ts'],
    testTimeout: 60000,
  },
});
```

## Mocking Strategies

### WASM Modules

**No WASM mocks are needed.** Tests run in workerd with real WASM modules loaded via miniflare's `modulesRules`:

```typescript
miniflare: {
  modulesRules: [
    { type: 'CompiledWasm', include: ['**/*.wasm'] },
  ],
}
```

The `tests/__mocks__/wasm-loader.ts` file provides **loader utilities** for tests that need to directly load WASM files, not fake implementations:

```typescript
// Load real WASM for testing
import { loadWasmModule } from '../__mocks__/wasm-loader';

const module = await loadWasmModule('core.wasm');
```

### Cloudflare Bindings

R2, KV, and other bindings are provided by miniflare in-memory:

```typescript
import { env } from 'cloudflare:test';

// These are real in-memory implementations, not mocks
await env.DATA_BUCKET.put('key', 'value');
const obj = await env.DATA_BUCKET.get('key');
```

### External HTTP Requests

Use `fetchMock` from `cloudflare:test`:

```typescript
import { fetchMock } from 'cloudflare:test';

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.deactivate();
});

it('should handle external API', async () => {
  fetchMock
    .get('https://api.example.com')
    .intercept({ path: '/data' })
    .reply(200, { result: 'success' });

  // Test code that calls external API
});
```

## Testing in workerd vs Node.js

### Detecting Runtime Environment

Tests can verify they're running in workerd:

```typescript
it('should be running in workerd', () => {
  // Primary check: navigator.userAgent
  expect(navigator.userAgent).toContain('Cloudflare-Workers');

  // Workers-specific APIs
  expect(typeof HTMLRewriter).toBe('function');
  expect(typeof caches).toBe('object');
});
```

### nodejs_compat Flag

The `nodejs_compat` compatibility flag is enabled, which means:
- `process.versions.node` may exist (as a polyfill)
- Node.js-like APIs are available
- **Use `navigator.userAgent` to confirm workerd environment**

### E2E Tests (Node.js)

E2E tests run in Node.js because they:
- Need to orchestrate worker startup via `wrangler unstable_dev`
- Make external HTTP requests to running workers
- Manage test fixtures and cleanup

```typescript
// tests/e2e/setup.ts
import { unstable_dev } from 'wrangler';

beforeAll(async () => {
  worker = await unstable_dev('src/worker.ts', {
    config: 'tests/e2e/wrangler.test.toml',
    local: true,
  });
  workerUrl = `http://${worker.address}:${worker.port}`;
});
```

## Test Utilities

### cloudflare:test Module

Available in workerd tests:

```typescript
import {
  env,                    // Bindings (R2, KV, DO, vars)
  SELF,                   // Fetcher for worker requests
  fetchMock,              // Mock outbound fetch
  createExecutionContext, // Create ExecutionContext
  waitOnExecutionContext, // Wait for waitUntil promises
} from 'cloudflare:test';
```

### Test Helpers

Located in `tests/utils/`:

```typescript
import { createTestRequest, parseJsonResponse } from '../utils/test-helpers';

it('should handle query', async () => {
  const request = createTestRequest('SELECT 1');
  const response = await SELF.fetch(request);
  const result = await parseJsonResponse(response);
  expect(result.data).toHaveLength(1);
});
```

## Deployed Worker Tests

### Strict Tests (deployed-worker.test.ts)

Require `WORKER_URL` environment variable. Will **fail immediately** if not set:

```typescript
if (!WORKER_URL) {
  describe('E2E: Deployed Worker', () => {
    it('REQUIRES WORKER_URL environment variable', () => {
      throw new Error('WORKER_URL required');
    });
  });
}
```

Run with:
```bash
WORKER_URL=https://your-worker.workers.dev pnpm test:e2e:deployed-worker
```

### Optional Tests (deployed.test.ts)

Skip gracefully if `WORKER_URL` not set:

```bash
pnpm test:e2e:deployed  # Skips if no URL
WORKER_URL=https://... pnpm test:e2e:deployed  # Runs tests
```

## Troubleshooting

### Tests fail with "cloudflare:test not found"

Ensure you're using the correct config:
```bash
pnpm test  # Uses vitest.config.ts with workers pool
```

### E2E tests hang or timeout

Check if worker can start manually:
```bash
pnpm dev  # Start local worker
```

### Memory errors in tests

Workers have 128MB limit. Solutions:
- Reduce test data size
- Enable `isolatedStorage` (default)
- Check for memory leaks

### WASM loading fails

Ensure WASM files exist:
```bash
ls wasm/dist/modular/  # Check for .wasm files
pnpm build:wasm        # Rebuild if needed
```

### Tests pass locally but fail in CI

Check:
- Node.js version matches (`>=18.0.0`)
- All dependencies installed (`pnpm install`)
- WASM files committed or built in CI

## Writing New Tests

### Unit Test (in workerd)

```typescript
// tests/unit/my-feature.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/my-feature';

describe('My Feature', () => {
  it('should handle normal input', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

### Workers Runtime Test

```typescript
// tests/workers/my-feature.test.ts
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('My Feature in Workers', () => {
  it('should use R2 bucket', async () => {
    await env.DATA_BUCKET.put('key', 'value');
    const obj = await env.DATA_BUCKET.get('key');
    expect(await obj?.text()).toBe('value');
  });
});
```

### E2E Test

```typescript
// tests/e2e/my-feature.test.ts
import { describe, it, expect } from 'vitest';
import { getWorkerUrl } from './setup';

describe('My Feature E2E', () => {
  it('should respond to HTTP request', async () => {
    const response = await fetch(`${getWorkerUrl()}/my-endpoint`);
    expect(response.status).toBe(200);
  });
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install

      # Run all tests (unit, workers, integration in workerd)
      - run: pnpm test

      # Run E2E tests with local worker
      - run: pnpm test:e2e

  deployed-tests:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    needs: test
    steps:
      # ... setup steps
      - run: pnpm test:e2e:deployed-worker
        env:
          WORKER_URL: ${{ secrets.STAGING_WORKER_URL }}
```

## Smoke Tests

Quick validation after deployment:

```bash
# Using smoke-test.sh script
./scripts/smoke-test.sh https://your-worker.workers.dev

# Against staging
./scripts/smoke-test.sh --config chdb-wasm --env staging

# JSON output for CI
./scripts/smoke-test.sh --config chdb-wasm --env staging --json
```

Smoke tests validate:
- `/ping` health endpoint
- `/replicas_status` endpoint
- `SELECT 1` query execution
- CORS headers
- Error handling
