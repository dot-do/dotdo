# Prototype Implementation Plan

**Date:** 2026-01-11
**Status:** Draft for Review

## Executive Summary

After analyzing the bashx prototypes against the dotdo ecosystem, here's the recommended architecture for implementing each component following TDD (red-green-refactor).

## Ecosystem Context

```
dotdo/                          # Base platform
├── objects/DOFull.ts           # fork, branch, checkout, merge (DO lifecycle)
├── lib/mixins/git.ts           # $.git capability with R2 object store
├── objects/transport/          # RPC server, Cap'n Web target
└── db/stores.ts                # ThingsStore, EventsStore, etc.

fsx.do/                         # Filesystem on DOs
└── storage/                    # SQLite, R2, tiered backends (MATURE)

gitx/                           # Git versioning
└── src/                        # Git operations

bashx.do/                       # Shell execution (THIS PROJECT)
├── core/                       # Pure library (zero CF deps)
│   ├── ast/                    # Existing
│   ├── safety/                 # Existing
│   ├── pty/ ✨                 # NEW from prototype
│   └── rpc/ ✨                 # NEW from design doc
└── src/                        # CF Workers implementation
    ├── do/                     # Existing
    ├── mcp/                    # Existing
    └── session/ ✨             # NEW from prototype
```

---

## Component 1: PTY/TTY Emulation

**Location:** `bashx/core/pty/` (keep as-is)

**Rationale:** Virtual terminal emulation is fundamental to shell execution. No overlap with dotdo.

### Current Prototype Status
- `core/pty/types.ts` - Type definitions ✓
- `core/pty/parser.ts` - ANSI parser ✓
- `core/pty/buffer.ts` - Terminal buffer ✓
- `core/pty/virtual-pty.ts` - Main class ✓
- `test/core/pty/virtual-pty.test.ts` - Tests ✓

### TDD Issues

| Phase | Issue | Description |
|-------|-------|-------------|
| RED | `pty-red-1` | Test: VirtualPTY basic cursor movement sequences |
| RED | `pty-red-2` | Test: VirtualPTY color and attribute handling |
| RED | `pty-red-3` | Test: TerminalBuffer screen buffer operations |
| RED | `pty-red-4` | Test: ANSIParser escape sequence parsing |
| GREEN | `pty-green-1` | Implement: Basic cursor control (up/down/left/right) |
| GREEN | `pty-green-2` | Implement: SGR color/attribute sequences |
| GREEN | `pty-green-3` | Implement: Screen buffer with scrollback |
| GREEN | `pty-green-4` | Implement: Complete ANSI parser state machine |
| REFACTOR | `pty-refactor-1` | Extract common sequence patterns |
| REFACTOR | `pty-refactor-2` | Add TypeScript strict mode compliance |

---

## Component 2: Cap'n Web RPC Layer

**Location:** `bashx/core/rpc/` (types) + integrate with `dotdo/objects/transport/`

**Rationale:** dotdo already has `capnweb-target.ts` in transport layer. bashx adds shell-specific types and integrates with existing infrastructure.

### Architecture Decision
- **Shell types** (`ShellApi`, `ShellStream`, `ShellResult`) → `bashx/core/rpc/types.ts`
- **Transport adapters** → Leverage `dotdo/objects/transport/capnweb-target.ts`
- **Shell implementation** → `bashx/src/rpc/shell-api-impl.ts`

### TDD Issues

| Phase | Issue | Description |
|-------|-------|-------------|
| RED | `rpc-red-1` | Test: ShellApi.exec() returns ShellResult |
| RED | `rpc-red-2` | Test: ShellApi.spawn() returns streaming ShellStream |
| RED | `rpc-red-3` | Test: ShellStream.onData() callback receives chunks |
| RED | `rpc-red-4` | Test: ShellStream disposal cleans up process |
| GREEN | `rpc-green-1` | Implement: ShellApi types in core/rpc |
| GREEN | `rpc-green-2` | Implement: ShellApiImpl using ShellBackend |
| GREEN | `rpc-green-3` | Implement: ShellStreamImpl with callbacks |
| GREEN | `rpc-green-4` | Integrate: With dotdo capnweb-target transport |
| REFACTOR | `rpc-refactor-1` | Add authentication layer |
| REFACTOR | `rpc-refactor-2` | Add rate limiting |

---

## Component 3: Session Fork/Branch/Experiment

**Location:** `bashx/src/session/` USING `DOFull` primitives

**Rationale:** DOFull already has fork/branch/merge for DO lifecycle. bashx adds **AI experimentation semantics** on top:
- `experiment(n)` - Run N parallel sessions, compare results
- Session-specific state (cwd, env, history)
- R2 Iceberg persistence for recovery

### Key Insight
DOFull's `fork()` creates a new DO. bashx's `fork()` creates a new session WITHIN the same DO or spawns a child DO for isolation. These are complementary, not overlapping.

### Architecture
```
bashx/src/session/
├── types.ts              # Session state, fork/branch/experiment types
├── session.ts            # Session class using DOFull.fork() under the hood
├── checkpoint-manager.ts # R2 Iceberg persistence (from prototype)
└── factory.ts            # createSession, loadSession
```

### TDD Issues

| Phase | Issue | Description |
|-------|-------|-------------|
| RED | `session-red-1` | Test: Session.fork() creates independent copy |
| RED | `session-red-2` | Test: Session.branch() creates named snapshot |
| RED | `session-red-3` | Test: Session.experiment(3) runs parallel sessions |
| RED | `session-red-4` | Test: CheckpointManager persists to R2 |
| RED | `session-red-5` | Test: Session recovery from R2 on DO eviction |
| GREEN | `session-green-1` | Implement: Session class with state management |
| GREEN | `session-green-2` | Implement: fork() using DOFull primitives |
| GREEN | `session-green-3` | Implement: branch() for named snapshots |
| GREEN | `session-green-4` | Implement: experiment() for parallel execution |
| GREEN | `session-green-5` | Implement: CheckpointManager with R2 Iceberg |
| REFACTOR | `session-refactor-1` | Integrate with gitx for versioning |
| REFACTOR | `session-refactor-2` | Add metrics and observability |

---

## Component 4: Columnar Store

**Location:** MOVE TO `fsx/storage/columnar.ts`

**Rationale:** This is a **general DO SQLite optimization pattern** that benefits any DO. fsx already has mature storage backends (sqlite.ts, r2.ts, tiered.ts).

### Migration Plan
1. Move `WriteBufferCache` and `ColumnarSessionStore` to fsx
2. Generalize from session-specific to any state object
3. bashx depends on `fsx.do` for storage (already in package.json)

### Architecture in fsx
```
fsx/storage/
├── sqlite.ts          # Existing SQLite backend
├── r2.ts              # Existing R2 backend
├── tiered.ts          # Existing tiered storage
├── columnar.ts ✨     # NEW: Columnar pattern for cost optimization
└── write-buffer.ts ✨ # NEW: LRU write buffer with batch checkpoint
```

### TDD Issues (in fsx project)

| Phase | Issue | Description |
|-------|-------|-------------|
| RED | `columnar-red-1` | Test: WriteBufferCache LRU eviction |
| RED | `columnar-red-2` | Test: WriteBufferCache dirty tracking |
| RED | `columnar-red-3` | Test: ColumnarStore batch checkpoint reduces row writes |
| RED | `columnar-red-4` | Test: Cost comparison shows 99%+ reduction |
| GREEN | `columnar-green-1` | Implement: WriteBufferCache with size limits |
| GREEN | `columnar-green-2` | Implement: ColumnarStore with JSON columns |
| GREEN | `columnar-green-3` | Implement: Checkpoint triggers (count, interval, memory) |
| GREEN | `columnar-green-4` | Implement: Cost tracking and comparison |
| REFACTOR | `columnar-refactor-1` | Generalize from SessionState to any T |
| REFACTOR | `columnar-refactor-2` | Add compression for JSON columns |

---

## Dependency Graph

```
                    ┌─────────────────┐
                    │   PTY (core/)   │
                    │  No dependencies│
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   RPC (core/)   │
                    │ Depends on PTY  │
                    │ for TUI streams │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  Session   │  │  Columnar  │  │   dotdo    │
     │  (src/)    │  │   (fsx/)   │  │ transport  │
     │Uses DOFull │  │Uses fsx    │  │ capnweb    │
     └────────────┘  └────────────┘  └────────────┘
```

---

## Issue Creation Order

### Phase 1: Foundation (No dependencies)
1. PTY RED tests
2. PTY GREEN implementation

### Phase 2: RPC Layer
3. RPC RED tests (after PTY for TUI streaming)
4. RPC GREEN implementation

### Phase 3: Storage (in fsx project)
5. Columnar RED tests
6. Columnar GREEN implementation

### Phase 4: Session Management
7. Session RED tests
8. Session GREEN implementation (depends on columnar for persistence)

### Phase 5: Refactoring
9. All REFACTOR issues (parallel)

---

## Next Steps

1. **Review this plan** - Confirm architecture decisions
2. **Create epic issues** - One per component
3. **Create child issues** - RED/GREEN/REFACTOR per epic
4. **Set dependencies** - Block GREEN on RED, REFACTOR on GREEN

### Questions for Review

1. Should columnar pattern go in fsx or stay in bashx for now?
2. Should session primitives integrate with gitx or stay independent?
3. Priority order of components?
