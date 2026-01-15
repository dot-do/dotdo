# ADR-001: DO Class Hierarchy

## Status

Accepted

## Context

Durable Objects provide a powerful foundation for stateful serverless computing, but building production applications requires layered capabilities: routing, semantic modeling, tiered storage, workflow orchestration, and AI integration. A monolithic approach would force developers to import ~25KB+ of code regardless of their needs.

We needed to design a composable class hierarchy where:
1. Each layer adds ~5KB of functionality
2. Developers can pick the smallest class that meets their needs
3. Higher-level classes compose lower-level capabilities without reimplementation

## Decision

We implement a layered inheritance hierarchy where each class extends the previous:

```
DOCore (routing)
  ↓
DOSemantic (nouns/verbs)
  ↓
DOStorage (4-layer tiered storage)
  ↓
DOWorkflow ($ context DSL)
  ↓
DOFull (AI, human-in-loop, fanout, streaming)
```

### Layer Responsibilities

| Class | Size | Capabilities Added |
|-------|------|-------------------|
| **DOCore** | ~5KB | Hono routing, WebSockets, state, lifecycle hooks |
| **DOSemantic** | ~5KB | Nouns, Verbs, Things, Actions, relationships |
| **DOStorage** | ~6KB | L0-L3 tiered storage, lazy checkpoint, WAL |
| **DOWorkflow** | ~5KB | $ context, event handlers, scheduling, cascade |
| **DOFull** | ~4KB | AI integration, human-in-loop, fanout |

### Minimal Worker Architecture

The worker is a pure passthrough to the DO:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const ns = url.hostname.split('.')[0] ?? 'default'
    const stub = env.DO.get(env.DO.idFromName(ns))
    return stub.fetch(request)
  }
}
```

## Consequences

### Positive

- **Pay for what you use** - Simple use cases only load ~5KB (DOCore)
- **Clear separation of concerns** - Each layer has a single responsibility
- **Easy testing** - Test each layer in isolation
- **Type safety** - Full TypeScript inference at each level
- **Predictable extension** - Adding capabilities means extending the next layer up

### Negative

- **Deep inheritance chain** - 5 levels of inheritance can be harder to debug
- **Method name conflicts** - Must be careful with naming across layers
- **Bundle size for DOFull** - Full stack is ~25KB (acceptable for production)

### Mitigations

- Each layer has comprehensive JSDoc documentation
- Clear naming conventions prevent conflicts (e.g., `$` prefix for workflow methods)
- Tree-shaking removes unused code in production builds

## References

- `/docs/core/index.mdx` - DOCore documentation
- `/docs/semantic/index.mdx` - DOSemantic documentation
- `/docs/storage/index.mdx` - DOStorage documentation
- `/docs/workflow/index.mdx` - DOWorkflow documentation
