# Agent Instructions

**pyx** - Python execution for Cloudflare Workers via Pyodide WebAssembly.

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Project Quality Gates

Before completing any work:

```bash
npm run typecheck    # TypeScript must pass
npm run test:run     # All tests must pass
```

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

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

## Key Codebase Conventions

- **core/** has zero Cloudflare dependencies - keep it runtime-agnostic
- All public functions should have JSDoc comments
- Use explicit type exports (not `export *`) for clarity
- Tests live in `test/` mirroring the `core/` structure
