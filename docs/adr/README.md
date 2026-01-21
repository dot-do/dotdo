# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the dotdo project. ADRs document significant architectural decisions along with their context and consequences.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision made along with its context and consequences. ADRs help:

- **Document decisions**: Explain why things are the way they are
- **Onboard new contributors**: Understand the reasoning behind the architecture
- **Revisit decisions**: Provide context when reconsidering past choices
- **Track evolution**: See how the architecture has changed over time

## Current ADRs

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](./ADR-001-monorepo-structure.md) | Monorepo Structure | Accepted |
| [ADR-002](./ADR-002-durable-objects-as-core-primitive.md) | Durable Objects as Core Primitive | Accepted |
| [ADR-003](./ADR-003-rpc-first-communication.md) | RPC-First Communication | Accepted |

## Creating a New ADR

1. Copy `template.md` to `ADR-XXX-short-title.md` where XXX is the next number
2. Fill in all sections of the template
3. Set status to "Proposed"
4. Submit a PR for review
5. Update status to "Accepted" when merged

## ADR Statuses

- **Proposed**: Under discussion, not yet accepted
- **Accepted**: Approved and in effect
- **Deprecated**: No longer valid but kept for historical context
- **Superseded by ADR-XXX**: Replaced by a newer decision

## References

- [Michael Nygard's ADR article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR GitHub organization](https://adr.github.io/)
