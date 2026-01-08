# Database Schema

Drizzle ORM with SQLite (Durable Object storage). Extends better-auth schema with versioned entities, event sourcing, and graph relationships.

## Overview

- **ORM**: Drizzle ORM
- **Storage**: SQLite via Cloudflare Durable Objects
- **Auth**: Extends better-auth schema
- **Architecture**: Event-sourced with append-only version logs

## Schema Files

| File | Purpose |
|------|---------|
| `auth.ts` | Authentication (better-auth + extensions) |
| `things.ts` | Versioned entities (append-only) |
| `actions.ts` | Command log / event sourcing |
| `verbs.ts` | Predicate registry for natural language |
| `nouns.ts` | Type registry for validation |
| `relationships.ts` | Graph edges (URL-based) |
| `events.ts` | Domain events |
| `search.ts` | Full-text + vector search index |
| `branches.ts` | Git-like branching |
| `objects.ts` | DO-to-DO references |
| `index.ts` | Schema exports |

---

## Auth Schema (extends better-auth)

Complete better-auth schema with enterprise plugins. Generate/update with:

```bash
npx @better-auth/cli generate
```

### Core Tables

#### users
Standard better-auth users with admin and Stripe extensions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `name` | text | Display name |
| `email` | text | Unique email |
| `emailVerified` | boolean | Email verification status |
| `image` | text | Avatar URL |
| `role` | text | 'user', 'admin', 'owner' (admin plugin) |
| `banned` | boolean | Ban status (admin plugin) |
| `banReason` | text | Reason for ban |
| `banExpires` | timestamp | Ban expiration |
| `stripeCustomerId` | text | Stripe customer ID (stripe plugin) |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### sessions

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `userId` | text | FK to users |
| `token` | text | Unique session token |
| `expiresAt` | timestamp | Expiration time |
| `ipAddress` | text | Client IP |
| `userAgent` | text | Client user agent |
| `activeOrganizationId` | text | Current org context (org plugin) |
| `activeTeamId` | text | Current team context (org plugin) |
| `impersonatedBy` | text | Admin impersonation (admin plugin) |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### accounts (OAuth/SSO provider links)

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `userId` | text | FK to users |
| `accountId` | text | ID from SSO provider |
| `providerId` | text | 'google', 'github', etc. |
| `accessToken` | text | OAuth access token |
| `refreshToken` | text | OAuth refresh token |
| `accessTokenExpiresAt` | timestamp | Token expiration |
| `refreshTokenExpiresAt` | timestamp | Refresh token expiration |
| `scope` | text | OAuth scopes |
| `idToken` | text | OIDC ID token |
| `password` | text | For email/password auth |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### verifications

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `identifier` | text | What's being verified (email, phone) |
| `value` | text | Verification code/token |
| `expiresAt` | timestamp | Expiration time |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

### Organization Plugin Tables

#### organizations

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `name` | text | Organization name |
| `slug` | text | Unique URL slug |
| `logo` | text | Logo URL |
| `metadata` | json | Custom org data |
| `tenantNs` | text | DO namespace (e.g., 'https://crm.headless.ly/acme') |
| `region` | text | 'SFO', 'ORD', 'LHR' |
| `createdAt` | timestamp | Created timestamp |

#### members

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `userId` | text | FK to users |
| `organizationId` | text | FK to organizations |
| `role` | text | 'owner', 'admin', 'member', or custom |
| `createdAt` | timestamp | Created timestamp |

#### invitations

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `email` | text | Invitee email |
| `inviterId` | text | FK to users |
| `organizationId` | text | FK to organizations |
| `role` | text | Role to assign |
| `status` | text | 'pending', 'accepted', 'rejected' |
| `teamId` | text | Optional team assignment |
| `expiresAt` | timestamp | Invitation expiration |
| `createdAt` | timestamp | Created timestamp |

#### teams

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `name` | text | Team name |
| `organizationId` | text | FK to organizations |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### teamMembers

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `teamId` | text | FK to teams |
| `userId` | text | FK to users |
| `createdAt` | timestamp | Created timestamp |

### API Key Plugin

#### apiKeys

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `name` | text | Key name |
| `key` | text | Hashed API key |
| `userId` | text | FK to users |
| `prefix` | text | Plaintext prefix for identification |
| `start` | text | First N chars for UI display |
| `rateLimitEnabled` | boolean | Rate limiting toggle |
| `rateLimitTimeWindow` | integer | Rate limit window (ms) |
| `rateLimitMax` | integer | Max requests per window |
| `requestCount` | integer | Current request count |
| `lastRequest` | timestamp | Last request time |
| `remaining` | integer | Remaining requests |
| `lastRefillAt` | timestamp | Last refill time |
| `refillInterval` | integer | Refill interval (ms) |
| `refillAmount` | integer | Refill amount |
| `expiresAt` | timestamp | Key expiration |
| `enabled` | boolean | Key enabled status |
| `permissions` | json | Permission set |
| `metadata` | json | Custom metadata |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

### SSO Plugin

#### ssoProviders

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `providerId` | text | Unique provider identifier |
| `issuer` | text | OIDC/SAML issuer URL |
| `domain` | text | Associated email domain |
| `organizationId` | text | FK to organizations |
| `oidcConfig` | json | OIDC-specific configuration |
| `samlConfig` | json | SAML-specific configuration |
| `mapping` | json | Attribute mapping |
| `domainVerified` | boolean | Domain verification status |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

### OAuth Provider Plugin (when your app IS the OAuth provider)

#### oauthClients

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `clientId` | text | Unique client ID |
| `clientSecret` | text | Hashed secret |
| `name` | text | Client name |
| `uri` | text | Client URI |
| `icon` | text | Client icon |
| `redirectUris` | json | Allowed redirect URIs |
| `scopes` | json | Allowed scopes |
| `grantTypes` | json | Allowed grant types |
| `responseTypes` | json | Allowed response types |
| `tokenEndpointAuthMethod` | text | Auth method |
| `type` | text | 'web', 'native', 'user-agent-based' |
| `public` | boolean | Public client flag |
| `disabled` | boolean | Client disabled |
| `skipConsent` | boolean | Skip consent screen |
| `userId` | text | Owner user |
| `organizationId` | text | Owner organization |
| `metadata` | json | Custom metadata |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### oauthAccessTokens

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `token` | text | Hashed token |
| `clientId` | text | FK to oauthClients |
| `userId` | text | FK to users |
| `sessionId` | text | Session reference |
| `refreshId` | text | Linked refresh token |
| `organizationId` | text | Org context |
| `scopes` | json | Granted scopes |
| `expiresAt` | timestamp | Expiration |
| `createdAt` | timestamp | Created timestamp |

#### oauthRefreshTokens

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `token` | text | Hashed token |
| `clientId` | text | FK to oauthClients |
| `userId` | text | FK to users |
| `sessionId` | text | Session reference |
| `organizationId` | text | Org context |
| `scopes` | json | Granted scopes |
| `revoked` | timestamp | Revocation time |
| `expiresAt` | timestamp | Expiration |
| `createdAt` | timestamp | Created timestamp |

#### oauthConsents

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `userId` | text | FK to users |
| `clientId` | text | FK to oauthClients |
| `organizationId` | text | Org context |
| `scopes` | text | Consented scopes |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

#### oauthAuthorizationCodes

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `code` | text | Unique auth code |
| `clientId` | text | FK to oauthClients |
| `userId` | text | FK to users |
| `redirectUri` | text | Redirect URI |
| `scopes` | json | Requested scopes |
| `codeChallenge` | text | PKCE challenge |
| `codeChallengeMethod` | text | PKCE method |
| `state` | text | OAuth state |
| `nonce` | text | OIDC nonce |
| `expiresAt` | timestamp | Expiration |
| `createdAt` | timestamp | Created timestamp |

### Custom Domains

#### customDomains

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `domain` | text | Custom domain (e.g., 'crm.acme.com') |
| `organizationId` | text | FK to organizations |
| `tenantNs` | text | Tenant namespace URL |
| `verified` | boolean | Verification status |
| `verificationToken` | text | DNS TXT record value |
| `verificationMethod` | text | 'dns_txt', 'http', 'cname' |
| `sslStatus` | text | 'pending', 'active', 'failed' |
| `createdAt` | timestamp | Created timestamp |
| `verifiedAt` | timestamp | Verification timestamp |

### Stripe Plugin

#### subscriptions

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `plan` | text | Plan identifier |
| `referenceId` | text | User ID or Org ID |
| `stripeCustomerId` | text | Stripe customer ID |
| `stripeSubscriptionId` | text | Stripe subscription ID |
| `status` | text | Subscription status |
| `periodStart` | timestamp | Billing period start |
| `periodEnd` | timestamp | Billing period end |
| `cancelAtPeriodEnd` | boolean | Cancel at period end flag |
| `cancelAt` | timestamp | Scheduled cancellation |
| `canceledAt` | timestamp | Cancellation timestamp |
| `endedAt` | timestamp | Subscription end |
| `seats` | integer | Number of seats |
| `trialStart` | timestamp | Trial start |
| `trialEnd` | timestamp | Trial end |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

---

## Core Schema

### things (Version Log - Append-Only)

Things are versioned, not mutated. Each row is a version. The `rowid` IS the version ID.

| Column | Type | Description |
|--------|------|-------------|
| `rowid` | integer | Implicit SQLite rowid = version ID |
| `id` | text | Local path: 'acme', 'headless.ly' |
| `type` | integer | FK to nouns.rowid |
| `branch` | text | Branch name (null = main) |
| `name` | text | Display name |
| `data` | json | Entity data |
| `deleted` | boolean | Soft delete marker |

**Query Patterns:**

```sql
-- Current state
SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1

-- Specific version
SELECT * FROM things WHERE rowid = ?

-- Thing at timestamp (join with actions)
SELECT t.* FROM things t
JOIN actions a ON a.output = t.rowid
WHERE t.id = ? AND a.created_at <= ?
ORDER BY t.rowid DESC LIMIT 1
```

### actions (Command Log - Append-Only)

Actions are the source of truth for all mutations. They reference thing versions by rowid.

| Column | Type | Description |
|--------|------|-------------|
| `rowid` | integer | Implicit sequence number |
| `id` | text | UUID for external reference |
| `verb` | text | 'create', 'update', 'delete' (action form) |
| `actor` | text | 'Human/nathan', 'Agent/support' |
| `target` | text | 'Startup/acme' |
| `input` | integer | things.rowid before (null for create) |
| `output` | integer | things.rowid after (null for delete) |
| `options` | json | Additional parameters |
| `durability` | enum | 'send', 'try', 'do' |
| `status` | enum | 'pending', 'running', 'completed', 'failed', 'undone', 'retrying' |
| `error` | json | Error details |
| `requestId` | text | Request correlation |
| `sessionId` | text | Session correlation |
| `workflowId` | text | Workflow correlation |
| `startedAt` | timestamp | Execution start |
| `completedAt` | timestamp | Execution end |
| `duration` | integer | Duration (ms) |
| `createdAt` | timestamp | Created timestamp |

### verbs (Predicate Registry)

Verbs define predicates with linguistic forms for natural language generation.

| Column | Type | Description |
|--------|------|-------------|
| `verb` | text | Primary key. Predicate form: 'creates' |
| `action` | text | Imperative: 'create' |
| `activity` | text | Present participle: 'creating' |
| `event` | text | Past participle: 'created' |
| `reverse` | text | Backward operator: 'createdBy' |
| `inverse` | text | Opposite predicate: 'deletes' |
| `description` | text | Description |

**Convention:** Given event 'created':
- `createdBy` = actor
- `createdAt` = timestamp
- `createdIn` = request/context

### nouns (Type Registry)

Optional type registry for validation and introspection.

| Column | Type | Description |
|--------|------|-------------|
| `noun` | text | Primary key: 'Customer', 'Agent' |
| `plural` | text | 'Customers', 'Agents' |
| `description` | text | Description |
| `schema` | json | Field definitions |
| `doClass` | text | CF binding if DO subclass |

### relationships (Graph Edges - URL-Based)

Fully qualified URL-based edges supporting local, cross-DO, and external references.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `verb` | text | 'created', 'manages', 'owns' |
| `from` | text | Source URL: 'https://startups.studio/headless.ly' |
| `to` | text | Target URL: 'https://github.com/user' |
| `data` | json | Edge properties |
| `createdAt` | timestamp | Created timestamp |

### events (Domain Events)

Domain events for streaming to Pipelines and R2.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `verb` | text | 'created', 'updated', 'deleted' |
| `source` | text | Source URL: 'startups.studio/Startup/acme' |
| `data` | json | Event payload |
| `actionId` | text | FK to actions |
| `sequence` | integer | Sequence within DO |
| `streamed` | boolean | Streamed to Pipelines flag |
| `streamedAt` | timestamp | Stream timestamp |
| `createdAt` | timestamp | Created timestamp |

### search (Full-Text + Vector Index)

Combined full-text and vector search with MRL embeddings.

| Column | Type | Description |
|--------|------|-------------|
| `$id` | text | Primary key. Thing URL |
| `$type` | text | Type (denormalized for filtering) |
| `content` | text | Searchable content |
| `embedding` | blob | Vector embedding (128-768 dim) |
| `embeddingDim` | integer | 128, 256, 512, or 768 |
| `cluster` | integer | Pre-computed cluster |
| `lsh1`, `lsh2`, `lsh3` | text | LSH buckets |
| `semanticL1`, `semanticL2`, `semanticL3` | text | Semantic hierarchy |
| `indexedAt` | timestamp | Index timestamp |

### branches (Git-like Branch Management)

Git-like branching for parallel development.

| Column | Type | Description |
|--------|------|-------------|
| `rowid` | integer | Implicit |
| `name` | text | 'main', 'experiment', 'feature/x' |
| `thingId` | text | Thing ID (not rowid) |
| `head` | integer | things.rowid (current version) |
| `base` | integer | things.rowid (fork point) |
| `forkedFrom` | text | Source branch name |
| `description` | text | Branch description |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Updated timestamp |

**Addressing:**
```
https://example.com/acme              # HEAD of main (default)
https://example.com/acme@main         # explicit main branch
https://example.com/acme@experiment   # experiment branch
https://example.com/acme@v1234        # specific version (rowid)
https://example.com/acme@~1           # one version back
```

**Operations:**
```typescript
$.branch('experiment')   // create branch at current HEAD
$.checkout('experiment') // switch to branch
$.merge('experiment')    // merge into current
```

### objects (DO-to-DO References)

Maps namespace URLs to Cloudflare Durable Object IDs for cross-DO resolution.

| Column | Type | Description |
|--------|------|-------------|
| `ns` | text | Primary key. Namespace URL |
| `id` | text | CF Durable Object ID |
| `class` | text | CF binding: 'DO', 'Startup', etc. |
| `relation` | enum | 'parent', 'child', 'follower', 'shard', 'reference' |
| `shardKey` | text | For sharding |
| `shardIndex` | integer | Shard index |
| `region` | text | For geo-replication |
| `primary` | boolean | Primary replica flag |
| `cached` | json | Cached data for display |
| `createdAt` | timestamp | Created timestamp |

---

## Extending the Schema

To extend the schema in your own DO:

```typescript
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { things } from 'dotdo/db/things'

// Define your domain-specific noun
export const startups = sqliteTable('startups', {
  // Use things.rowid as FK for versioned data
  thingRowid: integer('thing_rowid').notNull(),

  // Domain-specific fields
  stage: text('stage', {
    enum: ['idea', 'mvp', 'seed', 'series-a', 'growth']
  }),
  fundingAmount: integer('funding_amount'),
  foundedAt: integer('founded_at', { mode: 'timestamp' }),

  // Relationships (local paths)
  founderId: text('founder_id'),

}, (table) => [
  index('startups_stage_idx').on(table.stage),
  index('startups_thing_idx').on(table.thingRowid),
])

// Extend the schema object
import { schema as baseSchema } from 'dotdo/db'

export const schema = {
  ...baseSchema,
  startups,
}
```

### Using with Drizzle

```typescript
import { drizzle } from 'drizzle-orm/d1'
import { schema } from './schema'

// In your DO
const db = drizzle(this.ctx.storage.sql, { schema })

// Query with relations
const startup = await db.query.things.findFirst({
  where: eq(things.id, 'acme'),
  orderBy: desc(things.rowid),
})
```

---

## Design Principles

1. **Append-Only**: Things and Actions are never mutated, only appended
2. **Version = rowid**: SQLite's implicit rowid serves as version ID
3. **URL-Based Identity**: Entities are identified by URLs for cross-DO references
4. **Event Sourced**: Actions are the source of truth, Things are projections
5. **Natural Language**: Verbs have linguistic forms for natural API design
6. **Git-like Branching**: Support for parallel development and experimentation
