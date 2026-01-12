---
title: "Review TDD Issues Design"
description: Documentation for plans
---

# Review TDD Issues Design

**Date:** 2026-01-10
**Epic:** dotdo-xyj02 (Comprehensive Review TDD Issues)

## Summary

This design documents the TDD approach for addressing critical and major issues identified in the comprehensive 4-way code review.

## Issue Breakdown

### 1. Session Persistence (CRITICAL)

**Bug:** Users lose session on page refresh because the `sessions` Map is in-memory only.

| ID | Phase | Title | Priority |
|----|-------|-------|----------|
| dotdo-34nmb | RED | Tests for session survival across page refresh | P0 |
| dotdo-z3uaa | GREEN | Implement session hydration from localStorage | P0 |
| dotdo-tv8gy | REFACTOR | Extract SessionStore interface | P1 |

**Root Cause:**
- `app/src/admin/auth.ts:75` - `sessions` Map is module-scoped (cleared on refresh)
- `app/src/admin/auth.ts:158` - `getCurrentSession()` validates against empty Map
- localStorage has the token but validation fails

**Fix Approach:**
1. RED: Write tests that clear sessions Map, verify getCurrentSession still works
2. GREEN: Hydrate Map from localStorage on access, or make validateSession check localStorage
3. REFACTOR: Create SessionStore interface for pluggable backends (localStorage → DO → KV)

---

### 2. Error Sanitization (CRITICAL)

**Bug:** `error.message` displayed raw in production could leak sensitive information.

| ID | Phase | Title | Priority |
|----|-------|-------|----------|
| dotdo-cvxzt | RED | Tests for production error message filtering | P0 |
| dotdo-bx3hc | GREEN | Implement sanitizeErrorMessage() | P0 |
| dotdo-z7lxa | REFACTOR | Create error classification system | P1 |

**Risk:** Sensitive data in error messages:
- Database connection strings: `postgres://user:pass@db.internal/app`
- File paths: `/Users/nathan/projects/dotdo/secrets/config.ts`
- API keys: `sk-ant-api03-xxxxx`

**Fix Approach:**
1. RED: Tests verifying production shows generic message, dev shows details
2. GREEN: Create sanitizeErrorMessage() with pattern filtering
3. REFACTOR: Classify errors by type with user-friendly messages

---

### 3. Mock Location (MAJOR)

**Bug:** Mocks in `app/__mocks__/` violate convention (should be in `tests/mocks/`).

| ID | Phase | Title | Priority |
|----|-------|-------|----------|
| dotdo-rvzmu | RED | Tests verifying mocks are in tests/mocks/ | P2 |
| dotdo-5b2q2 | GREEN | Move mocks from app/__mocks__/ | P2 |
| dotdo-5jlzb | REFACTOR | Add ESLint rule to prevent mocks in app/ | P2 |

**Files to Move:**
- `app/__mocks__/approval.ts` → `tests/mocks/approval.ts`
- `app/__mocks__/user.ts` → `tests/mocks/user.ts`

---

### 4. Named Agents (VISION GAP)

**Gap:** The iconic named agents feature from the vision isn't implemented.

| ID | Phase | Title | Priority |
|----|-------|-------|----------|
| dotdo-t1t43 | RED | Tests for template literal interface | P0 |
| dotdo-kp869 | GREEN | Implement template tag factory | P0 |
| dotdo-xaidb | REFACTOR | Extract persona system with composition | P1 |

**Vision:**
```typescript
import { priya, ralph, tom } from 'agents.do'
const spec = priya`define the MVP for ${hypothesis}`
let app = ralph`build ${spec}`
```

---

## Dependency Graph

```
Session Persistence:
  dotdo-34nmb (RED) ──blocks──> dotdo-z3uaa (GREEN) ──blocks──> dotdo-tv8gy (REFACTOR)

Error Sanitization:
  dotdo-cvxzt (RED) ──blocks──> dotdo-bx3hc (GREEN) ──blocks──> dotdo-z7lxa (REFACTOR)

Mock Location:
  dotdo-rvzmu (RED) ──blocks──> dotdo-5b2q2 (GREEN) ──blocks──> dotdo-5jlzb (REFACTOR)

Named Agents:
  dotdo-t1t43 (RED) ──blocks──> dotdo-kp869 (GREEN) ──blocks──> dotdo-xaidb (REFACTOR)

All issues are children of epic dotdo-xyj02
```

## Ready to Work

Start with the RED phase issues (tests first):
- `dotdo-34nmb` - Session persistence tests
- `dotdo-cvxzt` - Error sanitization tests
- `dotdo-rvzmu` - Mock location tests
- `dotdo-t1t43` - Named agents tests

## Implementation Order

1. **Session Persistence** (P0, Critical) - Security blocker
2. **Error Sanitization** (P0, Critical) - Security blocker
3. **Named Agents** (P0, Vision) - Demo-able feature
4. **Mock Location** (P2, Convention) - Cleanup
