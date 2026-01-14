# TypeScript Compilation Errors Catalog

**Date:** 2026-01-13
**Total Errors:** 1,391
**Unique Files with Errors:** 216

---

## Summary by Error Category

| Category | Error Code | Count | Description |
|----------|------------|-------|-------------|
| Possibly Undefined | TS18048 | 262 | `'X' is possibly 'undefined'` |
| Object Possibly Undefined | TS2532 | 260 | `Object is possibly 'undefined'` |
| Type Mismatches | TS2345 | 227 | Argument type not assignable to parameter |
| Type Assignment | TS2322 | 186 | Type not assignable to type |
| Type Conversions | TS2352 | 98 | Conversion may be a mistake |
| Index Type Issues | TS2538 | 63 | Type cannot be used as index type |
| Missing Properties | TS2339 | 30 | Property does not exist on type |
| Unreachable Code | TS2484 | 28 | Unreachable code detected |
| Undefined Identifiers | TS2304 | 22 | Cannot find name 'X' |
| Implicit Any | TS7006 | 17 | Parameter implicitly has 'any' type |
| Missing Modules | TS2307 | 13 | Cannot find module 'X' |
| Missing Exports | TS2305 | 13 | Module has no exported member |
| Binding Implicit Any | TS7031 | 12 | Binding element implicitly has 'any' |
| Duplicate Identifiers | TS2300 | 12 | Duplicate identifier |
| Unknown Type | TS18046 | 12 | 'X' is of type 'unknown' |
| Wrong Export Name | TS2724 | 10 | No exported member named 'X' |
| Wrong Argument Count | TS2554 | 10 | Expected N arguments, got M |
| Other | Various | 147 | Various other errors |

---

## Files with Most Errors (Top 20)

| File | Error Count |
|------|-------------|
| `db/primitives/accounting/reconciliation.ts` | 58 |
| `db/primitives/media-pipeline/index.ts` | 45 |
| `db/primitives/feature-flags/statistics.ts` | 42 |
| `compat/slack/slack.ts` | 42 |
| `db/primitives/semantic-layer/schema-import.ts` | 40 |
| `db/primitives/media-pipeline/image-transformer.ts` | 40 |
| `db/primitives/business-event-store/process-mining.ts` | 27 |
| `db/primitives/connector-framework/schema-mapper.ts` | 25 |
| `compat/slack/slash-commands.ts` | 24 |
| `db/primitives/sync-engine.ts` | 23 |
| `db/primitives/semantic-layer/pre-aggregation.ts` | 22 |
| `compat/stripe/stripe.ts` | 22 |
| `db/primitives/payments/index.ts` | 21 |
| `lib/benchmarks/network-simulator.ts` | 20 |
| `agents/named/factory.ts` | 20 |
| `db/primitives/semantic-layer/sql-generator.ts` | 18 |
| `auth/config.ts` | 18 |
| `db/primitives/payments/usage-metering.ts` | 16 |
| `db/primitives/payments/usage-meter.ts` | 16 |
| `db/primitives/notifications/template-engine.ts` | 16 |

---

## Priority 1: Missing Modules/Exports (Blocking)

These errors prevent compilation and indicate missing dependencies or broken exports.

### Missing Modules (TS2307)

| File | Line | Missing Module |
|------|------|----------------|
| `agents/named/factory.ts` | 906 | `@anthropic-ai/sdk` |
| `agents/named/factory.ts` | 929 | `openai` |
| `db/edgevec/index.ts` | 42 | `./EdgeVecDO` |
| `db/primitives/connector-framework/sources/index.ts` | 21 | `./api` |
| `db/primitives/connector-framework/sources/index.ts` | 32 | `./database` |
| `db/primitives/connector-framework/sources/index.ts` | 45 | `./file` |
| `db/primitives/connector-framework/sources/index.ts` | 57 | `./event` |
| `db/primitives/graph/index.ts` | 65 | `./property-graph` |
| `db/primitives/graph/index.ts` | 77 | `./cypher-engine` |
| `db/primitives/graph/index.ts` | 89 | `./traversal-engine` |
| `db/primitives/graph/index.ts` | 100 | `./analytics-engine` |
| `db/primitives/graph/index.ts` | 108 | `./streaming` |
| `primitives/bashx/src/do/commands/system-utils.ts` | 16 | `@dotdo/path-utils` |

### Missing Exports (TS2305)

| File | Line | Missing Export |
|------|------|----------------|
| `db/primitives/audit-log/index.ts` | 122 | `createAuditQueryEngine` from `./query` |
| `db/primitives/audit-log/index.ts` | 124 | `AuditQueryEngine` from `./query` |
| `db/primitives/audit-log/index.ts` | 129-139 | Multiple query types from `./query` |
| `db/primitives/dag-scheduler/index.ts` | 2029-2034 | `PercentileResult`, `MetricsSnapshot`, `Observer` from `./observability` |
| `workflows/data/index.ts` | 69 | `StreamItem` from `./stream` |

### Wrong Export Names (TS2724)

| File | Line | Wrong Name | Suggested Name |
|------|------|------------|----------------|
| `db/graph/index.ts` | 458 | `MCPToolDiscoveryService` | `ToolDiscoveryService` |
| `db/graph/workflows/workflow-core-bridge.ts` | 27 | `WorkflowInstanceThing` | `getWorkflowInstance` |
| `db/graph/workflows/workflow-core-bridge.ts` | 33 | `StepExecutionState` | `StepExecutionStore` |
| `db/primitives/audit-log/index.ts` | 148 | `createAuditExporter` | `createAuditLogExporter` |
| `db/primitives/audit-log/index.ts` | 150 | `AuditExporter` | `AuditLogExporter` |
| `db/primitives/audit-log/index.ts` | 156 | `CsvExportResult` | `JsonExportResult` |
| `db/primitives/sync/index.ts` | 129 | `RetryBatchResult` | `RetryResult` |
| `lib/human/channel-factory.ts` | 27 | `HumanNotificationChannel` | `NotificationChannel` |
| `objects/Human.ts` | 190-191 | `HumanNotificationChannel`, `NotificationPayload` | `NotificationChannel`, `buildNotificationPayload` |

---

## Priority 2: Undefined Identifiers (TS2304)

These indicate missing type definitions or imports.

| File | Line | Missing Name |
|------|------|--------------|
| `db/edgevec/VectorIndex.ts` | 426 | `EdgeVecEnv` |
| `db/primitives/media-pipeline/index.ts` | 360, 361, 1249, 1258 | `TransformOptions`, `TransformResult` |
| `db/primitives/payments/index.ts` | 134-346 | `BillingAddress`, `AccountHolderType`, `BankAccountType`, `WalletType`, `CardBrand` |
| `db/primitives/payments/subscription.ts` | 664 | `addIntervalUTC` |
| `workflows/context/shard.ts` | 173, 194 | `DurableObjectConnectOptions`, `DurableObjectNewUniqueIdOptions` |

---

## Priority 3: Type Mismatches (High Volume)

### TS2345: Argument Type Not Assignable (227 errors)

Most common patterns:

1. **`string | undefined` not assignable to `string`** (Very common)
   - `agents/memory-graph.ts`: lines 217, 331, 332, 333
   - `compat/sendgrid/templates.ts`: line 478
   - `compat/slack/bot.ts`: lines 1061, 1066
   - `compat/stripe/resources/payments.ts`: line 426
   - `compat/stripe/resources/webhooks.ts`: lines 340, 341

2. **Type with index signature issues**
   - `compat/stripe/stripe.ts`: ~22 occurrences of params not assignable to `Record<string, unknown>`
   - `compat/slack/slack.ts`: ~20+ occurrences of arguments not assignable

3. **Block type mismatches (Slack)**
   - `compat/slack/app-home.ts`: 10 errors with Block types between `blocks.ts` and `types.ts`

### TS2322: Type Not Assignable (186 errors)

Common patterns:

1. **Return type mismatches**
   - `agents/named/factory.ts`: `PipelinePromise<string | AgentResultWithTools>` vs `PipelinePromise<string>`
   - `agents/typed-result.ts`: meta type incompatibilities

2. **Property type mismatches**
   - `auth/adapters/graph.ts`: `UserData`, `SessionData`, `AccountData` not assignable to `Record<string, unknown>`

---

## Priority 4: Null/Undefined Safety (522 errors combined)

### TS18048: Possibly Undefined (262 errors)
### TS2532: Object Possibly Undefined (260 errors)

**Hotspot files:**
- `db/primitives/media-pipeline/image-transformer.ts`: 40 errors
- `db/primitives/feature-flags/statistics.ts`: 42 errors
- `db/primitives/accounting/reconciliation.ts`: 58 errors
- `compat/sendgrid/contacts.ts`: 10 errors
- `compat/sendgrid/templates.ts`: 11 errors

---

## Priority 5: Implicit Any (29 errors)

### TS7006: Parameter Implicitly Has Any (17 errors)

| File | Line | Parameter |
|------|------|-----------|
| `agents/named/factory.ts` | 921, 922 | `b` |
| `auth/config.ts` | 550, 710 | `t` |
| `compat/slack/bot.ts` | 1203, 1220, 1225 | `event`, `error`, `message` |
| `db/edgevec/VectorIndex.ts` | 1050, 1051 | `o`, `a` |

### TS7031: Binding Element Implicitly Has Any (12 errors)

| File | Line | Element |
|------|------|---------|
| `auth/config.ts` | 191, 408 | `callbackURL` |
| `auth/config.ts` | 215, 432 | `organization` |
| `auth/config.ts` | 274, 480 | `user`, `session`, `state` |
| `auth/config.ts` | 550, 710 | `eq` |

---

## Priority 6: Type Conversion Issues (TS2352: 98 errors)

Common pattern: Conversion between `Record<string, unknown>` and typed interfaces.

**Affected files:**
- `compat/slack/slack.ts`: 20+ chat/conversation argument conversions
- `db/compat/graph/src/tool-permissions.ts`: Permission type conversions
- `auth/adapters/graph.ts`: UserData type conversions

---

## Priority 7: Interface Compatibility (12 errors)

### TS2300: Duplicate Identifiers

Found in various files with conflicting type declarations.

### TS2430: Interface Incorrectly Extends

| File | Line | Issue |
|------|------|-------|
| `compat/slack/types.ts` | 790 | `ChannelCreatedEvent` extends `SlackEvent` with incompatible `channel` property |

---

## Error Categories Summary

### Category 1: Type Mismatches (511 errors)
- TS2345 (227), TS2322 (186), TS2352 (98)
- **Fix:** Add proper type guards, optional chaining, or update type definitions

### Category 2: Null/Undefined Safety (522 errors)
- TS18048 (262), TS2532 (260)
- **Fix:** Add null checks, optional chaining (`?.`), nullish coalescing (`??`)

### Category 3: Missing Exports/Imports (36 errors)
- TS2307 (13), TS2305 (13), TS2724 (10)
- **Fix:** Create missing files, fix export names, add missing dependencies

### Category 4: Undefined Identifiers (22 errors)
- TS2304 (22)
- **Fix:** Import missing types or define missing types

### Category 5: Implicit Any (29 errors)
- TS7006 (17), TS7031 (12)
- **Fix:** Add explicit type annotations

### Category 6: Other (271 errors)
- Various structural and logic errors

---

## Recommended Fix Order

1. **Missing modules/exports** (36 errors) - These block other files from compiling
2. **Undefined identifiers** (22 errors) - Missing type definitions
3. **Implicit any** (29 errors) - Quick wins with type annotations
4. **Null/undefined safety** (522 errors) - Bulk fixable with optional chaining
5. **Type mismatches** (511 errors) - Requires careful type analysis
6. **Other structural issues** (271 errors) - Case-by-case fixes

---

## Files Requiring Immediate Attention

These files have the highest error density and may be blocking others:

1. `db/primitives/accounting/reconciliation.ts` (58 errors)
2. `db/primitives/media-pipeline/index.ts` (45 errors)
3. `db/primitives/feature-flags/statistics.ts` (42 errors)
4. `compat/slack/slack.ts` (42 errors)
5. `db/primitives/semantic-layer/schema-import.ts` (40 errors)
6. `db/primitives/media-pipeline/image-transformer.ts` (40 errors)
7. `db/primitives/connector-framework/sources/index.ts` (missing 4 modules)
8. `db/primitives/graph/index.ts` (missing 5 modules)
9. `db/primitives/audit-log/index.ts` (missing 9 exports)
10. `agents/named/factory.ts` (20 errors including missing SDK modules)
