# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records documenting key technical decisions made in the dotdo project.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision made along with its context and consequences. ADRs help new team members understand why things are the way they are and provide a record of the evolution of the system.

## ADR Index

| ADR | Title | Status | Summary |
|-----|-------|--------|---------|
| [ADR-001](./ADR-001-DO-Class-Hierarchy.md) | DO Class Hierarchy | Accepted | Layered inheritance: DOCore -> DOSemantic -> DOStorage -> DOWorkflow -> DOFull |
| [ADR-002](./ADR-002-4-Layer-Storage.md) | 4-Layer Storage Architecture | Accepted | L0 Memory -> L1 WAL -> L2 SQLite -> L3 Iceberg tiered storage |
| [ADR-003](./ADR-003-Capn-Web-RPC.md) | Cap'n Web RPC | Accepted | Capability-based RPC with promise pipelining and $meta introspection |
| [ADR-004](./ADR-004-Semantic-Type-System.md) | Semantic Type System | Accepted | Nouns, Verbs, Things, Actions, and relationship operators |
| [ADR-005](./ADR-005-WorkflowContext-DSL.md) | WorkflowContext ($) DSL | Accepted | Fluent DSL for events, scheduling, durability, and RPC |

## ADR Template

When creating new ADRs, use this template:

```markdown
# ADR-XXX: Title

## Status

[Proposed | Accepted | Deprecated | Superseded by ADR-YYY]

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive
- Benefit 1
- Benefit 2

### Negative
- Tradeoff 1
- Tradeoff 2

### Mitigations
- How we address the negatives

## References
- Links to related documentation, code, or external resources
```

## Naming Convention

ADRs are numbered sequentially: `ADR-XXX-Short-Title.md`

- Use three-digit numbers (001, 002, etc.)
- Use Title Case for the short title
- Replace spaces with hyphens

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion, not yet accepted |
| **Accepted** | Decision has been made and is active |
| **Deprecated** | No longer relevant but kept for historical reference |
| **Superseded** | Replaced by a newer ADR |
