# DO Dashboard: Unified CLI, API, and Admin

**Date:** 2026-01-10
**Status:** Design Complete
**Author:** Claude + Nathan

## Overview

One codebase, three outputs. The DO Dashboard provides:

| Output | Package | Entry Point | Use Case |
|--------|---------|-------------|----------|
| **REST API** | `dotdo` | `export default API()` | Programmatic access, OpenAPI |
| **CLI Dashboard** | `dotdo` | `CLI()` | Terminal management, REPL |
| **Web Admin** | `dotdo` | `export default Admin()` | Browser-based management |

All three share the same introspection, auth, and navigation logic. The only difference is the renderer.

```ts
// do.config.ts
import { defineConfig } from 'dotdo'
export default defineConfig({ ns: 'myapp.com' })

// api/index.ts - REST API with OpenAPI
export { API as default } from 'dotdo'

// bin/index.ts - Terminal dashboard
#!/usr/bin/env node
import { CLI } from 'dotdo'
import { ensureLoggedIn } from 'oauth.do/node'
await ensureLoggedIn()
CLI()

// app/routes/admin.tsx - Web admin
export { Admin as default } from 'dotdo'
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         do.config.ts                            │
│                    { ns: 'myapp.com', ... }                     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        oauth.do/node                            │
│              ensureLoggedIn() → token at ~/.do/                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    $introspect(ns, token)                       │
│         Auto-discover DOs, stores, storage → DOSchema           │
│              Filtered by user's role/permissions                │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      <DashboardApp />                           │
│              Shared component tree (renderer-agnostic)          │
└─────────────────────────────────────────────────────────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │  Cockpit  │       │ Terminal  │       │    API    │
    │ (React)   │       │ (OpenTUI) │       │  (JSON)   │
    └───────────┘       └───────────┘       └───────────┘
         │                   │                   │
         ▼                   ▼                   ▼
      Browser             Terminal           HTTP Client
```

---

## Configuration: do.config.ts

```ts
// packages/dotdo/src/config/types.ts

export interface DoConfig {
  /**
   * Primary namespace URL
   * @example 'myapp.com'
   */
  ns: string

  /**
   * Environment-specific namespace overrides
   */
  envs?: Record<string, string>

  /**
   * Authentication configuration
   * @default Uses oauth.do with automatic provider detection
   */
  auth?: AuthConfig

  /**
   * Dashboard/Admin UI configuration
   */
  dashboard?: DashboardConfig

  /**
   * REST API configuration
   */
  api?: ApiConfig

  /**
   * CLI configuration
   */
  cli?: CliConfig
}

export interface AuthConfig {
  /**
   * OAuth provider
   * @default 'oauth.do' - federated auth via oauth.do
   */
  provider?: 'oauth.do' | 'workos' | 'clerk' | 'auth0' | 'custom'
  clientId?: string
  clientSecret?: string
  scopes?: string[]
  authorizationUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
}

export interface DashboardConfig {
  title?: string
  logo?: string
  favicon?: string
  theme?: 'light' | 'dark' | 'auto'
  sections?: Array<'schema' | 'data' | 'compute' | 'platform' | 'storage'>
  views?: CustomView[]
}

export interface ApiConfig {
  basePath?: string  // default: '/api'
  openapi?: {
    title?: string
    version?: string
    description?: string
  }
  cors?: {
    origins?: string[]
    methods?: string[]
    credentials?: boolean
  }
  rateLimit?: {
    limit: number
    window: '1s' | '1m' | '1h' | '1d'
  }
}

export interface CliConfig {
  name?: string  // CLI command name
  keys?: Partial<KeyBindings>
  vimMode?: boolean  // default: true
}

export function defineConfig(config: DoConfig): DoConfig {
  return config
}
```

---

## Token Storage: ~/.do/

```
~/.do/
├── tokens.json      # Auth tokens per namespace
├── config.json      # Global CLI preferences
├── history/         # Command history per namespace
│   └── myapp.com.json
└── cache/           # Response cache
```

```json
// ~/.do/tokens.json
{
  "myapp.com": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": "2026-01-10T12:00:00Z",
    "user": {
      "id": "user_123",
      "email": "me@example.com",
      "roles": ["admin"]
    }
  }
}
```

---

## The $ Proxy: Unified Schema Access

The `$` is not just a workflow context—it IS the introspected schema. Instead of calling `$introspect()` separately, accessing `$` gives you the complete DOSchema filtered by your role.

### Design Principle

```ts
// OLD: Separate introspection call
const schema = await this.$introspect(authContext)
const users = await this.Users.list()

// NEW: $ is the schema, accessed via Proxy
const $ = await createDOProxy(ns, token)  // Fetches & caches schema
$                    // → DOSchema (the whole thing)
$.classes            // → [{ name: 'Users', ... }, ...]
$.Users              // → Proxy for Users DO class
$.Users('id')        // → Get specific instance
$.Users.where({})    // → Query builder
$.fsx                // → Filesystem client
$.gitx               // → Git client
```

### Implementation

```ts
// packages/dotdo/src/proxy/create-do-proxy.ts

export async function createDOProxy(
  ns: string,
  token: string
): Promise<DOSchemaProxy> {
  // Fetch schema once (with caching)
  const schema = await fetchSchema(ns, token)

  return new Proxy(schema, {
    get(target, prop) {
      // Special properties
      if (prop === 'schema') return target
      if (prop === 'ns') return target.ns
      if (prop === 'permissions') return target.permissions
      if (prop === 'classes') return target.classes
      if (prop === 'stores') return target.stores
      if (prop === 'storage') return target.storage

      // DO class access: $.Users, $.Customers, etc.
      const doClass = target.classes.find(c => c.name === prop)
      if (doClass) {
        return createClassProxy(ns, token, doClass)
      }

      // Storage access: $.fsx, $.gitx, $.bashx
      if (prop === 'fsx' && target.storage.fsx) return createFsxClient(ns, token)
      if (prop === 'gitx' && target.storage.gitx) return createGitxClient(ns, token)
      if (prop === 'bashx' && target.storage.bashx) return createBashxClient(ns, token)

      return undefined
    },

    // $() returns the raw schema
    apply(target) {
      return target
    }
  })
}

function createClassProxy(ns: string, token: string, doClass: DOClassSchema) {
  const classProxy = function(id?: string) {
    if (id) return getInstance(ns, token, doClass.name, id)
    return listInstances(ns, token, doClass.name)
  }

  return new Proxy(classProxy, {
    get(target, prop) {
      if (prop === 'where') return (filter: object) => queryInstances(ns, token, doClass.name, filter)
      if (prop === 'count') return (filter?: object) => countInstances(ns, token, doClass.name, filter)
      if (prop === 'create') return (data: object) => createInstance(ns, token, doClass.name, data)
      // ... more methods
      return target[prop]
    }
  })
}
```

### REPL Experience

```
$ $
{
  ns: 'myapp.com',
  permissions: { role: 'admin', scopes: ['*'] },
  classes: [...],
  stores: [...],
  storage: { fsx: true, gitx: true, bashx: true, ... }
}

$ $.classes.map(c => c.name)
['Users', 'Customers', 'Orders', 'Products']

$ $.Users
[Function: UsersProxy]

$ await $.Users()
[{ id: 'usr-1', email: 'alice@co.com' }, ...]

$ await $.Users('usr-1')
{ id: 'usr-1', email: 'alice@co.com', role: 'admin' }

$ await $.Users.where({ role: 'admin' })
[{ id: 'usr-1', ... }]

$ $.fsx.ls('/')
['config/', 'data/', 'README.md']
```

### Benefits

| Aspect | Before (`$introspect`) | After (`$ proxy`) |
|--------|------------------------|-------------------|
| Discovery | Explicit RPC call | Just access `$` |
| Mental model | Schema + API | One unified abstraction |
| Autocomplete | Requires type generation | Natural from proxy |
| Caching | Manual | Built into proxy |
| Consistency | `$` and `$introspect` separate | `$` is everything |

---

## Introspection: Auto-Discovery

The `$` proxy internally fetches and caches the DOSchema:

```ts
// packages/dotdo/src/introspection/types.ts

export interface DOSchema {
  ns: string

  /** Caller's effective permissions */
  permissions: {
    role: 'public' | 'user' | 'admin' | 'system'
    scopes: string[]
  }

  /** Available DO classes (filtered by role) */
  classes: DOClassSchema[]

  /** Registered Nouns */
  nouns: NounSchema[]

  /** Registered Verbs */
  verbs: VerbSchema[]

  /** Available stores */
  stores: StoreSchema[]

  /** Storage capabilities */
  storage: {
    fsx: boolean
    gitx: boolean
    bashx: boolean
    r2: { enabled: boolean; buckets?: string[] }
    sql: { enabled: boolean; tables?: string[] }
    iceberg: boolean
    edgevec: boolean
  }
}

export interface DOClassSchema {
  name: string
  type: 'thing' | 'collection'
  pattern: string  // /:type/:id or /:id
  visibility: 'public' | 'user' | 'admin' | 'system'
  tools: MCPToolSchema[]      // From static $mcp
  endpoints: RESTEndpointSchema[]  // From static $rest
  properties: PropertySchema[]
  actions: ActionSchema[]
}
```

**Introspection call (role-filtered):**

```ts
const schema = await introspect(config.ns, token)
// Returns only what this user is authorized to see
```

---

## Default Auth Configuration

Every DO gets secure defaults out of the box:

```ts
// packages/dotdo/src/auth/defaults.ts

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  // System
  '$introspect':        { requireAuth: true },
  '$health':            { public: true },
  '$version':           { public: true },
  '$metrics':           { roles: ['admin'] },

  // Things (user data)
  'things.list':        { requireAuth: true },
  'things.get':         { requireAuth: true },
  'things.create':      { requireAuth: true, permissions: ['write'] },
  'things.update':      { requireAuth: true, permissions: ['write'] },
  'things.delete':      { roles: ['admin'], audit: 'full' },

  // Actions & Events (admin only)
  'actions.*':          { roles: ['admin'] },
  'events.*':           { roles: ['admin'] },

  // Storage
  'fsx.*':              { requireAuth: true },
  'gitx.*':             { requireAuth: true },
  'bashx.*':            { roles: ['admin'], audit: 'full' },
  'r2.*':               { roles: ['admin'] },
  'sql.*':              { roles: ['admin'] },

  // Platform
  'users.me':           { requireAuth: true },
  'users.*':            { roles: ['admin'] },
  'orgs.*':             { roles: ['admin'] },

  // System internals
  'dlq.*':              { roles: ['system'] },
  'objects.*':          { roles: ['system'] },
}
```

**What each role sees:**

| Element | public | user | admin | system |
|---------|--------|------|-------|--------|
| Things (own) | - | ✓ | ✓ | ✓ |
| Things (all) | - | - | ✓ | ✓ |
| Relationships | - | ✓ | ✓ | ✓ |
| Actions log | - | - | ✓ | ✓ |
| Events | - | - | ✓ | ✓ |
| fsx | - | ✓ | ✓ | ✓ |
| gitx | - | ✓ | ✓ | ✓ |
| bashx | - | - | ✓ | ✓ |
| R2/SQL | - | - | ✓ | ✓ |
| DLQ | - | - | - | ✓ |

---

## REPL: Hybrid Bash + ESM with TypeScript LSP

The CLI includes a powerful REPL that understands both shell commands and ESM expressions:

### Unified Syntax

| Input | Interpretation |
|-------|----------------|
| `Users` | List all users |
| `Users usr-1` | Get user by ID |
| `.Users` | Same, with autocomplete |
| `.Users.where({...})` | Query with filter |
| `ls` | List files (fsx) |
| `cat file.json` | Read file (fsx) |
| `git status` | Git command (gitx) |

### TypeScript-Powered Autocomplete

Generate types from introspected schema → TypeScript Language Service → IDE-quality completions:

```ts
// Auto-generated from myapp.com

interface User {
  id: string
  email: string
  role: 'user' | 'admin' | 'owner'
}

interface UserStore {
  /** List all users */
  (): Promise<User[]>

  /** Get user by ID */
  (id: string): Promise<User>

  /** Query users */
  where(filter: Partial<User>): Promise<User[]>

  /** Count users */
  count(filter?: Partial<User>): Promise<number>

  // ... etc
}

declare const $: {
  Users: UserStore
  Customers: CustomerStore
  // ... all DO classes
  fsx: FSXClient
  gitx: GitXClient
  bashx: BashXClient
}
```

### REPL Experience

```
┌─────────────────────────────────────────────────────────────────┐
│ myapp.com > prod                                    user: admin │
├─────────────────────────────────────────────────────────────────┤
│ $ .█                            # Dot triggers autocomplete     │
│   ├── Users                                                     │
│   ├── Customers                                                 │
│   ├── Orders                                                    │
│   ├── fsx                                                       │
│   ├── gitx                                                      │
│   └── bashx                                                     │
│                                                                 │
│ $ .Users.where({ ro█                                            │
│   ├── role: 'user' | 'admin' | 'owner'   ← Knows enum values!   │
│                                                                 │
│ $ Users                         # Just works                    │
│ ┌────────┬──────────────┬────────┐                              │
│ │ id     │ email        │ role   │                              │
│ ├────────┼──────────────┼────────┤                              │
│ │ usr-1  │ alice@co.com │ admin  │                              │
│ │ usr-2  │ bob@co.com   │ user   │                              │
│ └────────┴──────────────┴────────┘                              │
│                                                                 │
│ $ ls                            # Bash still works              │
│ config/  data/                                                  │
│                                                                 │
│ $ █                                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Navigator Structure

The sidebar reflects the introspected schema:

```
┌──────────────────┐
│  SCHEMA          │
│    Nouns         │  ← Type registry
│    Verbs         │  ← Predicate registry
│                  │
│  DATA            │
│    Things        │  ← Versioned entities
│    Relationships │  ← Graph edges
│    Actions       │  ← Command log (admin)
│    Events        │  ← Domain events (admin)
│                  │
│  COMPUTE         │
│    Functions     │  ← Callable methods
│    Workflows     │  ← $.on, $.every handlers
│    Agents        │  ← Priya, Ralph, Tom, etc.
│                  │
│  PLATFORM        │
│    Users         │
│    Orgs          │
│    Integrations  │  ← GitHub, Slack, etc.
│                  │
│  STORAGE         │
│    fsx           │  ← Virtual filesystem
│    gitx          │  ← Git repos
│    bashx         │  ← Shell (admin)
│    R2            │  ← Blob storage (admin)
│    SQL           │  ← Query interface (admin)
└──────────────────┘
```

---

## Views

### Things View (List + Detail)

```
┌─────────────────────────────────────────────────────────────────┐
│ Things > Customer                                    247 items  │
├─────────────────────────────────────────────────────────────────┤
│ ID          Name           Status    Version   Updated         │
│ cust-001    Acme Corp      active    v12       2m ago          │
│ cust-002    Globex Inc     pending   v3        1h ago          │
├─────────────────────────────────────────────────────────────────┤
│ DETAIL: cust-001 (v12)                          [History: v]   │
│ {                                                              │
│   "name": "Acme Corp",                                         │
│   "status": "active",                                          │
│   "plan": "enterprise"                                         │
│ }                                                              │
│ [e]dit  [d]elete  [h]istory  [r]elationships  [a]ctions        │
└─────────────────────────────────────────────────────────────────┘
```

### Workflows View

```
┌─────────────────────────────────────────────────────────────────┐
│ Workflows                                                       │
├─────────────────────────────────────────────────────────────────┤
│ Trigger                Handler              Runs    Last        │
│ $.on.Customer.signup   onboarding.ts:12     1,247   2m ago      │
│ $.on.Payment.failed    retry-payment.ts:8   89      1h ago      │
│ $.every.hour           sync-metrics.ts:3    720     5m ago      │
│ $.every.monday.9am     weekly-report.ts:1   4       6d ago      │
├─────────────────────────────────────────────────────────────────┤
│ [Enter] View runs  [e]dit handler  [p]ause  [t]rigger manually  │
└─────────────────────────────────────────────────────────────────┘
```

### Agents View

```
┌─────────────────────────────────────────────────────────────────┐
│ Agents                                                          │
├─────────────────────────────────────────────────────────────────┤
│ Agent    Role           Status    Current Task      Queue       │
│ Priya    Product        idle      --                0           │
│ Ralph    Engineering    working   Build login UI    3           │
│ Tom      Tech Lead      review    PR #42            1           │
│ Mark     Marketing      idle      --                0           │
│ Sally    Sales          working   Follow up leads   7           │
│ Quinn    QA             testing   Test signup flow  2           │
├─────────────────────────────────────────────────────────────────┤
│ [Enter] View tasks  [a]ssign task  [c]hat  [h]istory            │
└─────────────────────────────────────────────────────────────────┘
```

### fsx View (File Explorer)

```
┌─────────────────────────────────────────────────────────────────┐
│ fsx > /config                                        4 items    │
├─────────────────────────────────────────────────────────────────┤
│ Name              Type      Size      Modified                  │
│ 📁 agents/        dir       --        2h ago                    │
│ 📄 settings.json  file      2.4 KB    1d ago                    │
│ 📄 secrets.env    file      128 B     3d ago      ⚠️ encrypted   │
│ 🔗 latest →       symlink   config/v3                           │
├─────────────────────────────────────────────────────────────────┤
│ PREVIEW: settings.json                                          │
│ { "version": 3, "features": { ... } }                           │
│ [e]dit  [d]elete  [c]opy  [m]ove  [n]ew file  [u]pload          │
└─────────────────────────────────────────────────────────────────┘
```

### gitx View

```
┌─────────────────────────────────────────────────────────────────┐
│ gitx > main                                   ↑2 ↓0 from origin │
├────────────────────────────┬────────────────────────────────────┤
│ BRANCHES                   │ RECENT COMMITS                     │
│ • main (current)           │ a1b2c3d 2h ago   Fix login bug     │
│   feature/dark-mode        │ e4f5g6h 5h ago   Add settings UI   │
├────────────────────────────┴────────────────────────────────────┤
│ [c]ommit  [p]ush  [l]og  [d]iff  [b]ranch  [s]tash  [r]evert    │
└─────────────────────────────────────────────────────────────────┘
```

### bashx View (Admin Only)

```
┌─────────────────────────────────────────────────────────────────┐
│ bashx                                          Safety: Standard │
├─────────────────────────────────────────────────────────────────┤
│ $ █                                                             │
├─────────────────────────────────────────────────────────────────┤
│ HISTORY                                                         │
│ 14:32  ✓ ls -la /config           read     12ms                │
│ 14:30  ✓ cat settings.json        read     8ms                 │
│ 14:28  ✗ rm -rf /                 ⛔ BLOCKED (destructive)      │
├─────────────────────────────────────────────────────────────────┤
│ SAFETY ANALYSIS (last command)                                  │
│ Type: delete | Impact: critical | Reversible: no                │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Response Format (HATEOAS)

```json
{
  "meta": {
    "view": "things.list",
    "params": { "type": "Customer" },
    "timestamp": "2026-01-10T10:00:00Z",
    "breadcrumbs": [
      { "label": "prod", "path": "/env/prod" },
      { "label": "Data", "path": "/env/prod/data" },
      { "label": "Customer", "path": "/env/prod/data/things/customer" }
    ]
  },
  "data": [
    { "id": "cust-001", "name": "Acme Corp", "status": "active" },
    { "id": "cust-002", "name": "Globex Inc", "status": "pending" }
  ],
  "_links": {
    "self": "/api/env/prod/data/things/customer",
    "parent": "/api/env/prod/data/things",
    "next": "/api/env/prod/data/things/customer?cursor=abc",
    "schema": "/api/schemas/customer",
    "actions": {
      "create": "/api/env/prod/data/things/customer",
      "export": "/api/env/prod/data/things/customer/export"
    }
  }
}
```

---

## Entry Points

### API()

```ts
// api/index.ts
export { API as default } from 'dotdo'
```

Creates a Cloudflare Worker that:
1. Reads `do.config.ts`
2. Validates auth token
3. Introspects namespace (cached, role-filtered)
4. Routes requests to DO via RPC
5. Returns JSON with HATEOAS links
6. Serves OpenAPI spec at `/api/openapi.json`

### CLI()

```ts
// bin/index.ts
#!/usr/bin/env node
import { CLI } from 'dotdo'
import { ensureLoggedIn } from 'oauth.do/node'

await ensureLoggedIn()
CLI()
```

Launches terminal dashboard:
1. Reads `do.config.ts`
2. Gets token from `~/.do/tokens.json`
3. Introspects namespace (role-filtered)
4. Generates TypeScript types for REPL
5. Renders with OpenTUI
6. Provides keyboard navigation + REPL

### Admin()

```tsx
// app/routes/admin.tsx
export { Admin as default } from 'dotdo'
```

Returns React component:
1. Reads `do.config.ts`
2. Gets token from auth context
3. Introspects namespace (role-filtered)
4. Renders with @mdxui/cockpit

---

## Keyboard Navigation (CLI)

| Key | Action |
|-----|--------|
| `j/k` | Move up/down |
| `h/l` | Collapse/expand, or left/right panes |
| `Enter` | Select/drill in |
| `Backspace` | Go up one level |
| `Tab` | Toggle detail panel |
| `Ctrl+K` | Spotlight search |
| `/` | Filter current list |
| `c` | Create new |
| `e` | Edit selected |
| `d` | Delete (with confirmation) |
| `m` | Call method on selected DO |
| `:` | Command mode (REPL) |
| `q` | Quit |

---

## Dependencies

### New Packages (in ui repo)

- `@mdxui/navigation` - Type-safe routing for all renderers
- `@mdxui/terminal` - OpenTUI renderer
- `@mdxui/api` - JSON/HATEOAS renderer

### External

- `@opentui/react` - Terminal UI framework (from SST)
- `oauth.do/node` - Auth token management
- `typescript` - Language service for REPL completions

---

## Implementation Plan

### Phase 1: Foundation
1. `do.config.ts` loader
2. `$introspect` endpoint in DOBase
3. Role filtering for introspection

### Phase 2: API
4. `API()` entry point
5. HATEOAS link generation
6. OpenAPI spec generation

### Phase 3: CLI
7. `CLI()` entry point
8. OpenTUI dashboard shell
9. Navigator component
10. REPL with bash/ESM detection

### Phase 4: TypeScript LSP
11. Type generation from schema
12. Language service integration
13. Autocomplete in REPL

### Phase 5: Views
14. Things list/detail views
15. Workflows view
16. Agents view
17. Storage views (fsx, gitx, bashx)

### Phase 6: Web Admin
18. `Admin()` entry point
19. @mdxui/cockpit integration
20. Shared components with CLI

---

## Summary

From 4 lines of code:

```ts
// do.config.ts
export default defineConfig({ ns: 'myapp.com' })

// api/index.ts
export { API as default } from 'dotdo'

// bin/index.ts
await ensureLoggedIn(); CLI()

// app/routes/admin.tsx
export { Admin as default } from 'dotdo'
```

You get:
- Full REST API with OpenAPI spec
- CLI dashboard with TypeScript-powered REPL
- Web admin with the same features
- All role-filtered based on who's logged in
- Zero additional configuration
