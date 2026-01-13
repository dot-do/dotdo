# [SPIKE] Verb Form State Mapping Analysis

> beads issue: dotdo-fnrnn
> Parent epic: dotdo-ywyc4 (Workflows as Graph Things)

## Executive Summary

This spike analyzes the existing workflow state machine implementations and documents how they can be unified with verb form state encoding. The key insight: **verb form IS the state** - no separate status column is needed.

## Current State Machines

### 1. WorkflowRuntime (`objects/WorkflowRuntime.ts`)

**Legacy Status Column:**
```typescript
type WorkflowRuntimeState = 'pending' | 'running' | 'paused' | 'completed' | 'failed'
```

**Already Migrated to Verb Forms:**
The `WorkflowRuntime` has been partially refactored to use verb form state encoding:

```typescript
interface WorkflowStateRelationship extends VerbFormEdge {
  verb: 'start' | 'starting' | 'started' |
        'pause' | 'pausing' | 'paused' |
        'resume' | 'resuming' | 'resumed' |
        'fail' | 'failing' | 'failed'
}
```

**Mapping Function (already implemented):**
```typescript
function getWorkflowStateFromEdge(edge: WorkflowStateRelationship | null): WorkflowRuntimeState {
  if (!edge) return 'pending'

  if (verb === 'start' || verb === 'resume') return 'pending'
  if (verb === 'starting' || verb === 'resuming') return 'running'
  if (verb === 'started' || verb === 'resumed') return 'completed'
  if (verb === 'pause' || verb === 'pausing') return 'running'
  if (verb === 'paused') return 'paused'
  if (verb === 'fail' || verb === 'failing') return 'running'
  if (verb === 'failed') return 'failed'
}
```

### 2. StepExecutionResult (`objects/WorkflowRuntime.ts`)

**Legacy Status:**
```typescript
status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
```

**Verb Form Mapping:**
| Legacy Status | Action Form | Activity Form | Event Form |
|---------------|-------------|---------------|------------|
| pending | `execute` | - | - |
| running | - | `executing` | - |
| completed | - | - | `executed` |
| failed | - | - | `executed` (with error field) |
| skipped | `skip` | `skipping` | `skipped` |

### 3. WaitForEventManager (`workflows/WaitForEventManager.ts`)

**Legacy Status:**
```typescript
status: 'pending' | 'resolved' | 'cancelled' | 'timeout'
```

**Verb Form Mapping:**
| Legacy Status | Action Form | Activity Form | Event Form |
|---------------|-------------|---------------|------------|
| pending | `wait` | `waiting` | - |
| resolved | - | - | `waited` (normal completion) |
| cancelled | - | - | `cancelled` |
| timeout | - | - | `waited` (with timeout flag) |

### 4. WorkflowCore (`workflows/core/workflow-core.ts`)

Uses ExactlyOnceContext for step deduplication, but doesn't have explicit workflow-level state. Step completion is tracked via processedIds set.

### 5. Workflow DO (`objects/Workflow.ts`)

**Legacy Status (Instance Level):**
```typescript
status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
```

**Legacy Status (Step Level):**
```typescript
status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
```

## Graph-Based Implementation (`db/graph/workflows/`)

The new implementation in `db/graph/workflows/` has already adopted verb form state encoding:

### workflow-instance.ts

**State Encoded in `stateVerb` Field:**
```typescript
interface WorkflowInstanceData {
  stateVerb: string  // 'start' | 'starting' | 'started' | 'paused' | 'failed' | 'cancelled'
  // ... other fields
}
```

**Mapping Functions:**
```typescript
function verbFormToInstanceState(stateVerb: string): InstanceState {
  if (stateVerb === 'start') return 'pending'
  if (stateVerb === 'starting') return 'running'
  if (stateVerb === 'started') return 'completed'
  if (stateVerb === 'paused') return 'paused'
  if (stateVerb === 'failed') return 'failed'
  if (stateVerb === 'cancelled') return 'cancelled'
  return 'pending'
}

function instanceStateToVerbForms(state: InstanceState): string[] {
  switch (state) {
    case 'pending': return ['start']
    case 'running': return ['starting']
    case 'completed': return ['started']
    case 'paused': return ['paused']
    case 'failed': return ['failed']
    case 'cancelled': return ['cancelled']
  }
}
```

### step-execution.ts

**Verb Forms for Step Execution:**
```typescript
const EXECUTE_VERBS = {
  ACTION: 'execute',    // pending
  ACTIVITY: 'executing', // running
  EVENT: 'executed',     // completed (check error field for failed)
}

const SKIP_VERBS = {
  ACTION: 'skip',
  ACTIVITY: 'skipping',
  EVENT: 'skipped',
}
```

### types.ts - WORKFLOW_VERBS Constant

Complete verb vocabulary for workflow domain:

```typescript
const WORKFLOW_VERBS = {
  // Template structure
  CONTAINS: 'contains',
  FOLLOWS: 'follows',
  BRANCHES_TO: 'branchesTo',

  // Instance relationships
  INSTANCE_OF: 'instanceOf',
  TRIGGERED_BY: 'triggeredBy',

  // Step execution lifecycle
  EXECUTE: 'execute',      // Action: intent (pending)
  EXECUTING: 'executing',  // Activity: in-progress
  EXECUTED: 'executed',    // Event: completed

  // Skip lifecycle
  SKIP: 'skip',
  SKIPPING: 'skipping',
  SKIPPED: 'skipped',

  // Instance state lifecycle
  START: 'start',
  STARTING: 'starting',
  STARTED: 'started',

  // Pause/Resume
  PAUSE: 'pause',
  PAUSING: 'pausing',
  PAUSED: 'paused',
  RESUME: 'resume',
  RESUMING: 'resuming',
  RESUMED: 'resumed',

  // Completion
  COMPLETE: 'complete',
  COMPLETING: 'completing',
  COMPLETED: 'completed',

  // Failure
  FAIL: 'fail',
  FAILING: 'failing',
  FAILED: 'failed',

  // Cancel
  CANCEL: 'cancel',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
}
```

## Core Verb Form Module (`db/graph/verb-forms.ts`)

The verb form module provides the foundation:

### VerbFormStateMachine Class

```typescript
class VerbFormStateMachine {
  readonly action: string   // e.g., 'start'
  readonly activity: string // e.g., 'starting'
  readonly event: string    // e.g., 'started'

  getState(verbForm: string): 'pending' | 'in_progress' | 'completed' | null
  canTransition(currentForm: string, transition: 'start' | 'complete' | 'cancel'): boolean
  transition(currentForm: string, transition: 'start' | 'complete' | 'cancel'): string
}
```

### Edge-Level State Management

```typescript
function getEdgeState(edge: VerbFormEdge): 'pending' | 'in_progress' | 'completed' {
  const type = getVerbFormType(edge.verb)
  switch (type) {
    case 'action': return 'pending'
    case 'activity': return 'in_progress'
    case 'event': return 'completed'
  }
}

function transitionEdge(
  edge: VerbFormEdge,
  transition: 'start' | 'complete' | 'cancel',
  resultTo?: string
): VerbFormEdge
```

## Unified State Encoding Strategy

### Verb Form Triad Pattern

Every state-bearing domain concept follows the same pattern:

```
[verb] (action/intent) -> [verbing] (activity/in-progress) -> [verbed] (event/completed)
```

### Domain-Specific Mapping

| Domain | Action (Pending) | Activity (Running) | Event (Done) |
|--------|------------------|-------------------|--------------|
| **Workflow Instance** | start | starting | started |
| **Step Execution** | execute | executing | executed |
| **Wait for Event** | wait | waiting | waited |
| **Pause Operation** | pause | pausing | paused |
| **Resume Operation** | resume | resuming | resumed |
| **Cancel Operation** | cancel | cancelling | cancelled |
| **Fail Operation** | fail | failing | failed |

### Special Cases

1. **Paused State**: The `paused` event form indicates the workflow has been paused and is waiting. It's a stable state, not a transition.

2. **Failed State**: The `failed` event form, OR `executed` with an `error` field, indicates failure. The error field provides context.

3. **Cancelled State**: The `cancelled` event form indicates external cancellation, distinct from failure.

4. **Resumed State**: After `resumed`, the workflow transitions back to `starting` (running) to continue execution.

## Questions Answered

### 1. Can we replace status columns with verb form relationships?

**Yes.** The verb form IS the state. The relationship's `verb` field encodes:
- Pending/intent: action form (`start`, `execute`, `wait`)
- In-progress: activity form (`starting`, `executing`, `waiting`)
- Completed: event form (`started`, `executed`, `waited`)

The legacy `status` field becomes redundant and can be computed from the verb form.

### 2. How do we handle paused state (is it 'pause' action + 'paused' event)?

**Paused is an event (completed state).** The sequence is:
1. Running workflow (`starting`)
2. Pause requested: set to `paused` directly (event form)
3. Paused workflow stays in `paused` state
4. Resume requested: set to `resume` (action) -> `resuming` (activity)
5. Resumed: transitions back to `starting` (running)

The `paused` state is stable - it's not a transition but a destination.

### 3. How do step transitions map to verb forms?

**Step execution uses execute/executing/executed triad:**

```
Step registered: create 'execute' relationship (action = pending)
Step started: transition to 'executing' relationship (activity = running)
Step completed: transition to 'executed' relationship pointing to result Thing (event = completed)
Step failed: 'executed' relationship with error field in data
Step skipped: 'skipped' relationship (skip -> skipping -> skipped)
```

### 4. How do we handle failed/cancelled states as events?

**Both are event forms:**

- **Failed**: `failed` event form OR `executed` with error data
- **Cancelled**: `cancelled` event form

The distinction between `executed` with error vs `failed` allows flexibility:
- Use `executed + error` when the step completed but with an error result
- Use `failed` when the step execution itself failed (e.g., timeout, crash)

## Persistence Format

The new persistence format includes both verb form and legacy status for backwards compatibility:

```typescript
interface PersistedWorkflowState {
  /** @deprecated Use stateVerb for graph-based state */
  status: WorkflowRuntimeState
  /** Verb form encoding the state */
  stateVerb?: string
  /** Result reference for completed states */
  stateVerbTo?: string | null
  // ... other fields
}
```

## Migration Path

1. **Read**: Check for `stateVerb` first; fall back to `status` if missing
2. **Write**: Persist both `stateVerb` and `status` for compatibility
3. **Query**: Use verb form queries for new code; old queries still work on `status`

```typescript
async restore(): Promise<void> {
  const state = await this.storage.get<PersistedWorkflowState>('workflow:state')

  if (state.stateVerb) {
    // New format: restore from verb
    this._stateRelationship = this.createStateRelationship(
      state.stateVerb as WorkflowStateRelationship['verb'],
      state.stateVerbTo ?? undefined
    )
  } else {
    // Legacy format: migrate from status to verb
    this.migrateStatusToVerb(state.status)
  }
}
```

## Recommendations

1. **Deprecate status columns**: Mark legacy `status` fields as deprecated; compute from verb form.

2. **Standardize verb vocabulary**: Use `WORKFLOW_VERBS` constant across all workflow-related code.

3. **Use VerbFormStateMachine**: For type-safe state transitions with validation.

4. **Graph queries by verb form**: Query relationships by verb to find workflows in specific states:
   ```typescript
   // Find all running workflows
   const running = await store.queryRelationshipsByVerb('starting')
   ```

5. **Result linking**: On completion, the `to` field of the relationship points to the result Thing, enabling traversal from workflow to output.

## Conclusion

The verb form state encoding provides a unified, semantically meaningful way to represent workflow state. The pattern of action/activity/event maps cleanly to pending/running/completed, and the relationship structure enables graph-based querying and result linking.

The existing `WorkflowRuntime` has already been partially migrated. The new `db/graph/workflows/` module provides a complete implementation. The path forward is to:
1. Complete migration of legacy code to use verb forms
2. Deprecate explicit status columns
3. Use graph queries for state-based filtering

---

*Spike completed: 2026-01-13*
*Author: Claude*
