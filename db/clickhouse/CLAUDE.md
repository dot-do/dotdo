# Agent Instructions

## ⚠️ CRITICAL: WASM ONLY - NO FALLBACKS

**This project wraps REAL ClickHouse compiled to WebAssembly. There are NO JavaScript fallbacks.**

- **DO NOT** write JavaScript SQL parsers, evaluators, or executors
- **DO NOT** create "mock" implementations that simulate ClickHouse
- **DO NOT** add "fallback" code paths when WASM doesn't support something
- **DO** use the real WASM modules from `vendor/chdb` compiled via Emscripten
- **DO** let tests FAIL if WASM doesn't work (TDD RED phase)

If a SQL feature isn't supported by the WASM module, the correct response is to either:
1. Add the feature to the WASM build (C++ in vendor/chdb)
2. Return an error saying the feature isn't supported
3. File an issue to track the missing feature

**NEVER** write JavaScript code that pretends to be ClickHouse.

---

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Hierarchy & Workflow

Beads supports hierarchical IDs for epics:

* `bd-a3f8` (Epic)
* `bd-a3f8.1` (Task)
* `bd-a3f8.1.1` (Sub-task)

All functional tasks/sub-tasks should be TDD with red, green, and refactor issues.
Documentation tasks should be similarly written with write, edit, and then rewrite issues.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

