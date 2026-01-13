# Silent Error Swallowing Violations

## Overview

This catalog documents locations in the codebase where errors are silently swallowed,
preventing proper error propagation and making debugging difficult.

**Total violations found: 97+** (Updated 2026-01-13)

**Status:** Issue dotdo-1qnd4 - In Progress

---

## Critical (P0) - Must fix immediately

These violations hide errors in core infrastructure that could cause data loss or corruption.

| # | File | Line | Pattern | Impact |
|---|------|------|---------|--------|
| 1 | `objects/StatelessDOState.ts` | 271-273 | `catch + console.warn` | Hides Iceberg load failures - data not loaded silently |
| 2 | `objects/StatelessDOState.ts` | 434-436 | `catch + console.error` | Hides Iceberg save failures - data loss |
| 3 | `db/compat/cache/redis/redis.ts` | 2794-2796 | `catch { // Ignore listener errors }` | Event handler errors silently ignored |
| 4 | `db/compat/baas/supabase/supabase.ts` | 508-515 | `catch -> return error object` | Converts exceptions to soft errors |
| 5 | `db/compat/clickhouse/client.ts` | 392-397 | `catch -> return success: false` | SQL errors become silent failures |
| 6 | `compat/shared/event-emitter.ts` | 231-233 | `catch + console.error` | Event handler errors logged but swallowed |
| 7 | `compat/shared/event-emitter.ts` | 312-313 | `catch + console.error` | Same pattern in different handler |
| 8 | `compat/shared/event-emitter.ts` | 322-323 | `catch + console.error` | Global handler errors swallowed |
| 9 | `compat/shared/event-emitter.ts` | 405-407 | `catch + console.error` | Listener errors silently ignored |
| 10 | `compat/shared/event-emitter.ts` | 416-417 | `catch + console.error` | Listener errors silently ignored |
| 11 | `workflows/compat/qstash/index.ts` | 1532 | `.catch(() => {})` | Delivery failures silently ignored |
| 12 | `workflows/compat/qstash/index.ts` | 1622 | `.catch(() => {})` | Delivery failures silently ignored |
| 13 | `workflows/compat/qstash/index.ts` | 1693 | `.catch(() => {})` | Delivery failures silently ignored |
| 14 | `workflows/compat/qstash/index.ts` | 1788 | `.catch(() => {})` | Delivery failures silently ignored |
| 15 | `compat/stripe/local.ts` | 153 | `.catch(() => {})` | Webhook event errors silently ignored |
| 16 | `compat/stripe/local.ts` | 156 | `.catch(() => {})` | Webhook delivery errors ignored |
| 17 | `compat/sentry/sentry.ts` | 685 | `.catch(() => {})` | Error reporting service itself swallows errors |
| 18 | `compat/sentry/client.ts` | 517 | `.catch(() => {})` | Transport errors for error reports ignored |

---

## High (P1) - Should fix soon

These violations hide errors in important business logic paths.

| # | File | Line | Pattern | Impact |
|---|------|------|---------|--------|
| 19 | `objects/CollectionLimits.ts` | 108-110 | `catch { return null }` | Collection limit parsing errors hidden |
| 20 | `objects/transport/auth-layer.ts` | 276-280 | `catch + console.warn` | JWT parse failures logged but auth continues |
| 21 | `objects/transport/auth-layer.ts` | 342-346 | `catch + console.warn` | JWT validation errors become auth failures |
| 22 | `objects/transport/auth-layer.ts` | 388-392 | `catch + console.warn` | Signature verification errors hidden |
| 23 | `objects/transport/auth-layer.ts` | 691-695 | `catch + console.warn` | Request signature errors hidden |
| 24 | `objects/transport/auth-layer.ts` | 848-852 | `catch + console.warn` | Bearer token parse errors hidden |
| 25 | `objects/transport/auth-layer.ts` | 940-944 | `catch + console.warn` | Token validation errors hidden |
| 26 | `objects/transport/auth-layer.ts` | 1298-1302 | `catch + console.debug` | Login token extraction errors hidden |
| 27 | `objects/transport/auth-layer.ts` | 1334-1339 | `catch + console.error` | Login handler errors become 500 |
| 28 | `objects/transport/auth-layer.ts` | 1386-1391 | `catch + console.error` | Refresh token handler errors become 500 |
| 29 | `objects/transport/auth-layer.ts` | 1617-1621 | `catch + console.debug` | RPC body parse errors silently ignored |
| 30 | `objects/transport/auth-layer.ts` | 1959-1962 | `catch { }` | Login failures become generic errors |
| 31 | `objects/transport/auth-layer.ts` | 1991 | `catch { }` | Refresh failures become generic errors |
| 32 | `compat/auth/clerk/sessions.ts` | 276-278 | `catch + console.error + no rethrow` | Session event handler errors swallowed |
| 33 | `compat/linear/webhooks.ts` | 295-297 | `catch + console.error + no rethrow` | Webhook delivery errors swallowed |
| 34 | `compat/gitlab/webhooks.ts` | 572-573 | `catch + console.error` | Webhook handler errors swallowed |
| 35 | `compat/gitlab/webhooks.ts` | 638-639 | `catch + console.error` | Webhook handler errors swallowed |
| 36 | `compat/github/webhooks.ts` | 561-562 | `catch + console.error` | Webhook handler errors swallowed |
| 37 | `compat/github/webhooks.ts` | 634-635 | `catch + console.error` | Webhook handler errors swallowed |
| 38 | `compat/slack/slash-commands.ts` | 759-760 | `catch + console.error` | Command handler errors swallowed |
| 39 | `compat/gcs/notifications.ts` | 430-431 | `catch + console.error` | Notification handler errors swallowed |
| 40 | `compat/hubspot/pipeline.ts` | 1440-1442 | `catch + console.error` | Automation callback errors swallowed |
| 41 | `compat/cubejs/client.ts` | 321-322 | `catch + console.error` | Subscription poll errors swallowed |
| 42 | `compat/couchdb/couchdb.ts` | 469-473 | `catch + console.warn` | Map function errors swallowed (by design?) |
| 43 | `compat/datadog/logs.ts` | 489, 499 | `.catch(() => {})` | Flush errors silently ignored |
| 44 | `compat/datadog/metrics.ts` | 439, 460 | `.catch(() => {})` | Flush errors silently ignored |
| 45 | `compat/datadog/tracing.ts` | 540 | `.catch(() => {})` | Flush errors silently ignored |
| 46 | `compat/amplitude/amplitude.ts` | 744, 760 | `.catch(() => {})` | Flush errors silently ignored |
| 47 | `compat/amplitude/amplitude.ts` | 787 | `.catch(() => {})` | Plugin execute errors ignored |
| 48 | `compat/mixpanel/mixpanel.ts` | 1502 | `.catch(() => {})` | Flush errors silently ignored |
| 49 | `compat/intercom/local.ts` | 1891, 1893 | `.catch(() => {})` | Router member operations ignored |
| 50 | `compat/linear/client.ts` | 276 | `.catch(() => {})` | Unknown operation errors ignored |
| 51 | `compat/auth/clerk/organizations.ts` | 572 | `.catch(() => {})` | Init defaults errors ignored |
| 52 | `config/compat/flags/flags-do.ts` | 691 | `.catch(() => {})` | Webhook delivery errors ignored |

---

## Medium (P2) - Nice to fix

These are less critical but still represent bad patterns.

| # | File | Line | Pattern | Impact |
|---|------|------|---------|--------|
| 53 | `llm/providers/ollama.ts` | 182-186 | `catch + console.warn` | JSON parse in stream, data dropped |
| 54 | `llm/providers/anthropic.ts` | 244-248 | `catch + console.warn` | SSE parse errors, events dropped |
| 55 | `llm/providers/openai.ts` | 119-123 | `catch + console.warn` | SSE parse errors, events dropped |
| 56 | `llm/providers/google.ts` | 242-246 | `catch + console.warn` | SSE parse errors, events dropped |
| 57 | `llm/routes/messages.ts` | 154-155 | `catch + console.error` | Messages endpoint errors |
| 58 | `snippets/search.ts` | 654-656 | `catch { // fall through }` | Cache API errors hidden |
| 59 | `snippets/search.ts` | 734-736 | `catch { // Ignore cache put }` | Cache put errors hidden |
| 60 | `snippets/search.ts` | 984-986 | `catch { return undefined }` | Parse errors become undefined |
| 61 | `snippets/artifacts-serve.ts` | 340-342 | `catch { return null }` | Parse errors become null |
| 62 | `snippets/artifacts-serve.ts` | 604-606 | `catch { // Ignore }` | Revalidation errors hidden |
| 63 | `snippets/artifacts-serve.ts` | 840 | `waitUntil(.catch(() => {}))` | Background errors ignored |
| 64 | `agents/tools/shell-tools.ts` | 96-98 | `catch { return files: [] }` | Find errors become empty results |
| 65 | `agents/tools/shell-tools.ts` | 145-148 | `catch { return files: [] }` | Grep errors become empty results |
| 66 | `lib/safe-stringify.ts` | 149-151 | `catch { return null }` | JSON parse errors become null (by design) |
| 67 | `lib/pagination/index.ts` | 180-182 | `catch { return null }` | Cursor decode errors become null (by design) |

---

## Patterns Identified

### Pattern 1: `.catch(() => {})` - Complete error suppression
**Locations:** 35 occurrences
**Fix:** Log errors or propagate them. Use `catch(e => { observability.error(e) })` at minimum.

### Pattern 2: `catch + console.error + no rethrow`
**Locations:** 18 occurrences
**Fix:** Add error event emission or rethrow wrapped errors.

### Pattern 3: `catch { return null/undefined }`
**Locations:** 8 occurrences
**Fix:** Return Result type `{ ok: false, error }` or throw.

### Pattern 4: `catch + console.warn + continue`
**Locations:** 6 occurrences
**Fix:** Either fail fast or add error accumulation and report.

---

## Recommendations

1. **Create `lib/errors/error-policy.ts`** with standard error handling patterns
2. **Introduce Result types** for operations that can fail gracefully
3. **Add error events** to observability layer instead of console.error
4. **Create lint rules** to catch `.catch(() => {})` pattern
5. **Add circuit breakers** for external service failures instead of silent swallowing

---

## Test Coverage Required

Priority tests needed:

1. `objects/StatelessDOState.ts` - Iceberg load/save error propagation
2. `db/compat/cache/redis/redis.ts` - Event handler errors bubble up
3. `compat/shared/event-emitter.ts` - Handler errors reported
4. `objects/transport/auth-layer.ts` - Auth errors with proper status codes
5. `workflows/compat/qstash/index.ts` - Delivery retry behavior on failures
6. `compat/stripe/local.ts` - Webhook failures cause retries
7. `compat/sentry/*` - Meta: error reporter doesn't swallow errors
8. `agents/tools/shell-tools.ts` - Tool errors propagated to agent
9. `llm/providers/*.ts` - Stream parse errors surface
10. `compat/datadog/*` - Flush failures trigger alerts

---

## Additional Patterns Found (2026-01-13)

### New `.catch(() => {})` locations in production code:

| # | File | Line | Pattern | Impact |
|---|------|------|---------|--------|
| 68 | `compat/calls/CallDO.ts` | 179, 715 | `catch { // WebSocket might be closed }` | WebSocket send errors invisible |
| 69 | `compat/supabase-auth/auth-client.ts` | 434, 473, 737 | `catch { // Ignore ... errors }` | Auth state errors invisible |
| 70 | `compat/cubejs/playground/server.ts` | 427 | `catch { this.wsClients.delete(client) }` | Client send failure only removes client |
| 71 | `compat/cubejs/cache.ts` | 1355, 1438, 1528, 1813, 1940, 1954 | `catch { // Invalid stored data }` | Cache corruption invisible |
| 72 | `compat/s3/backend.ts` | 320, 2104, 2128 | `catch { // Invalid token }` | Pagination silently resets |
| 73 | `compat/cohere/cohere.ts` | 100, 117 | `catch { // Skip malformed JSON }` | Streaming data silently dropped |
| 74 | `compat/firebase-auth/auth.ts` | 4 locations | Various empty catches | Auth flow errors hidden |
| 75 | `compat/segment/*.ts` | ~11 locations | Various empty catches | Analytics errors hidden |
| 76 | `compat/hubspot/*.ts` | ~12 locations | Various empty catches | CRM errors hidden |
| 77 | `compat/zapier/*.ts` | ~8 locations | Various empty catches | Automation errors hidden |
| 78 | `compat/n8n/trigger-engine-bridge.ts` | 3 locations | Empty catches | Workflow trigger errors hidden |

### Files with highest violation counts:

1. `snippets/search.ts` - 10 empty catches (cache/parsing fallbacks)
2. `snippets/artifacts-serve.ts` - 8 empty catches (cache/config fallbacks)
3. `compat/cubejs/cache.ts` - 6 empty catches (cache operations)
4. `compat/mixpanel/mixpanel.ts` - 6 empty catches (analytics flush)
5. `objects/transport/auth-layer.ts` - Updated with logging (was 13 empty)

### Pattern: setTimeout without error handling

```typescript
// Found in multiple files
setTimeout(executeDelivery, delayMs)  // No error handling for delayed execution
```

vs

```typescript
setTimeout(() => executeDelivery().catch(handleError), delayMs)  // Better
```

---

## Comprehensive Search Results (2026-01-13)

### Pattern 1: `.catch(() => {})` - Complete Error Suppression

**Total occurrences: 165 across 60 files**

#### Production Code Violations (Non-Test Files):

| File | Count | Critical? | Impact |
|------|-------|-----------|--------|
| `workflows/compat/qstash/index.ts` | 4 | P0 | Delivery failures invisible |
| `streaming/compat/nats/nats.ts` | 3 | P1 | Connection close errors hidden |
| `compat/stripe/local.ts` | 2 | P0 | Webhook errors swallowed |
| `compat/intercom/local.ts` | 2 | P1 | Router member ops ignored |
| `objects/persistence/tiered-storage-manager.ts` | 2 | P1 | Storage delete errors hidden |
| `objects/Browser.ts` | 2 | P2 | Screencast stop errors hidden |
| `lib/iterators/backpressure.ts` | 2 | P1 | Backpressure signaling lost |
| `primitives/compression-engine/index.ts` | 6 | P2 | Stream cancel/abort errors |
| `primitives/gitx/src/tiered/migration.ts` | 1 | P2 | Warm storage cleanup |
| `primitives/conversation/conversation.ts` | 1 | P2 | Timeout send errors |
| `compat/mixpanel/mixpanel.ts` | 1 | P1 | Analytics flush errors |
| `compat/linear/client.ts` | 1 | P1 | Unknown ops swallowed |
| `compat/auth/clerk/organizations.ts` | 1 | P1 | Init defaults errors |
| `snippets/artifacts-serve.ts` | 1 | P2 | Revalidation errors |
| `objects/lifecycle/Clone.ts` | 1 | P2 | Checkpoint cleanup |
| `objects/DOBase.ts` | 1 | P0 | Event emission errors |
| `db/primitives/feature-flags/conversion-tracker.ts` | 1 | P2 | Conversion tracking |
| `db/payload/auth/caching.ts` | 2 | P1 | Auth cache errors |
| `api/middleware/kv-session-cache.ts` | 1 | P1 | Session cache errors |

### Pattern 2: `catch { // comment }` - Empty Catch with Comment

**Total occurrences: 770+ files with catch blocks (many are proper handling)**

Most common problematic patterns:
- `catch { // Ignore ... }` - 50+ locations
- `catch { // Silent ... }` - 20+ locations
- `catch { // Fallback }` - 30+ locations (some intentional)

### Pattern 3: `catch + console.error/warn + no rethrow`

Found in 321 files with this multiline pattern. Key violators:
- `compat/shared/event-emitter.ts` - 5 locations
- `objects/transport/auth-layer.ts` - 12 locations
- `llm/providers/*.ts` - 4 locations (one per provider)
- `compat/*/webhooks.ts` - 8+ locations across webhook handlers

---

## Final Violation Count Summary

| Category | Count | Priority |
|----------|-------|----------|
| `.catch(() => {})` in production | 50+ | P0-P2 |
| `.catch(() => {})` in tests (acceptable) | 115 | N/A |
| `catch + console.error + no rethrow` | 25+ | P0-P1 |
| `catch { return null/undefined }` | 15+ | P1-P2 |
| `catch { // intentional comment }` | 30+ | P2 |
| **Total actionable violations** | **120+** | |

---

## Progress on Fixes

### Fixed (GREEN Phase - 2026-01-13):

1. **QStash Delivery Failures** - `workflows/compat/qstash/index.ts`
   - [x] Line 1548: _publishToTopic executeDelivery() - Added `_handleDeliveryFailure()`
   - [x] Line 1641: _publishToUrlGroup executeDelivery() - Added error tracking
   - [x] Line 1715: _publishToTopic (topic) executeDelivery() - Added error tracking
   - [x] Line 1813: publishToGroup executeDelivery() - Added error tracking
   - Added `delivery_failed` event type for event tracking

2. **Stripe Webhook Errors** - `compat/stripe/local.ts`
   - [x] Line 153: onWebhookEvent handler - Added `onWebhookError` callback
   - [x] Line 156: deliverEvents() - Added error logging and callback
   - Added `onWebhookError` config option for error handling

3. **Event Emitter Error Propagation** - `compat/shared/event-emitter.ts`
   - [x] TypedEventEmitter._emit - Errors now emitted to 'error' listeners
   - [x] PusherEventEmitter._emit - Errors now emitted to 'error' listeners
   - [x] SocketIOEventEmitter._emit - Errors now handled for anyListeners
   - All emitters now have `_emitError()` helper with console.error fallback

4. **Sentry Transport Errors** - `compat/sentry/sentry.ts`
   - [x] Line 685: transport.send() - Added `onTransportError` callback
   - Added console.error when debug mode enabled as fallback

5. **Datadog Flush Errors** - `compat/datadog/*.ts`
   - [x] `logs.ts` - Added `_handleFlushError()` method with callback support
   - [x] `metrics.ts` - Added `_handleFlushError()` method with callback support
   - [x] `tracing.ts` - Added `_handleFlushError()` method with callback support
   - Added `onFlushError` config option to `DatadogConfig` and `TracerOptions`

### Previously Fixed:
- [x] `objects/transport/auth-layer.ts` - JWT validation now logs warnings
- [x] `streaming/event-stream-do.ts` - WebSocket safeSend now tracks metrics

### Still Needs Work:
- [ ] `objects/DOBase.ts` - Event emission errors swallowed
- [ ] `primitives/compression-engine/index.ts` - 6 empty catches
- [ ] `streaming/compat/nats/nats.ts` - Connection close errors
- [ ] `db/payload/auth/caching.ts` - Auth cache errors

---

## Test Coverage Status

### Tests Written (RED Phase):
1. `/lib/errors/tests/error-propagation.test.ts` - 10 test cases
2. `/tests/error-handling/empty-catches.test.ts` - 12 test cases
3. `/tests/reliability/promise-error-handling.test.ts` - 15 test cases
4. `/lib/errors/tests/store-integration.test.ts` - 40+ test cases

### Test Results:
- 10+ tests FAILING (expected in RED phase)
- Tests document violations with specific file/line references
- Tests verify error swallowing behavior

---

## Recommended Next Steps (GREEN Phase)

1. **Priority 1 - Auth/Security:**
   - Fix `objects/transport/auth-layer.ts` catch blocks
   - Add proper error events for auth failures

2. **Priority 2 - Data Pipelines:**
   - Fix `workflows/compat/qstash/index.ts` delivery tracking
   - Fix `compat/stripe/local.ts` webhook error handling
   - Fix `objects/DOBase.ts` event emission error handling

3. **Priority 3 - Observability:**
   - Fix `compat/sentry/*.ts` (ironic: error reporter swallowing errors)
   - Fix `compat/datadog/*.ts` flush error handling

4. **Priority 4 - Infrastructure:**
   - Fix `primitives/compression-engine/index.ts` stream errors
   - Fix `streaming/compat/nats/nats.ts` connection errors

