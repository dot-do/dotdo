# Compat Layer Extraction Design

## Goal

Extract all compat layers from dotdo to `dot-do/compat` private repo so dotdo can focus exclusively on core DO primitives.

## Current State

| Location | Count | Description |
|----------|-------|-------------|
| `compat/` | 93 dirs | API compat implementations |
| `packages/` | ~54 dirs | Mix of compat + core packages |
| Overlap | ~20 | Duplicated between compat/ and packages/ |

**Problems:**
- Compat noise distracts from core DO work
- Duplication between `compat/` and `packages/`
- Hand-written types (not using official SDK types)
- No dependency on official packages for type safety

## Target Architecture

### dotdo (this repo) - Core Runtime

```
dotdo/
├── objects/           # DO base classes (DOBase, Entity, Agent, Human, Workflow)
├── primitives/        # Submodules: fsx, gitx, bashx, npmx, pyx
├── workflows/         # $ context, event handlers, scheduling
├── db/                # Storage primitives, Drizzle schemas
├── types/             # Thing, Noun, Verb, WorkflowContext
├── packages/
│   ├── dotdo/         # Main package
│   ├── client/        # @dotdo/client
│   ├── rpc/           # @dotdo/rpc (Cap'n Web)
│   ├── core/          # @dotdo/core
│   ├── primitives-core/
│   ├── path-utils/
│   ├── react/         # React bindings
│   ├── tanstack/      # TanStack bindings
│   └── worker-*/      # Worker utilities
├── workers/           # DO proxy workers
├── api/               # Hono HTTP layer
├── app/               # TanStack Start frontend
└── lib/               # Shared utilities
```

### dot-do/compat (new private repo) - API Compatibility Layers

```
dot-do/compat/
├── turbo.json
├── pnpm-workspace.yaml
├── packages/
│   ├── stripe/        # @dotdo/stripe
│   ├── redis/         # @dotdo/redis
│   ├── postgres/      # @dotdo/postgres
│   ├── kafka/         # @dotdo/kafka
│   ├── mongo/         # @dotdo/mongo
│   ├── ... (93 total)
│   └── core/          # Shared compat utilities (errors, retry)
└── .github/
    └── workflows/     # CI/CD
```

## Package Design

Each compat package should:

1. **Depend on official SDK** for types
2. **Export official types** (re-export from SDK)
3. **Implement API** backed by DO storage or external service
4. **Use `@dotdo/client`** for DO communication (when reimplementing)

```typescript
// packages/stripe/src/index.ts
import Stripe from 'stripe'

// Re-export official types
export type { Stripe }

// Edge-friendly client that calls real Stripe
export class StripeClient {
  constructor(apiKey: string) { ... }
  customers: CustomersResource
  // ...
}
```

```typescript
// packages/mongo/src/index.ts
import { MongoClient, Collection, Db } from 'mongodb'

// Re-export official types
export type { MongoClient, Collection, Db }

// DO-backed implementation
export class MongoCompat implements MongoClientInterface {
  constructor(doClient: DotdoClient) { ... }
  // Stores documents in DO storage
}
```

## Compat Categories

| Category | Depends On | Storage |
|----------|------------|---------|
| **SDK/Client** (stripe, twilio) | Official SDK | External service |
| **Reimplementation** (mongo, kafka, redis) | Official SDK (types), @dotdo/client | DO storage |
| **Hybrid** (s3→R2, auth0) | Official SDK | Configurable |

## Migration Steps

### Phase 1: Create dot-do/compat repo

1. Create GitHub repo `dot-do/compat` (private)
2. Initialize Turborepo + pnpm workspaces
3. Set up CI/CD, TypeScript config
4. Add `@dotdo/compat-core` package (shared utilities)

### Phase 2: Move compat/ directories

For each of 93 `compat/*` directories:
1. Create `packages/<name>/` in new repo
2. Copy source files
3. Create package.json with official SDK dependency
4. Update imports to use official types

### Phase 3: Consolidate packages/ overlap

For packages that exist in both `compat/` and `packages/`:
1. Merge into single package in new repo
2. Prefer `packages/` version if more complete
3. Delete from dotdo

### Phase 4: Update dotdo imports

1. Remove `compat/` directory
2. Remove compat packages from `packages/`
3. Update `streaming/unified-query.ts` imports
4. Update any other references

### Phase 5: Beads cleanup

1. Close/archive compat-related beads issues
2. Create new beads in dot-do/compat repo
3. Update dotdo beads to focus on core DO work

## Packages to Move

### From compat/ (93)

ably, airbyte, algolia, amplitude, analytics, anthropic, auth, auth0, automation, benthos, calendly, calls, chroma, clerk, close, cloudinary, cohere, contentful, convertkit, core, couchdb, crm, cubejs, datadog, discord, docusign, doppler, duckdb, elasticsearch, emails, fcm, firebase-auth, flags, flink, freshdesk, gcs, github, gitlab, google-ai, helpscout, hubspot, intercom, jira, klaviyo, launchdarkly, linear, mailchimp, mapbox, medusa, meilisearch, memcached, messagebird, metabase, mixpanel, n8n, neo4j, onesignal, openai, payload, pinecone, pipedrive, postgres, pubsub, pusher, qdrant, quickbooks, resend, s3, salesforce, segment, sendgrid, sentry, shopify, slack, socketio, square, sqs, stripe, supabase, supabase-auth, tally, twilio, typesense, vault, vitals, vonage, weaviate, woocommerce, zapier, zendesk, zoom

### From packages/ (compat-related, ~20)

algolia, analytics, anthropic, auth, automation, benthos, calls, cohere, couchdb, cubejs, discord, duckdb, emails, flags, flink, gcs, github, google-ai, hubspot, intercom, kafka, linear, mongo, n8n, openai, payload, postgres, pusher, redis, salesforce, segment, sendgrid, sentry, shopify, sqs, stripe, supabase, supabase-auth, turso, twilio, zapier, zendesk

### Stay in dotdo

client, core, dotdo, landing, path-utils, primitives-core, react, rpc, shared, tanstack, worker-helpers, worker-types

## Success Criteria

- [ ] dotdo repo has no `compat/` directory
- [ ] dotdo `packages/` contains only core packages
- [ ] dot-do/compat repo has all 93+ compat packages
- [ ] All compat packages depend on official SDKs for types
- [ ] CI passing in both repos
- [ ] Beads issues split appropriately
