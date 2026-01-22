# ADR-001: Monorepo Structure

## Status

Accepted

## Date

2026-01-21

## Context

The dotdo project consists of multiple interconnected packages including the core Durable Object (`@dotdo/do`), API layer (`@dotdo/api`), database abstraction (`@dotdo/db`), RPC layer (`@dotdo/rpc`), AI routing (`@dotdo/ai`), authentication (`@dotdo/auth`), MCP tools (`@dotdo/mcp`), and frontend application (`@dotdo/app`).

We needed to decide how to organize these packages: as separate repositories with npm dependencies, or as a monorepo with workspace packages.

## Decision

We will use a **monorepo structure** with npm workspaces managed by Turborepo.

The structure is:

```
dotdo/              # Main package - re-exports all modules
├── api/            # @dotdo/api - Hono worker with HATEOAS
├── do/             # @dotdo/do - THE Durable Object class
├── db/             # @dotdo/db - Abstract storage layer
├── rpc/            # @dotdo/rpc - Cap'n Web RPC
├── ai/             # @dotdo/ai - AI routing with template literals
├── auth/           # @dotdo/auth - JWT auth with jose
├── mcp/            # @dotdo/mcp - Model Context Protocol tools
├── app/            # @dotdo/app - TanStack Start frontend
└── primitives/     # Git submodule to primitives.org.ai
```

## Consequences

### Positive

- **Atomic changes**: Cross-package refactoring can be done in a single commit
- **Consistent tooling**: Shared TypeScript config, ESLint rules, and test infrastructure
- **Simplified dependency management**: Workspace packages use `*` versions, always in sync
- **Better DX**: Single `npm install`, unified `npm test`, coordinated builds via Turborepo
- **Easier code navigation**: All code in one place for IDEs and code search

### Negative

- **Larger repository**: Clone size increases with all packages
- **CI complexity**: Need to handle selective builds and test filtering
- **Learning curve**: Contributors need to understand workspace structure

### Neutral

- **Publishing**: Each package is published independently to npm
- **Versioning**: Packages can have independent versions (we use `0.0.0` in development)

## Alternatives Considered

### Separate Repositories

Each package (`@dotdo/do`, `@dotdo/api`, etc.) in its own repository.

**Rejected because:**
- Cross-package changes require coordinated PRs and releases
- Version mismatches cause integration issues
- Higher maintenance burden for CI/CD across repos

### Single Package

All code in one npm package.

**Rejected because:**
- Users must install everything even if they only need `@dotdo/do`
- Harder to reason about dependency boundaries
- Bundle size concerns for frontend applications

## References

- [Turborepo documentation](https://turbo.build/repo/docs)
- [npm workspaces](https://docs.npmjs.com/cli/v8/using-npm/workspaces)
- Previous v1 and v2 implementations in `.worktrees/`
