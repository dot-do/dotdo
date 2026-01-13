# [SPIKE] Cascade Context Propagation Design

**Issue:** dotdo-zv0ek
**Status:** Research Complete
**Date:** 2026-01-13
**Author:** Claude (AI-assisted research)

## Executive Summary

This spike documents the design for cascade context propagation through the dotdo function execution tiers: **Code -> Generative -> Agentic -> Human**. The cascade pattern enables intelligent fallback while maintaining full traceability across all execution modes.

## Background

### The Cascade Model

dotdo implements a four-tier function execution cascade, ordered by speed and cost:

| Tier | Method | Speed | Cost | Use Case |
|------|--------|-------|------|----------|
| 1 | `code` | ~1ms | $0 | Deterministic business rules |
| 2 | `generative` | ~1-5s | $$ | Single AI inference call |
| 3 | `agentic` | ~10-60s | $$$ | Multi-step AI with tools |
| 4 | `human` | ~minutes-hours | $$$$ | Human judgment required |

When a function is invoked, the system tries handlers in order, stopping on first success. On failure, it escalates to the next tier automatically.

### Key Requirements

1. **Context must propagate through all tiers** - A request starting in code that escalates to human approval needs the same correlation/trace context
2. **Full observability** - Every hop must be traceable
3. **Cross-DO propagation** - Context must survive Durable Object boundaries
4. **Agent coordination** - Multi-agent cascades need shared context

## Current Implementation Analysis

### 1. Correlation Context (workflows/context/correlation.ts)

The existing correlation system provides:

```typescript
interface CorrelationContext {
  correlationId: string    // Trace ID - groups all events
  requestId: string        // Unique per request
  timestamp: number        // Unix ms
  sequence: number         // Hop counter
  spanId?: string          // Current span
  parentSpanId?: string    // Parent span for nesting
}
```

**Headers:**
- `X-Correlation-ID` - Primary correlation identifier
- `X-Request-ID` - Request-specific identifier
- `X-Dotdo-Request` - Combined header format:
  ```
  {correlationId}.{requestId}.{timestamp}.{sequence}[.{spanId}[.{parentSpanId}]]
  ```

### 2. CascadeExecutor (lib/executors/CascadeExecutor.ts)

The CascadeExecutor implements the cascade pattern:

```typescript
interface CascadeStep {
  type: FunctionType       // 'code' | 'generative' | 'agentic' | 'human'
  attempted: boolean
  success: boolean
  error?: string
  duration: number
  timestamp: Date
}

interface CascadePath {
  steps: CascadeStep[]
  startedAt: Date
  completedAt: Date
  exhausted: boolean
}

interface CascadeResult<T> {
  success: boolean
  result?: T
  method: FunctionType     // Which tier succeeded
  cascade: CascadePath     // Full path taken
  duration: number
  event: Event5WH          // 5W+H event with cascade info
}
```

### 3. Event Model (types/event.ts)

Events use the 5W+H model with cascade tracking:

```typescript
interface EventCascade {
  attempts: CascadeAttempt[]
}

interface CascadeAttempt {
  method: FunctionMethod   // 'code' | 'generative' | 'agentic' | 'human'
  failed: boolean
  reason?: string
}
```

### 4. Correlation Capability (workflows/context/correlation-capability.ts)

Provides span management on WorkflowContext:

```typescript
interface CorrelationCapability {
  readonly id: string              // Current correlation ID
  readonly spanId: string | undefined
  readonly context: CorrelationContext

  span(name: string): SpanBuilder  // Create child span
  setAttribute(key: string, value: string | number | boolean): void
  addEvent(name: string, attrs?: Record<string, unknown>): void
  create(): CorrelationContext     // New root context
  setContext(ctx: CorrelationContext): void
}
```

## Design Recommendations

### 1. Context Schema

Extend the existing correlation context with cascade-specific fields:

```typescript
interface CascadeContext extends CorrelationContext {
  // Existing fields
  correlationId: string
  requestId: string
  timestamp: number
  sequence: number
  spanId?: string
  parentSpanId?: string

  // Cascade-specific extensions
  cascade: {
    /** Current execution tier */
    currentTier: FunctionMethod
    /** Tiers already attempted */
    attemptedTiers: FunctionMethod[]
    /** Tier that originally received the request */
    entryTier: FunctionMethod
    /** Whether cascade was explicit or automatic */
    explicit: boolean
    /** Cumulative errors from failed tiers */
    errors: Array<{
      tier: FunctionMethod
      message: string
      code?: string
    }>
  }

  // Agent coordination (for agentic tier)
  agent?: {
    /** Agent name (e.g., 'priya', 'ralph') */
    name: string
    /** Current tool being used */
    tool?: string
    /** Agent chain for multi-agent workflows */
    chain: string[]
  }

  // Human context (for human tier)
  human?: {
    /** Channel used for human interaction */
    channel: string  // 'slack', 'email', 'mdxui', etc.
    /** Assigned human worker */
    assignee?: string
    /** SLA deadline */
    deadline?: number
  }
}
```

### 2. Serialization Strategy

**Recommendation: Use existing header format with extensions**

For cross-worker transport:
1. **Primary header** - Extend `X-Dotdo-Request` format:
   ```
   {correlationId}.{requestId}.{timestamp}.{sequence}.{spanId}.{parentSpanId}.{currentTier}
   ```

2. **Auxiliary header** - Add `X-Dotdo-Cascade` for cascade-specific data:
   ```
   {JSON-encoded cascade context, base64 if needed}
   ```

3. **In-memory** - Pass full CascadeContext object between handlers

**Date handling:** Use ISO 8601 strings for JSON serialization, convert to Date on parse.

**Complex types:** Use JSON.stringify with replacer for Maps/Sets if needed.

### 3. Validation Strategy

Implement validation at each cascade hop:

```typescript
interface CascadeContextValidator {
  /**
   * Validate incoming context at tier boundary
   * @returns Validated context or throws ValidationError
   */
  validate(ctx: unknown): CascadeContext

  /**
   * Validate before passing to next tier
   * Ensures required fields for downstream tier
   */
  validateForTier(ctx: CascadeContext, tier: FunctionMethod): CascadeContext
}
```

**Validation rules by tier:**
- **Code**: Basic correlation fields required
- **Generative**: Add model/prompt context
- **Agentic**: Add agent/tool context
- **Human**: Add channel/assignee context

**Recovery strategy:**
- Missing optional fields: Use defaults
- Invalid correlation ID: Generate new (log warning)
- Invalid timestamp: Use current time
- Context corruption: Create new context, log error, preserve what can be salvaged

### 4. Propagation Patterns

#### Pattern A: Same-DO Cascade

When cascade stays within one Durable Object:

```
Request -> DO.method()
           |
           v
  [Code Handler] --fail--> [Generative Handler] --fail--> [Human Handler]
       |                         |                              |
       +--------- Same CascadeContext flows through ------------+
```

**Implementation:** Pass context through HandlerContext parameter:

```typescript
interface HandlerContext {
  invocationId: string
  cascade: {
    previousAttempts: CascadeStep[]
    context: CascadeContext  // Full context available
  }
  [key: string]: unknown
}
```

#### Pattern B: Cross-DO Cascade

When cascade spans Durable Objects (e.g., code in OrderDO, human in HumanDO):

```
OrderDO           HumanDO
   |                 |
   v                 v
[Code] --fail--> [stub.requestApproval()]
                      |
                      +-- Context in headers --+
                      |                        |
                      v                        v
               [Human Handler receives full context]
```

**Implementation:** Inject context into cross-DO RPC calls:

```typescript
// In CascadeExecutor
private async executeHumanHandler(input: unknown, ctx: CascadeContext) {
  // Create child context for cross-DO call
  const childCtx = createChildContext(ctx)
  childCtx.cascade.currentTier = 'human'

  // Inject into headers
  const headers = new Headers()
  headers.set('X-Dotdo-Request', createDotdoRequestHeader(childCtx))
  headers.set('X-Dotdo-Cascade', JSON.stringify(childCtx.cascade))

  return await this.humanService.request(input, { headers })
}
```

#### Pattern C: Agent Chain Cascade

When agents delegate to other agents:

```
priya`define MVP`
    |
    +-- Context with agent.chain: ['priya']
    |
    v
ralph`build ${spec}`
    |
    +-- Context with agent.chain: ['priya', 'ralph']
    |
    v
tom`review ${code}`
    |
    +-- Context with agent.chain: ['priya', 'ralph', 'tom']
```

**Implementation:** Append to agent chain on each handoff:

```typescript
function propagateToAgent(ctx: CascadeContext, agentName: string): CascadeContext {
  return {
    ...ctx,
    sequence: ctx.sequence + 1,
    spanId: generateSpanId(),
    parentSpanId: ctx.spanId,
    agent: {
      name: agentName,
      chain: [...(ctx.agent?.chain || []), agentName],
    },
  }
}
```

### 5. Tracing Integration

Connect cascade context to the existing tracing system:

```typescript
// When cascade executes a tier
const result = await $.correlation.span(`cascade:${tier}`)
  .setAttribute('cascade.tier', tier)
  .setAttribute('cascade.attempt', attemptNumber)
  .setAttribute('cascade.previous', previousTiers.join(','))
  .run(async () => {
    return await handler(input, context)
  })
```

**Span naming convention:**
- `cascade:code` - Code tier execution
- `cascade:generative` - Generative tier execution
- `cascade:agentic` - Agentic tier execution
- `cascade:human` - Human tier execution
- `agent:{name}` - Named agent execution
- `human:{channel}` - Human interaction via channel

### 6. Edge Cases

#### Case 1: Cascade Timeout

When global timeout fires mid-cascade:

```typescript
// CascadeContext records partial path
ctx.cascade.errors.push({
  tier: currentTier,
  message: 'Timeout',
  code: 'CASCADE_TIMEOUT',
})
// Throw CascadeTimeoutError with partial context
```

#### Case 2: Agent Loop Detection

When agents reference each other:

```typescript
function detectAgentLoop(ctx: CascadeContext, agentName: string): boolean {
  const chain = ctx.agent?.chain || []
  return chain.includes(agentName)
}

// Throw CascadeLoopError if detected
```

#### Case 3: Context Size Limits

For large cascade contexts (many hops, errors, etc.):

```typescript
const MAX_CONTEXT_SIZE = 8192  // 8KB header limit

function compressContext(ctx: CascadeContext): CascadeContext {
  // Trim error messages to first 100 chars
  // Remove old attempts beyond last 10
  // Remove resolved agent chains
  return compressedCtx
}
```

#### Case 4: Partial Context Recovery

When context is corrupted or incomplete:

```typescript
function recoverContext(partial: Partial<CascadeContext>): CascadeContext {
  return {
    correlationId: partial.correlationId || generateCorrelationId(),
    requestId: partial.requestId || generateRequestId(),
    timestamp: partial.timestamp || Date.now(),
    sequence: partial.sequence || 1,
    cascade: partial.cascade || {
      currentTier: 'code',
      attemptedTiers: [],
      entryTier: 'code',
      explicit: false,
      errors: [],
    },
  }
}
```

## Integration Plan

### Phase 1: Extend CascadeExecutor

1. Add CascadeContext to HandlerContext
2. Track cascade-specific fields in CascadeStep
3. Propagate context between handlers

### Phase 2: Cross-DO Propagation

1. Add X-Dotdo-Cascade header support
2. Extract context in DO request handlers
3. Inject context in cross-DO RPC calls

### Phase 3: Agent Integration

1. Add agent context fields
2. Implement chain tracking
3. Add loop detection

### Phase 4: Human Integration

1. Add human context fields
2. Propagate to notification channels
3. Track SLA/deadline context

### Phase 5: Observability

1. Emit cascade-specific events
2. Add dashboard for cascade analytics
3. Alert on cascade exhaustion rates

## Test Strategy

```typescript
describe('CascadeContextPropagation', () => {
  // Unit tests
  it('propagates context through same-DO cascade')
  it('propagates context through cross-DO cascade')
  it('propagates context through agent chain')
  it('handles timeout with partial context')
  it('detects agent loops')
  it('recovers from corrupted context')
  it('compresses large contexts')

  // Integration tests
  it('full cascade: code -> generative -> human')
  it('agent chain with context preservation')
  it('cross-DO cascade with trace linking')
})
```

## Open Questions

1. **Context inheritance for parallel agents** - When Promise.all runs multiple agents, should they share or fork context?
   - **Recommendation:** Fork with shared correlationId, different requestIds

2. **Human response context** - Should human responses carry cascade context back?
   - **Recommendation:** Yes, for full round-trip tracing

3. **Context retention policy** - How long to retain cascade context in traces?
   - **Recommendation:** Follow existing trace retention (configurable)

## Conclusion

The cascade context propagation design extends the existing correlation and tracing infrastructure to support the Code -> Generative -> Agentic -> Human cascade pattern. Key recommendations:

1. **Extend existing CorrelationContext** rather than creating new structure
2. **Use header-based propagation** for cross-DO calls
3. **Implement validation at tier boundaries** with graceful recovery
4. **Integrate with existing span/trace system** for observability
5. **Handle edge cases** (timeout, loops, size limits) explicitly

The design maintains backward compatibility while enabling full cascade traceability across all function execution tiers.

## References

- `/Users/nathanclevenger/projects/dotdo/lib/executors/CascadeExecutor.ts` - Cascade executor implementation
- `/Users/nathanclevenger/projects/dotdo/workflows/context/correlation.ts` - Correlation headers and context
- `/Users/nathanclevenger/projects/dotdo/workflows/context/correlation-capability.ts` - WorkflowContext correlation capability
- `/Users/nathanclevenger/projects/dotdo/types/event.ts` - 5W+H event model with cascade tracking
- `/Users/nathanclevenger/projects/dotdo/docs/observability/tracing.mdx` - Distributed tracing documentation
- `/Users/nathanclevenger/projects/dotdo/objects/tests/cascade-executor.test.ts` - Cascade executor tests (RED TDD)
