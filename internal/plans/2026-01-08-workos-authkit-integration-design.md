---
title: "WorkOS AuthKit Integration Design"
description: Documentation for plans
---

# WorkOS AuthKit Integration Design

**Date:** 2026-01-08
**Status:** Approved

## Summary

Integrate WorkOS AuthKit into id.org.ai for enterprise-grade human authentication, while maintaining federation layer for linked accounts and AI agent identity.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Base DO (dotdo)                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      better-auth                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │    │
│  │  │OAuth Provider│  │OAuth Proxy   │  │Organization      │   │    │
│  │  │(be an IdP)   │  │(cross-domain)│  │(multi-tenant)    │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              ↑                                       │
│                    Social Providers                                  │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│   ┌──────────┐        ┌──────────┐         ┌──────────┐            │
│   │ WorkOS   │        │ GitHub   │         │ Google   │            │
│   │ AuthKit  │        │ OAuth    │         │ OAuth    │            │
│   └──────────┘        └──────────┘         └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Decisions

### 1. Identity Mapping

- **Decision:** Federated identity mapping (Option 3)
- id.org.ai maintains `identities` table as source of truth
- WorkOS user linked as `type: 'auth'` in `linkedAccounts`
- Agents/services created separately without WorkOS

### 2. better-auth Plugins

- **oauthProvider:** id.org.ai issues tokens to apps
- **oauthProxy:** Cross-domain auth for child DOs on different domains
- **organization:** Multi-tenant with `activeOrganizationId`

### 3. Schema Extension

```typescript
// Extend better-auth users → identities
user: {
  modelName: "identities",
  additionalFields: {
    type: { type: ["human", "agent", "service"] },
    handle: { type: "string", unique: true },
    agentType: { type: "string" },
    capabilities: { type: "json" },
    ownerId: { type: "string" },
  }
}

// Extend accounts → linkedAccounts
account: {
  modelName: "linkedAccounts",
  additionalFields: {
    type: { type: ["auth", "channel", "ai", "finance", "infra", "devtools", "workspace", "data", "customer", "social", "custom"] },
    vaultRef: { type: "string" }, // WorkOS Vault reference
  }
}

// Organization extension
organization: {
  additionalFields: {
    tenantNs: { type: "string" },
    orgId: { type: "string" }, // WorkOS org ID
  }
}
```

### 4. Auth Configuration Modes

1. **Federate to parent** (default) - Zero config
2. **Own providers** - Full control
3. **Hybrid** - Mix of both

### 5. CLI (org.ai)

- Device authorization flow for CLI auth
- Token storage: `env ORG_AI_TOKEN > ~/.config/org.ai/credentials.json`
- Keychain deferred due to cross-platform issues

### 6. Integrations as First-Class

- Linked accounts = integrations
- No Zapier/Composio needed
- `this.integration('github')` pattern in DOs

### 7. Core Primitives

- **Triggers:** Events from providers, cron, webhooks
- **Searches:** Queries across local DB and linked providers
- **Actions (Functions):** CodeFunction, GenerativeFunction, AgenticFunction, HumanFunction

### 8. API Routes (Hono middleware)

```typescript
.use('/api/auth/*', auth())
.use('/api/webhooks/*', webhooks())
.use('/api/search/*', search())
.use('/api/actions/*', actions())
.use('/api/:type/*', resources())
```

## WorkOS Features Used

- **AuthKit:** Human authentication (SSO, MFA, user management)
- **Vault:** Secure token storage for linked accounts
- **FGA:** Fine-grained authorization (future)
- **Audit Logs:** Compliance (future)

## Implementation Tasks

1. [ ] Update base DO to include better-auth with plugins
2. [ ] Add WorkOS as social provider in better-auth
3. [ ] Extend schema with identity/linked account fields
4. [ ] Implement Hono middleware (auth, webhooks, search, resources, actions)
5. [ ] Create org.ai CLI with device auth flow
6. [ ] Add provider registry for integrations
7. [ ] Implement WorkOS Vault integration for token storage
