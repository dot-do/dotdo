# TDD Remediation Plan: dotdo Code Review Findings

**Date**: 2026-01-16
**Epic**: do-2knr (Review Remediation: Security, TypeScript, Testing, Architecture, DX)
**Methodology**: RED → GREEN → REFACTOR

## Executive Summary

This plan addresses all findings from the 5-part code review through structured TDD waves:

| Review | Score | Key Issues |
|--------|-------|------------|
| General Code | B+ (8/10) | new Function() security, error handling |
| Architecture | B+ (8.9/10) | DOCore.ts 2831 lines, god object |
| Testing | 7.5/10 | auth/ 0 tests, storage gaps |
| TypeScript | 7.5/10 | 58 `any` usages, 1,149 strict errors |
| Product | 5.5/10 prod-ready | No npm package, limited examples |

**Target Outcomes**:
- Zero critical/high security issues
- TypeScript score: 7.5 → 9+
- Testing score: 7.5 → 9+
- Production readiness: 5.5 → 8+

---

## Wave 0: Foundation (Establish Baseline)

**Goal**: Ensure a stable foundation before making changes.

### 0.1 [RED] Fix Pre-existing Storage-ops Test Failure
**File**: `core/__tests__/storage-ops.test.ts`
**Test**: `should filter with multiple conditions (AND)`
**Status**: Already failing (regression)

```typescript
// Expected behavior
const products = await things.list('Product', {
  where: { category: 'electronics', price: { $lt: 100 } }
})
expect(products.length).toBe(1) // Currently returns 0
```

**Acceptance**: Test passes with correct AND filtering.

### 0.2 [GREEN] Verify All Existing Tests Pass
**Command**: `pnpm test:run`
**Expected**: 490+ tests passing (excluding RED phase TDD tests)

### 0.3 [REFACTOR] Add Test Coverage Reporting
**File**: `vitest.coverage.config.ts`
**Goal**: Establish baseline coverage metrics

---

## Wave 1: Security Critical

**Goal**: Address critical security vulnerabilities before any feature work.

### 1.1 [RED] new Function() Sandboxing Tests
**Locations**:
- `core/DOCore.ts:1085` - evaluate handler
- `packages/workers/src/do/evaluate.ts:258` - evaluate function

**Tests to write**:
```typescript
describe('Evaluation Sandboxing', () => {
  it('should not allow access to process', async () => {
    await expect(evaluate('process.env')).rejects.toThrow()
  })

  it('should not allow constructor escape', async () => {
    await expect(evaluate('this.constructor.constructor("return process")()')).rejects.toThrow()
  })

  it('should not allow prototype pollution', async () => {
    await expect(evaluate('({}).__proto__.polluted = true')).not.toModifyPrototype()
  })

  it('should sandbox globalThis access', async () => {
    const result = await evaluate('Object.keys(globalThis)')
    expect(result).not.toContain('process')
  })
})
```

### 1.2 [GREEN] Implement Sandbox Hardening
**Changes**:
- Freeze sandbox globals
- Block constructor chain escape
- Validate code before evaluation
- Add CSP-style restrictions

### 1.3 [RED] Query Validation Edge Cases
**File**: `core/query-validation.ts`
**Tests**:
```typescript
describe('Query Validation Security', () => {
  it('should reject SQL injection in field names', async () => {
    await expect(things.list('User', {
      where: { "'; DROP TABLE users;--": 'value' }
    })).rejects.toThrow('Invalid field name')
  })

  it('should reject deeply nested operator injection', async () => {
    await expect(things.list('User', {
      where: { nested: { $where: 'malicious' } }
    })).rejects.toThrow('Unknown operator')
  })
})
```

### 1.4 [REFACTOR] Document Security Model
**Output**: `docs/security/evaluation-sandbox.md`
**Content**: Threat model, mitigations, audit trail

---

## Wave 2: Testing Gaps

**Goal**: Build safety net before architectural changes.

### 2.1 [RED] mcp/auth/ Module Tests
**Files**: `mcp/auth/__tests__/`
**Coverage targets**:
- `jwt.ts` - Token creation, verification, expiry
- `oauth.ts` - OAuth flow, token refresh
- `authkit.ts` - AuthKit integration

```typescript
describe('MCP JWT Auth', () => {
  it('should create valid JWT token', async () => {
    const token = await createToken({ userId: '123' }, secret)
    expect(token).toMatch(/^eyJ/)
  })

  it('should reject expired token', async () => {
    const expiredToken = await createToken({ userId: '123' }, secret, { expiresIn: -1 })
    await expect(verifyToken(expiredToken, secret)).rejects.toThrow('Token expired')
  })

  it('should reject tampered token', async () => {
    const token = await createToken({ userId: '123' }, secret)
    const tampered = token.slice(0, -1) + 'X'
    await expect(verifyToken(tampered, secret)).rejects.toThrow('Invalid signature')
  })
})
```

### 2.2 [RED] packages/middleware/src/auth/ Tests
**Files**: `packages/middleware/src/auth/__tests__/`
**Coverage targets**:
- `jwt.ts` - Hono middleware JWT verification
- `api-key.ts` - API key validation
- `session.ts` - Session management

### 2.3 [RED] Storage Layer Edge Cases
**File**: `core/__tests__/storage-ops.test.ts` (expand)
**New test sections**:
- Concurrent update conflicts
- Large dataset handling (1000+ items)
- Unicode/special character handling
- Null vs undefined semantics

### 2.4 [GREEN] Ensure All New Tests Pass

### 2.5 [REFACTOR] Create Shared Test Utilities
**File**: `tests/utils/auth-fixtures.ts`
**Exports**: Mock tokens, test users, session factories

---

## Wave 3: Type Safety

**Goal**: Progressively eliminate type safety gaps.

### 3.1 [RED] Eliminate Production `any`
**File**: `rpc/worker-rpc.ts:1` (only production `any`)
**Test**:
```typescript
// Type test file: rpc/worker-rpc.test-d.ts
import { expectTypeOf } from 'vitest'
import { WorkerRpc } from './worker-rpc'

expectTypeOf<WorkerRpc>().not.toBeAny()
```

### 3.2 [GREEN] Replace with Proper Types

### 3.3 [REFACTOR] Reduce Type Assertions
**Goal**: Reduce 554 assertions to <200
**Focus**: Double casts (`as unknown as T`)

### 3.4 Sub-issues: Strict TypeScript Options
**Parent**: do-evjx (blocked, needs decomposition)

| Directory | Errors | Priority | Issue ID |
|-----------|--------|----------|----------|
| rpc/ | 341 | P1 | do-evjx.1 |
| workflow/ | 106 | P1 | do-evjx.2 |
| mcp/ | 91 | P2 | do-evjx.3 |
| core/ | TBD | P2 | do-evjx.4 |
| streaming/ | TBD | P3 | do-evjx.5 |

**Approach per directory**:
1. [RED] Enable strict options in isolated tsconfig
2. [GREEN] Fix errors
3. [REFACTOR] Merge to main tsconfig

---

## Wave 4: Architecture Refactor

**Goal**: Reduce complexity of god objects.

### 4.1 [RED] DOCore Extraction Tests
**Current**: `core/DOCore.ts` - 2831 lines
**Target**: 4 modules ~700 lines each

```typescript
// Test module separation
describe('DOCore Modular Architecture', () => {
  it('should delegate storage ops to DOCoreStorage', async () => {
    const storage = new DOCoreStorage(ctx)
    expect(storage.things).toBeDefined()
    expect(storage.events).toBeDefined()
  })

  it('should delegate scheduling to DOCoreSchedule', async () => {
    const scheduler = new DOCoreSchedule(ctx)
    expect(scheduler.registerSchedule).toBeDefined()
    expect(scheduler.every).toBeDefined()
  })
})
```

### 4.2 [GREEN] Extract Modules

| Module | Responsibility | Lines |
|--------|---------------|-------|
| DOCoreStorage | Things, Relationships, Events stores | ~800 |
| DOCoreSchedule | Schedule registration, CRON, alarms | ~500 |
| DOCoreEvents | Event emission, handlers, wildcards | ~600 |
| DOCoreRpc | RPC method registration, routing | ~400 |
| DOCore | Coordination, composition | ~500 |

### 4.3 [REFACTOR] Clean Interfaces
**Goal**: Each module has clear interface contract
**Output**: `core/types/modules.ts`

---

## Wave 5: Code Quality

**Goal**: Standardize patterns across codebase.

### 5.1 [RED] Error Handling Consistency Tests
```typescript
describe('Error Handling Standards', () => {
  it('should wrap all DO errors in DotdoError', async () => {
    try {
      await doInstance.things.get('nonexistent')
    } catch (e) {
      expect(e).toBeInstanceOf(DotdoError)
      expect(e.code).toBe('NOT_FOUND')
      expect(e.context).toMatchObject({ id: 'nonexistent' })
    }
  })
})
```

### 5.2 [RED] Circuit Breaker Persistence Tests
```typescript
describe('Circuit Breaker Persistence', () => {
  it('should persist circuit state across DO restarts', async () => {
    const cb = new CircuitBreaker('external-api')
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure() // Opens circuit

    // Simulate DO restart
    const restored = await CircuitBreaker.restore('external-api', ctx.storage)
    expect(restored.state).toBe('open')
  })
})
```

### 5.3 [GREEN] Implement Improvements

### 5.4 [REFACTOR] Standardize Patterns
**Output**: `lib/errors/index.ts`, `lib/circuit-breaker/index.ts`

---

## Wave 6: Developer Experience

**Goal**: Enable external adoption.

### 6.1 [RED] NPM Package Build Tests
```typescript
describe('Package Publishing', () => {
  it('should build all packages successfully', async () => {
    const result = await exec('pnpm -r build')
    expect(result.exitCode).toBe(0)
  })

  it('should have valid package.json for each package', async () => {
    const packages = await glob('packages/*/package.json')
    for (const pkg of packages) {
      const json = JSON.parse(await readFile(pkg))
      expect(json.name).toMatch(/^@dotdo\//)
      expect(json.main).toBeDefined()
      expect(json.types).toBeDefined()
    }
  })
})
```

### 6.2 [RED] Example Verification Tests
```typescript
describe('Runnable Examples', () => {
  it('should run minimal example successfully', async () => {
    const result = await exec('cd examples/minimal && pnpm dev', { timeout: 30000 })
    expect(result.stdout).toContain('Ready')
  })
})
```

### 6.3 [GREEN] Complete Packaging
- Finalize pnpm workspace structure
- Ensure all packages have correct exports
- Add README to each package

### 6.4 [REFACTOR] Documentation
- API reference
- Getting started guide
- Architecture overview

---

## Dependency Graph

```
Wave 0 (Foundation)
    ↓
Wave 1 (Security) ──────────────────┐
    ↓                               │
Wave 2 (Testing Gaps) ←─────────────┤
    ↓                               │
Wave 3 (Type Safety) ←──────────────┤
    ↓                               │
Wave 4 (Architecture) ←─────────────┘
    ↓
Wave 5 (Code Quality)
    ↓
Wave 6 (Developer Experience)
```

**Critical Path**: Wave 0 → Wave 1 → Wave 2 → Wave 4

---

## Issue Tracking Summary

| Wave | Issues | Parallel? | Blocking |
|------|--------|-----------|----------|
| 0 | 3 | Yes | None |
| 1 | 4 | Partial | Wave 0 |
| 2 | 5 | Yes | Wave 1 |
| 3 | 6+ | Partial | Wave 0 |
| 4 | 3 | No | Wave 2 |
| 5 | 4 | Yes | Wave 2 |
| 6 | 4 | Yes | Wave 4 |

**Total**: ~29 issues (excluding strict TS sub-issues)

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Test count | 490 | 600+ | `vitest --reporter=verbose \| grep -c '✓'` |
| Coverage | Unknown | 80%+ | `vitest --coverage` |
| TypeScript errors | 0 (non-strict) | 0 (strict) | `pnpm typecheck` |
| `any` usage | 58 | <10 | `grep -r ': any' --include='*.ts'` |
| DOCore lines | 2831 | <600 | `wc -l core/DOCore.ts` |
| Security issues | 2 critical | 0 | Manual audit |
| Build time | Unknown | <60s | `time pnpm build` |

---

## Next Steps

1. Create beads issues for each RED/GREEN/REFACTOR task
2. Set up dependencies between waves
3. Begin Wave 0 immediately (no blockers)
4. Parallel work on Wave 1 security and Wave 3 type safety (both only depend on Wave 0)
