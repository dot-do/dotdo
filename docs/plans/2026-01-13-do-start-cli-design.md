# `do start` CLI Design

> Zero-config local development for dotdo projects

## Overview

The `do start` command provides instant local development without requiring package.json, npm install, or complex configuration. Drop a single `App.tsx` file and run `do start`.

## Command Interface

```bash
do start [options]
  -p, --port <port>      Port to listen on (default: 4000)
  --no-open              Don't open browser automatically
  --tunnel               Expose via Cloudflare Tunnel
  --reset                Clear state and start fresh
```

Also available as `dotdo start` or `npx dotdo start`.

## Project Structure

### Minimal (zero-config)

```
my-app/
└── App.tsx              # Just this. Run `do start`.
```

### Simple (visible files)

```
my-project/
├── App.tsx              # End-user app
├── Admin.tsx            # Admin interface (optional)
├── Site.mdx             # Landing page (optional)
├── Docs.mdx             # Docs shell (optional)
├── Blog.mdx             # Blog shell (optional)
├── docs/                # Docs content
├── blog/                # Blog content
├── site/                # Site pages
└── do.config.ts         # Optional config
```

### Hidden (clean root)

```
my-project/
├── do.config.ts
└── .do/
    ├── .gitignore       # Auto-generated
    ├── tsconfig.json    # MDX/TSX intellisense
    ├── mdx.d.ts         # MDXUI component types
    ├── state/           # Runtime data (always gitignored)
    │   └── local.db     # SQLite DO state
    ├── App.tsx
    ├── Admin.tsx
    ├── Site.mdx
    ├── Docs.mdx
    ├── Blog.mdx
    ├── docs/
    ├── blog/
    └── site/
```

## File Discovery

When no config exists, files are discovered in this order:

| Surface | Discovery Order |
|---------|-----------------|
| App | `./App.tsx` → `./App.mdx` → `.do/App.tsx` → `.do/App.mdx` |
| Admin | `./Admin.tsx` → `./Admin.mdx` → `.do/Admin.tsx` → `.do/Admin.mdx` |
| Site | `./Site.tsx` → `./Site.mdx` → `.do/Site.tsx` → `.do/Site.mdx` |
| Docs | `./Docs.tsx` → `./Docs.mdx` → `.do/Docs.tsx` → `.do/Docs.mdx` |
| Blog | `./Blog.tsx` → `./Blog.mdx` → `.do/Blog.tsx` → `.do/Blog.mdx` |
| docs content | `./docs/` → `.do/docs/` |
| blog content | `./blog/` → `.do/blog/` |
| site content | `./site/` → `.do/site/` |

## Routing

All surfaces are path-based (no subdomains in dev):

| URL | Surface | Shell | Content |
|-----|---------|-------|---------|
| `/` | Site | Site.mdx | site/**/*.mdx |
| `/app/*` | App | App.tsx | - |
| `/admin/*` | Admin | Admin.tsx | - |
| `/docs/*` | Docs | Docs.mdx | docs/**/*.mdx |
| `/blog/*` | Blog | Blog.mdx | blog/**/*.mdx |

Each DO is namespace-scoped by hostname with optional base path.

## Configuration

### do.config.ts (optional)

```typescript
import { defineConfig } from 'dotdo'

export default defineConfig({
  port: 4000,

  surfaces: {
    app: './App.tsx',
    admin: './Admin.tsx',
    site: { shell: './Site.mdx', content: 'site/' },
    docs: { shell: './Docs.mdx', content: 'docs/' },
    blog: { shell: './Blog.mdx', content: 'blog/' },
  },
})
```

### Explicit paths override discovery

```typescript
export default defineConfig({
  surfaces: {
    app: './src/MyApp.tsx',
    docs: { shell: './DocShell.mdx', content: './documentation/' },
  },
})
```

## Startup Flow

```
do start
    │
    ▼
┌─────────────────────────────┐
│ 1. Check for existing       │
│    project files            │
└─────────────┬───────────────┘
              │
     ┌────────┴────────┐
     │ Found?          │
     ▼                 ▼
   YES                NO
     │                 │
     ▼                 ▼
┌─────────────┐   ┌─────────────────────┐
│ Load config │   │ Interactive init:   │
│ & discover  │   │ "No dotdo project   │
│ surfaces    │   │  found. Create one?"│
└──────┬──────┘   │ [Y/n]               │
       │          └──────────┬──────────┘
       │                     │
       │          ┌──────────┴──────────┐
       │          │ Create:             │
       │          │ • .do/              │
       │          │ • .do/.gitignore    │
       │          │ • .do/state/        │
       │          │ • .do/tsconfig.json │
       │          │ • .do/mdx.d.ts      │
       │          │ • App.tsx (in root) │
       │          └──────────┬──────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
┌─────────────────────────────┐
│ 2. Start miniflare          │
│    • Port: 4000             │
│    • Persist: .do/state/    │
│    • Live reload: enabled   │
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 3. Print URLs & open browser│
│                             │
│  App:   http://localhost:4000/app   │
│  Admin: http://localhost:4000/admin │
│  Site:  http://localhost:4000/      │
│  Docs:  http://localhost:4000/docs  │
│  Blog:  http://localhost:4000/blog  │
└─────────────────────────────┘
```

## State Management

- **Location:** `.do/state/local.db` (folder-specific, no global fallback)
- **Gitignored by default:** `.do/.gitignore` ignores `state/`, `*.db`, `*.db-wal`, `*.db-shm`
- **Optional check-in:** Users can remove lines from `.gitignore` to persist state
- **Reset:** `do start --reset` clears state directory

## VSCode Intellisense

Auto-generated files for MDX component intellisense:

### .do/tsconfig.json

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["dotdo/mdxui"]
  },
  "include": ["**/*.tsx", "**/*.mdx", "mdx.d.ts"]
}
```

### .do/mdx.d.ts

```typescript
// Auto-generated - provides intellisense for MDXUI components in MDX files
import type {
  App,
  Site,
  LandingPage,
  // ... other MDXUI components
} from 'dotdo/mdxui'

declare module '*.mdx' {
  export const App: typeof App
  export const Site: typeof Site
  export const LandingPage: typeof LandingPage
}
```

## package.json: Optional

**Not required for:**
- Simple examples
- Quick experiments
- Single-file apps
- Learning/demos

**Recommended for:**
- npm dependencies
- Custom scripts
- Deployment configuration
- Team projects

The CLI bundles miniflare and the runtime - no `npm install` needed to start.

## Default Scaffolds

### App.tsx (when created by `do start`)

```tsx
export default function App() {
  return (
    <div className="p-8">
      <h1>Welcome to dotdo</h1>
      <p>Edit App.tsx to get started.</p>
    </div>
  )
}
```

### .do/.gitignore

```gitignore
# Runtime state (gitignored by default)
state/
*.db
*.db-wal
*.db-shm
```

## Implementation Files

| File | Action | Purpose |
|------|--------|---------|
| `cli/package.json` | Done | Added `do` bin alias |
| `cli/commands/start.ts` | Create | New `start` command |
| `cli/runtime/embedded-db.ts` | Modify | `.dotdo` → `.do`, remove global fallback |
| `cli/utils/scaffold.ts` | Create | Generate default files |
| `cli/utils/config.ts` | Modify | Support `surfaces` config shape |
| `cli/utils/discover.ts` | Create | File discovery logic |
| `types/config.ts` | Create | `defineConfig()` types |

## Defaults

| Setting | Value |
|---------|-------|
| Port | 4000 |
| State directory | `.do/state/` |
| Auto-open browser | true |
| Live reload | true |
| File extensions | `.tsx` preferred, `.mdx` supported |
