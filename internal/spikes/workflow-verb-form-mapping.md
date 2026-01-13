# SPIKE: Workflow State Machine Verb Form Mapping

**Status:** Complete
**Date:** 2026-01-13
**Author:** Spike Analysis

## Summary

This spike analyzes how the existing workflow state machine maps to the verb form state encoding system defined in `db/graph/verb-forms.ts`. The key insight is that **verb form IS the state**—no separate status column is needed when using the graph-based encoding.

## Analyzed Components

### 1. WorkflowRuntime Status States

**Location:** `objects/WorkflowRuntime.ts`

The `WorkflowRuntime` class manages workflow execution with the following status states:

| Status | Description | When Set |
|--------|-------------|----------|
| `pending` | Workflow registered but not started | Initial state, before `start()` called |
| `running` | Workflow actively executing steps | After `start()`, during step execution |
| `paused` | Workflow waiting for external event or explicitly paused | `waitForEvent()` or `pause()` called |
| `completed` | Workflow finished successfully | All steps completed, no errors |
| `failed` | Workflow terminated due to error | Unhandled error during step execution |

### 2. Step Status States

**Location:** `objects/WorkflowRuntime.ts` (StepExecutionResult interface)

Step execution uses these status values:

| Status | Description |
|--------|-------------|
| `pending` | Step registered, not yet executed |
| `running` | Step currently executing |
| `completed` | Step finished successfully |
| `failed` | Step threw an error (after retries exhausted) |
| `skipped` | Step was bypassed (not currently used) |

### 3. WaitForEventManager Status States

**Location:** `workflows/WaitForEventManager.ts`

The `PendingWait` interface uses these status values:

| Status | Description |
|--------|-------------|
| `pending` | Wait is active, awaiting event delivery |
| `resolved` | Event was delivered successfully |
| `cancelled` | Wait was explicitly cancelled |
| `timeout` | Wait exceeded timeout threshold |

### 4. Schedule Status States

**Location:** `workflows/ScheduleManager.ts`

Schedules use a simpler binary status:

| Status | Description |
|--------|-------------|
| `active` | Schedule is enabled and will trigger |
| `paused` | Schedule is disabled |

## Existing Verb Form Integration

The `WorkflowRuntime` class already imports and uses the verb form system:

```typescript
import {
  type VerbFormEdge,
  getEdgeState,
  transitionEdge,
  VerbFormStateMachine,
} from '../db/graph/verb-forms'
```

### Current Implementation in WorkflowRuntime

The `WorkflowStateRelationship` interface extends `VerbFormEdge`:

```typescript
interface WorkflowStateRelationship extends VerbFormEdge {
  verb: 'start' | 'starting' | 'started' |
        'pause' | 'pausing' | 'paused' |
        'resume' | 'resuming' | 'resumed' |
        'fail' | 'failing' | 'failed'
}
```

### Current Mapping Function

```typescript
function getWorkflowStateFromEdge(edge: WorkflowStateRelationship | null): WorkflowRuntimeState {
  if (!edge) return 'pending'

  const verb = edge.verb

  // Start/Resume family
  if (verb === 'start' || verb === 'resume') return 'pending'
  if (verb === 'starting' || verb === 'resuming') return 'running'
  if (verb === 'started' || verb === 'resumed') return 'completed'

  // Pause family
  if (verb === 'pause' || verb === 'pausing') return 'running'
  if (verb === 'paused') return 'paused'

  // Fail family
  if (verb === 'fail' || verb === 'failing') return 'running'
  if (verb === 'failed') return 'failed'

  // Fallback to generic edge state
  return getEdgeState(edge) // 'pending' | 'in_progress' | 'completed'
}
```

## Verb Form Mapping Analysis

### Verb Form Types (from `db/graph/verb-forms.ts`)

| Form Type | Suffix | State Meaning | Edge `to` Field |
|-----------|--------|---------------|-----------------|
| **action** | base verb | Intent/pending | Optional (what will be affected) |
| **activity** | -ing | In-progress | `null` (work in progress) |
| **event** | -ed/-en | Completed | Result URL (the outcome) |

### Workflow-Specific Verb Mappings

#### Start Verb Family

| Verb Form | Form Type | Workflow State | Description |
|-----------|-----------|----------------|-------------|
| `start` | action | `pending` | Intent to start workflow |
| `starting` | activity | `running` | Workflow is executing |
| `started` | event | `completed` | Workflow finished successfully |

#### Pause Verb Family

| Verb Form | Form Type | Workflow State | Description |
|-----------|-----------|----------------|-------------|
| `pause` | action | (transition) | Intent to pause |
| `pausing` | activity | `running` | In process of pausing |
| `paused` | event | `paused` | Workflow is paused |

#### Resume Verb Family

| Verb Form | Form Type | Workflow State | Description |
|-----------|-----------|----------------|-------------|
| `resume` | action | `paused` | Intent to resume |
| `resuming` | activity | `running` | Workflow resuming execution |
| `resumed` | event | `completed` | Resume completed (workflow finished) |

#### Fail Verb Family

| Verb Form | Form Type | Workflow State | Description |
|-----------|-----------|----------------|-------------|
| `fail` | action | (transition) | Intent/imminent failure |
| `failing` | activity | `running` | Failure in progress |
| `failed` | event | `failed` | Workflow has failed |

#### Complete Verb Family (proposed addition)

| Verb Form | Form Type | Workflow State | Description |
|-----------|-----------|----------------|-------------|
| `complete` | action | `running` | Intent to complete |
| `completing` | activity | `running` | Finalizing |
| `completed` | event | `completed` | Successfully done |

### Step-Level Verb Mappings

For step execution, the same pattern applies:

| Verb Form | Step Status |
|-----------|-------------|
| `execute` | `pending` |
| `executing` | `running` |
| `executed` | `completed` |
| `skip` | `pending` (intent to skip) |
| `skipping` | `running` (evaluating skip) |
| `skipped` | `skipped` |

### Wait Event Verb Mappings

For `WaitForEventManager`:

| Verb Form | Wait Status |
|-----------|-------------|
| `wait` | `pending` |
| `waiting` | `pending` (active wait) |
| `waited` | `resolved` |
| `cancel` | (action) |
| `cancelling` | (transition) |
| `cancelled` | `cancelled` |
| `timeout` | (action - timer fired) |
| `timedout` | `timeout` |

## State Transitions

### Valid State Machine Transitions

```
                    +--> pausing --> paused
                    |                   |
pending --> starting --> started       |
    ^         |                         |
    |         +--> failing --> failed   |
    |                                   |
    +------- resuming <-----------------+
```

### Transition Rules from `db/graph/verb-forms.ts`

```typescript
const VALID_TRANSITIONS: Record<VerbFormType, Record<string, VerbFormType>> = {
  action: {
    start: 'activity',    // action -> activity (begin work)
    complete: 'event',    // action -> event (immediate completion)
  },
  activity: {
    complete: 'event',    // activity -> event (finish work)
    cancel: 'action',     // activity -> action (cancel, return to pending)
  },
  event: {
    // Events are final - no valid transitions out
  },
}
```

## Key Findings

### 1. Dual State Storage

The current implementation maintains both:
- Legacy `_state: WorkflowRuntimeState` field
- Graph-based `_stateRelationship: WorkflowStateRelationship | null`

This provides backwards compatibility while enabling migration.

### 2. Persistence Format

The `PersistedWorkflowState` interface stores both:
```typescript
interface PersistedWorkflowState {
  status: WorkflowRuntimeState          // Legacy (deprecated)
  stateVerb?: string                    // Graph-based
  stateVerbTo?: string | null           // Result reference
  // ... other fields
}
```

### 3. Migration Helper

`migrateStatusToVerb()` converts legacy status to verb form:

```typescript
switch (status) {
  case 'pending':   -> null (no relationship)
  case 'running':   -> 'starting'
  case 'paused':    -> 'paused'
  case 'completed': -> 'started' + result URL
  case 'failed':    -> 'failed' + error URL
}
```

### 4. Missing Verb Families

The current implementation doesn't include:
- `complete/completing/completed` verb family (uses `started` instead)
- `wait/waiting/waited` for event waits
- Step-level verb forms (still uses string status)

### 5. `to` Field Semantics

The graph edge `to` field encodes:
- `null` during activity (work in progress)
- Result URL when completed: `workflow:{instanceId}:result`
- Error URL when failed: `workflow:{instanceId}:error`

## Recommendations

### Short-term (Migration Phase)

1. **Keep dual state storage** until all consumers migrate
2. **Use `stateVerb` as source of truth** when available
3. **Deprecation warnings** for direct `_state` access

### Medium-term (Unification Phase)

1. **Add step-level verb forms** for consistent state encoding
2. **Add `complete` verb family** for explicit completion (vs implicit via `started`)
3. **Migrate WaitForEventManager** to use verb forms
4. **Extend VerbFormStateMachine** with workflow-specific verbs

### Long-term (Graph-Native Phase)

1. **Remove legacy `status` field** from persistence
2. **Query workflows by verb form** instead of status enum
3. **Enable cross-workflow analysis** via relationship queries
4. **Audit trail via verb form history**

## Proposed API Changes

### Step Registration with Verb Forms

```typescript
// Current
registerStep(name: string, handler: (ctx: StepContext) => Promise<unknown>)

// Proposed: verb form encoded in registration
registerStep('process-payment', handler)  // -> 'process' verb family
// Automatic: process -> processing -> processed
```

### Workflow Query by Verb Form

```typescript
// Query all running workflows
const running = await queryByVerbFormState(edges, 'in_progress')

// Query all workflows that have been paused
const paused = edges.filter(e => e.verb === 'paused')

// Query all failed workflows
const failed = edges.filter(e => e.verb === 'failed')
```

### Event-Based State Changes

```typescript
// Current
await workflow.pause()
this._state = 'paused'

// Proposed: verb form transition
this.setStateVerb('pause')           // Action: intent to pause
this.transitionState('start')        // Activity: pause -> pausing
this.transitionState('complete')     // Event: pausing -> paused
```

## Related Files

- `objects/WorkflowRuntime.ts` - Main workflow runtime with verb form integration
- `db/graph/verb-forms.ts` - Core verb form system
- `workflows/core/graph-runtime-state.ts` - Graph-based state storage
- `workflows/WaitForEventManager.ts` - Event wait management
- `workflows/ScheduleManager.ts` - Cron scheduling
- `workflows/runtime.ts` - Step persistence and replay

## Conclusion

The existing codebase has already begun integrating verb form state encoding into `WorkflowRuntime`. The implementation follows the correct pattern:

1. **Verb form encodes state** - no separate status enum needed in graph
2. **`to` field encodes result** - null during activity, URL when complete
3. **Backwards compatibility** maintained via dual storage

The next steps should focus on:
1. Extending verb forms to step-level and wait-event state
2. Removing legacy status fields after migration period
3. Enabling graph queries based on verb form patterns
