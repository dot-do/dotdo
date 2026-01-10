# Workflow Compat Layers - Feature Parity Matrix

This document tracks feature parity between dotdo compat layers and the original vendor SDKs.

## Summary

| Platform | Parity | Status |
|----------|--------|--------|
| QStash | ~80% | Beta |
| Inngest | ~85% | Beta |
| Trigger.dev | ~70% | Alpha |
| Temporal | ~75% | Alpha |

## QStash (@dotdo/qstash)

| Feature | Status | Notes |
|---------|--------|-------|
| `publish()` | ✅ | Full support |
| `publishJSON()` | ✅ | Full support |
| `batch()` | ✅ | Full support |
| Schedules | ✅ | Cron expressions |
| Deduplication | ✅ | ID and content-based |
| URL Groups | ✅ | Fan-out delivery |
| DLQ | ✅ | Dead letter queue |
| Topics | ✅ | Pub/sub |
| Events API | ✅ | Audit trail |
| Signature Verification | ✅ | Receiver class |
| getMessage() | ❌ | Not implemented |
| API Endpoints | ❌ | Not implemented |

## Inngest (@dotdo/inngest)

| Feature | Status | Notes |
|---------|--------|-------|
| Function creation | ✅ | Full support |
| Event triggers | ✅ | Full support |
| step.run() | ✅ | Memoization + replay |
| step.sleep() | ✅ | Durable waits |
| step.waitForEvent() | ✅ | Event subscription |
| step.invoke() | ✅ | Child functions |
| step.parallel() | ✅ | Concurrent execution |
| Retry policies | ✅ | Full support |
| Throttling | ✅ | Rate limiting |
| Concurrency | ✅ | Limits |
| Batching | ✅ | Event batching |
| Middleware | ✅ | Lifecycle hooks |
| Cancellation | ✅ | On events |
| step.ai.infer() | ❌ | Not implemented |
| step.ai.wrap() | ❌ | Not implemented |

## Trigger.dev (@dotdo/trigger)

| Feature | Status | Notes |
|---------|--------|-------|
| task() | ✅ | Task definition |
| trigger() | ✅ | Fire-and-forget |
| triggerAndWait() | ✅ | Blocking execution |
| Batch operations | ✅ | Bulk triggers |
| Retry configs | ✅ | Presets available |
| wait.for/until | ✅ | Durable waits |
| Queue configuration | ⚠️ | Parsed but not enforced |
| Middleware | ✅ | Lifecycle hooks |
| Machine presets | ❌ | Ignored |
| Task metrics | ❌ | Not implemented |
| Scheduled tasks | ❌ | Not integrated |

## Temporal (@dotdo/temporal)

| Feature | Status | Notes |
|---------|--------|-------|
| Workflow definitions | ✅ | Full support |
| Activities | ⚠️ | Proxy works, no workers |
| Signals | ✅ | Full support |
| Queries | ✅ | Full support |
| Updates | ✅ | Full support |
| Child workflows | ✅ | start + execute |
| Cancellation scopes | ✅ | Full support |
| Sleep/condition | ✅ | Full support |
| WorkflowClient | ✅ | Core methods |
| Search attributes | ✅ | Set/upsert |
| Timer coalescing | ✅ | Optimization |
| Continue-as-new | ✅ | Full support |
| Cron schedules | ✅ | Full support |
| Activity workers | ❌ | Stubs only |
| Determinism enforcement | ❌ | Not enforced |
| Saga patterns | ❌ | Not implemented |
