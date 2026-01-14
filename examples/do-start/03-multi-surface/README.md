# Multi-Surface Application

A complete application with all five surfaces: Site, App, Admin, Docs, and Blog. Zero configuration required.

## Quick Start

```bash
# Navigate to this directory
cd examples/do-start/03-multi-surface

# Start the dev server
do start
```

## Available Surfaces

| Surface | URL | Description | File |
|---------|-----|-------------|------|
| Site | http://localhost:4000/ | Marketing landing page | Site.mdx |
| App | http://localhost:4000/app | Main dashboard | App.tsx |
| Admin | http://localhost:4000/admin | Admin panel | Admin.tsx |
| Docs | http://localhost:4000/docs | Documentation | Docs.mdx |
| Blog | http://localhost:4000/blog | Company blog | Blog.mdx |

## What This Demonstrates

1. **All five surfaces** - Complete multi-surface architecture
2. **Zero configuration** - No `do.config.ts` or `wrangler.jsonc` needed
3. **Mixed TSX/MDX** - App and Admin use TSX, Site/Docs/Blog use MDX
4. **Content folders** - `docs/` and `blog/` directories for content
5. **Shared backend** - The Workspace DO in App.tsx is available to all surfaces

## Project Structure

```
03-multi-surface/
  Site.mdx          # Marketing landing (serves at /)
  App.tsx           # Dashboard (serves at /app)
  Admin.tsx         # Admin panel (serves at /admin)
  Docs.mdx          # Documentation shell (serves at /docs)
  Blog.mdx          # Blog shell (serves at /blog)
  docs/
    getting-started.mdx
  blog/
    hello-world.mdx
  README.md
```

## How It Works

### Surface Discovery

The CLI discovers surfaces in this order:

1. `./Surface.tsx` (root directory, TSX)
2. `./Surface.mdx` (root directory, MDX)
3. `.do/Surface.tsx` (hidden directory, TSX)
4. `.do/Surface.mdx` (hidden directory, MDX)

### Root Path Priority

The `/` path uses this priority:

1. **Site** - If `Site.mdx` or `Site.tsx` exists (this example)
2. **App** - If no Site exists

### Content Folders

Content-based surfaces discover these folders:

- `docs/` or `.do/docs/` for Docs surface
- `blog/` or `.do/blog/` for Blog surface
- `site/` or `.do/site/` for Site surface

## Key Patterns

### TSX for Interactive Surfaces

App and Admin use TSX for full React functionality:

```tsx
// App.tsx
export default function App() {
  return (
    <div>
      <Dashboard />
      <ProjectList />
    </div>
  )
}
```

### MDX for Content Surfaces

Site, Docs, and Blog use MDX for content-first development:

```mdx
---
title: "My Page"
---

# Welcome

<MyComponent prop="value" />

Regular markdown content here.
```

### Shared Durable Objects

DOs exported from any surface file are available everywhere:

```tsx
// In App.tsx
export class Workspace extends DO {
  static readonly $type = 'Workspace'

  async createProject(name: string) {
    return this.things.create({ $type: 'Project', name })
  }
}
```

Available at:
- `GET /Workspace/:id`
- `POST /Workspace/:id/createProject`

## Extending This Example

### Add Authentication

Wrap surfaces with auth providers:

```tsx
// App.tsx
import { AuthProvider, RequireAuth } from './auth'

export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <Dashboard />
      </RequireAuth>
    </AuthProvider>
  )
}
```

### Add Configuration

Create `do.config.ts` for explicit control:

```typescript
import { defineConfig } from 'dotdo'

export default defineConfig({
  name: 'multi-surface-app',
  surfaces: {
    site: './Site.mdx',
    app: './App.tsx',
    admin: './Admin.tsx',
    docs: { shell: './Docs.mdx', content: './docs/' },
    blog: { shell: './Blog.mdx', content: './blog/' },
  },
})
```

### Add More DOs

Export additional Durable Objects:

```tsx
// In any surface file
export class Analytics extends DO {
  async trackEvent(event: string, data: Record<string, unknown>) {
    await this.events.emit('Analytics.tracked', { event, ...data })
  }
}
```

## Next Steps

- See `04-config-with-surfaces` for explicit configuration
- See `05-agents-workflow` for AI agent integration
- Read the [Multi-Surface Architecture](/docs/cli/surfaces) documentation
