# .do Platform Architecture

> **AI. Humans. Identity.**

The .do platform is a distributed application framework built on Cloudflare Durable Objects, enabling AI-native applications with built-in identity, integrations, and human-in-the-loop workflows.

---

## Platform Overview

```
                              +-----------------------+
                              |      id.org.ai        |
                              |  (Root Identity DO)   |
                              |  Default IdP for all  |
                              +-----------+-----------+
                                          |
                    +---------------------+---------------------+
                    |                     |                     |
          +---------v--------+  +---------v--------+  +---------v--------+
          |   Business DO    |  |   Business DO    |  |   Business DO    |
          |  acme.example    |  | startup.inc      |  |  agency.co       |
          +--------+---------+  +--------+---------+  +--------+---------+
                   |                     |                     |
          +--------v--------+   +--------v--------+   +--------v--------+
          |     App DO      |   |     App DO      |   |     App DO      |
          |  (CRM, ERP...)  |   |  (Dashboard...) |   |  (Studio...)    |
          +--------+--------+   +-----------------+   +-----------------+
                   |
     +-------------+-------------+
     |             |             |
+----v----+  +----v----+  +-----v-----+
| Site DO |  | Site DO |  | Entity DO |
| (docs)  |  | (app)   |  | (Customer)|
+---------+  +---------+  +-----------+
```

### Core Principles

1. **URL-Based Identity** - Every DO has a namespace URL (e.g., `https://startups.studio`)
2. **Append-Only Versioning** - Things are versioned, not mutated; time travel is free
3. **Federated Auth** - All DOs can federate identity to parent or to `id.org.ai`
4. **Integration-First** - OAuth providers baked in, no Zapier/Composio needed
5. **AI + Human Unified** - Agents and Humans share the same Worker interface

---

## Core Primitives

### 1. Triggers

Events that initiate workflows:

```
+------------------+     +------------------+     +------------------+
|    Providers     |     |      Cron        |     |    Webhooks      |
|  (GitHub, Slack) |     | ($.every.Monday) |     | (/api/webhooks/) |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         +------------------------+------------------------+
                                  |
                          +-------v-------+
                          |   Event Bus   |
                          | (DO internal) |
                          +---------------+
```

**Event Subscription DSL:**
```typescript
// Subscribe to domain events
$.on.Customer.created(async (event) => { ... })
$.on.Invoice.paid(async (event) => { ... })

// Schedule recurring tasks
$.every.Monday.at9am(async () => { ... })
$.every('daily at 6am', async () => { ... })
```

### 2. Searches

Queries across local SQLite and linked provider APIs:

```
+-------------------+
|   Search Query    |
+--------+----------+
         |
         v
+--------+----------+     +-------------------+
|  Local SQLite     |     |  Linked Providers |
|  - Full-text      |     |  - GitHub repos   |
|  - Vector (MRL)   |     |  - Slack channels |
|  - Semantic hash  |     |  - CRM contacts   |
+--------+----------+     +--------+----------+
         |                         |
         +------------+------------+
                      |
              +-------v-------+
              | Merged Results|
              +---------------+
```

**Search Index Schema:**
```
search
+-------+----------+-------------+-----------+
| $id   | $type    | content     | embedding |
+-------+----------+-------------+-----------+
| URL   | Noun     | searchable  | 128-dim   |
|       |          | text        | MRL vec   |
+-------+----------+-------------+-----------+
```

### 3. Actions (Functions)

Four function types with different execution characteristics:

```
+------------------------------------------------------------------------------+
|                            Function Types                                     |
+------------------------------------------------------------------------------+
|                                                                              |
|  +------------------+    +------------------+                                |
|  |  CodeFunction    |    | GenerativeFunc   |                                |
|  |  Traditional     |    | AI completion    |                                |
|  |  serverless      |    | (single call)    |                                |
|  +------------------+    +------------------+                                |
|                                                                              |
|  +------------------+    +------------------+                                |
|  |  AgenticFunction |    |  HumanFunction   |                                |
|  |  AI + Tools      |    |  Human-in-loop   |                                |
|  |  (loop)          |    |  via channels    |                                |
|  +------------------+    +------------------+                                |
|                                                                              |
+------------------------------------------------------------------------------+
```

**Execution Durability Spectrum:**
```typescript
$.send(event, data)    // Fire-and-forget (non-blocking, non-durable)
$.try(action, data)    // Quick attempt (blocking, non-durable)
$.do(action, data)     // Durable execution (blocking, retries, guaranteed)
```

---

## Durable Object Hierarchy

```
                                 +------------------+
                                 |        DO        |
                                 |   (Base Class)   |
                                 +--------+---------+
                                          |
          +---------------+---------------+---------------+---------------+
          |               |               |               |               |
    +-----v-----+   +-----v-----+   +-----v-----+   +-----v-----+  +------v------+
    |  Business |   |    App    |   |   Site    |   |  Worker   |  |   Entity    |
    +-----------+   +-----+-----+   +-----------+   +-----+-----+  +------+------+
                          |                               |               |
                    +-----v-----+                   +-----+-----+   +-----+-----+
                    |   SaaS    |                   |     |     |   | Collection|
                    +-----------+               +---v---+ +--v--+   | Directory |
                                                | Agent | |Human|   | Package   |
                                                +-------+ +-----+   +-----------+
```

### Class Purposes

| Class | Purpose | Example |
|-------|---------|---------|
| **DO** | Base class with storage, workflow context, versioning | All objects inherit |
| **Business** | Multi-tenant organization container | `acme-corp` |
| **App** | Application within a business | `crm-app`, `dashboard` |
| **Site** | Website/domain within an app | `docs.acme.com` |
| **Worker** | Base for work-performing entities | Common interface |
| **Agent** | AI-powered autonomous worker | `support-agent` |
| **Human** | Human worker with approval flows | `john@acme.com` |
| **Entity** | Domain object container | `Customer`, `Order` |
| **Function** | Serverless execution unit | Deployed functions |
| **Workflow** | Multi-step process orchestration | Approval flows |

---

## Data Model

Every DO inherits a unified data model with append-only semantics:

```
+------------------+      +------------------+      +------------------+
|     THINGS       |      |     ACTIONS      |      |     EVENTS       |
| (Version Log)    |      | (Command Log)    |      | (Domain Events)  |
+------------------+      +------------------+      +------------------+
| rowid = version  |      | verb             |      | verb             |
| id               |<-----| input (rowid)    |----->| source           |
| type (FK nouns)  |<-----| output (rowid)   |      | data             |
| branch           |      | actor            |      | actionId         |
| name             |      | target           |      | sequence         |
| data (JSON)      |      | durability       |      | streamed         |
| deleted          |      | status           |      +------------------+
+------------------+      +------------------+

+------------------+      +------------------+
|     OBJECTS      |      |     SEARCH       |
| (DO References)  |      | (FTS + Vector)   |
+------------------+      +------------------+
| ns (URL)         |      | $id              |
| id (CF DO ID)    |      | $type            |
| class            |      | content          |
| relation         |      | embedding        |
| region           |      | cluster          |
| shardKey         |      | semanticL1/L2/L3 |
+------------------+      +------------------+
```

### Version & Branch Addressing

Git-like `@ref` syntax for time travel:

```
https://startups.studio/acme              -> HEAD of main
https://startups.studio/acme@main         -> explicit main branch
https://startups.studio/acme@experiment   -> experiment branch
https://startups.studio/acme@v1234        -> specific version (rowid)
https://startups.studio/acme@~1           -> one version back
```

### Lifecycle Operations

```typescript
await do.fork({ to: 'https://new.ns' })   // New identity from current state
await do.compact()                         // Squash history, same identity
await do.moveTo('ORD')                     // Relocate to different colo
await do.branch('experiment')              // Create branch
await do.checkout('@v1234')                // Switch to version/branch
await do.merge('experiment')               // Merge branch
```

---

## Integration Architecture

### First-Class Integrations

```
+------------------------------------------------------------------+
|                         DO Instance                               |
|                                                                   |
|  this.integration('github')  ----+                               |
|  this.integration('slack')   ----+---> Integration Manager       |
|  this.integration('stripe')  ----+     - Token refresh           |
|                                        - Rate limiting            |
|                                        - Retry logic              |
|                                        - Webhook verification     |
+------------------------------------------------------------------+
                              |
              +---------------+---------------+
              |               |               |
        +-----v-----+   +-----v-----+   +-----v-----+
        |  GitHub   |   |   Slack   |   |  Stripe   |
        |   API     |   |   API     |   |   API     |
        +-----------+   +-----------+   +-----------+
```

**No Zapier/Composio needed** - integrations are baked into the platform:

- OAuth flows handled by auth module
- Token storage in WorkOS Vault (or DO storage)
- Automatic token refresh before expiry
- Rate limit handling with exponential backoff
- Webhook signature verification

### Linked Accounts Flow

```
1. User initiates: npx org.ai link github
2. OAuth redirect to provider
3. Callback stores tokens
4. DO can now call: this.integration('github').repos.list()
```

---

## Auth Architecture

```
+-------------------------------------------------------------------------+
|                      CENTRAL AUTH DOMAIN                                 |
|                      (auth.headless.ly)                                  |
|                                                                          |
|   OAuth Providers:                                                       |
|   +-- Google  -> callback: auth.headless.ly/api/auth/callback/google    |
|   +-- GitHub  -> callback: auth.headless.ly/api/auth/callback/github    |
|   +-- SSO     -> per-org SAML/OIDC via WorkOS                           |
|                                                                          |
|   Stores: users, sessions, accounts, organizations, members              |
+------------------------------------+------------------------------------+
                                     |
                                     | After OAuth:
                                     | 1. Create session
                                     | 2. Generate one-time token
                                     | 3. Redirect to tenant domain
                                     v
+-------------------------------------------------------------------------+
|                         TENANT DOMAIN                                    |
|              (crm.acme.com, acme.crm.headless.ly)                        |
|                                                                          |
|   /auth/login?provider=google  -> Redirect to auth domain               |
|   /auth/callback?auth_token=x  -> Exchange token for session            |
|   /auth/session                -> Get current session                   |
|   /auth/logout                 -> Clear session cookie                  |
|                                                                          |
|   Route to Tenant DO: organizations[slug].tenantNs -> DO namespace      |
+-------------------------------------------------------------------------+
```

### Better-Auth Configuration

```typescript
betterAuth({
  plugins: [
    organization(),      // Multi-tenancy
    admin(),             // Admin roles
    apiKey(),            // API key auth
    sso(),               // Enterprise SAML/OIDC
    oauthProvider(),     // Your app as OAuth provider (for MCP)
    stripe(),            // Subscription billing
  ]
})
```

### Identity Types

| Type | Description | Auth Method |
|------|-------------|-------------|
| **Human** | Real person | WorkOS AuthKit (OAuth, SSO, MFA) |
| **Agent** | AI worker | API key or OAuth client credentials |
| **Service** | System-to-system | API key or mTLS |

### Federation

By default, every DO federates identity to its parent DO, with `id.org.ai` as the ultimate root:

```
Your App DO
    |
    +---> Parent Business DO
              |
              +---> id.org.ai (root identity provider)
```

---

## API Routes (Hono Middleware)

```
+------------------------------------------------------------------+
|                         API Router                                |
+------------------------------------------------------------------+
|                                                                   |
|  /api/webhooks/:source     POST   Inbound webhooks from providers|
|                                   - GitHub, Stripe, Slack, etc.  |
|                                   - Signature verification       |
|                                                                   |
|  /api/search/:type         GET    Search across resources        |
|                                   - Full-text + vector           |
|                                   - Federated to providers       |
|                                                                   |
|  /api/:type/:id            CRUD   REST resources                 |
|                                   - Maps to Things in DO         |
|                                   - Version headers supported    |
|                                                                   |
|  /api/actions/:action      POST   Execute named actions          |
|                                   - CodeFunction invocation      |
|                                   - AgenticFunction invocation   |
|                                                                   |
|  /api/workflows/:workflow  *      Workflow operations            |
|                                   - Start, pause, resume, cancel |
|                                   - Step status and history      |
|                                                                   |
+------------------------------------------------------------------+
```

### Request Flow

```
Request --> Hono Router --> Auth Middleware --> DO Resolution --> DO.fetch()
                               |                     |
                               v                     v
                          Session/API Key       ns + path lookup
                          validation            in objects table
```

---

## CLI (org.ai)

```
npx org.ai <command> [options]

+------------------------------------------------------------------+
|                         CLI Commands                              |
+------------------------------------------------------------------+
|                                                                   |
|  Authentication:                                                  |
|    login              Device auth flow (like gh auth login)      |
|    logout             Clear stored credentials                   |
|    whoami             Show current identity                      |
|                                                                   |
|  Integrations:                                                    |
|    link <provider>    OAuth flow to connect provider             |
|    unlink <provider>  Remove provider connection                 |
|    integrations       List connected providers                   |
|                                                                   |
|  Resources:                                                       |
|    agents list        List AI agents                             |
|    agents create      Create new agent                           |
|    functions deploy   Deploy a function                          |
|    functions invoke   Invoke a function                          |
|    workflows list     List workflows                             |
|    workflows run      Start a workflow                           |
|                                                                   |
+------------------------------------------------------------------+
```

### Token Storage Priority

```
1. Environment variable: ORG_AI_TOKEN
2. Config file: ~/.config/org.ai/credentials.json
3. (Future) System keychain via keytar
```

### Device Auth Flow

```
$ npx org.ai login

1. Open browser to: https://id.org.ai/device
2. Enter code: ABCD-1234
3. Waiting for authorization...
4. Success! Logged in as nathan@example.com
```

---

## WorkOS Integration

```
+------------------------------------------------------------------+
|                      WorkOS Services                              |
+------------------------------------------------------------------+
|                                                                   |
|  AuthKit                                                          |
|  +-- Human authentication (OAuth, SAML, MFA)                     |
|  +-- Hosted login pages                                          |
|  +-- User management                                             |
|                                                                   |
|  Vault                                                            |
|  +-- Secure token storage for OAuth refresh tokens               |
|  +-- Encrypted at rest and in transit                            |
|  +-- Automatic rotation support                                  |
|                                                                   |
|  FGA (Fine-Grained Authorization) [Coming]                       |
|  +-- ReBAC (Relationship-Based Access Control)                   |
|  +-- Policy evaluation at edge                                   |
|  +-- Audit trail                                                 |
|                                                                   |
|  Audit Logs                                                       |
|  +-- All auth events logged                                      |
|  +-- Exportable to SIEM                                          |
|  +-- Compliance reporting                                        |
|                                                                   |
+------------------------------------------------------------------+
```

### AuthKit Integration

```typescript
// Worker entry point
export default {
  async fetch(request, env) {
    // Redirect to WorkOS AuthKit for login
    if (request.url.endsWith('/login')) {
      return Response.redirect(env.WORKOS_AUTHKIT_URL)
    }

    // Verify session from AuthKit
    const session = await verifyAuthKitSession(request, env)
    // ...
  }
}
```

---

## Worker Interface (AI + Human Unified)

```
+------------------------------------------------------------------+
|                       Worker Interface                            |
+------------------------------------------------------------------+
|                                                                   |
|  async do(task, context)       Execute a task                    |
|  async ask(question, context)  Get an answer                     |
|  async decide(question, opts)  Make a decision                   |
|  async approve(request)        Approval workflow                 |
|  async generate<T>(prompt)     Structured output                 |
|  async notify(message, chans)  Send notifications                |
|                                                                   |
+------------------------------------------------------------------+
               |                                  |
               v                                  v
+-----------------------------+    +-----------------------------+
|          Agent              |    |          Human              |
| (AI-powered, autonomous)    |    | (Manual, approval flows)    |
+-----------------------------+    +-----------------------------+
| mode: 'autonomous'          |    | mode: 'manual'              |
| tools: Map<string, Tool>    |    | channels: NotificationChan[]|
| memory: Memory[]            |    | escalationPolicy: Policy    |
|                             |    |                             |
| run(goal) -> GoalResult     |    | requestApproval(req)        |
| observe() -> state          |    | submitApproval(id, result)  |
| think() -> action           |    | checkEscalations()          |
| act(action)                 |    | getPendingApprovals()       |
+-----------------------------+    +-----------------------------+
```

### Agentic Loop (Agent)

```typescript
async run(goal: Goal): Promise<GoalResult> {
  while (iteration < maxIterations) {
    const observation = await this.observe()        // Current state
    const action = await this.think(goal, obs)      // AI reasoning

    if (action.type === 'complete') {
      return { success: true, result: action.result }
    }

    await this.act(action)                          // Execute tool
    iteration++
  }
}
```

### Human-in-the-Loop (Human)

```typescript
async requestApproval(request: ApprovalRequest): Promise<void> {
  // Store pending approval
  await this.ctx.storage.put(`pending:${request.id}`, request)

  // Notify via all channels (email, Slack, SMS)
  for (const channel of this.channels) {
    await this.sendToChannel(message, channel)
  }

  // Schedule escalation check
  if (this.escalationPolicy) {
    await this.scheduleEscalation(request.id)
  }
}
```

---

## Event Streaming

```
+------------------------------------------------------------------+
|                      Event Flow                                   |
+------------------------------------------------------------------+
|                                                                   |
|  DO Internal                                                      |
|  +-----------+      +------------+      +------------+           |
|  |  Action   | ---> |   Event    | ---> |  Events    |           |
|  | executed  |      |  emitted   |      |  table     |           |
|  +-----------+      +-----+------+      +------------+           |
|                           |                                       |
|                           v                                       |
|  Cloudflare          +----+-----+                                |
|  Pipeline            | Pipeline |                                |
|                      +----+-----+                                |
|                           |                                       |
|                           v                                       |
|  R2 Storage          +----+-----+      +------------+            |
|                      | Iceberg  | ---> |   R2 SQL   |            |
|                      |  tables  |      |  queries   |            |
|                      +----------+      +------------+            |
|                                                                   |
+------------------------------------------------------------------+
```

### Event Schema

```typescript
events = {
  id: UUID,
  verb: 'created' | 'updated' | 'deleted' | ...,
  source: 'startups.studio/Startup/acme',  // URL
  data: { ... },                            // Payload
  actionId: UUID,                           // Related action
  sequence: number,                         // Ordering
  streamed: boolean,                        // Sent to Pipeline?
  createdAt: timestamp
}
```

---

## Deployment Configuration

```toml
# wrangler.toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-11-12"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "BUSINESS", class_name = "Business" },
  { name = "APP", class_name = "App" },
  { name = "SITE", class_name = "Site" },
  { name = "AGENT", class_name = "Agent" },
  { name = "HUMAN", class_name = "Human" },
  { name = "ENTITY", class_name = "Entity" },
  { name = "FUNCTION", class_name = "Function" },
  { name = "WORKFLOW", class_name = "Workflow" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Business", "App", "Site", "Agent", "Human", "Entity", "Function", "Workflow"]

[[pipelines]]
name = "events"
binding = "PIPELINE"

[[r2_buckets]]
binding = "ANALYTICS"
bucket_name = "analytics"
```

---

## Security Model

### Authentication Layers

```
+------------------------------------------------------------------+
|  Layer 1: Edge (Cloudflare)                                       |
|  - DDoS protection                                                |
|  - WAF rules                                                      |
|  - Bot management                                                 |
+------------------------------------------------------------------+
|  Layer 2: Auth Middleware                                         |
|  - Session validation (better-auth)                               |
|  - API key verification                                           |
|  - OAuth token validation                                         |
+------------------------------------------------------------------+
|  Layer 3: DO-Level                                                |
|  - Namespace authorization (is this DO accessible?)               |
|  - Action-level permissions                                       |
|  - Federation to parent for policy                                |
+------------------------------------------------------------------+
```

### Token Types

| Token | Scope | Lifetime | Storage |
|-------|-------|----------|---------|
| Session | User browser | 7 days | Cookie |
| API Key | Service auth | Configurable | Env/Config |
| OAuth Access | Provider API | 1 hour | WorkOS Vault |
| OAuth Refresh | Token renewal | 90 days | WorkOS Vault |
| Cross-Domain | Session transfer | 1 minute | DB (one-time) |

---

## Glossary

| Term | Definition |
|------|------------|
| **DO** | Durable Object - Cloudflare's stateful serverless primitive |
| **Namespace (ns)** | The URL identity of a DO (e.g., `https://startups.studio`) |
| **Thing** | A versioned entity stored in a DO's SQLite |
| **Action** | A logged command that creates/modifies Things |
| **Event** | A domain event emitted after Actions |
| **Worker** | Base class for entities that perform work (Agent, Human) |
| **Integration** | Connected OAuth provider (GitHub, Slack, etc.) |
| **Federation** | Delegating auth/policy to parent DO |
| **id.org.ai** | Root identity provider for the platform |

---

## Related Documentation

- [Getting Started](/docs/getting-started)
- [API Reference](/docs/api)
- [CLI Reference](/docs/cli)
- [SDK Documentation](/docs/sdk)
- [RPC Patterns](/docs/rpc)
