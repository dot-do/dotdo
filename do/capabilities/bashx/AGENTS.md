# AGENTS.md - AI Assistant Guidance for bashx

## Project Overview

bashx.do is an AI-enhanced bash execution layer that adds judgment, safety, and intent understanding to shell commands.

## Core Philosophy

**"Think before executing"**

Unlike fsx (filesystem) or gitx (git), bash commands can be irreversible and dangerous. bashx adds a judgment layer:

1. **Understand intent** - What does the user actually want?
2. **Assess risk** - Is this safe to execute?
3. **Provide alternatives** - Are there safer options?
4. **Execute with recovery** - Handle failures intelligently
5. **Explain actions** - Transparency in what was done

## Architecture Layers

```
SDK Layer (src/index.ts)
├── Tagged template: bash`command`
├── Options: confirm, dryRun, timeout, cwd
└── Rich BashResult with AST, intent, classification

Core Library (core/) - @dotdo/bashx
├── Pure library with zero Cloudflare dependencies
├── core/types.ts - AST types (Program, Command, Pipeline, etc.)
├── core/ast/ - Type guards, factory functions, serialization
├── core/safety/ - Safety analysis, classification, intent extraction
├── core/escape/ - POSIX-compliant shell escaping
├── core/classify/ - Input classification (command vs natural language)
└── core/backend.ts - Abstract shell backend interface

AST Layer (src/ast/)
├── tree-sitter-bash WASM integration
├── Command parsing and analysis
├── Syntax fixing and optimization
└── Dependency tree extraction

MCP Layer (src/mcp/)
├── Single `bash` tool for AI assistants
├── Tool definitions with schemas
└── Handlers for execution

Execution Layer (src/execute.ts, src/undo.ts)
├── Actual command execution
├── Output parsing
├── Error recovery
└── Undo tracking

DO Layer (src/do/)
├── Durable Object command implementations
├── POSIX command emulation (cat, ls, find, etc.)
└── Native Workers API mappings
```

## Key Types

- `BashxClient` - Main client interface
- `BashxResult` - Result of any operation
- `CommandClassification` - Safety classification
- `SafetyReport` - Detailed safety analysis
- `Explanation` - Command explanation breakdown

## Development Patterns

### TDD Approach

This project follows strict TDD:

1. **RED** - Write failing tests first
2. **GREEN** - Implement minimum to pass
3. **REFACTOR** - Clean up and optimize

### Testing Structure

```
tests/
├── ast-*.test.ts            # AST parsing, traversal, intent extraction
├── safety-*.test.ts         # Safety classification and gate tests
├── structural-safety.test.ts # Structural safety analysis
├── input-classification.test.ts # Command vs natural language detection
├── tagged-template.test.ts  # Shell template interpolation
├── exec.test.ts             # Command execution
├── undo-tracking.test.ts    # Undo support
├── mcp/                     # MCP tool tests
├── posix/                   # POSIX command compatibility tests
├── do/                      # Durable Object integration tests
└── utils/                   # Test utilities
```

### Code Conventions

- Use `vitest` for testing
- Export types from `types.ts`
- Keep handlers separate from definitions
- Document all public APIs

## Beads Integration

Track work with beads:

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status=in_progress
bd close <id>
bd sync
```

## Safety First

When implementing:

1. **Never execute without classification** - Every command gets classified
2. **Dry-run by default for danger** - Critical commands require explicit confirmation
3. **Log everything** - Audit trail for all executions
4. **Suggest alternatives** - Always offer safer options
5. **Test dangerous paths** - Verify safety checks work

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
