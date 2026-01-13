# DO API Routes

Hono middleware for Durable Object HTTP API.

## Quick Start - Multi-tenant Routing

Use the `API()` factory from `workers/api.ts` for production deployments:

```ts
import { API } from 'dotdo'

// Hostname mode (default) - subdomain determines tenant
// tenant.api.dotdo.dev -> DO('https://tenant.api.dotdo.dev')
export default API()

// Path mode - path segment determines tenant
// api.dotdo.dev/acme/users -> DO('https://api.dotdo.dev/acme')
export default API({ ns: '/:org' })

// Fixed namespace - all requests to single DO
export default API({ ns: 'main' })
```

## REST Routes (Default DO)

For the main API app, REST-like routes are forwarded to the default DO namespace:

```ts
import { Hono } from 'hono'
import { doRoutes } from 'dotdo/api'

const app = new Hono()
// Routes like /customers, /orders/123 go to DO('default')
app.route('/', doRoutes)
```

Reserved prefixes (`/api`, `/auth`, `/admin`, `/docs`, `/mcp`, `/rpc`) are NOT routed to DO.

---

## Webhooks (Triggers)

Receive events from linked providers.

```
POST /api/webhooks/:source
```

| Source   | Events                                      |
| -------- | ------------------------------------------- |
| `github` | push, pull_request, issues, etc.            |
| `stripe` | payment_intent, invoice, subscription, etc. |
| `slack`  | message, reaction, app_mention, etc.        |
| `linear` | issue, comment, project, etc.               |
| `custom` | Any JSON payload                            |

**Request:**

```json
{
  "event": "issues.opened",
  "payload": { ... }
}
```

**Response:**

```json
{
  "received": true,
  "id": "evt_abc123"
}
```

**Middleware:**

```ts
app.use(
  '/api/webhooks/:source',
  webhookMiddleware({
    verify: {
      github: process.env.GITHUB_WEBHOOK_SECRET,
      stripe: process.env.STRIPE_WEBHOOK_SECRET,
    },
    queue: true, // async processing
  }),
)
```

---

## Search

Query local schema types or federated provider data.

```
GET /api/search/:type?q=<query>&<filters>
```

### Local Types

Schema-defined types stored in DO.

```
GET /api/search/contacts?q=john&company=acme
GET /api/search/deals?status=open&min_value=10000
GET /api/search/tasks?assignee=me&due=today
```

### Provider Types

Federated search across linked providers.

```
GET /api/search/github:issues?q=bug&state=open
GET /api/search/notion:pages?q=roadmap
GET /api/search/salesforce:leads?status=new
```

### Response

```json
{
  "type": "contacts",
  "query": "john",
  "filters": { "company": "acme" },
  "results": [...],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Middleware:**

```ts
app.use(
  '/api/search/*',
  searchMiddleware({
    defaultLimit: 20,
    maxLimit: 100,
    timeout: 5000,
    cache: '5m',
  }),
)
```

---

## Resources (REST)

CRUD operations on schema types.

| Method   | Path             | Operation        |
| -------- | ---------------- | ---------------- |
| `GET`    | `/api/:type`     | List             |
| `GET`    | `/api/:type/:id` | Get              |
| `POST`   | `/api/:type`     | Create           |
| `PUT`    | `/api/:type/:id` | Update (full)    |
| `PATCH`  | `/api/:type/:id` | Update (partial) |
| `DELETE` | `/api/:type/:id` | Delete           |

### List

```
GET /api/contacts?limit=20&offset=0&sort=-created_at
```

```json
{
  "data": [...],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

### Get

```
GET /api/contacts/con_abc123
```

```json
{
  "id": "con_abc123",
  "name": "John Doe",
  "email": "john@example.com.ai",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Create

```
POST /api/contacts
Content-Type: application/json

{ "name": "John Doe", "email": "john@example.com.ai" }
```

### Update

```
PUT /api/contacts/con_abc123
Content-Type: application/json

{ "name": "John Doe", "email": "john@acme.com" }
```

### Partial Update

```
PATCH /api/contacts/con_abc123
Content-Type: application/json

{ "email": "john@acme.com" }
```

### Delete

```
DELETE /api/contacts/con_abc123
```

**Middleware:**

```ts
app.use(
  '/api/:type/*',
  resourceMiddleware({
    validate: true, // validate against schema
    timestamps: true, // auto created_at/updated_at
    softDelete: false, // hard delete by default
    hooks: {
      beforeCreate: async (ctx, data) => data,
      afterCreate: async (ctx, record) => {},
    },
  }),
)
```

---

## Actions (Functions)

Invoke serverless functions.

### List Actions

```
GET /api/actions
```

```json
{
  "actions": [
    { "name": "send-email", "type": "code" },
    { "name": "summarize", "type": "generative" },
    { "name": "research", "type": "agentic" },
    { "name": "approve", "type": "human" }
  ]
}
```

### Invoke Action

```
POST /api/actions/:action
Content-Type: application/json

{ "input": { ... } }
```

### Function Types

| Type         | Description                            |
| ------------ | -------------------------------------- |
| `code`       | Traditional serverless function        |
| `generative` | AI completion (single inference)       |
| `agentic`    | AI + tools loop (multi-step reasoning) |
| `human`      | Human-in-the-loop via channel          |

**Code Function:**

```ts
{
  type: 'code',
  handler: async (input, ctx) => {
    return { result: 'done' }
  }
}
```

**Generative Function:**

```ts
{
  type: 'generative',
  model: 'claude-sonnet-4-20250514',
  prompt: 'Summarize: {{input.text}}',
  schema: z.object({ summary: z.string() })
}
```

**Agentic Function:**

```ts
{
  type: 'agentic',
  model: 'claude-sonnet-4-20250514',
  tools: ['search', 'browse', 'write'],
  maxSteps: 10,
  prompt: 'Research {{input.topic}} and write a report'
}
```

**Human Function:**

```ts
{
  type: 'human',
  channel: 'slack',
  prompt: 'Approve expense: {{input.amount}}',
  timeout: '24h',
  escalate: 'manager'
}
```

**Middleware:**

```ts
app.use(
  '/api/actions/*',
  actionMiddleware({
    timeout: 30000,
    retry: { attempts: 3, backoff: 'exponential' },
    trace: true,
  }),
)
```

---

## Workflows

Orchestrate multi-step processes.

### Start Workflow

```
POST /api/workflows/:workflow/run
Content-Type: application/json

{ "input": { ... } }
```

```json
{
  "runId": "run_abc123",
  "status": "running",
  "startedAt": "2024-01-01T00:00:00Z"
}
```

### List Runs

```
GET /api/workflows/:workflow/runs?status=running&limit=10
```

```json
{
  "runs": [
    {
      "runId": "run_abc123",
      "status": "running",
      "startedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Run Status

```
GET /api/workflows/:workflow/runs/:runId
```

```json
{
  "runId": "run_abc123",
  "status": "completed",
  "startedAt": "2024-01-01T00:00:00Z",
  "completedAt": "2024-01-01T00:01:00Z",
  "steps": [
    { "name": "fetch", "status": "completed", "duration": 1200 },
    { "name": "process", "status": "completed", "duration": 800 }
  ],
  "output": { ... }
}
```

**Middleware:**

```ts
app.use(
  '/api/workflows/*',
  workflowMiddleware({
    persistence: 'durable-object',
    maxDuration: '1h',
    retryPolicy: { attempts: 3 },
  }),
)
```

---

## Auth

Authentication via better-auth + OAuth provider.

### better-auth Routes

```
POST /api/auth/sign-in
POST /api/auth/sign-up
POST /api/auth/sign-out
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/session
```

### OAuth Provider

Expose DO as OAuth provider for external apps.

```
GET  /oauth/authorize
POST /oauth/token
POST /oauth/revoke
GET  /oauth/userinfo
GET  /.well-known/openid-configuration
GET  /.well-known/jwks.json
```

**Middleware:**

```ts
app.use(
  '/api/auth/*',
  authMiddleware({
    session: { expiresIn: '7d' },
    oauth: {
      providers: ['github', 'google'],
    },
  }),
)

app.use(
  '/oauth/*',
  oauthProviderMiddleware({
    issuer: 'https://do.example.com.ai',
    clients: [{ id: 'app1', secret: '...', redirectUris: ['...'] }],
    scopes: ['read', 'write', 'admin'],
  }),
)
```

---

## Full Example

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  webhookMiddleware,
  searchMiddleware,
  resourceMiddleware,
  actionMiddleware,
  workflowMiddleware,
  authMiddleware,
  oauthProviderMiddleware,
} from 'dotdo/api'

const app = new Hono()

// Global middleware
app.use('*', cors())

// Auth (public)
app.use('/api/auth/*', authMiddleware())
app.use('/oauth/*', oauthProviderMiddleware())

// Protected routes
app.use('/api/*', authMiddleware({ require: true }))

// Route groups
app.use('/api/webhooks/*', webhookMiddleware())
app.use('/api/search/*', searchMiddleware())
app.use('/api/actions/*', actionMiddleware())
app.use('/api/workflows/*', workflowMiddleware())
app.use('/api/:type/*', resourceMiddleware())

export default app
```
