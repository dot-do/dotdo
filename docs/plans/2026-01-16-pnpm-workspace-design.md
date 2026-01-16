# pnpm Workspace Design for dotdo

**Date:** 2026-01-16
**Status:** Approved
**Goal:** Make core dotdo packages publishable as `@dotdo/*` for external dependencies

## Decisions

1. **Naming**: `@dotdo/*` scope for all packages
2. **Approach**: Hybrid - core packages in this repo, capabilities (fsx, gitx, bashx) stay in separate repos
3. **Structure**: Keep current directory layout, add package.json to publishable directories

## Workspace Configuration

### pnpm-workspace.yaml

```yaml
packages:
  # Core packages (top-level directories)
  - 'core'
  - 'rpc'
  - 'storage'
  - 'workflow'
  - 'semantic'
  - 'types'
  - 'ai'
  - 'mcp'
  - 'cli'
  - 'streaming'

  # Already in packages/
  - 'packages/*'

  # Exclude non-packages
  - '!**/test/**'
  - '!**/tests/**'
```

### Root package.json

The root becomes a workspace root (not publishable). The main `dotdo` package re-exports from scoped packages.

## Package Dependency Graph

```
@dotdo/types          (no deps - pure types)
    ↑
@dotdo/core           (depends on types)
    ↑
@dotdo/storage        (depends on core, types)
@dotdo/rpc            (depends on core, types)
    ↑
@dotdo/workflow       (depends on storage, rpc, core, types)
@dotdo/semantic       (depends on storage, core, types)
    ↑
@dotdo/ai             (depends on workflow, core, types)
@dotdo/mcp            (depends on rpc, core, types)
@dotdo/streaming      (depends on storage, core, types)
    ↑
@dotdo/cli            (depends on many)
```

## Package Configuration Pattern

Each publishable directory needs:

```json
{
  "name": "@dotdo/[name]",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

**Internal deps use workspace protocol:**
```json
{
  "dependencies": {
    "@dotdo/types": "workspace:*",
    "@dotdo/core": "workspace:*"
  }
}
```

## Published vs Internal

| Directory | Published | Package Name |
|-----------|-----------|--------------|
| `core/` | ✅ | `@dotdo/core` |
| `rpc/` | ✅ | `@dotdo/rpc` |
| `storage/` | ✅ | `@dotdo/storage` |
| `workflow/` | ✅ | `@dotdo/workflow` |
| `semantic/` | ✅ | `@dotdo/semantic` |
| `types/` | ✅ | `@dotdo/types` |
| `ai/` | ✅ | `@dotdo/ai` |
| `mcp/` | ✅ | `@dotdo/mcp` |
| `cli/` | ✅ | `@dotdo/cli` |
| `streaming/` | ✅ | `@dotdo/streaming` |
| `packages/middleware/` | ✅ | `@dotdo/middleware` |
| `packages/workers/` | ✅ | `@dotdo/workers` |
| `objects/` | ❌ | Internal DO implementations |
| `lib/` | ❌ | Internal utilities |
| `api/` | ❌ | Internal Hono worker |
| `auth/` | ❌ | Internal auth config |
| `db/` | ❌ | Internal DB schemas |

## Migration Steps

1. Create `pnpm-workspace.yaml` at root
2. Convert root `package.json` to workspace root
3. Add `package.json` to each publishable directory
4. Update imports to use workspace protocol
5. Add tsup config to each package
6. Test build with `pnpm -r build`
7. Verify publishing with `pnpm publish --dry-run`

## External Package Pattern

For capabilities in separate repos (fsx, gitx, bashx, etc.):

- `@dotdo/[name]` - Core library/SDK (e.g., `@dotdo/fsx`)
- `[name].do` - Managed service offering (e.g., `fsx.do`)

The managed service packages depend on both `dotdo` and their core package.
