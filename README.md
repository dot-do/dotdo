# .do

> Build AI-native applications with Durable Objects, SQLite, and built-in integrations.

## Overview

The **.do platform** provides everything you need to build distributed, AI-native applications on Cloudflare Workers:

- **Durable Objects with SQLite** - Persistent state, transactions, and full-text search in every DO
- **Integrations baked in** - Connect to any service without Zapier or middleware
- **AI-native primitives** - Agents, humans, and workflows with a unified interface

## Core Primitives

### Triggers, Searches, Actions

Every integration exposes three primitives:

| Primitive   | Description                 | Example                                         |
| ----------- | --------------------------- | ----------------------------------------------- |
| **Trigger** | Events that start workflows | `on.github.push`, `on.stripe.payment`           |
| **Search**  | Query external data         | `search.slack.messages`, `search.github.issues` |
| **Action**  | Perform operations          | `actions.email.send`, `actions.slack.post`      |

### Function Types

Functions can be implemented in four ways:

| Type           | Description              | Use Case                             |
| -------------- | ------------------------ | ------------------------------------ |
| **Code**       | Deterministic TypeScript | Validation, transforms, calculations |
| **Generative** | AI-generated output      | Content, summaries, analysis         |
| **Agentic**    | Multi-step AI reasoning  | Complex tasks, research, planning    |
| **Human**      | Human-in-the-loop        | Approvals, reviews, decisions        |

## Quick Example

```typescript
import { DO } from 'dotdo'
import { auth, webhooks, search, actions, resources } from 'dotdo/middleware'

class MyApp extends DO {
  app = new Hono()
    .use('/api/auth/*', auth())
    .use('/api/webhooks/*', webhooks())
    .use('/api/search/*', search())
    .use('/api/actions/*', actions())
    .use('/api/:type/*', resources())
}
```

## Auth

Authentication federates to [id.org.ai](https://id.org.ai) by default, or configure your own providers.

```typescript
import { auth } from 'dotdo/middleware'

// Default: federates to id.org.ai
app.use('/api/auth/*', auth())

// Custom providers
app.use(
  '/api/auth/*',
  auth({
    providers: ['github', 'google', 'custom-oidc'],
  }),
)
```

### Identity Types

| Type        | Description                |
| ----------- | -------------------------- |
| **Human**   | End users with OAuth/OIDC  |
| **Agent**   | AI agents with API keys    |
| **Service** | Backend services with mTLS |

## Integrations

Link accounts once at the org level, use everywhere across your apps.

### Supported Integrations

- **Code**: GitHub, GitLab, Bitbucket
- **Communication**: Slack, Discord, Teams, Email
- **Data**: Postgres, MySQL, MongoDB, Airtable
- **Payments**: Stripe, PayPal
- **CRM**: Salesforce, HubSpot
- **And more**: 100+ integrations

### Human-in-the-Loop Channels

When workflows need human input, reach them where they are:

```typescript
await $.human.ask('Approve this expense?', {
  channels: ['slack', 'email'],
  timeout: '24h',
  escalate: 'manager',
})
```

## CLI

```bash
# Authenticate with org.ai
npx org.ai login

# Link integrations
npx org.ai link github
npx org.ai link slack
npx org.ai link stripe

# Deploy your app
npx org.ai deploy
```

## Learn More

- [Architecture](./docs/architecture.md) - DO hierarchy and data model
- [Integrations](./docs/integrations.md) - Available services and setup
- [Workflows](./docs/workflows.md) - Event-driven automation
- [API Reference](./docs/api.md) - Full API documentation

## License

MIT
