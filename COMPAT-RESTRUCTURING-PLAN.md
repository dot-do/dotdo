# Compat Libraries Restructuring Plan

## Vision

Transform compat libraries from monorepo code into a dual-layer architecture:

```
@dotdo/[name]  →  Core abstraction package (npm, zero-dependency)
[name].do      →  Managed service repo (separate git repo, Durable Objects)
```

---

## Current State Analysis

### Compat Libraries (42 total)

| Category | Libraries | Published |
|----------|-----------|-----------|
| **Databases** | postgres, duckdb, couchdb, cubejs | postgres, duckdb |
| **APIs** | stripe, slack, discord, github, linear, shopify, zendesk, hubspot, zapier | stripe, linear |
| **Messaging** | sendgrid, twilio, n8n, intercom | - |
| **Cloud** | s3, gcs, benthos, flink, sqs | sqs |
| **AI** | anthropic, openai, cohere, google-ai | - |
| **Auth** | supabase-auth, auth (multi-provider) | supabase-auth |
| **Observability** | sentry, segment, analytics, flags | sentry |
| **Infrastructure** | pusher, automation, calls, emails, salesforce | pusher |
| **Shared** | core, shared | - |

### Primitives Pattern (Reference)

```
primitives/fsx/
├── core/                 # @dotdo/fsx - Zero-dep core library
│   ├── index.ts
│   ├── types.ts
│   └── [implementation]
├── src/                  # fsx.do - Cloudflare service layer
│   ├── index.ts
│   ├── do/              # Durable Objects
│   └── storage/         # Backends
├── package.json          # Exports both ./core and .
├── wrangler.jsonc
└── tests/
```

---

## Target Architecture

### Tier 1: Core Packages (in this monorepo)

Move compat libraries to `packages/` as `@dotdo/[name]`:

```
packages/
├── mongo/               # @dotdo/mongo
│   ├── src/
│   │   ├── index.ts    # Re-exports
│   │   ├── client.ts   # MongoClient implementation
│   │   ├── collection.ts
│   │   ├── types.ts
│   │   └── backends/
│   │       ├── memory.ts   # For testing
│   │       └── interface.ts
│   ├── package.json
│   ├── tsup.config.ts
│   └── tests/
├── kafka/               # @dotdo/kafka
├── redis/               # @dotdo/redis
├── postgres/            # @dotdo/postgres (existing)
├── stripe/              # @dotdo/stripe (existing)
└── ...
```

### Tier 2: Managed Services (separate repos)

External repos in the sdks organization, linked as submodules:

```
github.com/dot-do/
├── mongo.do/            # Managed MongoDB
│   ├── core/           # Could re-export @dotdo/mongo
│   ├── src/
│   │   ├── do/         # MongoDO class
│   │   ├── storage/    # R2/D1 backends
│   │   └── index.ts
│   ├── wrangler.toml
│   └── package.json    # mongo.do npm package
├── kafka.do/
├── redis.do/
└── ...
```

---

## Migration Strategy

### Phase 1: Package Extraction (This Repo)

Extract compat libraries to `packages/` with proper structure:

```bash
# For each compat library
packages/[name]/
├── src/
│   ├── index.ts         # Public API
│   ├── types.ts         # Type definitions
│   ├── client.ts        # Main client class
│   └── backends/
│       └── memory.ts    # In-memory backend for testing
├── package.json
├── tsup.config.ts
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

**Package.json Template:**
```json
{
  "name": "@dotdo/[name]",
  "version": "0.1.0",
  "description": "[Name] API-compatible SDK for edge runtimes",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./types": {
      "types": "./dist/types.d.ts",
      "import": "./dist/types.js"
    }
  },
  "files": ["dist", "README.md"],
  "repository": {
    "type": "git",
    "url": "https://github.com/dot-do/dotdo",
    "directory": "packages/[name]"
  },
  "license": "MIT",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

### Phase 2: Service Repos (External)

Create managed service repos for each library:

```bash
# Create repo
gh repo create dot-do/[name].do --public

# Initialize with dual-layer structure
[name].do/
├── core/                # Re-exports or extends @dotdo/[name]
│   └── index.ts
├── src/
│   ├── index.ts        # Service entry point
│   ├── do/
│   │   ├── index.ts    # [Name]DO class
│   │   └── module.ts   # DO logic
│   ├── storage/
│   │   ├── r2.ts       # R2 backend
│   │   └── d1.ts       # D1 backend (if applicable)
│   └── types.ts
├── package.json
├── wrangler.toml
├── tsconfig.json
└── README.md
```

**Package.json Template (Service):**
```json
{
  "name": "[name].do",
  "version": "0.1.0",
  "description": "Managed [Name] service on Cloudflare Workers",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js"
    },
    "./do": {
      "types": "./dist/do/index.d.ts",
      "import": "./dist/do/index.js"
    }
  },
  "dependencies": {
    "@dotdo/[name]": "workspace:*"
  },
  "peerDependencies": {
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

### Phase 3: Submodule Integration

Link service repos to sdks monorepo:

```bash
cd /Users/nathanclevenger/projects/sdks
git submodule add git@github.com:dot-do/mongo.do services/mongo
git submodule add git@github.com:dot-do/kafka.do services/kafka
```

---

## Library Classification

### Tier A: Database Services (Priority)

These benefit most from the DO pattern:

| Library | Core Package | Service Repo | Notes |
|---------|--------------|--------------|-------|
| mongo | @dotdo/mongo | mongo.do | Document store on D1/R2 |
| postgres | @dotdo/postgres | postgres.do | SQL proxy + connection pooling |
| redis | @dotdo/redis | redis.do | KV + pub/sub on DO state |
| kafka | @dotdo/kafka | kafka.do | Message queue on Queues + DO |
| duckdb | @dotdo/duckdb | duckdb.do | Analytics on WASM |
| couchdb | @dotdo/couchdb | couchdb.do | Doc store with sync |

### Tier B: API Services

| Library | Core Package | Service Repo | Notes |
|---------|--------------|--------------|-------|
| stripe | @dotdo/stripe | stripe.do | Payments abstraction |
| sendgrid | @dotdo/sendgrid | sendgrid.do | Email delivery |
| twilio | @dotdo/twilio | twilio.do | SMS/Voice |
| slack | @dotdo/slack | slack.do | Slack client |
| discord | @dotdo/discord | discord.do | Discord client |

### Tier C: Infrastructure

| Library | Core Package | Service Repo | Notes |
|---------|--------------|--------------|-------|
| s3 | @dotdo/s3 | s3.do | Object storage on R2 |
| sqs | @dotdo/sqs | sqs.do | Queue on Queues |
| pusher | @dotdo/pusher | pusher.do | WebSockets on DO |

### Tier D: Shared/Internal

Keep in `compat/` or move to `packages/shared`:

| Library | Action |
|---------|--------|
| core | Move to packages/core |
| shared | Move to packages/shared |

---

## File Structure Changes

### Before (Current)
```
compat/
├── mongo/
│   ├── index.ts
│   ├── types.ts
│   └── tests/
├── kafka/
├── redis/
└── ... (42 total)
```

### After (Target)
```
packages/                    # Core packages (@dotdo/*)
├── mongo/
│   ├── src/
│   ├── package.json
│   └── tsup.config.ts
├── kafka/
├── redis/
└── core/                   # Shared utilities

primitives/                  # Submodules to [name].do repos
├── fsx                     # → fsx.do
├── gitx                    # → gitx.do
├── bashx                   # → bashx.do
├── mongo                   # → mongo.do (NEW)
├── kafka                   # → kafka.do (NEW)
└── redis                   # → redis.do (NEW)

compat/                      # Deprecated, soft links only
└── README.md               # Migration notice
```

---

## Implementation Steps

### Step 1: Create Package Template

```bash
# Create generator script
scripts/create-compat-package.ts
```

### Step 2: Migrate Existing Published Packages

Priority order (already have package.json):
1. stripe
2. linear
3. postgres
4. duckdb
5. sentry
6. pusher
7. sqs
8. supabase-auth

### Step 3: Migrate Remaining Libraries

Batch by category:
- Batch 1: Databases (mongo, redis, kafka, couchdb)
- Batch 2: Messaging (sendgrid, twilio, slack, discord)
- Batch 3: APIs (shopify, github, hubspot, etc.)
- Batch 4: AI (anthropic, openai, cohere, google-ai)

### Step 4: Create Service Repos

For each library that needs managed hosting:
1. Create repo at github.com/dot-do/[name].do
2. Set up dual-layer structure
3. Add as submodule to sdks repo
4. Configure wrangler deployment

### Step 5: Update Root Workspace

```json
// package.json
{
  "workspaces": [
    "packages/*",
    "primitives/*",
    "app",
    "cli"
  ]
}
```

### Step 6: Deprecate compat/

1. Add README.md explaining migration
2. Update imports throughout codebase
3. Eventually remove compat/ directory

---

## Package Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Core library | @dotdo/[name] | @dotdo/mongo |
| Managed service | [name].do | mongo.do |
| Worker binding | [NAME] | MONGO |
| DO class | [Name]DO | MongoDO |

---

## Testing Strategy

### Core Packages
- Unit tests with in-memory backends
- No Cloudflare dependencies
- Can run in Node.js

### Service Packages
- Integration tests with Miniflare
- Workers runtime tests
- E2E tests with real DO instances

---

## Timeline Estimation

| Phase | Work Items | Effort |
|-------|------------|--------|
| Phase 1 | Package template, 8 published migrations | Medium |
| Phase 2 | 15 more library migrations | Medium |
| Phase 3 | Service repo setup (6 priority) | High |
| Phase 4 | Remaining migrations + cleanup | Medium |

---

## Open Questions

1. **Backwards compatibility**: Should compat/ re-export from packages/?
2. **Versioning**: Independent versions or coordinated releases?
3. **Documentation**: Centralized docs site or per-package?
4. **Which services need managed hosting**: All or subset?

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Create package template generator script
3. [ ] Migrate first library (mongo) as proof of concept
4. [ ] Set up CI/CD for package publishing
5. [ ] Create first service repo (mongo.do)
6. [ ] Document patterns for contributors
