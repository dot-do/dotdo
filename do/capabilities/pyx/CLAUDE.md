# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

pyx.do is a Python package execution service for Cloudflare Workers. It provides pipx/uvx-like functionality for running Python packages in the cloud, plus pypi registry capabilities.

**Core Philosophy**: "Python execution at the edge"

## Commands

```bash
npm run build        # Compile TypeScript with tsup
npm run dev          # Watch mode build
npm run test         # Run tests with vitest
npm run typecheck    # TypeScript type checking
npm run deploy       # Deploy to Cloudflare
```

## Architecture

```
Request (pyx.do/<package>)
    |
    v
Router (tier selection)
    |
    +-- Tier 1 (Hot): Pre-deployed Workers with memory snapshots (<100ms)
    |   - black, ruff, pytest, mypy, isort, etc.
    |
    +-- Tier 2 (Warm): Pyodide-native packages via micropip (~1s)
    |   - numpy, pandas, scipy, etc.
    |
    +-- Tier 3 (Cold): Pure Python packages via micropip (~5s)
    |   - Any pure Python wheel
    |
    +-- Tier 4 (Sandbox): Full Linux for C-extensions (~10-30s)
        - Packages requiring native compilation
```

**Key directories:**
- `core/` - Pure library with zero Cloudflare dependencies
- `core/registry/` - PyPI registry client
- `core/compatibility/` - Pyodide compatibility checking
- `src/` - Cloudflare Workers platform code
- `src/workers/` - Pre-deployed package Workers
- `src/router/` - Request routing logic

## Technical Constraints

1. **Memory**: 128 MB per Worker isolate
2. **CPU**: Up to 5 minutes (paid plans)
3. **Startup**: 1 second limit - use memory snapshots
4. **Packages**: Pure Python + Pyodide packages only (no arbitrary C extensions)
5. **Dynamic import**: Must declare packages at deploy time for memory snapshots

## Integration with bashx

pyx.do integrates as a Tier 2 RPC binding:

```typescript
python: {
  commands: ['python', 'python3', 'pip', 'pipx', 'uvx', 'pyx'],
  endpoint: 'https://pyx.do',
}
```

## Development Approach

This project follows TDD (Red-Green-Refactor). Use beads for issue tracking:

```bash
bd ready                              # Find available work
bd show <id>                          # View issue details
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Mark complete
bd sync                               # Sync with git remote
```

## Session Completion

Work is NOT complete until `git push` succeeds:

```bash
git pull --rebase
bd sync
git push
git status  # MUST show "up to date with origin"
```
